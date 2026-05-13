/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Team onboarding modal — Batch 1c (v01.14).

   Three-mode dialog rendered when a coach without a team_uuid
   needs to attach to one:
     - 'pick'   — initial mode picker (Join existing / Create new)
     - 'join'   — enter code → live preview → confirm
     - 'create' — enter team name → preview generated code → confirm

   Backed by window.PA_TEAMS (src/lib/teams.js), which wraps the
   existing `teams` and `coaches` tables. No new schema; RLS
   policies (teams_select_authed / teams_insert_authed /
   coaches_update_own) handle access control.

   On successful join or create, dispatches the
   `pa:profile-changed` window event. AuthGate listens for it
   (in index.html) and re-runs refreshProfile() so v_my_coach
   reflects the new team_uuid and the CoachDeck re-renders with
   real squad data.

   The modal is also openable on demand for an *existing* coach
   who wants to switch teams (Batch 7 feature) — not yet wired
   into the UI but the helper supports it.

   Inline styles match the auth.jsx aesthetic — same brand mark,
   same field/input/button atoms, mobile-aware padding.
   ─────────────────────────────────────────────────────────── */

const { useState: useTeamOnbState, useEffect: useTeamOnbEffect } = React;

// ── Mode-picker primary action button ────────────────────────
// Big, vertically-stacked tile-style button used in pick mode.
// Title + sub on two lines, full width, hover-tinted border.
const PickButton = ({ icon, title, sub, onClick, accent }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      gap: 6,
      width: '100%',
      padding: '16px 18px',
      borderRadius: 12,
      border: '1px solid var(--line)',
      background: 'var(--bg-3)',
      color: 'var(--tx-md)',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'border-color 0.15s, background 0.15s',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = accent || 'var(--signal-eff)';
      e.currentTarget.style.background  = 'color-mix(in oklch, ' + (accent || 'var(--signal-eff)') + ' 8%, var(--bg-3))';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = 'var(--line)';
      e.currentTarget.style.background  = 'var(--bg-3)';
    }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      font: '700 14px var(--font-display)',
      color: 'var(--tx-hi)',
      letterSpacing: '-0.01em',
    }}>
      <span style={{ color: accent || 'var(--signal-eff)' }}>{icon}</span>
      {title}
    </div>
    <div style={{
      font: '500 12px var(--font-ui)',
      color: 'var(--tx-lo)',
      lineHeight: 1.5,
    }}>
      {sub}
    </div>
  </button>
);

// ── TeamOnboardingModal ─────────────────────────────────────
// v01.31 — role prop added. When role==='athlete', the JoinPanel
// uses joinTeamAsAthlete (which lands the row in pending status,
// per live's athlete-onboarding flow). When role==='coach' or
// undefined (legacy callers), uses joinTeamAsCoach.
//
// Athletes can ONLY join existing teams — the create flow stays
// coach-only. The PickPanel hides the "Create" CTA when
// role==='athlete'.
const TeamOnboardingModal = ({ initialMode = 'pick', role, onClose, onComplete, dismissible = true }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const [mode, setMode] = useTeamOnbState(initialMode);

  // Esc to close — only when dismissible (the empty-state-driven
  // modal allows it; a future required onboarding could pass
  // dismissible={false}).
  useTeamOnbEffect(() => {
    if (!dismissible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissible, onClose]);

  // Body scroll lock while open. Same lightweight pattern
  // request-modals.jsx uses.
  useTeamOnbEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleSuccess = () => {
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
    onComplete?.();
    onClose?.();
  };

  const cardWidth = isMobile ? '100%' : 460;

  return (
    <div
      onClick={dismissible ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        background: 'color-mix(in oklch, var(--ink) 78%, transparent)',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '40px 20px',
        overflowY: 'auto',
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: cardWidth,
          padding: isMobile ? 22 : 28,
          borderRadius: 18,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow)',
        }}>
        {mode === 'pick' && (
          <PickPanel onPick={setMode} onClose={onClose} dismissible={dismissible} role={role}/>
        )}
        {mode === 'join' && (
          <JoinPanel onBack={() => setMode('pick')} onSuccess={handleSuccess} role={role}/>
        )}
        {mode === 'create' && (
          <CreatePanel onBack={() => setMode('pick')} onSuccess={handleSuccess}/>
        )}
      </div>
    </div>
  );
};

// ── PickPanel ────────────────────────────────────────────────
const PickPanel = ({ onPick, onClose, dismissible, role }) => {
  // v01.31 — athletes only see Join; coaches see Join + Create.
  const isAthlete = role === 'athlete';
  return (
  <div>
    <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
      {isAthlete ? 'WELCOME' : 'WELCOME, COACH'}
    </div>
    <div className="display" style={{
      fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
      marginBottom: 6,
    }}>
      {isAthlete ? 'Join your team' : 'Get on a team'}
    </div>
    <p style={{
      margin: '0 0 20px',
      font: '500 13px var(--font-ui)',
      color: 'var(--tx-lo)',
      lineHeight: 1.55,
    }}>
      {isAthlete
        ? 'Enter the code your coach shared with you to request access to the team. They\'ll approve your request before you see team data.'
        : 'Pick how you want to set up Performance Lab for your squad. You can switch later.'}
    </p>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PickButton
        icon="↗"
        title={isAthlete ? 'Enter team code' : 'Join existing team'}
        sub="Use a code your head coach shared with you."
        onClick={() => onPick('join')}/>
      {!isAthlete && (
        <PickButton
          icon="✦"
          title="Create a new team"
          sub="Name your team. We'll generate a code you can share with assistant coaches and athletes."
          onClick={() => onPick('create')}
          accent="var(--lime-eff)"/>
      )}
    </div>

    {dismissible && (
      <button
        type="button" onClick={onClose}
        style={{
          width: '100%',
          padding: '10px 14px',
          marginTop: 14,
          borderRadius: 10,
          border: 'none',
          background: 'transparent',
          color: 'var(--tx-lo)',
          font: '500 12px var(--font-ui)',
          cursor: 'pointer',
        }}>
        Skip for now
      </button>
    )}
  </div>
  );
};

// ── JoinPanel ────────────────────────────────────────────────
// Debounced lookup: user types code → 250 ms idle → SELECT
// teams. Preview shows the matched team name (or "no match").
// Submit button enables only when a real team has resolved.
const JoinPanel = ({ onBack, onSuccess, role }) => {
  const [code,    setCode]    = useTeamOnbState('');
  const [team,    setTeam]    = useTeamOnbState(null);
  const [looking, setLooking] = useTeamOnbState(false);
  const [submitting, setSubmitting] = useTeamOnbState(false);
  const [err,     setErr]     = useTeamOnbState(null);

  // Debounced lookup — re-runs when `code` changes after a
  // 250 ms quiet window. Lookups are cheap (single SELECT),
  // but skip empty input to avoid pointless trips.
  useTeamOnbEffect(() => {
    setErr(null);
    setTeam(null);
    const trimmed = code.trim();
    if (trimmed.length < 2) { setLooking(false); return undefined; }
    setLooking(true);
    const t = setTimeout(async () => {
      const { team: hit, error } = await window.PA_TEAMS.lookupTeamByCode(trimmed);
      setLooking(false);
      if (error) { setErr(error.message || 'Lookup failed.'); return; }
      setTeam(hit);
    }, 250);
    return () => clearTimeout(t);
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    if (!team || submitting) return;
    setSubmitting(true); setErr(null);
    // v01.31 — branch on role. Athletes land in pending status
    // (coach approval required); coaches join immediately as
    // active. Same RLS authorizes both — each policy gates its
    // own table.
    const joinFn = role === 'athlete'
      ? window.PA_TEAMS.joinTeamAsAthlete
      : window.PA_TEAMS.joinTeamAsCoach;
    const { ok, error } = await joinFn(team.team_uuid);
    setSubmitting(false);
    if (!ok) { setErr(error?.message || 'Could not join team.'); return; }
    onSuccess();
  };

  // Inline preview state — three flavors: idle, looking, hit/miss.
  let preview = null;
  if (looking) {
    preview = <span style={{ color: 'var(--tx-lo)' }}>Looking up…</span>;
  } else if (team) {
    preview = (
      <>
        <span style={{ color: 'var(--tx-lo)' }}>Looks like </span>
        <strong style={{ color: 'var(--lime-eff)' }}>{team.team_name}</strong>
      </>
    );
  } else if (code.trim().length >= 2) {
    preview = <span style={{ color: 'var(--flag-eff)' }}>No team matches that code.</span>;
  }

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
        STEP 2 · JOIN
      </div>
      <div className="display" style={{
        fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
        marginBottom: 6,
      }}>
        Enter your team code
      </div>
      <p style={{
        margin: '0 0 16px',
        font: '500 13px var(--font-ui)',
        color: 'var(--tx-lo)',
        lineHeight: 1.55,
      }}>
        Enter the team abbreviation your coach gave you — for example{' '}
        <span className="mono" style={{ color: 'var(--tx-md)' }}>VEN</span>{' '}
        or <span className="mono" style={{ color: 'var(--tx-md)' }}>T_VEN</span>.
        Either form works.
      </p>

      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          <label style={{
            font: '600 11px var(--font-ui)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--tx-lo)',
          }} htmlFor="join-code">
            Team code
          </label>
          <input
            id="join-code"
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="T_PEAK"
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--bg-3)',
              color: 'var(--tx-hi)',
              font: '600 14px var(--font-mono)',
              outline: 'none',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              width: '100%',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}/>
        </div>

        <div style={{
          minHeight: 22,
          font: '500 13px var(--font-ui)',
          marginBottom: 8,
        }}>
          {preview}
        </div>

        <button
          type="submit"
          disabled={!team || submitting}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--signal-eff)',
            color: 'var(--ink)',
            font: '700 14px var(--font-ui)',
            letterSpacing: '0.01em',
            cursor: (!team || submitting) ? 'not-allowed' : 'pointer',
            opacity:  (!team || submitting) ? 0.5 : 1,
            marginTop: 8,
          }}>
          {submitting ? 'Joining…' : team ? ('Join ' + team.team_name) : 'Join team'}
        </button>

        {err && <p style={{
          font: '500 12px var(--font-ui)',
          color: 'var(--flag-eff)',
          margin: '12px 0 0',
        }}>{err}</p>}

        <button
          type="button" onClick={onBack}
          style={{
            width: '100%', padding: '10px 14px', marginTop: 8,
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--tx-md)',
            font: '600 13px var(--font-ui)',
            cursor: 'pointer',
          }}>
          Back
        </button>
      </form>
    </div>
  );
};

// ── CreatePanel ──────────────────────────────────────────────
const CreatePanel = ({ onBack, onSuccess }) => {
  const [name,       setName]       = useTeamOnbState('');
  const [submitting, setSubmitting] = useTeamOnbState(false);
  const [err,        setErr]        = useTeamOnbState(null);

  const trimmed = name.trim();
  const codePreview = window.PA_TEAMS?.generateTeamCode
    ? window.PA_TEAMS.generateTeamCode(trimmed)
    : '';

  const canSubmit = !submitting && trimmed.length >= 3;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true); setErr(null);
    const { team, error } = await window.PA_TEAMS.createTeam(trimmed);
    setSubmitting(false);
    if (error || !team) {
      setErr(error?.message || 'Could not create team.');
      return;
    }
    onSuccess();
  };

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
        STEP 2 · CREATE
      </div>
      <div className="display" style={{
        fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
        marginBottom: 6,
      }}>
        Name your team
      </div>
      <p style={{
        margin: '0 0 16px',
        font: '500 13px var(--font-ui)',
        color: 'var(--tx-lo)',
        lineHeight: 1.55,
      }}>
        We'll generate a join code you can share with assistant coaches and athletes.
      </p>

      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <label style={{
            font: '600 11px var(--font-ui)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--tx-lo)',
          }} htmlFor="create-name">
            Team name
          </label>
          <input
            id="create-name"
            type="text"
            autoFocus
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tampa Tide"
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--bg-3)',
              color: 'var(--tx-hi)',
              font: '500 14px var(--font-ui)',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}/>
        </div>

        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--bg-3)',
          border: '1px solid var(--line-soft)',
          marginBottom: 12,
          font: '500 12px var(--font-ui)',
          color: 'var(--tx-lo)',
        }}>
          Suggested join code:{' '}
          <strong className="mono" style={{ color: 'var(--tx-hi)', letterSpacing: '0.04em' }}>
            {trimmed.length >= 3 ? codePreview : '—'}
          </strong>
          <span style={{ display: 'block', marginTop: 4, color: 'var(--tx-lo)' }}>
            We'll add a number if that code's already taken.
          </span>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--lime-eff)',
            color: 'var(--ink)',
            font: '700 14px var(--font-ui)',
            letterSpacing: '0.01em',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity:  canSubmit ? 1 : 0.5,
            marginTop: 4,
          }}>
          {submitting ? 'Creating…' : 'Create team'}
        </button>

        {err && <p style={{
          font: '500 12px var(--font-ui)',
          color: 'var(--flag-eff)',
          margin: '12px 0 0',
        }}>{err}</p>}

        <button
          type="button" onClick={onBack}
          style={{
            width: '100%', padding: '10px 14px', marginTop: 8,
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--tx-md)',
            font: '600 13px var(--font-ui)',
            cursor: 'pointer',
          }}>
          Back
        </button>
      </form>
    </div>
  );
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  TeamOnboardingModal,
});

try { console.log('[team-onboarding] loaded (v01.32)'); } catch (_) {}
