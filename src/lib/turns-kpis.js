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

  // ── buildTurnPhaseStory (v03.01) ──────────────────────────────
  // Returns a phase-specific sentence-hero spec for the four Turn
  // tabs (Approach / Wall / Underwater / Breakout), parallel to the
  // PhaseHero pattern Starts uses for Underwater + Surface. Each
  // phase picks one canonical metric to anchor the sentence and a
  // second metric for subtext. Compare mode appends a Δ chip with
  // direction-aware color (lime = better, flag = worse). Returns
  // null when the phase isn't recognized; returns an "unavailable"
  // shape (sentence + null highlight) when the canonical column is
  // missing on the trial, so the UI always renders something.
  function buildTurnPhaseStory(phase, primary, compare) {
    if (!primary || !phase) return null;
    const n = (t, c) => {
      if (!t) return null;
      const v = t[c];
      return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
    };

    const cmpLabel = compare
      ? (compare._benchmarkKind === 'PB'     ? 'PB'
       : compare._benchmarkKind === 'MEDIAN' ? 'MEDIAN'
                                              : 'compare')
      : null;

    // Δ chip helper — mirrors web-starts.jsx buildDeltaChip logic.
    const buildDelta = (a, b, dir, unit) => {
      if (a == null || b == null) return { delta: null, color: null };
      const raw = +(a - b).toFixed(2);
      if (raw === 0) {
        return { delta: '±0 ' + unit + ' vs ' + cmpLabel, color: null };
      }
      const sign = raw > 0 ? '+' : '';
      const tone = (dir === 'lower')
        ? (raw < 0 ? 'lime' : 'flag')
        : (raw > 0 ? 'lime' : 'flag');
      return {
        delta: sign + raw.toFixed(2) + ' ' + unit + ' vs ' + cmpLabel,
        color: tone,
      };
    };

    if (phase === 'Approach') {
      const v50   = n(primary, 'avg_vel_5_0_pre');
      const v1510 = n(primary, 'avg_vel_15_10_pre');
      if (v50 == null) {
        return {
          sentence: 'Approach velocity unavailable for this trial.',
          highlight: null,
          subtext: 'Needs the 5-0 m pre-wall velocity column.',
          delta: null, deltaColor: null,
        };
      }
      const chip = buildDelta(v50, compare ? n(compare, 'avg_vel_5_0_pre') : null, 'higher', 'm/s');
      const highlight = v50.toFixed(2) + ' m/s';
      let subtext = 'Average velocity through the last 5 m before the wall.';
      if (v1510 != null) {
        const carry = +(v50 - v1510).toFixed(2);
        if (Math.abs(carry) < 0.03) {
          subtext = 'Held speed steady from 15 m out into the wall.';
        } else if (carry > 0) {
          subtext = 'Accelerated ' + carry.toFixed(2) + ' m/s from the 15-10 m zone into the wall.';
        } else {
          subtext = 'Lost ' + Math.abs(carry).toFixed(2) + ' m/s from 15 m out to the wall.';
        }
      }
      return {
        sentence: 'Carried ' + highlight + ' through the last 5 m before the wall.',
        highlight, subtext,
        delta: chip.delta, deltaColor: chip.color,
      };
    }

    if (phase === 'Wall') {
      // v03.01 — Reframed around PUSH-OFF GAIN: the velocity
      // difference between the 5 m before wall (avg_vel_5_0_pre)
      // and the 5 m after wall (avg_vel_0_5). This is the same
      // metric the TurnFullVelocityProfile chart already calls
      // "PUSH-OFF GAIN" — keeping hero + chart + table on the
      // same story. Positive value means push-off added speed
      // beyond what was carried in; negative means contact + drag
      // ate the boost. Replaces the earlier push_off_velocity
      // hero (column not populated by the Templo importer).
      const preVel  = n(primary, 'avg_vel_5_0_pre');
      const postVel = n(primary, 'avg_vel_0_5');
      if (preVel == null || postVel == null) {
        return {
          sentence: 'Push-off gain unavailable for this trial.',
          highlight: null,
          subtext: 'Needs both avg_vel_5_0_pre and avg_vel_0_5.',
          delta: null, deltaColor: null,
        };
      }
      const gain = +(postVel - preVel).toFixed(2);
      const gainPct = preVel > 0 ? Math.round((gain / preVel) * 100) : null;

      // Compare's push-off gain — for the Δ chip.
      let cmpGain = null;
      if (compare) {
        const cPre  = n(compare, 'avg_vel_5_0_pre');
        const cPost = n(compare, 'avg_vel_0_5');
        if (cPre != null && cPost != null) cmpGain = +(cPost - cPre).toFixed(2);
      }
      const chip = buildDelta(gain, cmpGain, 'higher', 'm/s');

      let sentence, highlight;
      if (gain > 0) {
        highlight = '+' + gain.toFixed(2) + ' m/s';
        sentence = 'Push-off gained ' + highlight
                 + (gainPct != null ? ' — a ' + gainPct + '% boost over your approach.' : '.');
      } else if (gain < 0) {
        highlight = gain.toFixed(2) + ' m/s';
        sentence = 'Push-off lost ' + highlight
                 + (gainPct != null ? ' — a ' + Math.abs(gainPct) + '% drop from your approach.' : '.');
      } else {
        highlight = '±0 m/s';
        sentence = 'Push-off matched your approach speed exactly.';
      }
      const subtext = 'From ' + preVel.toFixed(2) + ' m/s in to '
                    + postVel.toFixed(2) + ' m/s out across the wall.';
      return {
        sentence, highlight, subtext,
        delta: chip.delta, deltaColor: chip.color,
      };
    }

    if (phase === 'Underwater') {
      const kick = n(primary, 'kick_rate');
      const sbr  = n(primary, 'surface_break_s');
      if (kick == null && sbr == null) {
        return {
          sentence: 'Underwater metrics unavailable for this trial.',
          highlight: null,
          subtext: 'Needs kick_rate or surface_break_s.',
          delta: null, deltaColor: null,
        };
      }
      if (kick != null) {
        const chip = buildDelta(kick, compare ? n(compare, 'kick_rate') : null, 'higher', '/min');
        const highlight = kick.toFixed(1) + '/min';
        const subtext = sbr != null
          ? sbr.toFixed(2) + ' s from push-off to surface break.'
          : 'Kicks per minute between push-off and surface break.';
        return {
          sentence: 'Held ' + highlight + ' kick rate through the underwater.',
          highlight, subtext,
          delta: chip.delta, deltaColor: chip.color,
        };
      }
      // Fallback — surface break only. Neutral framing (long UW can
      // be a strength for strong kickers), so no delta color.
      const highlight = sbr.toFixed(2) + ' s';
      return {
        sentence: 'Stayed underwater ' + highlight + ' from push-off to surface break.',
        highlight,
        subtext: 'Time the body remained submerged after push-off.',
        delta: null, deltaColor: null,
      };
    }

    if (phase === 'Breakout') {
      const t515 = n(primary, 'time_5in_15out_s');
      const sr   = n(primary, 'stroke_rate_post_turn');
      if (t515 == null) {
        return {
          sentence: 'Breakout time unavailable for this trial.',
          highlight: null,
          subtext: 'Needs time_5in_15out_s.',
          delta: null, deltaColor: null,
        };
      }
      const chip = buildDelta(t515, compare ? n(compare, 'time_5in_15out_s') : null, 'lower', 's');
      const highlight = t515.toFixed(2) + ' s';
      const subtext = sr != null
        ? 'Re-engaged at ' + sr.toFixed(1) + ' strokes/min after breakout.'
        : 'Time from 5 m before the wall to 15 m past it.';
      return {
        sentence: 'Covered 5 m in / 15 m out in ' + highlight + '.',
        highlight, subtext,
        delta: chip.delta, deltaColor: chip.color,
      };
    }

    return null;
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
    phaseSpans, metricItems, buildTurnStory, buildTurnPhaseStory,
    optionsFrom, applyFilters, findByKey,
    turn15in15out,
  };

  try { console.log('[PA_TURNS] loaded (v03.01)'); } catch (_) {}
})();
