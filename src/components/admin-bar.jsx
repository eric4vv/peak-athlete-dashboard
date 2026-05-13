/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   AdminBar (v00.48)

   Banner row above the page shell, visible only to super admins.
   Two-step picker:
     1. Team dropdown (defaults to "All teams" — shows every athlete
        regardless of team affiliation, including orphans with no team)
     2. Athlete dropdown — populated from PA_ADMIN.loadAthletes(team)
     3. "View as" button — when clicked, sets the impersonation
        target on the parent state.

   When impersonation is active:
     - The bar shows a "Viewing as [Name] · clear" pill in
       --amber-eff (orange) tone.
     - The page shell adds an orange-tinted top border (handled
       by web-shell.jsx based on a prop forwarded from App).

   Per CLAUDE.md security rule #4 — RLS gates the data layer, not
   the UI. The is_admin RPC + v_all_teams view server-side block
   non-admins. This component is the visual surface only.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useAdminState,
  useEffect: useAdminEffect,
} = React;

// Special sentinel values for the team dropdown:
//   'all'  → no team filter → all athletes (including orphans)
//   'none' → explicitly orphans only (athletes with no team)
//   <uuid> → specific team UUID
const TEAM_ALL  = 'all';
const TEAM_NONE = 'none';

const AdminBar = ({ activeAthleteUuid, activeAthleteName, onPick, onClear, superAdmin }) => {
  const [teams,    setTeams]    = useAdminState([]);
  const [team,     setTeam]     = useAdminState(TEAM_ALL);
  const [athletes, setAthletes] = useAdminState([]);
  const [athlete,  setAthlete]  = useAdminState('');
  const [loading,  setLoading]  = useAdminState(false);
  const [err,      setErr]      = useAdminState(null);

  // Initial team list load — super-admin only. Non-super-admins
  // (coaches in pill-only mode) skip the network call entirely.
  useAdminEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await window.PA_ADMIN.loadAllTeams();
      if (cancelled) return;
      if (error) setErr(error.message || 'Could not load teams');
      setTeams(data);
    })();
    return () => { cancelled = true; };
  }, [superAdmin]);

  // Athlete list reloads whenever the team selection changes —
  // also super-admin only.
  useAdminEffect(() => {
    if (!superAdmin) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setAthlete('');
    const teamArg =
      team === TEAM_ALL  ? undefined
    : team === TEAM_NONE ? null
                         : team;
    (async () => {
      const { data, error } = await window.PA_ADMIN.loadAthletes(teamArg);
      if (cancelled) return;
      if (error) setErr(error.message || 'Could not load athletes');
      setAthletes(data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [team, superAdmin]);

  const onView = () => {
    if (!athlete) return;
    const row = athletes.find(a => a.athlete_uuid === athlete);
    if (!row) return;
    onPick && onPick({
      uuid: row.athlete_uuid,
      name: window.PA_ADMIN.athleteName(row),
    });
  };

  // Impersonation pill — visible when activeAthleteUuid is set.
  const pill = activeAthleteUuid ? (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', borderRadius: 999,
      background: 'color-mix(in oklch, var(--amber-eff) 16%, transparent)',
      border: '1px solid color-mix(in oklch, var(--amber-eff) 50%, transparent)',
      color: 'var(--amber-eff)',
      font: '600 11px var(--font-ui)', letterSpacing: 0.04,
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--amber-eff)',
      }}/>
      Viewing as {activeAthleteName || 'athlete'}
      <button onClick={onClear} style={{
        marginLeft: 4, padding: '2px 6px', borderRadius: 6,
        border: '1px solid color-mix(in oklch, var(--amber-eff) 50%, transparent)',
        background: 'transparent', color: 'var(--amber-eff)',
        font: '600 10px var(--font-ui)', cursor: 'pointer',
        textTransform: 'uppercase', letterSpacing: 0.04,
      }}>
        Clear
      </button>
    </div>
  ) : null;

  // Shared field styling — two dropdowns + view button.
  const selectStyle = {
    padding: '8px 28px 8px 10px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--bg-2)',
    color: 'var(--tx-hi)',
    font: '500 12px var(--font-ui)',
    minWidth: 160,
    appearance: 'none',
    cursor: 'pointer',
  };

  // v00.56: collapsed pill-only mode for non-super-admins.
  // Coaches who picked an athlete from CoachDeck don't need the
  // team/athlete pickers — they just need to see who they're
  // viewing and have a clear button to exit. Pickers stay
  // super-admin-only.
  const eyebrowText = superAdmin
    ? 'Super admin · view as'
    : 'Viewing athlete';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', borderRadius: 12,
      background: 'color-mix(in oklch, var(--amber-eff) 6%, var(--bg-2))',
      border: '1px solid color-mix(in oklch, var(--amber-eff) 30%, transparent)',
      marginBottom: 14,
    }}>
      <span className="eyebrow" style={{
        color: 'var(--amber-eff)',
        textTransform: 'uppercase', letterSpacing: 0.08,
        font: '700 10px var(--font-mono)',
      }}>
        {eyebrowText}
      </span>

      {superAdmin && (
        <>
          <select value={team} onChange={(e) => setTeam(e.target.value)}
                  style={selectStyle}>
            <option value={TEAM_ALL}>All teams ({teams.reduce((s, t) => s + (t.athlete_count || 0), 0) || '—'})</option>
            <option value={TEAM_NONE}>Athletes with no team</option>
            {teams.map(t => (
              <option key={t.team_uuid} value={t.team_uuid}>
                {t.team_name} ({t.athlete_count || 0})
              </option>
            ))}
          </select>

          <select value={athlete} onChange={(e) => setAthlete(e.target.value)}
                  disabled={!athletes.length || loading}
                  style={Object.assign({}, selectStyle, {
                    minWidth: 220,
                    opacity: athletes.length ? 1 : 0.55,
                  })}>
            <option value="">
              {loading ? 'Loading athletes…'
               : athletes.length ? 'Select an athlete…'
               : 'No athletes in this filter'}
            </option>
            {athletes.map(a => (
              <option key={a.athlete_uuid} value={a.athlete_uuid}>
                {window.PA_ADMIN.athleteName(a)}
              </option>
            ))}
          </select>

          <button onClick={onView} disabled={!athlete}
                  style={{
                    padding: '8px 14px', borderRadius: 10,
                    border: 'none',
                    background: athlete ? 'var(--amber-eff)' : 'var(--bg-3)',
                    color: athlete ? 'var(--ink)' : 'var(--tx-lo)',
                    font: '700 12px var(--font-ui)',
                    letterSpacing: 0.04,
                    cursor: athlete ? 'pointer' : 'not-allowed',
                    textTransform: 'uppercase',
                  }}>
            View as
          </button>
        </>
      )}

      {pill && <div style={{ marginLeft: superAdmin ? 'auto' : 0 }}>{pill}</div>}

      {err && (
        <span style={{ font: '500 11px var(--font-ui)', color: 'var(--flag-eff)' }}>
          {err}
        </span>
      )}
    </div>
  );
};

window.AdminBar = AdminBar;

try { console.log('[admin-bar] loaded (v00.56)'); } catch (_) {}
