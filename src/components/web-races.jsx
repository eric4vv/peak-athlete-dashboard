/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Races — analysis page (Option D: selection slots + unified pane)

   Flow:
     1. Fetch all race trials for the athlete (RLS-filtered).
     2. Build filter options from the returned set.
     3. User clicks a row → assigns to slotA (or slotB if A is set).
     4. DetailPane renders single-trial or overlay view based on
        slotB state (null | another-trial-key | 'PB' | 'MEDIAN').

   Phase 1 contract: READ-ONLY. No writes, no edge functions, no
   signed video URLs yet. Video thumbs rendered as placeholders.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useRacesState,
  useEffect: useRacesEffect,
  useMemo:   useRacesMemo,
} = React;

// ── WebTeamRaces (v00.78 — P-9/P-14 redesign) ────────────────
//
// Athlete-first roster grid (replaces the v00.74-77 flat trials
// table). Designed to scale to thousands of trials per team.
//
// Layout:
//   1. Hero — "47 athletes · 1,283 trials"
//   2. Search + Filters drawer (gender · group · date range)
//   3. Active filter chip strip (one-click clear each)
//   4. Mode tabs: Browse | Compare
//   5a. Browse: athlete card grid (12/page, prev/next)
//   5b. Compare: dual combobox picker (athlete + trial × 2),
//       auto-fire RaceDetail render when both filled
//
// Custom athlete groups (Sprinters / IM / Distance preset +
// coach-defined). v01.41 — Batch 7c: DB-backed via PA_GROUPS
// (athlete_groups + athlete_group_members tables, same shape
// live uses). Preset groups stay client-side computed from
// each athlete's trial set.
//
// Legacy `pa.team.groups` localStorage data is migrated once
// per team via PA_GROUPS.migrateLocalStorageToDb on first
// listGroups call. The legacy data is NOT cleared after
// migration — it's a safety undo path.

const TEAM_GROUPS_LS_KEY = 'pa.team.groups'; // legacy, retained for migration awareness only

// Preset groups computed from each athlete's trial set. The
// match function takes an athlete uuid + the events-by-uuid map
// and returns true if they belong in this group.
const PRESET_GROUPS = [
  {
    id: 'preset-sprint',
    name: 'Sprinters',
    preset: true,
    match: (uuid, eventsByUuid) =>
      (eventsByUuid[uuid] || []).some(e => e.distance <= 100),
  },
  {
    id: 'preset-im',
    name: 'IM',
    preset: true,
    match: (uuid, eventsByUuid) =>
      (eventsByUuid[uuid] || []).some(e =>
        String(e.style || '').toLowerCase().includes('medley')
        || String(e.style || '').toLowerCase() === 'im'
        || String(e.style || '').toLowerCase() === 'i.m.'
      ),
  },
  {
    id: 'preset-distance',
    name: 'Distance',
    preset: true,
    match: (uuid, eventsByUuid) =>
      (eventsByUuid[uuid] || []).some(e => e.distance >= 400),
  },
];

// v01.41 — legacy LS reader retained only for the safety
// fallback in case PA_GROUPS hasn't loaded yet. The true source
// of truth is now the DB; see useGroupsForTeam below.
function readCustomGroupsLegacy() {
  try {
    const raw = localStorage.getItem(TEAM_GROUPS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

// ── AthleteCard ───────────────────────────────────────────────
// Card content per question #1 — no derived "best event" since
// multi-event athletes have no clear single best. Shows factual
// counts + most-recent activity.
//
// v00.81 — `summaryNode` prop lets WebTeamStarts / WebTeamTurns
// substitute their own bottom line (e.g. "Best 15 m: 7.32")
// without forking the whole card. When omitted, falls back to
// the races default ("Latest: <event> · <time>").
//
// v00.86 — outer element is a div (was a button) so we can nest
// a real <button> inside for the optional `compareAction` —
// HTML disallows nested buttons. Card is still keyboard-
// accessible via role="button" + tabIndex + Enter/Space.
const AthleteCard = ({ athlete, stats, latestTrial, summaryNode, onClick, compareAction }) => {
  const initials = ((athlete.first_name || '').trim()[0] || '?').toUpperCase()
                 + ((athlete.last_name || '').trim()[0] || '').toUpperCase();
  const fullName = window.PA_ADMIN.athleteName(athlete) || 'Athlete';
  const last = stats?.last_session
    ? relativeDate(stats.last_session)
    : 'no sessions';
  const fmtEvent = (t) => {
    if (!t) return null;
    const dist = t.distance_m ? Number(t.distance_m) : null;
    const style = t.style ? String(t.style) : null;
    const styleCap = style ? style.charAt(0).toUpperCase() + style.slice(1).toLowerCase() : '';
    return (dist ? dist + ' ' : '') + styleCap;
  };
  const latestLabel = latestTrial ? fmtEvent(latestTrial) : null;
  const latestTime  = latestTrial && window.PA_KPIS && window.PA_KPIS.fmtTime
    ? window.PA_KPIS.fmtTime(latestTrial.race_time_s, 2)
    : null;
  return (
    <div role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick && onClick();
        }
      }}
      className="card" style={{
        padding: 16, borderRadius: 14, textAlign: 'left',
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        display: 'flex', flexDirection: 'column', gap: 12,
        cursor: 'pointer', minWidth: 0, position: 'relative',
        transition: 'transform 0.12s, border-color 0.12s',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--signal-eff)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-soft)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}>
      {/* Quick-compare icon button — top-right, visible only on
          hover/focus so it doesn't compete with primary action */}
      {compareAction && (
        <button
          onClick={(e) => { e.stopPropagation(); compareAction(); }}
          title="Quick compare with this athlete"
          style={{
            position: 'absolute', top: 8, right: 8,
            padding: '4px 8px', borderRadius: 6,
            background: 'transparent', cursor: 'pointer',
            color: 'var(--tx-lo)',
            border: '1px solid var(--line-soft)',
            font: '600 9px var(--font-mono)', letterSpacing: 0.06,
            opacity: 0.7,
            transition: 'opacity 0.12s, color 0.12s, border-color 0.12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--signal-eff)';
            e.currentTarget.style.borderColor = 'var(--signal-eff)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.7';
            e.currentTarget.style.color = 'var(--tx-lo)';
            e.currentTarget.style.borderColor = 'var(--line-soft)';
          }}>
          + COMPARE
        </button>
      )}
      {/* Avatar + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0,
                    paddingRight: compareAction ? 80 : 0 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
          color: 'var(--signal-eff)', flexShrink: 0, position: 'relative',
          font: '700 13px var(--font-ui)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {initials || '?'}
          {/* v00.87 — activity status dot (active / recent /
              dormant). Mirrors the CoachRoster dot pattern from
              v00.57 so the coach reads "who's training this week"
              consistently across Squad Overview and the
              Races/Starts/Turns team pages. */}
          {stats && typeof activityStatus === 'function' && (() => {
            const status = activityStatus(stats);
            const col = STATUS_COLORS[status];
            return (
              <span style={{
                position: 'absolute', top: -2, right: -2,
                width: 10, height: 10, borderRadius: '50%',
                background: col,
                border: '2px solid var(--bg-2)',
              }} title={STATUS_LABELS[status]}/>
            );
          })()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            font: '600 14px var(--font-ui)', color: 'var(--tx-hi)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{fullName}</div>
          <div style={{ fontSize: 11, color: 'var(--tx-lo)', marginTop: 1 }}>
            {stats?.trials_30d || 0} this month · {last}
          </div>
        </div>
      </div>
      {/* Summary line — factual, not derived. Defaults to the
          races latest event/time pattern; consumers (Starts /
          Turns) override via `summaryNode` for their modality. */}
      {summaryNode ? summaryNode : (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          gap: 8, minWidth: 0,
        }}>
          <span style={{
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {latestLabel ? 'Latest: ' + latestLabel : 'No races yet'}
          </span>
          {latestTime && (
            <span className="mono" style={{
              font: '700 13px var(--font-mono)', color: 'var(--tx-hi)',
              letterSpacing: '-0.01em',
            }}>{latestTime}</span>
          )}
        </div>
      )}
    </div>
  );
};

// ── NewGroupModal ─────────────────────────────────────────────
// Coach picks athletes via checkboxes + names the group. Saves
// to localStorage via writeCustomGroups. Edit-mode passes an
// existing group as `editing`.
const NewGroupModal = ({ athletes, onSave, onClose, editing }) => {
  const [name, setName] = useRacesState(editing?.name || '');
  const [selected, setSelected] = useRacesState(
    editing ? new Set(editing.athleteUuids) : new Set()
  );
  const [search, setSearch] = useRacesState('');
  const filtered = athletes.filter(a => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const n = (window.PA_ADMIN.athleteName(a) || '').toLowerCase();
    return n.includes(q);
  });
  const toggle = (uuid) => {
    const next = new Set(selected);
    if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
    setSelected(next);
  };
  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selected.size) return;
    onSave({
      id: editing?.id || ('custom-' + Date.now()),
      name: trimmed,
      preset: false,
      athleteUuids: Array.from(selected),
    });
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '85vh',
          padding: 22, display: 'flex', flexDirection: 'column', gap: 14,
          overflow: 'hidden',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow">{editing ? 'EDIT GROUP' : 'NEW GROUP'}</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--tx-lo)',
            font: '600 16px var(--font-ui)', cursor: 'pointer', padding: 0,
          }}>✕</button>
        </div>
        <input
          type="text" placeholder="Group name (e.g. Distance squad)"
          value={name} onChange={(e) => setName(e.target.value)}
          style={{
            padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--line)', background: 'var(--bg-3)',
            color: 'var(--tx-hi)', font: '500 14px var(--font-ui)', outline: 'none',
          }}
          autoFocus/>
        <input
          type="text" placeholder="Filter athletes…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--line-soft)', background: 'var(--bg-3)',
            color: 'var(--tx-hi)', font: '500 13px var(--font-ui)', outline: 'none',
          }}/>
        <div style={{
          flex: 1, overflowY: 'auto', minHeight: 120,
          border: '1px solid var(--line-soft)', borderRadius: 8,
          background: 'var(--bg-3)',
        }}>
          {!filtered.length ? (
            <div style={{ padding: 16, color: 'var(--tx-lo)', font: '500 12px var(--font-ui)' }}>
              No athletes match.
            </div>
          ) : filtered.map(a => {
            const checked = selected.has(a.athlete_uuid);
            return (
              <label key={a.athlete_uuid} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', cursor: 'pointer',
                borderBottom: '1px solid var(--line-soft)',
                background: checked
                  ? 'color-mix(in oklch, var(--signal-eff) 10%, transparent)'
                  : 'transparent',
              }}>
                <input type="checkbox" checked={checked}
                  onChange={() => toggle(a.athlete_uuid)}
                  style={{ accentColor: 'var(--signal-eff)' }}/>
                <span style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-hi)' }}>
                  {window.PA_ADMIN.athleteName(a)}
                </span>
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '8px 14px', borderRadius: 8,
              background: 'transparent', color: 'var(--tx-md)',
              border: '1px solid var(--line)', font: '600 12px var(--font-ui)', cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={handleSave}
              disabled={!name.trim() || !selected.size}
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: (!name.trim() || !selected.size) ? 'var(--bg-3)' : 'var(--signal-eff)',
                color: (!name.trim() || !selected.size) ? 'var(--tx-lo)' : 'var(--ink)',
                border: 'none', font: '700 12px var(--font-ui)',
                cursor: (!name.trim() || !selected.size) ? 'not-allowed' : 'pointer',
                letterSpacing: 0.04,
              }}>
              {editing ? 'SAVE' : 'CREATE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Combobox (typeahead athlete picker for compare mode) ──────
const Combobox = ({ items, value, onChange, placeholder, getLabel, color }) => {
  const [query, setQuery] = useRacesState('');
  const [open, setOpen]   = useRacesState(false);
  const selected = items.find(i => i.athlete_uuid === value);
  const filtered = !query.trim() ? items : items.filter(i =>
    getLabel(i).toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(true)} style={{
        padding: '8px 10px', borderRadius: 8,
        border: '1px solid ' + (selected ? color : 'var(--line)'),
        background: selected
          ? 'color-mix(in oklch, ' + color + ' 12%, transparent)'
          : 'var(--bg-2)',
        cursor: 'pointer', minHeight: 36,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {selected ? (
          <>
            <span style={{ font: '600 13px var(--font-ui)', color: 'var(--tx-hi)', flex: 1 }}>
              {getLabel(selected)}
            </span>
            <button onClick={(e) => { e.stopPropagation(); onChange(null); setQuery(''); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--tx-lo)', cursor: 'pointer', padding: 0, fontSize: 14 }}>
              ✕
            </button>
          </>
        ) : (
          <input
            type="text" placeholder={placeholder} value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            style={{
              flex: 1, border: 'none', background: 'transparent',
              color: 'var(--tx-hi)', font: '500 13px var(--font-ui)', outline: 'none',
            }}/>
        )}
      </div>
      {open && !selected && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
          background: 'var(--bg-2)', border: '1px solid var(--line)',
          borderRadius: 8, maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 8px 22px rgba(0,0,0,0.32)',
        }}>
          {!filtered.length ? (
            <div style={{ padding: 10, font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
              No matches.
            </div>
          ) : filtered.slice(0, 40).map(item => (
            <div key={item.athlete_uuid}
              onMouseDown={() => { onChange(item.athlete_uuid); setQuery(''); setOpen(false); }}
              style={{
                padding: '8px 12px', cursor: 'pointer',
                font: '500 13px var(--font-ui)', color: 'var(--tx-hi)',
                borderBottom: '1px solid var(--line-soft)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              {getLabel(item)}
            </div>
          ))}
          {filtered.length > 40 && (
            <div style={{ padding: '6px 12px', font: '500 11px var(--font-ui)', color: 'var(--tx-lo)' }}>
              +{filtered.length - 40} more — refine your search
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── TeamBrowsePage (v00.81 — shared base for Starts / Turns) ──
//
// Browse-only team view used by WebTeamStarts and WebTeamTurns.
// Same hero + search + filter drawer + group system + pagination
// as WebTeamRaces, minus the Compare tab (deferred for those
// modalities — StartDetail / TurnDetail need more props than
// RaceDetail and a cross-athlete compare needs additional data
// plumbing).
//
// Caller config:
//   - heroLabel    "STARTS" | "TURNS"
//   - heroNoun     "start"  | "turn"
//   - modalityView "v_start_kpis" | "v_turn_kpis"
//   - modalitySelect column list for the kpi query
//   - summaryFor(athlete, modRows) => JSX for the AthleteCard
//                  bottom line (e.g. "Best 15 m: 7.32 / Reaction:
//                  0.65"). Called per visible card.
const TeamBrowsePage = ({
  profile, onPickAthlete,
  heroLabel, heroNoun,
  modalityView, modalitySelect,
  summaryFor,
  compareConfig,    // v00.82 — optional. When set, Compare tab renders.
  isPro,            // v02.21 — gates cross-athlete compare (Pro only).
  onUpgrade,        // v02.21 — fired when a free coach attempts compare.
}) => {
  // v02.21 — Cross-athlete compare gate. Defense-in-depth: applied at the
  // tab entry, the quick-compare button, AND the in-slot athlete picker.
  // Free coaches/admins get a toast + upgrade prompt; Pro users proceed.
  // Returns true if the action is allowed, false if blocked.
  const gateCompare = () => {
    if (isPro) return true;
    try {
      const tt = (window.useT || (() => (k) => k))();
      window.PA_TOAST?.show(tt('analysis.compareLock.toastBody'), {
        type: 'info',
        title: tt('analysis.compareLock.toastTitle'),
      });
    } catch (_) {}
    try { onUpgrade?.(); } catch (_) {}
    return false;
  };
  const teamUuid = profile?.team_uuid || null;
  const teamName = (profile?.team_name || '').trim() || null;

  const [athletes, setAthletes] = useRacesState([]);
  const [modRows,  setModRows]  = useRacesState([]); // modality-specific rows
  const [raceRows, setRaceRows] = useRacesState([]); // for preset group matching
  const [activity, setActivity] = useRacesState({ byAthlete: {} });
  const [loading,  setLoading]  = useRacesState(true);
  const [error,    setError]    = useRacesState(null);

  const [search,       setSearch]       = useRacesState('');
  const [genderFilter, setGenderFilter] = useRacesState('all');
  const [groupId,      setGroupId]      = useRacesState('all');
  const [dateRange,    setDateRange]    = useRacesState('30d');
  // v01.02 — stroke filter quick-pills (All / Free / Back /
  // Breast / Fly). For Races pages this filters trials by
  // v_race_kpis.style. For Starts/Turns the kpi views don't
  // expose stroke, so it filters to athletes who have RACED
  // that stroke (derived from each athlete's race history
  // already loaded for preset groups).
  const [strokeFilter, setStrokeFilter] = useRacesState('all');
  const [filtersOpen,  setFiltersOpen]  = useRacesState(false);

  const [customGroups, setCustomGroups] = useRacesState([]);
  const [groupModal,   setGroupModal]   = useRacesState(null);

  const PAGE_SIZE = 12;
  const [page, setPage] = useRacesState(0);

  // v01.05 — refetch token. Incrementing this re-runs the
  // data-load effect (via deps array), enabling a Retry button
  // on ErrorState without a page reload.
  const [refetchToken, setRefetchToken] = useRacesState(0);

  // v00.82 — Compare mode state (only used when compareConfig set)
  const [mode,        setMode]        = useRacesState('browse');
  const [pickAthA,    setPickAthA]    = useRacesState(null);
  const [pickTrialA,  setPickTrialA]  = useRacesState(null);
  const [pickAthB,    setPickAthB]    = useRacesState(null);
  const [pickTrialB,  setPickTrialB]  = useRacesState(null);
  const [trialA,      setTrialA]      = useRacesState(null);
  const [trialB,      setTrialB]      = useRacesState(null);
  const [comparing,   setComparing]   = useRacesState(false);
  const [compareErr,  setCompareErr]  = useRacesState(null);

  useRacesEffect(() => {
    let cancelled = false;
    if (!teamUuid) { setLoading(false); return () => { cancelled = true; }; }
    (async () => {
      setLoading(true);
      try {
        const { data: roster } = await window.PA_ADMIN.loadAthletes(teamUuid);
        if (cancelled) return;
        const list = roster || [];
        setAthletes(list);
        const uuids = list.map(a => a.athlete_uuid).filter(Boolean);
        if (!uuids.length) {
          setModRows([]); setRaceRows([]); setLoading(false); return;
        }
        const [mRes, rRes, actRes] = await Promise.all([
          window.supabaseClient
            .from(modalityView)
            .select(modalitySelect)
            .in('athlete_uuid', uuids),
          window.supabaseClient
            .from('v_race_kpis')
            .select('athlete_uuid, distance_m, style')
            .in('athlete_uuid', uuids)
            .not('race_time_s', 'is', null),
          window.PA_ADMIN.loadTeamActivity(uuids, 30),
        ]);
        if (cancelled) return;
        if (mRes.error) {
          setError(mRes.error.message || 'Query failed'); setLoading(false); return;
        }
        setModRows(mRes.data || []);
        setRaceRows(rRes.data || []);
        setActivity(actRes || { byAthlete: {} });
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(String(e.message || e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [teamUuid, refetchToken]);

  // v01.41 — DB-backed group loader. Replaces the legacy
  // `setCustomGroups(readCustomGroups())` localStorage read.
  // Sequence:
  //   1. Migrate any legacy LS groups for this team to the DB
  //      (idempotent — flag prevents re-runs).
  //   2. Fetch fresh group list from the DB.
  // Re-runs whenever teamUuid changes OR the page asks for a
  // refetch via refetchToken.
  useRacesEffect(() => {
    let cancelled = false;
    if (!teamUuid) { setCustomGroups([]); return () => { cancelled = true; }; }
    (async () => {
      try {
        if (window.PA_GROUPS?.migrateLocalStorageToDb) {
          await window.PA_GROUPS.migrateLocalStorageToDb(teamUuid);
        }
        const { groups } = window.PA_GROUPS
          ? await window.PA_GROUPS.listGroups(teamUuid)
          : { groups: readCustomGroupsLegacy() };
        if (!cancelled) setCustomGroups(groups || []);
      } catch (e) {
        try { console.warn('[web-races] group load failed:', e); } catch (_) {}
        if (!cancelled) setCustomGroups([]);
      }
    })();
    return () => { cancelled = true; };
  }, [teamUuid, refetchToken]);

  // Events-by-athlete (race rows drive group matching even on
  // Starts/Turns — Sprinters means "athletes who race 50/100s"
  // regardless of which page you're viewing).
  const eventsByUuid = useRacesMemo(() => {
    const map = {};
    raceRows.forEach(t => {
      if (!map[t.athlete_uuid]) map[t.athlete_uuid] = [];
      map[t.athlete_uuid].push({
        distance: Number(t.distance_m) || 0,
        style: t.style,
      });
    });
    return map;
  }, [raceRows]);

  // Modality rows grouped by athlete (passed to summaryFor).
  const modByUuid = useRacesMemo(() => {
    const map = {};
    modRows.forEach(t => {
      if (!map[t.athlete_uuid]) map[t.athlete_uuid] = [];
      map[t.athlete_uuid].push(t);
    });
    return map;
  }, [modRows]);

  const allGroups = useRacesMemo(
    () => [...PRESET_GROUPS, ...customGroups],
    [customGroups]
  );

  const resolveGroupUuids = (gid) => {
    if (!gid || gid === 'all') return null;
    const grp = allGroups.find(g => g.id === gid);
    if (!grp) return null;
    if (grp.preset) {
      return new Set(athletes
        .filter(a => grp.match(a.athlete_uuid, eventsByUuid))
        .map(a => a.athlete_uuid));
    }
    return new Set(grp.athleteUuids || []);
  };

  const dateCutoff = (() => {
    if (dateRange === 'all') return null;
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  })();

  const filteredAthletes = useRacesMemo(() => {
    const groupUuids = resolveGroupUuids(groupId);
    const q = search.trim().toLowerCase();
    return athletes.filter(a => {
      if (genderFilter !== 'all') {
        const g = String(a.gender || '').toLowerCase();
        if (g !== genderFilter) return false;
      }
      if (groupUuids && !groupUuids.has(a.athlete_uuid)) return false;
      // v01.02 — stroke filter. Athletes who have raced the
      // selected stroke pass; others get filtered out. Uses
      // race history (raceRows -> eventsByUuid) so the same
      // logic works on Races/Starts/Turns pages even though
      // v_start_kpis / v_turn_kpis don't carry stroke directly.
      if (strokeFilter !== 'all') {
        const evs = eventsByUuid[a.athlete_uuid] || [];
        const hasStroke = evs.some(e =>
          String(e.style || '').toLowerCase() === strokeFilter
        );
        if (!hasStroke) return false;
      }
      if (q) {
        const name = (window.PA_ADMIN.athleteName(a) || '').toLowerCase();
        if (name.includes(q)) return true;
        const evs = eventsByUuid[a.athlete_uuid] || [];
        return evs.some(e => {
          const distHit = e.distance && String(e.distance).includes(q);
          const styleHit = String(e.style || '').toLowerCase().includes(q);
          return distHit || styleHit;
        });
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athletes, search, genderFilter, groupId, strokeFilter, allGroups, eventsByUuid]);

  const totalPages = Math.max(1, Math.ceil(filteredAthletes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginated = filteredAthletes.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  useRacesEffect(() => { setPage(0); }, [search, genderFilter, groupId, dateRange, strokeFilter]);

  const activeChips = (() => {
    const chips = [];
    if (genderFilter !== 'all') chips.push({
      key: 'gender',
      label: genderFilter === 'male' ? 'Male' : 'Female',
      clear: () => setGenderFilter('all'),
    });
    if (strokeFilter !== 'all') {
      const strokeLabel =
          strokeFilter === 'freestyle'        ? 'Freestyle'
        : strokeFilter === 'backstroke'       ? 'Backstroke'
        : strokeFilter === 'breaststroke'     ? 'Breaststroke'
        : strokeFilter === 'butterfly'        ? 'Butterfly'
        : strokeFilter === 'individual medley' ? 'IM'
        : strokeFilter;
      chips.push({
        key: 'stroke', label: strokeLabel,
        clear: () => setStrokeFilter('all'),
      });
    }
    if (groupId !== 'all') {
      const grp = allGroups.find(g => g.id === groupId);
      if (grp) chips.push({ key: 'group', label: grp.name, clear: () => setGroupId('all') });
    }
    if (dateRange !== 'all') {
      const lbl = dateRange === '7d' ? 'Last 7 days'
                : dateRange === '30d' ? 'Last 30 days'
                : 'Last 90 days';
      chips.push({ key: 'date', label: lbl, clear: () => setDateRange('all') });
    }
    if (search.trim()) chips.push({
      key: 'search', label: '"' + search.trim() + '"', clear: () => setSearch(''),
    });
    return chips;
  })();

  // v01.41 — DB-backed save / delete. The shape returned by
  // NewGroupModal stays the same ({id, name, athleteUuids,
  // preset:false}), but `id` is now either 'custom-<timestamp>'
  // for a new group (insert) or an existing group_uuid (update
  // members).
  const saveGroup = async (group) => {
    if (!teamUuid || !window.PA_GROUPS) {
      // Defensive: falls back to in-memory only if PA_GROUPS isn't
      // loaded yet. Shouldn't happen in practice — index.html
      // loads groups.js before this component.
      const next = customGroups.filter(g => g.id !== group.id).concat(group);
      setCustomGroups(next);
      setGroupModal(null); setGroupId(group.id);
      return;
    }
    try {
      // New groups get an auto-assigned palette color (same
      // rotation the migration helper uses) — coaches haven't
      // surfaced a color picker yet, this keeps groups visually
      // distinguishable until they have.
      const isNew = !group.id || String(group.id).startsWith('custom-');
      if (isNew) {
        const color = (window.PA_GROUPS.PALETTE || ['var(--signal-eff)'])[
          customGroups.length % (window.PA_GROUPS.PALETTE || ['']).length
        ];
        const { ok, groupUuid } = await window.PA_GROUPS.createGroup(
          teamUuid, group.name, color, group.athleteUuids || []
        );
        if (!ok) {
          try { window.PA_TOAST?.show('Could not save group', { type: 'error' }); } catch (_) {}
          return;
        }
        // Refresh from DB so we get the canonical row back
        // (group_uuid + color + members).
        const { groups } = await window.PA_GROUPS.listGroups(teamUuid);
        setCustomGroups(groups || []);
        setGroupModal(null); setGroupId(groupUuid);
      } else {
        // Existing group — update members only (rename + color
        // editing not surfaced in the current modal yet).
        const { ok } = await window.PA_GROUPS.updateGroupMembers(
          group.id, group.athleteUuids || []
        );
        if (!ok) {
          try { window.PA_TOAST?.show('Could not update group', { type: 'error' }); } catch (_) {}
          return;
        }
        const { groups } = await window.PA_GROUPS.listGroups(teamUuid);
        setCustomGroups(groups || []);
        setGroupModal(null); setGroupId(group.id);
      }
    } catch (e) {
      try { console.warn('[web-races] saveGroup failed:', e); } catch (_) {}
      try { window.PA_TOAST?.show('Could not save group', { type: 'error' }); } catch (_) {}
    }
  };
  const deleteGroup = async (id) => {
    if (!window.PA_GROUPS || !id || String(id).startsWith('preset-')) {
      // No-op for preset groups (they're computed, not stored).
      return;
    }
    try {
      const { ok } = await window.PA_GROUPS.deleteGroup(id);
      if (!ok) {
        try { window.PA_TOAST?.show('Could not delete group', { type: 'error' }); } catch (_) {}
        return;
      }
      setCustomGroups(prev => prev.filter(g => g.id !== id));
      if (groupId === id) setGroupId('all');
    } catch (e) {
      try { console.warn('[web-races] deleteGroup failed:', e); } catch (_) {}
    }
  };

  // ── v00.82: Compare mode plumbing ──
  // Composite key for kpi rows — survives without race_uuid.
  // Each modality has different signature columns, so we hash the
  // whole row's primitive values for a generic key.
  const slotRowKey = (r) => {
    if (!r) return null;
    return Object.keys(r).sort().map(k => k + ':' + r[k]).join('|');
  };

  // Lazy-fetch full trials for both slots in parallel, then render.
  const onCompareTrials = async (a, b) => {
    if (!compareConfig || !compareConfig.fetchFullTrial) return;
    setComparing(true);
    setCompareErr(null);
    try {
      const [aT, bT] = await Promise.all([
        compareConfig.fetchFullTrial(a),
        compareConfig.fetchFullTrial(b),
      ]);
      if (!aT || !bT) {
        setCompareErr('Could not resolve one of the trials. Check console for details.');
        setComparing(false);
        return;
      }
      setTrialA(aT); setTrialB(bT);
      setComparing(false);
    } catch (e) {
      try { console.error('[team-compare] fetch failed:', e); } catch (_) {}
      setCompareErr(String(e.message || e));
      setComparing(false);
    }
  };

  // Auto-fire when both trial picks land.
  useRacesEffect(() => {
    if (mode !== 'compare') return;
    if (!compareConfig) return;
    if (!pickTrialA || !pickTrialB) return;
    if (comparing) return;
    onCompareTrials(pickTrialA, pickTrialB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    pickTrialA && slotRowKey(pickTrialA),
    pickTrialB && slotRowKey(pickTrialB),
  ]);

  if (loading) {
    const LS = window.LoadingState;
    return LS
      ? <LS label={'Loading squad ' + heroNoun + 's…'} large/>
      : (
        <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
          Loading squad {heroNoun}s…
        </div>
      );
  }
  if (error) {
    const ES = window.ErrorState;
    const onRetry = () => { setError(null); setRefetchToken(t => t + 1); };
    return ES
      ? <ES message={'We hit an error pulling squad ' + heroNoun + ' data. Try again, or refresh the page if it keeps failing.'}
            onRetry={onRetry}
            technical={String(error)}/>
      : (
        <div style={{ padding: 24, color: 'var(--flag-eff)', font: '500 13px var(--font-ui)' }}>
          {error}
        </div>
      );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* HERO */}
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {teamName ? 'SQUAD · ' + teamName.toUpperCase() + ' · ' + heroLabel : 'SQUAD ' + heroLabel}
        </div>
        <div className="display" style={{
          fontSize: 26, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          lineHeight: 1.2, maxWidth: 760,
        }}>
          {athletes.length} {athletes.length === 1 ? 'athlete' : 'athletes'}
          <span style={{ color: 'var(--tx-md)', font: '500 18px var(--font-ui)', marginLeft: 8 }}>
            · {modRows.length} {modRows.length === 1 ? heroNoun : heroNoun + 's'}
          </span>
        </div>
      </div>

      {/* SEARCH + FILTERS BUTTON */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <input
            type="text" placeholder="Search athlete or event…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 14px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'var(--bg-2)',
              color: 'var(--tx-hi)', font: '500 13px var(--font-ui)', outline: 'none',
            }}/>
        </div>
        <button onClick={() => setFiltersOpen(!filtersOpen)} style={{
          padding: '10px 14px', borderRadius: 10,
          background: filtersOpen ? 'var(--bg-3)' : 'var(--bg-2)',
          color: 'var(--tx-hi)', border: '1px solid var(--line)',
          font: '600 12px var(--font-ui)', cursor: 'pointer',
          letterSpacing: 0.04, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          Filters
          {activeChips.length > 0 && (
            <span style={{
              background: 'var(--signal-eff)', color: 'var(--ink)',
              borderRadius: 999, padding: '1px 7px',
              font: '700 10px var(--font-mono)',
            }}>{activeChips.length}</span>
          )}
          <span style={{ marginLeft: 2 }}>{filtersOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      {/* FILTER DRAWER */}
      {filtersOpen && (
        <div className="card" style={{
          padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
          background: 'var(--bg-3)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--tx-lo)' }}>GENDER</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { k: 'all', label: 'All' },
                { k: 'female', label: 'Female' },
                { k: 'male', label: 'Male' },
              ].map(opt => {
                const active = genderFilter === opt.k;
                return (
                  <button key={opt.k} onClick={() => setGenderFilter(opt.k)} style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: active ? 'var(--signal-eff)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--tx-md)',
                    border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line-soft)'),
                    font: '600 12px var(--font-ui)', cursor: 'pointer',
                  }}>{opt.label}</button>
                );
              })}
            </div>
          </div>

          {/* v01.02 — Stroke filter quick-pills. On Races filters
              by trial style; on Starts/Turns filters athletes
              who have raced that stroke (kpi views don't expose
              style directly). */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--tx-lo)' }}>STROKE</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { k: 'all',       label: 'All' },
                { k: 'freestyle', label: 'Free' },
                { k: 'backstroke',label: 'Back' },
                { k: 'breaststroke', label: 'Breast' },
                { k: 'butterfly', label: 'Fly' },
                { k: 'individual medley', label: 'IM' },
              ].map(opt => {
                const active = strokeFilter === opt.k;
                return (
                  <button key={opt.k} onClick={() => setStrokeFilter(opt.k)} style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: active ? 'var(--signal-eff)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--tx-md)',
                    border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line-soft)'),
                    font: '600 12px var(--font-ui)', cursor: 'pointer',
                  }}>{opt.label}</button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>GROUP</span>
              <button onClick={() => setGroupModal('new')} style={{
                font: '600 10px var(--font-mono)', letterSpacing: 0.04,
                padding: '3px 9px', borderRadius: 6,
                background: 'transparent', color: 'var(--signal-eff)',
                border: '1px solid color-mix(in oklch, var(--signal-eff) 38%, transparent)',
                cursor: 'pointer',
              }}>+ NEW GROUP</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setGroupId('all')} style={{
                padding: '6px 12px', borderRadius: 999,
                background: groupId === 'all' ? 'var(--signal-eff)' : 'transparent',
                color: groupId === 'all' ? 'var(--ink)' : 'var(--tx-md)',
                border: '1px solid ' + (groupId === 'all' ? 'var(--signal-eff)' : 'var(--line-soft)'),
                font: '600 12px var(--font-ui)', cursor: 'pointer',
              }}>All athletes</button>
              {allGroups.map(g => {
                const active = groupId === g.id;
                const count = g.preset
                  ? athletes.filter(a => g.match(a.athlete_uuid, eventsByUuid)).length
                  : (g.athleteUuids || []).length;
                // v01.42 — render the group's color. Custom groups
                // carry one from the DB (rotating palette); presets
                // fall back to the signal accent.
                const accent = (!g.preset && g.color) ? g.color : 'var(--signal-eff)';
                return (
                  <div key={g.id} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
                    <button onClick={() => setGroupId(g.id)} style={{
                      padding: '6px 12px',
                      borderRadius: g.preset ? 999 : '999px 0 0 999px',
                      background: active ? accent : 'transparent',
                      color: active ? 'var(--ink)' : 'var(--tx-md)',
                      border: '1px solid ' + (active ? accent : 'var(--line-soft)'),
                      font: '600 12px var(--font-ui)', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}>
                      {/* Color dot for custom groups in inactive state.
                          When active, the chip's background is already
                          the group color, so the dot would be redundant
                          (and hard to see against same-color bg). */}
                      {!g.preset && !active && (
                        <span aria-hidden="true" style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: accent,
                          flexShrink: 0,
                        }}/>
                      )}
                      {g.name}
                      <span style={{ fontSize: 10, opacity: 0.7 }}>·{count}</span>
                    </button>
                    {!g.preset && (
                      <>
                        <button onClick={() => setGroupModal(g)} title="Edit"
                          style={{
                            padding: '6px 7px',
                            background: active ? accent : 'transparent',
                            color: active ? 'var(--ink)' : 'var(--tx-lo)',
                            border: '1px solid ' + (active ? accent : 'var(--line-soft)'),
                            borderLeft: 'none',
                            font: '500 11px var(--font-ui)', cursor: 'pointer',
                          }}>✎</button>
                        <button onClick={() => {
                          if (window.confirm('Delete group "' + g.name + '"?')) deleteGroup(g.id);
                        }} title="Delete"
                          style={{
                            padding: '6px 9px', borderRadius: '0 999px 999px 0',
                            background: 'transparent', color: 'var(--tx-lo)',
                            border: '1px solid var(--line-soft)', borderLeft: 'none',
                            font: '500 11px var(--font-ui)', cursor: 'pointer',
                          }}>✕</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--tx-lo)' }}>DATE RANGE</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { k: '7d',  label: 'Last 7 days' },
                { k: '30d', label: 'Last 30 days' },
                { k: '90d', label: 'Last 90 days' },
                { k: 'all', label: 'All time' },
              ].map(opt => {
                const active = dateRange === opt.k;
                return (
                  <button key={opt.k} onClick={() => setDateRange(opt.k)} style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: active ? 'var(--signal-eff)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--tx-md)',
                    border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line-soft)'),
                    font: '600 12px var(--font-ui)', cursor: 'pointer',
                  }}>{opt.label}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE FILTER CHIPS */}
      {activeChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {activeChips.map(chip => (
            <span key={chip.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 999,
              background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
              color: 'var(--tx-hi)', font: '500 11px var(--font-ui)',
              border: '1px solid color-mix(in oklch, var(--signal-eff) 38%, transparent)',
            }}>
              {chip.label}
              <button onClick={chip.clear} style={{
                background: 'transparent', border: 'none', color: 'var(--tx-md)',
                cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1,
              }}>✕</button>
            </span>
          ))}
          {activeChips.length > 1 && (
            <button onClick={() => {
              setGenderFilter('all'); setGroupId('all');
              setDateRange('all'); setSearch(''); setStrokeFilter('all');
            }} style={{
              padding: '4px 10px', borderRadius: 999,
              background: 'transparent', color: 'var(--tx-lo)',
              border: '1px solid var(--line-soft)',
              font: '500 11px var(--font-ui)', cursor: 'pointer',
            }}>Clear all</button>
          )}
        </div>
      )}

      {/* MODE TABS — only shown when compareConfig is provided */}
      {compareConfig && (
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--line-soft)', gap: 0,
        }}>
          {[
            { k: 'browse',  label: 'Browse' },
            { k: 'compare', label: 'Compare' },
          ].map(t => {
            const active = mode === t.k;
            return (
              <button key={t.k} onClick={() => {
                // v02.21 — gate the Compare tab for free users.
                if (t.k === 'compare' && !gateCompare()) return;
                setMode(t.k);
              }} style={{
                padding: '10px 18px', background: 'transparent',
                color: active ? 'var(--tx-hi)' : 'var(--tx-lo)',
                border: 'none',
                borderBottom: '2px solid ' + (active ? 'var(--signal-eff)' : 'transparent'),
                font: '600 13px var(--font-ui)', cursor: 'pointer',
                marginBottom: -1, letterSpacing: 0.02,
              }}>{t.label}</button>
            );
          })}
        </div>
      )}

      {/* BROWSE MODE — athlete card grid + pagination */}
      {(!compareConfig || mode === 'browse') && (
        !filteredAthletes.length ? (
          window.EmptyState
            ? <window.EmptyState
                dense
                eyebrow="NO MATCHES"
                title="No athletes match these filters"
                body="Try clearing the date range or stroke filter, or adjust your group selection."
              />
            : (
              <div className="card" style={{
                padding: 28, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)',
                textAlign: 'center',
              }}>
                No athletes match the filters.
              </div>
            )
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}>
              {paginated.map(a => (
                <AthleteCard key={a.athlete_uuid}
                  athlete={a}
                  stats={activity.byAthlete?.[a.athlete_uuid]}
                  summaryNode={summaryFor(a, modByUuid[a.athlete_uuid] || [])}
                  onClick={() => onPickAthlete && onPickAthlete({
                    uuid: a.athlete_uuid,
                    name: window.PA_ADMIN.athleteName(a),
                  })}
                  compareAction={compareConfig ? () => {
                    // v00.86 quick-compare — switch to Compare
                    // mode with this athlete + their most-recent
                    // trial pre-filled in slot A. Coach just
                    // needs to pick slot B's athlete + trial.
                    // v02.21 — gate for free coaches.
                    if (!gateCompare()) return;
                    const trials = (modByUuid[a.athlete_uuid] || [])
                      .slice()
                      .sort((x, y) =>
                        (x.source_date || '') > (y.source_date || '') ? -1 : 1);
                    setMode('compare');
                    setPickAthA(a.athlete_uuid);
                    if (trials[0]) setPickTrialA(trials[0]);
                    setTrialA(null); setTrialB(null);
                    setCompareErr(null);
                    // Clear slot B if it was pointing at the same
                    // athlete (avoids stale self-compare).
                    if (pickAthB === a.athlete_uuid) {
                      setPickAthB(null); setPickTrialB(null);
                    }
                  } : null}/>
              ))}
            </div>
            {totalPages > 1 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 4, font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                flexWrap: 'wrap', gap: 8,
              }}>
                <span>
                  Showing {safePage * PAGE_SIZE + 1}–{Math.min(filteredAthletes.length, (safePage + 1) * PAGE_SIZE)} of {filteredAthletes.length}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                    style={{
                      padding: '6px 12px', borderRadius: 8,
                      background: safePage === 0 ? 'var(--bg-3)' : 'var(--bg-2)',
                      color: safePage === 0 ? 'var(--tx-lo)' : 'var(--tx-hi)',
                      border: '1px solid var(--line-soft)',
                      font: '600 12px var(--font-ui)',
                      cursor: safePage === 0 ? 'not-allowed' : 'pointer',
                    }}>← Prev</button>
                  <button onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                    disabled={safePage >= totalPages - 1}
                    style={{
                      padding: '6px 12px', borderRadius: 8,
                      background: safePage >= totalPages - 1 ? 'var(--bg-3)' : 'var(--bg-2)',
                      color: safePage >= totalPages - 1 ? 'var(--tx-lo)' : 'var(--tx-hi)',
                      border: '1px solid var(--line-soft)',
                      font: '600 12px var(--font-ui)',
                      cursor: safePage >= totalPages - 1 ? 'not-allowed' : 'pointer',
                    }}>Next →</button>
                </div>
              </div>
            )}
          </>
        )
      )}

      {/* COMPARE MODE — dual athlete combobox + trial dropdown */}
      {compareConfig && mode === 'compare' && (() => {
        const DetailComponent = compareConfig.DetailComponent;
        return (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
            }}>
              {[
                { idx: 'A', color: 'var(--lime-eff)',
                  ath: pickAthA, setAth: setPickAthA,
                  trial: pickTrialA, setTrial: setPickTrialA,
                  clearTrialFn: () => setTrialA(null) },
                { idx: 'B', color: 'var(--compare-eff)',
                  ath: pickAthB, setAth: setPickAthB,
                  trial: pickTrialB, setTrial: setPickTrialB,
                  clearTrialFn: () => setTrialB(null) },
              ].map(slot => {
                const ath = slot.ath
                  ? athletes.find(a => a.athlete_uuid === slot.ath) : null;
                const athTrials = slot.ath
                  ? (modByUuid[slot.ath] || [])
                      .slice()
                      .sort((a, b) => (a.source_date || '') > (b.source_date || '') ? -1 : 1)
                  : [];
                return (
                  <div key={slot.idx} className="card" style={{
                    padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
                    border: '1px solid ' + (slot.trial ? slot.color : 'var(--line-soft)'),
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span className="mono" style={{
                        font: '700 11px var(--font-mono)',
                        color: slot.color, letterSpacing: 0.06,
                      }}>SLOT {slot.idx}</span>
                      {(slot.ath || slot.trial) && (
                        <button onClick={() => {
                          slot.setAth(null); slot.setTrial(null); slot.clearTrialFn();
                        }} style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--tx-lo)', cursor: 'pointer',
                          font: '500 11px var(--font-ui)', padding: 0,
                        }}>Clear</button>
                      )}
                    </div>
                    <div>
                      <div className="eyebrow" style={{
                        marginBottom: 4, color: 'var(--tx-lo)', fontSize: 9,
                      }}>ATHLETE</div>
                      <Combobox
                        items={filteredAthletes}
                        value={slot.ath}
                        onChange={(uuid) => {
                          // v02.21 — defense-in-depth gate. If a free user
                          // somehow reaches compare mode (stale state, etc),
                          // selecting an athlete here still triggers the
                          // upgrade prompt rather than silently completing.
                          if (!gateCompare()) return;
                          slot.setAth(uuid); slot.setTrial(null); slot.clearTrialFn();
                        }}
                        placeholder="Search athletes…"
                        getLabel={(a) => window.PA_ADMIN.athleteName(a) || 'Athlete'}
                        color={slot.color}/>
                    </div>
                    {ath && (
                      <div>
                        <div className="eyebrow" style={{
                          marginBottom: 4, color: 'var(--tx-lo)', fontSize: 9,
                        }}>{heroNoun.toUpperCase()}</div>
                        {!athTrials.length ? (
                          <div style={{
                            padding: '8px 10px', borderRadius: 8,
                            border: '1px dashed var(--line)',
                            color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
                          }}>
                            No {heroNoun}s in this date range.
                          </div>
                        ) : (
                          <select
                            value={slot.trial ? slotRowKey(slot.trial) : ''}
                            onChange={(e) => {
                              const k = e.target.value;
                              const t = athTrials.find(tr => slotRowKey(tr) === k);
                              slot.setTrial(t || null);
                              slot.clearTrialFn();
                            }}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--line)', background: 'var(--bg-2)',
                              color: 'var(--tx-hi)', font: '500 13px var(--font-ui)',
                              cursor: 'pointer',
                            }}>
                            <option value="">Pick a {heroNoun}…</option>
                            {athTrials.map((t, i) => (
                              <option key={slotRowKey(t) + '_' + i} value={slotRowKey(t)}>
                                {compareConfig.formatTrial(t)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Status row */}
            {(comparing || compareErr) && (
              <div style={{
                padding: 10,
                font: '500 12px var(--font-ui)',
                color: compareErr ? 'var(--flag-eff)' : 'var(--tx-lo)',
              }}>
                {compareErr ? compareErr : 'Loading ' + heroNoun + 's…'}
              </div>
            )}

            {/* Cross-athlete detail render */}
            {trialA && trialB && DetailComponent && (() => {
              const aAth = athletes.find(a => a.athlete_uuid === trialA.athlete_uuid);
              const bAth = athletes.find(a => a.athlete_uuid === trialB.athlete_uuid);
              const aName = aAth ? window.PA_ADMIN.athleteName(aAth) : 'Athlete A';
              const bName = bAth ? window.PA_ADMIN.athleteName(bAth) : 'Athlete B';
              return (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 14,
                  paddingTop: 14, borderTop: '1px solid var(--line-soft)',
                  marginTop: 6,
                }}>
                  <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
                    CROSS-ATHLETE COMPARISON
                  </div>
                  <div className="display" style={{
                    fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
                    lineHeight: 1.25, maxWidth: 760,
                  }}>
                    <span style={{ color: 'var(--lime-eff)' }}>{aName}</span>
                    <span style={{ color: 'var(--tx-md)', font: '500 14px var(--font-ui)', margin: '0 8px' }}>vs.</span>
                    <span style={{ color: 'var(--compare-eff)' }}>{bName}</span>
                  </div>
                  <DetailComponent
                    primary={trialA}
                    compare={trialB}
                    primaryName={aName}
                    compareName={bName}/>
                </div>
              );
            })()}
          </>
        );
      })()}

      {/* GROUP MODAL */}
      {groupModal && (
        <NewGroupModal
          athletes={athletes}
          editing={groupModal === 'new' ? null : groupModal}
          onSave={saveGroup}
          onClose={() => setGroupModal(null)}/>
      )}
    </div>
  );
};

// ── WebTeamRaces (v00.85 — migrated to TeamBrowsePage) ───────
// Was a bespoke 800-line implementation through v00.84. Now a
// thin wrapper around the same shared TeamBrowsePage that
// WebTeamStarts and WebTeamTurns use, eliminating the dual
// compare-mode implementation flagged in v00.82.

// Per-card summary for races: "Latest: <event> · <time>".
// Replaces the AthleteCard default-line behavior (which used
// race-shaped fields directly) with an explicit summaryNode so
// the same shared card stays modality-agnostic.
const RacesTeamSummary = ({ rows }) => {
  if (!rows || !rows.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-md)' }}>
        No races yet
      </div>
    );
  }
  const latest = rows.reduce((b, r) =>
    !b || (r.source_date || '') > (b.source_date || '') ? r : b, null);
  const dist  = latest && latest.distance_m ? Number(latest.distance_m) : null;
  const style = latest && latest.style ? String(latest.style) : null;
  const styleCap = style
    ? style.charAt(0).toUpperCase() + style.slice(1).toLowerCase()
    : '';
  const eventLabel = (dist ? dist + ' ' : '') + styleCap;
  const time = latest && window.PA_KPIS && window.PA_KPIS.fmtTime
    ? window.PA_KPIS.fmtTime(latest.race_time_s, 2) : null;
  return (
    <div style={{
      font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 8, minWidth: 0,
    }}>
      <span style={{
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {eventLabel ? 'Latest: ' + eventLabel : 'Latest race'}
      </span>
      {time && (
        <span className="mono" style={{
          font: '700 13px var(--font-mono)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em',
        }}>{time}</span>
      )}
    </div>
  );
};

// Format a race kpi row for the compare-mode trial dropdown.
const formatRaceTrial = (r) => {
  const d = (() => {
    if (!r.source_date) return '—';
    const dt = new Date(r.source_date);
    return isNaN(dt) ? r.source_date
      : dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  })();
  const dist = r.distance_m ? Number(r.distance_m) : null;
  const style = r.style ? String(r.style) : null;
  const styleCap = style
    ? style.charAt(0).toUpperCase() + style.slice(1).toLowerCase()
    : '';
  const ev = (dist ? dist + ' ' : '') + styleCap;
  const t = window.PA_KPIS && window.PA_KPIS.fmtTime
    ? window.PA_KPIS.fmtTime(r.race_time_s, 2) : '';
  return d + (ev ? ' · ' + ev : '') + (t ? ' · ' + t : '');
};

// Lazy-fetch the full v_race_trials row for a kpi slot. Same
// robust layered narrowing as the v00.77 implementation.
const fetchFullRaceTrial = async (slot) => {
  if (!window.PA_KPIS || !window.PA_KPIS.listRaceTrials) {
    throw new Error('Slot: PA_KPIS not loaded');
  }
  const { data, error } = await window.PA_KPIS.listRaceTrials(
    slot.athlete_uuid, { limit: 200 }
  );
  if (error) throw new Error('Slot: ' + (error.message || 'query error'));
  const rows = data || [];
  if (!rows.length) throw new Error('Slot: no trials for athlete');
  const eqDist = (r) => Number(r.distance_m) === Number(slot.distance_m);
  const eqStyle = (r) =>
    String(r.style || '').toLowerCase()
      === String(slot.style || '').toLowerCase();
  const slotDay = String(slot.source_date || '').slice(0, 10);
  const eqDate = (r) =>
    String(r.source_date || '').slice(0, 10) === slotDay;
  let cands = rows.filter(r => eqDist(r) && eqStyle(r) && eqDate(r));
  if (!cands.length) cands = rows.filter(r => eqDist(r) && eqStyle(r));
  if (!cands.length) cands = rows.filter(r => eqDist(r));
  if (!cands.length) cands = rows;
  const target = parseFloat(slot.race_time_s);
  if (!isFinite(target)) return cands[0];
  const totalOf = (r) => {
    const t = window.PA_KPIS.raceTotalTime
      ? window.PA_KPIS.raceTotalTime(r) : null;
    return t == null ? Infinity : t;
  };
  let best = cands[0];
  let bestDiff = Math.abs(totalOf(best) - target);
  cands.forEach(c => {
    const d = Math.abs(totalOf(c) - target);
    if (d < bestDiff) { best = c; bestDiff = d; }
  });
  return best;
};

// Cross-athlete RaceDetail wrapper. The TeamBrowsePage hero
// already shows "Anna vs. Ben" above this — RaceDetail handles
// its own per-trial labels internally.
const RacesCompareDetail = ({ primary, compare }) => {
  if (!primary || !compare) return null;
  const tagged = Object.assign({}, compare, { _benchmarkKind: null });
  const diff = window.PA_COMPARE
    ? window.PA_COMPARE.diffTrials(primary, tagged) : null;
  return <RaceDetail primary={primary} compare={tagged} diff={diff}/>;
};

const WebTeamRaces = ({ profile, onPickAthlete, isPro, onUpgrade }) => {
  const TBP = window.PA_TEAMUI && window.PA_TEAMUI.TeamBrowsePage;
  if (!TBP) {
    return (
      <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
        Team UI not loaded.
      </div>
    );
  }
  return <TBP
    profile={profile}
    onPickAthlete={onPickAthlete}
    heroLabel="RACES"
    heroNoun="trial"
    modalityView="v_race_kpis"
    modalitySelect="athlete_uuid, race_time_s, distance_m, style, course, source_date"
    summaryFor={(a, rows) => <RacesTeamSummary rows={rows}/>}
    compareConfig={{
      formatTrial:    formatRaceTrial,
      fetchFullTrial: fetchFullRaceTrial,
      DetailComponent: RacesCompareDetail,
    }}
    isPro={isPro}
    onUpgrade={onUpgrade}
  />;
};



const WebRaces = ({ session, authUserId, lang, adminAthleteUuid, isPro: realIsPro, onUpgrade }) => {
  // v01.50 — Preview Pro mode. When PA_PREVIEW.isOn(), we swap
  // the user's real trials for a hardcoded sample dataset and
  // treat them as Pro for gate logic. Subscribes via usePreview
  // so the page re-renders when the user enters/exits preview.
  const previewOn = window.PA_PREVIEW?.usePreview?.() || false;
  const isPro = previewOn ? true : !!realIsPro;
  // P-9 (v00.74) — when persona is coach AND no athlete is
  // impersonated, the parent (index.html App) routes to
  // WebTeamRaces instead of WebRaces. Per-athlete WebRaces is
  // unchanged from v00.73; the team view is a sibling.
  // Athlete UUID lookup — profile object is not wired through this
  // route yet, so resolve via v_my_athlete the same way the live
  // dashboard does. This is an RLS-filtered single-row read.
  const [athleteUuid, setAthleteUuid] = useRacesState(null);
  const [trials,      setTrials]      = useRacesState([]);
  const [loading,     setLoading]     = useRacesState(true);
  const [error,       setError]       = useRacesState(null);
  // v01.05 — refetch token for retry-on-error
  const [refetchToken, setRefetchToken] = useRacesState(0);
  // v01.07 — mobile breakpoint for grid stacking
  const isMobile = (window.useIsMobile || (() => false))();
  // v01.24 — translation hook for chrome (TRIALS eyebrow, count
  // caption, video card title, loading / error states).
  const t = (window.useT || (() => (k) => k))();

  // Selection (Option D)
  const [slotAKey, setSlotAKey] = useRacesState(null);
  const [slotBKey, setSlotBKey] = useRacesState(null);   // trial key
  const [slotBKind, setSlotBKind] = useRacesState(null); // 'PB' | 'MEDIAN' | null

  // Filters
  const [filters, setFilters] = useRacesState({ distance: null, style: null, course: null });

  // v03.28 — collapsible trial list (same pattern as Sessions / Starts / Turns).
  const [trialListCollapsed, setTrialListCollapsed] = useRacesState(false);

  // ── Resolve athlete_uuid ─────────────────────────────────────
  // v00.48: super-admin override via adminAthleteUuid prop. When
  // set, the v_my_athlete lookup is skipped and we render the
  // selected athlete's data instead. Slot + filter state resets
  // below so we don't carry stale trial keys across athletes.
  useRacesEffect(() => {
    let cancelled = false;
    if (adminAthleteUuid) {
      setAthleteUuid(adminAthleteUuid);
      setTrials([]);
      setError(null);
      // Reset selection so we don't try to look up a slotAKey
      // from the previous athlete.
      setSlotAKey(null);
      setSlotBKey(null);
      setSlotBKind(null);
      setFilters({ distance: null, style: null, course: null });
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const { data, error } = await window.supabaseClient
          .from('v_my_athlete').select('athlete_uuid').maybeSingle();
        if (cancelled) return;
        if (error && error.code !== 'PGRST116') {
          setError('Could not resolve athlete'); setLoading(false); return;
        }
        setAthleteUuid(data?.athlete_uuid || null);
      } catch (e) {
        if (!cancelled) { setError(String(e.message || e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [authUserId, adminAthleteUuid]);

  // ── Fetch trials once athlete_uuid is known ──────────────────
  useRacesEffect(() => {
    if (!athleteUuid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await window.PA_KPIS.listRaceTrials(athleteUuid, { limit: 200 });
      if (cancelled) return;
      if (error) setError(error.message || 'Query failed');
      setTrials(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [athleteUuid, refetchToken]);

  // ── Derived: options, filtered list, slot objects, diff ──────
  // v01.50 — when preview is on, swap real trials for the sample
  // dataset before any derivation. Everything below this line
  // operates on `effectiveTrials` so filter chips, slot logic,
  // charts, etc. all "just work" on sample.
  const effectiveTrials = previewOn && window.PA_SAMPLE
    ? window.PA_SAMPLE.RACES
    : trials;
  const options  = useRacesMemo(
    () => window.PA_KPIS.optionsFrom(effectiveTrials),
    [effectiveTrials]
  );
  const filtered = useRacesMemo(
    () => window.PA_KPIS.applyFilters(effectiveTrials, filters),
    [effectiveTrials, filters]
  );

  const slotATrial = useRacesMemo(
    () => window.PA_KPIS.findByKey(effectiveTrials, slotAKey),
    [effectiveTrials, slotAKey]
  );

  // v01.19 — async WR resolver. PB and MEDIAN come from the
  // athlete's own peer trials (synchronous, in-memory), but WR
  // requires hitting the production `benchmarks` table. Cache the
  // resolved WR row in state and clear it on slot reset so the
  // race-event-changes case stays correct.
  const [wrTrial, setWrTrial] = useRacesState(null);
  useRacesEffect(() => {
    if (slotBKind !== 'WR' || !slotATrial) {
      setWrTrial(null);
      return undefined;
    }
    let cancelled = false;
    setWrTrial(null); // clear stale WR while fetching new one
    (async () => {
      const t = await window.PA_COMPARE?.fetchWRBenchmark?.(slotATrial);
      if (!cancelled) setWrTrial(t || null);
    })();
    return () => { cancelled = true; };
  }, [slotBKind, slotATrial]);

  const slotBTrial = useRacesMemo(() => {
    if (slotBKind === 'WR') {
      // wrTrial may be null (still loading or no match). Either
      // case downstream renders benchmarkUnavailable correctly.
      return wrTrial;
    }
    if (slotBKind && slotATrial) {
      return window.PA_COMPARE.benchmarkTrial(effectiveTrials, slotBKind, slotATrial);
    }
    return window.PA_KPIS.findByKey(effectiveTrials, slotBKey);
  }, [effectiveTrials, slotBKey, slotBKind, slotATrial, wrTrial]);

  // v01.61 — Publish current trial context for Pulse AI.
  useRacesEffect(() => {
    if (!window.PA_PULSE) return;
    const label = slotATrial
      ? ('Race · ' + (window.PA_KPIS?.raceLabel?.(slotATrial) || slotATrial.style || 'trial'))
      : 'Races (no trial selected)';
    window.PA_PULSE.setContext({
      module: 'race',
      primary: slotATrial || null,
      compare: slotBTrial || null,
      label,
    });
  }, [slotATrial, slotBTrial]);

  const diff = useRacesMemo(() => {
    if (!slotATrial || !slotBTrial) return null;
    return window.PA_COMPARE.diffTrials(slotATrial, slotBTrial);
  }, [slotATrial, slotBTrial]);

  const mode = slotBKind ? 'benchmark' : slotBTrial ? 'compare' : 'single';

  // When a benchmark (PB / MEDIAN) is picked but no peer trial matches
  // the primary's event (same distance · stroke · course), benchmarkTrial
  // returns null. Surface that explicitly so the user knows *why*
  // nothing compared, instead of the slot silently doing nothing.
  const benchmarkUnavailable = !!slotBKind && !!slotATrial && !slotBTrial;

  // ── Row click semantics (Option D) ───────────────────────────
  const onAssign = (trial) => {
    const k = window.PA_KPIS.trialKey(trial);
    if (k === slotAKey) { setSlotAKey(null); return; }
    if (k === slotBKey) { setSlotBKey(null); setSlotBKind(null); return; }
    if (!slotAKey) { setSlotAKey(k); return; }
    // v02.21 — Compare gate refined (2026-05-12).
    // - Athlete on own page (adminAthleteUuid falsy): still Pro-locked.
    //   Comparing my own trials is part of the paid value for athletes.
    // - Coach/admin viewing an athlete (adminAthleteUuid truthy): free.
    //   Same-swimmer compare is essential to a coach's daily workflow.
    // - Cross-athlete compare lives in TeamBrowsePage and has its own gate.
    const isCoachOrAdminMode = !!adminAthleteUuid;
    if (!isPro && !isCoachOrAdminMode) {
      try {
        const tt = (window.useT || (() => (k) => k))();
        window.PA_TOAST?.show(tt('analysis.compareLock.toastBody'), {
          type: 'info',
          title: tt('analysis.compareLock.toastTitle'),
        });
      } catch (_) {}
      onUpgrade?.();
      return;
    }
    // slotA filled → fill slotB (clears any benchmark)
    setSlotBKey(k);
    setSlotBKind(null);
  };

  const onPickBenchmark = (kind) => { setSlotBKey(null); setSlotBKind(kind); };
  const onClearA = () => setSlotAKey(null);
  const onClearB = () => { setSlotBKey(null); setSlotBKind(null); };

  // ── Render states ────────────────────────────────────────────
  if (loading) {
    const LS = window.LoadingState;
    return LS
      ? <LS label={t('analysis.loadingState.races')} large/>
      : (
        <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
          {t('analysis.loadingState.races')}
        </div>
      );
  }
  if (error) {
    const ES = window.ErrorState;
    // The setRefetchToken arrow's `tok` parameter shadows nothing —
    // outer `t` (translation) is unaffected.
    const onRetry = () => { setError(null); setRefetchToken(tok => tok + 1); };
    return ES
      ? <ES message={t('analysis.errorState.racesMessage')}
            onRetry={onRetry}
            technical={String(error)}/>
      : (
        <div style={{ padding: 24, color: 'var(--flag-eff)', font: '500 13px var(--font-ui)' }}>
          {error}
        </div>
      );
  }
  // v01.50 — guard on effectiveTrials so preview mode bypasses.
  if (!effectiveTrials.length) {
    const previewBtn = (window.PA_PREVIEW && !previewOn)
      ? (
        <button type="button"
          onClick={() => window.PA_PREVIEW.enter()}
          style={{
            padding: '9px 16px', borderRadius: 10,
            border: 'none', background: 'var(--signal-eff)',
            color: 'var(--ink)',
            font: '700 12px var(--font-ui)', letterSpacing: 0.02,
            cursor: 'pointer',
          }}>
          {t('preview.previewBtn')}
        </button>
      )
      : null;
    return (
      window.EmptyState
        ? <window.EmptyState
            eyebrow={t('analysis.emptyState.racesEyebrow')}
            title={t('analysis.emptyState.racesTitle')}
            body={t('analysis.emptyState.racesBody')}
            action={previewBtn}
          />
        : (
          <div style={{
            padding: 28, borderRadius: 14,
            background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
            color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('analysis.emptyState.racesEyebrow')}</span>
            <div className="display" style={{ fontSize: 20, color: 'var(--tx-hi)' }}>
              Request your first race analysis
            </div>
            <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
              Once a race is processed, your splits, stroke rate, and stroke count
              will appear here. You can compare any two races side by side, or a
              race against your personal best.
            </p>
          </div>
        )
    );
  }

  const summary = diff ? window.PA_COMPARE.summarize(diff) : null;

  // Compare-mode header chip showing the total delta
  const compareLabel = slotBKind
    ? (slotBKind === 'PB' ? 'vs PERSONAL BEST'
     : slotBKind === 'MEDIAN' ? 'vs MEDIAN RACE' : 'vs BENCHMARK')
    : slotBTrial
      ? 'vs ' + window.PA_KPIS.raceTitle(slotBTrial).toUpperCase()
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Request Analysis (v01.59 — synced from mobile v02.12) —
          contextual placement on Races page. Same component as the
          sidebar, here right-aligned and compact so it sits cleanly
          above the filter row without competing with it. Hidden in
          admin-impersonation mode so super-admin viewing someone
          else's races doesn't accidentally dispatch a request as
          themselves. */}
      {!adminAthleteUuid && athleteUuid && window.RequestAnalysisInline && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <window.RequestAnalysisInline
            athleteUuid={athleteUuid}
            fullWidth={false}
            compact={true}/>
        </div>
      )}

      <FilterBar options={options} filters={filters} onChange={setFilters}/>

      <SelectionSlots
        slotATrial={slotATrial}
        slotBTrial={slotBKind ? null : slotBTrial}
        slotBKind={slotBKind}
        onClearA={onClearA}
        onClearB={onClearB}
        onPickBenchmark={onPickBenchmark}
        benchmarkUnavailable={benchmarkUnavailable}
        showWR={true}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile
          ? '1fr'
          : (trialListCollapsed ? '56px 1fr' : 'minmax(280px, 360px) 1fr'),
        gap: 16,
        alignItems: 'start',
      }}>
        {/* ── LEFT: trials picker card — collapsible on desktop + mobile (v03.64) ── */}
        {trialListCollapsed ? (
          <div style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line-soft)',
            borderRadius: 12, padding: '6px 4px',
          }}>
            <TrialList
              trials={filtered}
              slotAKey={slotAKey}
              slotBKey={slotBKind ? null : slotBKey}
              onAssign={onAssign}
              emptyMessage="No races match these filters."
              isPro={isPro}
              onUpgrade={onUpgrade}
              collapsed
              onToggleCollapsed={() => setTrialListCollapsed(false)}
            />
          </div>
        ) : (
          <ChartCard
            title={t('analysis.trials.title')}
            right={
              <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                {t('analysis.trials.filterCount', { filtered: filtered.length, total: effectiveTrials.length })}
              </span>
            }>
            <TrialList
              trials={filtered}
              slotAKey={slotAKey}
              slotBKey={slotBKind ? null : slotBKey}
              onAssign={onAssign}
              emptyMessage="No races match these filters."
              isPro={isPro}
              onUpgrade={onUpgrade}
              // v03.64 — Toggle active on mobile too.
              onToggleCollapsed={() => setTrialListCollapsed(true)}
            />
          </ChartCard>
        )}

        {/* ── RIGHT: design-reference composition ──────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {!slotATrial ? (
            <ChartCard title="RACE DETAIL">
              <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
                            padding: '24px 0', textAlign: 'center' }}>
                Select a race from the list to see its split-by-split story,
                stroke mechanics, and how it stacks up against your personal best.
              </div>
            </ChartCard>
          ) : (
            <RaceDetail
              primary={slotATrial}
              compare={slotBTrial}
              diff={diff}
              summary={summary}
              isPro={isPro}
              onUpgrade={onUpgrade}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── RaceSummaryRail (v00.45) ──────────────────────────────────
// 5-tile summary rail mirroring the Starts page's pattern. Each
// tile carries a `tip` so MetricTile renders an inline HelpDot.
// Compare slot adds a Δ chip beneath each tile when applicable.
// Front/back-half delta = (avg of last half of laps) − (avg of first half).
// Positive → fade (back half slower than front, classic positive split).
// Negative → negative split (back half faster, target shape for distance work).
//
// Requires at least 4 laps for a meaningful split — single-lap and
// 2-lap races don't support a front/back read.
const frontBackHalfDelta = (trial) => {
  if (!trial) return null;
  const laps = derivePerLap(trial);
  if (!laps || laps.length < 4) return null;
  const half = Math.floor(laps.length / 2);
  const front = laps.slice(0, half);
  const back  = laps.slice(-half);
  const avg = (arr) => arr.reduce((s, l) => s + l.t, 0) / arr.length;
  return +(avg(back) - avg(front)).toFixed(2);
};

const RaceSummaryRail = ({ primary, compare }) => {
  const K = window.PA_KPIS;
  if (!primary) return null;

  const round = (v, d) => v == null ? null : Number(v).toFixed(d);
  const delta = (a, b, d) => (a == null || b == null) ? null : +(a - b).toFixed(d);

  const pTime = K.raceTotalTime(primary);
  const pSR   = K.avgStrokeRate(primary);
  const pDPS  = K.avgDPS(primary);
  const pVel  = K.avgVelocity(primary);
  const pSt   = K.totalStrokes(primary);
  const pFBH  = frontBackHalfDelta(primary);
  // v03.65 — Reaction time from race metrics_json. Templo race
  // exports include `Leaving block` (time from start signal to
  // swimmer leaving the block) — that's what coaches mean when
  // they say "reaction time" for a race. Distinct from the
  // standalone Start trial's `reaction_time_s` (signal → first
  // movement), which is finer-grained but requires a separate
  // start upload.
  const reactOf = (t) => {
    if (!t) return null;
    const mj = t.mj || t.metrics_json || {};
    const raw = mj['Leaving block'] ?? mj['leaving_block'] ?? null;
    const n = raw == null ? null : parseFloat(raw);
    return (n != null && !isNaN(n)) ? n : null;
  };
  const pReact = reactOf(primary);
  const cReact = reactOf(compare);

  const cTime = compare ? K.raceTotalTime(compare) : null;
  const cSR   = compare ? K.avgStrokeRate(compare) : null;
  const cDPS  = compare ? K.avgDPS(compare)        : null;
  const cVel  = compare ? K.avgVelocity(compare)   : null;
  const cSt   = compare ? K.totalStrokes(compare)  : null;
  const cFBH  = compare ? frontBackHalfDelta(compare) : null;

  // v00.47 conditional 5th tile.
  // For races ≥ 400 m the "Front/back-half Δ" tile is more
  // coachable than total stroke count (long-distance pacing is the
  // story; raw strokes balloon to 200+ and lose meaning). Total
  // Strokes still has its own tile on shorter races.
  const distM = parseFloat(primary.distance_m
    || primary.mj?.Distance || primary.metrics_json?.Distance) || 0;
  const useFBH = distM >= 400 && pFBH != null;

  // v00.79 — formatted compare values for the per-tile "vs ..."
  // line. Each format mirrors the primary tile's format so the
  // coach reads both numbers at a glance.
  const fmtFBH = (v) => v == null
    ? null
    : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(2);

  // Front/back tile direction: 'down' is good (back half faster
  // than front = negative split = great), 'up' would be bad.
  const fbhTile = {
    k: 'Back-half Δ',
    // Show signed value — leading "+" on positive (fade), "−"
    // on negative (negative split). MetricTile renders raw `v`
    // string verbatim.
    v: fmtFBH(pFBH),
    vCompare: cFBH == null ? null : fmtFBH(cFBH),
    u: 's', goodDir: 'down',
    d: delta(pFBH, cFBH, 2),
    tip: 'Average lap time of the second half minus the first half. Negative means you closed faster than you opened (negative split). Positive means you faded.',
  };

  const stTile = { k: 'Total Strokes', v: round(pSt, 0), u: '', goodDir: 'down',
    d: delta(pSt, cSt, 0),
    vCompare: cSt == null ? null : round(cSt, 0),
    tip: 'Total strokes summed across captured laps. Lower means a more efficient race.' };

  const items = [
    // v00.54: Race Time uses fmtTime so 2:01.34 no longer reads
    // as "121.34 s." MetricTile detects formatted strings and
    // suppresses the auto-appended "s" unit; delta still shows
    // its own " s" suffix.
    // v00.79: vCompare adds an explicit "vs M:SS.dd" line per tile.
    { k: 'Race Time',    v: K.fmtTime(pTime, 2), u: 's', goodDir: 'down',
      d: delta(pTime, cTime, 2),
      vCompare: cTime == null ? null : K.fmtTime(cTime, 2),
      tip: 'Total race time, last populated split. Lower is faster.' },
    { k: 'Reaction Time', v: round(pReact, 2), u: 's', goodDir: 'down',
      d: delta(pReact, cReact, 2),
      vCompare: cReact == null ? null : round(cReact, 2),
      tip: 'Time from the start signal to leaving the block. Captured per race trial. Elite swimmers are typically in the 0.60–0.75 s range.' },
    { k: 'Avg Stroke Rate', v: round(pSR, 1), u: 'spm', goodDir: 'up',
      d: delta(pSR, cSR, 1),
      vCompare: cSR == null ? null : round(cSR, 1),
      tip: 'Average stroke rate across all 5 m samples. Strokes per minute — a measure of cadence.' },
    { k: 'Avg DPS',      v: round(pDPS, 2), u: 'm',    goodDir: 'up',
      d: delta(pDPS, cDPS, 2),
      vCompare: cDPS == null ? null : round(cDPS, 2),
      tip: 'Distance per stroke. Lap distance ÷ strokes that lap. Higher means each stroke covered more water.' },
    { k: 'Avg Velocity', v: round(pVel, 2), u: 'm/s',  goodDir: 'up',
      d: delta(pVel, cVel, 2),
      vCompare: cVel == null ? null : round(cVel, 2),
      tip: 'Average velocity over the race. Race distance ÷ race time.' },
    useFBH ? fbhTile : stTile,
  ];
  return <MetricGrid items={items} cols={items.length}/>;
};

// ── MechanicsSection (v00.45) ─────────────────────────────────
// Tabbed drilldown for the three correlated mechanics metrics:
// stroke rate, DPS, and velocity. They're mathematically linked
// (velocity = stroke_rate × DPS / 60), so each tab body shows the
// chart for that metric PLUS the other two as mini-KPIs and a
// narrative that calls out the relationship. Reuses PhaseTimeline
// as a generic tab strip.
const MechanicsSection = ({ primary, compare, mode }) => {
  const K = window.PA_KPIS;
  const [tab, setTab] = useRacesState('Stroke Rate');
  const isMobile = (window.useIsMobile || (() => false))();

  const sr  = K.avgStrokeRate(primary);
  const dps = K.avgDPS(primary);
  const vel = K.avgVelocity(primary);
  // v03.09 — compare-race mechanics, for the compare-aware narrative.
  const cSr  = compare ? K.avgStrokeRate(compare) : null;
  const cDps = compare ? K.avgDPS(compare)        : null;
  const cVel = compare ? K.avgVelocity(compare)   : null;

  // Compare-target name. Benchmark holder names are never surfaced
  // (CLAUDE.md) — only the kind. WR shows as "world-record pace".
  const targetName = compare
    ? (compare._benchmarkKind === 'PB'     ? 'your best'
     : compare._benchmarkKind === 'MEDIAN' ? 'your median'
     : compare._benchmarkKind === 'WR'     ? 'world-record pace'
                                            : 'the compare race')
    : null;

  // verdictTail — Approach A comparative clause. `delta` is
  // primary − compare. Returns { mag, rest } where mag is the
  // compare-delta magnitude (rendered purple) and rest is the
  // directional phrase + target. null when nothing to compare.
  const verdictTail = (delta, aboveWord, belowWord, magStr) => {
    if (delta == null) return null;
    if (Math.abs(delta) < 0.005) return { mag: null, rest: 'even with ' + targetName };
    const isAbove = delta > 0;
    return { mag: magStr, rest: (isAbove ? aboveWord : belowWord) + ' ' + targetName };
  };

  const tabs = [
    { name: 'Stroke Rate', label: 'spm vs distance',   range: '5 m granularity',  weight: 1 },
    { name: 'DPS',         label: 'distance / stroke', range: 'per-lap bars',     weight: 1 },
    { name: 'Velocity',    label: 'm/s per segment',   range: 'split-derived',    weight: 1 },
    { name: 'Efficiency',  label: 'SR × DPS scatter',  range: 'per-lap quadrant', weight: 1 },
  ];

  // Mini-KPI tile for the correlated context.
  const Mini = ({ label, value, unit, dec }) => (
    <div>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>{label}</div>
      <div style={{ font: '700 16px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 4 }}>
        {value != null ? value.toFixed(dec ?? 2) : '—'}
        {value != null && unit && (
          <span style={{ fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );

  // Narrative — explicit about the relationship to the other two.
  // v03.10 — every number is a colored span: PRIMARY values green
  // (--lime-eff), COMPARE-related delta purple (--compare-eff),
  // matching the chart legend. In compare mode the self-context
  // tail swaps for the verdict clause.
  const narrative = (() => {
    const G = (txt) => <span style={{ color: 'var(--lime-eff)' }}>{txt}</span>;
    const P = (txt) => <span style={{ color: 'var(--compare-eff)' }}>{txt}</span>;
    const tail = (v) => v.mag
      ? <> — {P(v.mag)} {v.rest}.</>
      : <> — {v.rest}.</>;

    if (tab === 'Stroke Rate') {
      if (sr == null) return null;
      if (compare && cSr != null) {
        const d = +(sr - cSr).toFixed(1);
        const v = verdictTail(d, 'above', 'below', Math.abs(d).toFixed(1) + ' spm');
        return <>Avg stroke rate {G(sr.toFixed(1) + ' spm')}{tail(v)}</>;
      }
      return <>Avg stroke rate {G(sr.toFixed(1) + ' spm')} — paired with {G(dps != null ? dps.toFixed(2) + ' m/stroke' : '—')} of DPS, this drove an average velocity of {G(vel != null ? vel.toFixed(2) + ' m/s' : '—')}.</>;
    }
    if (tab === 'DPS') {
      if (dps == null) return null;
      if (compare && cDps != null) {
        const d = +(dps - cDps).toFixed(2);
        const v = verdictTail(d, 'longer than', 'shorter than', Math.abs(d).toFixed(2) + ' m');
        return <>Avg distance per stroke {G(dps.toFixed(2) + ' m')}{tail(v)}</>;
      }
      return <>Avg distance per stroke {G(dps.toFixed(2) + ' m')} — at {G(sr != null ? sr.toFixed(1) + ' spm' : '—')} cadence, that produced {G(vel != null ? vel.toFixed(2) + ' m/s' : '—')} on average.</>;
    }
    if (tab === 'Velocity') {
      if (vel == null) return null;
      if (compare && cVel != null) {
        const d = +(vel - cVel).toFixed(2);
        const v = verdictTail(d, 'faster than', 'slower than', Math.abs(d).toFixed(2) + ' m/s');
        return <>Avg velocity {G(vel.toFixed(2) + ' m/s')}{tail(v)}</>;
      }
      return <>Avg velocity {G(vel.toFixed(2) + ' m/s')} — the product of {G(sr != null ? sr.toFixed(1) + ' spm' : '—')} stroke rate and {G(dps != null ? dps.toFixed(2) + ' m' : '—')} per-stroke distance.</>;
    }
    if (tab === 'Efficiency') {
      // v00.94 — pivoted to focus on iso-curves. v00.95 — copy
      // adapts when the race is a sprint (≤ 50 m): each dot
      // becomes a 5 m segment instead of a full lap, so the
      // chart reads as a within-race trajectory through the
      // SR × DPS space.
      const distP = primary?.distance_m
        || primary?.mj?.Distance || primary?.metrics_json?.Distance;
      const isSprintTab = Number(distP) > 0 && Number(distP) <= 50;
      const HelpDot = window.HelpDot;
      const dotName = isSprintTab ? '5 m segment' : 'lap';
      const dotPlural = isSprintTab ? 'segments' : 'laps';
      const helpText = (
        <>
          <div style={{ marginBottom: 8 }}>
            <b>How to read it</b>
          </div>
          <div style={{ marginBottom: 6 }}>
            • <b>Position</b> tells the stroke <i>shape</i> — which of
            the four zones the {dotName} fell in.
          </div>
          <div style={{ marginBottom: 6 }}>
            • <b>Iso-curve</b> tells the {dotName}'s <i>speed</i> — every
            point on a curve is the same velocity.
          </div>
          <div style={{ marginBottom: 6 }}>
            • To go faster, a {dotName} has to move to a <b>higher curve</b>
            — either by gaining cadence, gaining DPS, or both.
          </div>
          <div style={{ marginTop: 10, color: 'var(--tx-md)' }}>
            {isSprintTab
              ? <>For sprints, watch where DPS drops while SR climbs — that's where speed leaks during the race.</>
              : <>HOLDING WATER on a high curve = elite execution. Same zone on a low curve = good shape, but not yet fast.</>}
          </div>
        </>
      );
      return (
        <>
          Each dot is one {dotName}, plotted by <span style={{ color: 'var(--lime-eff)' }}>stroke rate</span> (x) and <span style={{ color: 'var(--lime-eff)' }}>distance per stroke</span> (y). The diagonal dashed curves are <span style={{ color: 'var(--tx-hi)' }}>velocity</span> lines — higher curve = faster {dotName}. Same curve = same speed, different stroke shape.{isSprintTab && <> Sprint mode shows {dotPlural} so you can see where speed is gained or lost across the race.</>}{' '}
          {HelpDot && <HelpDot text={helpText} size={13}/>}
        </>
      );
    }
    return null;
  })();

  // Mini-KPI panel tailored to the active tab — always shows the
  // OTHER two metrics so the correlation stays visible.
  const miniPanel = (() => {
    if (tab === 'Stroke Rate') return [{ label: 'Avg DPS', value: dps, unit: 'm', dec: 2 },
                                       { label: 'Avg Velocity', value: vel, unit: 'm/s', dec: 2 }];
    if (tab === 'DPS')         return [{ label: 'Avg Stroke Rate', value: sr,  unit: 'spm', dec: 1 },
                                       { label: 'Avg Velocity',    value: vel, unit: 'm/s', dec: 2 }];
    if (tab === 'Velocity')    return [{ label: 'Avg Stroke Rate', value: sr,  unit: 'spm', dec: 1 },
                                       { label: 'Avg DPS',         value: dps, unit: 'm',   dec: 2 }];
    if (tab === 'Efficiency')  return [{ label: 'Avg Stroke Rate', value: sr,  unit: 'spm', dec: 1 },
                                       { label: 'Avg DPS',         value: dps, unit: 'm',   dec: 2 },
                                       { label: 'Avg Velocity',    value: vel, unit: 'm/s', dec: 2 }];
    return [];
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PhaseTimeline phases={tabs} active={tab} onChange={setTab}/>
      <ChartCard title={'MECHANICS · ' + tab.toUpperCase()}>
        {/* narrative + correlated mini-KPIs across the top */}
        {narrative && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 1.4fr) minmax(180px, 1fr)',
            gap: isMobile ? 12 : 24, alignItems: isMobile ? 'stretch' : 'center', marginBottom: 18,
          }}>
            <div className="display" style={{
              fontSize: 16, lineHeight: 1.35, letterSpacing: '-0.015em',
              color: 'var(--tx-hi)',
            }}>
              {narrative}
            </div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {miniPanel.map(m => <Mini key={m.label} {...m}/>)}
            </div>
          </div>
        )}
        {tab === 'Stroke Rate' && <StrokeRateChart        primary={primary} compare={compare}/>}
        {tab === 'DPS'         && <DPSChart               primary={primary} compare={compare} mode={mode}/>}
        {tab === 'Velocity'    && <RaceVelocityChart      primary={primary} compare={compare}/>}
        {tab === 'Efficiency'  && <SrDpsEfficiencyChart   primary={primary} compare={compare} mode={mode}/>}
      </ChartCard>
    </div>
  );
};

// ── RaceVelocityChart (v00.49) ────────────────────────────────
// Mechanics > Velocity tab chart. Replaces the generic
// `VelocityChart` from analysis-shell which rendered as a featureless
// sawtooth (peaks off each wall, troughs on approaches — visually
// noisy without context).
//
// Adds three structural annotations so the up-and-down pattern reads
// as a swim story instead of as random noise:
//   1. Vertical dashed lap dividers at each lap boundary — turns
//      the sawtooth into discrete laps
//   2. Per-lap "PEAK X.XX" callouts at each lap's velocity max —
//      shows how push-off velocity evolved (lap 1 vs lap 4 fade)
//   3. Horizontal "AVG X.XX m/s" reference line — anchors the trace
//      to the race's overall pace
//
// Adaptive: per-lap peak callouts hide at >16 laps (too dense).
// Lap dividers stay visible — they don't crowd the chart.
//
// Compare overlay: lime primary line draws on top of compare-eff
// compare line, same convention as the rest of the prototype.
const RaceVelocityChart = ({ primary, compare }) => {
  const K = window.PA_KPIS;
  const segA = K.splitsToSegments(K.extractSplits(primary?.mj || primary?.metrics_json));
  const segB = compare ? K.splitsToSegments(K.extractSplits(compare.mj || compare.metrics_json)) : [];

  const toVel = (segs) => segs
    .filter(s => s.segTime > 0)
    .map(s => ({ x: s.distEnd, y: +((s.distEnd - s.distStart) / s.segTime).toFixed(3) }));
  const seriesA = toVel(segA);
  const seriesB = toVel(segB);
  const all = seriesA.concat(seriesB);

  if (!all.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '22px 0', textAlign: 'center' }}>
        Not enough splits to derive velocity.
      </div>
    );
  }

  // Domain
  const xMax   = Math.max(...all.map(p => p.x));
  const rawMax = Math.max(...all.map(p => p.y));
  const rawMin = Math.min(...all.map(p => p.y));
  const padY   = Math.max(0.1, (rawMax - rawMin) * 0.18);
  const yMin   = Math.max(0, rawMin - padY);
  const yMax   = rawMax + padY;

  // Per-lap structure for dividers + peak callouts.
  const lapsPrim = derivePerLap(primary);
  const numLaps  = lapsPrim.length;
  const lapLen   = numLaps > 0 ? (xMax / numLaps) : null;
  const lapBoundaries = lapLen
    ? Array.from({ length: numLaps - 1 }, (_, i) => +((i + 1) * lapLen).toFixed(2))
    : [];

  // Per-lap peak velocity. Computed for BOTH primary and compare
  // (v00.50). Hide at >16 laps to prevent label crowding on long
  // races. To dodge label collision at the same lap position,
  // primary peak labels render above the dot and compare peak
  // labels render below — different y-offsets + different colors
  // so they read as two distinct callouts even when adjacent.
  const showLapPeaks = numLaps > 0 && numLaps <= 16 && seriesA.length > 0;
  const peaksFor = (series) => Array.from({ length: numLaps }, (_, lapIdx) => {
    const lapStart = lapIdx * lapLen;
    const lapEnd   = (lapIdx + 1) * lapLen;
    const inLap    = series.filter(p => p.x > lapStart - 0.5 && p.x <= lapEnd + 0.5);
    if (!inLap.length) return null;
    return inLap.reduce((max, p) => p.y > max.y ? p : max, inLap[0]);
  }).filter(Boolean);
  const lapPeaks    = showLapPeaks ? peaksFor(seriesA) : [];
  const lapPeaksCmp = (showLapPeaks && seriesB.length > 0) ? peaksFor(seriesB) : [];

  // Average velocity (primary). Compare-trial avg is read off
  // the existing summary rail / mini-KPI panel — duplicating it on
  // the chart would clutter without adding signal, so the chart's
  // AVG line stays primary-only. Compare's velocity story reads
  // off the line shape + the per-lap PEAK callouts.
  const avgPrim = seriesA.length
    ? +(seriesA.reduce((s, p) => s + p.y, 0) / seriesA.length).toFixed(3)
    : null;

  // SVG layout
  const W = 720, H = 240, PAD_L = 48, PAD_R = 18, PAD_T = 22, PAD_B = 32;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf = (m) => PAD_L + (m / xMax) * innerW;
  const yOf = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const baseY = H - PAD_B;

  const linePath = (series) => series.length
    ? window.PA_SVG.smoothPath(series.map(p => [xOf(p.x), yOf(p.y)]))
    : '';

  // X-axis ticks — adapt step to race distance.
  const xTickStep = xMax <= 100 ? 25 : xMax <= 400 ? 50 : xMax <= 800 ? 100 : 200;
  const xTicks = [];
  for (let v = 0; v <= xMax + 0.1; v += xTickStep) xTicks.push(Math.round(v));

  const yTicks = [yMax, (yMax + yMin) / 2, yMin];

  // Whether to render the per-segment dots — drop when the line is
  // dense enough that dots smear.
  const showDots = seriesA.length <= 60;

  return (
    <div>
      <window.ChartScroll minWidth={W}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 280 }}>
        {/* Y gridlines */}
        {[0.25, 0.5, 0.75].map(f => {
          const y = PAD_T + f * innerH;
          return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                       stroke="var(--line-soft)" strokeDasharray="2 4"
                       strokeWidth="1" opacity="0.5"/>;
        })}
        {/* Lap boundary dividers — vertical dashed lines. Subtle so
            they read as structure, not as data. */}
        {lapBoundaries.map((x, i) => (
          <line key={'lap' + i}
                x1={xOf(x)} x2={xOf(x)}
                y1={PAD_T} y2={baseY}
                stroke="var(--line)" strokeDasharray="3 6"
                strokeWidth="1" opacity="0.55"/>
        ))}
        {/* X-axis baseline */}
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY}
              stroke="var(--line-soft)" strokeWidth="1"/>
        {/* Average velocity reference line + label */}
        {avgPrim != null && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R}
                  y1={yOf(avgPrim)} y2={yOf(avgPrim)}
                  stroke="var(--tx-lo)" strokeWidth="1.5"
                  strokeDasharray="6 4" opacity="0.8"/>
            <text x={W - PAD_R - 4} y={yOf(avgPrim) - 5}
                  textAnchor="end"
                  fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                  fill="var(--tx-lo)">
              AVG {avgPrim.toFixed(2)} m/s
            </text>
          </g>
        )}
        {/* Compare line first so primary draws on top */}
        {seriesB.length > 0 && (
          <path d={linePath(seriesB)} fill="none"
                stroke="var(--compare-eff)" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"/>
        )}
        {seriesB.length > 0 && showDots && seriesB.map((p, i) => (
          <circle key={'cb' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3" fill="var(--compare-eff)"/>
        ))}
        {/* Primary line */}
        <path d={linePath(seriesA)} fill="none"
              stroke="var(--lime-eff)" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round"/>
        {showDots && seriesA.map((p, i) => (
          <circle key={'ca' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.2" fill="var(--lime-eff)"/>
        ))}
        {/* Per-lap PEAK callouts — primary above the dot, compare
            below. Two-color scheme + opposite y-offset = no
            collision even when the two trials' lap peaks land at
            the same x. */}
        {lapPeaks.map((p, i) => (
          <g key={'pk' + i}>
            <circle cx={xOf(p.x)} cy={yOf(p.y)} r="4.5"
                    fill="none" stroke="var(--lime-eff)" strokeWidth="1.5"/>
            <text x={xOf(p.x)} y={yOf(p.y) - 10}
                  textAnchor="middle"
                  fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                  fill="var(--lime-eff)">
              {p.y.toFixed(2)}
            </text>
          </g>
        ))}
        {lapPeaksCmp.map((p, i) => (
          <g key={'pkc' + i}>
            <circle cx={xOf(p.x)} cy={yOf(p.y)} r="4.5"
                    fill="none" stroke="var(--compare-eff)" strokeWidth="1.5"/>
            <text x={xOf(p.x)} y={yOf(p.y) + 16}
                  textAnchor="middle"
                  fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                  fill="var(--compare-eff)">
              {p.y.toFixed(2)}
            </text>
          </g>
        ))}
        {/* X-axis labels */}
        {xTicks.map(x => x <= xMax + 0.5 && (
          <text key={'x' + x} x={xOf(x)} y={H - PAD_B + 16}
                textAnchor="middle"
                fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-lo)">
            {x} m
          </text>
        ))}
        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={'y' + i} x={PAD_L - 8} y={yOf(v) + 3}
                textAnchor="end"
                fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-lo)">
            {v.toFixed(2)}
          </text>
        ))}
        {/* v03.71 — hover/tap value tooltip on every segment point */}
        {window.ChartHoverLayer && (
          <window.ChartHoverLayer
            pointsA={seriesA.map(p => ({ cx: xOf(p.x), cy: yOf(p.y), dataX: Math.round(p.x), dataY: p.y }))}
            pointsB={seriesB.map(p => ({ cx: xOf(p.x), cy: yOf(p.y), dataX: Math.round(p.x), dataY: p.y }))}
            colorA="var(--lime-eff)" colorB="var(--compare-eff)"
            fmt={(v) => v.toFixed(2)} unit=" m/s" xUnit=" m"
            geom={{ W, PAD_L, PAD_R, PAD_T }}/>
        )}
      </svg>
      </window.ChartScroll>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap',
                    font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 2, background: 'var(--lime-eff)' }}/>
          Primary
        </span>
        {seriesB.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 2, background: 'var(--compare-eff)' }}/>
            Compare
          </span>
        )}
        {showLapPeaks && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%',
                           border: '1.5px solid var(--lime-eff)',
                           background: 'transparent' }}/>
            {lapPeaksCmp.length > 0 && (
              <span style={{ width: 10, height: 10, borderRadius: '50%',
                             border: '1.5px solid var(--compare-eff)',
                             background: 'transparent', marginLeft: -2 }}/>
            )}
            Per-lap peak (above primary, below compare)
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--tx-lo)' }}/>
          Race avg
        </span>
        {numLaps > 1 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 0, borderLeft: '2px dashed var(--line)' }}/>
            Lap boundary
          </span>
        )}
      </div>
    </div>
  );
};

// ── PaceDeviationChart (v00.47, option J) ─────────────────────
// DORMANT as of v00.49 — the chart's math is right but the visual
// story didn't land for athletes. Component kept for post-launch
// revisit (see PaceProfile comment below). Currently has no caller.
//
// Cumulative deviation from this race's own average lap pace.
//
//   per-lap deviation_i = lap_time_i − race_avg_lap_time
//   cum_dev_i = sum_{j=1..i} deviation_j
//
// Mathematical note: by construction `cum_dev_N = 0` for the
// primary's own data — the line ALWAYS ends at the zero baseline.
// The shape between start and finish is what reads:
//   • Curve dives below zero early → fast start (banking time)
//   • Curve climbs above zero late  → fade (spending banked time)
//   • Stays near zero throughout    → even pace
//   • Above-then-below              → negative-split race
//
// Shaded fill between the curve and y = 0 makes the read instant:
//   below zero → faint lime (ahead of race avg)
//   above zero → faint flag (behind race avg)
const PaceDeviationChart = ({ primary, compare }) => {
  const laps    = derivePerLap(primary);
  const lapsCmp = compare ? derivePerLap(compare) : [];

  if (!laps.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '22px 0', textAlign: 'center' }}>
        No split data captured for this race.
      </div>
    );
  }

  // Build cumulative deviation series for primary and (optional) compare.
  const buildSeries = (rows) => {
    let cum = 0;
    return rows.map(r => {
      cum += (r.delta != null ? r.delta : 0);
      return { lap: r.lap, t: r.t, cum: +cum.toFixed(3) };
    });
  };
  const a = buildSeries(laps);
  const b = lapsCmp.length ? buildSeries(lapsCmp) : [];

  // Domain — symmetric around zero so a fast start and fade race
  // both render legibly.
  const allCum = [...a.map(p => p.cum), ...b.map(p => p.cum)];
  const absMax = Math.max(0.5, ...allCum.map(v => Math.abs(v)));
  const yLo    = -absMax * 1.15;
  const yHi    =  absMax * 1.15;
  const xMax   = Math.max(a.length, b.length);
  const xMin   = 1;

  const W = 480, H = 200, PAD_L = 44, PAD_R = 16, PAD_T = 22, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf    = (lap) => PAD_L + ((lap - xMin) / Math.max(xMax - xMin, 1)) * innerW;
  const yOf    = (v)   => PAD_T + (1 - (v - yLo) / (yHi - yLo)) * innerH;
  const baseY  = yOf(0);

  // Sparse lap labels for long races — same tier rules as v00.46.
  const dense       = a.length > 16;
  const veryDense   = a.length > 32;
  const labelEvery  = veryDense ? 5 : dense ? 2 : 1;

  // Build line + filled-area paths. The "above" area fills the
  // region between curve and baseline where curve is positive
  // (slower than avg); the "below" area fills the negative side.
  const linePath = (series) => series.length
    ? window.PA_SVG.smoothPath(series.map(p => [xOf(p.lap), yOf(p.cum)]))
    : '';

  // Two filled regions per series — one clipped above zero, one
  // below. Easier than path-clipping is to use SVG `clipPath`.
  // For prototype simplicity, I render a single area with the
  // curve and use stroke + dot styling to distinguish the parts.
  // The visual win is the curve shape; explicit fill is optional.
  // Smooth area fill — uses the same Catmull-Rom curve as the
  // line, then closes to the baseline so the fill matches the
  // line's shape exactly. Drawing order matters: line goes on top.
  const areaPath = (series) => {
    if (!series.length) return '';
    const top = window.PA_SVG.smoothPath(
      series.map(p => [xOf(p.lap), yOf(p.cum)])
    );
    const lastX  = xOf(series[series.length - 1].lap);
    const firstX = xOf(series[0].lap);
    return top
      + ' L' + lastX.toFixed(2) + ',' + baseY
      + ' L' + firstX.toFixed(2) + ',' + baseY
      + ' Z';
  };

  return (
    <ChartFrame
      legend={
        <Legend compareLabel={compare ? 'Compare' : null} {...{
          colorA: 'var(--lime-eff)', colorB: 'var(--compare-eff)', dashB: '',
        }}/>
      }>
      {/* Y gridlines (above + below zero) */}
      {[absMax * 0.5, absMax, -absMax * 0.5, -absMax].map((v, i) => (
        <line key={'g' + i} x1={PAD_L} x2={W - PAD_R}
              y1={yOf(v)} y2={yOf(v)}
              stroke="var(--line-soft)" strokeDasharray="2 4"
              strokeWidth="1" opacity="0.5"/>
      ))}
      {/* Zero baseline (race average pace) */}
      <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY}
            stroke="var(--tx-lo)" strokeWidth="1.5"/>
      <text x={W - PAD_R + 2} y={baseY + 3}
            fontSize="9" fontFamily="var(--font-mono)"
            fill="var(--tx-lo)" textAnchor="start">
        avg
      </text>
      {/* Primary area fill — faint */}
      <path d={areaPath(a)} fill="var(--lime-eff)" opacity="0.12"/>
      {/* Compare area fill */}
      {b.length > 0 && (
        <path d={areaPath(b)} fill="var(--compare-eff)" opacity="0.10"/>
      )}
      {/* Compare line first so primary draws on top */}
      {b.length > 0 && (
        <path d={linePath(b)} fill="none"
              stroke="var(--compare-eff)" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round"/>
      )}
      {/* Primary line */}
      <path d={linePath(a)} fill="none"
            stroke="var(--lime-eff)" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round"/>
      {/* Dots — auto-suppress when too dense */}
      {a.length <= 60 && a.map((p, i) => (
        <circle key={'a' + i} cx={xOf(p.lap)} cy={yOf(p.cum)} r="3.2"
                fill="var(--lime-eff)"/>
      ))}
      {b.length > 0 && b.length <= 60 && b.map((p, i) => (
        <circle key={'b' + i} cx={xOf(p.lap)} cy={yOf(p.cum)} r="3.2"
                fill="var(--compare-eff)"/>
      ))}
      {/* X-axis ticks (lap numbers, sparsed) */}
      {a.map((p, i) => {
        const labelThis = i % labelEvery === 0 || i === a.length - 1;
        if (!labelThis) return null;
        return (
          <text key={'x' + i} x={xOf(p.lap)} y={H - PAD_B + 14}
                fontSize="10" fontFamily="var(--font-mono)"
                fill="var(--tx-lo)" textAnchor="middle">
            L{p.lap}
          </text>
        );
      })}
      {/* Y-axis labels */}
      {[absMax, 0, -absMax].map((v, i) => (
        <text key={'y' + i} x={PAD_L - 8} y={yOf(v) + 3}
              fontSize="10" fontFamily="var(--font-mono)"
              fill="var(--tx-lo)" textAnchor="end">
          {(v > 0 ? '+' : '') + v.toFixed(2) + 's'}
        </text>
      ))}
    </ChartFrame>
  );
};

// ── BestLapReferenceChart (v00.47, option N) ──────────────────
// DORMANT as of v00.49 — same reason as PaceDeviationChart above:
// the visual story didn't land. Kept for post-launch revisit.
// Currently has no caller.
//
// Per-lap time bars with a horizontal dashed reference line at the
// fastest lap's time. The gap between each bar's top and the
// reference line visualizes fade — the energy management story.
//
// HONEST FRAMING (anti-misread):
//   • The reference line is labeled "BEST-LAP PACE · theoretical max"
//     so users don't misread it as a goal or coaching target.
//   • Color is muted neutral (not lime), since lime means "good"
//     in the rest of the prototype.
//   • Tooltip in the card header explains: best-lap pace is
//     unsustainable; the gap is the fade rate, not a failure.
const BestLapReferenceChart = ({ primary, compare }) => {
  const laps    = derivePerLap(primary);
  const lapsCmp = compare ? derivePerLap(compare) : [];

  if (!laps.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '22px 0', textAlign: 'center' }}>
        No split data captured for this race.
      </div>
    );
  }

  const bestLap    = Math.min(...laps.map(l => l.t));
  const bestLapCmp = lapsCmp.length ? Math.min(...lapsCmp.map(l => l.t)) : null;
  const allTimes   = [...laps.map(l => l.t), ...lapsCmp.map(l => l.t)];
  const yLo = Math.min(bestLap, bestLapCmp != null ? bestLapCmp : bestLap) * 0.97;
  const yHi = Math.max(...allTimes) * 1.05;

  const W = 480, H = 220, PAD_L = 44, PAD_R = 16, PAD_T = 22, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const numLaps = Math.max(laps.length, lapsCmp.length);
  const slot   = innerW / numLaps;
  const xOfLap = (i) => PAD_L + slot * (i + 0.5);
  const yOf    = (v) => PAD_T + (1 - (v - yLo) / (yHi - yLo || 1)) * innerH;

  const dense     = numLaps > 16;
  const veryDense = numLaps > 32;
  const groupFactor = veryDense ? 0.55 : dense ? 0.65 : 0.78;
  const groupW = slot * groupFactor;
  const showB  = lapsCmp.length > 0;
  const barW   = showB ? groupW / 2 - 2 : groupW;
  const labelEvery = veryDense ? 5 : dense ? 2 : 1;

  const cmpByLap = new Map(lapsCmp.map(r => [r.lap, r]));

  return (
    <ChartFrame
      legend={
        <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap',
                      font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 8, background: 'var(--lime-eff)' }}/>
            Primary lap
          </span>
          {showB && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 8, background: 'var(--compare-eff)' }}/>
              Compare lap
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--tx-lo)' }}/>
            Best-lap pace · theoretical max
          </span>
        </div>
      }>
      {/* Y gridlines */}
      {[0.25, 0.5, 0.75].map(f => {
        const y = PAD_T + f * innerH;
        return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                     stroke="var(--line-soft)" strokeDasharray="2 4"
                     strokeWidth="1" opacity="0.5"/>;
      })}
      {/* Bars per lap */}
      {laps.map((l, i) => {
        const cmp = cmpByLap.get(l.lap);
        const cx  = xOfLap(i);
        const groupLeft = cx - groupW / 2;
        const labelThis = i % labelEvery === 0 || i === laps.length - 1;
        return (
          <g key={l.lap}>
            <rect
              x={showB ? groupLeft : cx - barW / 2}
              y={yOf(l.t)}
              width={barW}
              height={Math.max(2, yOf(yLo) - yOf(l.t))}
              fill="var(--lime-eff)"
              rx="2"/>
            {cmp && showB && (
              <rect
                x={groupLeft + barW + 4}
                y={yOf(cmp.t)}
                width={barW}
                height={Math.max(2, yOf(yLo) - yOf(cmp.t))}
                fill="var(--compare-eff)"
                opacity="0.85"
                rx="2"/>
            )}
            {labelThis && (
              <text x={cx} y={H - PAD_B + 14}
                    fontSize="10" fontFamily="var(--font-mono)"
                    fill="var(--tx-lo)" textAnchor="middle">
                L{l.lap}
              </text>
            )}
          </g>
        );
      })}
      {/* Best-lap reference line — primary, dashed neutral */}
      <line x1={PAD_L} x2={W - PAD_R}
            y1={yOf(bestLap)} y2={yOf(bestLap)}
            stroke="var(--tx-lo)" strokeWidth="1.5"
            strokeDasharray="6 4"/>
      <text x={W - PAD_R - 4} y={yOf(bestLap) - 5}
            fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
            fill="var(--tx-lo)" textAnchor="end">
        BEST {bestLap.toFixed(2)}s
      </text>
      {/* Compare reference line, if compare exists and has a different best */}
      {bestLapCmp != null && Math.abs(bestLapCmp - bestLap) > 0.005 && (
        <>
          <line x1={PAD_L} x2={W - PAD_R}
                y1={yOf(bestLapCmp)} y2={yOf(bestLapCmp)}
                stroke="var(--compare-eff)" strokeWidth="1.5"
                strokeDasharray="6 4" opacity="0.7"/>
        </>
      )}
      {/* Y-axis labels */}
      {[yHi, (yHi + yLo) / 2, yLo].map((v, i) => (
        <text key={'yt' + i} x={PAD_L - 8} y={yOf(v) + 3}
              fontSize="10" fontFamily="var(--font-mono)"
              fill="var(--tx-lo)" textAnchor="end">
          {v.toFixed(2)}s
        </text>
      ))}
    </ChartFrame>
  );
};

// ── PaceProfile (v00.47) — tabbed wrapper around 3 race views ─
// Replaces the standalone "SPLIT-BY-SPLIT STORY" card. Three tabs:
//   1. Splits          → existing LapBars (per-lap horizontal bars)
//   2. Pace deviation  → option J (cumulative drift from race avg)
//   3. Best-lap ref    → option N (per-lap bars + theoretical-max line)
//
// Each tab is a different "view" on the same race. Same compare
// slot drives all three. Tab state is local to this component —
// switching the compare picker doesn't reset the active tab.
// PaceProfile — v00.49 simplified back to splits-only.
//
// v00.46 introduced 3 tabs (Splits / Pace deviation / Best-lap ref)
// for race-pacing drilldown. Eric's v00.49 review: the J + N tabs
// don't tell a clear story to athletes — the math is right but the
// reading isn't intuitive. Hiding them for now.
//
// TODO post-launch: revisit `PaceDeviationChart` + `BestLapReferenceChart`
// (still defined above, dormant). Options when we revive them:
//   - Better explainer copy with example callouts
//   - Per-segment annotations on the deviation curve
//   - Tighter integration with the front/back-half tile in the rail
//   - Move them into a separate "Coach view" tab so athletes don't
//     see them by default
// v00.53: aggregation toggle. For long races (>16 laps) the
// per-lap view becomes a barcode of thin rows. The toggle lets
// users (and the chart by default) switch to a per-100 m grouped
// view that aggregates 4 SCY 25 m laps or 2 LCM 50 m laps into
// each bucket — much more readable for 1500/1650.
//
// `userMode` holds the manual override. When null, the auto rule
// (>16 laps → per-100m) decides. Manual override sticks until
// the user toggles back. The toggle button is hidden for races
// with too few laps to make grouping meaningful (≤4 laps).
// v00.73 — pulled out of PaceProfile so the same toggle UI can
// render in the header of any per-lap chart card. State still
// lives in RaceDetail; this component is purely presentational.
// Both the PaceProfile pill and the STROKE MECHANICS pill drive
// the same `userMode` state, so flipping one updates the other
// instantly.
// v03.17 — `options` is course-aware, supplied by RaceDetail:
// short course (25 m laps) gets Per lap / Per 50 m / Per 100 m;
// long course (50 m laps) gets Per 50 m / Per 100 m (per-lap and
// per-50 m are the same thing for LCM).
const MODE_OPTIONS_SC = [
  { k: 'per-lap',  label: 'Per lap'   },
  { k: 'per-50m',  label: 'Per 50 m'  },
  { k: 'per-100m', label: 'Per 100 m' },
];
const MODE_OPTIONS_LC = [
  { k: 'per-50m',  label: 'Per 50 m'  },
  { k: 'per-100m', label: 'Per 100 m' },
];
const AggModeToggle = ({ mode, onChangeMode, options }) => (
  <div style={{
    display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
    border: '1px solid var(--line)', background: 'var(--bg-3)',
  }}>
    {(options || MODE_OPTIONS_LC).map(opt => {
      const active = mode === opt.k;
      return (
        <button key={opt.k}
          onClick={() => onChangeMode && onChangeMode(opt.k)}
          style={{
            padding: '5px 11px',
            border: 'none',
            background: active ? 'var(--signal-eff)' : 'transparent',
            color: active ? 'var(--ink)' : 'var(--tx-md)',
            font: '600 11px var(--font-ui)',
            letterSpacing: 0.04,
            cursor: active ? 'default' : 'pointer',
            transition: 'background 0.12s',
          }}>
          {opt.label}
        </button>
      );
    })}
  </div>
);

// ── SrDpsEfficiencyChart (v00.88 — P-16 Ship 1) ───────────────
//
// Per-lap scatter on a stroke-rate × DPS plane. Each lap is a
// numbered dot. The chart's four quadrants tell the efficiency
// story at a glance:
//
//   Top-right    HOLDING WATER     (high SR + high DPS = fast & efficient)
//   Top-left     GLIDING           (low SR + high DPS = efficient, slow cadence)
//   Bottom-right SLIPPING          (high SR + low DPS = turning over but slipping)
//   Bottom-left  STRUGGLING        (low SR + low DPS)
//
// Quadrant boundary = median(SR), median(DPS) computed across
// the visible laps (combined when comparing, primary's own
// otherwise) so "above/below" is always relative to the
// trial(s) in view — no arbitrary thresholds.
//
// v00.91 — long-distance fix. Accepts the same `mode` prop the
// rest of the per-lap charts use (Per lap | Per 100 m). On a
// 1500 in per-100 m mode, 30 lap dots collapse to 15 readable
// bucket dots; the trajectory line threshold also lifts from
// ≤8 to ≤16 so per-100 m races get the visual story line back.
// Adaptive dot sizing reduces clutter when many bucket dots
// land in a tight cluster.
// v00.93 — story builder. Reads quadrant transitions across the
// lap sequence and produces a single-sentence narrative for
// the chart hero. Plain language, no jargon.
const ZONE_PHRASE = {
  HW: 'the gold zone',
  GL: 'gliding',
  SL: 'slipping',
  ST: 'struggling',
};
const ZONE_TONE = {
  HW: 'var(--lime-eff)',
  GL: 'var(--signal-eff)',
  SL: 'var(--flag-eff)',
  ST: 'var(--tx-md)',
};
// v03.13 — short proper-noun labels for the zone strip + on-chart
// annotation (idea 4 + 5). ZONE_PHRASE is the lowercase narrative
// form; ZONE_LABEL is the chip / legend form.
const ZONE_LABEL = {
  HW: 'Holding Water',
  GL: 'Gliding',
  SL: 'Slipping',
  ST: 'Struggling',
};
const buildEfficiencyStory = (laps, medSR, medDPS, opts) => {
  if (!laps || !laps.length) return null;
  // v00.99 — single-dot trial-average case for sprints with no
  // intermediate splits captured. Render an honest sentence
  // explaining that segment data wasn't available rather than
  // pretending we can describe shape.
  if (laps.length === 1 && laps[0].isTrialAvg) {
    return {
      text: 'Trial average shown — intermediate splits not captured for this race.',
      tone: 'var(--tx-md)',
    };
  }
  if (laps.length < 2) return null;
  // v00.95 — `opts.isSprint` flips the noun ("lap" → "segment")
  // and uses the segment's distance label (e.g. "20 m") instead
  // of "lap N" when describing outliers / midpoints.
  const isSprint = !!(opts && opts.isSprint);
  const NOUN     = isSprint ? 'segment' : 'lap';
  const NOUNS    = isSprint ? 'segments' : 'laps';
  const labelOf  = (l) => isSprint && l.segLabel ? l.segLabel : (NOUN + ' ' + l.lap);

  const zoneOf = (l) => {
    const hi = l.rate >= medSR;
    const high = l.dps >= medDPS;
    if (hi && high) return 'HW';
    if (!hi && high) return 'GL';
    if (hi && !high) return 'SL';
    return 'ST';
  };
  const zones = laps.map(zoneOf);
  const counts = zones.reduce((acc, z) => { acc[z] = (acc[z] || 0) + 1; return acc; }, {});
  const total = zones.length;
  const uniqueZones = Object.keys(counts);

  // 1. All laps/segments in one zone
  if (uniqueZones.length === 1) {
    const z = uniqueZones[0];
    const tone = ZONE_TONE[z];
    if (z === 'HW') {
      return { text: `All ${total} ${NOUNS} in ${ZONE_PHRASE[z]} — clean shape from start to finish.`, tone };
    }
    if (z === 'ST') {
      return { text: `All ${total} ${NOUNS} ${ZONE_PHRASE[z]} on cadence and DPS — opportunity to lift either.`, tone };
    }
    return { text: `All ${total} ${NOUNS} ${ZONE_PHRASE[z]}.`, tone };
  }

  // 2. Dominant + outliers (≥70 % in one zone)
  const dominant = uniqueZones.reduce((a, b) => counts[a] > counts[b] ? a : b);
  if (counts[dominant] >= total * 0.7) {
    const outlierLabels = [];
    const outlierIdxs = [];
    zones.forEach((z, i) => {
      if (z !== dominant) { outlierLabels.push(labelOf(laps[i])); outlierIdxs.push(i); }
    });
    if (outlierLabels.length === 1) {
      const cap = outlierLabels[0].charAt(0).toUpperCase() + outlierLabels[0].slice(1);
      return {
        text: `${cap} broke the pattern — the rest held ${ZONE_PHRASE[dominant]}.`,
        tone: ZONE_TONE[dominant],
        // idea 5 — the lone outlier IS the key moment.
        keyLap: laps[outlierIdxs[0]],
        keyNote: ZONE_LABEL[zones[outlierIdxs[0]]],
      };
    }
    return {
      text: `${counts[dominant]} of ${total} ${NOUNS} in ${ZONE_PHRASE[dominant]}.`,
      tone: ZONE_TONE[dominant],
    };
  }

  // 3. Front-half vs back-half split
  const half = Math.floor(total / 2);
  if (half >= 1) {
    const front = zones.slice(0, half);
    const back  = zones.slice(-half);
    const dominantOf = (arr) => {
      const c = arr.reduce((acc, z) => { acc[z] = (acc[z] || 0) + 1; return acc; }, {});
      return Object.keys(c).reduce((a, b) => c[a] > c[b] ? a : b);
    };
    const fz = dominantOf(front);
    const bz = dominantOf(back);
    if (fz !== bz) {
      const boundary = labelOf(laps[half - 1]);
      // idea 5 — the first back-half lap is where the new shape lands.
      const driftLap = laps[half];
      if (fz === 'HW' && (bz === 'SL' || bz === 'ST')) {
        return {
          text: `Held ${ZONE_PHRASE[fz]} through ${boundary} — then drifted to ${ZONE_PHRASE[bz]}.`,
          tone: ZONE_TONE[bz],
          keyLap: driftLap,
          keyNote: 'drift → ' + ZONE_LABEL[bz],
        };
      }
      if ((fz === 'SL' || fz === 'ST') && bz === 'HW') {
        return {
          text: `Built into ${ZONE_PHRASE[bz]} on the back half — strong finish.`,
          tone: ZONE_TONE[bz],
          keyLap: driftLap,
          keyNote: 'lift → ' + ZONE_LABEL[bz],
        };
      }
      return {
        text: `${ZONE_PHRASE[fz][0].toUpperCase()}${ZONE_PHRASE[fz].slice(1)} on the front half, ${ZONE_PHRASE[bz]} on the back.`,
        tone: ZONE_TONE[bz],
        keyLap: driftLap,
        keyNote: '→ ' + ZONE_LABEL[bz],
      };
    }
  }

  // 4. Scattered across all four
  if (uniqueZones.length === 4) {
    return { text: `Stroke shape varied across all four zones — inconsistent rhythm.`, tone: 'var(--tx-md)' };
  }
  return {
    text: `Stroke shape varied across ${uniqueZones.length} zones.`,
    tone: 'var(--tx-md)',
  };
};

const SrDpsEfficiencyChart = ({ primary, compare, mode }) => {
  // v00.95 — sprint detection. For 50 m races, per-lap data
  // produces only 1-2 dots — too few for the chart to render
  // anything meaningful. Step down to 5 m segment granularity:
  // each 5 m segment becomes one dot, ~10 dots for a 50 free.
  // Velocity = 5 / segment time; DPS derived from SR × velocity.
  // (distance / style / course resolution moved below alongside
  // the v00.92 PB lookup so we don't double-declare distP.)
  const sprintDist = primary?.distance_m
    || primary?.mj?.Distance || primary?.metrics_json?.Distance;
  const isSprint = Number(sprintDist) > 0 && Number(sprintDist) <= 50;

  const sourceFn = isSprint
    ? (t) => derivePerSegment(t, 5)
    : derivePerLap;

  const lapsRawA = sourceFn(primary).filter(l => l.rate != null && l.dps != null);
  const lapsRawB = compare ? sourceFn(compare).filter(l => l.rate != null && l.dps != null) : [];
  // v03.16/17 — per-lap / per-50m / per-100m bucketing.
  // aggregateLaps with 25 is always a no-op (per-lap = raw laps);
  // 50 merges SC pairs / no-ops LCM; 100 buckets to 100 m.
  // Sprints (5 m segments) are never lap-aggregated.
  const _bM = mode === 'per-100m' ? 100 : mode === 'per-lap' ? 25 : 50;
  const lapsA = (isSprint ? lapsRawA : aggregateLaps(lapsRawA, _bM))
    .filter(l => l.rate != null && l.dps != null);
  const lapsB = (isSprint ? lapsRawB : aggregateLaps(lapsRawB, _bM))
    .filter(l => l.rate != null && l.dps != null);
  const dotUnit = isSprint ? 'segment' : 'lap';

  // v00.92 — show-more toggle for iso-velocity curve density.
  const [showMoreCurves, setShowMoreCurves] = useRacesState(false);
  // v03.64 — Event PB + Squad Best markers removed. The chart now
  // shows only the swimmer's lap dots, iso-curves, and zones —
  // cleaner read of THIS race's mechanics without the comparison
  // benchmarks competing for visual attention.
  // v00.93 — click-to-inspect: which lap dot is selected for
  // the detail panel below the chart. { side: 'A'|'B', lap }
  const [selectedLap, setSelectedLap] = useRacesState(null);
  // v00.93 — hover-on-zone: when set, the chart highlights
  // that quadrant by brightening its tint.
  const [hoveredZone, setHoveredZone] = useRacesState(null);
  // v03.14 — detailed-map toggle. Distance races (15+ laps) plot
  // metronomic laps that stack on the same coordinate. By default
  // the scatter shows only KEY laps (start / fastest / slowest /
  // transition / last); the toggle reveals every lap with shrunk
  // dots. The per-lap zone strip below always shows all laps.
  const [detailedMap, setDetailedMap] = useRacesState(false);

  // v00.93 — clear selection when the chart's underlying data
  // changes so the panel doesn't keep showing a lap that isn't
  // in the current view.
  useRacesEffect(() => { setSelectedLap(null); },
    [primary?.athlete_uuid, primary?.source_date, primary?.race_time_s,
     compare?.athlete_uuid, compare?.source_date, compare?.race_time_s,
     mode]);

  // Pull event metadata via the same fallback chain raceTitle uses
  // (some trials carry the event in metrics_json rather than top-level columns).
  const mjP = primary?.mj || primary?.metrics_json || {};
  const distP   = primary?.distance_m || mjP.Distance || mjP.distance;
  const styleP  = primary?.style      || mjP.Style    || mjP.style;
  const courseP = primary?.course     || mjP.Course   || mjP.course;
  const mjC = compare?.mj || compare?.metrics_json || {};
  const distC   = compare?.distance_m || mjC.Distance || mjC.distance;
  const styleC  = compare?.style      || mjC.Style    || mjC.style;
  const courseC = compare?.course     || mjC.Course   || mjC.course;

  // v03.64 — Removed: PB + Squad Best lookup useEffect (mirrors
  // mobile v02.23). The chart now focuses on the mechanics of
  // THIS race without comparison overlays. Git history at v03.63
  // has the prior implementation if it needs to come back later.

  // v00.99 — sprints accept 1 dot (trial-average fallback when
  // Templo didn't capture intermediate splits). Distance races
  // still need ≥ 2 laps for the chart to mean anything.
  const minDots = isSprint ? 1 : 2;
  if (lapsA.length < minDots) {
    return <ChartFrame empty={isSprint
      ? 'Need at least one segment or trial-average data.'
      : 'Need at least 2 laps with stroke rate + DPS data.'}/>;
  }

  const allLaps = lapsB.length ? [...lapsA, ...lapsB] : lapsA;
  const median = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const medSR  = median(allLaps.map(l => l.rate));
  const medDPS = median(allLaps.map(l => l.dps));

  // Domain — include the lap data plus any PB markers so the
  // markers stay visible. PB averages can land outside the
  // current race's lap range if the swimmer's PB had different
  // stroke shape.
  const allSR_data  = allLaps.map(l => l.rate);
  const allDPS_data = allLaps.map(l => l.dps);
  // v03.64 — PB / squad-best contributions removed.
  const srMin  = Math.min(...allSR_data);
  const srMax  = Math.max(...allSR_data);
  const dpsMin = Math.min(...allDPS_data);
  const dpsMax = Math.max(...allDPS_data);
  const srPad  = (srMax - srMin) * 0.10 || 1;
  const dpsPad = (dpsMax - dpsMin) * 0.10 || 0.1;
  const xMin = srMin - srPad, xMax = srMax + srPad;
  const yMin = dpsMin - dpsPad, yMax = dpsMax + dpsPad;

  // v00.92 — iso-velocity curves. Each curve is a hyperbola
  // SR × DPS = velocity × 60 (since velocity = SR × DPS / 60).
  // Default 3 curves bracketing the data; "show more" expands
  // to 5. Round to one decimal for clean labels.
  const allVels = allLaps.map(l => l.rate * l.dps / 60);
  // v03.64 — PB / squad velocities removed from the iso-curve range.
  const vMin = Math.min(...allVels);
  const vMax = Math.max(...allVels);
  const round1 = (v) => Math.round(v * 10) / 10;
  const isoCount = showMoreCurves ? 5 : 3;
  const isoVelocities = (() => {
    if (!isFinite(vMin) || !isFinite(vMax) || vMax <= vMin) return [];
    const arr = [];
    for (let i = 0; i < isoCount; i++) {
      const v = vMin + (vMax - vMin) * i / (isoCount - 1);
      arr.push(round1(v));
    }
    // Dedupe + sort ascending
    return Array.from(new Set(arr)).sort((a, b) => a - b);
  })();

  const W = 480, H = 320, PAD_L = 50, PAD_R = 18, PAD_T = 32, PAD_B = 40;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf = (sr)  => PAD_L + ((sr  - xMin) / (xMax - xMin || 1)) * innerW;
  const yOf = (dps) => PAD_T + (1 - (dps - yMin) / (yMax - yMin || 1)) * innerH;
  const xMid = xOf(medSR);
  const yMid = yOf(medDPS);

  const quadrants = [
    // Top-right — HOLDING WATER (gold)
    { code: 'HW', label: 'HOLDING WATER', sub: 'fast + efficient', color: 'var(--lime-eff)',
      x: xMid, y: PAD_T, w: PAD_L + innerW - xMid, h: yMid - PAD_T, anchor: 'tr' },
    // Top-left — GLIDING
    { code: 'GL', label: 'GLIDING', sub: 'efficient · low cadence', color: 'var(--signal-eff)',
      x: PAD_L, y: PAD_T, w: xMid - PAD_L, h: yMid - PAD_T, anchor: 'tl' },
    // Bottom-right — SLIPPING
    { code: 'SL', label: 'SLIPPING', sub: 'high cadence · short pull', color: 'var(--flag-eff)',
      x: xMid, y: yMid, w: PAD_L + innerW - xMid, h: PAD_T + innerH - yMid, anchor: 'br' },
    // Bottom-left — STRUGGLING
    { code: 'ST', label: 'STRUGGLING', sub: 'low on both', color: 'var(--tx-lo)',
      x: PAD_L, y: yMid, w: xMid - PAD_L, h: PAD_T + innerH - yMid, anchor: 'bl' },
  ];

  // v00.93 — story headline. Generated from primary's lap
  // sequence + the median boundary. One sentence, color-coded
  // by the dominant zone tone. v00.95 passes isSprint so the
  // sentence uses "segment" / distance markers instead of "lap N".
  const story = buildEfficiencyStory(lapsA, medSR, medDPS, { isSprint });

  // v01.01 — when there's only one dot to show (typically the
  // sprint trial-average fallback from v00.99), the quadrant
  // boundaries collapse to the dot itself, so "shape"
  // classification is meaningless. Suppress the quadrant tints,
  // crosshairs, and 2×2 zone legend in that case so the chart
  // doesn't pretend to classify a stroke shape it can't see.
  // Iso-curves, PB/squad references, and the dot itself stay.
  const showShapeLayer = lapsA.length >= 2;

  // Per-lap zone classifier (used by both the inspect panel
  // and the story builder).
  const zoneOfLap = (l) => {
    const hi = l.rate >= medSR;
    const high = l.dps >= medDPS;
    if (hi && high) return 'HW';
    if (!hi && high) return 'GL';
    if (hi && !high) return 'SL';
    return 'ST';
  };

  // Per-lap connecting line — straight segments (no smoothing
  // since each dot is a discrete lap, not a sample of a
  // continuous signal).
  // v03.14 — line drops above 12 plotted dots (zigzag becomes
  // noise). Key-laps mode plots ~5 dots so the line still shows
  // the trajectory; detailed mode on a distance race drops it.
  const lineThreshold = 12;
  const pathOf = (laps) => laps.length >= 2 && laps.length <= lineThreshold
    ? laps.map((l, i) =>
        (i === 0 ? 'M' : 'L') + xOf(l.rate).toFixed(1) + ',' + yOf(l.dps).toFixed(1)
      ).join(' ')
    : '';

  // v03.14 — key-lap selection + adaptive dot sizing. Distance
  // races stack metronomic laps on the same coordinate, so by
  // default the scatter plots only the KEY laps (first / last /
  // fastest / slowest / story transition). The `detailedMap`
  // toggle flips to every-lap with shrunk dots. The per-lap zone
  // strip below always carries the full lap-by-lap detail.
  const manyLaps    = lapsA.length > 8;
  const showAllLaps = !manyLaps || detailedMap;
  const keyLapsA = (() => {
    if (showAllLaps || !lapsA.length) return lapsA;
    const velOf = (l) => (l.rate * l.dps) / 60;
    const byVel = [...lapsA].sort((a, b) => velOf(b) - velOf(a));
    const picks = new Set([
      lapsA[0].lap,
      lapsA[lapsA.length - 1].lap,
      byVel[0].lap,
      byVel[byVel.length - 1].lap,
    ]);
    if (story && story.keyLap) picks.add(story.keyLap.lap);
    return lapsA.filter(l => picks.has(l.lap));
  })();
  const plottedA = showAllLaps ? lapsA : keyLapsA;

  const totalDots = plottedA.length + lapsB.length;
  const dense     = totalDots > 12;
  const veryDense = totalDots > 22;
  const dotR_A    = veryDense ? 6  : dense ? 8  : 12;
  const dotR_B    = veryDense ? 6  : dense ? 7  : 10;
  const fontA     = veryDense ? 7  : dense ? 8  : 11;
  const fontB     = veryDense ? 6  : dense ? 7  : 10;

  return (
    <div>
      {/* v00.93 — Dynamic story headline above the chart. Reads
          the lap-by-lap pattern and surfaces it in one sentence
          before the coach has to interpret the chart. */}
      {story && (
        <div className="display" style={{
          fontSize: 18, lineHeight: 1.35, letterSpacing: '-0.015em',
          color: 'var(--tx-hi)', marginBottom: 14, maxWidth: 780,
        }}>
          <span style={{ color: story.tone }}>{story.text}</span>
        </div>
      )}
      {/* v03.14 — key-laps / detailed toggle. Only shown for
          distance races (>8 laps), where plotting every lap
          stacks metronomic dots on the same coordinate. */}
      {manyLaps && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setDetailedMap(v => !v)}
            style={{
              font: '600 10px var(--font-mono)', letterSpacing: 0.04,
              padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              background: detailedMap ? 'var(--ink)' : 'transparent',
              color: detailedMap ? 'var(--paper)' : 'var(--tx-md)',
              border: '1px solid ' + (detailedMap ? 'var(--ink)' : 'var(--line-soft)'),
            }}>
            {detailedMap
              ? 'KEY LAPS'
              : 'DETAILED MAP · ALL ' + lapsA.length + ' LAPS'}
          </button>
        </div>
      )}
      <window.ChartScroll minWidth={W}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 400 }}>
        {/* Quadrant tints (lowest layer). v00.93: opacity reacts
            to hoveredZone — the hovered quadrant brightens, the
            others dim, so the coach sees the spatial relationship
            between a legend tile and its quadrant in the chart.
            v01.01: skipped entirely when the chart has fewer than
            2 dots (shape layer doesn't apply). */}
        {showShapeLayer && quadrants.map(q => {
          const opacity = hoveredZone == null ? 0.07
            : hoveredZone === q.code ? 0.22
            : 0.03;
          return (
            <rect key={'tint' + q.label}
              x={q.x} y={q.y} width={q.w} height={q.h}
              fill={q.color} opacity={opacity}
              style={{ transition: 'opacity 0.15s' }}/>
          );
        })}
        {/* v00.92 — Iso-velocity curves (hyperbolas). Each curve
            represents all (SR, DPS) combos producing the same
            velocity. Drawn under the crosshairs + dots so they
            sit as background reference. Inline label at the
            curve's right edge with the velocity value. */}
        {isoVelocities.map((v, idx) => {
          const constant = v * 60; // SR × DPS = constant
          // Build path by sampling SR across the visible range.
          // Clip to [yMin, yMax] so we don't draw off-chart.
          const samples = 40;
          const segs = [];
          let path = '';
          for (let i = 0; i <= samples; i++) {
            const sr = xMin + (xMax - xMin) * i / samples;
            const dps = constant / sr;
            if (dps < yMin || dps > yMax) {
              // Out of range — flush current segment, start fresh next
              if (segs.length >= 2) {
                path += segs.map((p, k) =>
                  (k === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)
                ).join(' ') + ' ';
              }
              segs.length = 0;
              continue;
            }
            segs.push([xOf(sr), yOf(dps)]);
          }
          if (segs.length >= 2) {
            path += segs.map((p, k) =>
              (k === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)
            ).join(' ');
          }
          // Label position — try the rightmost on-curve point
          // that fits inside the chart with margin for the text.
          let labelPt = null;
          for (let i = samples; i >= 0; i--) {
            const sr = xMin + (xMax - xMin) * i / samples;
            const dps = constant / sr;
            if (dps >= yMin && dps <= yMax) {
              const cx = xOf(sr), cy = yOf(dps);
              if (cx <= PAD_L + innerW - 30 && cy >= PAD_T + 8) {
                labelPt = { cx, cy }; break;
              }
            }
          }
          return (
            <g key={'iso' + idx}>
              <path d={path} fill="none"
                stroke="var(--tx-md)" strokeWidth="1"
                strokeDasharray="2 5" opacity="0.35"/>
              {labelPt && (
                <g>
                  <rect x={labelPt.cx - 1} y={labelPt.cy - 9}
                    width={32} height={12} rx="2"
                    fill="var(--bg-2)" opacity="0.85"/>
                  <text x={labelPt.cx + 3} y={labelPt.cy + 1}
                    fontSize="9" fontFamily="var(--font-mono)" fontWeight="600"
                    fill="var(--tx-md)" textAnchor="start">
                    {v.toFixed(1)} m/s
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {/* v03.64 — Reference iso-curves for PB + squad removed. */}
        {/* Median crosshairs — v01.01: skipped when there's
            only 1 dot (median collapses to the dot itself,
            crosshair through a single point conveys nothing). */}
        {showShapeLayer && (
          <>
            <line x1={xMid} x2={xMid} y1={PAD_T} y2={PAD_T + innerH}
                  stroke="var(--line)" strokeDasharray="3 4" strokeWidth="1" opacity="0.55"/>
            <line x1={PAD_L} x2={PAD_L + innerW} y1={yMid} y2={yMid}
                  stroke="var(--line)" strokeDasharray="3 4" strokeWidth="1" opacity="0.55"/>
          </>
        )}
        {/* Axis labels */}
        <text x={PAD_L + innerW / 2} y={H - 10}
          fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-lo)"
          letterSpacing="0.04em" textAnchor="middle">
          STROKE RATE (spm)
        </text>
        <text x={14} y={PAD_T + innerH / 2}
          fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-lo)"
          letterSpacing="0.04em" textAnchor="middle"
          transform={`rotate(-90 14 ${PAD_T + innerH / 2})`}>
          DPS (m)
        </text>
        {/* Axis tick values — min, median, max */}
        {[xMin, medSR, xMax].map((v, i) => (
          <text key={'xt' + i} x={xOf(v)} y={H - PAD_B + 14}
            fontSize="9" fontFamily="var(--font-mono)" fill="var(--tx-lo)"
            textAnchor="middle">
            {v.toFixed(1)}
          </text>
        ))}
        {[yMin, medDPS, yMax].map((v, i) => (
          <text key={'yt' + i} x={PAD_L - 6} y={yOf(v) + 3}
            fontSize="9" fontFamily="var(--font-mono)" fill="var(--tx-lo)"
            textAnchor="end">
            {v.toFixed(2)}
          </text>
        ))}
        {/* Compare path + dots first so primary draws on top */}
        {lapsB.length > 0 && (
          <>
            {pathOf(lapsB) && (
              <path d={pathOf(lapsB)} fill="none"
                    stroke="var(--compare-eff)" strokeWidth="1.5"
                    strokeDasharray="3 4" opacity="0.55"/>
            )}
            {lapsB.map(l => {
              const isSelected = selectedLap?.side === 'B' && selectedLap?.lap === l.lap;
              return (
                <g key={'B' + l.lap}
                  onClick={() => setSelectedLap({ side: 'B', lap: l.lap, data: l })}
                  style={{ cursor: 'pointer' }}>
                  <circle cx={xOf(l.rate)} cy={yOf(l.dps)} r={dotR_B + (isSelected ? 3 : 0)}
                          fill="var(--compare-eff)" opacity="0.92"
                          stroke={isSelected ? 'var(--tx-hi)' : 'none'}
                          strokeWidth={isSelected ? 2 : 0}/>
                  <text x={xOf(l.rate)} y={yOf(l.dps) + (fontB / 2 - 1)}
                    fontSize={fontB} fontFamily="var(--font-mono)" fontWeight="700"
                    fill="var(--ink)" textAnchor="middle"
                    style={{ pointerEvents: 'none' }}>
                    {l.lap}
                  </text>
                </g>
              );
            })}
          </>
        )}
        {/* Primary path */}
        {pathOf(plottedA) && (
          <path d={pathOf(plottedA)} fill="none"
                stroke="var(--lime-eff)" strokeWidth="1.5"
                strokeDasharray="2 3" opacity="0.65"/>
        )}
        {plottedA.map(l => {
          const isSelected = selectedLap?.side === 'A' && selectedLap?.lap === l.lap;
          // v03.14 — green fill (primary convention) + a
          // zone-colored ring so the dot's stroke shape reads
          // without cross-referencing its quadrant position.
          const zRing = ZONE_TONE[zoneOfLap(l)];
          return (
            <g key={'A' + l.lap}
              onClick={() => setSelectedLap({ side: 'A', lap: l.lap, data: l })}
              style={{ cursor: 'pointer' }}>
              <circle cx={xOf(l.rate)} cy={yOf(l.dps)} r={dotR_A + (isSelected ? 3 : 0)}
                      fill="var(--lime-eff)"
                      stroke={isSelected ? 'var(--tx-hi)' : zRing}
                      strokeWidth={isSelected ? 3 : 2.5}/>
              <text x={xOf(l.rate)} y={yOf(l.dps) + (fontA / 2 - 1)}
                fontSize={fontA} fontFamily="var(--font-mono)" fontWeight="700"
                fill="var(--ink)" textAnchor="middle"
                style={{ pointerEvents: 'none' }}>
                {l.lap}
              </text>
            </g>
          );
        })}
        {/* v03.14 — PB + Squad diamond markers removed. They
            marked a single historical (SR, DPS) point, which read
            as confusing clutter rather than relevant context.
            The PB / Squad iso-velocity reference curves remain. */}
        {/* v03.13 (idea 5) — on-chart callout pointing at the key
            lap the story builder flagged. A leader line + chip so
            the chart points at its own story. */}
        {story && story.keyLap && story.keyLap.rate != null && story.keyLap.dps != null && (() => {
          const kl = story.keyLap;
          const cx = xOf(kl.rate), cy = yOf(kl.dps);
          const note = story.keyNote || '';
          const noteW = note.length * 5.4 + 14;
          let lx = cx + 16;
          let ly = cy - 26;
          if (lx + noteW > PAD_L + innerW) lx = cx - 16 - noteW;
          if (lx < PAD_L) lx = PAD_L;
          if (ly < PAD_T + 4) ly = cy + 14;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={cx} y1={cy} x2={lx + noteW / 2} y2={ly + 8}
                stroke="var(--tx-md)" strokeWidth="1" opacity="0.55"/>
              <rect x={lx} y={ly} width={noteW} height={16} rx="3"
                fill="var(--bg-2)" stroke="var(--line)" strokeWidth="0.75"/>
              <text x={lx + noteW / 2} y={ly + 11}
                fontSize="9" fontFamily="var(--font-mono)" fontWeight="700"
                fill="var(--tx-hi)" textAnchor="middle">
                {note}
              </text>
            </g>
          );
        })()}
      </svg>
      </window.ChartScroll>
      {/* v03.13 (idea 4) — per-lap zone strip. One cell per lap,
          colored by stroke-shape zone — reads the shape/fatigue
          story at a glance, no chart-decoding needed. */}
      {showShapeLayer && lapsA.length >= 2 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
            STROKE SHAPE BY {isSprint ? 'SEGMENT' : 'LAP'}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {lapsA.map(l => {
              const z = zoneOfLap(l);
              return (
                <div key={'zs' + l.lap} title={ZONE_LABEL[z]}
                  style={{
                    flex: 1, minWidth: 0, height: 30, borderRadius: 5,
                    background: 'color-mix(in oklch, ' + ZONE_TONE[z] + ' 78%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    font: '700 11px var(--font-mono)', color: 'var(--ink)',
                  }}>
                  {l.lap}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {['HW', 'GL', 'SL', 'ST'].map(z => (
              <span key={'zl' + z} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                font: '500 10px var(--font-ui)', color: 'var(--tx-md)',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 3,
                  background: 'color-mix(in oklch, ' + ZONE_TONE[z] + ' 78%, transparent)',
                }}/>
                {ZONE_LABEL[z]}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* v00.93 — Inspect panel renders when a lap dot is
          clicked. Shows that lap's exact metrics + zone label
          + an inline note. Click again on the same dot or hit
          the X to dismiss. */}
      {selectedLap && (() => {
        const l = selectedLap.data;
        const zoneCode = zoneOfLap(l);
        const zoneInfo = quadrants.find(q => q.code === zoneCode);
        const lapVel = (l.rate * l.dps / 60);
        const sideName = selectedLap.side === 'A'
          ? 'Primary'
          : 'Compare';
        const sideColor = selectedLap.side === 'A'
          ? 'var(--lime-eff)'
          : 'var(--compare-eff)';
        // v03.64 — lapPb callout removed alongside PB markers.
        return (
          <div className="card" style={{
            marginTop: 10, padding: 14,
            display: 'flex', alignItems: 'flex-start', gap: 14,
            border: '1px solid ' + sideColor,
            background: 'color-mix(in oklch, ' + sideColor + ' 6%, transparent)',
          }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
              }}>
                <span className="mono" style={{
                  font: '700 11px var(--font-mono)', color: sideColor,
                  letterSpacing: 0.06,
                }}>
                  {sideName} · {isSprint
                    ? (l.segLabel || (l.endD + ' m mark'))
                    : ('LAP ' + l.lap)}
                </span>
                <span style={{
                  padding: '2px 7px', borderRadius: 999,
                  background: 'color-mix(in oklch, ' + zoneInfo.color + ' 18%, transparent)',
                  color: zoneInfo.color,
                  font: '700 10px var(--font-mono)', letterSpacing: 0.06,
                }}>
                  {zoneInfo.label}
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 12, marginTop: 4,
              }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>STROKE RATE</div>
                  <div className="mono" style={{ font: '700 16px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 2 }}>
                    {l.rate.toFixed(1)}<span style={{ fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>spm</span>
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>DPS</div>
                  <div className="mono" style={{ font: '700 16px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 2 }}>
                    {l.dps.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>m</span>
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>VELOCITY</div>
                  <div className="mono" style={{ font: '700 16px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 2 }}>
                    {lapVel.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>m/s</span>
                  </div>
                </div>
                {l.t != null && (
                  <div>
                    <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>
                      {isSprint ? 'SEGMENT TIME' : 'LAP TIME'}
                    </div>
                    <div className="mono" style={{ font: '700 16px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 2 }}>
                      {l.t.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>s</span>
                    </div>
                  </div>
                )}
              </div>
              {/* v03.64 — PB-pace comparison line removed. */}
            </div>
            <button onClick={() => setSelectedLap(null)} style={{
              background: 'transparent', border: 'none', color: 'var(--tx-lo)',
              cursor: 'pointer', font: '600 14px var(--font-ui)', padding: 0,
              flexShrink: 0,
            }}>✕</button>
          </div>
        );
      })()}

      {/* v00.90 — Zone legend lives OUTSIDE the chart now. v00.93
          adds hover handlers — hover a tile and the matching
          quadrant tint brightens in the chart, giving an
          immediate spatial connection between description and
          chart region. v01.01: hidden when shape layer is off
          (single-dot case where shape can't be classified). */}
      {showShapeLayer && (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6, marginTop: 10,
      }}>
        {[
          quadrants[1], // top-left  → GLIDING
          quadrants[0], // top-right → HOLDING WATER
          quadrants[3], // bottom-left  → STRUGGLING
          quadrants[2], // bottom-right → SLIPPING
        ].map(q => {
          const isHovered = hoveredZone === q.code;
          return (
            <div key={'zl' + q.label}
              onMouseEnter={() => setHoveredZone(q.code)}
              onMouseLeave={() => setHoveredZone(null)}
              style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'color-mix(in oklch, ' + q.color + ' ' + (isHovered ? 22 : 10) + '%, transparent)',
                borderLeft: '3px solid ' + q.color,
                display: 'flex', flexDirection: 'column', gap: 2,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}>
              <span style={{
                font: '700 10px var(--font-mono)', color: q.color,
                letterSpacing: 0.06,
              }}>{q.label}</span>
              <span style={{
                font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
              }}>{q.sub}</span>
            </div>
          );
        })}
      </div>
      )}
      {/* Legend — v00.89 includes a numbered-dot key so it's
          obvious the digits inside the dots are lap numbers.
          v00.92 adds a PB-diamond key + "show more curves"
          toggle when iso-velocity reference lines are visible. */}
      <div style={{
        display: 'flex', gap: 16, alignItems: 'center', marginTop: 8,
        font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
        flexWrap: 'wrap',
      }}>
        {/* Numbered-dot key */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block' }}>
            <circle cx="9" cy="9" r="8" fill="var(--lime-eff)"/>
            <text x="9" y="12" fontSize="9"
              fontFamily="var(--font-mono)" fontWeight="700"
              fill="var(--ink)" textAnchor="middle">1</text>
          </svg>
          <span style={{ color: 'var(--tx-md)' }}>= {dotUnit} number</span>
        </span>
        {/* v03.64 — PB diamond + squad-best legend keys removed. */}
        {/* Trial colors */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--lime-eff)', display: 'inline-block',
          }}/>
          Primary{lapsA.length > lineThreshold ? ' (line hidden · long race · try Per 100 m)' : ''}
        </span>
        {lapsB.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'var(--compare-eff)', display: 'inline-block',
            }}/>
            Compare
          </span>
        )}
        {/* Show more curves toggle */}
        {isoVelocities.length > 0 && (
          <button
            onClick={() => setShowMoreCurves(!showMoreCurves)}
            style={{
              padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', color: 'var(--tx-md)',
              border: '1px solid var(--line-soft)',
              font: '600 10px var(--font-mono)', letterSpacing: 0.04,
            }}>
            {showMoreCurves ? 'FEWER CURVES' : 'MORE CURVES'}
          </button>
        )}
      </div>
      <div style={{
        marginTop: 4, font: '500 10px var(--font-mono)',
        color: 'var(--tx-lo)', textAlign: 'right',
      }}>
        Quadrants split at median SR {medSR.toFixed(1)} · DPS {medDPS.toFixed(2)}
        {' · '}Iso-curves = m/s reference
      </div>
    </div>
  );
};

// v00.71 — `mode` and `onChangeMode` are now props lifted to
// RaceDetail so the same toggle drives PaceProfile, DPSChart,
// RaceCompareBars, and StrokeMechanicsTable in unison. The
// toggle UI itself is now AggModeToggle so it can also render
// in the StrokeMechanics card header (v00.73).
const PaceProfile = ({ primary, compare, mode, onChangeMode, modeOptions, showToggle }) => {
  const compareLabel =
    compare?._benchmarkKind === 'PB' ? 'Personal best'
    : compare?._benchmarkKind === 'MEDIAN' ? 'Median race'
    : compare ? (window.PA_KPIS.raceTitle(compare) || 'Compare')
    : null;

  return (
    <ChartCard
      title="SPLIT-BY-SPLIT STORY"
      right={showToggle ? <AggModeToggle mode={mode} onChangeMode={onChangeMode} options={modeOptions}/> : null}>
      <LapBars
        primary={primary}
        compare={compare}
        compareLabel={compareLabel}
        mode={mode}/>
    </ChartCard>
  );
};

// ── WhereThisRanks (v00.68) ───────────────────────────────────
//
// Wires the previously-empty "WHERE THIS RANKS" placeholder to
// real Supabase data. For the primary trial's event (distance +
// style + course):
//
//   1. Query v_race_kpis filtered by event (RLS gates the rows
//      the signed-in user can see — this IS the visible pool).
//   2. Aggregate best race_time_s per athlete.
//   3. Resolve names via the athletes table (also RLS-gated).
//      For uuids RLS hides, fall back to "Athlete" placeholder.
//   4. Sort ascending and surface the viewer's rank + top 5.
//
// v00.68 changed the data flow from v_competition_athletes →
// v_race_kpis to v_race_kpis → athletes. The previous flow was
// the intersection of two RLS-evaluated views, which goes empty
// the moment one side is empty for a given auth context (e.g.
// super admin who isn't on any competition team gets empty
// v_competition_athletes regardless of how much race data they
// can actually see). The new flow uses v_race_kpis directly so
// the leaderboard reflects whatever races RLS lets the viewer
// see, with names hydrated as a separate (also RLS-gated) step.

const WhereThisRanks = ({ primary }) => {
  const [state, setState] = useRacesState({
    loading: true, rows: [], rank: null,
  });

  // v00.69: pull event metadata via the same fallback chain
  // PA_KPIS.raceTitle() uses. v_race_trials rows can carry the
  // canonical event in `metrics_json` rather than the top-level
  // columns — primary.distance_m and primary.style come back null
  // for those rows even though the race IS a 200 free etc., which
  // made the v00.68 picker silently miss the event.
  const mj = primary?.mj || primary?.metrics_json || {};
  const distRaw = primary?.distance_m || mj.Distance || mj.distance;
  const dist  = distRaw != null ? Number(distRaw) : null;
  const styleRaw = primary?.style || mj.Style || mj.style;
  const style = styleRaw ? String(styleRaw).toLowerCase() : null;
  const courseRaw = primary?.course || mj.Course || mj.course;
  const course = courseRaw ? String(courseRaw).toUpperCase() : null;
  const myUuid = primary?.athlete_uuid;
  const eventLabel =
    (dist ? dist + ' ' : '')
    + (style ? style.charAt(0).toUpperCase() + style.slice(1) : '')
    + (course ? ' · ' + course : '');

  useRacesEffect(() => {
    if (!dist || !style) {
      setState({ loading: false, rows: [], rank: null });
      return;
    }
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));
    (async () => {
      try {
        // 1. Race rows for this event the viewer's RLS allows.
        // distance is server-filtered with .eq() — it's a number,
        // no casing concerns. style and course are filtered
        // client-side with case-insensitive comparison so we
        // don't depend on whether the DB stores "Freestyle" or
        // "freestyle" (the v_race_trials primary often comes via
        // metrics_json with "Style" capitalized).
        const { data: races, error: raceErr } = await window.supabaseClient
          .from('v_race_kpis')
          .select('athlete_uuid, race_time_s, distance_m, style, course')
          .eq('distance_m', dist)
          .not('race_time_s', 'is', null);
        if (cancelled) return;
        if (raceErr || !races || !races.length) {
          setState({ loading: false, rows: [], rank: null });
          return;
        }

        let filtered = races.filter(r =>
          String(r.style || '').toLowerCase() === style
        );
        if (course) {
          filtered = filtered.filter(r =>
            String(r.course || '').toUpperCase() === course
          );
        }
        if (!filtered.length) {
          setState({ loading: false, rows: [], rank: null });
          return;
        }

        // 2. Aggregate best per athlete.
        const best = {};
        filtered.forEach(r => {
          const v = parseFloat(r.race_time_s);
          if (isNaN(v)) return;
          if (best[r.athlete_uuid] == null || v < best[r.athlete_uuid]) {
            best[r.athlete_uuid] = v;
          }
        });

        const uuids = Object.keys(best);
        if (!uuids.length) {
          setState({ loading: false, rows: [], rank: null });
          return;
        }

        // 3. Resolve names. athletes table is RLS-gated — uuids
        // we aren't allowed to see come back as no row, and
        // those leaderboard rows fall back to "Athlete".
        const nameByUuid = {};
        const teamByUuid = {};
        try {
          const { data: people } = await window.supabaseClient
            .from('athletes')
            .select('athlete_uuid, first_name, last_name')
            .in('athlete_uuid', uuids);
          (people || []).forEach(p => {
            const f = (p.first_name || '').trim();
            const l = (p.last_name  || '').trim();
            nameByUuid[p.athlete_uuid] = (f + ' ' + l).trim() || '—';
          });
        } catch (_) { /* names stay placeholder */ }

        // Best-effort team lookup via v_competition_athletes if
        // it returns anything for these uuids. Strictly cosmetic;
        // an empty result here is fine — the leaderboard renders
        // without team sublines.
        try {
          const { data: pool } = await window.supabaseClient
            .from('v_competition_athletes')
            .select('athlete_uuid, team_name')
            .in('athlete_uuid', uuids);
          (pool || []).forEach(p => {
            if (p.team_name) teamByUuid[p.athlete_uuid] = p.team_name;
          });
        } catch (_) { /* teams stay empty */ }

        const sorted = uuids
          .map(uuid => ({
            uuid,
            value: best[uuid],
            name:  nameByUuid[uuid] || 'Athlete',
            team:  teamByUuid[uuid] || '',
          }))
          .sort((a, b) => a.value - b.value);

        const myIdx = sorted.findIndex(r => r.uuid === myUuid);
        setState({
          loading: false,
          rows: sorted,
          rank: myIdx >= 0 ? myIdx + 1 : null,
        });
      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, rows: [], rank: null });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [dist, style, course, myUuid]);

  const total = state.rows.length;
  // Display set: top 5, OR top 4 + ellipsis + viewer when viewer
  // is outside top 5. Avoids ballooning the card on huge pools.
  const visible = (() => {
    if (!total) return [];
    if (state.rank == null || state.rank <= 5) return state.rows.slice(0, 5);
    return state.rows.slice(0, 4)
      .concat([{ _gap: true }])
      .concat([state.rows[state.rank - 1]]);
  })();
  const leaderTime = state.rows[0]?.value;

  const titleRight = state.rank != null
    ? <span className="mono" style={{
        fontSize: 11, fontWeight: 700,
        color: state.rank === 1 ? 'var(--lime-eff)' : 'var(--tx-hi)',
        padding: '3px 8px', borderRadius: 999,
        background: state.rank === 1
          ? 'color-mix(in oklch, var(--lime-eff) 18%, transparent)'
          : 'var(--bg-3)',
        letterSpacing: 0.04,
      }}>
        #{state.rank} of {total}
      </span>
    : (total
        ? <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
            {total} on board
          </span>
        : null);

  const fmtRow = (v) =>
    (window.PA_KPIS && window.PA_KPIS.fmtTime)
      ? window.PA_KPIS.fmtTime(v, 2)
      : v.toFixed(2) + ' s';

  return (
    <ChartCard
      title={`WHERE THIS RANKS${eventLabel ? ' · ' + eventLabel.toUpperCase() : ''}`}
      right={titleRight}>
      {state.loading ? (
        <div style={{
          font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
          padding: '18px 0', textAlign: 'center',
        }}>Loading leaderboard…</div>
      ) : !total ? (
        <div style={{
          font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
          padding: '18px 0', textAlign: 'center',
        }}>
          Not enough leaderboard data for this event yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {visible.map((row, i) => {
            if (row._gap) {
              return (
                <div key={'gap-' + i} style={{
                  textAlign: 'center', font: '500 11px var(--font-mono)',
                  color: 'var(--tx-lo)', padding: '4px 0',
                }}>···</div>
              );
            }
            // Find true position for label (handles ellipsis case).
            const truePos = state.rows.findIndex(r => r.uuid === row.uuid) + 1;
            const isMe = myUuid && row.uuid === myUuid;
            const delta = leaderTime != null && row.value > leaderTime
              ? '+' + (row.value - leaderTime).toFixed(2)
              : null;
            return (
              <div key={row.uuid} style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr auto auto',
                alignItems: 'center', gap: 12,
                padding: '8px 10px', borderRadius: 8,
                background: isMe
                  ? 'color-mix(in oklch, var(--signal-eff) 12%, transparent)'
                  : 'transparent',
                border: '1px solid ' + (isMe
                  ? 'color-mix(in oklch, var(--signal-eff) 38%, transparent)'
                  : 'transparent'),
              }}>
                <span className="mono" style={{
                  font: '700 12px var(--font-mono)',
                  color: truePos === 1 ? 'var(--lime-eff)'
                       : isMe          ? 'var(--signal-eff)'
                       : 'var(--tx-lo)',
                  letterSpacing: 0.04,
                }}>
                  #{truePos}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    font: (isMe ? '600' : '500') + ' 13px var(--font-ui)',
                    color: 'var(--tx-hi)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {row.name}{isMe ? ' · YOU' : ''}
                  </div>
                  {row.team && (
                    <div style={{
                      font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
                      marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {row.team}
                    </div>
                  )}
                </div>
                <span className="mono" style={{
                  font: '700 14px var(--font-mono)', color: 'var(--tx-hi)',
                  letterSpacing: '-0.01em',
                }}>
                  {fmtRow(row.value)}
                </span>
                <span className="mono" style={{
                  font: '500 11px var(--font-mono)',
                  color: delta ? 'var(--tx-lo)' : 'transparent',
                  minWidth: 42, textAlign: 'right',
                }}>
                  {delta || '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
};

// ── RaceDetail — design-reference composition ─────────────────
// Free-standing Headline (hero, NOT a card) above everything, then
// a split-by-split story card, then a 2-col row (stroke mechanics
// table | vs-compare double bars), then a ranking card placeholder.
const RaceDetail = ({ primary, compare, diff, summary, isPro, onUpgrade }) => {
  const story = window.buildRaceStory(primary, compare, diff);
  const compareLabel = compare?._benchmarkKind === 'PB' ? 'VS. PERSONAL BEST'
    : compare?._benchmarkKind === 'MEDIAN' ? 'VS. MEDIAN RACE'
    : compare ? ('VS. ' + (window.PA_KPIS.raceTitle(compare) || 'COMPARE').toUpperCase())
    : 'VS. COMPARE';

  // v00.71 — single source of truth for per-lap vs per-100m
  // aggregation. PaceProfile, DPSChart, and RaceCompareBars all
  // honor this mode so the user toggles once and every per-lap
  // chart on the page stays in sync. Reset on primary change
  // (a fresh trial deserves the auto default — picking a 100
  // free after a 1500 should drop back to per-lap).
  const [userMode, setUserMode] = useRacesState(null);
  const primaryKey = primary ? window.PA_KPIS.trialKey(primary) : null;
  useRacesEffect(() => { setUserMode(null); }, [primaryKey]);

  // Compute lap count to drive auto default + toggle visibility.
  const laps = primary ? derivePerLap(primary) : [];
  const numLaps = laps.length;
  const autoMode = numLaps > 16 ? 'per-100m' : 'per-50m';
  const mode = userMode || autoMode;
  // v03.16 — course-aware toggle visibility. Lap distance tells
  // the course: ~25 m → short course (SCM/SCY), ~50 m → long
  // course (LCM). Show the Per 50 / Per 100 toggle for SC races
  // above the 50, and LC races at the 200 and up.
  // v03.74 — LC threshold was `> 200`, which excluded the 200 LC
  // itself (4×50 m laps — per-50 vs per-100 is meaningful there).
  // Changed to `> 100` so 200/400/800/1500 LC show the toggle while
  // the 100 LC (2 laps, per-100 collapses to one bar) stays hidden.
  const lapDist  = laps.length ? (laps[0].endD - laps[0].startD) : 0;
  const raceDist = laps.length ? laps[laps.length - 1].endD : 0;
  const isShortCourse = lapDist > 0 && lapDist < 40;
  const showToggle = isShortCourse ? raceDist > 50 : raceDist > 100;
  // v03.17 — short course (25 m laps) offers Per lap / Per 50 m /
  // Per 100 m; long course (50 m laps) offers Per 50 m / Per 100 m.
  const modeOptions = isShortCourse ? MODE_OPTIONS_SC : MODE_OPTIONS_LC;
  // totalDelta = totalB - totalA. Positive → primary faster.
  // Chip prefix uses "−" when primary is faster (user-facing convention).
  const compareDelta = compare && diff?.totalDelta != null
    ? (diff.totalDelta > 0 ? '−' : diff.totalDelta < 0 ? '+' : '±')
      + Math.abs(diff.totalDelta).toFixed(2) + 's'
    : null;
  const compareDeltaTone = diff?.totalDelta == null ? 'var(--tx-lo)'
    : diff.totalDelta > 0 ? 'var(--lime-eff)'
    : diff.totalDelta < 0 ? 'var(--flag-eff)' : 'var(--tx-lo)';

  return (
    <>
      {/* v03.72 — inline rename control for this race trial */}
      {primary && window.TrialNameEditor && (
        <div style={{ marginBottom: 4 }}>
          <window.TrialNameEditor kind="race" trial={primary}
            title={window.PA_KPIS.raceTitle(primary)}/>
        </div>
      )}
      {/* Hero — free-standing, no card wrapper */}
      {story && (
        <Headline
          eyebrow={story.eyebrow}
          title={story.titleNode}
          sub={story.sub}
          right={story.rightChip}
        />
      )}

      {/* Summary KPI rail — 5 tiles in a single row, mirrors Starts
          summary rail. Race Time / Avg SR / Avg DPS / Avg Velocity /
          Total Strokes. HelpDot tips on each label clarify what each
          metric measures. */}
      <RaceSummaryRail primary={primary} compare={compare}/>

      {/* Pace profile — tabbed wrapper landing v00.46:
            • Splits          (existing LapBars)
            • Pace deviation  (option J — cumulative drift from race avg)
            • Best-lap ref    (option N — bars + theoretical-max line)
          Each tab is a different view on the same race. Adaptive
          density carries through — long races (60+ laps) auto-compact. */}
      <PaceProfile
        primary={primary}
        compare={compare}
        mode={mode}
        onChangeMode={setUserMode}
        modeOptions={modeOptions}
        showToggle={showToggle}/>

      {/* Mechanics · tabbed drilldown for stroke rate, DPS, velocity.
          v00.45 — replaces the v00.44 3-card grid with a single tab
          strip that swaps charts. Each tab calls out the correlation
          to the other two metrics so the user never loses sight of
          how SR / DPS / velocity relate (velocity = SR × DPS / 60).
          v00.71 — receives `mode` so DPSChart can group per-100m. */}
      <MechanicsSection primary={primary} compare={compare} mode={mode}/>

      {/* 2-col: stroke mechanics table | vs compare double bars */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}>
        <ChartCard
          title="STROKE MECHANICS"
          right={showToggle
            ? <AggModeToggle mode={mode} onChangeMode={setUserMode} options={modeOptions}/>
            : null}>
          <StrokeMechanicsTable primary={primary} compare={compare} mode={mode}/>
        </ChartCard>
        <ChartCard
          title={compareLabel}
          right={compareDelta
            ? <span className="mono" style={{
                fontSize: 11, fontWeight: 700, color: compareDeltaTone,
              }}>{compareDelta}</span>
            : null}>
          <RaceCompareBars primary={primary} compare={compare} mode={mode}/>
        </ChartCard>
      </div>

      {/* Where this ranks — wired in v00.67. Pulls competition pool
          via v_competition_athletes (RLS-gated to who the viewer is
          allowed to see), aggregates best-per-athlete on the same
          event (distance + style + course), surfaces the viewer's
          rank and the top 5. */}
      <WhereThisRanks primary={primary}/>

      {/* v01.18 — Race video with primary/compare switcher,
          Pro gate, and per-mode download. compareLabel comes from
          the benchmark kind when present (slot B holds a benchmark);
          otherwise defaults to "Compare" for normal slot-B trials. */}
      <VideoCard
        title={'RACE VIDEO · ' + (window.PA_KPIS.raceTitle(primary) || '').toUpperCase()}
        hint="from start to touch"
        videoKey={primary?.video_key}
        athleteUuid={primary?.athlete_uuid}
        compareVideoKey={compare?.video_key}
        compareAthleteUuid={compare?.athlete_uuid}
        compareIsBenchmark={compare?._benchmarkKind === 'WR'}
        compareLabel={
          compare?._benchmarkKind === 'PB'     ? 'Personal best' :
          compare?._benchmarkKind === 'MEDIAN' ? 'Median race'   :
          compare?._benchmarkKind === 'WR'     ? 'World record'  :
          'Compare'
        }
        /* v03.44 / v03.47 — Save-to-Library wiring. record_uuid is
           the universal trial identifier across v_race/start/turn —
           switched from race_uuid for consistency with the other
           tabs. Compare slot only carries trial info when it's a
           real trial (not a PB/Median/WR benchmark). */
        trialKind="race"
        primaryTrialUuid={primary?.record_uuid}
        primaryTeamUuid={primary?.team_uuid}
        primaryTrialDate={primary?.source_date}
        primaryTrialTitle={window.PA_KPIS.raceTitle(primary)}
        compareTrialUuid={compare && !compare._benchmarkKind ? compare.record_uuid : null}
        compareTeamUuid={compare?.team_uuid}
        compareTrialDate={compare?.source_date}
        compareTrialTitle={compare && !compare._benchmarkKind ? window.PA_KPIS.raceTitle(compare) : null}
        isPro={isPro}
        onUpgrade={onUpgrade}
      />
    </>
  );
};

window.WebRaces = WebRaces;
window.WebTeamRaces = WebTeamRaces;
// v00.81 — share the team-page primitives with web-starts.jsx
// and web-turns.jsx so WebTeamStarts / WebTeamTurns can reuse
// the same filter drawer + group infrastructure.
window.PA_TEAMUI = {
  AthleteCard,
  NewGroupModal,
  Combobox,
  PRESET_GROUPS,
  readCustomGroupsLegacy,
  TeamBrowsePage,
};

try { console.log('[web-races] loaded (v01.52)'); } catch (_) {}
