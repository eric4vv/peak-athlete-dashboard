/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   PA_SAMPLE — Sample dataset for Preview Pro mode

   v01.50: initial dataset (basic structure)
   v01.53: column-name alignment with v_*_kpis views
   v01.57: full coverage audit — every trial now exposes EVERY
           column the prototype's charts + detail panels read,
           so preview never shows half-empty visualizations.

   Realistic varsity-HS swimmer:
   - One PB on 100 free (story engine bait)
   - Slip-back on 200 IM
   - Dates spanning ~75 days for the 30 d / All time filter

   IMPORTANT: source_dates computed at module-init time so the
   dataset always reads as "current" relative to the user's today.
   ─────────────────────────────────────────────────────────── */

(function () {
  const isoBack = (n) => {
    const d = new Date(Date.now() - n * 86400000);
    return d.toISOString().slice(0, 10);
  };

  const SAMPLE_ATHLETE_UUID = 'sample-athlete-0001';

  // ── Helpers ─────────────────────────────────────────────
  // denseRates: interpolate sparse waypoints into every-5m
  // values so StrokeRateChart always has a continuous line
  // regardless of how many points the trial author provided.
  // Waypoints: [{ d, r }, ...] sorted ascending by d.
  function denseRates(totalDist, waypoints) {
    if (!waypoints || waypoints.length === 0) return [];
    const sorted = waypoints.slice().sort((a, b) => a.d - b.d);
    const out = [];
    for (let d = 5; d <= totalDist; d += 5) {
      // Find the two waypoints bracketing d
      let lo = sorted[0], hi = sorted[sorted.length - 1];
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].d <= d) lo = sorted[i];
        if (sorted[i].d >= d) { hi = sorted[i]; break; }
      }
      let r;
      if (lo.d === hi.d) r = lo.r;
      else if (d <= lo.d) r = lo.r;
      else if (d >= hi.d) r = hi.r;
      else r = lo.r + ((hi.r - lo.r) * (d - lo.d) / (hi.d - lo.d));
      out.push([d, Math.round(r)]);
    }
    return out;
  }

  // ── Race trials ─────────────────────────────────────────
  // Every race now carries Stroke rate every 5 m + Stroke count
  // per lap so StrokeRateChart, DPSChart, RaceVelocityChart, and
  // SrDpsEfficiencyChart all render fully.
  const race = ({ uuid, daysAgo, distance, style, course, evt, splits, rates, strokes }) => {
    const mj = {
      Distance: distance,
      Style:    style,
      Course:   course,
    };
    if (evt) mj['Event name'] = evt;
    splits.forEach(([d, t]) => { mj['Split ' + d + ' m'] = t; });
    if (rates)   rates.forEach(([d, r]) => { mj['Stroke rate ' + d + ' m'] = r; });
    if (strokes) strokes.forEach(([l, c]) => { mj['Stroke count lap ' + l] = c; });
    return {
      race_uuid:    uuid,
      athlete_uuid: SAMPLE_ATHLETE_UUID,
      source_date:  isoBack(daysAgo),
      distance_m:   distance,
      style,
      course,
      event_name:   evt || null,
      race_time_s:  splits[splits.length - 1][1],
      metrics_json: mj,
      _sample:      true,
    };
  };

  const RACES = [
    // --- Recent PB: 100 FR LCM ---
    race({
      uuid: 'sample-r-001', daysAgo: 4,
      distance: 100, style: 'freestyle', course: 'LCM', evt: 'Spring Invitational',
      splits: [[25, 12.34], [50, 25.91], [75, 39.88], [100, 54.12]],
      rates: denseRates(100, [
        { d: 5, r: 54 }, { d: 25, r: 52 }, { d: 50, r: 50 },
        { d: 75, r: 49 }, { d: 100, r: 50 },
      ]),
      strokes: [[1, 18], [2, 19]],
    }),

    // --- 50 FR LCM (recent) ---
    race({
      uuid: 'sample-r-002', daysAgo: 11,
      distance: 50, style: 'freestyle', course: 'LCM',
      splits: [[25, 12.45], [50, 25.18]],
      rates: denseRates(50, [
        { d: 5, r: 56 }, { d: 25, r: 54 }, { d: 50, r: 53 },
      ]),
      strokes: [[1, 18]],
    }),

    // --- 100 BK LCM ---
    race({
      uuid: 'sample-r-003', daysAgo: 18,
      distance: 100, style: 'backstroke', course: 'LCM',
      splits: [[25, 14.02], [50, 29.66], [75, 45.30], [100, 61.18]],
      rates: denseRates(100, [
        { d: 5, r: 48 }, { d: 25, r: 46 }, { d: 50, r: 44 },
        { d: 75, r: 43 }, { d: 100, r: 43 },
      ]),
      strokes: [[1, 16], [2, 16]],
    }),

    // --- 200 IM LCM (slip-back; trend bait) ---
    race({
      uuid: 'sample-r-004', daysAgo: 27,
      distance: 200, style: 'individual medley', course: 'LCM',
      splits: [[25, 15.10], [50, 32.06], [75, 50.92], [100, 71.12],
               [125, 91.85], [150, 113.40], [175, 132.16], [200, 151.20]],
      rates: denseRates(200, [
        { d: 5, r: 56 }, { d: 25, r: 54 }, { d: 50, r: 50 },  // fly leg
        { d: 75, r: 44 }, { d: 100, r: 42 },                  // back leg
        { d: 125, r: 38 }, { d: 150, r: 36 },                 // breast leg
        { d: 175, r: 48 }, { d: 200, r: 52 },                 // free leg
      ]),
      // 200 IM: fly / back / breast / free
      strokes: [[1, 13], [2, 16], [3, 9], [4, 18]],
    }),

    // --- Older 100 FR LCM (establishes the PB delta) ---
    race({
      uuid: 'sample-r-005', daysAgo: 38,
      distance: 100, style: 'freestyle', course: 'LCM',
      splits: [[25, 12.61], [50, 26.38], [75, 40.55], [100, 55.04]],
      rates: denseRates(100, [
        { d: 5, r: 53 }, { d: 25, r: 51 }, { d: 50, r: 49 },
        { d: 75, r: 48 }, { d: 100, r: 49 },
      ]),
      strokes: [[1, 18], [2, 20]],
    }),

    // --- 100 BR SCM ---
    race({
      uuid: 'sample-r-006', daysAgo: 45,
      distance: 100, style: 'breaststroke', course: 'SCM',
      splits: [[25, 13.18], [50, 28.32], [75, 44.10], [100, 60.55]],
      rates: denseRates(100, [
        { d: 5, r: 42 }, { d: 25, r: 40 }, { d: 50, r: 38 },
        { d: 75, r: 37 }, { d: 100, r: 38 },
      ]),
      // 100 BR SCM = 4 laps of 25 m. Breaststroke counts are low.
      strokes: [[1, 8], [2, 9], [3, 9], [4, 10]],
    }),

    // --- Older 50 FR SCY ---
    race({
      uuid: 'sample-r-007', daysAgo: 58,
      distance: 50, style: 'freestyle', course: 'SCY',
      splits: [[25, 11.42], [50, 22.88]],
      rates: denseRates(50, [
        { d: 5, r: 58 }, { d: 25, r: 56 }, { d: 50, r: 55 },
      ]),
      // 50 yd SCY = 2 laps of 25 yd
      strokes: [[1, 14], [2, 15]],
    }),

    // --- 200 FR LCM (oldest, stretches the 30d filter) ---
    race({
      uuid: 'sample-r-008', daysAgo: 72,
      distance: 200, style: 'freestyle', course: 'LCM',
      splits: [[25, 12.92], [50, 26.91], [75, 41.50], [100, 56.42],
               [125, 71.78], [150, 87.34], [175, 102.96], [200, 118.21]],
      rates: denseRates(200, [
        { d: 5, r: 48 }, { d: 50, r: 46 }, { d: 100, r: 44 },
        { d: 150, r: 43 }, { d: 200, r: 45 },
      ]),
      // 200 FR LCM = 4 laps of 50m
      strokes: [[1, 32], [2, 34], [3, 35], [4, 36]],
    }),
  ];

  // ── Start trials ────────────────────────────────────────
  // v01.57 — added kick_rate + abs_time_deepest_dive to all
  // trials. These columns drive the Underwater tab's Kick Rate
  // and Deepest Dive rows, which were rendering as "—" before.
  const start = (cfg) => ({
    start_uuid:   cfg.uuid,
    athlete_uuid: SAMPLE_ATHLETE_UUID,
    source_date:  isoBack(cfg.daysAgo),
    style:        cfg.style,

    // Block phase
    reaction_time_s:           cfg.reaction,
    push_time_s:               cfg.push,
    block_pushing_duration_s:  cfg.push,
    block_reaction_s:          null,

    // Flight phase
    flight_phase_s:            cfg.flight,
    angle_hip_entry_deg:       cfg.entryAngle,
    distance_to_water_entry:   cfg.entryDist,
    height_hip_takeoff:        cfg.hipHeight,
    hor_vel_hip_flight:        cfg.peakVel,
    hor_vel_hands_entry:       cfg.entryVel,

    // Underwater velocity progression
    hor_vel_hip_to_kick1:      cfg.uwK1,
    hor_vel_hip_3kicks:        cfg.uw3K,
    hor_vel_hip_stroke1:       cfg.uwS1,
    hor_vel_hip_stroke2:       cfg.uwS2,

    // Underwater rhythm + dive
    kick_rate:                 cfg.kickRate,
    abs_time_deepest_dive:     cfg.deepestDive,

    // Surface break + splits
    // v01.63 — abs_time_start_signal added so sbRace() in web-starts.jsx
    // can normalize abs_time_surface_break to race-relative time. Setting
    // it to 0 means the existing abs values are ALREADY race-relative
    // (matching the t-splits authored above). abs_time_15m_s included so
    // any code preferring the abs form also resolves cleanly.
    abs_time_start_signal:     0,
    abs_time_surface_break:    cfg.surfBreak,
    abs_time_15m_s:            cfg.t15,
    split_5m_s:                cfg.t5,
    split_10m_s:               cfg.t10,
    split_15m_s:               cfg.t15,

    metrics_json:              { Style: cfg.style },
    _sample: true,
  });

  const STARTS = [
    start({
      uuid: 'sample-s-001', daysAgo: 5, style: 'freestyle',
      reaction: 0.652, push: 0.34, flight: 0.32,
      entryAngle: 28, entryDist: 3.18, hipHeight: 0.95,
      peakVel: 6.42, entryVel: 5.18,
      uwK1: 3.20, uw3K: 2.78, uwS1: 2.40, uwS2: 2.30,
      kickRate: 122, deepestDive: 1.85,
      surfBreak: 5.10, t5: 1.78, t10: 4.20, t15: 6.62,
    }),
    start({
      uuid: 'sample-s-002', daysAgo: 14, style: 'freestyle',
      reaction: 0.671, push: 0.36, flight: 0.33,
      entryAngle: 27, entryDist: 3.05, hipHeight: 0.92,
      peakVel: 6.30, entryVel: 5.10,
      uwK1: 3.15, uw3K: 2.74, uwS1: 2.36, uwS2: 2.27,
      kickRate: 120, deepestDive: 1.92,
      surfBreak: 5.18, t5: 1.82, t10: 4.28, t15: 6.74,
    }),
    start({
      uuid: 'sample-s-003', daysAgo: 22, style: 'butterfly',
      reaction: 0.688, push: 0.37, flight: 0.34,
      entryAngle: 30, entryDist: 2.95, hipHeight: 0.90,
      peakVel: 6.08, entryVel: 4.96,
      uwK1: 3.05, uw3K: 2.65, uwS1: 2.32, uwS2: 2.21,
      kickRate: 118, deepestDive: 2.04,
      surfBreak: 5.32, t5: 1.91, t10: 4.42, t15: 7.01,
    }),
    start({
      uuid: 'sample-s-004', daysAgo: 41, style: 'freestyle',
      reaction: 0.694, push: 0.38, flight: 0.34,
      entryAngle: 26, entryDist: 3.02, hipHeight: 0.88,
      peakVel: 6.18, entryVel: 5.02,
      uwK1: 3.10, uw3K: 2.70, uwS1: 2.34, uwS2: 2.24,
      kickRate: 116, deepestDive: 1.98,
      surfBreak: 5.28, t5: 1.85, t10: 4.36, t15: 6.91,
    }),
    start({
      uuid: 'sample-s-005', daysAgo: 60, style: 'breaststroke',
      reaction: 0.712, push: 0.40, flight: 0.36,
      entryAngle: 29, entryDist: 2.80, hipHeight: 0.86,
      peakVel: 5.85, entryVel: 4.78,
      uwK1: 2.90, uw3K: 2.50, uwS1: 2.18, uwS2: 2.05,
      kickRate: 102, deepestDive: 2.18, // BR pull-out is deeper
      surfBreak: 5.55, t5: 2.02, t10: 4.78, t15: 7.55,
    }),
  ];

  // ── Turn trials ─────────────────────────────────────────
  // v01.57 — added 10 missing columns: adaption_time_s,
  // avg_vel_5_0_pre / 10_5_pre / 15_10_pre, hand_contact_time_s,
  // push_off_time_s, rotation_time_s, stroke_rate_pre_turn,
  // stroke_rate_post_turn, time_5in_15out_s. These drive the
  // approach / wall / departure detail rows on the Turns page.
  // v01.59 (synced from mobile v02.12) — added the 3 POST-wall
  // zones (avg_vel_0_5, avg_vel_5_10, avg_vel_10_15) that the
  // v01.57 audit missed. Without these the Velocity Profile
  // chart's line stopped at the wall — half-empty chart that
  // read as a bug. Realistic profile: peak at 0-5 post (push-off
  // injection), then decay through streamline (5-10) and
  // breakout (10-15).
  const turn = (cfg) => ({
    turn_uuid:           cfg.uuid,
    athlete_uuid:        SAMPLE_ATHLETE_UUID,
    source_date:         isoBack(cfg.daysAgo),
    style:               cfg.style,

    // Headline metrics (canonical)
    time_15in_15out_s:   cfg.inOut,
    time_5in_5out_s:     cfg.fiveInOut,
    time_5in_15out_s:    cfg.fiveIn15Out,
    push_off_velocity:   cfg.pushVel,
    kick_rate:           cfg.kickRate,
    surface_break_s:     cfg.surfBreak,
    split_15m_s:         cfg.split15,

    // Approach (pre-turn) velocity zones
    avg_vel_15_10_pre:   cfg.vel15to10,
    avg_vel_10_5_pre:    cfg.vel10to5,
    avg_vel_5_0_pre:     cfg.vel5to0,

    // Departure (post-wall) velocity zones — push-off → streamline → breakout
    avg_vel_0_5:         cfg.vel0to5Post,
    avg_vel_5_10:        cfg.vel5to10Post,
    avg_vel_10_15:       cfg.vel10to15Post,

    // Wall mechanics
    hand_contact_time_s: cfg.handContact,
    rotation_time_s:     cfg.rotation,
    push_off_time_s:     cfg.pushOffTime,
    adaption_time_s:     cfg.adaption,

    // Stroke rates around the turn
    stroke_rate_pre_turn:  cfg.srPre,
    stroke_rate_post_turn: cfg.srPost,

    metrics_json:        { Style: cfg.style },
    _sample: true,
  });

  const TURNS = [
    turn({
      uuid: 'sample-t-001', daysAgo: 6, style: 'freestyle',
      inOut: 15.63, fiveInOut: 5.42, fiveIn15Out: 10.21,
      pushVel: 2.41, kickRate: 118, surfBreak: 4.85, split15: 8.21,
      vel15to10: 1.92, vel10to5: 1.88, vel5to0: 1.78,
      vel0to5Post: 2.18, vel5to10Post: 1.85, vel10to15Post: 1.62,
      handContact: 0.15, rotation: 0.42, pushOffTime: 0.31, adaption: 0.55,
      srPre: 50, srPost: 48,
    }),
    turn({
      uuid: 'sample-t-002', daysAgo: 16, style: 'freestyle',
      inOut: 15.85, fiveInOut: 5.50, fiveIn15Out: 10.35,
      pushVel: 2.34, kickRate: 114, surfBreak: 4.96, split15: 8.30,
      vel15to10: 1.88, vel10to5: 1.84, vel5to0: 1.74,
      vel0to5Post: 2.10, vel5to10Post: 1.78, vel10to15Post: 1.55,
      handContact: 0.16, rotation: 0.44, pushOffTime: 0.32, adaption: 0.58,
      srPre: 49, srPost: 47,
    }),
    turn({
      uuid: 'sample-t-003', daysAgo: 24, style: 'backstroke',
      inOut: 16.50, fiveInOut: 5.72, fiveIn15Out: 10.78,
      pushVel: 2.22, kickRate: 110, surfBreak: 5.18, split15: 8.62,
      vel15to10: 1.76, vel10to5: 1.72, vel5to0: 1.62,
      vel0to5Post: 1.98, vel5to10Post: 1.68, vel10to15Post: 1.45,
      handContact: 0.14, rotation: 0.48, pushOffTime: 0.34, adaption: 0.62,
      srPre: 44, srPost: 42,
    }),
    turn({
      uuid: 'sample-t-004', daysAgo: 35, style: 'freestyle',
      inOut: 16.00, fiveInOut: 5.55, fiveIn15Out: 10.45,
      pushVel: 2.30, kickRate: 112, surfBreak: 5.05, split15: 8.39,
      vel15to10: 1.85, vel10to5: 1.81, vel5to0: 1.71,
      vel0to5Post: 2.05, vel5to10Post: 1.72, vel10to15Post: 1.50,
      handContact: 0.16, rotation: 0.45, pushOffTime: 0.33, adaption: 0.60,
      srPre: 48, srPost: 46,
    }),
    turn({
      uuid: 'sample-t-005', daysAgo: 55, style: 'butterfly',
      inOut: 17.24, fiveInOut: 5.95, fiveIn15Out: 11.29,
      pushVel: 2.15, kickRate: 108, surfBreak: 5.42, split15: 9.04,
      vel15to10: 1.72, vel10to5: 1.68, vel5to0: 1.58,
      vel0to5Post: 1.95, vel5to10Post: 1.62, vel10to15Post: 1.40,
      handContact: 0.18, rotation: 0.50, pushOffTime: 0.35, adaption: 0.65,
      srPre: 54, srPost: 52,
    }),
  ];

  // ── Expose ──────────────────────────────────────────────
  window.PA_SAMPLE = {
    RACES, STARTS, TURNS,
    SAMPLE_ATHLETE_UUID,
  };

  try { console.log('[PA_SAMPLE] loaded (v01.57) — ' + RACES.length + ' races, ' + STARTS.length + ' starts, ' + TURNS.length + ' turns'); } catch (_) {}
})();
