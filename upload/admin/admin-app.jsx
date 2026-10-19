/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   admin-app.jsx — Eric's admin tool (Phase 5, 2026-10-10)

   Plan: prototype-v03/UPLOAD-CENTER-PLAN.md.
   Reads: Supabase tables through RLS (admin SELECT policies on
   upload_programs / upload_roster / session_uploads /
   upload_events; super-admin policy on athletes; teams).
   session_uploads is read column by column: the storage key
   columns are not granted to signed-in users.
   Writes: only through the session-upload edge function
   (admin_* actions + cancel), which checks the admin and
   writes the audit log.

   Tabs: Queue · Programs and rosters · Billing · Activity.
   Internal tool, English only.
   ─────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useCallback } = React;
const sb = window.supabaseClient;
const FN_URL = window.PA_AUTH.SUPABASE_URL + '/functions/v1/session-upload';
const GB = 1024 * 1024 * 1024;
const RETENTION_DAYS = 30;   // bucket lifecycle deletes objects 30 days after upload
const CONSENT_REQUIRED = 'v2.0';

const UPLOAD_COLS = 'upload_uuid, program_uuid, team_uuid, athlete_uuid, uploaded_by, session_type, ' +
  'period_month, trial_starts, trial_turns, clip_count, calibration_confirmed, is_extra, ' +
  'extra_price_usd, file_type, file_size_bytes, status, recapture_reason, review_note, ' +
  'created_at, received_at, reviewed_at, cancelled_at, trial_count, accepted_count, ' +
  'original_file_name, duplicate_of, replaces_upload';
// Trials or clips an upload counts for once reviewed.
const countedUnits = (u) => (u.accepted_count != null ? u.accepted_count : u.trial_count) || 0;

const STATUS_LABEL = {
  uploading: 'Not finished', received: 'Awaiting review', accepted: 'Accepted',
  delivered: 'Delivered', recapture: 'Capture again', cancelled: 'Cancelled',
};
// Statuses that count as a used session for billing (re-captures never count).
const BILLED = ['accepted', 'delivered'];
const REASONS = [
  ['no_valid_calibration', 'No valid calibration'],
  ['wrong_trial_count', 'Wrong number of trials'],
  ['wrong_athlete', 'Wrong athlete in the file'],
  ['file_unreadable', 'File could not be opened'],
  ['other', 'Other (explain in the note)'],
];
const REASON_LABEL = Object.fromEntries(REASONS);
const EVENT_LABEL = {
  upload_started: 'Upload started', upload_received: 'Upload received', upload_cancelled: 'Upload cancelled',
  upload_downloaded: 'File downloaded', upload_accepted: 'Accepted', upload_recapture: 'Sent back for re-capture',
  upload_delivered: 'Results delivered',
  roster_added: 'Added to roster', roster_removed: 'Removed from roster', program_saved: 'Program saved',
  report_done: 'Monthly report marked done', report_reopened: 'Monthly report reopened',
};
const CODE_TEXT = {
  forbidden: 'This account is not an admin.',
  not_reviewable: 'This upload is no longer awaiting review.',
  not_deliverable: 'Only accepted uploads can be marked delivered.',
  not_downloadable: 'This file is not available for download.',
  not_allowed: 'This upload can no longer be changed.',
  reason_required: 'Choose a reason.',
  athlete_not_on_team: 'This athlete is not on that team.',
  athlete_not_active: 'This athlete is not an active team member.',
  consent_missing: 'This athlete has not accepted consent ' + CONSENT_REQUIRED + '.',
  not_on_roster: 'This athlete is not on the roster.',
  team_not_found: 'Team not found.',
  program_not_found: 'Create the program first.',
  invalid_value: 'One of the values is out of range.',
  bad_count: 'The accepted count must be between 1 and the number the coach declared.',
  bad_request: 'The request was not valid.',
  unauthorized: 'Your sign-in expired. Sign in again.',
  network: 'The connection failed. Try again.',
};

// ── Helpers ───────────────────────────────────────────────
async function api(action, payload) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if (!token) return { ok: false, code: 'unauthorized' };
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: window.PA_AUTH.SUPABASE_KEY },
      body: JSON.stringify(Object.assign({ action }, payload || {})),
    });
    try { return await res.json(); } catch (_) { return { ok: false, code: 'http_' + res.status }; }
  } catch (_) {
    return { ok: false, code: 'network' };
  }
}
const codeText = (code) => CODE_TEXT[code] || ('Something went wrong (code ' + (code || 'unknown') + ').');
function fmtBytes(n) {
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}
function fmtMoney(v) {
  const num = Number(v || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2, maximumFractionDigits: 2,
  }).format(num);
}
function fmtMonth(period) {
  const p = String(period || '').split('-').map(Number);
  if (!p[0]) return '';
  return new Date(Date.UTC(p[0], p[1] - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function currentMonthKey() {
  // Same boundary as the database: Eastern time.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = parts.find((x) => x.type === 'year').value;
  const m = parts.find((x) => x.type === 'month').value;
  return y + '-' + m + '-01';
}
function athleteName(a) {
  return a ? [a.first_name, a.last_name].filter(Boolean).join(' ') : 'Former athlete';
}
function daysLeft(u) {
  const base = new Date(u.received_at || u.created_at).getTime();
  return RETENTION_DAYS - Math.floor((Date.now() - base) / 86400000);
}
function sessionText(u) {
  const accepted = u.accepted_count != null && u.accepted_count !== u.trial_count
    ? ' · ' + u.accepted_count + ' accepted' : '';
  if (u.session_type === 'performance') {
    return 'Performance · ' + (u.trial_starts || 0) + ' starts, ' + (u.trial_turns || 0) + ' turns' + accepted +
      (u.calibration_confirmed ? '' : ' · calibration not confirmed');
  }
  return 'Video · ' + (u.clip_count || u.trial_count || 0) + ' clips' + accepted;
}
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function loadAll() {
  const res = await Promise.all([
    sb.from('teams').select('team_uuid, team_name, team_code').order('team_name'),
    sb.from('upload_programs').select('*'),
    sb.from('upload_roster').select('*'),
    sb.from('session_uploads').select(UPLOAD_COLS).order('created_at', { ascending: false }).limit(1000),
    sb.from('athletes').select('athlete_uuid, first_name, last_name, athlete_code, team_uuid, membership_status, consent_version, auth_user_id'),
    sb.from('upload_events').select('event_id, occurred_at, actor_role, event_type, program_uuid, upload_uuid, athlete_uuid, details')
      .order('event_id', { ascending: false }).limit(200),
    sb.from('upload_monthly_reports').select('program_uuid, athlete_uuid, period_month, done_at'),
  ]);
  const failed = res.find((r) => r.error);
  if (failed) throw failed.error;
  const [teams, programs, roster, uploads, athletes, events, reports] = res.map((r) => r.data || []);
  const athleteById = {};
  for (const a of athletes) {
    athleteById[a.athlete_uuid] = {
      athlete_uuid: a.athlete_uuid, first_name: a.first_name, last_name: a.last_name,
      athlete_code: a.athlete_code, team_uuid: a.team_uuid, membership_status: a.membership_status,
      consent_version: a.consent_version, has_login: !!a.auth_user_id,
    };
  }
  const teamById = Object.fromEntries(teams.map((t) => [t.team_uuid, t]));
  const programById = Object.fromEntries(programs.map((p) => [p.program_uuid, p]));
  return { teams, programs, roster, uploads, events, reports, athleteById, teamById, programById };
}

// ── Dialog ────────────────────────────────────────────────
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

function Message({ msg }) {
  if (!msg) return <div role="status" aria-live="polite" className="sr-only"></div>;
  return (
    <p className={'up-msg ' + msg.kind} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>
  );
}

// ── Queue ─────────────────────────────────────────────────
// Every upload is sorted into one of four groups so good and failed
// uploads are easy to tell apart (Eric, 2026-10-13).
const STUCK_HOURS = 24;
const VIEWS = [
  ['needs', 'Needs you'],
  ['progress', 'In progress'],
  ['good', 'Good'],
  ['problem', 'Failed or cancelled'],
  ['all', 'All'],
];
function fmtAge(hours) {
  if (hours < 48) return Math.max(1, Math.round(hours)) + ' hours';
  return Math.round(hours / 24) + ' days';
}
function outcomeOf(u) {
  const ageH = (Date.now() - new Date(u.created_at).getTime()) / 3600000;
  switch (u.status) {
    case 'received':
      return { group: 'needs', label: 'Awaiting review', tone: 'received', rank: 0 };
    case 'uploading':
      return ageH > STUCK_HOURS
        ? { group: 'needs', label: 'Stuck for ' + fmtAge(ageH), tone: 'stuck', rank: 1 }
        : { group: 'progress', label: 'In progress', tone: 'uploading', rank: 2 };
    case 'accepted':
      return { group: 'good', label: 'Accepted', tone: 'accepted', rank: 3 };
    case 'delivered':
      return { group: 'good', label: 'Delivered', tone: 'delivered', rank: 4 };
    case 'recapture':
      return { group: 'problem', label: 'Sent back: ' + (REASON_LABEL[u.recapture_reason] || 'see note'), tone: 'recapture', rank: 5 };
    case 'cancelled':
      return u.received_at
        ? { group: 'problem', label: 'Withdrawn after arrival', tone: 'cancelled', rank: 6 }
        : { group: 'problem', label: 'Never finished', tone: 'cancelled', rank: 7 };
    default:
      return { group: 'problem', label: STATUS_LABEL[u.status] || u.status, tone: 'cancelled', rank: 8 };
  }
}

function QueuePanel({ d, reload }) {
  const [view, setView] = useState('needs');
  const [team, setTeam] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [reviewFor, setReviewFor] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasonErr, setReasonErr] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const [acceptFor, setAcceptFor] = useState(null);
  const [acceptCount, setAcceptCount] = useState(1);

  const teamsWithUploads = Array.from(new Set(d.uploads.map((u) => u.team_uuid)))
    .map((id) => d.teamById[id]).filter(Boolean);
  const inTeam = d.uploads.filter((u) => !team || u.team_uuid === team).map((u) => Object.assign({}, u, { _o: outcomeOf(u) }));
  const counts = { all: inTeam.length, needs: 0, progress: 0, good: 0, problem: 0 };
  for (const u of inTeam) counts[u._o.group] += 1;
  const rows = inTeam
    .filter((u) => view === 'all' || u._o.group === view)
    // In "All", problems sink to the bottom; otherwise newest first.
    .sort((x, y) => (view === 'all' && (x._o.group === 'problem') !== (y._o.group === 'problem')
      ? (x._o.group === 'problem' ? 1 : -1)
      : new Date(y.created_at) - new Date(x.created_at)));
  const describe = (u) => athleteName(d.athleteById[u.athlete_uuid]) + ', ' + u.session_type + ', ' + fmtDate(u.created_at);
  const byUuid = {};
  for (const u of d.uploads) byUuid[u.upload_uuid] = u;
  // Short pointer to another upload ("Lismar Lyon, 13 Oct, Accepted").
  const pointTo = (id) => {
    const o = byUuid[id];
    if (!o) return 'an older upload';
    return athleteName(d.athleteById[o.athlete_uuid]) + ', ' + fmtDate(o.created_at) + ', ' + outcomeOf(o).label;
  };
  const replacedBy = {};
  for (const u of d.uploads) if (u.replaces_upload) replacedBy[u.replaces_upload] = u.upload_uuid;

  async function run(u, action, payload, okText) {
    setBusy(u.upload_uuid + action);
    const r = await api(action, Object.assign({ upload_uuid: u.upload_uuid }, payload || {}));
    setBusy('');
    if (r.ok) { setMsg({ kind: 'ok', text: okText(r) }); await reload(); }
    else setMsg({ kind: 'error', text: codeText(r.code) });
    return r;
  }

  async function download(u) {
    const r = await run(u, 'admin_download', null, (res) => 'Download started: ' + res.filename +
      '. Save it to a local folder that is not synced to OneDrive or any other cloud storage (for example C:\\PeakAthleteInbox), ' +
      'scan it with Windows Defender before opening it in Templo, and delete it once the import is done. ' +
      'The download link works for 3 hours.');
    if (r.ok) {
      const a = document.createElement('a');
      a.href = r.url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  async function sendRecapture() {
    if (!reason) { setReasonErr(true); return; }
    const u = reviewFor;
    setReviewFor(null);
    await run(u, 'admin_review', { decision: 'recapture', reason, note }, () => 'Sent back for re-capture: ' + describe(u) + '.');
  }

  return (
    <>
      <Message msg={msg} />
      <div className="up-chips" role="group" aria-label="Show uploads">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" className={'up-chip ' + k} aria-pressed={view === k ? 'true' : 'false'}
                  onClick={() => setView(k)}>
            {label} <span className="up-chip-n">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="up-toolbar">
        <div className="up-field">
          <label className="up-label" htmlFor="q-team">Team</label>
          <select id="q-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teamsWithUploads.map((t) => <option key={t.team_uuid} value={t.team_uuid}>{t.team_name}</option>)}
          </select>
        </div>
        <button type="button" className="up-btn small" onClick={reload}>Refresh</button>
      </div>

      {rows.length === 0 ? (
        <p className="up-muted">{view === 'needs' ? 'Nothing needs you right now.' : 'No uploads in this group.'}</p>
      ) : (
        <div className="up-table-wrap">
          <table>
            <caption>{rows.length} upload{rows.length === 1 ? '' : 's'}. Files are deleted {RETENTION_DAYS} days after upload.</caption>
            <thead>
              <tr>
                <th scope="col">Uploaded</th>
                <th scope="col">Team</th>
                <th scope="col">Athlete</th>
                <th scope="col">Session</th>
                <th scope="col">Size</th>
                <th scope="col">Status</th>
                <th scope="col">File deleted in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const a = d.athleteById[u.athlete_uuid];
                const left = daysLeft(u);
                const hasFile = ['received', 'accepted', 'delivered', 'recapture'].includes(u.status);
                return (
                  <tr key={u.upload_uuid}>
                    <td className="num">{fmtDate(u.created_at)}</td>
                    <td>{(d.teamById[u.team_uuid] || {}).team_name || '—'}</td>
                    <th scope="row">{athleteName(a)}{a && a.athlete_code ? <span className="up-muted"> ({a.athlete_code})</span> : null}</th>
                    <td>
                      {sessionText(u)}
                      {u.is_extra ? <div className="up-warn">Extra, {fmtMoney(u.extra_price_usd)}</div> : null}
                      {u.recapture_reason ? <div className="up-muted">{REASON_LABEL[u.recapture_reason]}{u.review_note ? ': ' + u.review_note : ''}</div> : null}
                      {u.original_file_name ? <div className="up-file-name">{u.original_file_name}</div> : null}
                      {u.duplicate_of ? <div className="up-warn">Possible duplicate: coach uploaded anyway. Same file as {pointTo(u.duplicate_of)}.</div> : null}
                      {u.replaces_upload ? <div className="up-muted">Replaces {pointTo(u.replaces_upload)}.</div> : null}
                      {replacedBy[u.upload_uuid] ? <div className="up-muted">Replaced by {pointTo(replacedBy[u.upload_uuid])}.</div> : null}
                    </td>
                    <td className="num">{fmtBytes(u.file_size_bytes)}</td>
                    <td><span className={'up-badge ' + u._o.tone}>{u._o.label}</span></td>
                    <td className={'num' + (hasFile && left <= 7 ? ' up-warn' : '')}>
                      {hasFile ? (left > 0 ? left + (left === 1 ? ' day' : ' days') : 'Deleted') : '—'}
                    </td>
                    <td>
                      <div className="up-row-actions">
                        {hasFile && left > 0 && (
                          <button type="button" className="up-btn small" aria-label={'Download ' + describe(u)}
                                  aria-disabled={busy ? 'true' : undefined} onClick={() => !busy && download(u)}>Download</button>
                        )}
                        {u.status === 'received' && (
                          <>
                            <button type="button" className="up-btn small primary" aria-label={'Accept ' + describe(u)}
                                    aria-disabled={busy ? 'true' : undefined}
                                    onClick={() => {
                                      if (busy) return;
                                      if ((u.trial_count || 1) > 1) { setAcceptCount(u.trial_count); setAcceptFor(u); return; }
                                      run(u, 'admin_review', { decision: 'accepted', count: 1 }, () => 'Accepted: ' + describe(u) + '.');
                                    }}>Accept</button>
                            <button type="button" className="up-btn small" aria-label={'Send back for re-capture: ' + describe(u)}
                                    onClick={() => { setReason(''); setNote(''); setReasonErr(false); setReviewFor(u); }}>Re-capture</button>
                          </>
                        )}
                        {u.status === 'accepted' && (
                          <button type="button" className="up-btn small primary"
                                  aria-label={'Mark results delivered: ' + describe(u)}
                                  aria-disabled={busy ? 'true' : undefined}
                                  onClick={() => !busy && run(u, 'admin_deliver', null, () => 'Marked delivered: ' + describe(u) + '. The coach now sees the results as available.')}>Mark delivered</button>
                        )}
                        {['uploading', 'received'].includes(u.status) && (
                          <button type="button" className="up-btn small danger" aria-label={'Cancel ' + describe(u)}
                                  onClick={() => setCancelFor(u)}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!reviewFor} titleId="recap-title" title="Send back for re-capture" onClose={() => setReviewFor(null)}>
        <p className="up-muted">{reviewFor && describe(reviewFor)}. Its trials go back to the athlete's month. The coach sees the reason and the note.</p>
        <div className="up-field">
          <label className="up-label" htmlFor="recap-reason">Reason</label>
          <select id="recap-reason" value={reason} data-autofocus aria-invalid={reasonErr ? 'true' : undefined}
                  aria-describedby={reasonErr ? 'recap-reason-err' : undefined}
                  onChange={(e) => { setReason(e.target.value); setReasonErr(false); }}>
            <option value="">Choose a reason</option>
            {REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {reasonErr && <span id="recap-reason-err" className="up-help up-warn">Choose a reason.</span>}
        </div>
        <div className="up-field">
          <label className="up-label" htmlFor="recap-note">Note to the coach (optional)</label>
          <textarea id="recap-note" maxLength={500} value={note} aria-describedby="recap-note-help" onChange={(e) => setNote(e.target.value)} />
          <span id="recap-note-help" className="up-help">{500 - note.length} characters left. Do not include other athletes' information.</span>
        </div>
        <div className="up-actions">
          <button type="button" className="up-btn primary" onClick={sendRecapture}>Send back</button>
          <button type="button" className="up-btn" onClick={() => setReviewFor(null)}>Go back</button>
        </div>
      </Dialog>

      <Dialog open={!!acceptFor} titleId="accept-title" title="Accept this upload" onClose={() => setAcceptFor(null)}>
        <p className="up-muted">
          {acceptFor && describe(acceptFor)}. The coach declared {acceptFor ? acceptFor.trial_count : 0}{' '}
          {acceptFor && acceptFor.session_type === 'video' ? 'clips' : 'trials'}. Lower the number if some are not usable;
          the rest go back to the athlete's month.
        </p>
        <div className="up-field">
          <label className="up-label" htmlFor="accept-count">
            {acceptFor && acceptFor.session_type === 'video' ? 'Clips accepted' : 'Trials accepted'}
          </label>
          <input type="number" id="accept-count" data-autofocus min={1} max={acceptFor ? acceptFor.trial_count : 1}
                 value={acceptCount} onChange={(e) => setAcceptCount(parseInt(e.target.value, 10) || 1)} />
        </div>
        <div className="up-actions">
          <button type="button" className="up-btn primary"
                  onClick={() => {
                    const u = acceptFor;
                    const n = Math.max(1, Math.min(u.trial_count, acceptCount));
                    setAcceptFor(null);
                    run(u, 'admin_review', { decision: 'accepted', count: n },
                        () => 'Accepted ' + n + ' of ' + u.trial_count + ': ' + describe(u) + '.');
                  }}>Accept</button>
          <button type="button" className="up-btn" onClick={() => setAcceptFor(null)}>Go back</button>
        </div>
      </Dialog>

      <Dialog open={!!cancelFor} titleId="cancel-title" title="Cancel this upload?" onClose={() => setCancelFor(null)}>
        <p>{cancelFor && describe(cancelFor)}. The file is deleted and its trials go back to the athlete's month.</p>
        <div className="up-actions">
          <button type="button" className="up-btn danger"
                  onClick={() => { const u = cancelFor; setCancelFor(null); run(u, 'cancel', null, () => 'Cancelled: ' + describe(u) + '.'); }}>Cancel upload</button>
          <button type="button" className="up-btn" data-autofocus onClick={() => setCancelFor(null)}>Keep it</button>
        </div>
      </Dialog>
    </>
  );
}

// ── Programs and rosters ──────────────────────────────────
const BLANK_PROGRAM = {
  active: false, tier_label: '', roster_cap: '',
  perf_sessions_per_month: 1, video_sessions_per_month: 1,
  perf_trials_per_session: 4, video_clips_per_session: 5,
  // No default prices in this public file: entered per program (Eric, 2026-10-13).
  extra_perf_price_usd: '', extra_video_price_usd: '', max_file_gb: 50,
};
// Monthly budgets (perf_trials_per_month, video_clips_per_month) are shown
// read-only until upload_program_save accepts them; extras are on hold.
const NUM_FIELDS = [
  ['roster_cap', 'Roster cap (athletes)', 'Leave empty for no cap. Over-cap adds show a warning.'],
  ['extra_perf_price_usd', 'Extra block, 4 performance trials (USD)', 'Extra blocks are not sold yet; stored for later.'],
  ['extra_video_price_usd', 'Extra block, 5 video clips (USD)'],
  ['max_file_gb', 'Largest file (GB)'],
];

function ProgramsPanel({ d, reload }) {
  const firstProgramTeam = d.programs[0] ? d.programs[0].team_uuid : '';
  const [teamUuid, setTeamUuid] = useState(firstProgramTeam);
  const [form, setForm] = useState(BLANK_PROGRAM);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const prog = d.programs.find((p) => p.team_uuid === teamUuid) || null;
  const progKey = prog ? prog.program_uuid + prog.updated_at : 'none:' + teamUuid;

  useEffect(() => {
    setForm(prog ? {
      active: prog.active, tier_label: prog.tier_label || '', roster_cap: prog.roster_cap === null ? '' : prog.roster_cap,
      perf_sessions_per_month: prog.perf_sessions_per_month, video_sessions_per_month: prog.video_sessions_per_month,
      perf_trials_per_session: prog.perf_trials_per_session, video_clips_per_session: prog.video_clips_per_session,
      extra_perf_price_usd: Number(prog.extra_perf_price_usd), extra_video_price_usd: Number(prog.extra_video_price_usd),
      max_file_gb: prog.max_file_gb,
    } : BLANK_PROGRAM);
  }, [progKey]);

  const teamAthletes = Object.values(d.athleteById)
    .filter((a) => a.team_uuid === teamUuid)
    .sort((x, y) => athleteName(x).localeCompare(athleteName(y)));
  const rosterRows = prog ? d.roster.filter((r) => r.program_uuid === prog.program_uuid) : [];
  const onRoster = (id) => rosterRows.some((r) => r.athlete_uuid === id && r.active);
  const rosterCount = rosterRows.filter((r) => r.active).length;

  async function save(e) {
    e.preventDefault();
    if (!teamUuid) return;
    const num = (v) => (v === '' || v === null ? null : Number(v));
    if (num(form.extra_perf_price_usd) === null || num(form.extra_video_price_usd) === null) {
      setMsg({ kind: 'error', text: 'Enter both extra block prices.' });
      return;
    }
    setBusy(true);
    const r = await api('admin_program_save', {
      team_uuid: teamUuid, active: !!form.active, tier_label: form.tier_label,
      roster_cap: form.roster_cap === '' ? null : parseInt(form.roster_cap, 10),
      perf_sessions_per_month: parseInt(form.perf_sessions_per_month, 10),
      video_sessions_per_month: parseInt(form.video_sessions_per_month, 10),
      perf_trials_per_session: parseInt(form.perf_trials_per_session, 10),
      video_clips_per_session: parseInt(form.video_clips_per_session, 10),
      extra_perf_price_usd: num(form.extra_perf_price_usd),
      extra_video_price_usd: num(form.extra_video_price_usd),
      max_file_gb: parseInt(form.max_file_gb, 10),
    });
    setBusy(false);
    if (r.ok) { setMsg({ kind: 'ok', text: 'Program saved.' }); await reload(); }
    else setMsg({ kind: 'error', text: codeText(r.code) });
  }

  async function toggle(a, active) {
    setBusy(true);
    const r = await api('admin_roster_set', { program_uuid: prog.program_uuid, athlete_uuid: a.athlete_uuid, active });
    setBusy(false);
    if (r.ok) {
      setMsg({
        kind: 'ok',
        text: (active ? 'Added ' : 'Removed ') + athleteName(a) + '. Roster: ' + r.roster_count + (r.over_cap ? '. This is over the roster cap: check the tier.' : '.'),
      });
      await reload();
    } else setMsg({ kind: 'error', text: codeText(r.code) });
  }

  function blocker(a) {
    if (!a.has_login) return 'No account yet';
    if (a.membership_status !== 'active') return 'Membership ' + (a.membership_status || 'unknown');
    if (a.consent_version !== CONSENT_REQUIRED) return 'Consent ' + (a.consent_version || 'none') + ', needs ' + CONSENT_REQUIRED;
    return null;
  }

  return (
    <>
      <Message msg={msg} />
      <div className="up-toolbar">
        <div className="up-field">
          <label className="up-label" htmlFor="p-team">Team</label>
          <select id="p-team" value={teamUuid} onChange={(e) => { setTeamUuid(e.target.value); setMsg(null); }}>
            <option value="">Choose a team</option>
            {d.teams.map((t) => {
              const p = d.programs.find((x) => x.team_uuid === t.team_uuid);
              return <option key={t.team_uuid} value={t.team_uuid}>{t.team_name}{p ? (p.active ? ' (program active)' : ' (program off)') : ''}</option>;
            })}
          </select>
        </div>
      </div>

      {teamUuid && (
        <div className="up-grid">
          <section className="up-card" aria-labelledby="prog-title">
            <h2 id="prog-title">{prog ? 'Program settings' : 'Create a program'}</h2>
            <form onSubmit={save}>
              <div className="up-check up-field">
                <input type="checkbox" id="p-active" checked={!!form.active}
                       onChange={(e) => setForm(Object.assign({}, form, { active: e.target.checked }))} />
                <label htmlFor="p-active">Uploads active for this team</label>
              </div>
              <div className="up-field">
                <label className="up-label" htmlFor="p-tier">Tier label</label>
                <input type="text" id="p-tier" maxLength={40} value={form.tier_label}
                       onChange={(e) => setForm(Object.assign({}, form, { tier_label: e.target.value }))} />
              </div>
              {prog && (
                <p className="up-muted">
                  Monthly allowance per athlete: {prog.perf_trials_per_month} performance trials and{' '}
                  {prog.video_clips_per_month} video clips, in any number of uploads. (Changed in the database for now.)
                </p>
              )}
              <div className="up-form-grid">
                {NUM_FIELDS.map(([key, label, help]) => (
                  <div key={key}>
                    <label className="up-label" htmlFor={'p-' + key}>{label}</label>
                    <input type="number" id={'p-' + key} min={0} step={key.includes('usd') ? '0.01' : '1'}
                           value={form[key]} aria-describedby={help ? 'p-' + key + '-help' : undefined}
                           onChange={(e) => setForm(Object.assign({}, form, { [key]: e.target.value }))} />
                    {help && <span id={'p-' + key + '-help'} className="up-help">{help}</span>}
                  </div>
                ))}
              </div>
              <div className="up-actions">
                <button type="submit" className="up-btn primary" aria-disabled={busy ? 'true' : undefined}>
                  {prog ? 'Save program' : 'Create program'}
                </button>
              </div>
            </form>
          </section>

          <section className="up-card" aria-labelledby="roster-title">
            <h2 id="roster-title">Roster</h2>
            {!prog ? <p className="up-muted">Create the program first, then add athletes.</p> : (
              <>
                <p className="up-muted">
                  {rosterCount} on the roster{prog.roster_cap ? ' of a cap of ' + prog.roster_cap : ''}.
                  {prog.roster_cap && rosterCount > prog.roster_cap ? <span className="up-warn"> Over the cap.</span> : null}
                  {' '}Only athletes with an account, active membership and consent {CONSENT_REQUIRED} can be added.
                </p>
                {teamAthletes.length === 0 ? <p>No athletes on this team.</p> : (
                  <div className="up-table-wrap">
                    <table>
                      <caption>Athletes on this team</caption>
                      <thead>
                        <tr>
                          <th scope="col">Athlete</th>
                          <th scope="col">Code</th>
                          <th scope="col">Roster</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamAthletes.map((a) => {
                          const on = onRoster(a.athlete_uuid);
                          const why = blocker(a);
                          return (
                            <tr key={a.athlete_uuid}>
                              <th scope="row">{athleteName(a)}</th>
                              <td className="num">{a.athlete_code || '—'}</td>
                              <td>
                                {on ? (
                                  <button type="button" className="up-btn small danger" aria-label={'Remove ' + athleteName(a) + ' from the roster'}
                                          aria-disabled={busy ? 'true' : undefined} onClick={() => !busy && toggle(a, false)}>Remove</button>
                                ) : why ? (
                                  <span className="up-muted">{why}</span>
                                ) : (
                                  <button type="button" className="up-btn small" aria-label={'Add ' + athleteName(a) + ' to the roster'}
                                          aria-disabled={busy ? 'true' : undefined} onClick={() => !busy && toggle(a, true)}>Add</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

// ── Monthly: trials per athlete + reports checklist ───────
// Counts accepted and delivered uploads at their accepted count. Extras
// (blocks) are on hold until the upload procedure is proven (Eric 2026-10-13).
function monthlyFor(d, month) {
  const out = [];
  for (const prog of d.programs) {
    const team = d.teamById[prog.team_uuid] || { team_name: 'Unknown team' };
    const ups = d.uploads.filter((u) => u.program_uuid === prog.program_uuid && u.period_month === month);
    const ids = new Set(d.roster.filter((r) => r.program_uuid === prog.program_uuid && r.active).map((r) => r.athlete_uuid));
    for (const u of ups) if (u.athlete_uuid) ids.add(u.athlete_uuid);
    const rows = [];
    for (const id of ids) {
      const mine = ups.filter((u) => u.athlete_uuid === id);
      const sum = (type, statuses) => mine
        .filter((u) => u.session_type === type && statuses.includes(u.status))
        .reduce((s, u) => s + (statuses === BILLED ? countedUnits(u) : (u.trial_count || 0)), 0);
      const perf = sum('performance', BILLED);
      const video = sum('video', BILLED);
      const pending = sum('performance', ['received']) + sum('video', ['received']);
      const report = d.reports.find((r) => r.program_uuid === prog.program_uuid && r.athlete_uuid === id && r.period_month === month);
      rows.push({ athlete: d.athleteById[id], athleteUuid: id, perf, video, pending, reportDone: !!report });
    }
    rows.sort((x, y) => athleteName(x.athlete).localeCompare(athleteName(y.athlete)));
    out.push({ prog, team, rows });
  }
  return out.sort((x, y) => x.team.team_name.localeCompare(y.team.team_name));
}

function BillingPanel({ d, reload }) {
  const cur = currentMonthKey();
  const months = Array.from(new Set([cur, ...d.uploads.map((u) => u.period_month)])).sort().reverse();
  const [month, setMonth] = useState(cur);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const groups = monthlyFor(d, month);
  const due = groups.reduce((s, g) => s + g.rows.filter((r) => (r.perf || r.video) && !r.reportDone).length, 0);

  async function setReport(g, r, done) {
    setBusy(r.athleteUuid);
    const res = await api('admin_report_set', {
      program_uuid: g.prog.program_uuid, athlete_uuid: r.athleteUuid, month, done,
    });
    setBusy('');
    if (res.ok) {
      setMsg({ kind: 'ok', text: (done ? 'Report marked done: ' : 'Report reopened: ') + athleteName(r.athlete) + ', ' + fmtMonth(month) + '.' });
      await reload();
    } else {
      setMsg({ kind: 'error', text: codeText(res.code) });
    }
  }

  function exportCsv() {
    const lines = [['month', 'team', 'tier', 'athlete_code', 'athlete', 'performance_trials', 'video_clips',
      'awaiting_review', 'report_done'].join(',')];
    for (const g of groups) {
      for (const r of g.rows) {
        lines.push([month.slice(0, 7), g.team.team_name, g.prog.tier_label || '', r.athlete ? r.athlete.athlete_code : '',
          athleteName(r.athlete), r.perf, r.video, r.pending, r.reportDone ? 'yes' : 'no'].map(csvCell).join(','));
      }
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'upload-monthly-' + month.slice(0, 7) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <Message msg={msg} />
      <div className="up-toolbar">
        <div className="up-field">
          <label className="up-label" htmlFor="b-month">Month</label>
          <select id="b-month" value={month} onChange={(e) => { setMonth(e.target.value); setMsg(null); }}>
            {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
        </div>
        <button type="button" className="up-btn small" onClick={exportCsv}>Export CSV</button>
      </div>
      <p className="up-muted">
        Accepted and delivered uploads count at their accepted number of trials or clips. One report and coach debrief per
        athlete per month, at month end. {due ? <strong className="up-warn">{due} report{due === 1 ? '' : 's'} due for {fmtMonth(month)}.</strong> : null}
        {' '}The CSV contains athlete names: store it with the business records, not in shared folders.
      </p>
      {groups.length === 0 ? <p>No programs yet.</p> : groups.map((g) => {
        const tot = g.rows.reduce((s, r) => ({ perf: s.perf + r.perf, video: s.video + r.video, pending: s.pending + r.pending }),
          { perf: 0, video: 0, pending: 0 });
        return (
          <section className="up-card" key={g.prog.program_uuid} aria-labelledby={'bill-' + g.prog.program_uuid}>
            <h2 id={'bill-' + g.prog.program_uuid}>{g.team.team_name}</h2>
            <p className="up-muted">
              {g.prog.tier_label || 'No tier label'} · {g.prog.active ? 'active' : 'off'} · allowance {g.prog.perf_trials_per_month} trials
              {' '}+ {g.prog.video_clips_per_month} clips per athlete per month
              {tot.pending ? <span className="up-warn"> · {tot.pending} awaiting review, not counted yet</span> : null}
            </p>
            <div className="up-table-wrap">
              <table>
                <caption>{fmtMonth(month)}: accepted trials and clips, and monthly reports</caption>
                <thead>
                  <tr>
                    <th scope="col">Athlete</th>
                    <th scope="col">Performance trials</th>
                    <th scope="col">Video clips</th>
                    <th scope="col">Awaiting review</th>
                    <th scope="col">Monthly report</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => {
                    const hasWork = r.perf > 0 || r.video > 0;
                    const boxId = 'rep-' + g.prog.program_uuid + '-' + r.athleteUuid;
                    return (
                      <tr key={r.athleteUuid || i}>
                        <th scope="row">{athleteName(r.athlete)}</th>
                        <td className="num">{r.perf} of {g.prog.perf_trials_per_month}</td>
                        <td className="num">{r.video} of {g.prog.video_clips_per_month}</td>
                        <td className="num">{r.pending || '—'}</td>
                        <td>
                          {hasWork || r.reportDone ? (
                            <span className="up-check">
                              <input type="checkbox" id={boxId} checked={r.reportDone}
                                     aria-disabled={busy ? 'true' : undefined}
                                     onChange={(e) => { if (!busy) setReport(g, r, e.target.checked); }} />
                              <label htmlFor={boxId}>{r.reportDone ? 'Done' : 'Due'}<span className="sr-only"> for {athleteName(r.athlete)}</span></label>
                            </span>
                          ) : <span className="up-muted">No trials yet</span>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row">Total</th>
                    <td className="num">{tot.perf}</td>
                    <td className="num">{tot.video}</td>
                    <td className="num">{tot.pending || '—'}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

// ── Activity (audit log) ──────────────────────────────────
function eventDetail(e) {
  const x = e.details || {};
  const parts = [];
  if (x.session_type) parts.push(x.session_type);
  if (x.is_extra) parts.push('extra');
  if (x.reason) parts.push(REASON_LABEL[x.reason] || x.reason);
  if (x.previous_status) parts.push('was ' + (STATUS_LABEL[x.previous_status] || x.previous_status).toLowerCase());
  if (x.file_size_bytes) parts.push(fmtBytes(x.file_size_bytes));
  if (e.event_type === 'program_saved') {
    parts.push((x.active ? 'active' : 'off') + (x.tier_label ? ', ' + x.tier_label : ''));
  }
  return parts.join(' · ');
}

function ActivityPanel({ d }) {
  return d.events.length === 0 ? <p className="up-muted">No activity yet.</p> : (
    <div className="up-table-wrap">
      <table>
        <caption>Latest {d.events.length} events from the audit log (kept at least 12 months, cannot be edited)</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Event</th>
            <th scope="col">By</th>
            <th scope="col">Team</th>
            <th scope="col">Athlete</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {d.events.map((e) => {
            const prog = d.programById[e.program_uuid];
            const team = prog ? d.teamById[prog.team_uuid] : null;
            return (
              <tr key={e.event_id}>
                <td className="num">{fmtDateTime(e.occurred_at)}</td>
                <th scope="row">{EVENT_LABEL[e.event_type] || e.event_type}</th>
                <td>{e.actor_role === 'admin' ? 'Admin' : e.actor_role === 'coach' ? 'Coach' : 'System'}</td>
                <td>{team ? team.team_name : '—'}</td>
                <td>{e.athlete_uuid ? athleteName(d.athleteById[e.athlete_uuid]) : '—'}</td>
                <td>{eventDetail(e)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────
const TABS = [['queue', 'Queue'], ['programs', 'Programs and rosters'], ['billing', 'Monthly and reports'], ['activity', 'Activity']];

function Tabs({ tab, setTab, waiting }) {
  const refs = useRef({});
  function onKey(e, i) {
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = TABS.length - 1;
    if (j !== null) {
      e.preventDefault();
      setTab(TABS[j][0]);
      if (refs.current[TABS[j][0]]) refs.current[TABS[j][0]].focus();
    }
  }
  return (
    <div role="tablist" aria-label="Admin sections" className="up-tabs">
      {TABS.map(([id, label], i) => (
        <button key={id} type="button" role="tab" id={'tab-' + id} className="up-tab"
                ref={(el) => { refs.current[id] = el; }}
                aria-selected={tab === id ? 'true' : 'false'} aria-controls={'panel-' + id}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)} onKeyDown={(e) => onKey(e, i)}>
          {label}{id === 'queue' && waiting ? ' (' + waiting + ' waiting)' : ''}
        </button>
      ))}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────
function App() {
  const [phase, setPhase] = useState('loading');
  const [email, setEmail] = useState('');
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('queue');

  const reload = useCallback(async () => {
    try {
      const data = await loadAll();
      setD(data);
      setPhase('ready');
    } catch (_) {
      setPhase('error');
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const session = await window.PA_AUTH.getSession();
      if (!session) { setPhase('signedOut'); return; }
      setEmail((session.user && session.user.email) || '');
      const { data, error } = await sb.rpc('is_admin');
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row || !(row.is_race_admin || row.is_super_admin)) { setPhase('notAdmin'); return; }
      await reload();
    } catch (_) {
      setPhase('error');
    }
  }, [reload]);

  useEffect(() => { start(); }, [start]);

  useEffect(() => {
    if (phase !== 'signedOut') return undefined;
    const onFocus = () => start();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [phase, start]);

  useEffect(() => {
    const label = TABS.find((x) => x[0] === tab)[1];
    document.title = (phase === 'ready' ? label + ' · ' : '') + 'Upload admin · Peak Athlete';
  }, [phase, tab]);

  async function signOut() {
    try { await window.PA_AUTH.signOut(); } catch (_) { /* fall through */ }
    setD(null);
    setEmail('');
    setPhase('signedOut');
  }

  let content;
  if (phase === 'loading') {
    content = <><h1>Upload admin</h1><p role="status">Loading…</p></>;
  } else if (phase === 'signedOut') {
    content = (
      <>
        <h1>Sign in as an admin</h1>
        <p className="up-lede">Sign in to the Performance Lab with your admin account, then come back to this page.</p>
        <div className="up-actions">
          <a className="up-btn primary" href="../../" target="_blank" rel="noopener"
             style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Open the Performance Lab sign-in<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button type="button" className="up-btn" onClick={start}>I've signed in</button>
        </div>
      </>
    );
  } else if (phase === 'notAdmin') {
    content = <><h1>Admins only</h1><p className="up-lede">This account is not a Peak Athlete admin.</p></>;
  } else if (phase === 'error') {
    content = (
      <>
        <h1>Couldn't load the admin data</h1>
        <p className="up-lede">Check the connection and try again.</p>
        <button type="button" className="up-btn" onClick={start}>Try again</button>
      </>
    );
  } else {
    const waiting = d.uploads.filter((u) => u.status === 'received').length;
    content = (
      <>
        <h1>Upload admin</h1>
        <Tabs tab={tab} setTab={setTab} waiting={waiting} />
        {TABS.map(([id]) => (
          <div key={id} role="tabpanel" id={'panel-' + id} aria-labelledby={'tab-' + id} hidden={tab !== id} tabIndex={0}>
            {tab === id && id === 'queue' && <QueuePanel d={d} reload={reload} />}
            {tab === id && id === 'programs' && <ProgramsPanel d={d} reload={reload} />}
            {tab === id && id === 'billing' && <BillingPanel d={d} reload={reload} />}
            {tab === id && id === 'activity' && <ActivityPanel d={d} />}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <a className="up-skip" href="#main">Skip to content</a>
      <header className="up-header">
        <div className="up-brand">
          <span className="up-brand-name">Peak Athlete</span>
          <span className="up-brand-sub">Upload Center · Admin</span>
        </div>
        <nav className="up-nav" aria-label="Account">
          {email && <span className="who">Signed in as {email}</span>}
          <a href="../">Coach upload page</a>
          <a href="../../">Back to Performance Lab</a>
          {phase !== 'signedOut' && phase !== 'loading' && (
            <button type="button" className="up-btn small" onClick={signOut}>Sign out</button>
          )}
        </nav>
      </header>
      <main id="main" className="up-main wide" tabIndex={-1}>
        {content}
      </main>
      <footer className="up-footer">
        Internal tool. Every action here is recorded in the audit log.
        <span className="up-version">{window.UPLOAD_VERSION}</span>
      </footer>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
