/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Turns KPIs — thin read-layer over v_turn_kpis (v00.51)

   Mirrors src/lib/starts-kpis.js. Exposes window.PA_TURNS:
     listTurnTrials(athleteUuid, opts)  — RLS-filtered read
     trialKey(trial)                    — stable selection key
     turnTitle(trial), turnDate(trial)  — display helpers
     phaseSpans(trial)                  — Approach / Wall / Underwater / Breakout
     metricItems(trial)                 — prebuilt MetricGrid payload
     buildTurnStory(primary, compare)   — Headline props
     optionsFrom / applyFilters / findByKey — selection helpers
     turn15in15out(trial)               — sortable canonical turn time

   Phase 2: READ-ONLY. Single-trial view; compare logic in
   turns-compare.js. No writes, no edge functions.
   ─────────────────────────────────────────────────────────── */

(function () {
  const client = window.supabaseClient;

  // ── Query: listTurnTrials ────────────────────────────────────
  async function listTurnTrials(athleteUuid, opts) {
    const limit = (opts && opts.limit) || 200;
    if (!athleteUuid) return { data: [], error: null };
    try {
      // v01.68 — wrapped in withRecovery() to auto-recover from
      // stuck supabase client state. Falls back to direct call if
      // PA_AUTH not yet loaded.
      const exec = () => client
        .from('v_turn_kpis')
        .select('*')
        .eq('athlete_uuid', athleteUuid)
        .order('source_date', { ascending: false })
        .limit(limit);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'v_turn_kpis listTurnTrials' })
        : await exec();
      if (error) return { data: [], error };
      return { data: enrich(data || []), error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Attach mj alias so downstream consumers match the race/start
  // pattern. Not every column lives in metrics_json but symmetry
  // matters for shared atom code paths.
  function enrich(rows) {
    return rows.map(r => Object.assign({}, r, {
      mj: r.metrics_json || {},
    }));
  }

  // ── Keys & labels ─────────────────────────────────────────────

  function trialKey(trial) {
    if (!trial) return null;
    if (trial.turn_uuid) return 't:' + trial.turn_uuid;
    return 'f:' + [
      trial.athlete_uuid || '',
      trial.source_date  || '',
      trial.source_file  || '',
      trial.time_15in_15out_s != null
        ? Number(trial.time_15in_15out_s).toFixed(3) : '',
    ].join('|');
  }

  // "Turn · 200 Freestyle" or "Turn" if event missing
  function turnTitle(trial) {
    if (!trial) return '';
    const style = trial.style || trial.mj?.Style || trial.mj?.style;
    const dist  = trial.distance_m || trial.mj?.Distance;
    const parts = ['Turn'];
    if (dist)  parts.push(dist + 'm');
    if (style) parts.push(style.charAt(0).toUpperCase() + style.slice(1));
    return parts.join(' · ');
  }

  function turnDate(trial) {
    if (!trial || !trial.source_date) return '';
    const d = new Date(trial.source_date + 'T00:00:00');
    if (isNaN(d.getTime())) return trial.source_date;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  // ── Phase derivation (Approach / Wall / Underwater / Breakout) ─
  // Turns don't have a clean "absolute time" axis like Starts (the
  // turn happens in a moving athlete, not stationary on a block),
  // so the phase weights are conceptual segment lengths rather
  // than measured durations:
  //
  //   Approach   — last 5 m before wall (always 5 m by definition)
  //   Wall       — plant → push-off (instantaneous in time but a
  //                 distinct phase semantically)
  //   Underwater — push-off → first stroke / surface break
  //   Breakout   — first stroke → 15 m out
  //
  // Width weights stay constant across trials so the timeline is
  // a stable reference. Future: derive widths from actual durations
  // when push_off_velocity + surface_break_s + breakout_to_15
  // columns are all populated.
  function phaseSpans(trial) {
    return [
      { label: 'LAST 5M IN',  name: 'Approach',   range: 'Entry → wall',     weight: 1.5 },
      { label: 'AT WALL',     name: 'Wall',       range: 'Plant → push-off', weight: 0.8 },
      { label: 'FIRST 5M OUT', name: 'Underwater', range: 'Push → breakout', weight: 1.5 },
      { label: '5M – 15M',    name: 'Breakout',   range: 'Resume stroke',    weight: 1.4 },
    ];
  }

  // ── MetricGrid payload ────────────────────────────────────────
  // 5 summary tiles for the Turns rail. Picked to mirror what live
  // and the design reference both surface as the canonical turn
  // KPIs:
  //   15-in / 15-out  — full turn quality (canonical)
  //   5-in / 5-out    — tight wall window
  //   Push-off vel    — explosive energy off the wall
  //   Kick rate       — underwater rhythm
  //   Surface break   — time to first stroke
  //
  // tip strings drive the v00.43 inline HelpDot pattern.
  function metricItems(trial) {
    if (!trial) return [];
    const n = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const round = (v, d = 2) => v == null ? null : Number(v).toFixed(d);

    return [
      { k: '15-in / 15-out',
        v: round(n(trial.time_15in_15out_s), 2), u: 's', goodDir: 'down',
        tip: 'Time from 15 m before the wall to 15 m after — the canonical turn-quality measurement.' },
      { k: '5-in / 5-out',
        v: round(n(trial.time_5in_5out_s), 2), u: 's', goodDir: 'down',
        tip: 'Tighter wall window — 5 m before to 5 m after. Isolates the plant + push-off itself from the swim into and out.' },
      { k: 'Push-off Velocity',
        v: round(n(trial.push_off_velocity), 2), u: 'm/s', goodDir: 'up',
        tip: 'Velocity at the moment feet leave the wall. Higher = more explosive push.' },
      { k: 'Kick Rate',
        v: round(n(trial.kick_rate), 1), u: '/min', goodDir: 'up',
        tip: 'Underwater dolphin / flutter kicks per minute after push-off.' },
      { k: 'Surface Break',
        v: round(n(trial.surface_break_s), 2), u: 's', goodDir: 'down',
        tip: 'Time from push-off to head breaking the water surface. Lower = quicker breakout.' },
    ];
  }

  // ── Headline story ────────────────────────────────────────────
  // Hero number: 15-in/15-out time. In compare mode, append a
  // verdict ("0.18 s ahead of compare", "0.05 s off your median",
  // etc.) and tint the time accordingly.
  function buildTurnStory(primary, compare) {
    if (!primary) return null;
    const n = (x) => (x == null || isNaN(parseFloat(x))) ? null : parseFloat(x);
    const t1515  = n(primary.time_15in_15out_s);
    const pushV  = n(primary.push_off_velocity);
    const kick   = n(primary.kick_rate);
    const title  = turnTitle(primary);
    const date   = turnDate(primary);

    const eyebrow = ('TURNS · ' + (title || 'TRIAL') + (date ? ' · ' + date : '')).toUpperCase();

    const bigNum = t1515 != null
      ? t1515.toFixed(2)
      : (pushV != null ? pushV.toFixed(2) : '—');
    const bigUnit = t1515 != null ? 's · 15 in / 15 out'
                  : pushV != null ? 'm/s push-off'
                  : '';

    let verdict   = null;
    let timeTone  = 'var(--signal-eff)';
    let rightChip = null;

    if (compare) {
      const cmp1515 = n(compare.time_15in_15out_s);
      if (t1515 != null && cmp1515 != null) {
        const d = +(t1515 - cmp1515).toFixed(2);
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

    // Subtitle — push-off + kick context, plus compare summary
    // when available.
    const parts = [];
    if (pushV != null) parts.push('Push-off ' + pushV.toFixed(2) + ' m/s');
    if (kick  != null) parts.push('Kick rate ' + kick.toFixed(1) + '/min');
    let sub = parts.length ? parts.join(' · ') + '.' : null;

    if (compare && window.PA_TURNS_COMPARE) {
      const diff = window.PA_TURNS_COMPARE.diffTurns(primary, compare);
      const summary = window.PA_TURNS_COMPARE.summarize(diff);
      if (summary) {
        const bits = [];
        if (summary.biggestGain) bits.push('Biggest gain: ' + summary.biggestGain.key);
        if (summary.biggestLoss) bits.push('watch: ' + summary.biggestLoss.key);
        if (bits.length) sub = (sub ? sub + ' ' : '') + bits.join(' · ') + '.';
      }
    }

    return { eyebrow, titleNode, sub, rightChip };
  }

  // ── Filter + selection helpers ────────────────────────────────

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

  // 15-in/15-out is the canonical turn time for sorting / PB
  // selection. Used by the shared TrialList helpers bundle.
  function turn15in15out(trial) {
    if (!trial || trial.time_15in_15out_s == null) return null;
    const v = parseFloat(trial.time_15in_15out_s);
    return isNaN(v) ? null : v;
  }

  // ── Expose ────────────────────────────────────────────────────
  window.PA_TURNS = {
    listTurnTrials,
    trialKey, turnTitle, turnDate,
    phaseSpans, metricItems, buildTurnStory,
    optionsFrom, applyFilters, findByKey,
    turn15in15out,
  };

  try { console.log('[PA_TURNS] loaded (v00.51)'); } catch (_) {}
})();
