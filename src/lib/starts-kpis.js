/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Starts KPIs — thin read-layer over v_start_kpis

   Exposes: window.PA_STARTS
     listStartTrials(athleteUuid, opts)  — RLS-filtered read
     trialKey(trial)                     — stable selection key
     startTitle(trial), startDate(trial) — display helpers
     phaseSpans(trial)                   — derive Block / Flight /
       Underwater / Surface segment durations for PhaseTimeline
     metricItems(trial)                  — prebuilt MetricGrid payload
     buildStartStory(primary, compare)   — Headline props

   Phase 1: READ-ONLY. Single-trial view. No compare logic yet —
   that lands in v00.20 with the Option D slot port.
   ─────────────────────────────────────────────────────────── */

(function () {
  const client = window.supabaseClient;

  // ── Query: listStartTrials ────────────────────────────────────
  // v_start_kpis is RLS-scoped to the athlete. We still add an
  // explicit .eq() per prototype security rule #3 (no wildcards
  // without an equality filter).
  async function listStartTrials(athleteUuid, opts) {
    const limit = (opts && opts.limit) || 200;
    if (!athleteUuid) return { data: [], error: null };
    try {
      // v01.68 — wrapped in withRecovery() to auto-recover from
      // stuck supabase client state. Falls back to direct call if
      // PA_AUTH not yet loaded.
      const exec = () => client
        .from('v_start_kpis')
        .select('*')
        .eq('athlete_uuid', athleteUuid)
        .order('source_date', { ascending: false })
        .limit(limit);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'v_start_kpis listStartTrials' })
        : await exec();
      if (error) return { data: [], error };
      return { data: enrich(data || []), error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Attach mj (metrics_json alias) so downstream consumers match
  // the raceTrials pattern. Not every column lives in metrics_json
  // — the view flattens most into first-class columns — but keep
  // the alias for symmetry.
  function enrich(rows) {
    return rows.map(r => Object.assign({}, r, {
      mj: r.metrics_json || {},
    }));
  }

  // ── Keys & labels ─────────────────────────────────────────────

  // Stable selection key. Prefer start_uuid when present, fall back
  // to athlete+date+source_file fingerprint.
  function trialKey(trial) {
    if (!trial) return null;
    if (trial.start_uuid) return 's:' + trial.start_uuid;
    return 'f:' + [
      trial.athlete_uuid || '',
      trial.source_date  || '',
      trial.source_file  || '',
      trial.reaction_time_s != null ? Number(trial.reaction_time_s).toFixed(3) : '',
    ].join('|');
  }

  // "Start · 50 Freestyle" or just "Start" if style missing
  function startTitle(trial) {
    if (!trial) return '';
    const style = trial.style || trial.mj?.Style || trial.mj?.style;
    const dist  = trial.distance_m || trial.mj?.Distance;
    const parts = ['Start'];
    if (dist)  parts.push(dist + 'm');
    if (style) parts.push(style.charAt(0).toUpperCase() + style.slice(1));
    return parts.join(' · ');
  }

  // Short, human date. Source is ISO (YYYY-MM-DD); render as
  // "17 Apr 2026".
  function startDate(trial) {
    if (!trial || !trial.source_date) return '';
    const d = new Date(trial.source_date + 'T00:00:00');
    if (isNaN(d.getTime())) return trial.source_date;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  // ── Phase derivation ──────────────────────────────────────────
  // The PhaseTimeline needs { label, name, range, weight } where
  // weight drives segment width. We derive weights from actual
  // time spans when possible, and fall back to equal weights if
  // the columns aren't populated.
  //
  // Block     = block_reaction_s + block_pushing_duration_s
  //           (fallback: push_time_s)
  // Flight    = flight_phase_s
  // Underwater = abs_time_surface_break − (block + flight)
  //             (time from entry to breakout)
  // Surface   = split_15m_s − abs_time_surface_break
  //             (breakout → 15m marker)
  //
  // If any required value is missing, return equal weights so the
  // UI still renders without a jarring collapse.
  // v00.37: per-phase fallback. Previously the function returned a
  // generic all-caps label set ("BLOCK / FLIGHT / …") whenever ANY
  // phase boundary was missing — which collapsed the entire timeline
  // to fallback the moment one column (typically abs_time_surface_break)
  // was null. Now each phase resolves independently. A phase with all
  // its data shows "0.00s → 0.78s"; a phase with partial data falls
  // back to its name in caps and an even weight.
  function phaseSpans(trial) {
    if (!trial) return fallbackPhases();
    const num = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const fmt = (t) => t == null ? null : t.toFixed(2) + 's';

    // v02.21 (2026-05-12) — time-base fix. abs_time_* columns are VIDEO-relative
    // (camera timestamps), not race-relative. To compare against split_15m_s
    // (race-relative duration from start signal), we subtract abs_time_start_signal
    // from each abs_* value. Before this fix, the phase widths were off by the
    // value of abs_time_start_signal (~3-8s per row in production data).
    const startSig = num(trial.abs_time_start_signal);
    const toRace = (absVal) => (absVal != null && startSig != null) ? absVal - startSig : null;

    const reaction = num(trial.reaction_time_s);          // signal → leaving block (total)
    const flight   = num(trial.flight_phase_s);            // leaving block → water entry
    const surface  = toRace(num(trial.abs_time_surface_break));    // signal → head break surface (RACE-RELATIVE)
    const fifteen  = num(trial.split_15m_s);               // signal → 15 m mark

    // Boundary times (in absolute seconds since the start signal).
    const blockEnd      = reaction;
    const flightEnd     = (blockEnd != null && flight != null) ? blockEnd + flight : null;
    const underwaterEnd = surface;
    const surfaceEnd    = fifteen;

    // Per-phase widths. null means "no data → fallback weight."
    const blockW      = blockEnd;
    const flightW     = flight;
    const underwaterW = (flightEnd != null && underwaterEnd != null && underwaterEnd > flightEnd)
                        ? underwaterEnd - flightEnd : null;
    const surfaceW    = (underwaterEnd != null && surfaceEnd != null && surfaceEnd > underwaterEnd)
                        ? surfaceEnd - underwaterEnd : null;

    // v00.84 — when a phase span is "inverted" (end < start), the
    // pre-v00.84 label rendered as "11.37s → 7.70s" which reads
    // backwards. Happens specifically on Surface for fast under-
    // water kickers who reach 15 m while still underwater (so
    // breakout > 15 m time). Fix: render the times smaller-first
    // and swap the range copy to reflect the inverted reality.
    // The phase `name` always stays the same so tab-routing keys
    // don't shift.
    const phase = (name, range, fallbackWeight, fallbackLabel, start, end, weight, invertedRange) => {
      const haveBoundaries = (start != null && end != null);
      if (!haveBoundaries) {
        return {
          name, range, label: fallbackLabel,
          weight: weight != null && weight > 0 ? weight : fallbackWeight,
        };
      }
      const inverted = end < start;
      return {
        name,
        range: inverted && invertedRange ? invertedRange : range,
        label: inverted
          ? (fmt(end) + ' → ' + fmt(start))
          : (fmt(start) + ' → ' + fmt(end)),
        weight: weight != null && weight > 0 ? weight : fallbackWeight,
        inverted,
      };
    };

    return [
      phase('Block',      'Reaction & push',   1,   'BLOCK',      0,             blockEnd,      blockW),
      phase('Flight',     'Takeoff → entry',   1,   'FLIGHT',     blockEnd,      flightEnd,     flightW),
      phase('Underwater', 'Entry → breakout',  2,   'UNDERWATER', flightEnd,     underwaterEnd, underwaterW),
      phase('Surface',    'Breakout → 15 m',   1.5, 'SURFACE',    underwaterEnd, surfaceEnd,    surfaceW,
        'Underwater past 15 m'),
    ];
  }

  function fallbackPhases() {
    return [
      { label: 'BLOCK',      name: 'Block',      range: 'Reaction & push',  weight: 1 },
      { label: 'FLIGHT',     name: 'Flight',     range: 'Takeoff → entry',  weight: 1 },
      { label: 'UNDERWATER', name: 'Underwater', range: 'Entry → breakout', weight: 2 },
      { label: 'SURFACE',    name: 'Surface',    range: 'Breakout → 15 m',  weight: 1.5 },
    ];
  }

  // ── MetricGrid payload ────────────────────────────────────────
  // Packs the 8 tiles used in the design-reference StartsPage.
  // Each entry: { k, v, u, goodDir }
  //
  // goodDir tells MetricTile whether a positive delta is good
  // ('up' for velocity/height/distance) or bad ('down' for times,
  // angle, which prefers lower / neutral). Deltas are not computed
  // at this stage — they come in with the compare slot (v00.20).
  // v02.22 — Peak velocity is the MAX of measured velocity samples
  // across the entire start trajectory. v03.03 extended the sample
  // set from 2 → 6 columns after Eric reported the reported "peak"
  // was sometimes lower than a velocity recorded in a later phase
  // (e.g., hor_vel_hip_to_kick1 exceeding hor_vel_hip_flight when
  // streamline + initial pulse efficiency carries the body past
  // takeoff speed).
  //
  // Samples scanned (in trajectory order):
  //   hor_vel_hip_flight     — hip velocity during flight phase (takeoff)
  //   hor_vel_hands_entry    — hand velocity at water entry
  //   hor_vel_hip_to_kick1   — hip velocity from entry to first dolphin kick
  //   hor_vel_hip_3kicks     — hip velocity after 3 dolphin kicks
  //   hor_vel_hip_stroke1    — hip velocity after first stroke
  //   hor_vel_hip_stroke2    — hip velocity after second stroke
  //
  // Returns the highest populated value, or null when nothing is
  // captured. Picking the max prevents the misleading "peak at
  // takeoff" claim when the real peak was downstream.
  function peakVelocity(trial) {
    if (!trial) return null;
    const n = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const samples = [
      n(trial.hor_vel_hip_flight),
      n(trial.hor_vel_hands_entry),
      n(trial.hor_vel_hip_to_kick1),
      n(trial.hor_vel_hip_3kicks),
      n(trial.hor_vel_hip_stroke1),
      n(trial.hor_vel_hip_stroke2),
    ].filter(v => v != null);
    return samples.length ? Math.max(...samples) : null;
  }

  function metricItems(trial) {
    if (!trial) return [];
    const n = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const round = (v, d = 2) => v == null ? null : Number(v).toFixed(d);

    // Push Time intentionally omitted from the summary rail — it
    // belongs to the Block phase and lives in the Block tab's detail
    // card. Dropping it lets the remaining 7 KPIs fit a single row on
    // the detail column at common desktop widths.
    //
    // v00.43 adds `tip` strings consumed by MetricTile to render an
    // inline HelpDot beside the eyebrow. Copy is plain English, no
    // jargon — same definitions a coach would use during a session
    // debrief. Spanish parity will land when i18n catches up to the
    // tip strings.
    const items = [
      { k: 'Reaction Time',
        v: round(n(trial.reaction_time_s), 2), u: 's', goodDir: 'down',
        tip: 'Total off-block time: from the start signal to feet leaving the block.' },
      { k: 'Flight Phase',
        v: round(n(trial.flight_phase_s), 3), u: 's', goodDir: 'down',
        tip: 'Time in the air, from feet leaving the block to hip entering the water.' },
      { k: 'Entry Angle',
        v: round(n(trial.angle_hip_entry_deg), 1), u: '°', goodDir: 'down',
        tip: 'Angle of the body at water entry, measured from horizontal. Lower angles read as a flatter, more streamlined entry.' },
      { k: 'Entry Distance',
        v: round(n(trial.distance_to_water_entry), 2), u: 'm', goodDir: 'up',
        tip: 'Horizontal distance from the block edge to where the hip enters the water.' },
      { k: 'Hip @ Takeoff',
        v: round(n(trial.height_hip_takeoff), 2), u: 'm', goodDir: 'up',
        tip: 'Hip height above the water at the moment feet leave the block.' },
      { k: 'Peak Velocity',
        v: round(peakVelocity(trial), 2), u: 'm/s', goodDir: 'up',
        tip: 'Highest horizontal velocity recorded during the start — the max across takeoff, entry, and underwater samples (up to second stroke).' },
      { k: 'Time to 15 m',
        v: round(n(trial.split_15m_s), 2), u: 's', goodDir: 'down',
        tip: 'Total time from start signal to crossing the 15 m mark — the canonical start-quality measurement.' },
    ];
    return items;
  }

  // ── Headline story ────────────────────────────────────────────
  // Surfaces the 15 m time as the headline number. When a compare
  // trial (or benchmark) is provided, appends a verdict and swaps
  // the title color based on whether primary is faster.
  //
  // sign convention here: compare faster/slower is judged against
  // primary at the 15 m split (lower = faster).
  function buildStartStory(primary, compare) {
    if (!primary) return null;
    const n = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const t15    = n(primary.split_15m_s);
    const react  = n(primary.reaction_time_s);
    const flight = n(primary.flight_phase_s);
    const title  = startTitle(primary);
    const date   = startDate(primary);

    // v02.21 — apply the abs time-base correction (subtract start signal)
    // to derive race-relative breakout time, then compute underwater +
    // surface durations for the full phase breakdown in the Hero subtitle.
    const startSig    = n(primary.abs_time_start_signal);
    const breakoutAbs = n(primary.abs_time_surface_break);
    const breakoutRace = (breakoutAbs != null && startSig != null) ? breakoutAbs - startSig : null;

    // Underwater = breakout time − (reaction + flight). Surface = 15m time − breakout.
    // When breakoutRace > t15, the swimmer is still underwater at 15m — we
    // flag this and report differently in the Hero.
    const blockFlightEnd = (react != null && flight != null) ? react + flight : null;
    let underwater = (breakoutRace != null && blockFlightEnd != null && breakoutRace > blockFlightEnd)
      ? breakoutRace - blockFlightEnd
      : null;
    let surfaceSpan = (t15 != null && breakoutRace != null) ? t15 - breakoutRace : null;
    const invertedSurface = (surfaceSpan != null && surfaceSpan < 0);
    if (invertedSurface) {
      // Athlete reached 15 m while still underwater. Fold the negative
      // surface span back into underwater so the math is honest, and
      // suppress the Surface chip below.
      underwater = (underwater != null ? underwater : 0) + (-surfaceSpan);
      surfaceSpan = null;
    }

    const eyebrow = ('STARTS · ' + (title || 'TRIAL') + (date ? ' · ' + date : '')).toUpperCase();

    const bigNum = t15 != null
      ? t15.toFixed(2)
      : (react != null ? react.toFixed(2) : '—');
    // v02.21 — Hero copy refined. "s to 15 m" → "s to the 15 m mark"
    // reads cleaner; the leading "s" is no longer an orphan typography.
    const bigUnit = t15 != null ? 's to the 15 m mark' : react != null ? 's reaction' : '';

    // Resolve compare verdict + tone
    let verdict = null;
    let timeTone = 'var(--signal-eff)';
    let rightChip = null;
    if (compare) {
      const cmp15 = n(compare.split_15m_s);
      if (t15 != null && cmp15 != null) {
        const d = +(t15 - cmp15).toFixed(2);
        const abs = Math.abs(d).toFixed(2);
        const kind = compare._benchmarkKind;
        if (d < 0) {
          timeTone = 'var(--lime-eff)';
          if (kind === 'PB') {
            verdict = 'Personal best by ' + abs + ' s.';
            rightChip = React.createElement('span',
              { className: 'pill lime', style: { fontSize: 11 } }, 'NEW PB');
          } else if (kind === 'MEDIAN') {
            verdict = abs + ' s ahead of your median.';
          } else {
            // Use the slot-role label "compare" instead of the trial's
            // title — two starts of the same event share a title
            // (e.g. both read "Start · 50 · Freestyle"), which made
            // "ahead of Start · 50 · Freestyle" read as nonsense.
            verdict = abs + ' s ahead of compare.';
          }
        } else if (d > 0) {
          timeTone = 'var(--flag-eff)';
          if (kind === 'PB') {
            verdict = abs + ' s off personal best.';
          } else if (kind === 'MEDIAN') {
            verdict = abs + ' s slower than your median.';
          } else {
            verdict = abs + ' s slower than compare.';
          }
        } else {
          verdict = 'Matched compare time.';
        }
      }
    }

    const titleNode = (
      React.createElement(React.Fragment, null,
        React.createElement('span',
          { style: { color: timeTone, fontFamily: 'var(--font-mono)' } }, bigNum),
        React.createElement('span',
          { style: { color: 'var(--tx-md)' } }, ' · '),
        React.createElement('span',
          { style: { color: 'var(--tx-hi)' } }, verdict || bigUnit),
      )
    );

    // v02.21 — Subtitle shows the FULL four-phase breakdown:
    //   Reaction · Flight · Underwater · Surface
    // When the swimmer is still underwater at 15 m (inverted case),
    // we replace the "Surface" chip with "Underwater entire 15 m"
    // so it reads as an achievement, not a missing-data zero.
    const parts = [];
    if (react      != null) parts.push('Reaction ' + react.toFixed(2)      + 's');
    if (flight     != null) parts.push('Flight '   + flight.toFixed(2)     + 's');
    if (underwater != null) parts.push('Underwater ' + underwater.toFixed(2) + 's');
    if (invertedSurface) {
      parts.push('Underwater entire 15 m');
    } else if (surfaceSpan != null) {
      parts.push('Surface ' + surfaceSpan.toFixed(2) + 's');
    }
    let sub = parts.length ? parts.join(' · ') + '.' : null;

    if (compare && window.PA_STARTS_COMPARE) {
      const diff = window.PA_STARTS_COMPARE.diffStarts(primary, compare);
      const summary = window.PA_STARTS_COMPARE.summarize(diff);
      if (summary) {
        const bits = [];
        if (summary.biggestGain) bits.push('Biggest gain: ' + summary.biggestGain.key);
        if (summary.biggestLoss) bits.push('watch: ' + summary.biggestLoss.key);
        if (bits.length) sub = (sub ? sub + ' ' : '') + bits.join(' · ') + '.';
      }
    }

    return { eyebrow, titleNode, sub, rightChip };
  }

  // ── Filter + selection helpers (Option D) ─────────────────────
  // These mirror PA_KPIS.optionsFrom / applyFilters / findByKey so
  // the shared analysis-shell atoms (FilterBar, SelectionSlots,
  // TrialList) can drive the Starts page the same way they drive
  // the Races page.

  function optionsFrom(trials) {
    const distances = new Set();
    const styles    = new Set();
    const courses   = new Set();
    (trials || []).forEach(t => {
      if (t.distance_m) distances.add(Number(t.distance_m));
      if (t.style)      styles.add(String(t.style).toLowerCase());
      if (t.course)     courses.add(String(t.course).toUpperCase());
    });
    return {
      distances: [...distances].sort((a, b) => a - b),
      styles:    [...styles].sort(),
      courses:   [...courses].sort(),
    };
  }

  function applyFilters(trials, f) {
    if (!f) return trials;
    return (trials || []).filter(t => {
      if (f.distance && Number(t.distance_m) !== Number(f.distance)) return false;
      if (f.style    && String(t.style  || '').toLowerCase() !== String(f.style).toLowerCase()) return false;
      if (f.course   && String(t.course || '').toUpperCase() !== String(f.course).toUpperCase()) return false;
      if (f.from && t.source_date && t.source_date < f.from) return false;
      if (f.to   && t.source_date && t.source_date > f.to)   return false;
      return true;
    });
  }

  function findByKey(trials, key) {
    if (!key) return null;
    return (trials || []).find(t => trialKey(t) === key) || null;
  }

  // 15 m time is the closest Starts analogue to Races' race_time.
  // Used by the shared TrialList atom when helpers bundle is supplied.
  function startSplit15(trial) {
    if (!trial || trial.split_15m_s == null) return null;
    const v = parseFloat(trial.split_15m_s);
    return isNaN(v) ? null : v;
  }

  // ── Expose ────────────────────────────────────────────────────
  window.PA_STARTS = {
    listStartTrials,
    trialKey, startTitle, startDate,
    phaseSpans, metricItems, buildStartStory, peakVelocity,
    optionsFrom, applyFilters, findByKey,
    startSplit15,
  };

  try { console.log('[PA_STARTS] loaded (v00.43)'); } catch (_) {}
})();
