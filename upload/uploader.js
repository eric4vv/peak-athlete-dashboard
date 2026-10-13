/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   uploader.js — resumable multipart upload engine (no UI)

   Phase 4 of prototype-v03/UPLOAD-CENTER-PLAN.md (2026-10-10).
   Talks only to the session-upload edge function (through the
   `api` callback the page passes in) and to the short-lived
   signed part URLs that function returns. Never sees storage
   keys or credentials.

   Flow: ask the server which parts it already holds -> upload
   the missing ones, 3 at a time, each retried with backoff ->
   ask the server to complete (the server re-checks every part
   and the total size itself). Pause aborts the parts in flight;
   resume starts again from the parts the server holds, so a
   dropped connection or a page reload loses at most the parts
   that were in flight.

   Usage (after the page has called the `start` action):
     const up = PA_UPLOADER.createUpload({
       file, uploadUuid, partSize, api,      // api(action, payload) -> JSON
       onProgress: ({ sent, total, partsDone, partCount }) => {},
       onState: (state, error) => {},        // uploading | paused | completing
     });                                     // | done | error | cancelled
     up.run(); up.pause(); up.resume(); up.cancel();
   ─────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const SIGN_BATCH = 20;
  const URL_MAX_AGE_MS = 12 * 60 * 1000;   // server signs for 15 minutes; refresh early
  const MAX_ATTEMPTS = 6;
  const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

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

  function createUpload(opts) {
    const { file, uploadUuid, partSize, api } = opts;
    const putPart = opts.putPart || xhrPut;
    const concurrency = opts.concurrency || 3;
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const isOnline = opts.isOnline || defaultIsOnline;
    const waitOnline = opts.waitOnline || defaultWaitOnline;
    const partCount = Math.max(1, Math.ceil(file.size / partSize));

    const done = new Set();       // part numbers the server holds
    const inflight = new Map();   // part number -> bytes sent so far
    const urls = new Map();       // part number -> { url, at }
    let controller = null;
    let state = 'idle';
    let signChain = Promise.resolve();

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

    async function call(action, payload) {
      const res = await api(action, Object.assign({ upload_uuid: uploadUuid }, payload || {}));
      if (!res || !res.ok) {
        throw Object.assign(new Error((res && res.code) || 'api_error'), { code: (res && res.code) || 'api_error', api: true });
      }
      return res;
    }

    async function refreshDone() {
      const r = await call('list_parts');
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

    async function uploadPart(n, signal) {
      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw abortedError();
        try {
          const url = await urlFor(n);
          if (signal.aborted) throw abortedError();
          inflight.set(n, 0);
          const start = (n - 1) * partSize;
          const blob = file.slice(start, start + partBytes(n));
          const r = await putPart(url, blob, (loaded) => { inflight.set(n, loaded); emitProgress(); }, signal);
          inflight.delete(n);
          if (r.status >= 200 && r.status < 300) {
            done.add(n);
            urls.delete(n);
            emitProgress();
            return;
          }
          // 400/403: expired or rejected signature (or a storage timeout): sign again.
          if (r.status === 400 || r.status === 403) urls.delete(n);
          throw Object.assign(new Error('http_' + r.status), {
            status: r.status,
            retryable: [400, 403, 408, 429].includes(r.status) || r.status >= 500,
          });
        } catch (e) {
          inflight.delete(n);
          emitProgress();
          if (e.aborted || signal.aborted) throw abortedError();
          // Network failures (including a failed call to our own server) retry;
          // a definite refusal from our server does not.
          const retryable = e.network || e.retryable || (!e.api && !e.status);
          if (!retryable || attempt >= MAX_ATTEMPTS) throw e;
          if (!isOnline()) await waitOnline(signal);
          await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
        }
      }
    }

    async function uploadMissing(signal) {
      const queue = [];
      for (let n = 1; n <= partCount; n++) if (!done.has(n)) queue.push(n);
      let failure = null;
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push((async () => {
          while (queue.length && !signal.aborted) {
            const n = queue.shift();
            try {
              await uploadPart(n, signal);
            } catch (e) {
              if (!e.aborted && !failure) {
                failure = e;
                controller.abort(); // stop the other workers
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

    async function complete() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let res;
        try {
          res = await api('complete', { upload_uuid: uploadUuid });
        } catch (e) {
          if (attempt === 3) throw e;
          await sleep(BACKOFF_MS[attempt - 1]);
          continue;
        }
        if (res && res.ok) return { ok: true };
        // A retry after a lost response finds the upload already received.
        if (res && res.code === 'not_allowed' && attempt > 1) {
          const ov = await api('overview', {});
          const mine = ov && ov.ok && (ov.uploads || []).find((u) => u.upload_uuid === uploadUuid);
          if (mine && mine.status === 'received') return { ok: true };
        }
        return res || { ok: false, code: 'complete_failed' };
      }
      return { ok: false, code: 'complete_failed' };
    }

    async function run() {
      if (['uploading', 'completing', 'done', 'cancelled'].includes(state)) return;
      controller = new AbortController();
      const signal = controller.signal;
      setState('uploading');
      try {
        await refreshDone();
        emitProgress();
        for (let round = 0; round < 2; round++) {
          await uploadMissing(signal);
          setState('completing');
          const c = await complete();
          if (c.ok) { setState('done'); return; }
          if (c.code === 'upload_incomplete' && round === 0) {
            await refreshDone();
            setState('uploading');
            continue;
          }
          throw Object.assign(new Error(c.code || 'complete_failed'), { code: c.code || 'complete_failed', api: true });
        }
      } catch (e) {
        if (state === 'cancelled' || state === 'paused') return;
        if (e.aborted) { setState('paused'); return; }
        setState('error', e);
      }
    }

    function pause() {
      if (state !== 'uploading') return;
      setState('paused');
      if (controller) controller.abort();
      inflight.clear();
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
