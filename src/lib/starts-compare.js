/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Starts compare math (v00.19)

   Exposes: window.PA_STARTS_COMPARE
     diffStarts(primary, compare)
       → { comparable, perMetric: {key: {a, b, delta, goodDir}},
           total15m, totalReact }
     summarize(diff) — short verdict + "biggest gain / loss" metric
     benchmarkTrial(trials, kind, relativeTo)
       → PB or MEDIAN trial from same event
     applyDeltas(items, diff) — merges d fields into metricItems
       payload so MetricGrid can render Δ chips

   Sign convention for this module: delta = primary − compare.
     - Positive delta means primary has MORE of that metric
     - goodDir on each metric determines whether that's good or bad
     - MetricTile colors the chip accordingly via its own goodDir arg

   Benchmark 'WR' is intentionally not implemented — holder-name rule.
   ─────────────────────────────────────────────────────────── */

(function () {
  const S = window.PA_STARTS;

  // Map of metric key → source column on the start row.
  // goodDir: 'up' if higher is better, 'down' if lower is better.
  // Order here is also the ranking order for biggestGain/Loss
  // (first non-null is the most coachable).
  // v02.21 — `dec` added so applyDeltas can format the compare value
  // (vCompare) using the same precision as the primary tile. Without
  // this, Starts MetricTiles only showed the delta — Races already
  // showed primary + compare + delta. This brings parity.
  const METRICS = [
    { key: 'Reaction Time',  col: 'reaction_time_s',         unit: 's',   dec: 2, goodDir: 'down' },
    { key: 'Push Time',      col: 'push_time_s',             unit: 's',   dec: 3, goodDir: 'down' },
    { key: 'Flight Phase',   col: 'flight_phase_s',          unit: 's',   dec: 3, goodDir: 'down' },
    { key: 'Entry Angle',    col: 'angle_hip_entry_deg',     unit: '°',   dec: 1, goodDir: 'down' },
    { key: 'Entry Distance', col: 'distance_to_water_entry', unit: 'm',   dec: 2, goodDir: 'up'   },
    { key: 'Hip @ Takeoff',  col: 'height_hip_takeoff',      unit: 'm',   dec: 2, goodDir: 'up'   },
    { key: 'Peak Velocity',  col: 'hor_vel_hip_flight',      unit: 'm/s', dec: 2, goodDir: 'up'   },
    { key: 'Time to 15 m',   col: 'split_15m_s',             unit: 's',   dec: 2, goodDir: 'down' },
  ];

  const num = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);

  function diffStarts(primary, compare) {
    if (!primary || !compare) {
      return {
        comparable: false, perMetric: {},
        total15m: null, totalReact: null,
      };
    }
    const perMetric = {};
    METRICS.forEach(m => {
      // v02.22 — special-case "Peak Velocity" to use the peakVelocity()
      // helper (max of hor_vel_hip_flight and hor_vel_hands_entry) rather
      // than reading hor_vel_hip_flight directly. Keeps the compare in
      // sync with the metricItems display, which now shows the actual
      // peak rather than always preferring takeoff velocity.
      let a, b;
      if (m.key === 'Peak Velocity' && S && S.peakVelocity) {
        a = S.peakVelocity(primary);
        b = S.peakVelocity(compare);
      } else {
        a = num(primary[m.col]);
        b = num(compare[m.col]);
      }
      const delta = (a != null && b != null) ? +(a - b).toFixed(3) : null;
      // v02.21 — `dec` carried through so applyDeltas can format vCompare.
      perMetric[m.key] = { a, b, delta, goodDir: m.goodDir, unit: m.unit, dec: m.dec };
    });
    const t15 = perMetric['Time to 15 m'];
    const rct = perMetric['Reaction Time'];
    return {
      comparable: Object.values(perMetric).some(m => m.delta != null),
      perMetric,
      total15m:   t15 ? t15.delta : null,
      totalReact: rct ? rct.delta : null,
    };
  }

  // Evaluate whether the primary is 'better' at metric m.
  // Returns:
  //   +1 primary better, -1 primary worse, 0 equal, null n/a
  function rank(m) {
    if (!m || m.delta == null) return null;
    if (m.delta === 0) return 0;
    if (m.goodDir === 'down') return m.delta < 0 ? +1 : -1;
    return m.delta > 0 ? +1 : -1;
  }

  function summarize(diff) {
    if (!diff || !diff.comparable) return null;

    // Find the most coach-meaningful gain / loss by scoring each
    // metric with its delta magnitude scaled by a crude weight.
    // Keep it simple: just pick the biggest |delta| among each
    // side; fancier scoring can come later.
    let bestGain = null, bestLoss = null;
    Object.entries(diff.perMetric).forEach(([key, m]) => {
      const r = rank(m);
      if (r == null) return;
      if (r > 0) {
        if (!bestGain || Math.abs(m.delta) > Math.abs(bestGain.m.delta)) {
          bestGain = { key, m };
        }
      } else if (r < 0) {
        if (!bestLoss || Math.abs(m.delta) > Math.abs(bestLoss.m.delta)) {
          bestLoss = { key, m };
        }
      }
    });

    const faster15 = diff.total15m != null ? diff.total15m < 0 : null;
    return {
      faster15,
      swing15: diff.total15m != null ? Math.abs(diff.total15m) : null,
      biggestGain: bestGain,  // { key, m: { a, b, delta, goodDir, unit } }
      biggestLoss: bestLoss,
    };
  }

  // Benchmark trial — picked from the same STROKE only.
  //
  // Why stroke-only (v00.33):
  //   The first 15 m of a start are mechanically the same regardless
  //   of race distance — a 50 Free start and a 100 Free start should
  //   both feed the same "freestyle start PB". Filtering by distance
  //   and course (the v00.20 behavior) collapsed peer pools to one
  //   trial per (distance, stroke, course) combo, so excluding the
  //   primary almost always emptied the pool.
  //
  // Sort metric: split_15m_s — every start trial should have this.
  // PB = fastest 15 m split; MEDIAN = middle-indexed by 15 m split.
  // Trials missing split_15m_s drop out of the sort.
  //
  // The primary trial is EXCLUDED from the peer pool — otherwise PB
  // trivially returns `relativeTo` when it's already the fastest.
  //
  // Returns a cloned row with ._benchmarkKind tagged for UI.
  function benchmarkTrial(trials, kind, relativeTo) {
    if (!trials || !trials.length || !relativeTo) return null;

    // Stroke fallback: top-level column first, then mj.Style / mj.style.
    const styleOf = (t) => {
      if (!t) return '';
      const mj = t.mj || t.metrics_json || {};
      return String(t.style || mj.Style || mj.style || '').toLowerCase();
    };

    const s = styleOf(relativeTo);
    const primaryKey = trialKeyFor(relativeTo);
    if (!s) return null;

    const peers = trials.filter(t =>
      styleOf(t) === s &&
      trialKeyFor(t) !== primaryKey
    );
    if (!peers.length) return null;

    const sorted = peers
      .map(t => ({ t, v: num(t.split_15m_s) }))
      .filter(x => x.v != null)
      .sort((a, b) => a.v - b.v);

    if (!sorted.length) return null;

    if (kind === 'PB') {
      const pb = sorted[0].t;
      return Object.assign({}, pb, { _benchmarkKind: 'PB' });
    }
    if (kind === 'MEDIAN') {
      const mid = sorted[Math.floor(sorted.length / 2)].t;
      return Object.assign({}, mid, { _benchmarkKind: 'MEDIAN' });
    }
    return null;
  }

  // Stable key for matching a trial against itself — mirrors the
  // shape PA_STARTS.trialKey uses so "exclude primary from peers"
  // works whether or not start_uuid is present.
  function trialKeyFor(t) {
    if (!t) return null;
    if (t.start_uuid) return 's:' + t.start_uuid;
    return 'f:' + [
      t.athlete_uuid || '',
      t.source_date  || '',
      t.source_file  || '',
      t.reaction_time_s != null ? Number(t.reaction_time_s).toFixed(3) : '',
    ].join('|');
  }

  // Merge diff.delta into the items[] payload from PA_STARTS.metricItems
  // so MetricGrid renders the Δ chip correctly per-tile.
  //
  // v00.41 note — `best` is no longer set here. The compare-derived
  // "primary won this metric" signal is already conveyed by the Δ
  // chip color (lime when better, flag when worse). Reserving `best`
  // for all-time best lets the BEST pill mean what an athlete expects
  // it to mean — "this is the best you've ever done." That flag is
  // applied separately by `applyBests` below.
  //
  // `watch` stays — it tags the metric the athlete regressed on vs
  // the compare trial, which is a useful coaching signal regardless
  // of all-time context.
  function applyDeltas(items, diff) {
    if (!items || !diff || !diff.comparable) return items;
    return items.map(it => {
      const m = diff.perMetric[it.k];
      if (!m || m.delta == null) return it;
      const r = rank(m);
      // v02.21 — also surface vCompare so MetricTile renders the compare
      // value next to primary (matches the Races card layout). Formatted
      // with the same decimals as the primary value to keep visual parity.
      const vCompare = (m.b != null && m.dec != null) ? Number(m.b).toFixed(m.dec) : null;
      return Object.assign({}, it, {
        d: m.delta,
        watch: r === -1,
        vCompare,
      });
    });
  }

  // applyBests — flag MetricTile items whose primary value equals the
  // athlete's best on that metric across all same-stroke trials.
  //
  // Direction-aware: 'up' metrics (velocity, height, distance) take
  // the max; 'down' metrics (times, angle) take the min. A small
  // rounding tolerance handles the lossy fixed-decimal display in
  // metricItems (which formats values to 1–3 dp depending on metric).
  //
  // Ties — multiple trials share the best value — are intentionally
  // all marked BEST. If the athlete duplicates their PB, the new
  // trial is also a PB.
  function applyBests(items, trials, primary) {
    if (!items || !primary || !trials || !trials.length) return items;

    const styleOf = (t) => {
      if (!t) return '';
      const mj = t.mj || t.metrics_json || {};
      return String(t.style || mj.Style || mj.style || '').toLowerCase();
    };
    const pStyle = styleOf(primary);
    if (!pStyle) return items;

    const peers = trials.filter(t => styleOf(t) === pStyle);
    if (!peers.length) return items;

    // Build best-per-metric across the peer set, indexed by METRICS.key
    // so we can match against item.k.
    const bestByKey = {};
    METRICS.forEach(m => {
      const values = peers.map(t => num(t[m.col])).filter(v => v != null);
      if (!values.length) return;
      bestByKey[m.key] = m.goodDir === 'up' ? Math.max(...values) : Math.min(...values);
    });

    return items.map(it => {
      const best = bestByKey[it.k];
      if (best == null) return it;
      const meta = METRICS.find(m => m.key === it.k);
      if (!meta) return it;
      const pVal = num(primary[meta.col]);
      if (pVal == null) return it;
      // 0.005 tolerance — covers all metric precisions (the loosest
      // tile renders to 2 dp, so values within 0.005 are visually
      // indistinguishable). Tighter tolerance would miss legitimate
      // ties; looser would mark "near-best" as best.
      const isBest = Math.abs(pVal - best) <= 0.005;
      return isBest ? Object.assign({}, it, { best: true }) : it;
    });
  }

  window.PA_STARTS_COMPARE = {
    diffStarts, summarize, benchmarkTrial, applyDeltas, applyBests,
    METRICS,
  };

  try { console.log('[PA_STARTS_COMPARE] loaded (v00.41)'); } catch (_) {}
})();
