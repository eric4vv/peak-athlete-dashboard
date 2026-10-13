/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   uploader.js — resumable multipart upload engine (no UI)

   Phase 4 of prototype-v03/UPLOAD-CENTER-PLAN.md (2026-10-10).
   Stability rework 2026-10-13 (Step A): a 13 GB upload over real
   internet must never stop on its own.
     - Connection problems are retried indefinitely, with a
       growing wait (1 s ... 60 s) and an onRetry callback so the
       page can say "retrying automatically in N s".
     - A chunk that makes no progress for stallMs is aborted and
       resent (frozen connections often raise no error at all).
     - An expired sign-in is refreshed (refreshAuth) and the call
       repeated, so uploads can outlive the 1-hour session token.
     - The upload only stops for a definite refusal from our
       server (cancelled elsewhere, not allowed) or when the
       stored upload no longer exists.

   Talks only to the session-upload edge function (through the
   `api` callback the page passes in) and to the short-lived
   signed part URLs that function returns. Never sees storage
   keys or credentials.

   Flow: ask the server which parts it already holds -> upload
   the missing ones, 3 at a time -> ask the server to complete
   (the server re-checks every part and the total size itself).
   Pause aborts the parts in flight; resume starts again from the
   parts the server holds.

   Usage (after the page has called the `start` action):
     const up = PA_UPLOADER.createUpload({
       file, uploadUuid, partSize, api,      // api(action, payload) -> JSON
       refreshAuth: async () => {},          // renew the sign-in
       onProgress: ({ sent, total, partsDone, partCount }) => {},
       onState: (state, error) => {},        // uploading | paused | completing
                                             // | done | error | cancelled
       onRetry: (info) => {},                // { attempt, waitMs } or null
     });
     up.run(); up.pause(); up.resume(); up.cancel();
   ─────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const SIGN_BATCH = 20;
  const URL_MAX_AGE_MS = 12 * 60 * 1000;      // server signs for 15 minutes; refresh early
  const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
  const STALL_MS = 60 * 1000;                 // no progress for this long = frozen connection
  // Definite answers from our server: retrying cannot help.
  const REFUSALS = new Set([
    'not_allowed', 'forbidden', 'not_found', 'bad_request', 'not_active_coach',
    'program_inactive', 'athlete_not_on_roster', 'consent_missing', 'upload_gone',
  ]);

  const abortedError = () => Object.assign(new Error('aborted'), { aborted: true });

  // Default transport: XHR, because fetch has no upload progress.
  function xhrPut(url, blob, onProgress, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortedError()); return; }
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = () => resolve({ status: xhr.status });
      xhr.onerror = () => reject(Object.assign(new Error('network'), { network: true }));
      xhr.ontimeout = () => reject(Object.assign(new Error('timeout'), { network: true }));
      xhr.onabort = () => reject(abortedError());
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(blob);
    });
  }

  function defaultIsOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }
  function defaultWaitOnline(signal) {
    return new Promise((resolve, reject) => {
      if (defaultIsOnline()) { resolve(); return; }
      const onOnline = () => { cleanup(); resolve(); };
      const onAbort = () => { cleanup(); reject(abortedError()); };
      const cleanup = () => {
        root.removeEventListener('online', onOnline);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      root.addEventListener('online', onOnline);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  // Sleep that ends early (with an abort error) when the upload is paused.
  function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortedError()); return; }
      const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(t); reject(abortedError()); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function createUpload(opts) {
    const { file, uploadUuid, partSize, api } = opts;
    const putPart = opts.putPart || xhrPut;
    const concurrency = opts.concurrency || 3;
    const sleep = opts.sleep || abortableSleep;
    const isOnline = opts.isOnline || defaultIsOnline;
    const waitOnline = opts.waitOnline || defaultWaitOnline;
    const refreshAuth = opts.refreshAuth || (async () => {});
    const stallMs = opts.stallMs || STALL_MS;
    const backoff = opts.backoffMs || BACKOFF_MS;
    const partCount = Math.max(1, Math.ceil(file.size / partSize));

    const done = new Set();       // part numbers the server holds
    const inflight = new Map();   // part number -> bytes sent so far
    const urls = new Map();       // part number -> { url, at }
    let controller = null;
    let state = 'idle';
    let signChain = Promise.resolve();
    let retrying = false;
    let refreshing = null;        // one shared sign-in renewal for all parallel senders

    function renewSignIn() {
      if (!refreshing) {
        refreshing = Promise.resolve()
          .then(() => refreshAuth())
          .catch(() => { /* the next attempt reports it again */ })
          .finally(() => { refreshing = null; });
      }
      return refreshing;
    }

    const partBytes = (n) => Math.min(partSize, file.size - (n - 1) * partSize);

    function emitProgress() {
      let sent = 0;
      for (const n of done) sent += partBytes(n);
      for (const b of inflight.values()) sent += b;
      if (opts.onProgress) opts.onProgress({ sent: Math.min(sent, file.size), total: file.size, partsDone: done.size, partCount });
    }
    function setState(s, err) {
      state = s;
      if (opts.onState) opts.onState(s, err || null);
    }
    function emitRetry(info) {
      if (!info && !retrying) return;
      retrying = !!info;
      if (opts.onRetry) opts.onRetry(info);
    }

    // Classify a failure: true = try again later, false = give up.
    function retryable(e) {
      if (e.aborted) return false;
      if (e.api) return !REFUSALS.has(e.code);          // storage hiccups, internal errors, expired sign-in
      if (e.status) return e.status !== 404;            // 404 = the stored upload is gone
      return true;                                      // network error, timeout, stall
    }

    // Run fn until it succeeds, waiting longer between tries; never gives up
    // on connection problems. Refusals and pauses are passed through.
    async function persist(fn, signal) {
      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw abortedError();
        try {
          const out = await fn();
          emitRetry(null);
          return out;
        } catch (e) {
          if (e.aborted || signal.aborted) throw abortedError();
          if (!retryable(e)) throw e;
          if (e.code === 'unauthorized') await renewSignIn();
          const waitMs = backoff[Math.min(attempt - 1, backoff.length - 1)];
          emitRetry({ attempt, waitMs, reason: e.code || (e.status ? 'http_' + e.status : 'network') });
          if (!isOnline()) await waitOnline(signal);
          await sleep(waitMs, signal);
        }
      }
    }

    async function call(action, payload) {
      let res;
      try {
        res = await api(action, Object.assign({ upload_uuid: uploadUuid }, payload || {}));
      } catch (e) {
        throw Object.assign(new Error('network'), { network: true });
      }
      if (!res || !res.ok) {
        throw Object.assign(new Error((res && res.code) || 'api_error'), { code: (res && res.code) || 'api_error', api: true });
      }
      return res;
    }

    async function refreshDone(signal) {
      const r = await persist(() => call('list_parts'), signal);
      done.clear();
      for (const p of r.parts || []) {
        if (p.PartNumber >= 1 && p.PartNumber <= partCount && p.Size === partBytes(p.PartNumber)) done.add(p.PartNumber);
      }
    }

    // One signing request at a time; each signs the requested part plus the
    // next missing parts without a fresh URL, up to SIGN_BATCH.
    function urlFor(n) {
      const fresh = (k) => { const c = urls.get(k); return c && Date.now() - c.at < URL_MAX_AGE_MS; };
      const next = signChain.then(async () => {
        if (fresh(n)) return urls.get(n).url;
        const batch = [n];
        for (let k = 1; k <= partCount && batch.length < SIGN_BATCH; k++) {
          if (k !== n && !done.has(k) && !inflight.has(k) && !fresh(k)) batch.push(k);
        }
        const r = await call('sign_parts', { part_numbers: batch });
        const at = Date.now();
        for (const k of Object.keys(r.urls || {})) urls.set(Number(k), { url: r.urls[k], at });
        if (!urls.has(n)) throw Object.assign(new Error('sign_failed'), { code: 'sign_failed', api: true });
        return urls.get(n).url;
      });
      signChain = next.catch(() => {});
      return next;
    }

    // One attempt at one part, with a watchdog for frozen connections.
    async function attemptPart(n, signal) {
      const url = await urlFor(n);
      if (signal.aborted) throw abortedError();
      const partCtl = new AbortController();
      const onOuterAbort = () => partCtl.abort();
      signal.addEventListener('abort', onOuterAbort, { once: true });
      let lastProgress = Date.now();
      let stalled = false;
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgress > stallMs) { stalled = true; partCtl.abort(); }
      }, Math.min(5000, Math.max(10, Math.floor(stallMs / 4))));
      inflight.set(n, 0);
      try {
        const start = (n - 1) * partSize;
        const blob = file.slice(start, start + partBytes(n));
        const r = await putPart(url, blob, (loaded) => {
          lastProgress = Date.now();
          inflight.set(n, loaded);
          if (retrying && loaded > 0) emitRetry(null); // data is flowing again
          emitProgress();
        }, partCtl.signal);
        if (r.status >= 200 && r.status < 300) {
          done.add(n);
          urls.delete(n);
          return;
        }
        // 400/403: expired or rejected signature (or a storage timeout): sign again.
        if (r.status === 400 || r.status === 403) urls.delete(n);
        throw Object.assign(new Error('http_' + r.status), { status: r.status });
      } catch (e) {
        if (stalled && !signal.aborted) {
          urls.delete(n);
          throw Object.assign(new Error('stalled'), { network: true, stalled: true });
        }
        throw e;
      } finally {
        clearInterval(watchdog);
        signal.removeEventListener('abort', onOuterAbort);
        inflight.delete(n);
        emitProgress();
      }
    }

    async function uploadMissing(ctl) {
      const signal = ctl.signal;
      const queue = [];
      for (let n = 1; n <= partCount; n++) if (!done.has(n)) queue.push(n);
      let failure = null;
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push((async () => {
          while (queue.length && !signal.aborted) {
            const n = queue.shift();
            try {
              await persist(() => attemptPart(n, signal), signal);
            } catch (e) {
              if (!e.aborted && !failure) {
                failure = e;
                ctl.abort(); // stop this run's other workers
              }
              return;
            }
          }
        })());
      }
      await Promise.all(workers);
      if (failure) throw failure;
      if (signal.aborted) throw abortedError();
    }

    async function complete(signal) {
      let sent = false;
      for (;;) {
        let res;
        try {
          res = await persist(async () => {
            try {
              return await call('complete');
            } catch (e) {
              // A refusal after an earlier attempt may mean that attempt
              // succeeded and only its answer was lost.
              if (e.api && e.code === 'not_allowed' && sent) return { ok: false, code: 'check_received' };
              if (e.api && (e.code === 'upload_incomplete' || REFUSALS.has(e.code))) return { ok: false, code: e.code };
              sent = true;
              throw e;
            }
          }, signal);
        } catch (e) {
          throw e;
        }
        if (res.ok) return { ok: true };
        if (res.code === 'check_received') {
          const ov = await persist(async () => {
            let o;
            try { o = await api('overview', {}); } catch (_) { throw Object.assign(new Error('network'), { network: true }); }
            return o;
          }, signal);
          const mine = ov && ov.ok && (ov.uploads || []).find((u) => u.upload_uuid === uploadUuid);
          if (mine && ['received', 'accepted', 'delivered'].includes(mine.status)) return { ok: true };
          return { ok: false, code: 'not_allowed' };
        }
        return res;
      }
    }

    async function run() {
      if (['uploading', 'completing', 'done', 'cancelled'].includes(state)) return;
      const ctl = new AbortController();
      controller = ctl;
      const signal = ctl.signal;
      // A paused run can still be winding down when the coach resumes; only
      // the newest run may change the upload's state.
      const current = () => controller === ctl;
      setState('uploading');
      try {
        await refreshDone(signal);
        emitProgress();
        for (let round = 0; ; round++) {
          await uploadMissing(ctl);
          setState('completing');
          const c = await complete(signal);
          if (c.ok) { emitRetry(null); setState('done'); return; }
          if (c.code === 'upload_incomplete' && round < 3) {
            await refreshDone(signal);
            setState('uploading');
            continue;
          }
          throw Object.assign(new Error(c.code || 'complete_failed'), { code: c.code || 'complete_failed', api: true });
        }
      } catch (e) {
        if (!current()) return;
        emitRetry(null);
        if (state === 'cancelled' || state === 'paused') return;
        if (e.aborted) { setState('paused'); return; }
        setState('error', e.status === 404 ? Object.assign(e, { code: 'upload_gone' }) : e);
      }
    }

    function pause() {
      if (state !== 'uploading' && state !== 'completing') return;
      setState('paused');
      if (controller) controller.abort();
      inflight.clear();
      emitRetry(null);
      emitProgress();
    }

    function resume() {
      if (state === 'paused' || state === 'error') run();
    }

    async function cancel() {
      if (state === 'done' || state === 'cancelled') return { ok: false, code: 'not_allowed' };
      setState('cancelled');
      if (controller) controller.abort();
      inflight.clear();
      emitRetry(null);
      try {
        return await api('cancel', { upload_uuid: uploadUuid });
      } catch (_) {
        return { ok: false, code: 'network' };
      }
    }

    return {
      run, pause, resume, cancel, partCount,
      get state() { return state; },
    };
  }

  root.PA_UPLOADER = { createUpload };
})(typeof window !== 'undefined' ? window : globalThis);
