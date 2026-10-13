/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   upload-app.jsx — coach upload page

   Phase 4 (2026-10-10); rebuilt 2026-10-13 for the trial-based
   allowance and the upload QUEUE. Plan: UPLOAD-CENTER-PLAN.md.

   The coach adds Templo files per athlete (one trial or clip per
   file by default, editable), for as many athletes as needed,
   confirms calibration once, and presses "Upload all". Files go
   one at a time; each becomes its own upload on the server and
   shows as Received the moment it finishes. The engine
   (uploader.js) retries connection problems on its own.

   If the page closes mid-queue, the unfinished files are offered
   again on the next visit. In Chrome and Edge the page keeps a
   handle to each picked file (IndexedDB), so continuing is one
   click plus the browser's permission prompt; elsewhere the coach
   re-selects the files and they are matched by size and date.

   All data goes through the session-upload edge function; this
   page never queries tables directly and never sees storage keys.

   Accessibility (WCAG 2.1 AA target): skip link, landmarks, one
   h1 + h2 per section, native controls with labels, aria-live
   announcements, native <dialog> confirmations, no time limits.
   ─────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useCallback } = React;
const t = window.PA_UPLOAD_T;

const FN_URL = window.PA_AUTH.SUPABASE_URL + '/functions/v1/session-upload';
const QUEUE_KEY = 'pa-upload-queue';
const LEGACY_PENDING_KEY = 'pa-upload-pending';
const GB = 1024 * 1024 * 1024;
const LEGACY_PART_SIZE = 64 * 1024 * 1024;
const SUPPORTS_HANDLES = typeof window.showOpenFilePicker === 'function';

// ── Server call ───────────────────────────────────────────
// Network failures throw (the upload engine retries those);
// server answers always come back as { ok, code, ... }.
async function api(action, payload) {
  const { data } = await window.supabaseClient.auth.getSession();
  const token = data && data.session ? data.session.access_token : null;
  if (!token) return { ok: false, code: 'unauthorized' };
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      apikey: window.PA_AUTH.SUPABASE_KEY,
    },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  try { return await res.json(); } catch (_) { return { ok: false, code: 'http_' + res.status }; }
}

// ── Formatting helpers ────────────────────────────────────
function fmtBytes(n) {
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
function fmtDuration(seconds) {
  if (seconds < 60) return t('eta.lessThanMinute');
  const total = Math.round(seconds / 60);
  if (total < 60) return t('eta.minutes', { m: total });
  return t('eta.hours', { h: Math.floor(total / 60), m: total % 60 });
}
function fmtMonth(period) {
  const parts = String(period || '').split('-').map(Number);
  if (parts.length < 2 || !parts[0]) return '';
  return new Date(Date.UTC(parts[0], parts[1] - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function athleteName(a) {
  return a ? [a.first_name, a.last_name].filter(Boolean).join(' ') : t('uploads.unknownAthlete');
}
function codeText(code, extra) {
  const key = 'code.' + code;
  const s = t(key, extra || {});
  return s === key ? t('code.default', { code: code || 'unknown' }) : s;
}
function fileExt(name) {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}
function engineErrorCode(err) {
  if (!err) return 'default';
  if (err.code) return err.code;
  if (err.status) return 'storage_unavailable';
  return 'network';
}
const newId = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const itemUnits = (it) => (it.type === 'performance' ? (it.starts || 0) + (it.turns || 0) : (it.clips || 0));

// ── Local storage (per-browser convenience only) ──────────
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function writeJson(key, v) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch (_) { /* storage blocked: continuing after a reload won't be offered */ }
}
// What survives a reload: no file names, no file contents.
function persistQueue(items) {
  const keep = items
    .filter((i) => !['done', 'cancelled'].includes(i.status) && !(i.status === 'error' && !i.uploadUuid))
    .map((i) => ({
      id: i.id, athleteUuid: i.athleteUuid, type: i.type, starts: i.starts, turns: i.turns, clips: i.clips,
      size: i.size, lastModified: i.lastModified, uploadUuid: i.uploadUuid || null, partSize: i.partSize || null,
    }));
  writeJson(QUEUE_KEY, keep.length ? keep : null);
}

// ── File handles (Chrome / Edge): continue after a reload ──
const handleStore = (() => {
  let dbp = null;
  function db() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('pa-upload', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('handles');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }
  function run(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    }));
  }
  return {
    put: (k, v) => run('readwrite', (s) => s.put(v, k)).catch(() => {}),
    get: (k) => run('readonly', (s) => s.get(k)).catch(() => null),
    del: (k) => run('readwrite', (s) => s.delete(k)).catch(() => {}),
  };
})();

// ── Dialog (native <dialog>: focus trap, Escape, backdrop) ─
function Dialog({ open, titleId, title, children, onClose }) {
  const ref = useRef(null);
  const returnTo = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement;
      d.showModal();
      const af = d.querySelector('[data-autofocus]');
      if (af) af.focus();
    } else if (!open && d.open) {
      d.close();
      if (returnTo.current && document.contains(returnTo.current)) returnTo.current.focus();
    }
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id={titleId}>{title}</h2>
      {open ? children : null}
    </dialog>
  );
}

// ── Budget: what each athlete has left, counting the queue ─
function budgetFor(ov, athleteUuid, type, items) {
  const a = ov.roster.find((x) => x.athlete_uuid === athleteUuid);
  const max = type === 'performance' ? ov.program.perf_trials_per_month : ov.program.video_clips_per_month;
  const used = a ? (type === 'performance' ? a.perf_used : a.video_used) : 0;
  // Items already started on the server are inside `used`.
  const queued = items
    .filter((i) => i.athleteUuid === athleteUuid && i.type === type && !i.uploadUuid
                   && !['done', 'cancelled', 'error'].includes(i.status))
    .reduce((s, i) => s + itemUnits(i), 0);
  return { max, used, queued, left: Math.max(max - used, 0), leftAfterQueue: max - used - queued };
}

// ── Add files ─────────────────────────────────────────────
function AddFiles({ ov, items, onAdd, disabled }) {
  const prog = ov.program;
  const [athleteUuid, setAthleteUuid] = useState('');
  const [type, setType] = useState('');
  const [msg, setMsg] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const athlete = ov.roster.find((a) => a.athlete_uuid === athleteUuid) || null;
  const fileTypes = type === 'video' ? prog.video_file_types : prog.perf_file_types;
  const allTypes = Array.from(new Set([...(prog.perf_file_types || []), ...(prog.video_file_types || [])]));
  const typesText = (type ? fileTypes : allTypes).map((x) => '.' + x).join(' or ');
  const b = athlete && type ? budgetFor(ov, athleteUuid, type, items) : null;

  function accept(entries) {
    if (!athlete || !type) { setMsg({ kind: 'error', text: t('add.needAthlete') }); return; }
    const ok = [];
    const rejected = [];
    for (const { file, handle } of entries) {
      if (!file) continue;
      let reason = null;
      if (!fileTypes.includes(fileExt(file.name))) reason = t('add.rejectType', { types: typesText });
      else if (file.size === 0) reason = t('add.rejectEmpty');
      else if (file.size > prog.max_file_gb * GB) reason = t('add.rejectSize', { max: prog.max_file_gb });
      if (reason) { rejected.push(t('add.rejected', { name: file.name, reason })); continue; }
      ok.push({ file, handle });
    }
    if (ok.length) onAdd(athleteUuid, type, ok);
    const parts = [];
    if (ok.length) parts.push(t('add.added', { n: ok.length, name: athleteName(athlete) }));
    parts.push(...rejected);
    setMsg({ kind: rejected.length ? 'error' : 'ok', text: parts.join(' ') });
  }

  async function choose() {
    if (!athlete || !type) { setMsg({ kind: 'error', text: t('add.needAthlete') }); return; }
    if (SUPPORTS_HANDLES) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        const entries = [];
        for (const h of handles) entries.push({ file: await h.getFile(), handle: h });
        accept(entries);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;   // the coach closed the picker
      }
    }
    if (inputRef.current) inputRef.current.click();
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    const items = dt && dt.items ? Array.from(dt.items).filter((i) => i.kind === 'file') : [];
    if (items.length && items[0].getAsFileSystemHandle) {
      // Handles must be requested during the drop event itself.
      const pending = items.map((i) => Promise.all([i.getAsFile(), i.getAsFileSystemHandle().catch(() => null)]));
      Promise.all(pending).then((pairs) => accept(pairs.map(([file, handle]) => ({ file, handle }))));
    } else {
      accept(Array.from((dt && dt.files) || []).map((file) => ({ file, handle: null })));
    }
  }

  return (
    <section className="up-card" aria-labelledby="add-title">
      <h2 id="add-title">{t('add.title')}</h2>
      {msg && <p className={'up-msg ' + msg.kind} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}

      <div className="up-field">
        <label className="up-label" htmlFor="f-athlete">{t('add.athlete')}</label>
        <select id="f-athlete" value={athleteUuid} aria-describedby="f-athlete-help"
                onChange={(e) => { setAthleteUuid(e.target.value); setMsg(null); }}>
          <option value="">{t('add.athlete.placeholder')}</option>
          {ov.roster.map((a) => {
            const bp = budgetFor(ov, a.athlete_uuid, 'performance', items);
            const bv = budgetFor(ov, a.athlete_uuid, 'video', items);
            return (
              <option key={a.athlete_uuid} value={a.athlete_uuid}>
                {t('add.athlete.option', {
                  name: athleteName(a),
                  p: Math.max(bp.leftAfterQueue, 0), pmax: bp.max,
                  v: Math.max(bv.leftAfterQueue, 0), vmax: bv.max,
                })}
              </option>
            );
          })}
        </select>
        <span id="f-athlete-help" className="up-help">{t('add.athlete.help')}</span>
      </div>

      <fieldset>
        <legend>{t('add.type')}</legend>
        {['performance', 'video'].map((ty) => (
          <label className="up-radio" key={ty}>
            <input type="radio" name="f-type" id={'f-type-' + ty} value={ty} checked={type === ty}
                   aria-describedby={'f-type-' + ty + '-help'} onChange={() => { setType(ty); setMsg(null); }} />
            <span>
              <strong>{t('add.type.' + ty)}</strong>
              <span id={'f-type-' + ty + '-help'} className="up-help">
                {t('add.type.' + ty + '.help', { n: ty === 'performance' ? prog.perf_trials_per_month : prog.video_clips_per_month })}
              </span>
            </span>
          </label>
        ))}
        {b && (
          <p className={'up-allowance' + (b.leftAfterQueue <= 0 ? ' extra' : '')}>
            {t('add.left', {
              name: athleteName(athlete), left: Math.max(b.leftAfterQueue, 0), max: b.max,
              unit: t(type === 'performance' ? 'unit.trials' : 'unit.clips'),
            })}
          </p>
        )}
      </fieldset>

      <div className={'up-drop' + (dragOver ? ' over' : '')}
           onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
           onDragLeave={() => setDragOver(false)}
           onDrop={onDrop}>
        <button type="button" className="up-btn" onClick={choose} aria-disabled={disabled ? 'true' : undefined}
                aria-describedby="f-files-help">{t('add.choose')}</button>
        <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
               accept={(type ? fileTypes : allTypes).map((x) => '.' + x).join(',')}
               onChange={(e) => {
                 const files = Array.from(e.target.files || []);
                 e.target.value = '';
                 accept(files.map((file) => ({ file, handle: null })));
               }} />
        <span aria-hidden="true">{t('add.drop')}</span>
      </div>
      <span id="f-files-help" className="up-help">{t('add.help', { types: typesText, max: prog.max_file_gb })}</span>
    </section>
  );
}

// ── Queue ─────────────────────────────────────────────────
function itemStatusText(it) {
  const pct = it.size ? Math.floor(((it.sent || 0) / it.size) * 100) : 0;
  switch (it.status) {
    case 'ready': return t('qs.ready');
    case 'needsFile': return t('qs.needsFile');
    case 'starting': return t('qs.starting');
    case 'uploading': return t('qs.uploading', { pct });
    case 'completing': return t('qs.completing');
    case 'paused': return t('qs.paused', { pct });
    case 'done': return t('qs.done');
    case 'cancelled': return t('qs.cancelled');
    case 'error': return t('qs.error', { reason: codeText(it.error, it.errorExtra) });
    default: return it.status;
  }
}

function QueueCard({ ov, items, running, calibration, setCalibration, onChange, onRemove, onCancel,
                     onUploadAll, onPause, onClearDone, problems }) {
  const byId = {};
  for (const a of ov.roster) byId[a.athlete_uuid] = a;
  const waiting = items.filter((i) => ['ready', 'paused', 'needsFile'].includes(i.status));
  const totalSize = items.filter((i) => !['cancelled'].includes(i.status)).reduce((s, i) => s + (i.size || 0), 0);
  const hasPerf = items.some((i) => i.type === 'performance' && !['done', 'cancelled', 'error'].includes(i.status));
  const editable = (i) => !i.uploadUuid && ['ready', 'needsFile', 'error'].includes(i.status) && !running;
  const pausedNow = !running && items.some((i) => i.status === 'paused');

  return (
    <section className="up-card" aria-labelledby="queue-title">
      <h2 id="queue-title">{t('queue.title')}</h2>
      {items.length === 0 ? <p className="up-muted">{t('queue.empty')}</p> : (
        <>
          <p className="up-muted">{t('queue.summary', { files: items.length, size: fmtBytes(totalSize) })}</p>
          <div className="up-table-wrap">
            <table>
              <caption className="sr-only">{t('queue.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('col.file')}</th>
                  <th scope="col">{t('col.athlete')}</th>
                  <th scope="col">{t('col.contents')}</th>
                  <th scope="col">{t('col.status')}</th>
                  <th scope="col"><span className="sr-only">{t('col.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const fname = it.name || fmtBytes(it.size || 0);
                  return (
                    <tr key={it.id}>
                      <th scope="row" className="up-file-name">{fname}<div className="up-muted">{fmtBytes(it.size || 0)}</div></th>
                      <td>{athleteName(byId[it.athleteUuid])}<div className="up-muted">{t('type.' + it.type + '.title')}</div></td>
                      <td>
                        {it.type === 'performance' ? (
                          <div className="up-row-actions">
                            <label className="up-mini">
                              <span>{t('q.starts')}</span>
                              <input type="number" min={0} max={ov.program.perf_trials_per_month} value={it.starts}
                                     aria-label={t('q.startsLabel', { file: fname })} disabled={!editable(it)}
                                     onChange={(e) => onChange(it.id, { starts: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                            </label>
                            <label className="up-mini">
                              <span>{t('q.turns')}</span>
                              <input type="number" min={0} max={ov.program.perf_trials_per_month} value={it.turns}
                                     aria-label={t('q.turnsLabel', { file: fname })} disabled={!editable(it)}
                                     onChange={(e) => onChange(it.id, { turns: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                            </label>
                          </div>
                        ) : (
                          <label className="up-mini">
                            <span>{t('q.clips')}</span>
                            <input type="number" min={1} max={ov.program.video_clips_per_month} value={it.clips}
                                   aria-label={t('q.clipsLabel', { file: fname })} disabled={!editable(it)}
                                   onChange={(e) => onChange(it.id, { clips: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                          </label>
                        )}
                      </td>
                      <td>
                        <span className={'up-badge ' + (it.status === 'done' ? 'received' : it.status === 'error' ? 'recapture' : 'uploading')}>
                          {itemStatusText(it)}
                        </span>
                      </td>
                      <td>
                        {editable(it) && (
                          <button type="button" className="up-btn small" aria-label={t('q.removeLabel', { file: fname })}
                                  onClick={() => onRemove(it)}>{t('q.remove')}</button>
                        )}
                        {it.uploadUuid && !['done', 'cancelled'].includes(it.status) && (
                          <button type="button" className="up-btn small danger" aria-label={t('q.cancelLabel', { file: fname })}
                                  onClick={() => onCancel(it)}>{t('cancel.confirm')}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {problems.length > 0 && (
            <div className="up-error-summary" role="alert">
              <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          {hasPerf && (
            <div className="up-check up-field" style={{ marginTop: 16 }}>
              <input type="checkbox" id="q-calibration" checked={calibration} disabled={running}
                     aria-describedby="q-calibration-help" onChange={(e) => setCalibration(e.target.checked)} />
              <label htmlFor="q-calibration">
                {t('q.calibration')}
                <span id="q-calibration-help" className="up-help">{t('q.calibration.help')}</span>
              </label>
            </div>
          )}

          <div className="up-reminders">
            <h3>{t('q.reminders.title')}</h3>
            <ul>
              <li>{t('q.reminder.oneAthlete')}</li>
              <li>{t('q.reminder.trials')}</li>
              <li>{t('q.reminder.calibration')}</li>
              <li>{t('q.reminder.awake')}</li>
            </ul>
          </div>

          <div className="up-actions">
            {!running && waiting.length > 0 && (
              <button type="button" className="up-btn primary" onClick={onUploadAll}>
                {pausedNow ? t('q.resume') : t('q.uploadAll')}
              </button>
            )}
            {running && <button type="button" className="up-btn" onClick={onPause}>{t('q.pause')}</button>}
            {!running && items.some((i) => ['done', 'cancelled', 'error'].includes(i.status)) && (
              <button type="button" className="up-btn small" onClick={onClearDone}>{t('q.clearDone')}</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Overall progress ──────────────────────────────────────
function ProgressCard({ items, running, rate, eta, current, retry, awake, ov }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!retry) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [retry]);
  const live = items.filter((i) => i.status !== 'cancelled' && i.status !== 'error');
  const total = live.reduce((s, i) => s + (i.size || 0), 0);
  const sent = live.reduce((s, i) => s + (i.status === 'done' ? (i.size || 0) : (i.sent || 0)), 0);
  const done = live.filter((i) => i.status === 'done').length;
  const pct = total ? Math.floor((sent / total) * 100) : 0;
  const finished = !running && live.length > 0 && done === live.length;
  const paused = !running && !finished && items.some((i) => i.status === 'paused');
  if (!running && !finished && !paused) return null;

  let retryText = null;
  if (running && retry) {
    const secs = Math.max(0, Math.ceil((retry.until - Date.now()) / 1000));
    retryText = retry.auth ? t('progress.retryingAuth', { n: retry.attempt })
      : secs > 0 ? t('progress.retrying', { s: secs, n: retry.attempt })
      : t('progress.retryingNow', { n: retry.attempt });
  }
  const byId = {};
  for (const a of ov.roster) byId[a.athlete_uuid] = a;

  return (
    <section className="up-card" aria-labelledby="progress-title">
      <h2 id="progress-title">{t('progress.title')}</h2>
      <label className="up-label" htmlFor="progress-bar">{t('progress.label')}</label>
      <progress id="progress-bar" max={100} value={pct} aria-describedby="progress-meta">{pct}%</progress>
      <div id="progress-meta" className="up-progress-meta">
        <span>{pct}%</span>
        <span>{t('progress.overall', { done, files: live.length, sent: fmtBytes(sent), total: fmtBytes(total) })}</span>
        {running && (
          <span>{rate > 0 && eta !== null ? t('progress.speed', { rate: fmtBytes(rate), eta: fmtDuration(eta) }) : t('progress.measuring')}</span>
        )}
      </div>
      {running && current && (
        <p className="up-help">{t('progress.current', { file: current.name || fmtBytes(current.size || 0), name: athleteName(byId[current.athleteUuid]) })}</p>
      )}
      <p className={'up-status' + (finished ? ' done' : '')}>
        {finished ? t('progress.finished') : running ? t('progress.running') : t('progress.paused')}
      </p>
      {retryText && <p className="up-status up-warn">{retryText}</p>}
      {running && awake && <p className="up-help">{t('progress.awake')}</p>}
    </section>
  );
}

// ── Continue an unfinished queue from an earlier visit ────
function RestoreCard({ items, onContinue, onChoose, onDiscard, note }) {
  const need = items.filter((i) => i.status === 'needsFile');
  const inputRef = useRef(null);
  if (!need.length) return null;
  return (
    <section className="up-card" aria-labelledby="restore-title">
      <h2 id="restore-title">{t('restore.title')}</h2>
      <p>{t('restore.body', { n: need.length })}</p>
      {note && <p className={'up-msg ' + note.kind} role="status">{note.text}</p>}
      <div className="up-actions">
        {SUPPORTS_HANDLES && need.some((i) => i.hasHandle) && (
          <button type="button" className="up-btn primary" aria-describedby="restore-continue-help" onClick={onContinue}>
            {t('restore.continue')}
          </button>
        )}
        <button type="button" className="up-btn" aria-describedby="restore-choose-help"
                onClick={() => inputRef.current && inputRef.current.click()}>{t('restore.choose')}</button>
        <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
               onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; onChoose(f); }} />
        <button type="button" className="up-btn danger" onClick={onDiscard}>{t('restore.discard')}</button>
      </div>
      {SUPPORTS_HANDLES && need.some((i) => i.hasHandle) && <span id="restore-continue-help" className="up-help">{t('restore.continueHelp')}</span>}
      <span id="restore-choose-help" className="up-help">{t('restore.chooseHelp')}</span>
    </section>
  );
}

// ── This month's usage ────────────────────────────────────
function MonthCard({ ov }) {
  const prog = ov.program;
  return (
    <section className="up-card" aria-labelledby="month-title">
      <h2 id="month-title">{t('month.title', { month: fmtMonth(ov.period_month) })}</h2>
      {ov.roster.length === 0 ? <p>{t('month.empty')}</p> : (
        <div className="up-table-wrap">
          <table>
            <caption>{t('month.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('col.athlete')}</th>
                <th scope="col">{t('col.performance')}</th>
                <th scope="col">{t('col.video')}</th>
              </tr>
            </thead>
            <tbody>
              {ov.roster.map((a) => (
                <tr key={a.athlete_uuid}>
                  <th scope="row">{athleteName(a)}</th>
                  <td className="num">{t('month.cell', { used: a.perf_used, max: prog.perf_trials_per_month })}</td>
                  <td className="num">{t('month.cell', { used: a.video_used, max: prog.video_clips_per_month })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Recent uploads ────────────────────────────────────────
function UploadsCard({ ov, activeIds, onWithdraw }) {
  const byId = {};
  for (const a of ov.roster) byId[a.athlete_uuid] = a;
  return (
    <section className="up-card" aria-labelledby="uploads-title">
      <h2 id="uploads-title">{t('uploads.title')}</h2>
      {ov.uploads.length === 0 ? <p>{t('uploads.empty')}</p> : (
        <div className="up-table-wrap">
          <table>
            <caption>{t('uploads.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('col.date')}</th>
                <th scope="col">{t('col.athlete')}</th>
                <th scope="col">{t('col.session')}</th>
                <th scope="col">{t('col.status')}</th>
                <th scope="col">{t('col.notes')}</th>
                <th scope="col"><span className="sr-only">{t('col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {ov.uploads.map((u) => {
                const name = athleteName(byId[u.athlete_uuid]);
                const canWithdraw = u.uploaded_by_me && ['uploading', 'received'].includes(u.status) && !activeIds.has(u.upload_uuid);
                const contents = u.session_type === 'performance'
                  ? t('uploads.perf', { s: u.trial_starts || 0, t: u.trial_turns || 0 })
                  : t('uploads.video', { n: u.clip_count || u.trial_count || 0 });
                const notes = [];
                if (u.accepted_count && u.accepted_count !== u.trial_count) notes.push(t('uploads.accepted', { n: u.accepted_count }));
                if (u.recapture_reason) notes.push(t('reason.' + u.recapture_reason));
                if (u.review_note) notes.push(u.review_note);
                return (
                  <tr key={u.upload_uuid}>
                    <td className="num">{fmtDate(u.created_at)}</td>
                    <th scope="row">{name}</th>
                    <td>{t('type.' + u.session_type + '.title')}<div className="up-muted">{contents}</div></td>
                    <td><span className={'up-badge ' + u.status}>{t('status.' + u.status)}</span></td>
                    <td>{notes.join(' · ')}</td>
                    <td>
                      {canWithdraw && (
                        <button type="button" className="up-btn small"
                                aria-label={t('uploads.withdrawLabel', { type: t('type.' + u.session_type), name, date: fmtDate(u.created_at) })}
                                onClick={() => onWithdraw(u)}>
                          {t('uploads.withdraw')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── App ───────────────────────────────────────────────────
function App() {
  const [phase, setPhase] = useState('loading');
  const [email, setEmail] = useState('');
  const [ov, setOv] = useState(null);
  const [items, setItemsState] = useState([]);
  const itemsRef = useRef([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const engineRef = useRef(null);       // { id, engine } for the file in flight
  const [calibration, setCalibration] = useState(false);
  const [problems, setProblems] = useState([]);
  const [rate, setRate] = useState(0);
  const [eta, setEta] = useState(null);
  const [retry, setRetry] = useState(null);
  const [announce, setAnnounce] = useState('');
  const [confirm, setConfirm] = useState(null);   // { kind: 'item', item } | { kind: 'withdraw', upload } | { kind: 'discard' }
  const [restoreNote, setRestoreNote] = useState(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const restoredRef = useRef(false);

  const setItems = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(itemsRef.current) : updater;
    itemsRef.current = next;
    setItemsState(next);
    persistQueue(next);
  }, []);
  const patchItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((i) => (i.id === id ? Object.assign({}, i, patch) : i)));
  }, [setItems]);

  const load = useCallback(async () => {
    try {
      const session = await window.PA_AUTH.getSession();
      if (!session) { setEmail(''); setOv(null); setPhase('signedOut'); return; }
      setEmail((session.user && session.user.email) || '');
      const d = await api('overview', {});
      if (d && d.ok) { setOv(d); setPhase('ready'); return d; }
      const code = d && d.code;
      if (code === 'unauthorized') setPhase('signedOut');
      else if (code === 'not_active_coach') setPhase('notCoach');
      else if (code === 'program_inactive') setPhase('inactive');
      else setPhase('error');
    } catch (_) {
      setPhase('error');
    }
    return null;
  }, []);

  useEffect(() => { load(); }, [load]);

  // Restore an unfinished queue once, after the first overview.
  useEffect(() => {
    if (!ov || restoredRef.current) return;
    restoredRef.current = true;
    const saved = readJson(QUEUE_KEY) || [];
    const legacy = readJson(LEGACY_PENDING_KEY);
    if (legacy && legacy.uploadUuid && !saved.some((s) => s.uploadUuid === legacy.uploadUuid)) {
      saved.push({
        id: 'legacy-' + legacy.uploadUuid.slice(0, 8), athleteUuid: legacy.athleteUuid, type: legacy.type,
        starts: null, turns: null, clips: null, size: legacy.size, lastModified: legacy.lastModified,
        uploadUuid: legacy.uploadUuid, partSize: null,
      });
    }
    writeJson(LEGACY_PENDING_KEY, null);
    const byUpload = {};
    for (const u of ov.uploads) byUpload[u.upload_uuid] = u;
    const restored = [];
    for (const s of saved) {
      if (s.uploadUuid) {
        const u = byUpload[s.uploadUuid];
        if (!u || u.status !== 'uploading') { handleStore.del(s.id); continue; }   // finished, cancelled or expired
        restored.push(Object.assign({}, s, {
          starts: s.starts != null ? s.starts : u.trial_starts, turns: s.turns != null ? s.turns : u.trial_turns,
          clips: s.clips != null ? s.clips : u.clip_count, partSize: s.partSize || u.part_size || LEGACY_PART_SIZE,
          status: 'needsFile', sent: 0,
        }));
      } else {
        restored.push(Object.assign({}, s, { status: 'needsFile', sent: 0 }));
      }
    }
    if (!restored.length) { setItems([]); return; }
    Promise.all(restored.map((r) => handleStore.get(r.id))).then((handles) => {
      setItems(restored.map((r, k) => Object.assign({}, r, { hasHandle: !!handles[k] })));
    });
  }, [ov, setItems]);

  useEffect(() => {
    if (phase !== 'signedOut') return undefined;
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [phase, load]);

  useEffect(() => {
    const sub = window.PA_AUTH.onAuthChange((event) => {
      if (event === 'SIGNED_OUT') { setOv(null); setEmail(''); setPhase('signedOut'); }
    });
    return () => { try { sub.data.subscription.unsubscribe(); } catch (_) { /* older client shape */ } };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const h = (e) => setNarrow(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    const titles = {
      loading: t('state.loading'), signedOut: t('signedOut.title'), notCoach: t('notCoach.title'),
      inactive: t('inactive.title'), error: t('loadError.title'),
      ready: running ? t('progress.title') : t('page.title'),
    };
    document.title = titles[phase] + ' · Peak Athlete';
  }, [phase, running]);

  // Warn before leaving while uploads run.
  useEffect(() => {
    if (!running) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = t('progress.leaveWarning'); return e.returnValue; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [running]);

  // Keep the screen (and on most PCs the computer) awake while uploads run.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    if (!running || !navigator.wakeLock) { setAwake(false); return undefined; }
    let lock = null;
    let stopped = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) { lock.release().catch(() => {}); return; }
        setAwake(true);
        lock.addEventListener('release', () => { if (!stopped) setAwake(false); });
      } catch (_) {
        setAwake(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
      setAwake(false);
    };
  }, [running]);

  // ── Queue editing ──────────────────────────────────────
  function addFiles(athleteUuid, type, entries) {
    const b = budgetFor(ov, athleteUuid, type, itemsRef.current);
    const single = entries.length === 1;
    const fresh = entries.map(({ file, handle }) => {
      const it = {
        id: newId(), athleteUuid, type, name: file.name, size: file.size, lastModified: file.lastModified,
        file, starts: type === 'performance' ? 1 : null, turns: type === 'performance' ? 0 : null,
        clips: type === 'video' ? (single ? Math.max(1, Math.min(b.leftAfterQueue, ov.program.video_clips_per_month)) : 1) : null,
        status: 'ready', sent: 0, hasHandle: !!handle,
      };
      if (handle) handleStore.put(it.id, handle);
      return it;
    });
    setItems((prev) => prev.concat(fresh));
    setProblems([]);
  }

  function removeItem(it) {
    handleStore.del(it.id);
    setItems((prev) => prev.filter((i) => i.id !== it.id));
  }

  function validate() {
    const out = [];
    const list = itemsRef.current.filter((i) => ['ready', 'needsFile', 'paused'].includes(i.status) && !i.uploadUuid);
    for (const i of list) {
      const n = itemUnits(i);
      if (i.type === 'performance' && (n < 1 || n > ov.program.perf_trials_per_month)) {
        out.push((i.name ? i.name + ': ' : '') + t('q.trialsInvalid', { max: ov.program.perf_trials_per_month }));
      }
      if (i.type === 'video' && (n < 1 || n > ov.program.video_clips_per_month)) {
        out.push((i.name ? i.name + ': ' : '') + t('q.clipsInvalid', { max: ov.program.video_clips_per_month }));
      }
    }
    const seen = new Set();
    for (const i of list) {
      const key = i.athleteUuid + '|' + i.type;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = budgetFor(ov, i.athleteUuid, i.type, itemsRef.current);
      if (b.leftAfterQueue < 0) {
        const a = ov.roster.find((x) => x.athlete_uuid === i.athleteUuid);
        out.push(t('q.overBudget', { name: athleteName(a), left: b.left, unit: t(i.type === 'performance' ? 'unit.trials' : 'unit.clips') }));
      }
    }
    if (calibrationNeeded() && !calibration) out.push(t('q.calibrationMissing'));
    return out;
  }
  function calibrationNeeded() {
    return itemsRef.current.some((i) => i.type === 'performance' && !i.uploadUuid
                                        && ['ready', 'needsFile'].includes(i.status));
  }

  // ── Running the queue ──────────────────────────────────
  const samplesRef = useRef([]);
  function trackSpeed() {
    const live = itemsRef.current.filter((i) => i.status !== 'cancelled' && i.status !== 'error');
    const total = live.reduce((s, i) => s + (i.size || 0), 0);
    const sent = live.reduce((s, i) => s + (i.status === 'done' ? (i.size || 0) : (i.sent || 0)), 0);
    const now = Date.now();
    const s = samplesRef.current;
    s.push({ t: now, sent });
    while (s.length > 2 && now - s[0].t > 30000) s.shift();
    const span = (now - s[0].t) / 1000;
    const r = span >= 5 && sent > s[0].sent ? (sent - s[0].sent) / span : 0;
    setRate(r);
    setEta(r > 0 ? (total - sent) / r : null);
  }

  async function runItem(it) {
    // 1. Reserve the upload on the server (first time only).
    let item = it;
    if (!item.uploadUuid) {
      patchItem(item.id, { status: 'starting', error: null });
      let res;
      try {
        res = await api('start', {
          athlete_uuid: item.athleteUuid, session_type: item.type,
          starts: item.type === 'performance' ? item.starts : undefined,
          turns: item.type === 'performance' ? item.turns : undefined,
          clips: item.type === 'video' ? item.clips : undefined,
          calibration: item.type === 'performance' ? calibration : false,
          file_type: fileExt(item.name || ''), file_size: item.size,
        });
      } catch (_) {
        res = { ok: false, code: 'network' };
      }
      if (!res || !res.ok) {
        if (res && res.code === 'network') { patchItem(item.id, { status: 'ready' }); return 'retry-later'; }
        patchItem(item.id, { status: 'error', error: (res && res.code) || 'default', errorExtra: res });
        return 'error';
      }
      item = Object.assign({}, item, { uploadUuid: res.upload_uuid, partSize: res.part_size });
      patchItem(item.id, { uploadUuid: res.upload_uuid, partSize: res.part_size });
    }

    // 2. Send the file; the engine resumes from parts the server already holds.
    return new Promise((resolve) => {
      const engine = window.PA_UPLOADER.createUpload({
        file: item.file, uploadUuid: item.uploadUuid, partSize: item.partSize || LEGACY_PART_SIZE, api,
        refreshAuth: async () => { await window.supabaseClient.auth.refreshSession(); },
        onProgress: (p) => { patchItem(item.id, { sent: p.sent }); trackSpeed(); },
        onRetry: (r) => {
          setRetry((prev) => {
            if (r && !prev) setAnnounce(t('progress.retryAnnounce'));
            if (!r && prev) setAnnounce(t('progress.reconnected'));
            return r ? { attempt: r.attempt, until: Date.now() + r.waitMs, auth: r.reason === 'unauthorized' } : null;
          });
        },
        onState: (s, err) => {
          if (s === 'uploading' || s === 'completing') patchItem(item.id, { status: s });
          if (s === 'done') {
            patchItem(item.id, { status: 'done', sent: item.size, file: null });
            handleStore.del(item.id);
            setAnnounce(t('progress.fileDone', { file: item.name || fmtBytes(item.size) }));
            resolve('done');
          } else if (s === 'paused') {
            patchItem(item.id, { status: 'paused' });
            resolve('paused');
          } else if (s === 'cancelled') {
            patchItem(item.id, { status: 'cancelled', file: null });
            handleStore.del(item.id);
            resolve('cancelled');
          } else if (s === 'error') {
            patchItem(item.id, { status: 'error', error: engineErrorCode(err) });
            resolve('error');
          }
        },
      });
      engineRef.current = { id: item.id, engine };
      engine.run();
    });
  }

  async function runQueue() {
    if (runningRef.current) return;
    const found = validate();
    setProblems(found);
    if (found.length) return;
    runningRef.current = true;
    stopRef.current = false;
    samplesRef.current = [];
    setRunning(true);
    // Paused files go first so they finish before new ones start.
    setItems((prev) => prev.map((i) => (i.status === 'paused' ? Object.assign({}, i, { status: 'ready' }) : i)));
    try {
      let networkStrikes = 0;
      for (;;) {
        if (stopRef.current) break;
        const next = itemsRef.current.find((i) => i.status === 'ready' && i.file);
        if (!next) break;
        const outcome = await runItem(next);
        engineRef.current = null;
        if (outcome === 'paused') break;
        if (outcome === 'retry-later') {
          networkStrikes += 1;
          await new Promise((r) => setTimeout(r, Math.min(60000, 2000 * networkStrikes)));
        } else {
          networkStrikes = 0;
        }
        setRetry(null);
      }
    } finally {
      runningRef.current = false;
      engineRef.current = null;
      setRunning(false);
      setRetry(null);
      load();
    }
  }

  function pauseQueue() {
    stopRef.current = true;
    if (engineRef.current) engineRef.current.engine.pause();
  }

  async function cancelItem(it) {
    if (engineRef.current && engineRef.current.id === it.id) {
      await engineRef.current.engine.cancel();
      return;
    }
    if (it.uploadUuid) {
      try { await api('cancel', { upload_uuid: it.uploadUuid }); } catch (_) { /* list refresh shows the truth */ }
    }
    handleStore.del(it.id);
    patchItem(it.id, { status: 'cancelled', file: null });
    load();
  }

  // ── Restoring after a reload ───────────────────────────
  async function continueWithHandles() {
    let matched = 0;
    for (const it of itemsRef.current.filter((i) => i.status === 'needsFile' && i.hasHandle)) {
      try {
        const h = await handleStore.get(it.id);
        if (!h) continue;
        let perm = h.queryPermission ? await h.queryPermission({ mode: 'read' }) : 'granted';
        if (perm !== 'granted' && h.requestPermission) perm = await h.requestPermission({ mode: 'read' });
        if (perm !== 'granted') continue;
        const f = await h.getFile();
        if (f.size !== it.size || f.lastModified !== it.lastModified) continue;
        patchItem(it.id, { file: f, name: f.name, status: 'ready' });
        matched += 1;
      } catch (_) { /* fall back to choosing the files again */ }
    }
    setRestoreNote(matched ? { kind: 'ok', text: t('restore.matched', { n: matched }) } : null);
  }

  function chooseAgain(files) {
    let matched = 0;
    const used = new Set();
    for (const f of files) {
      const it = itemsRef.current.find((i) => i.status === 'needsFile' && !used.has(i.id)
                                              && i.size === f.size && i.lastModified === f.lastModified);
      if (!it) continue;
      used.add(it.id);
      patchItem(it.id, { file: f, name: f.name, status: 'ready' });
      matched += 1;
    }
    const unmatched = files.length - matched;
    setRestoreNote({
      kind: unmatched ? 'error' : 'ok',
      text: [matched ? t('restore.matched', { n: matched }) : '', unmatched ? t('restore.unmatched', { n: unmatched }) : ''].join(' ').trim(),
    });
  }

  async function confirmYes() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'item') {
      await cancelItem(c.item);
    } else if (c.kind === 'withdraw') {
      try { await api('cancel', { upload_uuid: c.upload.upload_uuid }); } catch (_) { /* refresh shows the truth */ }
      setItems((prev) => prev.filter((i) => i.uploadUuid !== c.upload.upload_uuid));
      load();
    } else if (c.kind === 'discard') {
      for (const it of itemsRef.current.filter((i) => i.status === 'needsFile')) {
        if (it.uploadUuid) { try { await api('cancel', { upload_uuid: it.uploadUuid }); } catch (_) { /* ignore */ } }
        handleStore.del(it.id);
      }
      setItems((prev) => prev.filter((i) => i.status !== 'needsFile'));
      setRestoreNote(null);
      load();
    }
  }

  async function signOut() {
    try { await window.PA_AUTH.signOut(); } catch (_) { /* fall through */ }
    setOv(null);
    setEmail('');
    setPhase('signedOut');
  }

  // ── Render ─────────────────────────────────────────────
  let content;
  if (phase === 'loading') {
    content = (<><h1>{t('page.title')}</h1><p role="status">{t('state.loading')}</p></>);
  } else if (phase === 'signedOut') {
    content = (
      <>
        <h1>{t('signedOut.title')}</h1>
        <p className="up-lede">{t('signedOut.body')}</p>
        <div className="up-actions">
          <a className="up-btn primary" href="../" target="_blank" rel="noopener"
             style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            {t('signedOut.signIn')}<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button type="button" className="up-btn" onClick={load}>{t('signedOut.recheck')}</button>
        </div>
      </>
    );
  } else if (phase === 'notCoach' || phase === 'inactive' || phase === 'error') {
    const key = phase === 'notCoach' ? 'notCoach' : phase === 'inactive' ? 'inactive' : 'loadError';
    content = (
      <>
        <h1>{t(key + '.title')}</h1>
        <p className="up-lede">{t(key + '.body')}</p>
        {phase === 'error' && <button type="button" className="up-btn" onClick={load}>{t('loadError.retry')}</button>}
      </>
    );
  } else {
    const current = engineRef.current ? items.find((i) => i.id === engineRef.current.id) : null;
    const activeIds = new Set(items.filter((i) => i.uploadUuid && !['done', 'cancelled', 'error'].includes(i.status)).map((i) => i.uploadUuid));
    content = (
      <>
        <h1>{t('page.title')}</h1>
        <p className="up-lede">{t('page.lede')}</p>
        {narrow && <div className="up-notice" role="note">{t('narrow')}</div>}
        <div className="up-grid">
          <div>
            <RestoreCard items={items} note={restoreNote} onContinue={continueWithHandles}
                         onChoose={chooseAgain} onDiscard={() => setConfirm({ kind: 'discard' })} />
            <ProgressCard items={items} running={running} rate={rate} eta={eta} current={current}
                          retry={retry} awake={awake} ov={ov} />
            {!running && <AddFiles ov={ov} items={items} onAdd={addFiles} disabled={running} />}
            <QueueCard ov={ov} items={items} running={running} calibration={calibration}
                       setCalibration={setCalibration} problems={problems}
                       onChange={(id, patch) => { patchItem(id, patch); setProblems([]); }}
                       onRemove={removeItem} onCancel={(it) => setConfirm({ kind: 'item', item: it })}
                       onUploadAll={runQueue} onPause={pauseQueue}
                       onClearDone={() => setItems((prev) => prev.filter((i) => !['done', 'cancelled', 'error'].includes(i.status)))} />
          </div>
          <div>
            <MonthCard ov={ov} />
            <UploadsCard ov={ov} activeIds={activeIds} onWithdraw={(u) => setConfirm({ kind: 'withdraw', upload: u })} />
          </div>
        </div>
      </>
    );
  }

  const showSignOut = phase !== 'signedOut' && phase !== 'loading' && !running;
  const dialogTitle = confirm && confirm.kind === 'discard' ? t('discard.title') : t('cancel.title');
  const dialogBody = confirm && confirm.kind === 'discard' ? t('discard.body') : t('cancel.body');

  return (
    <>
      <a className="up-skip" href="#main">{t('skip')}</a>
      <header className="up-header">
        <div className="up-brand">
          <span className="up-brand-name">Peak Athlete</span>
          <span className="up-brand-sub">{t('brand.sub')}</span>
        </div>
        <nav className="up-nav" aria-label="Account">
          {email && <span className="who">{t('nav.signedInAs', { email })}</span>}
          <a href="../">{t('nav.backToLab')}</a>
          {showSignOut && <button type="button" className="up-btn small" onClick={signOut}>{t('nav.signOut')}</button>}
        </nav>
      </header>
      <main id="main" className="up-main" tabIndex={-1}>
        {content}
      </main>
      <footer className="up-footer">
        {t('footer')}
        <span className="up-version">{window.UPLOAD_VERSION}</span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <Dialog open={!!confirm} titleId="confirm-title" title={dialogTitle} onClose={() => setConfirm(null)}>
        <p>{dialogBody}</p>
        <div className="up-actions">
          <button type="button" className="up-btn danger" onClick={confirmYes}>{t('cancel.confirm')}</button>
          <button type="button" className="up-btn" data-autofocus onClick={() => setConfirm(null)}>{t('cancel.keep')}</button>
        </div>
      </Dialog>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
