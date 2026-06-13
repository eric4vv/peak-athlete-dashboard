/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 — Video Sessions
   v03.24 — Phase 1 (read-only shell)

   The home for filmed swim sessions. List of sessions, drill
   into a session to see its clips, click a clip to play.
   Phase 1 surfaces the empty state cleanly for users who have
   no sessions yet — your next Peak Athlete session lands here.

   Later phases add:
     - Phase 2 — time-stamped coach notes on the timeline
     - Phase 3 — frame-step / speed / loop + side-by-side compare
     - Phase 4 — drawing/annotation overlay on freeze-frames
     - Phase 5 — tags + filtered library across sessions
     - Phase 6 — squad library (athlete opt-in + coach toggle)
     - Phase 7 — self-upload flow

   This component lives next to web-races / web-starts /
   web-turns in the analysis nav group. Same prop pattern.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useSessionsState,
  useEffect: useSessionsEffect,
  useMemo:   useSessionsMemo,
} = React;

// ── Pro v1 video-control constants ─────────────────────────
// Frame step is locked at 30 fps for v1. Most coaching cameras
// capture at 30, 60, or 120 fps; 1/30 s gives a usable step on
// every source and avoids over-stepping at the cost of finer
// grain on high-fps footage.
const FRAME_S = 1 / 30;
const SPEEDS  = [0.25, 0.5, 1, 1.5, 2];

// ── Phase 5 tags — color palette ───────────────────────────
// 6 colors. Stored as CSS variable strings since tag chips
// render as DOM elements (CSS context can resolve var()), not
// canvas. First entry is the default for new tags.
const TAG_COLORS = [
  { key: 'green',  value: 'var(--signal-eff)'  },
  { key: 'lime',   value: 'var(--lime-eff)'    },
  { key: 'amber',  value: 'var(--amber-eff)'   },
  { key: 'red',    value: 'var(--flag-eff)'    },
  { key: 'purple', value: 'var(--compare-eff)' },
  { key: 'gray',   value: 'var(--tx-md)'       },
];
const tagColorFor = (key) => {
  const c = TAG_COLORS.find(x => x.key === key);
  return c ? c.value : TAG_COLORS[0].value;
};

// ── Phase 4 drawing — tools + palette ──────────────────────
const ANNOTATE_TOOLS = ['pen', 'line', 'arrow', 'circle', 'rectangle'];
// 4-color palette: literal oklch values pulled from tokens.css
// (dark-mode set, since the dashboard is primarily dark). Using
// literals — not CSS vars — so the canvas paints the right color
// without needing to resolve CSS-variable lookups at every
// repaint. The same string also works as a CSS color for the
// swatch circles in the AnnotateBar, so picker + canvas stay in
// sync automatically. Tradeoff: annotations don't recolor when
// the user toggles light mode — but in practice that's better
// (a saved coaching arrow should look the same regardless of
// viewer theme).
const ANNOTATE_COLORS = [
  { key: 'green',  value: 'oklch(78% 0.17 190)' },  // --signal
  { key: 'red',    value: 'oklch(65% 0.22 25)'  },  // --flag
  { key: 'amber',  value: 'oklch(80% 0.15 75)'  },  // --amber
  { key: 'white',  value: '#f3f4f6'             },
];
const ANNOTATE_STROKE_W = 3;
// How long a saved annotation lingers on the video during
// playback, in seconds. Centered on t_sec → if you set this
// to 0.6 the annotation is visible from t_sec - 0.3 to + 0.3.
const ANNOTATE_DWELL_S = 1.2;

// useResizeObserver — tracks the rendered pixel size of a ref'd
// element. Used to keep the canvas overlay's drawing-buffer in
// sync with the video box so strokes don't blur or warp on
// window resize. Returns { width, height } in CSS pixels.
const useElementSize = (ref) => {
  const [size, setSize] = useSessionsState({ width: 0, height: 0 });
  useSessionsEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    // Initial size.
    const r = el.getBoundingClientRect();
    setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    return () => ro.disconnect();
  }, []);
  return size;
};

// ── useVideoControls (v03.28) ──────────────────────────────
// Hook that owns one video's playback-rate, A/B markers and
// loop state, plus the media-event handlers + button actions
// that drive them. v03.27 used to drive the compare clip from
// the primary; v03.28 unbundles them so each video in a
// compare view gets its OWN independent set of pills.
const useVideoControls = (videoRef) => {
  const [playbackRate, setPlaybackRate] = useSessionsState(1);
  const [aSec, setASec] = useSessionsState(null);
  const [bSec, setBSec] = useSessionsState(null);
  const [looping, setLooping] = useSessionsState(false);

  const onRateChange = () => {
    const v = videoRef.current;
    if (v) setPlaybackRate(v.playbackRate);
  };
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (looping && aSec != null && bSec != null && bSec > aSec
        && v.currentTime >= bSec) {
      try { v.currentTime = aSec; } catch (_) {}
    }
  };
  const stepFrame = (dir) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = Math.max(0, v.currentTime + dir * FRAME_S);
    } catch (_) {}
  };
  const applyRate = (r) => {
    const v = videoRef.current;
    if (v) v.playbackRate = r;
  };
  const captureA = () => { const v = videoRef.current; if (v) setASec(v.currentTime); };
  const captureB = () => { const v = videoRef.current; if (v) setBSec(v.currentTime); };
  const clearAB = () => { setASec(null); setBSec(null); setLooping(false); };
  const toggleLoop = () => setLooping(l => !l);
  const canLoop = aSec != null && bSec != null && bSec > aSec;

  return {
    playbackRate, aSec, bSec, looping, canLoop,
    onRateChange, onTimeUpdate,
    stepFrame, applyRate, captureA, captureB, clearAB, toggleLoop,
  };
};

const WebSessions = ({ session, authUserId, lang, adminAthleteUuid, isPro, onUpgrade }) => {
  const t = (window.useT || (() => (k) => k))();
  const isMobile = (window.useIsMobile || (() => false))();
  const LS = window.LoadingState;
  const ES = window.EmptyState;
  const ER = window.ErrorState;
  const Icon = window.Icon;
  const CC = window.ChartCard;
  const SA = window.PA_SESSIONS;
  if (!SA) {
    return (
      <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
        Sessions module not loaded.
      </div>
    );
  }

  // List / detail switch — null = list, uuid = detail view.
  const [openSessionUuid, setOpenSessionUuid] = useSessionsState(null);
  // v03.37 — top-of-page mode toggle. 'sessions' = grouped-by-session
  // list (default), 'library' = flat all-clips list with tag filters.
  const [mode, setMode] = useSessionsState('sessions');
  // For Library → open clip in workspace. When set, we render a
  // single-clip workspace view; the back button returns to library.
  const [libraryOpenClip, setLibraryOpenClip] = useSessionsState(null);
  // v03.46 — "+ New session" modal state.
  const [showCreateModal, setShowCreateModal] = useSessionsState(false);

  // Pro gate — keep same naming as other tabs.
  const isProForFeatures = !!isPro;

  // v03.49 — admin/coach context for the SessionCard share toggle.
  const [shellTeam, setShellTeam] = useSessionsState({ isCoach: false, teamUuids: [] });
  const [shellAdmin, setShellAdmin] = useSessionsState({ isSuperAdmin: false });
  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await SA.getMyTeamMembership?.() || { isCoach: false, teamUuids: [] };
      const a = (window.PA_ADMIN && window.PA_ADMIN.checkAdmin)
        ? await window.PA_ADMIN.checkAdmin()
        : { isSuperAdmin: false };
      if (!cancelled) {
        setShellTeam(m);
        setShellAdmin(a);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const canShareSession = (s) => !!s && (
    shellAdmin.isSuperAdmin ||
    (shellTeam.isCoach && shellTeam.teamUuids.includes(s.team_uuid))
  );
  const onToggleSessionShareFromList = async (s) => {
    if (!s) return;
    const next = !s.coach_shared_to_squad;
    // Optimistic local update.
    setListState(st => ({
      ...st,
      rows: (st.rows || []).map(r =>
        r.session_uuid === s.session_uuid ? { ...r, coach_shared_to_squad: next } : r
      ),
    }));
    const { ok, error } = await SA.setSessionCoachSharedToSquad(s.session_uuid, next);
    if (!ok) {
      // Roll back.
      setListState(st => ({
        ...st,
        rows: (st.rows || []).map(r =>
          r.session_uuid === s.session_uuid ? { ...r, coach_shared_to_squad: !next } : r
        ),
      }));
      alert(t('sessions.couldNotUpdate') + ((error && error.message) || 'unknown'));
    }
  };

  // v03.46 — Per-card delete from the Sessions list.
  const onDeleteFromList = async (s) => {
    const msg = t('sessions.cardDeleteConfirm', { title: SA.sessionTitle(s) || 'this session' });
    const ok2 = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: msg, isDanger: true, confirmLabel: t('sessions.detailDelete') })
      : window.confirm(msg);
    if (!ok2) return;
    const { ok, error } = await SA.deleteSession(s.session_uuid);
    if (!ok) {
      alert(t('sessions.couldNotDelete') + ((error && error.message) || 'unknown'));
      return;
    }
    setListState(st => ({
      ...st,
      rows: (st.rows || []).filter(r => r.session_uuid !== s.session_uuid),
    }));
  };

  // v03.46 — handler for the create-session modal.
  const onSessionCreated = (newSession) => {
    setListState(st => ({
      ...st,
      rows: [newSession, ...(st.rows || [])],
    }));
    setShowCreateModal(false);
  };

  // ── Sessions list state ────────────────────────────────────
  const [listState, setListState] = useSessionsState({
    loading: true, rows: [], error: null,
  });

  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      setListState(s => ({ ...s, loading: true, error: null }));
      // v03.53 — scope the Sessions list to the impersonated
      // athlete when one is set, matching Starts / Turns / Races.
      // Library mode stays unscoped (cross-athlete discovery).
      const { data, error } = await SA.listSessions({
        limit: 500,
        athleteUuid: adminAthleteUuid || null,
      });
      if (cancelled) return;
      setListState({ loading: false, rows: data || [], error });
    })();
    return () => { cancelled = true; };
  }, [adminAthleteUuid]);

  // v03.44 — listen for cross-tab "open this promoted clip"
  // events fired by SaveToLibraryButton in the analysis tabs.
  // Strategy: fetch the clip + its parent session, then route
  // through the existing libraryOpenClip → SessionDetail path
  // so we reuse the workspace shell without code duplication.
  useSessionsEffect(() => {
    const handler = async (ev) => {
      const clipUuid = ev?.detail?.clipUuid;
      if (!clipUuid || !SA.getClipForLibrary) return;
      const { data: clip } = await SA.getClipForLibrary(clipUuid);
      if (clip) {
        setLibraryOpenClip(clip);
        // Make sure we're in a mode that actually shows the clip.
        // Sessions mode + libraryOpenClip set → SessionDetail
        // (the shared workspace) renders with that clip preselected.
        setMode('sessions');
        setOpenSessionUuid(null);
      }
    };
    window.addEventListener('pa:open-sessions-clip', handler);
    return () => window.removeEventListener('pa:open-sessions-clip', handler);
  }, []);

  // ── Detail view (when a session is open) ───────────────────
  if (openSessionUuid) {
    return (
      <SessionDetail
        sessionUuid={openSessionUuid}
        sessions={listState.rows}
        onBack={() => setOpenSessionUuid(null)}
        onDeleted={(uuid) => {
          // Optimistic list update — drop the deleted row so the
          // back-nav lands on a clean list (no need to refetch).
          setListState(s => ({
            ...s,
            rows: (s.rows || []).filter(r => r.session_uuid !== uuid),
          }));
          setOpenSessionUuid(null);
        }}
        isMobile={isMobile}
        t={t}
        isPro={isProForFeatures}
        onUpgrade={onUpgrade}
      />
    );
  }

  // ── Library: single clip open in workspace ─────────────────
  // (Workspace is shared between Session detail and Library —
  // we synthesize a one-clip "sessions" array so SessionDetail
  // can render the header off of the clip's parent session.)
  if (libraryOpenClip) {
    return (
      <SessionDetail
        sessionUuid={libraryOpenClip.session_uuid}
        sessions={[libraryOpenClip._session].filter(Boolean)}
        onBack={() => setLibraryOpenClip(null)}
        isMobile={isMobile}
        t={t}
        isPro={isProForFeatures}
        onUpgrade={onUpgrade}
        initialClipUuid={libraryOpenClip.clip_uuid}
      />
    );
  }

  // ── Mode toggle header (always visible at the top) ─────────
  const modeToggle = (
    <ModeToggle mode={mode} onChange={setMode}/>
  );

  // ── Library mode ───────────────────────────────────────────
  if (mode === 'library') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {modeToggle}
        <LibraryView
          isMobile={isMobile}
          isPro={isProForFeatures}
          onUpgrade={onUpgrade}
          onOpenSession={(uuid) => setOpenSessionUuid(uuid)}
          onOpenClip={(clip) => setLibraryOpenClip(clip)}
          adminAthleteUuid={adminAthleteUuid}
        />
      </div>
    );
  }

  // ── Sessions mode (list view) ──────────────────────────────
  if (listState.loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {modeToggle}
        {LS ? <LS label="Loading your sessions…" large/> : <div>Loading…</div>}
      </div>
    );
  }
  if (listState.error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {modeToggle}
        {ER
          ? <ER title="Couldn't load sessions"
                message={listState.error.message || 'Unexpected error.'}/>
          : <div>Error: {String(listState.error.message || listState.error)}</div>}
      </div>
    );
  }

  const rows = listState.rows || [];

  // v03.46 — header row: mode toggle + "+ New session" button.
  // Same row whether the list is empty or populated so the
  // affordance lives in the same spot every time.
  const headerRow = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      justifyContent: 'space-between', flexWrap: 'wrap',
    }}>
      {modeToggle}
      <button type="button" onClick={() => setShowCreateModal(true)}
        style={{
          font: '700 11px var(--font-ui)', letterSpacing: 0.04,
          padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
          background: 'var(--signal-eff)', color: 'var(--ink)',
          border: 'none', textTransform: 'uppercase',
        }}>
        {t('sessions.newSession')}
      </button>
    </div>
  );

  const createModal = showCreateModal && (
    <CreateSessionModal
      onClose={() => setShowCreateModal(false)}
      onCreated={onSessionCreated}
      adminAthleteUuid={adminAthleteUuid}
    />
  );

  if (!rows.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {headerRow}
        {createModal}
        {ES
          ? <ES title={t('sessions.emptyTitle')}
                body={t('sessions.emptyBody')}/>
          : <div style={{ padding: 32, textAlign: 'center', color: 'var(--tx-lo)' }}>
              {t('sessions.emptyTitle')}
            </div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {headerRow}
      {createModal}
      <div className="display" style={{
        fontSize: isMobile ? 18 : 22, color: 'var(--tx-hi)',
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>
        {rows.length} {rows.length === 1 ? t('sessions.countOne') : t('sessions.countMany')}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 14,
      }}>
        {rows.map(s => (
          <SessionCard key={s.session_uuid}
            session={s}
            onOpen={() => setOpenSessionUuid(s.session_uuid)}
            onDelete={() => onDeleteFromList(s)}
            canShare={canShareSession(s)}
            onToggleShare={() => onToggleSessionShareFromList(s)}/>
        ))}
      </div>
    </div>
  );
};

// ── ModeToggle (v03.37) — Sessions / Library pill row ────────
const ModeToggle = ({ mode, onChange }) => {
  const t = (window.useT || (() => (k) => k))();
  const labels = {
    sessions: t('sessions.modeSessions'),
    library:  t('sessions.modeLibrary'),
  };
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: 4, borderRadius: 999,
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      alignSelf: 'flex-start',
    }}>
      {['sessions', 'library'].map(m => {
        const active = mode === m;
        return (
          <button key={m} type="button" onClick={() => onChange(m)}
            style={{
              padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
              font: '700 11px var(--font-ui)', letterSpacing: 0.04,
              background: active ? 'var(--signal-eff)' : 'transparent',
              color:      active ? 'var(--ink)'        : 'var(--tx-md)',
              border: 'none',
              textTransform: 'uppercase',
            }}>
            {labels[m]}
          </button>
        );
      })}
    </div>
  );
};

// ── SessionCard — clickable summary tile in the list view ────
// v03.46 — wrapped in a div (not button) so we can nest a real
// delete button without an invalid <button><button> structure.
// v03.49 — added share-toggle (coach + super_admin only) and a
// read-only chip indicating the session's team-share status.
const SessionCard = ({ session, onOpen, onDelete, onToggleShare, canShare }) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const t = (window.useT || (() => (k) => k))();
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.();
    }
  };
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: 18, borderRadius: 14,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        color: 'var(--tx-hi)', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 8,
        font: '500 14px var(--font-ui)',
      }}>
      {/* v03.46 — Delete × in the top-right corner. stopPropagation
          so the click doesn't bubble to the card's onOpen. */}
      {onDelete && (
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('sessions.detailDelete')}
          aria-label={t('sessions.detailDelete')}
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 24, height: 24, borderRadius: 6,
            background: 'transparent',
            color: 'var(--tx-lo)',
            border: '1px solid transparent',
            cursor: 'pointer', lineHeight: 1,
            font: '700 14px var(--font-ui)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in oklch, var(--flag-eff) 12%, transparent)';
            e.currentTarget.style.color = 'var(--flag-eff)';
            e.currentTarget.style.border = '1px solid color-mix(in oklch, var(--flag-eff) 40%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--tx-lo)';
            e.currentTarget.style.border = '1px solid transparent';
          }}>
          ×
        </button>
      )}
      {/* v03.56 — source tag removed; it was overlapped by the
          × delete button (top-right absolute) and added no
          information users acted on. */}
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
        {SA.sessionDate(session) || 'SESSION'}
      </span>
      <div className="display" style={{
        fontSize: 18, letterSpacing: '-0.015em', color: 'var(--tx-hi)',
      }}>
        {SA.sessionTitle(session)}
      </div>
      {session.notes && (
        <div style={{
          font: '500 12px/1.5 var(--font-ui)', color: 'var(--tx-md)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {session.notes}
        </div>
      )}
      <div style={{
        // v03.56 — marginTop: auto pushes the footer to the
        // bottom of the card so the "View clips ›" + Share
        // pill line up across cards even when only some have
        // notes filled in.
        marginTop: 'auto', paddingTop: 8,
        display: 'flex', alignItems: 'center', gap: 8,
        justifyContent: 'space-between',
        font: '600 11px var(--font-ui)', color: 'var(--signal-eff)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {t('sessions.cardViewClips')} {Icon && <Icon name="chev" size={12}/>}
        </span>
        {/* v03.49 — Share pill (coach/admin) OR read-only chip
            when the viewer can't toggle but the session IS shared. */}
        {canShare ? (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onToggleShare?.(); }}
            title={session.coach_shared_to_squad
              ? t('sessions.shareCardTooltipOn')
              : t('sessions.shareCardTooltipOff')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px', borderRadius: 999,
              font: '700 9px var(--font-mono)', letterSpacing: 0.06,
              cursor: 'pointer',
              background: session.coach_shared_to_squad
                ? 'color-mix(in oklch, var(--lime-eff) 14%, transparent)'
                : 'transparent',
              color: session.coach_shared_to_squad ? 'var(--lime-eff)' : 'var(--tx-lo)',
              border: '1px solid ' + (session.coach_shared_to_squad
                ? 'var(--lime-eff)'
                : 'var(--line-soft)'),
              textTransform: 'uppercase',
            }}>
            ⇄ {session.coach_shared_to_squad ? t('sessions.cardShared') : t('sessions.cardShare')}
          </button>
        ) : (
          session.coach_shared_to_squad && <TeamSharedChip/>
        )}
      </div>
    </div>
  );
};

// ── CreateSessionModal (v03.46) ──────────────────────────────
// Lightweight modal — title (required), date (default today),
// notes (optional). Athlete context comes from the impersonation
// prop or the user's own athlete row. Coaches without an
// adminAthleteUuid context get a picker of their team athletes.
const CreateSessionModal = ({ onClose, onCreated, adminAthleteUuid }) => {
  const SA = window.PA_SESSIONS;
  const t = (window.useT || (() => (k) => k))();
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useSessionsState('');
  const [date, setDate]   = useSessionsState(today);
  const [notes, setNotes] = useSessionsState('');
  const [saving, setSaving] = useSessionsState(false);
  const [me, setMe]       = useSessionsState({ isCoach: false, isAthlete: false, athleteUuid: null, teamUuids: [] });
  const [roster, setRoster] = useSessionsState([]); // for coach picker
  const [pickedAthleteUuid, setPickedAthleteUuid] = useSessionsState(adminAthleteUuid || null);
  const [pickedTeamUuid, setPickedTeamUuid] = useSessionsState(null);

  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await SA.getMyTeamMembership?.() || { isCoach: false };
      if (cancelled) return;
      setMe(m);
      // Resolve athlete + team context.
      if (adminAthleteUuid) {
        // Super-admin impersonation already chose an athlete.
        setPickedAthleteUuid(adminAthleteUuid);
        // Look up the team for that athlete.
        try {
          const { data } = await window.supabaseClient
            .from('athletes')
            .select('team_uuid')
            .eq('athlete_uuid', adminAthleteUuid)
            .limit(1);
          if (!cancelled && data && data[0]) setPickedTeamUuid(data[0].team_uuid);
        } catch (_) {}
        return;
      }
      if (m.isAthlete && m.athleteUuid) {
        setPickedAthleteUuid(m.athleteUuid);
        if (m.teamUuids[0]) setPickedTeamUuid(m.teamUuids[0]);
        return;
      }
      if (m.isCoach && m.teamUuids.length) {
        // Coach with no impersonation → fetch the roster of their first team.
        try {
          const { data } = await window.supabaseClient
            .from('athletes')
            .select('athlete_uuid, team_uuid, first_name, last_name, athlete_code')
            .in('team_uuid', m.teamUuids)
            .eq('membership_status', 'active')
            .order('last_name', { ascending: true });
          if (!cancelled) setRoster(data || []);
        } catch (_) {}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    if (saving) return;
    if (!pickedAthleteUuid) {
      alert('Pick an athlete first.');
      return;
    }
    setSaving(true);
    const { data, error } = await SA.createSession({
      athleteUuid: pickedAthleteUuid,
      teamUuid:    pickedTeamUuid,
      title,
      sessionDate: date,
      notes,
    });
    setSaving(false);
    if (error || !data) {
      alert(t('sessions.couldNotCreate') + ((error && error.message) || 'unknown'));
      return;
    }
    onCreated && onCreated(data);
  };

  // Esc closes the modal.
  useSessionsEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: 'var(--bg-2)', borderRadius: 14,
          border: '1px solid var(--line-soft)',
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
        <div className="display" style={{
          fontSize: 20, color: 'var(--tx-hi)', letterSpacing: '-0.015em',
        }}>
          {t('sessions.createModalTitle')}
        </div>

        {/* Athlete picker — only for coaches without impersonation */}
        {!adminAthleteUuid && !me.isAthlete && me.isCoach && roster.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('sessions.athleteLabel')}</span>
            <select value={pickedAthleteUuid || ''}
              onChange={(e) => {
                const uuid = e.target.value;
                setPickedAthleteUuid(uuid);
                const r = roster.find(a => a.athlete_uuid === uuid);
                setPickedTeamUuid(r ? r.team_uuid : null);
              }}
              style={{
                padding: 8, borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--bg-3)', color: 'var(--tx-hi)',
                font: '500 13px var(--font-ui)',
              }}>
              <option value="">{t('sessions.pickAthlete')}</option>
              {roster.map(a => (
                <option key={a.athlete_uuid} value={a.athlete_uuid}>
                  {(a.first_name || '') + ' ' + (a.last_name || '')} ({a.athlete_code})
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('sessions.titleLabel')}</span>
          <input type="text" value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('sessions.titlePlaceholder')}
            autoFocus
            style={{
              padding: 8, borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--bg-3)', color: 'var(--tx-hi)',
              font: '500 13px var(--font-ui)',
            }}/>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('sessions.dateLabel')}</span>
          <input type="date" value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              padding: 8, borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--bg-3)', color: 'var(--tx-hi)',
              font: '500 13px var(--font-ui)',
            }}/>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('sessions.notesOptionalLabel')}</span>
          <textarea value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t('sessions.notesPlaceholder')}
            style={{
              padding: 8, borderRadius: 8, resize: 'vertical',
              border: '1px solid var(--line)',
              background: 'var(--bg-3)', color: 'var(--tx-hi)',
              font: '500 13px/1.5 var(--font-ui)',
            }}/>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose}
            style={{
              padding: '7px 13px', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', color: 'var(--tx-md)',
              border: '1px solid var(--line-soft)',
              font: '600 12px var(--font-ui)',
            }}>{t('sessions.cancel')}</button>
          <button type="button" onClick={onSave}
            disabled={saving || !title.trim() || !pickedAthleteUuid}
            style={{
              padding: '7px 15px', borderRadius: 8,
              cursor: (saving || !title.trim() || !pickedAthleteUuid) ? 'default' : 'pointer',
              background: 'var(--signal-eff)', color: 'var(--ink)',
              border: 'none', font: '700 12px var(--font-ui)',
              opacity: (saving || !title.trim() || !pickedAthleteUuid) ? 0.5 : 1,
            }}>
            {saving ? t('sessions.creating') : t('sessions.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── SessionDetail — inline clip workspace (v03.26) ───────────
// Refactored from "click clip → modal player" into a single
// in-dashboard surface: clip list on the left, the player +
// notes workspace on the right. No modals — coaches stay on
// one page while flipping between clips.
const SessionDetail = ({
  sessionUuid, sessions, onBack, isMobile, t,
  isPro, onUpgrade,
  // v03.37 — Library can open a specific clip directly. When set
  // the clip auto-selects on mount instead of defaulting to row 0.
  initialClipUuid,
  // v03.45 — called with sessionUuid after a successful delete
  // so the parent can drop the row from its cached list.
  onDeleted,
}) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const LS = window.LoadingState;
  const ES = window.EmptyState;
  const ER = window.ErrorState;
  const session = (sessions || []).find(s => s.session_uuid === sessionUuid) || null;

  const [clipState, setClipState] = useSessionsState({
    loading: true, rows: [], error: null,
  });
  const [selectedClipUuid, setSelectedClipUuid] = useSessionsState(initialClipUuid || null);
  // v03.35 — Compare clip lifted to SessionDetail so the ClipList
  // can show slot A / slot B styling and a single click drives
  // both selections (same model as the trial list in Races /
  // Starts / Turns: empty → fill primary, primary set → fill
  // compare, click an assigned clip to clear it, click a third
  // clip with both slots full to replace compare).
  const [compareClipUuid, setCompareClipUuid] = useSessionsState(null);
  // v03.28 — clip-list collapse toggle. Default expanded; coach
  // hits the chevron to gain back ~220 px for the videos / data.
  const [clipListCollapsed, setClipListCollapsed] = useSessionsState(false);

  // v03.35 — Single click handler. Matches the slot-A / slot-B
  // assignment logic of the analysis tabs' TrialRow.
  const onClipClick = (uuid) => {
    if (uuid === selectedClipUuid) {
      // Clicking primary clears it (and clears compare too —
      // can't compare against nothing). Falls back to compare
      // becoming the new primary if it was set.
      if (compareClipUuid) {
        setSelectedClipUuid(compareClipUuid);
        setCompareClipUuid(null);
      } else {
        setSelectedClipUuid(null);
      }
      return;
    }
    if (uuid === compareClipUuid) {
      setCompareClipUuid(null);
      return;
    }
    if (!selectedClipUuid) {
      setSelectedClipUuid(uuid);
      return;
    }
    // Primary set; fill or replace compare.
    setCompareClipUuid(uuid);
  };

  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      setClipState(s => ({ ...s, loading: true, error: null }));
      const { data, error } = await SA.listClipsForSession(sessionUuid);
      if (cancelled) return;
      setClipState({ loading: false, rows: data || [], error });
      // Auto-select the first clip so the workspace isn't empty.
      if (data && data.length && !selectedClipUuid) {
        setSelectedClipUuid(data[0].clip_uuid);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionUuid]);

  const selectedClip = (clipState.rows || []).find(c => c.clip_uuid === selectedClipUuid) || null;

  // v03.49 — session-level team-share toggle. State lives here so
  // the pill in the header AND the chip in each ClipWorkspace
  // (via the sessionShared prop) reflect the same source of truth.
  const [sessionShared, setSessionShared] = useSessionsState(
    !!(session && session.coach_shared_to_squad)
  );
  useSessionsEffect(() => {
    setSessionShared(!!(session && session.coach_shared_to_squad));
  }, [session && session.coach_shared_to_squad]);
  const [sharing, setSharing] = useSessionsState(false);
  // Compute team/admin context to gate visibility of the toggle.
  const [team, setTeam] = useSessionsState({ isCoach: false, teamUuids: [] });
  const [adminInfoSD, setAdminInfoSD] = useSessionsState({ isSuperAdmin: false });
  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await SA.getMyTeamMembership?.() || { isCoach: false, teamUuids: [] };
      const a = (window.PA_ADMIN && window.PA_ADMIN.checkAdmin)
        ? await window.PA_ADMIN.checkAdmin()
        : { isSuperAdmin: false };
      if (!cancelled) {
        setTeam(m);
        setAdminInfoSD(a);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const canCoachShareSession = !!session && (
    adminInfoSD.isSuperAdmin ||
    (team.isCoach && team.teamUuids.includes(session.team_uuid))
  );
  const onToggleShare = async () => {
    if (sharing || !session) return;
    const next = !sessionShared;
    setSharing(true);
    setSessionShared(next); // optimistic
    const { ok, error } = await SA.setSessionCoachSharedToSquad(sessionUuid, next);
    setSharing(false);
    if (!ok) {
      setSessionShared(!next);
      alert(t('sessions.couldNotUpdate') + ((error && error.message) || 'unknown'));
    }
  };

  // v03.45 — Delete session affordance. Lives in the header so
  // it's discoverable but not in the list view (forces user to
  // open the session first → fewer accidental deletes).
  const [deleting, setDeleting] = useSessionsState(false);
  const onDeleteSession = async () => {
    if (deleting) return;
    const clipCount = (clipState.rows || []).length;
    const msg = clipCount > 0
      ? t('sessions.detailDeleteConfirm', {
          n: clipCount,
          clipWord: clipCount === 1 ? t('sessions.clipOne') : t('sessions.clipMany'),
        })
      : t('sessions.detailDeleteConfirmEmpty');
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: msg, isDanger: true, confirmLabel: t('sessions.detailDelete') })
      : window.confirm(msg);
    if (!proceed) return;
    setDeleting(true);
    const { ok, error } = await SA.deleteSession(sessionUuid);
    setDeleting(false);
    if (!ok) {
      alert(t('sessions.couldNotDelete') + ((error && error.message) || 'unknown error'));
      return;
    }
    if (onDeleted) onDeleted(sessionUuid);
    else           onBack();
  };

  // v03.46 — Delete a single clip from this session. Cascading
  // FKs handle the clip's notes/annotations/tags. We do an
  // optimistic local update + clear selection if the deleted
  // clip was active.
  const onDeleteClip = async (clip) => {
    if (!clip || !clip.clip_uuid) return;
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: t('sessions.deleteClipConfirm'), isDanger: true, confirmLabel: t('sessions.deleteClip') })
      : window.confirm(t('sessions.deleteClipConfirm'));
    if (!proceed) return;
    const { ok, error } = await SA.deleteClip(clip.clip_uuid);
    if (!ok) {
      alert(t('sessions.couldNotDelete') + ((error && error.message) || 'unknown'));
      return;
    }
    setClipState(s => ({
      ...s,
      rows: (s.rows || []).filter(r => r.clip_uuid !== clip.clip_uuid),
    }));
    if (selectedClipUuid === clip.clip_uuid) setSelectedClipUuid(null);
    if (compareClipUuid  === clip.clip_uuid) setCompareClipUuid(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Back + session header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        justifyContent: 'space-between', flexWrap: 'wrap',
      }}>
        <button type="button" onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', color: 'var(--tx-md)',
            border: '1px solid var(--line-soft)',
            font: '600 12px var(--font-ui)',
          }}>
          {Icon && <Icon name="chev" size={12} style={{ transform: 'rotate(180deg)' }}/>}
          {t('sessions.backToList')}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* v03.49 — Share toggle (coach + super_admin only). */}
          {canCoachShareSession && (
            <button type="button" onClick={onToggleShare} disabled={sharing}
              title={sessionShared ? t('sessions.shareTooltipOn') : t('sessions.shareTooltipOff')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 999,
                cursor: sharing ? 'wait' : 'pointer',
                background: sessionShared
                  ? 'color-mix(in oklch, var(--lime-eff) 14%, transparent)'
                  : 'transparent',
                color: sessionShared ? 'var(--lime-eff)' : 'var(--tx-md)',
                border: '1px solid ' + (sessionShared
                  ? 'var(--lime-eff)'
                  : 'var(--line-soft)'),
                font: '600 12px var(--font-ui)',
                opacity: sharing ? 0.6 : 1,
              }}>
              {sharing ? t('sessions.sharing')
                : sessionShared ? t('sessions.sharedWithTeam')
                : t('sessions.shareWithTeam')}
            </button>
          )}
          {/* Read-only chip when shared and viewer can't toggle. */}
          {!canCoachShareSession && sessionShared && <TeamSharedChip/>}
          {/* v03.73 — Notify Athlete (super-admin only; self-gates).
              Emails the athlete "your video analysis is ready" via the
              notify-trial-complete edge function. Once-sent state shows
              from session.notified_at. */}
          {session && session.athlete_uuid && window.NotifyAthleteButton && (
            <window.NotifyAthleteButton
              trialKind="session"
              trialUuid={session.session_uuid}
              athleteUuid={session.athlete_uuid}
              eventName={SA.sessionTitle(session)}
              notifiedAt={session.notified_at}
            />
          )}
          <button type="button" onClick={onDeleteSession} disabled={deleting}
            title={t('sessions.detailDelete')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 11px', borderRadius: 999,
              cursor: deleting ? 'wait' : 'pointer',
              background: 'transparent',
              color: 'var(--flag-eff)',
              border: '1px solid color-mix(in oklch, var(--flag-eff) 40%, var(--line-soft))',
              font: '600 12px var(--font-ui)',
              opacity: deleting ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!deleting) {
                e.currentTarget.style.background = 'color-mix(in oklch, var(--flag-eff) 10%, transparent)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}>
            {deleting ? t('sessions.detailDeleting') : t('sessions.detailDelete')}
          </button>
        </div>
      </div>
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 4 }}>
          {session ? (SA.sessionDate(session) || 'SESSION') : 'SESSION'}
        </div>
        <div className="display" style={{
          fontSize: isMobile ? 22 : 28, color: 'var(--tx-hi)',
          letterSpacing: '-0.02em',
        }}>
          {session ? SA.sessionTitle(session) : 'Session'}
        </div>
        {session && session.notes && (
          <p style={{
            font: '500 14px/1.5 var(--font-ui)', color: 'var(--tx-md)',
            marginTop: 8, maxWidth: 720,
          }}>
            {session.notes}
          </p>
        )}
      </div>

      {/* Body */}
      {clipState.loading ? (
        LS ? <LS label={t('sessions.loadingClips')}/> : <div>{t('sessions.loadingClips')}</div>
      ) : clipState.error ? (
        ER ? <ER title={t('sessions.cantLoadClips')}
                  message={clipState.error.message || 'Unexpected error.'}/>
            : <div>Error.</div>
      ) : !clipState.rows.length ? (
        ES ? <ES title={t('sessions.emptyClips')}
                  body={t('sessions.emptyClipsBody')}/>
            : <div style={{ padding: 24, color: 'var(--tx-lo)' }}>{t('sessions.emptyClips')}</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? '1fr'
            : (clipListCollapsed ? '56px minmax(0, 1fr)' : 'minmax(220px, 280px) minmax(0, 1fr)'),
          gap: isMobile ? 12 : 18,
          alignItems: 'start',
        }}>
          {/* Clip list — vertical on desktop, horizontal-scrolling
              strip on mobile so the workspace below stays full
              width. v03.28: collapsible on desktop. */}
          <ClipList
            clips={clipState.rows}
            selectedUuid={selectedClipUuid}
            compareUuid={compareClipUuid}
            onSelect={onClipClick}
            onDeleteClip={onDeleteClip}
            isMobile={isMobile}
            collapsed={clipListCollapsed}
            onToggleCollapsed={() => setClipListCollapsed(c => !c)}
          />

          {/* Workspace — player + notes panel for the selected clip */}
          {selectedClip
            ? <ClipWorkspace
                key={selectedClip.clip_uuid}
                clip={selectedClip}
                clipsInSession={clipState.rows}
                athleteUuid={session && session.athlete_uuid}
                isMobile={isMobile}
                compareClipUuid={compareClipUuid}
                onSetCompare={setCompareClipUuid}
                isPro={isPro}
                onUpgrade={onUpgrade}
                sessionShared={sessionShared}
              />
            : <div style={{
                padding: 24, borderRadius: 12,
                background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
                color: 'var(--tx-lo)', font: '500 13px var(--font-ui)',
                textAlign: 'center',
              }}>
                {t('sessions.pickClipPrompt')}
              </div>}
        </div>
      )}
    </div>
  );
};

// ── ClipList — sidebar of clips for a session ───────────────
// v03.28: collapsible on desktop. Mobile is unchanged (horizontal
// scroll strip). Collapsed mode renders a thin 56 px rail with
// numbered tiles you can still click to switch clips, plus the
// expand chevron at the top. If this pattern proves out here it
// can be ported to the Races / Starts / Turns trial lists.
const ClipList = ({
  clips, selectedUuid, compareUuid, onSelect, onDeleteClip,
  isMobile, collapsed, onToggleCollapsed,
}) => {
  const t = (window.useT || (() => (k) => k))();
  // v03.35 — derive a tri-state per clip so the row can paint
  // the right slot color. Matches the TrialRow state model in
  // analysis-shell.jsx (idle / slotA / slotB).
  const slotOf = (c) =>
    c.clip_uuid === selectedUuid ? 'primary'
    : c.clip_uuid === compareUuid ? 'compare'
    : 'idle';

  // On mobile we always render the horizontal strip — no collapse
  // (the layout doesn't gain space from collapsing a row).
  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'row',
        gap: 8, overflowX: 'auto', paddingBottom: 4,
      }}>
        {clips.map(c => (
          <ClipRow key={c.clip_uuid} c={c}
            slot={slotOf(c)}
            mobile
            onSelect={() => onSelect(c.clip_uuid)}
            onDelete={onDeleteClip ? () => onDeleteClip(c) : null}/>
        ))}
      </div>
    );
  }

  // ── Desktop: collapsible vertical list ──────────────────────
  const toggleBtn = (
    <button type="button" onClick={onToggleCollapsed}
      title={collapsed ? t('sessions.showClipList') : t('sessions.hideClipList')}
      style={{
        alignSelf: collapsed ? 'center' : 'flex-end',
        font: '600 11px var(--font-ui)',
        padding: '4px 8px', borderRadius: 999, cursor: 'pointer',
        background: 'transparent', color: 'var(--tx-md)',
        border: '1px solid var(--line-soft)',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
      {window.Icon && (
        <window.Icon name="chev" size={11}
          style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}/>
      )}
      {!collapsed && t('sessions.hide')}
    </button>
  );

  if (collapsed) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        gap: 8, alignItems: 'center',
      }}>
        {toggleBtn}
        {clips.map((c, i) => {
          const slot = slotOf(c);
          const accent = slot === 'primary' ? 'var(--signal-eff)'
            : slot === 'compare' ? 'var(--compare-eff)'
            : null;
          return (
            <button key={c.clip_uuid} type="button"
              onClick={() => onSelect(c.clip_uuid)}
              title={c.title || ('Clip · ' + (c.order_idx + 1))}
              style={{
                width: 40, height: 40, borderRadius: 8,
                background: accent
                  ? 'color-mix(in oklch, ' + accent + ' 14%, var(--bg-2))'
                  : 'var(--bg-2)',
                border: '1px solid ' + (accent || 'var(--line-soft)'),
                color: accent || 'var(--tx-md)',
                cursor: 'pointer',
                font: '700 13px var(--font-mono)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {i + 1}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {toggleBtn}
      {clips.map(c => (
        <ClipRow key={c.clip_uuid} c={c}
          slot={slotOf(c)}
          onSelect={() => onSelect(c.clip_uuid)}
          onDelete={onDeleteClip ? () => onDeleteClip(c) : null}/>
      ))}
    </div>
  );
};

// ── ClipRow — one row inside ClipList (extracted v03.28). ────
// v03.35 — `slot` is one of 'idle' | 'primary' | 'compare';
// the row paints itself with the matching accent (--signal-eff
// for primary, --compare-eff for compare) so it reads like the
// Slot A / Slot B styling on Races / Starts / Turns trial rows.
// v03.46 — added optional onDelete affordance (small × on the
// right side, always visible on desktop).
const ClipRow = ({ c, slot, onSelect, onDelete, mobile }) => {
  const t = (window.useT || (() => (k) => k))();
  const accent = slot === 'primary' ? 'var(--signal-eff)'
    : slot === 'compare' ? 'var(--compare-eff)'
    : null;
  const slotLabel = slot === 'primary' ? t('sessions.primaryBadge')
    : slot === 'compare' ? t('sessions.compareBadge')
    : null;
  return (
    <div role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(); } }}
      style={{
        textAlign: 'left',
        flexShrink: 0,
        minWidth: mobile ? 180 : 0,
        padding: 10, borderRadius: 10,
        background: accent
          ? 'color-mix(in oklch, ' + accent + ' 12%, var(--bg-2))'
          : 'var(--bg-2)',
        border: '1px solid ' + (accent || 'var(--line-soft)'),
        color: 'var(--tx-hi)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        font: '500 13px var(--font-ui)',
      }}>
      <span style={{
        width: 28, height: 28, borderRadius: 6,
        background: 'color-mix(in oklch, var(--ink) 12%, var(--bg-3))',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: accent || 'var(--tx-md)',
        flexShrink: 0,
      }}>
        {window.Icon && <window.Icon name="play" size={14}/>}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6,
          font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0, flex: 1,
          }}>
            {c.title || ('Clip · ' + (c.order_idx + 1))}
          </span>
          {slotLabel && (
            <span className="mono" style={{
              font: '700 9px var(--font-mono)', letterSpacing: 0.06,
              padding: '1px 5px', borderRadius: 4,
              background: 'color-mix(in oklch, ' + accent + ' 22%, transparent)',
              color: accent,
              flexShrink: 0,
            }}>
              {slotLabel}
            </span>
          )}
        </span>
        {c.duration_s != null && (
          <span className="mono" style={{
            display: 'block', marginTop: 2,
            font: '500 10px var(--font-mono)', color: 'var(--tx-lo)',
          }}>
            {c.duration_s.toFixed(1)} s
          </span>
        )}
      </span>
      {onDelete && (
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('sessions.deleteClip')}
          aria-label={t('sessions.deleteClip')}
          style={{
            width: 22, height: 22, borderRadius: 5,
            background: 'transparent', color: 'var(--tx-lo)',
            border: '1px solid transparent', cursor: 'pointer',
            font: '700 13px var(--font-ui)', lineHeight: 1,
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in oklch, var(--flag-eff) 12%, transparent)';
            e.currentTarget.style.color = 'var(--flag-eff)';
            e.currentTarget.style.border = '1px solid color-mix(in oklch, var(--flag-eff) 40%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--tx-lo)';
            e.currentTarget.style.border = '1px solid transparent';
          }}>
          ×
        </button>
      )}
    </div>
  );
};

// ── ClipCard — one tile per clip in the session detail ───────
const ClipCard = ({ clip, onPlay }) => {
  const Icon = window.Icon;
  return (
    <button
      type="button"
      onClick={onPlay}
      style={{
        textAlign: 'left',
        padding: 0, borderRadius: 12, overflow: 'hidden',
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        color: 'var(--tx-hi)', cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        font: '500 13px var(--font-ui)',
      }}>
      {/* Thumbnail placeholder — Phase 1 has no thumbnail
          extraction; just a play-icon panel. */}
      <div style={{
        aspectRatio: '16 / 9',
        background: 'color-mix(in oklch, var(--ink) 12%, var(--bg-3))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--signal-eff)',
      }}>
        {Icon && <Icon name="play" size={36}/>}
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ font: '600 13px var(--font-ui)', color: 'var(--tx-hi)' }}>
          {clip.title || ('Clip · ' + (clip.order_idx + 1))}
        </div>
        {clip.duration_s != null && (
          <div className="mono" style={{
            font: '500 10px var(--font-mono)', color: 'var(--tx-lo)',
          }}>
            {clip.duration_s.toFixed(1)} s
          </div>
        )}
      </div>
    </button>
  );
};

// ── ClipWorkspace — inline player + notes + Pro v1 controls (v03.27)
// v03.26 added the inline workspace (replaced the modal). v03.27 layers
// in the Pro v1 video controls on top:
//   - Variable speed (0.25× / 0.5× / 1× / 1.5× / 2×)
//   - Frame-by-frame step (locked at 30 fps)
//   - A/B range loop
//   - Side-by-side compare with a second clip in the same session
//     (compare clip plays synchronized with the primary)
//
// The native <video controls> stays on the primary clip so the
// built-in scrubber handles seek/timeline UX. The Pro controls
// live in a custom toolbar directly under the video. The compare
// clip has no native controls — it is driven entirely by the
// primary via play/pause/seek/ratechange listeners.
const ClipWorkspace = ({
  clip, clipsInSession, athleteUuid, isMobile,
  // v03.35 — Compare clip selection lifted to SessionDetail
  // so the ClipList can drive it via single-click. Workspace
  // is now a consumer, not the owner.
  compareClipUuid, onSetCompare,
  // v03.37 — Pro gating for the Tags feature
  isPro, onUpgrade,
  // v03.49 — session-level team-share flag. Drives the small
  // chip rendered next to each video's PRIMARY/COMPARE label
  // so it's visible the clip belongs to a shared session. The
  // toggle itself lives on SessionDetail / SessionCard.
  sessionShared,
}) => {
  const R = window.PA_REQUESTS;
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const t = (window.useT || (() => (k) => k))();
  // ── Primary video — URL + load phase
  const [phase, setPhase] = useSessionsState('loading'); // 'loading'|'ready'|'error'
  const [url, setUrl] = useSessionsState(null);
  const [err, setErr] = useSessionsState(null);
  const videoRef = React.useRef(null);

  // Notes state
  // v03.36 — per-side notes. Primary always loads; compare loads
  // when compareClip is set. Each side has its own composer slot.
  const [notes, setNotes] = useSessionsState([]);
  const [notesLoading, setNotesLoading] = useSessionsState(true);
  const [notesC, setNotesC] = useSessionsState([]);
  const [notesLoadingC, setNotesLoadingC] = useSessionsState(false);
  // composer = { side: 'primary'|'compare', tSec, text } | null
  const [composer, setComposer] = useSessionsState(null);
  const [saving, setSaving] = useSessionsState(false);
  const [currentUserId, setCurrentUserId] = useSessionsState(null);

  // Compare state — clip uuid comes in from SessionDetail (v03.35).
  // Picker dropdown removed: the ClipList drives selection now.
  const compareClip = compareClipUuid
    ? ((clipsInSession || []).find(c => c.clip_uuid === compareClipUuid) || null)
    : null;
  const compareVideoRef = React.useRef(null);
  const [comparePhase, setComparePhase] = useSessionsState('idle');
  const [compareUrl, setCompareUrl] = useSessionsState(null);

  // ── Pro v1 controls — independent per video (v03.28).
  // Each video gets its own playback-rate, A/B markers, and loop.
  // The compare clip is no longer driven from the primary.
  const primaryCtl = useVideoControls(videoRef);
  const compareCtl = useVideoControls(compareVideoRef);

  // ── Phase 4 (v03.32) — annotations per video ──────────────
  // Each video tracks: the list of saved annotations, draw-mode
  // (currently drawing? for which video?), in-progress strokes
  // (pre-save), the active tool + color, and the current
  // playback time (so the display layer can show annotations
  // whose t_sec is near the playhead).
  const [annotsP, setAnnotsP] = useSessionsState([]);
  const [annotsC, setAnnotsC] = useSessionsState([]);
  const [drawTarget, setDrawTarget] = useSessionsState(null); // 'primary' | 'compare' | null
  const [tool, setTool]           = useSessionsState('pen');
  const [strokeColor, setStrokeColor] = useSessionsState(ANNOTATE_COLORS[0].value);
  const [draftStrokes, setDraftStrokes] = useSessionsState([]); // current drawing
  const [annotLabel, setAnnotLabel] = useSessionsState('');
  const [savingAnnot, setSavingAnnot] = useSessionsState(false);
  const [primaryTime, setPrimaryTime] = useSessionsState(0);
  const [compareTime, setCompareTime] = useSessionsState(0);

  // ── Phase 5 (v03.37) — tag state per video ─────────────────
  const [tagsP, setTagsP] = useSessionsState([]);  // primary clip's tag assignments
  const [tagsC, setTagsC] = useSessionsState([]);  // compare clip's tag assignments
  const [myTags, setMyTags] = useSessionsState([]); // current user's library
  // Tag picker popover: { side: 'primary'|'compare' } | null
  const [tagPickerSide, setTagPickerSide] = useSessionsState(null);

  // ── Phase 6 (v03.39) — team membership + share toggle ──────
  // `team` tells us whether to show the Share pill (coach only)
  // and the ⇄ team chip (anyone viewing a team-shared clip).
  const [team, setTeam] = useSessionsState({ isCoach: false, isAthlete: false, athleteUuid: null, teamUuids: [] });
  // v03.40 — async-resolved admin flags. Other tabs use the
  // same PA_ADMIN.checkAdmin() pattern. Returned shape:
  // { isRaceAdmin, isSuperAdmin } (camelCase).
  const [adminInfo, setAdminInfo] = useSessionsState({ isRaceAdmin: false, isSuperAdmin: false });
  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await SA.getMyTeamMembership?.() || { isCoach: false };
      if (!cancelled) setTeam(m);
      const a = (window.PA_ADMIN && window.PA_ADMIN.checkAdmin)
        ? await window.PA_ADMIN.checkAdmin()
        : { isRaceAdmin: false, isSuperAdmin: false };
      if (!cancelled) setAdminInfo(a);
    })();
    return () => { cancelled = true; };
  }, []);
  // v03.49 — share moved from per-clip → per-session. The
  // toggle lives on SessionDetail's header / SessionCard; here
  // we only need the session-level flag to decide whether the
  // chip renders next to each clip's header.
  const isSuperAdmin = !!adminInfo.isSuperAdmin;

  // Capture current auth user id once so the UI can decide which
  // notes are deletable without a fresh getSession() per render.
  useSessionsEffect(() => {
    (async () => {
      const sess = await window.PA_AUTH?.getSession?.();
      setCurrentUserId(sess?.user?.id || null);
    })();
  }, []);

  // Sign + fetch the R2 URL — primary clip
  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      if (!R || !R.getVideoDownloadUrl) {
        setPhase('error'); setErr('PA_REQUESTS not loaded'); return;
      }
      if (!clip || !clip.r2_key) {
        setPhase('error'); setErr('Clip has no r2_key'); return;
      }
      const { ok, url: signedUrl, error } = await R.getVideoDownloadUrl(
        clip.r2_key, { athleteUuid: athleteUuid || clip.athlete_uuid }
      );
      if (cancelled) return;
      if (ok && signedUrl) {
        setUrl(signedUrl); setPhase('ready'); setErr(null);
      } else {
        setPhase('error');
        setErr((error && error.message) || t('sessions.cantLoadVideo'));
      }
    })();
    return () => { cancelled = true; };
  }, [clip && clip.r2_key]);

  // Sign + fetch the R2 URL — compare clip (when selected)
  useSessionsEffect(() => {
    if (!compareClip) {
      setComparePhase('idle');
      setCompareUrl(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      if (!R || !R.getVideoDownloadUrl) {
        setComparePhase('error'); return;
      }
      setComparePhase('loading');
      const { ok, url: signedUrl } = await R.getVideoDownloadUrl(
        compareClip.r2_key,
        { athleteUuid: compareClip.athlete_uuid }
      );
      if (cancelled) return;
      if (ok && signedUrl) { setCompareUrl(signedUrl); setComparePhase('ready'); }
      else { setComparePhase('error'); }
    })();
    return () => { cancelled = true; };
  }, [compareClip && compareClip.r2_key]);

  // Load notes for the primary clip
  const reloadNotes = React.useCallback(async () => {
    setNotesLoading(true);
    const { data } = await SA.listNotesForClip(clip.clip_uuid);
    setNotes(data || []);
    setNotesLoading(false);
  }, [clip && clip.clip_uuid]);
  useSessionsEffect(() => { reloadNotes(); }, [reloadNotes]);

  // v03.36 — Load notes for the compare clip when one is set.
  const reloadNotesC = React.useCallback(async () => {
    if (!compareClip) { setNotesC([]); setNotesLoadingC(false); return; }
    setNotesLoadingC(true);
    const { data } = await SA.listNotesForClip(compareClip.clip_uuid);
    setNotesC(data || []);
    setNotesLoadingC(false);
  }, [compareClip && compareClip.clip_uuid]);
  useSessionsEffect(() => { reloadNotesC(); }, [reloadNotesC]);

  // Phase 4 — Load annotations for both videos. Defensive: if
  // the v03.32 SQL hasn't been applied yet the lib returns an
  // empty array and a console.warn — the rest of the workspace
  // keeps working unaffected.
  const reloadPrimaryAnnots = React.useCallback(async () => {
    if (!SA.listAnnotationsForClip) return;
    const { data } = await SA.listAnnotationsForClip(clip.clip_uuid);
    setAnnotsP(data || []);
  }, [clip && clip.clip_uuid]);
  useSessionsEffect(() => { reloadPrimaryAnnots(); }, [reloadPrimaryAnnots]);

  const reloadCompareAnnots = React.useCallback(async () => {
    if (!compareClip || !SA.listAnnotationsForClip) { setAnnotsC([]); return; }
    const { data } = await SA.listAnnotationsForClip(compareClip.clip_uuid);
    setAnnotsC(data || []);
  }, [compareClip && compareClip.clip_uuid]);
  useSessionsEffect(() => { reloadCompareAnnots(); }, [reloadCompareAnnots]);

  // Phase 5 — tag loaders.
  const reloadMyTags = React.useCallback(async () => {
    if (!SA.listMyTags) return;
    const { data } = await SA.listMyTags();
    setMyTags(data || []);
  }, []);
  useSessionsEffect(() => { reloadMyTags(); }, [reloadMyTags]);

  const reloadTagsP = React.useCallback(async () => {
    if (!SA.listTagsForClip) return;
    const { data } = await SA.listTagsForClip(clip.clip_uuid);
    setTagsP(data || []);
  }, [clip && clip.clip_uuid]);
  useSessionsEffect(() => { reloadTagsP(); }, [reloadTagsP]);

  const reloadTagsC = React.useCallback(async () => {
    if (!compareClip || !SA.listTagsForClip) { setTagsC([]); return; }
    const { data } = await SA.listTagsForClip(compareClip.clip_uuid);
    setTagsC(data || []);
  }, [compareClip && compareClip.clip_uuid]);
  useSessionsEffect(() => { reloadTagsC(); }, [reloadTagsC]);

  // Tag handlers — gate at the call site so the popover never
  // opens for free users in the first place. (Belt-and-braces:
  // RLS would still reject writes if a free user found a way to
  // call these directly.)
  const openTagPicker = (side) => {
    if (!isPro) { onUpgrade?.(); return; }
    setTagPickerSide(side);
  };
  const closeTagPicker = () => setTagPickerSide(null);
  const onToggleTag = async (side, tag, isApplied) => {
    const c = side === 'compare' ? compareClip : clip;
    if (!c) return;
    if (isApplied) {
      const { ok, error } = await SA.removeTagFromClip(c.clip_uuid, tag.tag_uuid);
      if (!ok) { alert('Could not remove tag: ' + (error?.message || 'unknown')); return; }
    } else {
      const { error } = await SA.applyTagToClip(c.clip_uuid, tag.tag_uuid);
      if (error) { alert('Could not apply tag: ' + (error.message || 'unknown')); return; }
    }
    if (side === 'compare') await reloadTagsC();
    else                    await reloadTagsP();
  };
  const onCreateTag = async (side, name, color) => {
    const c = side === 'compare' ? compareClip : clip;
    if (!c) return;
    const { data: tag, error } = await SA.createTag({ name, color });
    if (error || !tag) {
      alert('Could not create tag: ' + (error?.message || 'unknown'));
      return;
    }
    await SA.applyTagToClip(c.clip_uuid, tag.tag_uuid);
    await reloadMyTags();
    if (side === 'compare') await reloadTagsC();
    else                    await reloadTagsP();
  };

  // v03.38 — delete a tag from the user's library. Cascades via
  // FK to remove all assignments referencing it, so the chip
  // also disappears from any clip it was on.
  const onDeleteTagFromLibrary = async (tag) => {
    if (!tag || !tag.tag_uuid) return;
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: t('sessions.deleteTagConfirm', { name: tag.name }), isDanger: true, confirmLabel: t('sessions.deleteTagTooltip') })
      : window.confirm(t('sessions.deleteTagConfirm', { name: tag.name }));
    if (!proceed) return;
    const { ok, error } = await SA.deleteTag(tag.tag_uuid);
    if (!ok) {
      alert('Could not delete tag: ' + (error?.message || 'unknown'));
      return;
    }
    await reloadMyTags();
    await reloadTagsP();
    if (compareClip) await reloadTagsC();
  };

  // Esc cancels the composer (workspace is no longer a modal).
  useSessionsEffect(() => {
    if (!composer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setComposer(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [composer]);

  // Helpers
  // v03.36 — All note actions now take a `side` arg so compare-side
  // notes work independently of primary-side notes.
  const seekFor = (side, sec) => {
    const v = (side === 'compare' ? compareVideoRef : videoRef).current;
    if (!v) return;
    try { v.currentTime = Number(sec) || 0; } catch (_) {}
  };
  const openComposer = (side) => {
    const v = (side === 'compare' ? compareVideoRef : videoRef).current;
    const t = v ? v.currentTime : 0;
    try { v && v.pause(); } catch (_) {}
    setComposer({ side: side || 'primary', tSec: t, text: '' });
  };
  const saveNote = async () => {
    if (!composer || !composer.text.trim()) { setComposer(null); return; }
    const side = composer.side || 'primary';
    const targetClipUuid = side === 'compare' ? compareClip.clip_uuid : clip.clip_uuid;
    setSaving(true);
    const role = isSuperAdmin ? 'coach' : 'athlete';
    const { error } = await SA.addClipNote({
      clipUuid:   targetClipUuid,
      tSec:       composer.tSec,
      text:       composer.text,
      authorRole: role,
    });
    setSaving(false);
    if (error) {
      alert(t('sessions.couldNotSave') + (error.message || 'unknown error'));
      return;
    }
    setComposer(null);
    if (side === 'compare') await reloadNotesC();
    else                    await reloadNotes();
  };
  const removeNote = async (note, side) => {
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: t('sessions.deleteNoteConfirm'), isDanger: true, confirmLabel: t('sessions.deleteNote') })
      : window.confirm(t('sessions.deleteNoteConfirm'));
    if (!proceed) return;
    const { ok, error } = await SA.deleteClipNote(note.note_uuid);
    if (!ok) {
      alert(t('sessions.couldNotDelete') + ((error && error.message) || 'unknown error'));
      return;
    }
    if (side === 'compare') await reloadNotesC();
    else                    await reloadNotes();
  };

  // ── Phase 4 annotate actions ─────────────────────────────────
  const enterDrawMode = (target) => {
    // Pause the relevant video so the user is drawing on a
    // frozen frame, reset the draft strokes, and switch to the
    // default pen tool.
    const v = target === 'compare' ? compareVideoRef.current : videoRef.current;
    try { v && v.pause(); } catch (_) {}
    setDrawTarget(target);
    setTool('pen');
    setStrokeColor(ANNOTATE_COLORS[0].value);
    setDraftStrokes([]);
    setAnnotLabel('');
  };
  const cancelDraw = () => {
    setDrawTarget(null);
    setDraftStrokes([]);
    setAnnotLabel('');
  };
  const undoDraft = () => {
    setDraftStrokes(s => s.slice(0, -1));
  };
  const clearDraft = () => setDraftStrokes([]);
  const saveAnnotation = async () => {
    if (!drawTarget || draftStrokes.length === 0) { cancelDraw(); return; }
    const targetClipUuid = drawTarget === 'compare' ? compareClip.clip_uuid : clip.clip_uuid;
    const tSec = drawTarget === 'compare'
      ? (compareVideoRef.current ? compareVideoRef.current.currentTime : 0)
      : (videoRef.current ? videoRef.current.currentTime : 0);
    setSavingAnnot(true);
    const role = isSuperAdmin ? 'coach' : 'athlete';
    const { error } = await SA.addClipAnnotation({
      clipUuid: targetClipUuid,
      tSec,
      strokes: draftStrokes,
      label: annotLabel,
      authorRole: role,
    });
    setSavingAnnot(false);
    if (error) {
      alert(t('sessions.couldNotSave') + (error.message || 'unknown error'));
      return;
    }
    cancelDraw();
    if (drawTarget === 'compare') await reloadCompareAnnots();
    else await reloadPrimaryAnnots();
  };
  const removeAnnotation = async (annot, which) => {
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: t('sessions.deleteAnnotationConfirm'), isDanger: true, confirmLabel: t('sessions.deleteAnnotation') })
      : window.confirm(t('sessions.deleteAnnotationConfirm'));
    if (!proceed) return;
    const { ok, error } = await SA.deleteClipAnnotation(annot.annotation_uuid);
    if (!ok) {
      alert(t('sessions.couldNotDelete') + ((error && error.message) || 'unknown error'));
      return;
    }
    if (which === 'compare') await reloadCompareAnnots();
    else await reloadPrimaryAnnots();
  };

  // Other clips available for compare (exclude the primary itself).
  const otherClips = (clipsInSession || []).filter(c => c.clip_uuid !== clip.clip_uuid);
  const compareOn = !!compareClip;

  // ── JSX building blocks ──────────────────────────────────────
  // Each block is computed once so the three layout cases below
  // (mobile / desktop-no-compare / desktop-compare) can arrange
  // them without duplicating markup.

  // v03.28b — equal-height videos in compare mode.
  // In compare mode both video boxes get the same aspect-ratio
  // and the inner <video> uses object-fit:contain so videos
  // with different aspect ratios letterbox cleanly without one
  // being taller than the other. Outside compare mode the
  // single primary video keeps its old max-height behavior.
  const videoBoxStyleCompare = {
    background: 'var(--ink)', borderRadius: 12, overflow: 'hidden',
    border: '1px solid var(--line-soft)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    aspectRatio: '16 / 9',
    width: '100%',
  };
  const videoElStyleCompare = {
    width: '100%', height: '100%',
    objectFit: 'contain',
    display: 'block', background: 'var(--ink)',
  };

  const primaryBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* v03.30 — mirror the compare column's header on the
          primary side when comparing, so both video boxes start
          at the same Y coordinate and visually read as the same
          size. Outside compare mode the primary has no header. */}
      {compareOn && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 4px', gap: 8,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="eyebrow" style={{ color: 'var(--signal-eff)' }}>
              {t('sessions.primaryBadge')} · {clip.title || ('Clip · ' + (clip.order_idx + 1))}
            </span>
            {sessionShared && <TeamSharedChip/>}
          </span>
          {/* Invisible placeholder that takes the same vertical
              space as the Close button on the compare side, so
              the two headers line up perfectly. */}
          <span aria-hidden="true" style={{
            visibility: 'hidden',
            font: '600 11px var(--font-ui)',
            padding: '4px 9px', borderRadius: 999,
            border: '1px solid transparent',
          }}>
            Close
          </span>
        </div>
      )}
      <div style={{
        ...(compareOn ? videoBoxStyleCompare : {
          background: 'var(--ink)', borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--line-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 200,
        }),
        position: 'relative',
      }}>
        {phase === 'loading' && (
          <div style={{ color: 'var(--tx-md)', font: '500 13px var(--font-ui)', padding: 30 }}>
            {t('sessions.loadingVideo')}
          </div>
        )}
        {phase === 'error' && (
          <div style={{ color: 'var(--flag-eff)', font: '500 13px var(--font-ui)', padding: 30 }}>
            {err || t('sessions.cantLoadVideo')}
          </div>
        )}
        {phase === 'ready' && url && (
          <video
            ref={videoRef}
            src={url}
            controls
            playsInline
            onRateChange={primaryCtl.onRateChange}
            onTimeUpdate={(e) => {
              primaryCtl.onTimeUpdate(e);
              const v = videoRef.current;
              if (v) setPrimaryTime(v.currentTime);
            }}
            style={compareOn ? videoElStyleCompare : {
              width: '100%',
              maxHeight: isMobile ? '50vh' : '70vh',
              display: 'block', background: 'var(--ink)',
            }}
          />
        )}
        {/* Phase 4 — annotation layers for primary video */}
        {phase === 'ready' && (
          <AnnotationCanvas
            annotations={annotsP}
            currentTime={primaryTime}
            drawMode={drawTarget === 'primary'}
            tool={tool}
            color={strokeColor}
            draftStrokes={draftStrokes}
            onAddStroke={(s) => setDraftStrokes(arr => [...arr, s])}
          />
        )}
      </div>
      {/* v03.42 — toolbar split into two rows so it never wraps
          awkwardly. Top row = playback (Frame / Speed / A‑B).
          Bottom row = metadata actions (Tags / Annotate / Share). */}
      <ClipToolbar
        variant="playback"
        disabled={phase !== 'ready'}
        playbackRate={primaryCtl.playbackRate}
        speeds={SPEEDS}
        onRate={primaryCtl.applyRate}
        onStepBack={() => primaryCtl.stepFrame(-1)}
        onStepFwd={() => primaryCtl.stepFrame(+1)}
        aSec={primaryCtl.aSec}
        bSec={primaryCtl.bSec}
        looping={primaryCtl.looping}
        canLoop={primaryCtl.canLoop}
        onSetA={primaryCtl.captureA}
        onSetB={primaryCtl.captureB}
        onToggleLoop={primaryCtl.toggleLoop}
        onClearAB={primaryCtl.clearAB}
      />
      <ClipToolbar
        variant="actions"
        disabled={phase !== 'ready'}
        annotateMode={drawTarget === 'primary'}
        onAnnotate={() => (drawTarget === 'primary' ? cancelDraw() : enterDrawMode('primary'))}
        onTags={() => openTagPicker('primary')}
        tagsLocked={!isPro}
        tagCount={(tagsP || []).length}
      />
      {/* Tag chips for primary clip */}
      <TagChipStrip
        chips={tagsP}
        currentUserId={currentUserId}
        onRemove={(t) => onToggleTag('primary', t, true)}
        accent="primary"
      />
      {/* Tag picker popover (primary) */}
      {tagPickerSide === 'primary' && (
        <TagPicker
          myTags={myTags}
          appliedTagUuids={(tagsP || []).map(t => t.tag_uuid)}
          onToggle={(t, applied) => onToggleTag('primary', t, applied)}
          onCreate={(name, color) => onCreateTag('primary', name, color)}
          onDelete={onDeleteTagFromLibrary}
          onClose={closeTagPicker}
          accent="primary"
        />
      )}
    </div>
  );

  const compareBlock = compareOn ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px', gap: 8,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="eyebrow" style={{ color: 'var(--compare-eff)' }}>
            {t('sessions.compareBadge')} · {compareClip.title || ('Clip · ' + (compareClip.order_idx + 1))}
          </span>
          {sessionShared && <TeamSharedChip/>}
        </span>
        <button type="button" onClick={() => onSetCompare(null)}
          style={{
            font: '600 11px var(--font-ui)', letterSpacing: 0.02,
            padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', color: 'var(--tx-md)',
            border: '1px solid var(--line-soft)',
          }}>
          {t('sessions.closeCompare')}
        </button>
      </div>
      <div style={{
        ...videoBoxStyleCompare,
        border: '1px solid var(--compare-eff)',
        position: 'relative',
      }}>
        {comparePhase === 'loading' && (
          <div style={{ color: 'var(--tx-md)', font: '500 13px var(--font-ui)', padding: 30 }}>
            {t('sessions.loadingCompareVideo')}
          </div>
        )}
        {comparePhase === 'error' && (
          <div style={{ color: 'var(--flag-eff)', font: '500 13px var(--font-ui)', padding: 30 }}>
            {t('sessions.cantLoadCompareVideo')}
          </div>
        )}
        {comparePhase === 'ready' && compareUrl && (
          <video
            ref={compareVideoRef}
            src={compareUrl}
            controls
            playsInline
            onRateChange={compareCtl.onRateChange}
            onTimeUpdate={(e) => {
              compareCtl.onTimeUpdate(e);
              const v = compareVideoRef.current;
              if (v) setCompareTime(v.currentTime);
            }}
            style={videoElStyleCompare}
          />
        )}
        {comparePhase === 'ready' && (
          <AnnotationCanvas
            annotations={annotsC}
            currentTime={compareTime}
            drawMode={drawTarget === 'compare'}
            tool={tool}
            color={strokeColor}
            draftStrokes={draftStrokes}
            onAddStroke={(s) => setDraftStrokes(arr => [...arr, s])}
          />
        )}
      </div>
      <ClipToolbar
        variant="playback"
        disabled={comparePhase !== 'ready'}
        playbackRate={compareCtl.playbackRate}
        speeds={SPEEDS}
        onRate={compareCtl.applyRate}
        onStepBack={() => compareCtl.stepFrame(-1)}
        onStepFwd={() => compareCtl.stepFrame(+1)}
        aSec={compareCtl.aSec}
        bSec={compareCtl.bSec}
        looping={compareCtl.looping}
        canLoop={compareCtl.canLoop}
        onSetA={compareCtl.captureA}
        onSetB={compareCtl.captureB}
        onToggleLoop={compareCtl.toggleLoop}
        onClearAB={compareCtl.clearAB}
        accent="compare"
      />
      <ClipToolbar
        variant="actions"
        disabled={comparePhase !== 'ready'}
        accent="compare"
        annotateMode={drawTarget === 'compare'}
        onAnnotate={() => (drawTarget === 'compare' ? cancelDraw() : enterDrawMode('compare'))}
        onTags={() => openTagPicker('compare')}
        tagsLocked={!isPro}
        tagCount={(tagsC || []).length}
      />
      <TagChipStrip
        chips={tagsC}
        currentUserId={currentUserId}
        onRemove={(t) => onToggleTag('compare', t, true)}
        accent="compare"
      />
      {tagPickerSide === 'compare' && (
        <TagPicker
          myTags={myTags}
          appliedTagUuids={(tagsC || []).map(t => t.tag_uuid)}
          onToggle={(t, applied) => onToggleTag('compare', t, applied)}
          onCreate={(name, color) => onCreateTag('compare', name, color)}
          onDelete={onDeleteTagFromLibrary}
          onClose={closeTagPicker}
          accent="compare"
        />
      )}
    </div>
  ) : null;

  // v03.36 — Side-aware notes panel builder. Renders one card
  // per video (primary / compare) so each side has its own
  // composer + list. When compare is on, two cards sit
  // side-by-side; otherwise just the primary card.
  const buildNotesPanel = (side) => {
    const isCompare = side === 'compare';
    const accent = isCompare ? 'var(--compare-eff)' : 'var(--signal-eff)';
    const sideClip   = isCompare ? compareClip : clip;
    const sideNotes  = isCompare ? notesC : notes;
    const sideLoad   = isCompare ? notesLoadingC : notesLoading;
    const sideAnnots = isCompare ? annotsC : annotsP;
    const sidePhase  = isCompare ? comparePhase : phase;
    const ready      = sidePhase === 'ready';
    const composerForThis = composer && composer.side === side ? composer : null;

    const combined = [
      ...(sideNotes  || []).map(n => ({ kind: 'note',        t_sec: n.t_sec, _id: n.note_uuid,       _row: n })),
      ...(sideAnnots || []).map(a => ({ kind: 'annotation',  t_sec: a.t_sec, _id: a.annotation_uuid, _row: a })),
    ].sort((a, b) => (a.t_sec || 0) - (b.t_sec || 0));

    return (
      <div style={{
        background: 'var(--bg-2)', borderRadius: 12,
        border: '1px solid var(--line-soft)',
        display: 'flex', flexDirection: 'column',
        minHeight: 240,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--line-soft)',
          flexShrink: 0, gap: 8,
        }}>
          <span className="eyebrow" style={{ color: compareOn ? accent : 'var(--tx-lo)' }}>
            {compareOn ? (isCompare ? t('sessions.compareNotes') : t('sessions.primaryNotes')) : t('sessions.notesHeader')}
          </span>
          {!composerForThis && (
            <button type="button" onClick={() => openComposer(side)}
              disabled={!ready}
              style={{
                font: '700 11px var(--font-ui)', letterSpacing: 0.04,
                padding: '5px 11px', borderRadius: 999, cursor: ready ? 'pointer' : 'default',
                background: accent, color: 'var(--ink)',
                border: 'none', opacity: ready ? 1 : 0.5,
              }}>
              {t('sessions.addAtTime')}
            </button>
          )}
        </div>

        {composerForThis && (
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line-soft)',
            background: 'color-mix(in oklch, ' + accent + ' 5%, var(--bg-2))',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div className="eyebrow" style={{ color: accent }}>
              {t('sessions.newNoteEyebrow')} · {SA.fmtTimestamp(composerForThis.tSec)}
            </div>
            <textarea
              value={composerForThis.text}
              onChange={(e) => setComposer({ ...composerForThis, text: e.target.value })}
              placeholder={t('sessions.notePlaceholder')}
              autoFocus
              rows={3}
              style={{
                width: '100%', resize: 'vertical',
                padding: 8, borderRadius: 8,
                border: '1px solid var(--line)', background: 'var(--bg-3)',
                color: 'var(--tx-hi)', font: '500 13px/1.5 var(--font-ui)',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setComposer(null)}
                style={{
                  padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', color: 'var(--tx-md)',
                  border: '1px solid var(--line-soft)',
                  font: '600 11px var(--font-ui)',
                }}>{t('sessions.cancel')}</button>
              <button type="button" onClick={saveNote}
                disabled={saving || !composerForThis.text.trim()}
                style={{
                  padding: '5px 13px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
                  background: accent, color: 'var(--ink)',
                  border: 'none', font: '700 11px var(--font-ui)',
                  opacity: (saving || !composerForThis.text.trim()) ? 0.55 : 1,
                }}>
                {saving ? t('sessions.saving') : t('sessions.saveNote')}
              </button>
            </div>
          </div>
        )}

        <div style={{
          // v03.42 — bumped compare cap from 40vh → 60vh now
          // that notes sit below the videos in their own row,
          // and added a small bottom-edge fade to hint at
          // overflow when there's more list below the cap.
          flex: 1, minHeight: 0,
          padding: '8px 14px 14px',
          maxHeight: isMobile ? 'none' : '60vh',
          overflowY: 'auto',
          // Mask gradient fades the last ~24px so users see
          // there's more content below; native scrollbar still
          // visible alongside.
          maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 24px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 24px), transparent 100%)',
        }}>
          {sideLoad ? (
            <div style={{
              font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
              textAlign: 'center', padding: '14px 0',
            }}>{t('sessions.loadingNotes')}</div>
          ) : combined.length === 0 ? (
            <div style={{
              font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
              textAlign: 'center', padding: '20px 4px', lineHeight: 1.5,
            }}>
              {t('sessions.emptyNotes')}<br/>
              {t('sessions.emptyNotesPrompt')} <b style={{ color:'var(--tx-md)' }}>{t('sessions.addAtTime')}</b> {t('sessions.cancel') === 'Cancel' ? 'or' : 'o'} <b style={{ color:'var(--tx-md)' }}>{t('sessions.annotate')}</b>.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {combined.map(e => e.kind === 'note' ? (
                <NoteRow key={'n_' + e._id}
                  note={e._row}
                  isAuthor={currentUserId && e._row.author_uuid === currentUserId}
                  onSeek={() => seekFor(side, e._row.t_sec)}
                  onDelete={() => removeNote(e._row, side)}/>
              ) : (
                <AnnotationRow key={'a_' + e._id}
                  annot={e._row}
                  isAuthor={currentUserId && e._row.author_uuid === currentUserId}
                  onSeek={() => seekFor(side, e._row.t_sec)}
                  onDelete={() => removeAnnotation(e._row, side)}/>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Single primary panel (no compare) OR side-by-side
  // primary/compare panels.
  const notesBlock = compareOn ? (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
      gap: isMobile ? 14 : 18,
      alignItems: 'start',
    }}>
      {buildNotesPanel('primary')}
      {buildNotesPanel('compare')}
    </div>
  ) : buildNotesPanel('primary');

  // Phase 4 — floating tool palette + save bar. Visible only
  // while a draw session is active on either video.
  const annotateBar = drawTarget ? (
    <AnnotateBar
      target={drawTarget}
      tool={tool} onTool={setTool}
      color={strokeColor} onColor={setStrokeColor}
      strokeCount={draftStrokes.length}
      label={annotLabel} onLabel={setAnnotLabel}
      saving={savingAnnot}
      onUndo={undoDraft}
      onClear={clearDraft}
      onCancel={cancelDraw}
      onSave={saveAnnotation}
    />
  ) : null;

  // ── Layout (v03.28) ──────────────────────────────────────────
  // Three cases:
  //   1. mobile — stack everything (primary, [compare], notes)
  //   2. desktop, no compare — video | notes  (2-col, current)
  //   3. desktop, compare on — videos in a 1fr/1fr row on top,
  //      notes pane full-width below them. (Replaces v03.27's
  //      3-column layout, which squeezed every column too thin.)
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {annotateBar}
        {primaryBlock}
        {compareBlock}
        {notesBlock}
      </div>
    );
  }
  if (compareOn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {annotateBar}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 18,
          alignItems: 'start',
        }}>
          {primaryBlock}
          {compareBlock}
        </div>
        {notesBlock}
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0,
    }}>
      {annotateBar}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)',
        gap: 18,
        alignItems: 'start',
        minWidth: 0,
      }}>
        {primaryBlock}
        {notesBlock}
      </div>
    </div>
  );
};

// ── AnnotationCanvas (Phase 4) ───────────────────────────────
// Absolutely positioned canvas overlay on top of a <video>.
// Two responsibilities:
//   1. Display mode (drawMode=false) — render any annotations
//      whose `t_sec` is within ANNOTATE_DWELL_S/2 of currentTime.
//      pointerEvents: 'none' so the user can still scrub the
//      native controls underneath.
//   2. Draw mode (drawMode=true) — accept mouse/touch input,
//      buffer the in-progress stroke as the user drags, and
//      commit the stroke to draftStrokes on pointer-up. Also
//      renders the parent's draftStrokes array so prior strokes
//      from the same session are visible while the next is being
//      drawn.
// All coordinates are normalized to [0..1] of the canvas box.
const AnnotationCanvas = ({
  annotations, currentTime,
  drawMode, tool, color, draftStrokes, onAddStroke,
}) => {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const size = useElementSize(wrapRef);
  const SA = window.PA_SESSIONS;
  // In-progress stroke during a mouse-drag — points are pushed
  // onto this then committed via onAddStroke at pointer-up.
  const [inProgress, setInProgress] = useSessionsState(null);

  // Repaint whenever annotations / draft strokes / current time
  // / size change. Cheap — a coaching video annotation usually
  // has well under 100 points total.
  useSessionsEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    // Resize canvas drawing buffer to match its rendered CSS
    // size (account for devicePixelRatio so lines stay crisp).
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(size.width  * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // Pass 1: saved annotations near the playhead (display mode
    // only — during draw mode the canvas is a blank slate).
    if (!drawMode) {
      const dwellHalf = ANNOTATE_DWELL_S / 2;
      (annotations || []).forEach(a => {
        if (!a || a.t_sec == null) return;
        if (Math.abs(currentTime - a.t_sec) > dwellHalf) return;
        const strokes = Array.isArray(a.strokes) ? a.strokes : [];
        strokes.forEach(s => SA.renderStroke(ctx, s, size.width, size.height));
      });
    }
    // Pass 2: committed draft strokes (visible during draw mode
    // so the user sees previous strokes while drawing the next).
    if (drawMode) {
      (draftStrokes || []).forEach(s => SA.renderStroke(ctx, s, size.width, size.height));
      if (inProgress) SA.renderStroke(ctx, inProgress, size.width, size.height);
    }
  }, [annotations, currentTime, drawMode, draftStrokes, inProgress,
      size.width, size.height]);

  // ── Pointer handlers (draw mode only) ───────────────────────
  const toNorm = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return {
      x: Math.max(0, Math.min(1, cx / rect.width)),
      y: Math.max(0, Math.min(1, cy / rect.height)),
    };
  };
  const onDown = (e) => {
    if (!drawMode) return;
    e.preventDefault();
    const p = toNorm(e);
    setInProgress({
      tool, color, width: ANNOTATE_STROKE_W,
      points: [p],
    });
  };
  const onMove = (e) => {
    if (!drawMode || !inProgress) return;
    e.preventDefault();
    const p = toNorm(e);
    setInProgress(s => {
      if (!s) return s;
      if (s.tool === 'pen') return { ...s, points: [...s.points, p] };
      // Shape tools — replace the trailing point so the preview
      // tracks the cursor while dragging.
      return { ...s, points: [s.points[0], p] };
    });
  };
  const onUp = () => {
    if (!drawMode || !inProgress) return;
    // Reject zero-length strokes (just a click without drag).
    const pts = inProgress.points;
    if (pts.length < 2) { setInProgress(null); return; }
    onAddStroke(inProgress);
    setInProgress(null);
  };

  return (
    <div ref={wrapRef} style={{
      position: 'absolute', inset: 0,
      pointerEvents: drawMode ? 'auto' : 'none',
      // In draw mode, paint a subtle vignette so the user knows
      // the canvas is "live" — and stop scrolling/dragging on
      // touch devices from interfering.
      touchAction: drawMode ? 'none' : 'auto',
      cursor: drawMode ? 'crosshair' : 'default',
    }}>
      <canvas ref={canvasRef}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        style={{
          width: '100%', height: '100%',
          display: 'block',
        }}/>
    </div>
  );
};

// ── AnnotateBar (Phase 4) ────────────────────────────────────
// Floating top-of-workspace bar shown while annotating. Lets
// the user pick a tool, switch color, type an optional label,
// undo / clear / cancel / save. The actual drawing happens on
// the AnnotationCanvas inside the relevant video box.
const AnnotateBar = ({
  target,
  tool, onTool,
  color, onColor,
  strokeCount,
  label, onLabel,
  saving,
  onUndo, onClear, onCancel, onSave,
}) => {
  const t = (window.useT || (() => (k) => k))();
  const isCompare = target === 'compare';
  const accent = isCompare ? 'var(--compare-eff)' : 'var(--signal-eff)';
  const toolLabel = {
    pen: t('sessions.toolPen'), line: t('sessions.toolLine'),
    arrow: t('sessions.toolArrow'), circle: t('sessions.toolCircle'),
    rectangle: t('sessions.toolRect'),
  };
  const pill = {
    font: '600 11px var(--font-ui)', letterSpacing: 0.02,
    padding: '5px 10px', borderRadius: 999,
    background: 'transparent', color: 'var(--tx-md)',
    border: '1px solid var(--line-soft)',
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    whiteSpace: 'nowrap',
  };
  const pillActive = {
    ...pill,
    background: 'color-mix(in oklch, ' + accent + ' 18%, transparent)',
    color: accent, border: '1px solid ' + accent,
  };
  return (
    <div style={{
      background: 'color-mix(in oklch, ' + accent + ' 6%, var(--bg-2))',
      border: '1px solid ' + accent,
      borderRadius: 12,
      padding: '10px 12px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
    }}>
      <span className="eyebrow" style={{ color: accent }}>
        {isCompare ? t('sessions.annotateBarCompare') : t('sessions.annotateBarPrimary')}
      </span>

      {/* Tool selector */}
      <div style={{ display: 'flex', gap: 4 }}>
        {ANNOTATE_TOOLS.map(tk => (
          <button key={tk} type="button" onClick={() => onTool(tk)}
            style={tool === tk ? pillActive : pill}>
            {toolLabel[tk] || tk}
          </button>
        ))}
      </div>

      {/* Color swatches */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {ANNOTATE_COLORS.map(c => {
          const sel = c.value === color;
          return (
            <button key={c.key} type="button" onClick={() => onColor(c.value)}
              aria-label={c.key}
              style={{
                width: 22, height: 22, borderRadius: 999, cursor: 'pointer',
                background: c.value,
                border: '2px solid ' + (sel ? 'var(--tx-hi)' : 'transparent'),
                outline: sel ? '1px solid ' + c.value : 'none',
                outlineOffset: 1,
              }}/>
          );
        })}
      </div>

      {/* Label input */}
      <input type="text"
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder={t('sessions.annotateLabelPlaceholder')}
        maxLength={80}
        style={{
          flex: '1 1 180px', minWidth: 140,
          padding: '6px 9px', borderRadius: 8,
          border: '1px solid var(--line-soft)', background: 'var(--bg-3)',
          color: 'var(--tx-hi)', font: '500 12px var(--font-ui)',
        }}/>

      {/* Action pills */}
      <button type="button" onClick={onUndo}
        disabled={strokeCount === 0}
        style={{ ...pill, opacity: strokeCount === 0 ? 0.5 : 1 }}>
        {t('sessions.undo')}
      </button>
      <button type="button" onClick={onClear}
        disabled={strokeCount === 0}
        style={{ ...pill, opacity: strokeCount === 0 ? 0.5 : 1 }}>
        {t('sessions.clear')}
      </button>
      <button type="button" onClick={onCancel} style={pill}>
        {t('sessions.cancel')}
      </button>
      <button type="button" onClick={onSave}
        disabled={saving || strokeCount === 0}
        style={{
          ...pillActive,
          background: accent, color: 'var(--ink)',
          border: 'none',
          font: '700 11px var(--font-ui)',
          opacity: (saving || strokeCount === 0) ? 0.5 : 1,
        }}>
        {saving ? t('sessions.saving') : t('sessions.saveAnnotation')}
      </button>
    </div>
  );
};

// ── ClipToolbar (v03.27, updated v03.28) — Pro v1 video controls
// Single strip directly under a <video>. Four groups, separated
// by thin dividers, wraps to multiple rows on narrower viewports:
//   [‹ Frame]  [Frame ›]            — frame-by-frame
//   [0.25× 0.5× 1× 1.5× 2×]         — playback speed
//   [Set A] [Set B] [Loop] [Clear]  — A/B range loop
//   [+ Compare]                     — primary only, hidden when comparing
//
// v03.28: dropped the "Comparing: X · Stop" chip — each video
// now owns its own toolbar, and the compare clip card carries
// its own Close button in the header. `enableCompare` controls
// whether the compare picker section renders at all.
const ClipToolbar = ({
  disabled,
  playbackRate, speeds, onRate,
  onStepBack, onStepFwd,
  aSec, bSec, looping, canLoop,
  onSetA, onSetB, onToggleLoop, onClearAB,
  enableCompare,
  hasOtherClips, showComparePicker,
  onOpenComparePicker, onPickCompare,
  otherClips,
  annotateMode, onAnnotate, // Phase 4 — toggle draw mode
  onTags, tagsLocked, tagCount, // Phase 5 — open tag picker
  canShare, shareOn, onShare, // Phase 6 — coach team-share toggle
  variant, // v03.42 — 'playback' | 'actions' | undefined (= all)

  accent, // 'compare' → use --compare-eff (purple) for active pills
          //  default  → use --signal-eff  (theme green/teal)
          // Matches the Primary / Compare color convention used in
          // Races / Starts / Turns slot styling.
}) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const t = (window.useT || (() => (k) => k))();
  const accentVar = accent === 'compare' ? 'var(--compare-eff)' : 'var(--signal-eff)';
  const pillBase = {
    font: '600 11px var(--font-ui)', letterSpacing: 0.02,
    padding: '5px 10px', borderRadius: 999,
    background: 'transparent', color: 'var(--tx-md)',
    border: '1px solid var(--line-soft)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 5,
    whiteSpace: 'nowrap',
  };
  const pillActive = {
    ...pillBase,
    background: 'color-mix(in oklch, ' + accentVar + ' 16%, transparent)',
    color: accentVar,
    border: '1px solid ' + accentVar,
  };
  const pillPrimary = {
    ...pillBase,
    background: accentVar,
    color: 'var(--ink)',
    border: 'none',
    font: '700 11px var(--font-ui)',
  };
  const divider = {
    width: 1, alignSelf: 'stretch',
    background: 'var(--line-soft)', margin: '0 2px',
  };

  return (
    <div style={{
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      borderRadius: 12, padding: '8px 10px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      position: 'relative',
    }}>
      {/* ── Playback row (variant: 'playback' or all) ───────── */}
      {variant !== 'actions' && (
        <>
          {/* Frame step */}
          <button type="button" onClick={onStepBack} disabled={disabled}
            title="Step back one frame (1/30 s)" style={pillBase}>
            {t('sessions.framePrev')}
          </button>
          <button type="button" onClick={onStepFwd} disabled={disabled}
            title="Step forward one frame (1/30 s)" style={pillBase}>
            {t('sessions.frameNext')}
          </button>

          <div style={divider}/>

          {/* Speed */}
          <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 2 }}>
            {t('sessions.speed')}
          </span>
          {speeds.map(r => {
            const active = Math.abs(playbackRate - r) < 0.01;
            return (
              <button key={r} type="button" onClick={() => onRate(r)} disabled={disabled}
                style={active ? pillActive : pillBase}>
                {r}×
              </button>
            );
          })}

          <div style={divider}/>

          {/* A/B loop */}
          <button type="button" onClick={onSetA} disabled={disabled}
            title="Capture A marker at current time"
            style={aSec != null ? pillActive : pillBase}>
            {t('sessions.setA')}{aSec != null ? ' · ' + SA.fmtTimestamp(aSec) : ''}
          </button>
          <button type="button" onClick={onSetB} disabled={disabled}
            title="Capture B marker at current time"
            style={bSec != null ? pillActive : pillBase}>
            {t('sessions.setB')}{bSec != null ? ' · ' + SA.fmtTimestamp(bSec) : ''}
          </button>
          <button type="button" onClick={onToggleLoop}
            disabled={disabled || !canLoop}
            title={canLoop ? (looping ? 'Stop A→B loop' : 'Loop A→B') : 'Set both A and B first'}
            style={{
              ...(looping ? pillActive : pillBase),
              opacity: (disabled || !canLoop) ? 0.5 : 1,
              cursor: (disabled || !canLoop) ? 'default' : 'pointer',
            }}>
            {looping ? t('sessions.loopingBtn') : t('sessions.loopBtn')}
          </button>
          {(aSec != null || bSec != null) && (
            <button type="button" onClick={onClearAB} disabled={disabled}
              title="Clear A and B" style={pillBase}>
              {t('sessions.clear')}
            </button>
          )}
        </>
      )}

      {/* ── Actions row (variant: 'actions' or all) ──────────── */}
      {variant !== 'playback' && onTags && (
        <>
          {variant !== 'actions' && <div style={divider}/>}
          <button type="button" onClick={onTags} disabled={disabled}
            title={tagsLocked ? t('sessions.tagsProGate') : 'Tag this clip'}
            style={pillBase}>
            {t('sessions.tagsBtn')}{tagCount > 0 ? ' · ' + tagCount : ''}
            {tagsLocked && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
            )}
          </button>
        </>
      )}
      {variant !== 'playback' && onAnnotate && (
        <>
          {variant !== 'actions' && <div style={divider}/>}
          <button type="button" onClick={onAnnotate} disabled={disabled}
            title={annotateMode ? 'Exit annotate mode' : 'Draw on a frozen frame'}
            style={annotateMode ? pillActive : pillBase}>
            {annotateMode ? '✏ ' + t('sessions.drawing') : t('sessions.annotate')}
          </button>
        </>
      )}
      {variant !== 'playback' && canShare && (
        <>
          {variant !== 'actions' && <div style={divider}/>}
          <button type="button" onClick={onShare} disabled={disabled}
            title={shareOn
              ? 'Currently in team library — click to remove'
              : 'Add this clip to the team library'}
            style={shareOn ? pillActive : pillBase}>
            ⇄ {shareOn ? 'In team library' : 'Share to team'}
          </button>
        </>
      )}
      {enableCompare && (
        <>
          <div style={divider}/>
          <button type="button"
            onClick={onOpenComparePicker}
            disabled={disabled || !hasOtherClips}
            title={hasOtherClips ? 'Pick a clip to compare side-by-side' : 'Need at least one other clip in this session'}
            style={{
              ...pillPrimary,
              opacity: (disabled || !hasOtherClips) ? 0.5 : 1,
              cursor: (disabled || !hasOtherClips) ? 'default' : 'pointer',
            }}>
            + Compare
          </button>
          {showComparePicker && hasOtherClips && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 8,
              minWidth: 220, maxWidth: 320,
              background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
              borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
              padding: 6, zIndex: 30,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div className="eyebrow" style={{
                color: 'var(--tx-lo)', padding: '6px 8px 4px',
              }}>
                COMPARE WITH
              </div>
              {otherClips.map(c => (
                <button key={c.clip_uuid} type="button"
                  onClick={() => onPickCompare(c.clip_uuid)}
                  style={{
                    textAlign: 'left',
                    padding: '7px 9px', borderRadius: 8, cursor: 'pointer',
                    background: 'transparent', color: 'var(--tx-hi)',
                    border: 'none',
                    font: '500 13px var(--font-ui)',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || ('Clip · ' + (c.order_idx + 1))}
                  </span>
                  {c.duration_s != null && (
                    <span className="mono" style={{
                      font: '500 10px var(--font-mono)', color: 'var(--tx-lo)',
                    }}>
                      {c.duration_s.toFixed(1)} s
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── NoteRow — one note in the right-column list ──────────────
// ── AnnotationRow (Phase 4) — one annotation in the panel ────
// Mirrors NoteRow's shape but the body shows a label + stroke
// count instead of a free-text body, and the role-color uses
// the saved drawing's first-stroke color when present so the
// row visually echoes the on-video annotation.
// ── TeamSharedChip (Phase 6) — read-only "⇄ team" badge ─────
// Renders inline next to a clip's title when the clip is in
// the team library. Lime-tinted so it pops against both the
// green PRIMARY and purple COMPARE eyebrows.
const TeamSharedChip = ({ subtitle }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    font: '700 9px var(--font-mono)', letterSpacing: 0.06,
    padding: '2px 7px', borderRadius: 4,
    background: 'color-mix(in oklch, var(--lime-eff) 14%, transparent)',
    color: 'var(--lime-eff)',
    border: '1px solid color-mix(in oklch, var(--lime-eff) 35%, transparent)',
    textTransform: 'uppercase',
  }}>
    ⇄ TEAM{subtitle ? ' · ' + subtitle : ''}
  </span>
);

// ── TagChipStrip (Phase 5) — render a clip's applied tags ────
// Each chip uses its tag's stored color. If the current user
// is the tag owner (or the one who tagged), an "x" appears on
// hover to remove the assignment.
const TagChipStrip = ({ chips, currentUserId, onRemove, accent }) => {
  if (!chips || !chips.length) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5,
      padding: '2px 4px',
    }}>
      {chips.map(t => {
        const color = t.color || tagColorFor('green');
        const canRemove = currentUserId
          && (t.tagged_by === currentUserId || t.tag_owner_uuid === currentUserId);
        return (
          <span key={t.assignment_uuid || t.tag_uuid}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              font: '600 10px var(--font-ui)', letterSpacing: 0.04,
              padding: '3px 7px', borderRadius: 999,
              background: 'color-mix(in oklch, ' + color + ' 16%, transparent)',
              color: color,
              border: '1px solid ' + color,
              textTransform: 'uppercase',
            }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999,
              background: color, flexShrink: 0,
            }}/>
            {t.name}
            {canRemove && (
              <button type="button" onClick={() => onRemove(t)}
                aria-label="Remove tag"
                style={{
                  marginLeft: 2,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'inherit', padding: 0, lineHeight: 1,
                  font: '700 11px var(--font-ui)',
                }}>
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
};

// ── TagPicker (Phase 5) — popover for adding/removing tags ───
// Shows the user's tag library as toggleable chips, plus a new
// tag input row at the bottom (name + color swatch + Add). The
// popover dismisses on outside click or Esc.
const TagPicker = ({ myTags, appliedTagUuids, onToggle, onCreate, onDelete, onClose, accent }) => {
  const t = (window.useT || (() => (k) => k))();
  const [name, setName] = useSessionsState('');
  const [color, setColor] = useSessionsState(TAG_COLORS[0].value);
  const popRef = React.useRef(null);

  // Esc dismisses; outside-click dismisses.
  useSessionsEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const applied = new Set(appliedTagUuids || []);
  const accentVar = accent === 'compare' ? 'var(--compare-eff)' : 'var(--signal-eff)';

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    setName('');
  };

  return (
    <div ref={popRef} style={{
      position: 'relative',
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      borderRadius: 12, padding: 12,
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      zIndex: 10,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span className="eyebrow" style={{ color: accentVar }}>
          {accent === 'compare' ? t('sessions.tagsHeaderCompare') : t('sessions.tagsHeaderPrimary')}
        </span>
        <button type="button" onClick={onClose}
          aria-label={t('sessions.done')}
          style={{
            font: '600 11px var(--font-ui)',
            padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', color: 'var(--tx-md)',
            border: '1px solid var(--line-soft)',
          }}>
          {t('sessions.done')}
        </button>
      </div>

      {/* Existing tag chips */}
      {myTags.length === 0 ? (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
          textAlign: 'center', padding: '8px 0',
        }}>
          {t('sessions.noTagsYet')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {myTags.map(tg => {
            const isOn = applied.has(tg.tag_uuid);
            const c = tg.color || tagColorFor('green');
            // Composite chip: the main pill toggles apply/remove on
            // the current clip; the trailing × button (only visible
            // when onDelete is wired) deletes the tag from the
            // user's library entirely (with a confirm).
            return (
              <span key={tg.tag_uuid} style={{
                display: 'inline-flex', alignItems: 'stretch',
                borderRadius: 999,
                border: '1px solid ' + (isOn ? c : 'var(--line-soft)'),
                background: isOn
                  ? 'color-mix(in oklch, ' + c + ' 18%, transparent)'
                  : 'var(--bg-3)',
                overflow: 'hidden',
              }}>
                <button type="button"
                  onClick={() => onToggle(tg, isOn)}
                  title={isOn ? 'Remove from this clip' : 'Apply to this clip'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    font: '600 11px var(--font-ui)', letterSpacing: 0.02,
                    padding: '5px 10px', cursor: 'pointer',
                    background: 'transparent',
                    color:  isOn ? c : 'var(--tx-md)',
                    border: 'none',
                  }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: 999,
                    background: c, flexShrink: 0,
                  }}/>
                  {tg.name}
                  {isOn && <span style={{ opacity: 0.8 }}>✓</span>}
                </button>
                {onDelete && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(tg); }}
                    title={t('sessions.deleteTagTooltip')}
                    aria-label={t('sessions.deleteTagTooltip')}
                    style={{
                      padding: '0 8px',
                      background: 'transparent',
                      color: isOn ? c : 'var(--tx-lo)',
                      borderLeft: '1px solid ' + (isOn ? c : 'var(--line-soft)'),
                      cursor: 'pointer',
                      font: '600 13px var(--font-ui)',
                      lineHeight: 1,
                    }}>
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* New tag row */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center',
        borderTop: '1px solid var(--line-soft)', paddingTop: 10,
      }}>
        <input type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder={t('sessions.newTagPlaceholder')}
          maxLength={40}
          style={{
            flex: '1 1 auto', minWidth: 0,
            padding: '6px 9px', borderRadius: 8,
            border: '1px solid var(--line-soft)', background: 'var(--bg-3)',
            color: 'var(--tx-hi)', font: '500 12px var(--font-ui)',
          }}/>
        {/* Color swatch row */}
        {TAG_COLORS.map(c => {
          const sel = c.value === color;
          return (
            <button key={c.key} type="button" onClick={() => setColor(c.value)}
              aria-label={c.key}
              title={c.key}
              style={{
                width: 18, height: 18, borderRadius: 999, cursor: 'pointer',
                background: c.value,
                border: '2px solid ' + (sel ? 'var(--tx-hi)' : 'transparent'),
              }}/>
          );
        })}
        <button type="button" onClick={handleCreate}
          disabled={!name.trim()}
          style={{
            font: '700 11px var(--font-ui)',
            padding: '5px 11px', borderRadius: 8,
            background: accentVar, color: 'var(--ink)',
            border: 'none',
            cursor: name.trim() ? 'pointer' : 'default',
            opacity: name.trim() ? 1 : 0.5,
          }}>
          {t('sessions.addBtn')}
        </button>
      </div>
    </div>
  );
};

// ── LibraryView (Phase 5) — flat clip list across sessions ───
// Top-level filter strip of every tag that's appeared on any
// visible clip; multi-select (ANY-match). List below is the
// flat results, newest first. Click a card → opens the clip
// in the workspace via SessionDetail (one-clip sessions array).
//
// Pro-gated: free users see a locked empty state instead of
// the clip list.
const LibraryView = ({ isMobile, isPro, onUpgrade, onOpenSession, onOpenClip, adminAthleteUuid }) => {
  const SA = window.PA_SESSIONS;
  const ES = window.EmptyState;
  const t = (window.useT || (() => (k) => k))();
  const [tagsState, setTagsState] = useSessionsState({ loading: true, rows: [] });
  // v03.51 — rows are now SESSIONS (decorated with clip count +
  // athlete name + share flag). Library grid renders one card
  // per session instead of one per clip — easier scanning when
  // a coach has many athletes' sessions visible.
  const [sessionsState, setSessionsState] = useSessionsState({ loading: true, rows: [] });
  const [selectedTagIds, setSelectedTagIds] = useSessionsState([]);
  // v03.39 — source filter: null = all, 'own' = mine, 'team' = teammates
  const [sourceFilter, setSourceFilter] = useSessionsState(null);

  useSessionsEffect(() => {
    let cancelled = false;
    (async () => {
      setTagsState({ loading: true, rows: [] });
      const { data } = await SA.listVisibleTagsAcrossClips();
      if (cancelled) return;
      setTagsState({ loading: false, rows: data || [] });
    })();
    return () => { cancelled = true; };
  }, []);

  useSessionsEffect(() => {
    if (!isPro) { setSessionsState({ loading: false, rows: [] }); return; }
    let cancelled = false;
    (async () => {
      setSessionsState({ loading: true, rows: [] });
      const { data } = await SA.listAllSessionsForLibrary({
        tagUuids: selectedTagIds.length ? selectedTagIds : null,
        source:   sourceFilter,
        viewerAthleteUuid: adminAthleteUuid,
      });
      if (cancelled) return;
      setSessionsState({ loading: false, rows: data || [] });
    })();
    return () => { cancelled = true; };
  }, [isPro, selectedTagIds.join(','), sourceFilter, adminAthleteUuid]);

  // Pro upsell — free users see this instead of the library.
  if (!isPro) {
    return (
      <div style={{
        padding: 28, borderRadius: 12, background: 'var(--bg-2)',
        border: '1px dashed var(--line)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="var(--signal-eff)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <div style={{
          font: '700 14px var(--font-display)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em', textAlign: 'center',
        }}>
          Library is a Pro feature
        </div>
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          maxWidth: 420, textAlign: 'center', lineHeight: 1.5,
        }}>
          Tag clips by skill or focus area, then filter your entire
          video library across every session. Available with Pro.
        </div>
        <button type="button" onClick={() => onUpgrade?.()}
          style={{
            marginTop: 4, padding: '9px 16px', borderRadius: 10,
            border: 'none', background: 'var(--signal-eff)',
            color: 'var(--ink)',
            font: '700 12px var(--font-ui)', letterSpacing: 0.02,
            cursor: 'pointer',
          }}>
          Upgrade to Pro
        </button>
      </div>
    );
  }

  const toggleTagSel = (id) => {
    setSelectedTagIds(prev => prev.includes(id)
      ? prev.filter(x => x !== id)
      : [...prev, id]);
  };
  const clearTagSel = () => setSelectedTagIds([]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Source filter — All / Mine / Team. Cheap to render
          even when the user isn't on a team (team chip would
          just show zero results). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 4 }}>{t('sessions.source')}</span>
        {[
          { key: null,   label: t('sessions.sourceAll') },
          { key: 'own',  label: t('sessions.sourceMine') },
          { key: 'team', label: t('sessions.sourceTeam') },
        ].map(opt => {
          const isOn = sourceFilter === opt.key;
          const c = opt.key === 'team' ? 'var(--lime-eff)' : 'var(--signal-eff)';
          return (
            <button key={opt.label} type="button"
              onClick={() => setSourceFilter(opt.key)}
              style={{
                font: '600 11px var(--font-ui)', letterSpacing: 0.02,
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                background: isOn
                  ? 'color-mix(in oklch, ' + c + ' 18%, transparent)'
                  : 'var(--bg-3)',
                color:  isOn ? c : 'var(--tx-md)',
                border: '1px solid ' + (isOn ? c : 'var(--line-soft)'),
              }}>
              {opt.label}
            </button>
          );
        })}
      </div>
      {/* Tag filter strip */}
      {tagsState.loading ? (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
          padding: '6px 0',
        }}>{t('sessions.loadingTags')}</div>
      ) : tagsState.rows.length === 0 ? (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
          padding: '6px 0',
        }}>
          {t('sessions.noTagsYet')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 4 }}>{t('sessions.filter')}</span>
          {tagsState.rows.map(t => {
            const isOn = selectedTagIds.includes(t.tag_uuid);
            const c = t.color || tagColorFor('green');
            return (
              <button key={t.tag_uuid} type="button"
                onClick={() => toggleTagSel(t.tag_uuid)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  font: '600 11px var(--font-ui)', letterSpacing: 0.02,
                  padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                  background: isOn
                    ? 'color-mix(in oklch, ' + c + ' 18%, transparent)'
                    : 'var(--bg-3)',
                  color:  isOn ? c : 'var(--tx-md)',
                  border: '1px solid ' + (isOn ? c : 'var(--line-soft)'),
                }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 999,
                  background: c, flexShrink: 0,
                }}/>
                {t.name}
              </button>
            );
          })}
          {selectedTagIds.length > 0 && (
            <button type="button" onClick={clearTagSel}
              style={{
                font: '600 11px var(--font-ui)',
                padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                background: 'transparent', color: 'var(--tx-md)',
                border: '1px solid var(--line-soft)',
              }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Session grid (v03.51) */}
      {sessionsState.loading ? (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
          textAlign: 'center', padding: '24px 0',
        }}>{t('sessions.loadingSessions')}</div>
      ) : sessionsState.rows.length === 0 ? (
        ES ? <ES title={t('sessions.noSessionsMatch')}
                  body={selectedTagIds.length
                    ? t('sessions.noSessionsMatchBodyTag')
                    : t('sessions.noSessionsMatchBody')}/>
            : <div style={{ padding: 32, textAlign: 'center', color: 'var(--tx-lo)' }}>
                {t('sessions.noSessionsMatch')}
              </div>
      ) : (
        <>
          <div className="display" style={{
            fontSize: isMobile ? 18 : 22, color: 'var(--tx-hi)',
            letterSpacing: '-0.02em', marginBottom: 4,
          }}>
            {sessionsState.rows.length} {sessionsState.rows.length === 1 ? t('sessions.countOne') : t('sessions.countMany')}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 14,
          }}>
            {sessionsState.rows.map(s => (
              <LibrarySessionCard key={s.session_uuid}
                session={s}
                onOpen={() => onOpenSession(s.session_uuid)}/>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── LibrarySessionCard (v03.51) — one tile per session ──────
// Replaces LibraryClipCard as the primary Library grid card.
// Shows: session date, title, athlete name (when not the
// viewer's), clip count, optional team chip when shared.
// Click → opens the session in SessionDetail.
const LibrarySessionCard = ({ session: s, onOpen }) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const t = (window.useT || (() => (k) => k))();
  const shared  = !!s.coach_shared_to_squad;
  const isOwn   = s._source_role === 'own';
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); }
  };
  return (
    <div role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: 16, borderRadius: 14,
        background: 'var(--bg-2)',
        border: '1px solid ' + (shared
          ? 'color-mix(in oklch, var(--lime-eff) 35%, transparent)'
          : 'var(--line-soft)'),
        color: 'var(--tx-hi)', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 8,
        font: '500 14px var(--font-ui)',
      }}>
      {/* Top row: date eyebrow on the left, athlete name + share chip on right */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
      }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
          {SA.sessionDate(s) || 'SESSION'}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!isOwn && s._athlete_name && (
            <span className="mono" style={{
              font: '700 9px var(--font-mono)', letterSpacing: 0.06,
              padding: '2px 7px', borderRadius: 4,
              background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
              color: 'var(--signal-eff)',
            }}>
              {s._athlete_name.toUpperCase()}
            </span>
          )}
          {shared && <TeamSharedChip/>}
        </div>
      </div>
      <div className="display" style={{
        fontSize: 17, letterSpacing: '-0.015em', color: 'var(--tx-hi)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {SA.sessionTitle(s) || 'Session'}
      </div>
      {s.notes && (
        <div style={{
          font: '500 12px/1.5 var(--font-ui)', color: 'var(--tx-md)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {s.notes}
        </div>
      )}
      <div style={{
        marginTop: 'auto', paddingTop: 8,
        display: 'flex', alignItems: 'center', gap: 6,
        font: '600 11px var(--font-ui)', color: 'var(--signal-eff)',
      }}>
        {s._clip_count} {s._clip_count === 1 ? t('sessions.clipOne') : t('sessions.clipMany')} ›
      </div>
    </div>
  );
};

// ── LibraryClipCard (Phase 5, fixed v03.50) ─────────────────
// Chip now triggers on the SESSION's share flag (the only true
// source of share state after v03.49 moved sharing per-session).
// The card's lime border + chip both react to that. The athlete
// name appears in the chip subtitle only when the clip belongs
// to someone other than the viewer.
const LibraryClipCard = ({ clip, onOpen }) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const sess = clip._session || {};
  const isOwnClip       = clip._source_role === 'own';
  const sessionShared   = !!sess.coach_shared_to_squad;
  return (
    <button type="button" onClick={onOpen}
      style={{
        textAlign: 'left',
        padding: 0, borderRadius: 12, overflow: 'hidden',
        background: 'var(--bg-2)',
        border: '1px solid ' + (sessionShared
          ? 'color-mix(in oklch, var(--lime-eff) 35%, transparent)'
          : 'var(--line-soft)'),
        color: 'var(--tx-hi)', cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        font: '500 13px var(--font-ui)',
      }}>
      <div style={{
        aspectRatio: '16 / 9', position: 'relative',
        background: 'color-mix(in oklch, var(--ink) 12%, var(--bg-3))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--signal-eff)',
      }}>
        {Icon && <Icon name="play" size={30}/>}
        {sessionShared && (
          <span style={{ position: 'absolute', top: 8, right: 8 }}>
            <TeamSharedChip subtitle={!isOwnClip ? clip._athlete_name : null}/>
          </span>
        )}
      </div>
      <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
          {SA.sessionDate(sess) || (sess.title || 'SESSION')}
        </span>
        <div style={{ font: '600 13px var(--font-ui)', color: 'var(--tx-hi)' }}>
          {clip.title || ('Clip · ' + ((clip.order_idx || 0) + 1))}
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          font: '500 10px var(--font-mono)', color: 'var(--tx-lo)',
          marginTop: 2,
        }}>
          <span>{sess.title || ''}</span>
          {clip.duration_s != null && <span>{clip.duration_s.toFixed(1)} s</span>}
        </div>
      </div>
    </button>
  );
};

const AnnotationRow = ({ annot, isAuthor, onSeek, onDelete }) => {
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const t = (window.useT || (() => (k) => k))();
  const role = annot.author_role || 'athlete';
  const strokes = Array.isArray(annot.strokes) ? annot.strokes : [];
  const swatch = (strokes[0] && strokes[0].color) || 'var(--signal-eff)';
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={onSeek}
          style={{
            font: '700 11px var(--font-mono)', letterSpacing: 0.04,
            padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'color-mix(in oklch, var(--signal-eff) 18%, transparent)',
            color: 'var(--signal-eff)', border: 'none',
          }}>
          {annot.t_sec != null ? SA.fmtTimestamp(annot.t_sec) : 'CLIP'}
        </button>
        <span style={{
          width: 10, height: 10, borderRadius: 999,
          background: swatch, flexShrink: 0,
        }}/>
        <span className="mono" style={{
          font: '700 9px var(--font-mono)', letterSpacing: 0.06,
          color: 'var(--tx-md)',
        }}>
          ✏ {t('sessions.annotationLabel')} · {strokes.length} {strokes.length === 1 ? t('sessions.strokeOne') : t('sessions.strokeMany')}
        </span>
        {isAuthor && (
          <button type="button" onClick={onDelete}
            aria-label={t('sessions.deleteAnnotation')}
            style={{
              marginLeft: 'auto',
              width: 22, height: 22, borderRadius: 6,
              background: 'transparent', color: 'var(--tx-lo)',
              border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {Icon && <Icon name="close" size={12}/>}
          </button>
        )}
      </div>
      {annot.label && (
        <div style={{
          font: '500 13px/1.5 var(--font-ui)', color: 'var(--tx-hi)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {annot.label}
        </div>
      )}
    </div>
  );
};

const NoteRow = ({ note, isAuthor, onSeek, onDelete }) => {
  const t = (window.useT || (() => (k) => k))();
  const SA = window.PA_SESSIONS;
  const Icon = window.Icon;
  const role = note.author_role || 'athlete';
  const roleColor = role === 'coach' ? 'var(--signal-eff)'
                  : role === 'admin' ? 'var(--amber-eff)'
                  :                    'var(--lime-eff)';
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={onSeek}
          style={{
            font: '700 11px var(--font-mono)', letterSpacing: 0.04,
            padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'color-mix(in oklch, var(--signal-eff) 18%, transparent)',
            color: 'var(--signal-eff)', border: 'none',
          }}>
          {note.t_sec != null ? SA.fmtTimestamp(note.t_sec) : 'CLIP'}
        </button>
        <span className="mono" style={{
          font: '700 9px var(--font-mono)', letterSpacing: 0.06,
          color: roleColor, textTransform: 'uppercase',
        }}>
          {role}
        </span>
        {isAuthor && (
          <button type="button" onClick={onDelete}
            aria-label={t('sessions.deleteNote')}
            style={{
              marginLeft: 'auto',
              width: 22, height: 22, borderRadius: 6,
              background: 'transparent', color: 'var(--tx-lo)',
              border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {Icon && <Icon name="close" size={12}/>}
          </button>
        )}
      </div>
      <div style={{
        font: '500 13px/1.5 var(--font-ui)', color: 'var(--tx-hi)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {note.text}
      </div>
    </div>
  );
};

window.WebSessions = WebSessions;

try { console.log('[web-sessions] loaded (v03.57)'); } catch (_) {}
