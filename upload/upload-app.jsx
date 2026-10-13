/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   upload-app.jsx — coach upload page (Phase 4, 2026-10-10)

   Plan: prototype-v03/UPLOAD-CENTER-PLAN.md. All data goes
   through the session-upload edge function; this page never
   queries tables directly and never sees storage keys.

   States: loading -> signedOut | notCoach | inactive | error | ready.
   Ready: upload form (or the active upload's progress), an
   unfinished-upload card when one can be resumed, this month's
   usage per athlete, and uploads from the last 90 days.

   Accessibility (WCAG 2.1 AA target): skip link, landmarks,
   one h1 + h2 per section, native controls with labels, error
   summary that takes focus, aria-live announcements for upload
   progress and state, native <dialog> for confirmations, no
   time limits, corrected muted-text contrast (index.html).
   ─────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useCallback } = React;
const t = window.PA_UPLOAD_T;

const FN_URL = window.PA_AUTH.SUPABASE_URL + '/functions/v1/session-upload';
const PENDING_KEY = 'pa-upload-pending';
const GB = 1024 * 1024 * 1024;

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
function fmtMoney(v) {
  const num = Number(v || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
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
function codeText(code) {
  const key = 'code.' + code;
  const s = t(key);
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
function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; }
}
function writePending(v) {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else localStorage.removeItem(PENDING_KEY);
  } catch (_) { /* storage blocked: resume after reload just won't be offered */ }
}

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

// ── Number stepper (input + labelled -/+ buttons) ─────────
function Stepper({ id, label, value, onChange, max, invalid, describedBy }) {
  const what = label.toLowerCase();
  return (
    <div className="up-stepper">
      <label htmlFor={id}>{label}</label>
      <div className="up-stepper-row">
        <button type="button" className="up-btn square" aria-label={t('form.decrease', { what })}
                aria-controls={id} onClick={() => onChange(value - 1)}>−</button>
        <input id={id} type="number" inputMode="numeric" min={0} max={max} value={value}
               aria-invalid={invalid ? 'true' : undefined} aria-describedby={describedBy}
               onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} />
        <button type="button" className="up-btn square" aria-label={t('form.increase', { what })}
                aria-controls={id} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

// ── Upload form ───────────────────────────────────────────
function UploadForm({ ov, onSubmit }) {
  const prog = ov.program;
  const nTrials = prog.perf_trials_per_session;
  const nClips = prog.video_clips_per_session;

  const [athleteUuid, setAthleteUuid] = useState('');
  const [type, setType] = useState('');
  const [starts, setStarts] = useState(0);
  const [turns, setTurns] = useState(0);
  const [calibration, setCalibration] = useState(false);
  const [clipsOk, setClipsOk] = useState(false);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState([]);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [extraAsk, setExtraAsk] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const summaryRef = useRef(null);

  const athlete = ov.roster.find((a) => a.athlete_uuid === athleteUuid) || null;
  const usage = athlete && type
    ? (type === 'performance'
        ? { used: athlete.perf_used, max: prog.perf_sessions_per_month, price: prog.extra_perf_price_usd }
        : { used: athlete.video_used, max: prog.video_sessions_per_month, price: prog.extra_video_price_usd })
    : null;
  const isExtra = !!usage && usage.used >= usage.max;
  const allTypes = Array.from(new Set([...(prog.perf_file_types || []), ...(prog.video_file_types || [])]));
  const fileTypes = type === 'video' ? prog.video_file_types : type === 'performance' ? prog.perf_file_types : allTypes;
  const typesText = fileTypes.map((x) => '.' + x).join(' or ');
  const clamp = (v) => Math.max(0, Math.min(nTrials, v));
  const bad = (id) => errors.some((e) => e.id === id);

  function validate() {
    const e = [];
    if (!athlete) e.push({ id: 'f-athlete', msg: t('err.athlete') });
    if (!type) e.push({ id: 'f-type-performance', msg: t('err.type') });
    if (type === 'performance') {
      if (starts + turns !== nTrials) e.push({ id: 'f-starts', msg: t('err.trials', { n: nTrials }) });
      if (!calibration) e.push({ id: 'f-calibration', msg: t('err.calibration') });
    }
    if (type === 'video' && !clipsOk) e.push({ id: 'f-clips', msg: t('err.clips', { n: nClips }) });
    if (!file || file.size === 0) {
      e.push({ id: 'f-file', msg: t('err.file') });
    } else {
      if (!fileTypes.includes(fileExt(file.name))) e.push({ id: 'f-file', msg: t('err.fileType', { types: typesText }) });
      if (file.size > prog.max_file_gb * GB) e.push({ id: 'f-file', msg: t('err.fileSize', { max: prog.max_file_gb }) });
    }
    return e;
  }

  async function go(confirmExtra) {
    setBusy(true);
    setServerError('');
    try {
      const res = await onSubmit({
        athleteUuid, athlete, type, starts, turns, calibration,
        clips: type === 'video' && clipsOk ? nClips : null, file,
      }, confirmExtra);
      if (res && res.ok) return;
      if (res && res.code === 'extra_confirmation_required') { setExtraAsk({ price: res.price_usd }); return; }
      setServerError(codeText(res && res.code));
    } catch (_) {
      setServerError(codeText('network'));
    } finally {
      setBusy(false);
    }
  }

  function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    const e = validate();
    setErrors(e);
    if (e.length) {
      setTimeout(() => { if (summaryRef.current) summaryRef.current.focus(); }, 0);
      return;
    }
    if (isExtra) { setExtraAsk({ price: usage.price }); return; }
    go(false);
  }

  function pickFile(f) {
    setFile(f || null);
    setErrors((prev) => prev.filter((x) => x.id !== 'f-file'));
  }

  return (
    <section className="up-card" aria-labelledby="form-title">
      <h2 id="form-title">{t('form.title')}</h2>

      {errors.length > 0 && (
        <div className="up-error-summary" ref={summaryRef} tabIndex={-1} aria-labelledby="err-title">
          <h3 id="err-title">{t('form.errors.title')}</h3>
          <ul>
            {errors.map((e, i) => <li key={i}><a href={'#' + e.id}>{e.msg}</a></li>)}
          </ul>
        </div>
      )}
      {serverError && <p className="up-status error" role="alert">{t('progress.status.error', { reason: serverError })}</p>}

      <form onSubmit={submit} noValidate>
        <div className="up-field">
          <label className="up-label" htmlFor="f-athlete">{t('form.athlete')}</label>
          <select id="f-athlete" value={athleteUuid} aria-describedby="f-athlete-help"
                  aria-invalid={bad('f-athlete') ? 'true' : undefined}
                  onChange={(e) => setAthleteUuid(e.target.value)}>
            <option value="">{t('form.athlete.placeholder')}</option>
            {ov.roster.map((a) => (
              <option key={a.athlete_uuid} value={a.athlete_uuid}>
                {t('form.athlete.option', {
                  name: athleteName(a),
                  p: a.perf_used, pmax: prog.perf_sessions_per_month,
                  v: a.video_used, vmax: prog.video_sessions_per_month,
                })}
              </option>
            ))}
          </select>
          <span id="f-athlete-help" className="up-help">{t('form.athlete.help')}</span>
        </div>

        <fieldset aria-describedby={usage ? 'f-allowance' : undefined}>
          <legend>{t('form.type')}</legend>
          <label className="up-radio">
            <input type="radio" name="f-type" id="f-type-performance" value="performance"
                   checked={type === 'performance'} aria-describedby="f-type-performance-help"
                   aria-invalid={bad('f-type-performance') ? 'true' : undefined}
                   onChange={() => setType('performance')} />
            <span>
              <strong>{t('form.type.performance')}</strong>
              <span id="f-type-performance-help" className="up-help">{t('form.type.performance.help', { n: nTrials })}</span>
            </span>
          </label>
          <label className="up-radio">
            <input type="radio" name="f-type" id="f-type-video" value="video"
                   checked={type === 'video'} aria-describedby="f-type-video-help"
                   aria-invalid={bad('f-type-performance') ? 'true' : undefined}
                   onChange={() => setType('video')} />
            <span>
              <strong>{t('form.type.video')}</strong>
              <span id="f-type-video-help" className="up-help">{t('form.type.video.help', { n: nClips })}</span>
            </span>
          </label>
          {usage && (
            <p id="f-allowance" className={'up-allowance' + (isExtra ? ' extra' : '')}>
              {isExtra
                ? t('form.allowance.extra', { type: t('type.' + type), price: fmtMoney(usage.price) })
                : t('form.allowance.left', { left: usage.max - usage.used, max: usage.max })}
            </p>
          )}
        </fieldset>

        {type === 'performance' && (
          <fieldset>
            <legend>{t('form.contents')}</legend>
            <div className="up-steppers">
              <Stepper id="f-starts" label={t('form.starts')} value={starts} max={nTrials}
                       invalid={bad('f-starts')} describedBy="f-trial-total"
                       onChange={(v) => setStarts(clamp(v))} />
              <Stepper id="f-turns" label={t('form.turns')} value={turns} max={nTrials}
                       invalid={bad('f-starts')} describedBy="f-trial-total"
                       onChange={(v) => setTurns(clamp(v))} />
              <span id="f-trial-total" aria-live="polite"
                    className={'up-total' + (starts + turns === nTrials ? ' ok' : '')}>
                {t('form.trialTotal', { total: starts + turns, n: nTrials })}
              </span>
            </div>
            <div className="up-check" style={{ marginTop: 14 }}>
              <input type="checkbox" id="f-calibration" checked={calibration}
                     aria-invalid={bad('f-calibration') ? 'true' : undefined}
                     aria-describedby="f-calibration-help"
                     onChange={(e) => setCalibration(e.target.checked)} />
              <label htmlFor="f-calibration">
                {t('form.calibration')}
                <span id="f-calibration-help" className="up-help">{t('form.calibration.help')}</span>
              </label>
            </div>
          </fieldset>
        )}

        {type === 'video' && (
          <fieldset>
            <legend>{t('form.contents')}</legend>
            <div className="up-check">
              <input type="checkbox" id="f-clips" checked={clipsOk}
                     aria-invalid={bad('f-clips') ? 'true' : undefined}
                     onChange={(e) => setClipsOk(e.target.checked)} />
              <label htmlFor="f-clips">{t('form.clips', { n: nClips })}</label>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>{t('form.file')}</legend>
          <div className={'up-drop' + (dragOver ? ' over' : '')}
               onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
               onDragLeave={() => setDragOver(false)}
               onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
            <span className="up-file-wrap">
              <input id="f-file" type="file" className="sr-only"
                     accept={fileTypes.map((x) => '.' + x).join(',')}
                     aria-invalid={bad('f-file') ? 'true' : undefined}
                     aria-describedby="f-file-name f-file-help"
                     onChange={(e) => pickFile(e.target.files && e.target.files[0])} />
              <label htmlFor="f-file" className="up-btn">{t('form.file.choose')}</label>
            </span>
            <span aria-hidden="true">{t('form.file.drop')}</span>
            <span id="f-file-name" className="up-file-name">
              {file ? file.name + ', ' + fmtBytes(file.size) : t('form.file.none')}
            </span>
          </div>
          <span id="f-file-help" className="up-help">{t('form.file.help', { types: typesText, max: prog.max_file_gb })}</span>
        </fieldset>

        <div className="up-reminders">
          <h3>{t('form.reminders.title')}</h3>
          <ul>
            <li>{t('form.reminder.oneAthlete')}</li>
            <li>{t('form.reminder.trials', { n: nTrials })}</li>
            <li>{t('form.reminder.clips', { n: nClips })}</li>
            <li>{t('form.reminder.calibration')}</li>
            <li>{t('form.reminder.awake')}</li>
          </ul>
        </div>

        <button type="submit" className="up-btn primary" aria-disabled={busy ? 'true' : undefined}>
          {busy ? t('form.submitting') : t('form.submit')}
        </button>
      </form>

      <Dialog open={!!extraAsk} titleId="extra-title" title={t('extra.title')} onClose={() => setExtraAsk(null)}>
        <p>{extraAsk && t('extra.body', {
          name: athleteName(athlete), type: t('type.' + (type || 'performance')),
          month: fmtMonth(ov.period_month), price: fmtMoney(extraAsk.price),
        })}</p>
        <div className="up-actions">
          <button type="button" className="up-btn primary"
                  onClick={() => { setExtraAsk(null); go(true); }}>
            {extraAsk && t('extra.confirm', { price: fmtMoney(extraAsk.price) })}
          </button>
          <button type="button" className="up-btn" data-autofocus onClick={() => setExtraAsk(null)}>
            {t('extra.cancel')}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

// ── Active upload ─────────────────────────────────────────
function ProgressCard({ job, onPause, onResume, onCancel, onAnother, awake }) {
  const headingRef = useRef(null);
  useEffect(() => { if (headingRef.current) headingRef.current.focus(); }, [job.uploadUuid]);
  // Re-render once a second while a retry countdown is showing.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!job.retry) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [job.retry]);
  let retryText = null;
  if (job.retry && (job.state === 'uploading' || job.state === 'completing')) {
    const secs = Math.max(0, Math.ceil((job.retry.until - Date.now()) / 1000));
    retryText = job.retry.auth
      ? t('progress.retryingAuth', { n: job.retry.attempt })
      : secs > 0
        ? t('progress.retrying', { s: secs, n: job.retry.attempt })
        : t('progress.retryingNow', { n: job.retry.attempt });
  }
  const pct = job.total ? Math.floor((job.sent / job.total) * 100) : 0;
  const s = job.state === 'idle' ? 'uploading' : job.state;
  const statusText = s === 'error'
    ? t('progress.status.error', { reason: codeText(job.error) })
    : t('progress.status.' + s);
  return (
    <section className="up-card" aria-labelledby="progress-title">
      <h2 id="progress-title" tabIndex={-1} ref={headingRef}>{t('progress.title')}</h2>
      <dl className="up-kv">
        <dt>{t('col.athlete')}</dt>
        <dd>{athleteName(job.athlete)}</dd>
        <dt>{t('col.session')}</dt>
        <dd>
          {t('type.' + job.type + '.title')}
          {job.isExtra ? ' · ' + t('progress.extra', { price: fmtMoney(job.price) }) : ''}
        </dd>
        <dt>{t('form.file')}</dt>
        <dd>{job.fileName}</dd>
      </dl>
      <label className="up-label" htmlFor="progress-bar">{t('progress.label')}</label>
      <progress id="progress-bar" max={100} value={pct} aria-describedby="progress-meta">{pct}%</progress>
      <div id="progress-meta" className="up-progress-meta">
        <span>{pct}%</span>
        <span>{t('progress.detail', { sent: fmtBytes(job.sent), total: fmtBytes(job.total) })}</span>
        {s === 'uploading' && (
          <span>
            {job.rate > 0 && job.eta !== null
              ? t('progress.speed', { rate: fmtBytes(job.rate), eta: fmtDuration(job.eta) })
              : t('progress.measuring')}
          </span>
        )}
      </div>
      <p className={'up-status' + (s === 'error' ? ' error' : s === 'done' ? ' done' : '')}>{statusText}</p>
      {retryText && <p className="up-status up-warn">{retryText}</p>}
      {awake && (s === 'uploading' || s === 'completing') && <p className="up-help">{t('progress.awake')}</p>}
      <div className="up-actions">
        {s === 'uploading' && <button type="button" className="up-btn" onClick={onPause}>{t('progress.pause')}</button>}
        {(s === 'paused' || s === 'error') && <button type="button" className="up-btn primary" onClick={onResume}>{t('progress.resume')}</button>}
        {['uploading', 'paused', 'error'].includes(s) && <button type="button" className="up-btn danger" onClick={onCancel}>{t('progress.cancel')}</button>}
        {(s === 'done' || s === 'cancelled') && <button type="button" className="up-btn primary" onClick={onAnother}>{t('progress.another')}</button>}
      </div>
    </section>
  );
}

// ── Unfinished upload from an earlier visit ───────────────
function ResumeCard({ pending, athlete, onFile, onDiscard }) {
  const [err, setErr] = useState('');
  return (
    <section className="up-card" aria-labelledby="resume-title">
      <h2 id="resume-title">{t('resume.title')}</h2>
      <p>{t('resume.body', { name: athleteName(athlete), type: t('type.' + pending.type) })}</p>
      {err && <p className="up-status error" role="alert">{err}</p>}
      <div className="up-actions">
        <span className="up-file-wrap">
          <input id="resume-file" type="file" className="sr-only"
                 onChange={(e) => {
                   const f = e.target.files && e.target.files[0];
                   e.target.value = '';
                   if (!f) return;
                   if (f.size !== pending.size || f.lastModified !== pending.lastModified) {
                     setErr(t('resume.mismatch'));
                     return;
                   }
                   setErr('');
                   onFile(f);
                 }} />
          <label htmlFor="resume-file" className="up-btn primary">{t('resume.choose')}</label>
        </span>
        <button type="button" className="up-btn danger" onClick={onDiscard}>{t('resume.discard')}</button>
      </div>
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
                  <td className="num">{a.perf_used} / {prog.perf_sessions_per_month}</td>
                  <td className="num">{a.video_used} / {prog.video_sessions_per_month}</td>
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
function UploadsCard({ ov, activeUuid, onWithdraw }) {
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
                const canWithdraw = u.uploaded_by_me && ['uploading', 'received'].includes(u.status) && u.upload_uuid !== activeUuid;
                const notes = [];
                if (u.is_extra) notes.push(t('uploads.extra', { price: fmtMoney(u.extra_price_usd) }));
                if (u.recapture_reason) notes.push(t('reason.' + u.recapture_reason));
                if (u.review_note) notes.push(u.review_note);
                return (
                  <tr key={u.upload_uuid}>
                    <td className="num">{fmtDate(u.created_at)}</td>
                    <th scope="row">{name}</th>
                    <td>{t('type.' + u.session_type + '.title')}</td>
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
  const [job, setJob] = useState(null);
  const [pending, setPending] = useState(readPending());
  const [announce, setAnnounce] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'job' } | { kind: 'withdraw', upload } | { kind: 'pending' }
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);

  const load = useCallback(async () => {
    try {
      const session = await window.PA_AUTH.getSession();
      if (!session) { setEmail(''); setOv(null); setPhase('signedOut'); return; }
      setEmail((session.user && session.user.email) || '');
      const d = await api('overview', {});
      if (d && d.ok) { setOv(d); setPhase('ready'); return; }
      const code = d && d.code;
      if (code === 'unauthorized') setPhase('signedOut');
      else if (code === 'not_active_coach') setPhase('notCoach');
      else if (code === 'program_inactive') setPhase('inactive');
      else setPhase('error');
    } catch (_) {
      setPhase('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Signed out: re-check when the coach comes back from the sign-in tab.
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
      ready: job ? t('progress.title') : t('page.title'),
    };
    document.title = titles[phase] + ' · Peak Athlete';
  }, [phase, job]);

  // Warn before leaving while bytes are moving.
  const moving = !!job && ['uploading', 'completing'].includes(job.state);
  useEffect(() => {
    if (!moving) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = t('progress.leaveWarning'); return e.returnValue; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [moving]);

  // Keep the screen (and on most PCs the computer) awake while bytes are moving.
  // Browsers drop the lock when the tab is hidden, so it is taken again on return.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    if (!moving || !navigator.wakeLock) { setAwake(false); return undefined; }
    let lock = null;
    let stopped = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) { lock.release().catch(() => {}); return; }
        setAwake(true);
        lock.addEventListener('release', () => { if (!stopped) setAwake(false); });
      } catch (_) {
        setAwake(false); // not allowed (battery saver, policy): the reminder text still applies
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
  }, [moving]);

  // Drop a remembered upload the server no longer considers in progress.
  useEffect(() => {
    if (!ov || !pending || job) return;
    const u = ov.uploads.find((x) => x.upload_uuid === pending.uploadUuid);
    if (!u || u.status !== 'uploading') { writePending(null); setPending(null); }
  }, [ov, pending, job]);

  const startEngine = useCallback((info) => {
    let lastBucket = 0;
    // Speed over a sliding 30-second window; reset whenever the upload (re)starts.
    let samples = [];
    const engine = window.PA_UPLOADER.createUpload({
      file: info.file, uploadUuid: info.uploadUuid, partSize: info.partSize, api,
      // Uploads can outlive the 1-hour sign-in token; renew it when the server says so.
      refreshAuth: async () => { await window.supabaseClient.auth.refreshSession(); },
      onRetry: (r) => {
        setJob((j) => {
          if (!j || j.uploadUuid !== info.uploadUuid) return j;
          if (r && !j.retry) setAnnounce(t('progress.retryAnnounce'));
          if (!r && j.retry) setAnnounce(t('progress.reconnected'));
          return Object.assign({}, j, {
            retry: r ? { attempt: r.attempt, until: Date.now() + r.waitMs, auth: r.reason === 'unauthorized' } : null,
          });
        });
      },
      onProgress: (p) => {
        const now = Date.now();
        samples.push({ t: now, sent: p.sent });
        while (samples.length > 2 && now - samples[0].t > 30000) samples.shift();
        const first = samples[0];
        const span = (now - first.t) / 1000;
        const rate = span >= 5 && p.sent > first.sent ? (p.sent - first.sent) / span : 0;
        const eta = rate > 0 ? (p.total - p.sent) / rate : null;
        setJob((j) => (j && j.uploadUuid === info.uploadUuid
          ? Object.assign({}, j, { sent: p.sent, total: p.total, rate, eta }) : j));
        const bucket = Math.floor((p.sent / p.total) * 10) * 10;
        if (bucket > lastBucket && bucket < 100) { lastBucket = bucket; setAnnounce(t('progress.announce', { pct: bucket })); }
      },
      onState: (s, err) => {
        if (s === 'uploading') samples = [];
        const code = s === 'error' ? engineErrorCode(err) : null;
        setJob((j) => (j && j.uploadUuid === info.uploadUuid ? Object.assign({}, j, { state: s, error: code }) : j));
        setAnnounce(s === 'error'
          ? t('progress.status.error', { reason: codeText(code) })
          : t('progress.status.' + s));
        if (s === 'done' || s === 'cancelled') { writePending(null); setPending(null); load(); }
      },
    });
    setJob({
      uploadUuid: info.uploadUuid, engine, athlete: info.athlete, type: info.type,
      fileName: info.file.name, total: info.file.size, sent: 0, state: 'idle', error: null,
      isExtra: info.isExtra, price: info.price,
    });
    engine.run();
  }, [load]);

  const submitUpload = useCallback(async (v, confirmExtra) => {
    const res = await api('start', {
      athlete_uuid: v.athleteUuid,
      session_type: v.type,
      starts: v.type === 'performance' ? v.starts : undefined,
      turns: v.type === 'performance' ? v.turns : undefined,
      clips: v.type === 'video' ? v.clips : undefined,
      calibration: v.type === 'performance' ? v.calibration : false,
      confirm_extra: !!confirmExtra,
      file_type: fileExt(v.file.name),
      file_size: v.file.size,
    });
    if (!res || !res.ok) return res;
    const pend = {
      uploadUuid: res.upload_uuid, size: v.file.size, lastModified: v.file.lastModified,
      athleteUuid: v.athleteUuid, type: v.type,
    };
    writePending(pend);
    setPending(pend);
    startEngine({
      uploadUuid: res.upload_uuid, file: v.file, partSize: res.part_size,
      athlete: v.athlete, type: v.type, isExtra: res.is_extra, price: res.price_usd,
    });
    return { ok: true };
  }, [startEngine]);

  async function confirmYes() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'job' && job) {
      await job.engine.cancel();
    } else if (c.kind === 'withdraw') {
      try { await api('cancel', { upload_uuid: c.upload.upload_uuid }); } catch (_) { /* list refresh shows the truth */ }
      if (pending && pending.uploadUuid === c.upload.upload_uuid) { writePending(null); setPending(null); }
      load();
    } else if (c.kind === 'pending' && pending) {
      try { await api('cancel', { upload_uuid: pending.uploadUuid }); } catch (_) { /* list refresh shows the truth */ }
      writePending(null);
      setPending(null);
      load();
    }
  }

  async function signOut() {
    try { await window.PA_AUTH.signOut(); } catch (_) { /* fall through */ }
    setOv(null);
    setEmail('');
    setPhase('signedOut');
  }

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
    const pendingUpload = pending && !job ? ov.uploads.find((x) => x.upload_uuid === pending.uploadUuid && x.status === 'uploading') : null;
    const pendingAthlete = pendingUpload ? ov.roster.find((a) => a.athlete_uuid === pending.athleteUuid) : null;
    content = (
      <>
        <h1>{t('page.title')}</h1>
        {narrow && <div className="up-notice" role="note">{t('narrow')}</div>}
        <div className="up-grid">
          <div>
            {job && (
              <ProgressCard
                job={job}
                awake={awake}
                onPause={() => job.engine.pause()}
                onResume={() => job.engine.resume()}
                onCancel={() => setConfirm({ kind: 'job' })}
                onAnother={() => setJob(null)} />
            )}
            {!job && pendingUpload && (
              <ResumeCard
                pending={pending}
                athlete={pendingAthlete}
                onFile={(f) => startEngine({
                  uploadUuid: pending.uploadUuid, file: f, partSize: ov.part_size,
                  athlete: pendingAthlete, type: pending.type,
                  isExtra: pendingUpload.is_extra, price: pendingUpload.extra_price_usd,
                })}
                onDiscard={() => setConfirm({ kind: 'pending' })} />
            )}
            {!job && <UploadForm ov={ov} onSubmit={submitUpload} />}
          </div>
          <div>
            <MonthCard ov={ov} />
            <UploadsCard ov={ov} activeUuid={job ? job.uploadUuid : null}
                         onWithdraw={(u) => setConfirm({ kind: 'withdraw', upload: u })} />
          </div>
        </div>
      </>
    );
  }

  const showSignOut = phase !== 'signedOut' && phase !== 'loading' && !moving;

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
      <Dialog open={!!confirm} titleId="confirm-title" title={t('cancel.title')} onClose={() => setConfirm(null)}>
        <p>{t('cancel.body')}</p>
        <div className="up-actions">
          <button type="button" className="up-btn danger" onClick={confirmYes}>{t('cancel.confirm')}</button>
          <button type="button" className="up-btn" data-autofocus onClick={() => setConfirm(null)}>{t('cancel.keep')}</button>
        </div>
      </Dialog>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
