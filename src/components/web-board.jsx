/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Leaderboards (v00.58)

   Mirrors the live dashboard's competition-leaderboards pattern:
     1. Load athlete pool via v_competition_athletes (RLS-gated —
        only athletes the signed-in user is allowed to see end up
        in the result).
     2. Query each kpi view filtered by athlete_uuid IN (pool).
     3. Group by athlete, take min(metric) per athlete (best PB).
     4. Sort + take top 5.

   Three boards on this v1: Fastest Start, Fastest Turn, Best Race
   Time. Race PB is "any event" for now — future iteration adds
   per-event filters.

   When viewer is admin/coach (onPickAthlete prop is wired), a
   row click fires the impersonation hook so the user can drill
   into any leader's full trial set. For regular athletes who
   don't have that hook, rows are read-only.

   Read-only. No new RPCs / views.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useBoardState,
  useEffect: useBoardEffect,
  useMemo:   useBoardMemo,
} = React;

// ── Data loaders ─────────────────────────────────────────────

// v_competition_athletes returns a flat list of every athlete
// the user is allowed to view, with display fields for the row.
async function loadCompAthletes(genderFilter) {
  try {
    let q = window.supabaseClient
      .from('v_competition_athletes')
      .select('athlete_uuid, first_name, last_name, team_name, gender');
    if (genderFilter && genderFilter !== 'all') {
      q = q.eq('gender', genderFilter);
    }
    const { data, error } = await q;
    if (error) return { data: [], error };
    return { data: data || [], error: null };
  } catch (e) {
    return { data: [], error: e };
  }
}

// v01.43 — Team mode loader. Returns athletes scoped to the
// caller's own team (active members only — PA_ADMIN.loadAthletes
// already filters by membership_status='active' since v01.37).
// Gender filter applied client-side. The team_name field is
// stamped from the caller-provided value so the row shape
// matches loadCompAthletes for the rest of the board pipeline.
async function loadTeamAthletes(genderFilter, teamUuid, teamName) {
  if (!teamUuid) return { data: [], error: null };
  try {
    const { data, error } = await window.PA_ADMIN.loadAthletes(teamUuid);
    if (error) return { data: [], error };
    let rows = data || [];
    if (genderFilter && genderFilter !== 'all') {
      rows = rows.filter(a =>
        String(a.gender || '').toLowerCase() === genderFilter
      );
    }
    return {
      data: rows.map(a => ({
        athlete_uuid: a.athlete_uuid,
        first_name:   a.first_name,
        last_name:    a.last_name,
        team_name:    teamName || null,
        gender:       a.gender || null,
      })),
      error: null,
    };
  } catch (e) {
    return { data: [], error: e };
  }
}

// v01.45 — view selector by mode. Competition mode reads from
// the v_competition_*_kpis views which JOIN competition_entries
// and filter by enrolled=true. So per-event toggles ACTUALLY
// affect what shows on each board (athletes who toggle off a
// specific event drop off that board only). Team mode reads
// the regular kpi views — no opt-in concept inside a team.
function viewForMode(mode, modality) {
  // modality: 'start' | 'turn' | 'race'
  if (mode === 'competition') {
    if (modality === 'start') return 'v_competition_start_kpis';
    if (modality === 'turn')  return 'v_competition_turn_kpis';
    if (modality === 'race')  return 'v_competition_race_kpis';
  }
  if (modality === 'start') return 'v_start_kpis';
  if (modality === 'turn')  return 'v_turn_kpis';
  if (modality === 'race')  return 'v_race_kpis';
  return null;
}

// Generic "best per athlete" loader. Pulls all rows for the given
// view + metric column, groups client-side, returns top N by
// metric ascending.
//
// v01.47 — accepts `sinceDate` (ISO yyyy-mm-dd) to time-window
// the leaderboards. null = no filter (All time).
async function loadBestPerAthlete({ view, metric, athleteUuids, n = 5, sinceDate }) {
  if (!athleteUuids || !athleteUuids.length) return [];
  try {
    let q = window.supabaseClient
      .from(view)
      .select('athlete_uuid, ' + metric + ', source_date')
      .in('athlete_uuid', athleteUuids)
      .not(metric, 'is', null);
    if (sinceDate) q = q.gte('source_date', sinceDate);
    const { data, error } = await q;
    if (error) return [];
    const best = {};
    (data || []).forEach(r => {
      const v = parseFloat(r[metric]);
      if (isNaN(v)) return;
      if (!best[r.athlete_uuid] || v < best[r.athlete_uuid]) {
        best[r.athlete_uuid] = v;
      }
    });
    return Object.entries(best)
      .map(([uuid, value]) => ({ uuid, value }))
      .sort((a, b) => a.value - b.value)
      .slice(0, n);
  } catch (e) {
    return [];
  }
}

// ── Race-event-aware loaders (v00.59) ───────────────────────
// The Race PB card needs per-event filtering — "Best Race Time ·
// any event" is misleading since longer races have longer times
// and a 50 free always tops the board. We pull all race rows
// once with metadata, then filter + aggregate client-side as the
// user picks an event from the dropdown.

// Pull all race rows for the athlete pool with the metadata
// needed to (a) filter by event and (b) derive an event picker.
async function loadAllRaceRows(athleteUuids, view, sinceDate) {
  // v01.45 — accept view name so Competition mode can use
  // v_competition_race_kpis (which respects per-event opt-in
  // for the best_race_pb key) instead of the unfiltered
  // v_race_kpis. Defaults to v_race_kpis to preserve previous
  // call-site behavior.
  // v01.47 — sinceDate filter for the time-period selector.
  if (!athleteUuids || !athleteUuids.length) return [];
  const viewName = view || 'v_race_kpis';
  try {
    let q = window.supabaseClient
      .from(viewName)
      .select('athlete_uuid, race_time_s, distance_m, style, course, source_date')
      .in('athlete_uuid', athleteUuids)
      .not('race_time_s', 'is', null);
    if (sinceDate) q = q.gte('source_date', sinceDate);
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}

// Distinct event tuples derived from a row set. Each option:
//   { key, distance_m, style, course, label, count }
// `key` is a stable string for React keys + dropdown values.
// `count` is the number of rows in that event — used to size
// the dropdown options ("100 Freestyle · LCM (12)") so the user
// can pick the events with enough data to be interesting.
function deriveRaceEvents(rows) {
  const buckets = new Map();
  rows.forEach(r => {
    const dist  = r.distance_m ? Number(r.distance_m) : null;
    const style = r.style ? String(r.style).toLowerCase() : null;
    const course = r.course ? String(r.course).toUpperCase() : null;
    if (!dist || !style) return; // event must have at least dist + style
    const key = dist + '|' + style + '|' + (course || '');
    if (!buckets.has(key)) {
      buckets.set(key, {
        key, distance_m: dist, style, course,
        label: dist + ' ' + style.charAt(0).toUpperCase() + style.slice(1)
             + (course ? ' · ' + course : ''),
        count: 0,
      });
    }
    buckets.get(key).count += 1;
  });
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m;
    return a.label.localeCompare(b.label);
  });
}

// Client-side aggregator. Given race rows + optional event
// filter, returns top N athletes by best (lowest) race_time_s.
function aggregateBestRaces(rows, eventFilter, n) {
  const limit = (n != null) ? n : 5;
  const filtered = (() => {
    if (!eventFilter || !eventFilter.key) return rows;
    return rows.filter(r =>
      Number(r.distance_m) === eventFilter.distance_m &&
      String(r.style || '').toLowerCase() === eventFilter.style &&
      (eventFilter.course
        ? String(r.course || '').toUpperCase() === eventFilter.course
        : true)
    );
  })();
  const best = {};
  filtered.forEach(r => {
    const v = parseFloat(r.race_time_s);
    if (isNaN(v)) return;
    if (!best[r.athlete_uuid] || v < best[r.athlete_uuid]) {
      best[r.athlete_uuid] = v;
    }
  });
  return Object.entries(best)
    .map(([uuid, value]) => ({ uuid, value }))
    .sort((a, b) => a.value - b.value)
    .slice(0, limit);
}

// ── Medal & podium atoms (v01.47) ────────────────────────────
//
// Locked decisions Q6=A and Q7=A: gold/silver/bronze medals on
// top 3, with top 3 styled as a podium and ranks 4+ as a flat
// list below.
//
// Color choices use cultural medal hues rather than Ink & Signal
// tokens because gold/silver/bronze read as universal symbols.
const MEDAL_COLOR = {
  1: '#f5c518', // gold
  2: '#c0c8cf', // silver
  3: '#cd7f32', // bronze
};

const MedalBadge = ({ rank, size = 22 }) => {
  const color = MEDAL_COLOR[rank] || 'var(--tx-lo)';
  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      background: 'color-mix(in oklch, ' + color + ' 22%, transparent)',
      border: '2px solid ' + color,
      color: color,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      font: '700 ' + Math.round(size * 0.55) + 'px var(--font-mono)',
      flexShrink: 0,
      lineHeight: 1,
    }}>
      {rank}
    </div>
  );
};

// Single podium cell — used for ranks 1, 2, 3. Variant-driven
// styling: gold gets bigger avatar + lifted bg; silver / bronze
// share a simpler treatment.
const PodiumCell = ({ rank, athlete, value, fmtValue, onClick, isClickable }) => {
  const name = window.PA_ADMIN
    ? window.PA_ADMIN.athleteName(athlete || {})
    : ((athlete?.first_name || '') + ' ' + (athlete?.last_name || '')).trim();
  const team = (athlete?.team_name || '').trim();
  const isWinner = rank === 1;
  const color = MEDAL_COLOR[rank] || 'var(--signal-eff)';
  return (
    <div
      onClick={isClickable ? onClick : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 8,
        padding: isWinner ? '14px 10px 12px' : '10px 8px 8px',
        borderRadius: 12,
        background: isWinner
          ? 'color-mix(in oklch, ' + color + ' 14%, transparent)'
          : 'color-mix(in oklch, ' + color + ' 8%, transparent)',
        border: '1px solid color-mix(in oklch, ' + color + ' 35%, transparent)',
        cursor: isClickable ? 'pointer' : 'default',
        minWidth: 0,
        // #1 gets a slightly elevated transform so the podium reads
        // hierarchically without us having to measure cell heights.
        transform: isWinner ? 'translateY(-4px)' : 'none',
        transition: 'transform 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          e.currentTarget.style.background =
            'color-mix(in oklch, ' + color + ' 22%, transparent)';
        }
      }}
      onMouseLeave={(e) => {
        if (isClickable) {
          e.currentTarget.style.background = isWinner
            ? 'color-mix(in oklch, ' + color + ' 14%, transparent)'
            : 'color-mix(in oklch, ' + color + ' 8%, transparent)';
        }
      }}>
      <MedalBadge rank={rank} size={isWinner ? 28 : 22}/>
      <div style={{
        font: '600 ' + (isWinner ? '13px' : '12px') + ' var(--font-ui)',
        color: 'var(--tx-hi)',
        textAlign: 'center',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}>
        {name || '—'}
      </div>
      {team && (
        <div style={{
          font: '500 10px var(--font-ui)', color: 'var(--tx-lo)',
          textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: '100%',
          marginTop: -4,
        }}>
          {team}
        </div>
      )}
      <div className="mono" style={{
        font: '700 ' + (isWinner ? '16px' : '14px') + ' var(--font-mono)',
        color: isWinner ? color : 'var(--tx-hi)',
        textAlign: 'center',
      }}>
        {fmtValue(value)}
      </div>
    </div>
  );
};

// ── Leaderboard card ─────────────────────────────────────────

const BoardCard = ({ title, sub, headerRight, rows, athleteIndex, fmtValue, onPickAthlete }) => {
  const t = (window.useT || (() => (k) => k))();
  const isClickable = !!onPickAthlete;
  // v01.47 — split top 3 (podium) vs ranks 4+ (flat list).
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  // Reorder podium cells: visually we want #2 left, #1 center,
  // #3 right (classic podium). Data is sorted [#1, #2, #3].
  const podiumOrder = (() => {
    if (top3.length === 0) return [];
    if (top3.length === 1) return [{ rank: 1, row: top3[0] }];
    if (top3.length === 2) return [
      { rank: 2, row: top3[1] },
      { rank: 1, row: top3[0] },
    ];
    return [
      { rank: 2, row: top3[1] },
      { rank: 1, row: top3[0] },
      { rank: 3, row: top3[2] },
    ];
  })();

  return (
    <div className="card" style={{
      padding: 18, borderRadius: 14,
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      display: 'flex', flexDirection: 'column', gap: 14,
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{title}</div>
          {sub && (
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 4,
            }}>
              {sub}
            </div>
          )}
        </div>
        {/* v00.59: optional picker / control slot — Race card uses
            this to host the per-event dropdown. */}
        {headerRight}
      </div>
      {rows.length === 0 ? (
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
          padding: '16px 0', textAlign: 'center',
        }}>
          {t('board.podiumEmpty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Podium row — top 3 in a 3-column grid (or fewer when
              rows.length < 3). #1 is centered + lifted, #2 left,
              #3 right. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(' + Math.max(podiumOrder.length, 1) + ', 1fr)',
            gap: 8,
            alignItems: 'end',
            padding: '4px 0 8px',
          }}>
            {podiumOrder.map(({ rank, row }) => {
              const athlete = athleteIndex[row.uuid] || {};
              const name = window.PA_ADMIN
                ? window.PA_ADMIN.athleteName(athlete)
                : '';
              return (
                <PodiumCell
                  key={row.uuid}
                  rank={rank}
                  athlete={athlete}
                  value={row.value}
                  fmtValue={fmtValue}
                  isClickable={isClickable}
                  onClick={() => onPickAthlete?.({ uuid: row.uuid, name })}
                />
              );
            })}
          </div>

          {/* Ranks 4+ — flat row list, slimmer than the original
              full-list rows. Renders only when there are rows
              beyond the podium. */}
          {rest.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              borderTop: '1px solid var(--line-soft)',
              paddingTop: 8,
            }}>
              {rest.map((r, i) => {
                const rank = i + 4;
                const athlete = athleteIndex[r.uuid] || {};
                const name = window.PA_ADMIN
                  ? window.PA_ADMIN.athleteName(athlete)
                  : ((athlete.first_name || '') + ' ' + (athlete.last_name || '')).trim();
                const team = (athlete.team_name || '').trim();
                return (
                  <div
                    key={r.uuid}
                    onClick={isClickable
                      ? () => onPickAthlete({ uuid: r.uuid, name })
                      : undefined}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      alignItems: 'center', gap: 10,
                      padding: '8px 6px',
                      borderRadius: 6,
                      cursor: isClickable ? 'pointer' : 'default',
                    }}
                    onMouseEnter={(e) => {
                      if (isClickable) e.currentTarget.style.background =
                        'color-mix(in oklch, var(--signal-eff) 6%, transparent)';
                    }}
                    onMouseLeave={(e) => {
                      if (isClickable) e.currentTarget.style.background = 'transparent';
                    }}>
                    <div className="mono" style={{
                      font: '600 12px var(--font-mono)',
                      color: 'var(--tx-lo)',
                      textAlign: 'center',
                    }}>
                      {rank}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {name || '(unknown)'}
                      </div>
                      {team && (
                        <div style={{
                          font: '500 10px var(--font-ui)', color: 'var(--tx-lo)',
                          marginTop: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {team}
                        </div>
                      )}
                    </div>
                    <div className="mono" style={{
                      font: '600 13px var(--font-mono)',
                      color: 'var(--tx-md)',
                      textAlign: 'right',
                    }}>
                      {fmtValue(r.value)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── OptInPanel (v01.45 — Batch 8b; simplified v01.46) ────────
//
// Athlete-only panel rendered inside Competition mode. Three
// branches:
//   1. Free user (not Pro): Pro-upsell strip — no toggle. Click
//      fires onUpgrade (defers to Account modal subscription tab).
//   2. Pro, opted out: master toggle off.
//   3. Pro, opted in: master toggle on.
//
// v01.46 — per-event toggles removed. Athletes either compete in
// every event or none — simpler mental model, fewer decisions.
// First opt-in still bulk-enrolls all 4 competition_entries rows
// (the v_competition_*_kpis views need enrolled=true to show the
// athlete on each board) — that write is now invisible plumbing.
//
// Coaches never see this — they're filtered at the WebBoard level.
//
// Mirrors live's `toggleCompetitionOptIn` (index.html:18883)
// using the PA_COMP wrappers.
//
// Props:
//   athleteUuid    - the athlete's UUID (for write target)
//   authUserId     - auth.uid() (also persisted in the row for
//                    RLS clarity; live does the same)
//   isPro          - boolean from App's PA_REQUESTS.isPro
//   onUpgrade      - opens the Account modal subscription tab
//   onChanged      - fired after a successful write so WebBoard
//                    can refresh the boards (the v_competition_*
//                    pool is server-cached at view-eval time and
//                    needs a re-query)
const OptInPanel = ({ athleteUuid, authUserId, isPro, onUpgrade, onChanged }) => {
  const t = (window.useT || (() => (k) => k))();
  const [optedIn, setOptedIn] = useBoardState(false);
  const [entries, setEntries] = useBoardState({});
  const [loading, setLoading] = useBoardState(true);
  const [busy,    setBusy]    = useBoardState(false);

  // Initial load + refetch on athleteUuid change.
  useBoardEffect(() => {
    let cancelled = false;
    if (!athleteUuid || !window.PA_COMP) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    (async () => {
      const [optRes, entRes] = await Promise.all([
        window.PA_COMP.getOptInStatus(athleteUuid),
        window.PA_COMP.listEntries(athleteUuid),
      ]);
      if (cancelled) return;
      setOptedIn(!!optRes.optedIn);
      setEntries(entRes.entries || {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [athleteUuid]);

  // ── Pro-upsell branch ────────────────────────────────────
  if (!isPro) {
    return (
      <div className="card" style={{
        padding: 14, display: 'flex', alignItems: 'center', gap: 12,
        background: 'color-mix(in oklch, var(--signal-eff) 8%, transparent)',
        border: '1px solid color-mix(in oklch, var(--signal-eff) 30%, transparent)',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="var(--signal-eff)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="6"/>
          <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
        </svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            font: '700 13px var(--font-display)', color: 'var(--tx-hi)',
            letterSpacing: '-0.01em',
          }}>
            {t('board.compOptin.proStripTitle')}
          </div>
          <div style={{
            font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
            marginTop: 2, lineHeight: 1.4,
          }}>
            {t('board.compOptin.proStripBody')}
          </div>
        </div>
        <button type="button"
          onClick={() => onUpgrade?.()}
          style={{
            padding: '8px 14px', borderRadius: 10,
            border: 'none', background: 'var(--signal-eff)',
            color: 'var(--ink)',
            font: '700 12px var(--font-ui)', letterSpacing: 0.02,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
          {t('board.compOptin.proStripCta')}
        </button>
      </div>
    );
  }

  // Pro user — actual opt-in surface.
  if (loading) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
          {t('board.compOptin.panelTitle')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('board.compOptin.loading')}
        </div>
      </div>
    );
  }

  // ── Master toggle handler ───────────────────────────────
  const onToggleMaster = async () => {
    if (busy) return;
    const next = !optedIn;
    setBusy(true);
    const { ok } = await window.PA_COMP.setOptInStatus(athleteUuid, authUserId, next);
    if (!ok) {
      setBusy(false);
      try { window.PA_TOAST?.show(t('board.compOptin.toastError'), { type: 'error' }); } catch (_) {}
      return;
    }
    // First-time opt-in: auto-enroll in all 4 keys (live's pattern).
    if (next && Object.keys(entries).length === 0) {
      const bulk = await window.PA_COMP.bulkEnrollAll(athleteUuid, authUserId);
      if (bulk.ok) {
        const all = {};
        window.PA_COMP.COMP_KEYS.forEach(k => { all[k] = true; });
        setEntries(all);
      }
    }
    setOptedIn(next);
    setBusy(false);
    try {
      window.PA_TOAST?.show(
        t(next ? 'board.compOptin.toastOptedIn' : 'board.compOptin.toastOptedOut'),
        { type: next ? 'success' : 'info' }
      );
    } catch (_) {}
    onChanged?.();
  };

  // ── Toggle button atom ──────────────────────────────────
  const ToggleSwitch = ({ on, onClick, disabled }) => (
    <button type="button" onClick={onClick} disabled={disabled}
      role="switch" aria-checked={!!on}
      style={{
        all: 'unset',
        display: 'inline-flex', alignItems: 'center',
        width: 36, height: 20, padding: 2,
        borderRadius: 999,
        background: on ? 'var(--lime-eff)' : 'var(--bg-3)',
        border: '1px solid ' + (on ? 'var(--lime-eff)' : 'var(--line)'),
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 0.15s',
        flexShrink: 0,
      }}>
      <span style={{
        width: 14, height: 14, borderRadius: '50%',
        background: on ? 'var(--ink)' : 'var(--tx-lo)',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform 0.15s',
      }}/>
    </button>
  );

  return (
    <div className="card" style={{ padding: 14 }}>
      {/* Master toggle row — single source of truth.
          v01.46: per-event grid removed; athletes opt in/out
          for all events at once. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 4 }}>
            {t('board.compOptin.panelTitle')}
          </div>
          <div style={{
            font: '700 14px var(--font-display)', color: 'var(--tx-hi)',
            letterSpacing: '-0.01em',
          }}>
            {optedIn ? t('board.compOptin.toggleOn') : t('board.compOptin.toggleOff')}
          </div>
          <div style={{
            font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
            marginTop: 4, lineHeight: 1.45, maxWidth: 540,
          }}>
            {optedIn ? t('board.compOptin.toggleOnSub') : t('board.compOptin.toggleOffSub')}
          </div>
        </div>
        <ToggleSwitch on={optedIn} onClick={onToggleMaster} disabled={busy}/>
      </div>
    </div>
  );
};

// ── WebBoard ─────────────────────────────────────────────────

const WebBoard = ({ session, authUserId, onPickAthlete, role, profile, isPro, onUpgrade }) => {
  const t = (window.useT || (() => (k) => k))();
  const teamUuid = profile?.team_uuid || null;
  const teamName = (profile?.team_name || '').trim() || null;
  const isCoach  = role === 'coach';
  // v01.44 — also check membership_status. After v01.36, removed
  // members keep team_uuid set (can't be nulled due to the RLS
  // WITH-CHECK on athletes_update_coach), so a row with
  // status='inactive' still has a stale team_uuid pointing at
  // their old team. Gate Team mode on active membership only —
  // ex-members default to Competition with the Team tab disabled.
  // Pending users similarly aren't team-data eligible yet.
  const isActiveMember = (profile?.membership_status || 'active') === 'active';
  const hasTeam  = !!teamUuid && isActiveMember;

  // v01.43 — mode tabs: 'team' | 'competition'.
  // Default per locked decision:
  //   - Coaches → Team (their squad first)
  //   - Athletes → Competition (cross-team is the differentiating
  //     value of this surface)
  // Athletes / coaches without a team can't use Team mode, so the
  // default flips to Competition for them regardless of role.
  const initialMode = (() => {
    if (!hasTeam) return 'competition';
    return isCoach ? 'team' : 'competition';
  })();
  const [mode,     setMode]     = useBoardState(initialMode);

  const [gender,   setGender]   = useBoardState('all');
  // v01.47 — time-period filter. Locked Q5=B: 30d / All time only.
  // Default: 'all' (All time) so an athlete's lifetime PB is the
  // primary frame; 30d is the recent-form alternative. Future
  // polish: coach-defined seasons (team_seasons table).
  const [period,   setPeriod]   = useBoardState('all');
  const [athletes, setAthletes] = useBoardState([]);
  const [loading,  setLoading]  = useBoardState(true);
  const [error,    setError]    = useBoardState(null);

  // Start / Reaction / Turn boards stay simple (one query each,
  // top-5). v01.45 — added bestReactions for the Best Reaction
  // board (open-to-all-ages event meant to onboard new users).
  const [bestStarts,    setBestStarts]    = useBoardState([]);
  const [bestReactions, setBestReactions] = useBoardState([]);
  const [bestTurns,     setBestTurns]     = useBoardState([]);

  // Race board is event-aware (v00.59). We pull all race rows once
  // with metadata and filter client-side as the user picks an event.
  // raceEvent = null → "All events"; else the picked event tuple.
  const [raceRows,   setRaceRows]   = useBoardState([]);
  const [raceEvent,  setRaceEvent]  = useBoardState(null);

  // v01.45 — refetch token bumped by OptInPanel after a successful
  // opt-in / per-event UPSERT. The boards re-query because the
  // v_competition_*_kpis pool changes when an athlete enrolls or
  // toggles a key off.
  const [boardRefetch, setBoardRefetch] = useBoardState(0);

  // Reload everything when mode or gender filter changes. Race
  // event selection resets to "all" so the picker doesn't carry
  // across pool changes.
  useBoardEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setRaceEvent(null);
      // v01.43 — mode-aware athlete pool loader.
      const result = mode === 'team'
        ? await loadTeamAthletes(gender, teamUuid, teamName)
        : await loadCompAthletes(gender);
      const pool = result.data;
      const poolErr = result.error;
      if (cancelled) return;
      if (poolErr) {
        setError(poolErr.message || 'Could not load athletes');
        setLoading(false);
        return;
      }
      setAthletes(pool);
      const uuids = pool.map(a => a.athlete_uuid);
      // v01.45 — view selection is mode-aware. Competition mode
      // uses v_competition_*_kpis (per-event-toggle filtered);
      // Team mode uses regular kpi views.
      const startView = viewForMode(mode, 'start');
      const turnView  = viewForMode(mode, 'turn');
      const raceView  = viewForMode(mode, 'race');
      // v01.47 — compute sinceDate from period selector. 30d
      // window is rolling — last 30 days from today.
      const sinceDate = period === '30d'
        ? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
        : null;
      const [starts, reactions, turns, races] = await Promise.all([
        loadBestPerAthlete({
          view: startView, metric: 'split_15m_s',
          athleteUuids: uuids, n: 5, sinceDate,
        }),
        loadBestPerAthlete({
          view: startView, metric: 'reaction_time_s',
          athleteUuids: uuids, n: 5, sinceDate,
        }),
        loadBestPerAthlete({
          view: turnView, metric: 'time_15in_15out_s',
          athleteUuids: uuids, n: 5, sinceDate,
        }),
        loadAllRaceRows(uuids, raceView, sinceDate),
      ]);
      if (cancelled) return;
      setBestStarts(starts);
      setBestReactions(reactions);
      setBestTurns(turns);
      setRaceRows(races);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gender, mode, teamUuid, period, boardRefetch]);

  // Derive event picker options + filtered top-5 from raceRows.
  // useMemo keeps these stable across renders that don't change
  // raceRows / raceEvent.
  const raceEvents = useBoardMemo(
    () => deriveRaceEvents(raceRows),
    [raceRows]
  );
  const bestRaces = useBoardMemo(
    () => aggregateBestRaces(raceRows, raceEvent, 5),
    [raceRows, raceEvent]
  );

  // Index athletes by UUID for fast row lookups.
  const athleteIndex = useBoardMemo(() => {
    const idx = {};
    athletes.forEach(a => { idx[a.athlete_uuid] = a; });
    return idx;
  }, [athletes]);

  // Format helpers — defer to PA_KPIS.fmtTime for time formatting.
  // Race time uses minute format for >= 60 s; start / turn metrics
  // are typically < 60 s but still go through fmtTime so a 1500 +
  // race time renders correctly.
  const fmtTime = (v) => window.PA_KPIS && window.PA_KPIS.fmtTime
    ? window.PA_KPIS.fmtTime(v, 2)
    : (v != null ? v.toFixed(2) + ' s' : '—');

  // v01.47 — Period filter pill (30d / All time). Same visual as
  // GenderPill but tracks the period state. Locked Q5=B; future
  // polish to add coach-defined seasons via team_seasons table.
  const PeriodPill = ({ value, label }) => {
    const active = period === value;
    return (
      <button
        onClick={() => setPeriod(value)}
        style={{
          padding: '6px 12px', borderRadius: 999,
          border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line)'),
          background: active
            ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)'
            : 'var(--bg-2)',
          color: active ? 'var(--signal-eff)' : 'var(--tx-md)',
          font: '600 12px var(--font-ui)',
          cursor: active ? 'default' : 'pointer',
          textTransform: 'uppercase', letterSpacing: 0.04,
        }}>
        {label}
      </button>
    );
  };

  // Gender filter pill
  const GenderPill = ({ value, label }) => {
    const active = gender === value;
    return (
      <button
        onClick={() => setGender(value)}
        style={{
          padding: '6px 12px', borderRadius: 999,
          border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line)'),
          background: active
            ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)'
            : 'var(--bg-2)',
          color: active ? 'var(--signal-eff)' : 'var(--tx-md)',
          font: '600 12px var(--font-ui)',
          cursor: active ? 'default' : 'pointer',
          textTransform: 'uppercase', letterSpacing: 0.04,
        }}>
        {label}
      </button>
    );
  };

  // v01.43 — Mode tab. Used for the Team / Competition switch
  // at the top of the board. Renders as a flat segmented-control
  // tab (different visual than gender pills so the two affordances
  // read as distinct).
  const ModeTab = ({ value, label, disabled }) => {
    const active = mode === value;
    return (
      <button
        onClick={() => !disabled && setMode(value)}
        disabled={disabled}
        style={{
          padding: '8px 18px',
          borderRadius: 0,
          border: 'none',
          borderBottom: '2px solid ' + (active ? 'var(--signal-eff)' : 'transparent'),
          background: 'transparent',
          color: active ? 'var(--tx-hi)' : (disabled ? 'var(--tx-lo)' : 'var(--tx-md)'),
          font: '600 13px var(--font-ui)',
          cursor: disabled ? 'not-allowed' : (active ? 'default' : 'pointer'),
          letterSpacing: 0.02,
          opacity: disabled ? 0.45 : 1,
          marginBottom: -1, // overlap the rail border
        }}>
        {label}
      </button>
    );
  };

  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--flag-eff)', font: '500 13px var(--font-ui)' }}>
        {error}
      </div>
    );
  }

  // v01.43 — translated subtitle. Adapts copy per mode:
  //   Team mode:        "across N on {team}"
  //   Competition mode: "across N"
  // Falls back to "across N" when team_name is unknown.
  const athleteWord = athletes.length === 1
    ? t('board.athleteSingular')
    : t('board.athletePlural');
  const subtitle = (() => {
    if (loading) return null;
    if (mode === 'team' && teamName) {
      return t('board.acrossTeamN', {
        n: athletes.length + ' ' + athleteWord,
        team: teamName,
      });
    }
    return t('board.acrossCompN', { n: athletes.length + ' ' + athleteWord });
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('board.title')}
        </div>
        <div className="display" style={{
          fontSize: 26, color: 'var(--tx-hi)', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>
          {t('board.heading')}
          {subtitle && (
            <span style={{ color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 8 }}>
              · {subtitle}
            </span>
          )}
        </div>

        {/* v01.43 — Mode tabs (Team / Competition). When the user
            has no team, the Team tab is disabled with a subtle
            hint. Coaches without a team won't usually hit this
            page (CoachDeck routes them to the join CTA), but
            athletes without a team can still use Competition. */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 4,
          marginTop: 14,
          borderBottom: '1px solid var(--line-soft)',
        }}>
          <ModeTab value="team" label={t('board.modeTeam')} disabled={!hasTeam}/>
          <ModeTab value="competition" label={t('board.modeCompetition')}/>
        </div>
        {!hasTeam && mode === 'competition' && (
          <div style={{
            font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
            marginTop: 6,
          }}>
            {t('board.noTeamHint')}
          </div>
        )}

        {/* Filter pills row — gender + time period (v01.47) */}
        <div style={{
          display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <GenderPill value="all"    label={t('board.genderAll')}/>
          <GenderPill value="female" label={t('board.genderFemale')}/>
          <GenderPill value="male"   label={t('board.genderMale')}/>
          <span style={{
            width: 1, height: 20,
            background: 'var(--line-soft)',
            margin: '0 4px',
          }} aria-hidden="true"/>
          <PeriodPill value="all" label={t('board.periodAll')}/>
          <PeriodPill value="30d" label={t('board.period30d')}/>
        </div>
      </div>

      {/* v01.45 — Competition opt-in panel. Athletes only; coaches
          see nothing here. The panel internally branches on
          isPro: free → upsell strip, Pro → toggle + per-event
          grid. onChanged bumps the board refetch token so the
          v_competition_* views re-query after a write. */}
      {mode === 'competition' && role === 'athlete' && profile?.athlete_uuid && (
        <OptInPanel
          athleteUuid={profile.athlete_uuid}
          authUserId={authUserId}
          isPro={!!isPro}
          onUpgrade={onUpgrade}
          onChanged={() => setBoardRefetch(n => n + 1)}/>
      )}

      {/* Three-card grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 14,
      }}>
        <BoardCard
          title={t('board.cardFastestStart')}
          sub={t('board.cardFastestStartSub')}
          rows={bestStarts}
          athleteIndex={athleteIndex}
          fmtValue={fmtTime}
          onPickAthlete={onPickAthlete}
        />
        {/* v01.45 — Best Reaction board. Open-to-all-ages event
            meant to lower the barrier to entry on Competition.
            Reaction time uses 3-decimal formatting (vs 2 for
            other start metrics). */}
        <BoardCard
          title={t('board.cardBestReaction')}
          sub={t('board.cardBestReactionSub')}
          rows={bestReactions}
          athleteIndex={athleteIndex}
          fmtValue={(v) => v != null ? v.toFixed(3) + ' s' : '—'}
          onPickAthlete={onPickAthlete}
        />
        <BoardCard
          title={t('board.cardFastestTurn')}
          sub={t('board.cardFastestTurnSub')}
          rows={bestTurns}
          athleteIndex={athleteIndex}
          fmtValue={fmtTime}
          onPickAthlete={onPickAthlete}
        />
        <BoardCard
          title={t('board.cardBestRace')}
          sub={raceEvent ? raceEvent.label : t('board.cardBestRaceSubAll')}
          headerRight={raceEvents.length > 0 ? (
            <select
              value={raceEvent ? raceEvent.key : ''}
              onChange={(e) => {
                const key = e.target.value;
                if (!key) { setRaceEvent(null); return; }
                const evt = raceEvents.find(ev => ev.key === key);
                setRaceEvent(evt || null);
              }}
              style={{
                padding: '6px 22px 6px 10px',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--bg-3)',
                color: 'var(--tx-hi)',
                font: '500 11px var(--font-ui)',
                cursor: 'pointer',
                appearance: 'none',
                maxWidth: 200,
              }}>
              <option value="">{t('board.selectAllEvents')}</option>
              {raceEvents.map(ev => (
                <option key={ev.key} value={ev.key}>
                  {ev.label} ({ev.count})
                </option>
              ))}
            </select>
          ) : null}
          rows={bestRaces}
          athleteIndex={athleteIndex}
          fmtValue={fmtTime}
          onPickAthlete={onPickAthlete}
        />
      </div>

      {/* Loading / empty */}
      {loading && (
        <div style={{
          padding: 18, color: 'var(--tx-lo)',
          font: '500 13px var(--font-ui)', textAlign: 'center',
        }}>
          Loading leaderboards…
        </div>
      )}
      {!loading && athletes.length === 0 && (
        <div className="card" style={{
          padding: 22, color: 'var(--tx-md)',
          font: '500 13px var(--font-ui)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>NO COMPETITION POOL</span>
          <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
            No athletes are currently visible in the leaderboards pool. This
            is RLS-controlled — leaderboards populate as the
            v_competition_athletes view exposes athletes you can compare against.
          </p>
        </div>
      )}
    </div>
  );
};

window.WebBoard = WebBoard;

try { console.log('[web-board] loaded (v01.47)'); } catch (_) {}
