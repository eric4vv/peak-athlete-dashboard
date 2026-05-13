/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Race comparison — pure delta logic (NO Supabase)

   Given two trials (same distance/style preferred), compute:
   - total-time delta
   - per-split delta
   - per-segment delta
   - stroke-rate / stroke-count deltas
   - a "summary" of biggest gain / biggest loss

   All functions are pure so they are trivially testable and
   reusable by starts/turns comparison in v00.18+.

   Convention for deltas: B minus A.
     Negative = B is faster / lower (good for times, splits).
     Positive = B is slower / higher.

   Exposed on window.PA_COMPARE.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const K = window.PA_KPIS;
  if (!K) {
    console.warn('[PA_COMPARE] PA_KPIS missing; load order?');
    return;
  }

  // Align two split arrays on shared distances so we only diff
  // buckets both races populated.
  function pairOn(aArr, bArr, distKey) {
    const map = new Map();
    (aArr || []).forEach(x => map.set(x[distKey], { a: x }));
    (bArr || []).forEach(x => {
      const row = map.get(x[distKey]) || {};
      row.b = x;
      map.set(x[distKey], row);
    });
    return [...map.entries()]
      .filter(([, row]) => row.a && row.b)
      .sort((x, y) => x[0] - y[0])
      .map(([d, row]) => ({ distance: d, a: row.a, b: row.b }));
  }

  function diffTrials(a, b) {
    if (!a || !b) {
      return {
        comparable: false,
        totalDelta: null,
        perSplit: [],
        perSegment: [],
        strokeRateDelta: null,
        strokeCountDelta: null,
      };
    }

    const mjA = a.mj || a.metrics_json || {};
    const mjB = b.mj || b.metrics_json || {};

    // Totals
    const totalA = K.raceTotalTime(a);
    const totalB = K.raceTotalTime(b);
    const totalDelta = (totalA != null && totalB != null) ? (totalB - totalA) : null;

    // Splits (cumulative times at each marker)
    const splitsA = K.extractSplits(mjA);
    const splitsB = K.extractSplits(mjB);
    const paired  = pairOn(splitsA, splitsB, 'distance');
    const perSplit = paired.map(p => ({
      distance: p.distance,
      aCum:  p.a.cumTime,
      bCum:  p.b.cumTime,
      delta: p.b.cumTime - p.a.cumTime,
    }));

    // Segment deltas (time BETWEEN markers, not cumulative)
    const segA = K.splitsToSegments(splitsA);
    const segB = K.splitsToSegments(splitsB);
    const perSegment = pairOn(
      segA.map(s => ({ distance: s.distEnd, seg: s.segTime, label: s.label })),
      segB.map(s => ({ distance: s.distEnd, seg: s.segTime, label: s.label })),
      'distance'
    ).map(p => ({
      label:  p.a.label || p.b.label,
      distance: p.distance,
      aSeg:   p.a.seg,
      bSeg:   p.b.seg,
      delta:  p.b.seg - p.a.seg,
    }));

    // Stroke rate (avg) delta
    const rateA = K.avgStrokeRate(a);
    const rateB = K.avgStrokeRate(b);
    const strokeRateDelta = (rateA != null && rateB != null) ? (rateB - rateA) : null;

    // Stroke count delta (sum across populated laps, matched on lap index)
    const cntA = K.extractStrokeCounts(mjA);
    const cntB = K.extractStrokeCounts(mjB);
    const pairedCnt = pairOn(cntA, cntB, 'lap');
    const strokeCountDelta = pairedCnt.length
      ? pairedCnt.reduce((acc, p) => acc + (p.b.count - p.a.count), 0)
      : null;

    return {
      comparable: perSplit.length > 0 || totalDelta != null,
      totalDelta,
      perSplit,
      perSegment,
      strokeRateDelta,
      strokeCountDelta,
    };
  }

  // Higher-level verdict for the headline strip.
  function summarize(diff) {
    if (!diff || !diff.comparable) return null;

    const faster = diff.totalDelta != null && diff.totalDelta < 0;
    const swing  = diff.totalDelta != null ? Math.abs(diff.totalDelta) : null;

    // Biggest gain (segment where B was most faster than A)
    // Biggest loss (segment where B was most slower than A)
    let best = null, worst = null;
    (diff.perSegment || []).forEach(s => {
      if (s.delta == null) return;
      if (best == null || s.delta < best.delta)  best  = s;
      if (worst == null || s.delta > worst.delta) worst = s;
    });

    return {
      faster,
      swingSec: swing,
      biggestGain: (best && best.delta < 0)  ? best  : null,
      biggestLoss: (worst && worst.delta > 0) ? worst : null,
    };
  }

  // Synthetic benchmark trial. For slotB === 'PB', pick the trial with
  // the fastest total time from the same event (distance + style +
  // course). For MEDIAN, the middle-indexed trial by total time.
  //
  // Event-key derivation mirrors `raceTitle()` — `v_race_trials` does
  // not always flatten distance / style / course as first-class
  // columns, so we fall back through `metrics_json`. Reading `t.field`
  // directly (as this function did pre-v00.24) returned `undefined`
  // for those rows, and `Number(undefined) === Number(undefined)`
  // evaluates to `NaN === NaN` (false) — so the filter silently
  // dropped every row and the function always returned null.
  //
  // The primary trial is EXCLUDED from the peer pool. Otherwise PB
  // can degenerate to "compare primary to itself" producing a
  // zero-delta compare that reads as "nothing happened."
  //
  // WR intentionally unimplemented — respects the "never display
  // benchmark holder names" rule from root CLAUDE.md.
  function benchmarkTrial(trials, kind, relativeTo) {
    if (!trials || !trials.length || !relativeTo) return null;

    const eventKeyOf = (t) => {
      const mj = (t && (t.mj || t.metrics_json)) || {};
      return {
        dist:   Number(t.distance_m != null ? t.distance_m
                 : (mj.Distance != null ? mj.Distance : mj.distance)),
        style:  String(t.style  || mj.Style  || mj.style  || '').toLowerCase(),
        course: String(t.course || mj.Course || mj.course || '').toUpperCase(),
      };
    };

    const primEvt = eventKeyOf(relativeTo);
    const primaryKey = K.trialKey(relativeTo);
    if (isNaN(primEvt.dist)) return null;

    const peers = trials.filter(t => {
      if (K.trialKey(t) === primaryKey) return false;
      const e = eventKeyOf(t);
      return e.dist === primEvt.dist
          && e.style === primEvt.style
          && e.course === primEvt.course;
    });
    if (!peers.length) return null;

    if (kind === 'PB') {
      let pb = null;
      let pbT = null;
      peers.forEach(t => {
        const tt = K.raceTotalTime(t);
        if (tt == null) return;
        if (pb == null || tt < pbT) { pb = t; pbT = tt; }
      });
      return pb ? Object.assign({}, pb, { _benchmarkKind: 'PB' }) : null;
    }

    if (kind === 'MEDIAN') {
      const timed = peers
        .map(t => ({ t, v: K.raceTotalTime(t) }))
        .filter(x => x.v != null)
        .sort((a, b) => a.v - b.v);
      if (!timed.length) return null;
      const mid = timed[Math.floor(timed.length / 2)].t;
      return Object.assign({}, mid, { _benchmarkKind: 'MEDIAN' });
    }

    return null;
  }

  // ── fetchWRBenchmark (v01.19) ───────────────────────────
  // Async resolver for the World Record compare slot. PB and
  // MEDIAN come from the athlete's own peer trials (synchronous,
  // already loaded in `trials`); WR comes from the production
  // `benchmarks` table, which is an outside catalog. Two queries:
  //
  //   1. Resolve the athlete's gender via the athletes table.
  //      RLS enforces visibility — only the athlete themselves,
  //      teammates of an active coach, or admins can SELECT here.
  //      An athlete viewing some other athlete's data they don't
  //      have access to gets no gender → no WR match → the slot
  //      surfaces "No comparable trials" via the existing
  //      benchmarkUnavailable flag.
  //
  //   2. Match `benchmarks` on event_distance + stroke + course +
  //      gender + record_type='WR' + is_current=true.
  //
  // CRITICAL — per CLAUDE.md security rule 5 ("Benchmarks are a
  // known edge case. Benchmark holder names are stored in the DB
  // but must NEVER be displayed on the dashboard"): the
  // .select() below INTENTIONALLY OMITS holder_name and
  // source_notes. They are never read by the prototype, so they
  // can never leak into UI. The chip label rendered by VideoCard
  // ("World record") comes from the kind tag, not from the holder.
  //
  // Returns a trial-shaped object (so the existing comparison
  // logic — diff / summarize / metric grids — can consume it
  // unchanged) tagged with `_benchmarkKind: 'WR'` and
  // `_isBenchmark: true`. The video routes through the benchmark
  // bucket via VideoCard's compareIsBenchmark prop.
  async function fetchWRBenchmark(primaryTrial) {
    if (!primaryTrial) return null;
    const sb = window.supabaseClient;
    if (!sb) return null;

    const athleteUuid = primaryTrial.athlete_uuid;
    if (!athleteUuid) return null;

    // 1. Resolve athlete gender. RLS handles access control.
    const { data: athlete, error: athErr } = await sb
      .from('athletes')
      .select('gender')
      .eq('athlete_uuid', athleteUuid)
      .maybeSingle();
    if (athErr || !athlete?.gender) return null;

    // 2. Build event key from the primary trial. Trials carry
    // the metric_json under `mj` after extraction; raw rows have
    // `metrics_json`. Cover both shapes.
    const mj = (primaryTrial && (primaryTrial.mj || primaryTrial.metrics_json)) || {};
    const distance = Number(
      primaryTrial.distance_m != null ? primaryTrial.distance_m
        : (mj.Distance != null ? mj.Distance : mj.distance)
    );
    const stroke = String(primaryTrial.style || mj.Style || mj.style || '').toLowerCase();
    const course = String(primaryTrial.course || mj.Course || mj.course || '').toUpperCase();
    if (isNaN(distance) || !stroke || !course) return null;

    // 3. Query benchmarks. holder_name + source_notes deliberately
    //    omitted from the select list (defense-in-depth).
    const { data: bench, error: benchErr } = await sb
      .from('benchmarks')
      .select('benchmark_uuid, record_type, event_distance, stroke, course, gender, final_time, metrics_json, video_key, date_set')
      .eq('record_type', 'WR')
      .eq('event_distance', distance)
      .ilike('stroke', stroke)
      .eq('course', course)
      .eq('gender', athlete.gender)
      .eq('is_current', true)
      .maybeSingle();
    if (benchErr || !bench) return null;

    // 4. Reshape as a trial-like object so downstream comparison
    //    logic (diffTrials, summarize, KPI grids, VideoCard) can
    //    consume it unchanged. athlete_uuid is intentionally null —
    //    benchmarks have no athlete_uuid; VideoCard's
    //    compareIsBenchmark prop routes the edge function.
    return {
      record_uuid:  bench.benchmark_uuid,
      athlete_uuid: null,
      distance_m:   bench.event_distance,
      style:        bench.stroke,
      course:       bench.course,
      race_time_s:  bench.final_time,
      metrics_json: bench.metrics_json || {},
      mj:           bench.metrics_json || {},
      video_key:    bench.video_key,
      source_date:  bench.date_set,
      _benchmarkKind: 'WR',
      _isBenchmark:   true,
    };
  }

  window.PA_COMPARE = { diffTrials, summarize, benchmarkTrial, fetchWRBenchmark };

  try { console.log('[PA_COMPARE] loaded (v01.19)'); } catch (_) {}
})();
