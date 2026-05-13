/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   WebAdmin — Race Requests queue page

   v01.27 (Batch 5). Eric's daily ops surface — a list of every
   incoming race_requests row with status filter, video download,
   and a status-update modal that fires the notify-analysis-
   complete email when a request is marked complete.

   Backed by:
     - PA_REQUESTS.listAdminRequests({ status }) — SELECT with
       race_requests + athletes + teams join, RLS-filtered to
       admins via is_race_request_admin().
     - PA_REQUESTS.updateAdminRequest(requestUuid, { status,
       adminNotes, athleteRow }) — UPDATE + fire notify-
       analysis-complete on completion.
     - PA_REQUESTS.downloadAdminVideo(videoKey, filename,
       requestUuid) — wraps r2-download-url + browser download.

   No new schema, no new RPCs, no new edge functions. All wires
   land on existing infrastructure that the live admin queue
   already uses.

   Bilingual (admin.* dict block). Mobile-aware: table collapses
   to a card list on narrow widths.
   ─────────────────────────────────────────────────────────── */

const { useState: useAdminQState, useEffect: useAdminQEffect } = React;

// ── Status pill — colour by state ────────────────────────────
const statusAccent = (status) => ({
  pending:    'var(--amber-eff)',
  processing: 'var(--signal-eff)',
  completed:  'var(--lime-eff)',
  failed:     'var(--flag-eff)',
}[status] || 'var(--tx-lo)');

const StatusPill = ({ status, t }) => {
  const accent = statusAccent(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 999,
      background: 'color-mix(in oklch, ' + accent + ' 14%, transparent)',
      border: '1px solid color-mix(in oklch, ' + accent + ' 35%, transparent)',
      color: accent,
      font: '700 10px var(--font-ui)',
      letterSpacing: 0.06,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: accent,
      }}/>
      {t('admin.filter.' + status)}
    </span>
  );
};

// ── AdminStatusModal ─────────────────────────────────────────
// Promise-style would be nicest but the modal needs a select +
// textarea, so we use the local-state pattern (Confirm modal is
// for boolean ok/cancel only). Renders into a backdrop with z-
// index 1100 — below ConfirmHost (1100) but above the rest.
const AdminStatusModal = ({ request, onClose, onSaved }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const t = (window.useT || (() => (k) => k))();
  const [status, setStatus] = useAdminQState(request.status || 'pending');
  const [notes, setNotes]   = useAdminQState(request.admin_notes || '');
  const [busy, setBusy]     = useAdminQState(false);
  const [err, setErr]       = useAdminQState(null);

  // Esc closes when not busy.
  useAdminQEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    const athleteRow = request.athletes
      ? {
          email:      request.athletes.email,
          first_name: request.athletes.first_name,
          last_name:  request.athletes.last_name,
          eventName:  request.event_name,
          distance_m: request.distance_m,
          style:      request.style,
          course:     request.course,
        }
      : null;
    const { ok, error } = await window.PA_REQUESTS.updateAdminRequest(
      request.request_uuid,
      { status, adminNotes: notes, athleteRow }
    );
    setBusy(false);
    if (!ok) {
      setErr(error?.message || t('admin.modal.errFallback'));
      try { window.PA_TOAST?.show(t('admin.toast.statusUpdatedFail'), { type: 'error' }); } catch (_) {}
      return;
    }
    try { window.PA_TOAST?.show(t('admin.toast.statusUpdated'), { type: 'success' }); } catch (_) {}
    onSaved?.();
  };

  const inputStyle = {
    padding: '10px 12px', borderRadius: 10,
    border: '1px solid var(--line)', background: 'var(--bg-3)',
    color: 'var(--tx-hi)', font: '500 13px var(--font-ui)',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div onClick={() => !busy && onClose?.()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1080,
        background: 'color-mix(in oklch, var(--ink) 72%, transparent)',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '40px 20px',
        overflowY: 'auto',
      }}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          padding: isMobile ? 22 : 28,
          borderRadius: 16,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
        <div className="display" style={{
          fontSize: 18, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}>
          {t('admin.modal.title')}
        </div>
        <p style={{
          margin: 0, font: '500 13px var(--font-ui)',
          color: 'var(--tx-md)', lineHeight: 1.55,
        }}>
          {t('admin.modal.sub')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{
            font: '600 11px var(--font-ui)', color: 'var(--tx-lo)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }} htmlFor="adm-status">
            {t('admin.modal.statusLabel')}
          </label>
          <select id="adm-status" value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={inputStyle}>
            <option value="pending">{t('admin.filter.pending')}</option>
            <option value="processing">{t('admin.filter.processing')}</option>
            <option value="completed">{t('admin.filter.completed')}</option>
            <option value="failed">{t('admin.filter.failed')}</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{
            font: '600 11px var(--font-ui)', color: 'var(--tx-lo)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }} htmlFor="adm-notes">
            {t('admin.modal.notesLabel')}
          </label>
          <textarea id="adm-notes" rows={3}
            value={notes} onChange={(e) => setNotes(e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}/>
          <span style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)' }}>
            {t('admin.modal.notesHint')}
          </span>
        </div>

        {err && (
          <p style={{
            margin: 0, font: '500 12px var(--font-ui)',
            color: 'var(--flag-eff)',
          }}>{err}</p>
        )}

        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          marginTop: 4, flexWrap: 'wrap',
        }}>
          <button type="button" onClick={() => !busy && onClose?.()}
            disabled={busy}
            style={{
              padding: '10px 16px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'transparent',
              color: 'var(--tx-md)', font: '600 13px var(--font-ui)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}>
            {t('admin.modal.cancel')}
          </button>
          <button type="submit" disabled={busy}
            style={{
              padding: '10px 16px', borderRadius: 10,
              border: 'none', background: 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 13px var(--font-ui)', letterSpacing: 0.01,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? t('admin.modal.saving') : t('admin.modal.save')}
          </button>
        </div>
      </form>
    </div>
  );
};

// ── WebAdmin — main page ─────────────────────────────────────
const WebAdmin = () => {
  const isMobile = (window.useIsMobile || (() => false))();
  const t = (window.useT || (() => (k) => k))();
  const [filter, setFilter] = useAdminQState(null); // null = all
  const [state, setState]   = useAdminQState({ rows: [], loading: true, error: null });
  const [refetchToken, setRefetchToken] = useAdminQState(0);
  const [editing, setEditing] = useAdminQState(null); // request row
  const [downloadingId, setDownloadingId] = useAdminQState(null);

  useAdminQEffect(() => {
    let cancelled = false;
    setState((p) => ({ ...p, loading: true, error: null }));
    (async () => {
      const { rows, error } = await window.PA_REQUESTS.listAdminRequests({ status: filter });
      if (cancelled) return;
      setState({ rows, loading: false, error: error || null });
    })();
    return () => { cancelled = true; };
  }, [filter, refetchToken]);

  const onDownload = async (req) => {
    if (downloadingId) return;
    setDownloadingId(req.request_uuid);
    const { ok, error } = await window.PA_REQUESTS.downloadAdminVideo(
      req.video_key, req.video_filename, req.request_uuid
    );
    setDownloadingId(null);
    if (!ok) {
      try { window.PA_TOAST?.show(t('admin.toast.downloadFailed'), { type: 'error' }); } catch (_) {}
      try { console.warn('[web-admin] download error:', error); } catch (_) {}
    }
  };

  const onSaved = () => {
    setEditing(null);
    setRefetchToken((n) => n + 1);
    // Notify any sidebar badge consumers — pending count changed.
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
  };

  const filterPills = [
    { key: null,         label: t('admin.filter.all') },
    { key: 'pending',    label: t('admin.filter.pending') },
    { key: 'processing', label: t('admin.filter.processing') },
    { key: 'completed',  label: t('admin.filter.completed') },
    { key: 'failed',     label: t('admin.filter.failed') },
  ];

  // Pluralized count caption ("12 requests" / "1 request" / "12 solicitudes").
  const requestWord = state.rows.length === 1
    ? t('admin.requestSingular')
    : t('admin.requestPlural');

  // ── Render branches ────────────────────────────────────────
  let body;
  if (state.loading) {
    body = window.LoadingState
      ? <window.LoadingState label={t('admin.loading')} large/>
      : <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
          {t('admin.loading')}
        </div>;
  } else if (state.error) {
    body = window.ErrorState
      ? <window.ErrorState
          message={t('admin.errorTitle')}
          technical={String(state.error.message || state.error)}
          onRetry={() => setRefetchToken((n) => n + 1)}/>
      : <div style={{ padding: 24, color: 'var(--flag-eff)' }}>
          {t('admin.errorTitle')}
        </div>;
  } else if (!state.rows.length) {
    body = window.EmptyState
      ? <window.EmptyState
          eyebrow={t('admin.pageSub')}
          title={filter ? t('admin.empty') : t('admin.emptyAll')}/>
      : <div style={{ padding: 24, color: 'var(--tx-lo)' }}>
          {filter ? t('admin.empty') : t('admin.emptyAll')}
        </div>;
  } else if (isMobile) {
    body = <AdminCardList
              rows={state.rows} t={t}
              onDownload={onDownload} downloadingId={downloadingId}
              onEdit={setEditing}/>;
  } else {
    body = <AdminTable
              rows={state.rows} t={t}
              onDownload={onDownload} downloadingId={downloadingId}
              onEdit={setEditing}/>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter pill row + count caption */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filterPills.map((p) => {
            const active = filter === p.key;
            return (
              <button key={String(p.key)}
                type="button"
                onClick={() => setFilter(p.key)}
                style={{
                  padding: '7px 14px', borderRadius: 999,
                  border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line)'),
                  background: active ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)' : 'transparent',
                  color: active ? 'var(--signal-eff)' : 'var(--tx-md)',
                  font: '600 12px var(--font-ui)',
                  letterSpacing: 0.02,
                  cursor: 'pointer',
                }}>
                {p.label}
              </button>
            );
          })}
        </div>
        <span style={{
          marginLeft: 'auto',
          font: '500 12px var(--font-mono)',
          color: 'var(--tx-lo)',
        }}>
          {t('admin.count', { n: state.rows.length, requestWord })}
        </span>
      </div>

      {body}

      {editing && (
        <AdminStatusModal
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}/>
      )}
    </div>
  );
};

// ── AdminTable (desktop) ─────────────────────────────────────
const AdminTable = ({ rows, t, onDownload, downloadingId, onEdit }) => {
  const headerCell = {
    textAlign: 'left',
    padding: '10px 12px',
    font: '600 10px var(--font-ui)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--tx-lo)',
    borderBottom: '1px solid var(--line-soft)',
    whiteSpace: 'nowrap',
  };
  const dataCell = {
    padding: '12px',
    font: '500 13px var(--font-ui)',
    color: 'var(--tx-hi)',
    borderBottom: '1px solid var(--line-soft)',
    verticalAlign: 'middle',
  };
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headerCell}>{t('admin.table.status')}</th>
              <th style={headerCell}>{t('admin.table.athlete')}</th>
              <th style={headerCell}>{t('admin.table.event')}</th>
              <th style={headerCell}>{t('admin.table.distance')}</th>
              <th style={headerCell}>{t('admin.table.stroke')}</th>
              <th style={headerCell}>{t('admin.table.course')}</th>
              <th style={headerCell}>{t('admin.table.date')}</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>{t('admin.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <AdminTableRow key={r.request_uuid} r={r} t={t}
                dataCell={dataCell}
                onDownload={onDownload}
                downloadingId={downloadingId}
                onEdit={onEdit}/>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AdminTableRow = ({ r, t, dataCell, onDownload, downloadingId, onEdit }) => {
  const athlete = r.athletes;
  const athleteName = athlete
    ? [athlete.first_name, athlete.last_name].filter(Boolean).join(' ')
    : '—';
  const teamName = athlete?.teams?.team_name || t('admin.noTeam');
  const date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '—';
  const stroke = r.style ? r.style.charAt(0).toUpperCase() + r.style.slice(1) : t('admin.noStroke');
  const isDownloading = downloadingId === r.request_uuid;
  return (
    <tr>
      <td style={dataCell}><StatusPill status={r.status} t={t}/></td>
      <td style={dataCell}>
        <div style={{ font: '600 13px var(--font-ui)', color: 'var(--tx-hi)' }}>{athleteName}</div>
        <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 2 }}>
          {teamName}
        </div>
      </td>
      <td style={dataCell}>{r.event_name || t('admin.noEvent')}</td>
      <td style={dataCell}>{r.distance_m || '—'}</td>
      <td style={dataCell}>{stroke}</td>
      <td style={dataCell}>{r.course || '—'}</td>
      <td style={{ ...dataCell, font: '500 12px var(--font-mono)', color: 'var(--tx-md)' }}>{date}</td>
      <td style={{ ...dataCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <AdminActionBtns r={r} t={t}
          onDownload={onDownload}
          isDownloading={isDownloading}
          onEdit={onEdit}/>
      </td>
    </tr>
  );
};

// ── AdminCardList (mobile) ───────────────────────────────────
const AdminCardList = ({ rows, t, onDownload, downloadingId, onEdit }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {rows.map((r) => {
      const athlete = r.athletes;
      const athleteName = athlete
        ? [athlete.first_name, athlete.last_name].filter(Boolean).join(' ')
        : '—';
      const teamName = athlete?.teams?.team_name || t('admin.noTeam');
      const date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '—';
      const stroke = r.style ? r.style.charAt(0).toUpperCase() + r.style.slice(1) : '';
      const detail = [r.distance_m && (r.distance_m + 'm'), stroke, r.course].filter(Boolean).join(' · ');
      const isDownloading = downloadingId === r.request_uuid;
      return (
        <div key={r.request_uuid} className="card" style={{
          padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <StatusPill status={r.status} t={t}/>
            <span style={{ font: '500 11px var(--font-mono)', color: 'var(--tx-lo)' }}>
              {date}
            </span>
          </div>
          <div>
            <div style={{ font: '600 14px var(--font-ui)', color: 'var(--tx-hi)' }}>{athleteName}</div>
            <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 2 }}>{teamName}</div>
          </div>
          {(r.event_name || detail) && (
            <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-md)' }}>
              {r.event_name && <span>{r.event_name}</span>}
              {r.event_name && detail && <span style={{ color: 'var(--tx-lo)' }}>  ·  </span>}
              {detail && <span style={{ font: '500 12px var(--font-mono)' }}>{detail}</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4, justifyContent: 'flex-end' }}>
            <AdminActionBtns r={r} t={t}
              onDownload={onDownload}
              isDownloading={isDownloading}
              onEdit={onEdit}/>
          </div>
        </div>
      );
    })}
  </div>
);

// ── AdminActionBtns — shared between table + card list ───────
const AdminActionBtns = ({ r, t, onDownload, isDownloading, onEdit }) => {
  const Icon = window.Icon;
  const btn = {
    padding: '7px 11px', borderRadius: 8,
    border: '1px solid var(--line)', background: 'var(--bg-3)',
    color: 'var(--tx-md)',
    font: '600 11px var(--font-ui)', letterSpacing: 0.04,
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    textTransform: 'uppercase',
  };
  return (
    <>
      <button type="button"
        onClick={() => onDownload(r)} disabled={isDownloading || !r.video_key}
        title={t('admin.actions.downloadVideo')}
        aria-label={t('admin.actions.downloadVideo')}
        style={{
          ...btn,
          opacity: (isDownloading || !r.video_key) ? 0.5 : 1,
          cursor: (isDownloading || !r.video_key) ? 'wait' : 'pointer',
        }}>
        {/* download arrow */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
      <button type="button"
        onClick={() => onEdit(r)}
        title={t('admin.actions.editStatus')}
        aria-label={t('admin.actions.editStatus')}
        style={btn}>
        {Icon ? <Icon name="settings" size={12}/> : '⚙'}
      </button>
    </>
  );
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, { WebAdmin });

try { console.log('[web-admin] loaded (v01.27)'); } catch (_) {}
