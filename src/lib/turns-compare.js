/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Turns compare math (v00.51)

   Mirrors src/lib/starts-compare.js. Exposes window.PA_TURNS_COMPARE:
     diffTurns(primary, compare)
       → { comparable, perMetric: {key: {a, b, delta, goodDir}},
           total15in15out, totalPushOff }
     summarize(diff) — verdict + biggest gain / loss
     benchmarkTrial(trials, kind, relativeTo) → PB or MEDIAN trial
       Matches by stroke only (same v00.33 rule as Starts) — turns
       at different distances on the same stroke share mechanics.
     applyDeltas(items, diff)
     applyBests(items, trials, primary)

   Sign convention: delta = primary − compare.
     - Positive delta → primary has MORE of the metric
     - goodDir on each metric flags whether that's good or bad
   ─────────────────────────────────────────────────────────── */

(function () {
  // METRICS keys MUST match the `k` field on metricItems entries
  // so applyDeltas / applyBests can match by string equality.
  // v02.21 — `dec` added so applyDeltas can format the compare value
  // (vCompare) using the same precision as the primary tile. Brings Turns
  // MetricTiles to parity with Races (primary + compare + delta).
  const METRICS = [
    { key: '15-in / 15-out',    col: 'time_15in_15out_s', unit: 's',     dec: 2, goodDir: 'down' },
    { key: '5-in / 5-out',      col: 'time_5in_5out_s',   unit: 's',     dec: 2, goodDir: 'down' },
    { key: 'Push-off Velocity', col: 'push_off_velocity', unit: 'm/s',   dec: 2, goodDir: 'up'   },
    { key: 'Kick Rate',         col: 'kick_rate',         unit: '/min',  dec: 1, goodDir: 'up'   },
    { key: 'Surface Break',     col: 'surface_break_s',   unit: 's',     dec: 2, goodDir: 'down' },
  ];

  const num = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);

  function diffTurns(primary, compare) {
    if (!primary || !compare) {
      return {
        comparable: false, perMetric: {},
        total15in15out: null, totalPushOff: null,
      };
    }
    const perMetric = {};
    METRICS.forEach(m => {
      const a = num(primary[m.col]);
      const b = num(compare[m.col]);
      const delta = (a != null && b != null) ? +(a - b).toFixed(3) : null;
      // v02.21 — `dec` carried through so applyDeltas can format vCompare.
      perMetric[m.key] = { a, b, delta, goodDir: m.goodDir, unit: m.unit, dec: m.dec };
    });
    const t1515 = perMetric['15-in / 15-out'];
    const push  = perMetric['Push-off Velocity'];
    return {
      comparable: Object.values(perMetric).some(m => m.delta != null),
      perMetric,
      total15in15out: t1515 ? t1515.delta : null,
      totalPushOff:   push  ? push.delta  : null,
    };
  }

  function rank(m) {
    if (!m || m.delta == null) return null;
    if (m.delta === 0) return 0;
    if (m.goodDir === 'down') return m.delta < 0 ? +1 : -1;
    return m.delta > 0 ? +1 : -1;
  }

  function summarize(diff) {
    if (!diff || !diff.comparable) return null;

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

    const faster1515 = diff.total15in15out != null ? diff.total15in15out < 0 : null;
    return {
      faster1515,
      swing1515: diff.total15in15out != null ? Math.abs(diff.total15in15out) : null,
      biggestGain: bestGain,
      biggestLoss: bestLoss,
    };
  }

  // benchmarkTrial — picks PB or MEDIAN from same-stroke peers.
  // Matches v00.33 Starts pattern: stroke-only, no distance filter
  // (turn mechanics are stroke-defined, not distance-defined).
  // Sort metric: time_15in_15out_s — every captured turn should
  // have it. Trials missing it drop out of the pool.
  function benchmarkTrial(trials, kind, relativeTo) {
    if (!trials || !trials.length || !relativeTo) return null;

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
      .map(t => ({ t, v: num(t.time_15in_15out_s) }))
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

  function trialKeyFor(t) {
    if (!t) return null;
    if (t.turn_uuid) return 't:' + t.turn_uuid;
    return 'f:' + [
      t.athlete_uuid || '',
      t.source_date  || '',
      t.source_file  || '',
      t.time_15in_15out_s != null
        ? Number(t.time_15in_15out_s).toFixed(3) : '',
    ].join('|');
  }

  // applyDeltas — merge per-metric delta into MetricGrid items.
  // Matches v00.41 Starts pattern: only set `d` and `watch` here.
  // BEST is computed separately by applyBests so the pill means
  // "all-time PB," not "won this compare."
  function applyDeltas(items, diff) {
    if (!items || !diff || !diff.comparable) return items;
    return items.map(it => {
      const m = diff.perMetric[it.k];
      if (!m || m.delta == null) return it;
      const r = rank(m);
      // v02.21 — also surface vCompare so MetricTile renders the compare
      // value next to primary (matches the Races card layout).
      const vCompare = (m.b != null && m.dec != null) ? Number(m.b).toFixed(m.dec) : null;
      return Object.assign({}, it, {
        d: m.delta,
        watch: r === -1,
        vCompare,
      });
    });
  }

  // applyBests — flag items whose primary value matches the
  // athlete's best on that metric across same-stroke turns.
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
      const isBest = Math.abs(pVal - best) <= 0.005;
      return isBest ? Object.assign({}, it, { best: true }) : it;
    });
  }

  window.PA_TURNS_COMPARE = {
    diffTurns, summarize, benchmarkTrial, applyDeltas, applyBests,
    METRICS,
  };

  try { console.log('[PA_TURNS_COMPARE] loaded (v00.51)'); } catch (_) {}
})();
