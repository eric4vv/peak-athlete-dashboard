/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Admin helpers (v00.48)

   Mirrors the live dashboard's super-admin "view as athlete"
   functionality. Lets a super admin select any athlete and view
   the dashboard scoped to that athlete's data.

   Uses three live data surfaces unchanged:
     - rpc('is_admin')   → returns { is_race_admin, is_super_admin }
     - v_all_teams       → team list with athlete counts
     - athletes table    → first/last name + team_uuid + athlete_uuid

   RLS gates everything. The is_admin RPC returns null/false for
   non-admin users, so even if we surfaced the dropdowns to a
   normal user, the queries would return empty / fail. The UI
   conditional just hides the surface for non-admins.

   No writes. No service-role key. Read-only mirror of live's
   admin pattern.
   ─────────────────────────────────────────────────────────── */

(function () {
  const client = window.supabaseClient;

  // ── checkAdmin ──────────────────────────────────────────────
  // Calls the is_admin RPC. Returns shape:
  //   { isRaceAdmin: bool, isSuperAdmin: bool }
  // or { isRaceAdmin: false, isSuperAdmin: false } if the user
  // is not an admin or the RPC errors (treat as deny).
  async function checkAdmin() {
    try {
      const { data, error } = await client.rpc('is_admin');
      if (error) {
        // Most common case: RPC doesn't exist for this user (RLS).
        // Treat as not-admin.
        return { isRaceAdmin: false, isSuperAdmin: false };
      }
      // RPC returns an array with one row when admin, empty otherwise.
      if (Array.isArray(data) && data.length > 0) {
        return {
          isRaceAdmin:  !!data[0].is_race_admin,
          isSuperAdmin: !!data[0].is_super_admin,
        };
      }
      // Object form (some Postgres function shapes return a single record)
      if (data && typeof data === 'object') {
        return {
          isRaceAdmin:  !!data.is_race_admin,
          isSuperAdmin: !!data.is_super_admin,
        };
      }
      return { isRaceAdmin: false, isSuperAdmin: false };
    } catch (e) {
      return { isRaceAdmin: false, isSuperAdmin: false };
    }
  }

  // ── loadAllTeams ────────────────────────────────────────────
  // v_all_teams is RLS-filtered server-side — only super admins
  // get rows back. Returns [{ team_uuid, team_name, athlete_count }]
  async function loadAllTeams() {
    try {
      const { data, error } = await client
        .from('v_all_teams')
        .select('*')
        .order('team_name');
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── loadAthletes ────────────────────────────────────────────
  // List athletes, optionally filtered by team UUID.
  //   teamUuid === undefined → ALL athletes (every team + orphans)
  //   teamUuid === null      → ORPHAN athletes only (no team)
  //   teamUuid === <uuid>    → athletes on that specific team
  //
  // Returns [{ athlete_uuid, first_name, last_name, team_uuid }]
  // sorted by last_name then first_name.
  async function loadAthletes(teamUuid) {
    // v00.78 — try with `gender` first; fall back to the
    // pre-v00.78 column set if the athletes table doesn't have
    // gender (graceful degrade — gender filter just becomes
    // ineffective rather than crashing the page).
    //
    // v01.37 — also filter `membership_status='active'`. Without
    // this, removed athletes (status='inactive', team_uuid still
    // set per the v01.36 RLS-friendly UPDATE shape) still show
    // up in coach roster + impersonation lists. All listing
    // surfaces should hide inactive members; this is the single
    // chokepoint that feeds them.
    const buildQ = (cols) => {
      let q = client.from('athletes').select(cols)
        .eq('membership_status', 'active')
        .order('last_name').order('first_name');
      if (teamUuid === null) {
        q = q.is('team_uuid', null);
      } else if (typeof teamUuid === 'string' && teamUuid) {
        q = q.eq('team_uuid', teamUuid);
      }
      return q;
    };
    try {
      let { data, error } = await buildQ(
        'athlete_uuid, first_name, last_name, team_uuid, gender'
      );
      if (error) {
        const fb = await buildQ('athlete_uuid, first_name, last_name, team_uuid');
        if (fb.error) return { data: [], error: fb.error };
        return { data: fb.data || [], error: null };
      }
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── athleteName ─────────────────────────────────────────────
  // Format helper — "First Last" or "First L." or fallback.
  function athleteName(row) {
    if (!row) return '';
    const f = (row.first_name || '').trim();
    const l = (row.last_name  || '').trim();
    if (f && l) return f + ' ' + l;
    return f || l || (row.athlete_uuid || '').slice(0, 8);
  }

  // ── loadTeamActivity (v00.57) ───────────────────────────────
  // Aggregates recent activity across an arbitrary set of athlete
  // UUIDs. Used by CoachDeck (squad summary) and TeamRosterPage
  // (roster table). Three RLS-filtered queries — one each per
  // v_race_kpis / v_start_kpis / v_turn_kpis — each filtered by
  // athlete_uuid IN (uuids) and source_date >= (now − days).
  //
  // Returns:
  //   {
  //     byAthlete: {
  //       <athlete_uuid>: {
  //         trials_7d, trials_30d, last_session (ISO date string),
  //         last_event_type ('race' | 'start' | 'turn' | null)
  //       }
  //     },
  //     totals: {
  //       active_7d, active_30d,
  //       sessions_7d, sessions_30d,
  //     }
  //   }
  //
  // Empty input → empty result. Errors are swallowed per query
  // so a single failing view doesn't kill the whole aggregation.
  async function loadTeamActivity(athleteUuids, days) {
    const empty = {
      byAthlete: {},
      totals: { active_7d: 0, active_30d: 0, sessions_7d: 0, sessions_30d: 0 },
    };
    if (!athleteUuids || !athleteUuids.length) return empty;
    const window = (days && days > 0) ? days : 30;

    const sinceDate = new Date(Date.now() - window * 86400000)
      .toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString().slice(0, 10);

    // Init per-athlete bucket up front so even idle athletes show
    // up in the roster with zero counts.
    const byAthlete = {};
    athleteUuids.forEach(uuid => {
      byAthlete[uuid] = {
        trials_7d: 0, trials_30d: 0,
        last_session: null,
        last_event_type: null,
      };
    });

    const VIEWS = [
      { view: 'v_race_kpis',  type: 'race'  },
      { view: 'v_start_kpis', type: 'start' },
      { view: 'v_turn_kpis',  type: 'turn'  },
    ];

    const results = await Promise.all(VIEWS.map(async ({ view, type }) => {
      try {
        const { data, error } = await client
          .from(view)
          .select('athlete_uuid, source_date')
          .in('athlete_uuid', athleteUuids)
          .gte('source_date', sinceDate);
        if (error) return { type, rows: [] };
        return { type, rows: data || [] };
      } catch (e) {
        return { type, rows: [] };
      }
    }));

    results.forEach(({ type, rows }) => {
      rows.forEach(r => {
        const a = byAthlete[r.athlete_uuid];
        if (!a || !r.source_date) return;
        a.trials_30d += 1;
        if (r.source_date >= sevenDaysAgo) a.trials_7d += 1;
        if (!a.last_session || r.source_date > a.last_session) {
          a.last_session = r.source_date;
          a.last_event_type = type;
        }
      });
    });

    const totals = {
      sessions_7d:  0,
      sessions_30d: 0,
      active_7d:    0,
      active_30d:   0,
    };
    Object.values(byAthlete).forEach(a => {
      totals.sessions_7d  += a.trials_7d;
      totals.sessions_30d += a.trials_30d;
      if (a.trials_7d  > 0) totals.active_7d  += 1;
      if (a.trials_30d > 0) totals.active_30d += 1;
    });

    return { byAthlete, totals };
  }

  // ── loadSquadFocus (v00.65) ─────────────────────────────────
  // Squad-wide version of the per-athlete NextFocus picker. For
  // each athlete on the team, classifies their latest vs 30 d
  // average per modality:
  //
  //   slipping  — latest > 30 d avg by more than 2 %
  //   holding   — within ±2 %
  //   improving — latest < 30 d avg by more than 2 %
  //
  // Per modality, aggregates counts across athletes. The modality
  // with the most athletes slipping wins coach attention.
  //
  // Stroke filter:
  //   - 'all' — all three modalities scored.
  //   - specific stroke — only races scored. v_start_kpis and
  //     v_turn_kpis don't expose `style`/`distance_m`, so starts
  //     and turns can't be stroke-attributed (same constraint as
  //     the athlete-side NextFocus picker — see v00.64 changelog).
  //
  // Returns:
  //   {
  //     modality: 'starts' | 'turns' | 'races',
  //     label: string,            // human copy for the headline
  //     slipping: [name, ...],
  //     holding:  [name, ...],
  //     improving:[name, ...],
  //     total:    number,         // athletes scored in this modality
  //     unit:     's',
  //   }
  //   or null when no modality has any classifiable athletes.
  //
  // Three RLS-filtered queries total — never per-athlete.
  async function loadSquadFocus(athletes, strokeFilter) {
    if (!athletes || !athletes.length) return null;
    const uuids = athletes.map(a => a.athlete_uuid).filter(Boolean);
    if (!uuids.length) return null;

    const nameByUuid = {};
    athletes.forEach(a => {
      nameByUuid[a.athlete_uuid] = athleteName(a);
    });

    const sinceDate = new Date(Date.now() - 90 * 86400000)
      .toISOString().slice(0, 10);
    const cutoff30 = new Date(Date.now() - 30 * 86400000)
      .toISOString().slice(0, 10);
    const strokeAll = !strokeFilter || strokeFilter === 'all';

    const fetchSimple = async (view, metric) => {
      try {
        const { data, error } = await client
          .from(view)
          .select(`athlete_uuid, ${metric}, source_date`)
          .in('athlete_uuid', uuids)
          .not(metric, 'is', null)
          .gte('source_date', sinceDate);
        if (error) return [];
        return (data || []).map(r => ({
          uuid: r.athlete_uuid,
          v: parseFloat(r[metric]),
          d: r.source_date,
        })).filter(r => !isNaN(r.v));
      } catch (e) { return []; }
    };

    const fetchRaces = async () => {
      try {
        const { data, error } = await client
          .from('v_race_kpis')
          .select('athlete_uuid, race_time_s, source_date, style, distance_m')
          .in('athlete_uuid', uuids)
          .not('race_time_s', 'is', null)
          .gte('source_date', sinceDate);
        if (error) return [];
        let rows = data || [];
        if (!strokeAll) {
          rows = rows.filter(r =>
            String(r.style || '').toLowerCase() === strokeFilter
          );
        }
        return rows.map(r => ({
          uuid: r.athlete_uuid,
          v: parseFloat(r.race_time_s),
          d: r.source_date,
          style: r.style,
          distance: r.distance_m,
        })).filter(r => !isNaN(r.v));
      } catch (e) { return []; }
    };

    const [startRows, turnRows, raceRows] = await Promise.all([
      strokeAll ? fetchSimple('v_start_kpis', 'split_15m_s')      : [],
      strokeAll ? fetchSimple('v_turn_kpis',  'time_15in_15out_s') : [],
      fetchRaces(),
    ]);

    // Per-modality classifier. Returns
    // { slipping:[uuid], holding:[uuid], improving:[uuid] } using
    // (latest - avg30) / avg30. Lower-is-better for all metrics.
    const classify = (rows, perAthleteFilter) => {
      const byA = {};
      rows.forEach(r => {
        if (!byA[r.uuid]) byA[r.uuid] = [];
        byA[r.uuid].push(r);
      });
      const buckets = { slipping: [], holding: [], improving: [] };
      Object.entries(byA).forEach(([uuid, arr]) => {
        const filtered = perAthleteFilter ? perAthleteFilter(arr) : arr;
        if (!filtered || filtered.length < 2) return;
        // Sort newest first by date.
        filtered.sort((a, b) => (a.d < b.d ? 1 : -1));
        const latest = filtered[0].v;
        const within30 = filtered
          .filter(r => r.d >= cutoff30)
          .map(r => r.v);
        const avg30 = within30.length
          ? within30.reduce((s, v) => s + v, 0) / within30.length
          : filtered.reduce((s, r) => s + r.v, 0) / filtered.length;
        if (avg30 <= 0) return;
        const delta = (latest - avg30) / avg30;
        if (delta >  0.02) buckets.slipping.push(uuid);
        else if (delta < -0.02) buckets.improving.push(uuid);
        else buckets.holding.push(uuid);
      });
      return buckets;
    };

    // For races, narrow each athlete's rows to their most-recent
    // event group (distance + style) so we don't flag a 50 free
    // current vs 1500 free target.
    const sameMostRecentEvent = (arr) => {
      if (!arr.length) return [];
      arr.sort((a, b) => (a.d < b.d ? 1 : -1));
      const top = arr[0];
      return arr.filter(r =>
        Number(r.distance) === Number(top.distance) &&
        String(r.style || '').toLowerCase() ===
          String(top.style || '').toLowerCase()
      );
    };

    // Builds the headline copy from the three bucket counts. Rules:
    //   - If any athletes are slipping → lead with the slipping
    //     count (this is the coach-actionable signal).
    //   - Else if any are improving → "trending up" copy. Mention
    //     holding only when both buckets are non-zero.
    //   - Else everyone is holding → "steady" copy.
    //   - Zero-count buckets are NEVER mentioned ("0 steady" is
    //     noise that fights the headline).
    const buildLabel = (modality, b) => {
      const total = b.slipping.length + b.holding.length + b.improving.length;
      const M = {
        starts: { metric: '15 m start time', noun: 'starts' },
        turns:  { metric: 'in-out turn',      noun: 'turns'  },
        races:  { metric: 'race time',        noun: 'races'  },
      }[modality];
      const athletes = (n) => `${n} ${n === 1 ? 'athlete' : 'athletes'}`;

      if (b.slipping.length) {
        return `${b.slipping.length} of ${total} ${total === 1 ? 'athlete' : 'athletes'} losing time on their ${M.metric}.`;
      }
      if (b.improving.length && b.holding.length) {
        return `Squad ${M.noun} solid — ${b.improving.length} improving, ${b.holding.length} holding.`;
      }
      if (b.improving.length) {
        return `Squad ${M.noun} trending up — ${athletes(b.improving.length)} improving.`;
      }
      // Only holding bucket has athletes.
      return `Squad ${M.noun} steady — ${athletes(b.holding.length)} holding pace.`;
    };

    const candidates = [];

    if (strokeAll) {
      const sb = classify(startRows);
      const sTotal = sb.slipping.length + sb.holding.length + sb.improving.length;
      if (sTotal) candidates.push({
        modality: 'starts', total: sTotal, ...sb,
        label: buildLabel('starts', sb),
      });

      const tb = classify(turnRows);
      const tTotal = tb.slipping.length + tb.holding.length + tb.improving.length;
      if (tTotal) candidates.push({
        modality: 'turns', total: tTotal, ...tb,
        label: buildLabel('turns', tb),
      });
    }

    const rb = classify(raceRows, sameMostRecentEvent);
    const rTotal = rb.slipping.length + rb.holding.length + rb.improving.length;
    if (rTotal) candidates.push({
      modality: 'races', total: rTotal, ...rb,
      label: buildLabel('races', rb),
    });

    if (!candidates.length) return null;
    // Worst signal wins — most slipping, then most total athletes.
    candidates.sort((a, b) =>
      (b.slipping.length - a.slipping.length) || (b.total - a.total)
    );
    const winner = candidates[0];

    // Resolve uuids → names for display.
    const toNames = (list) => list.map(u => nameByUuid[u] || '—').filter(Boolean);
    return {
      modality: winner.modality,
      label:    winner.label,
      slipping: toNames(winner.slipping),
      holding:  toNames(winner.holding),
      improving:toNames(winner.improving),
      total:    winner.total,
      unit:     's',
    };
  }

  // ── loadTeamActivityFeed (v01.28) ───────────────────────────
  // Recent team-wide session feed for the CoachDeck. Pulls the
  // last `limit` rows (default 50 per view) from each of
  // v_start_kpis / v_turn_kpis / v_race_kpis filtered by the
  // team's athlete UUIDs, merges them into a single timeline
  // sorted newest-first, and returns the top `top` items
  // (default 12).
  //
  // RLS guarantees a coach only sees rows for athletes on their
  // own team — same gate as loadTeamActivity above.
  //
  // Returns an array of:
  //   {
  //     uuid, name, type, date,
  //     style, distance?, raceTime?, course?, reaction?,
  //   }
  //
  // Empty input → []. Errors per view are swallowed so a single
  // failing query doesn't kill the whole feed.
  async function loadTeamActivityFeed(athletes, opts) {
    if (!athletes || !athletes.length) return [];
    const uuids = athletes.map(a => a.athlete_uuid).filter(Boolean);
    if (!uuids.length) return [];

    const lim = (opts && opts.limit)  || 50;
    const top = (opts && opts.top)    || 12;

    const nameByUuid = {};
    athletes.forEach(a => {
      nameByUuid[a.athlete_uuid] = athleteName(a);
    });

    const fetchView = async (view, cols, filterNotNull) => {
      try {
        let q = client.from(view)
          .select(cols)
          .in('athlete_uuid', uuids)
          .order('source_date', { ascending: false })
          .limit(lim);
        if (filterNotNull) q = q.not(filterNotNull, 'is', null);
        const { data, error } = await q;
        if (error) return [];
        return data || [];
      } catch (e) { return []; }
    };

    const [startRows, turnRows, raceRows] = await Promise.all([
      fetchView('v_start_kpis', 'athlete_uuid, source_date, style, reaction_time_s'),
      fetchView('v_turn_kpis',  'athlete_uuid, source_date, style'),
      fetchView('v_race_kpis',  'athlete_uuid, source_date, style, distance_m, race_time_s, course', 'race_time_s'),
    ]);

    const items = [];
    startRows.forEach(d => items.push({
      uuid:     d.athlete_uuid,
      name:     nameByUuid[d.athlete_uuid] || '—',
      type:     'start',
      date:     d.source_date || null,
      style:    d.style || null,
      reaction: d.reaction_time_s != null ? parseFloat(d.reaction_time_s) : null,
    }));
    turnRows.forEach(d => items.push({
      uuid:  d.athlete_uuid,
      name:  nameByUuid[d.athlete_uuid] || '—',
      type:  'turn',
      date:  d.source_date || null,
      style: d.style || null,
    }));
    raceRows.forEach(d => items.push({
      uuid:     d.athlete_uuid,
      name:     nameByUuid[d.athlete_uuid] || '—',
      type:     'race',
      date:     d.source_date || null,
      style:    d.style || null,
      distance: d.distance_m != null ? Number(d.distance_m) : null,
      raceTime: d.race_time_s != null ? parseFloat(d.race_time_s) : null,
      course:   (d.course || '').toUpperCase() || null,
    }));

    // Newest first by source_date string (ISO yyyy-mm-dd compares
    // lexically the same as chronologically).
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return items.slice(0, top);
  }

  // ── athleteByUuid ───────────────────────────────────────────
  // One-shot lookup for a single athlete by UUID — used to
  // resolve the impersonation pill's display name from a UUID
  // when the athlete picker isn't currently rendered.
  async function athleteByUuid(uuid) {
    if (!uuid) return null;
    try {
      const { data, error } = await client
        .from('athletes')
        .select('athlete_uuid, first_name, last_name, team_uuid')
        .eq('athlete_uuid', uuid)
        .maybeSingle();
      if (error) return null;
      return data || null;
    } catch (e) {
      return null;
    }
  }

  // ── Expose ──────────────────────────────────────────────────
  window.PA_ADMIN = {
    checkAdmin,
    loadAllTeams,
    loadAthletes,
    loadTeamActivity,
    loadTeamActivityFeed,
    loadSquadFocus,
    athleteName,
    athleteByUuid,
  };

  try { console.log('[PA_ADMIN] loaded (v01.37)'); } catch (_) {}
})();
