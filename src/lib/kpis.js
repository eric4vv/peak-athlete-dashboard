/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   KPI read layer — v_race_trials (READ-ONLY)

   Ports the live dashboard's race data surface:
   - Query:  v_race_trials · RLS-filtered by athlete_uuid
   - Dedup:  race_uuid first, fingerprint fallback
             (mirrors live index.html:15655-15692)
   - Splits: metrics_json keys "Split N m", starting at 25 m
             with 5 m fallback (live:16120-16134)
   - Stroke rate: "Stroke rate N m" every 5 m (live:16136-16140)
   - Stroke count: "Stroke count lap N" (live:16142-16146)
   - Race time: last populated split value — NEVER Runtime,
                which is video length (live:16148-16152)

   Exposed on window.PA_KPIS.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const client = window.supabaseClient;

  // ── SCY unit fix (v03.66) ────────────────────────────────────
  // Templo labels split columns "Split 25 m" / "Split 50 m" / etc.
  // for ALL course types — including SCY. For an SCY race the
  // labeled "25 m" is actually 25 yards = 22.86 m. Treating it as
  // 25 m makes every velocity / DPS calc overstate by 1/0.9144
  // (~+9.36%) for SCY races.
  //
  // FIX: convert labeled distance → true meters via this helper
  // anywhere downstream math depends on real distance (velocity,
  // DPS, segment density). Display labels intentionally still
  // show the labeled value (e.g., "25m") so visualizations match
  // Templo's column headers — a follow-up "Option B" pass will
  // upgrade display labels to course-aware units.
  const YD_TO_M = 0.9144;
  function actualMeters(labeled, course) {
    const c = String(course || '').toUpperCase();
    return c === 'SCY' ? labeled * YD_TO_M : labeled;
  }

  function courseOf(trial) {
    if (!trial) return null;
    const mj = trial.mj || trial.metrics_json || {};
    return trial.course || mj.Course || mj.course || null;
  }

  // ── Extractors ────────────────────────────────────────────────
  // Pure, no Supabase. Accept metrics_json blob, return sorted arrays.

  function extractSplits(mj, interval) {
    interval = interval || 25;
    if (!mj) return [];
    const splits = [];
    for (let d = interval; d <= 1500; d += interval) {
      const v = mj['Split ' + d + ' m'];
      if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))) {
        splits.push({ distance: d, cumTime: parseFloat(v) });
      }
    }
    // Fallback: 5 m cadence (some Templo files land this way)
    if (!splits.length) {
      for (let d = 5; d <= 1500; d += 5) {
        const v = mj['Split ' + d + ' m'];
        if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v))) {
          splits.push({ distance: d, cumTime: parseFloat(v) });
        }
      }
    }
    return splits;
  }

  function extractStrokeRates(mj) {
    if (!mj) return [];
    const out = [];
    for (let d = 5; d <= 1500; d += 5) {
      const v = mj['Stroke rate ' + d + ' m'];
      if (v && !isNaN(parseFloat(v)) && parseFloat(v) > 0) {
        out.push({ distance: d, rate: parseFloat(v) });
      }
    }
    return out;
  }

  function extractStrokeCounts(mj) {
    if (!mj) return [];
    const out = [];
    for (let l = 1; l <= 60; l++) {
      const v = mj['Stroke count lap ' + l];
      if (v && parseInt(v, 10) > 0) out.push({ lap: l, count: parseInt(v, 10) });
    }
    return out;
  }

  // Race time = last populated split. Runtime column is video length.
  function raceTotalTime(trial) {
    const sp = extractSplits(trial?.mj || trial?.metrics_json);
    return sp.length ? sp[sp.length - 1].cumTime : null;
  }

  // Derived segment list: "0-25m", "25-50m", etc. with segment times
  function splitsToSegments(splits, unit) {
    unit = unit || 'm';
    return splits.map((s, i) => {
      const prev = i > 0 ? splits[i - 1] : { distance: 0, cumTime: 0 };
      return {
        label:   prev.distance + '-' + s.distance + unit,
        segTime: parseFloat((s.cumTime - prev.cumTime).toFixed(2)),
        cumTime: s.cumTime,
        distStart: prev.distance,
        distEnd:   s.distance,
      };
    });
  }

  // Compact human title: "100 Freestyle · LCM" (+ event if present)
  function raceTitle(trial) {
    if (!trial) return '';
    const mj = trial.mj || trial.metrics_json || {};
    const distance = trial.distance_m || mj.Distance || mj.distance;
    const style    = trial.style      || mj.Style    || mj.style;
    const course   = trial.course     || mj.Course   || mj.course;
    const eventName = trial.event_name || mj['Event name'];

    const event = (distance ? distance + ' ' : '')
      + (style ? String(style).charAt(0).toUpperCase() + String(style).slice(1) : '');
    const parts = [];
    if (event.trim()) parts.push(event.trim());
    if (course)       parts.push(course);
    let line = parts.join(' · ');
    if (eventName) line += (line ? ' — ' : '') + eventName;
    return line || 'Race trial';
  }

  // Stable, human-readable date "Apr 14, 2026" — never logs PII.
  function raceDate(trial) {
    if (!trial?.source_date) return '';
    const d = new Date(trial.source_date);
    if (isNaN(d)) return String(trial.source_date);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ── fmtTime (v00.54) ────────────────────────────────────────
  // Display-format a time in seconds.
  //   < 60 s        → "23.45 s"
  //   60–3599 s     → "1:23.45"        (M:SS.dd, no unit)
  //   ≥ 3600 s      → "1:23:45.67"     (H:MM:SS.dd, no unit)
  //
  // Eric's v00.54 ask: anything over 59.99 s should display in
  // minute format. A 200 free at 1:54.32 should never read as
  // "114.32 s." Used in race summary tiles, lap-bar inline labels,
  // RaceCompareBars segments, aggregated bucket labels, etc.
  //
  // Returns "—" for null / NaN inputs.
  function fmtTime(s, dec) {
    if (s == null || isNaN(parseFloat(s))) return '—';
    const sec = parseFloat(s);
    const d = (dec != null) ? dec : 2;
    if (sec < 60) return sec.toFixed(d) + ' s';
    const totalMin = Math.floor(sec / 60);
    const remSec   = sec - totalMin * 60;
    const padLen   = d > 0 ? d + 3 : 2;
    const secStr   = remSec.toFixed(d).padStart(padLen, '0');
    if (totalMin < 60) return totalMin + ':' + secStr;
    const hr     = Math.floor(totalMin / 60);
    const minRem = totalMin - hr * 60;
    return hr + ':' + String(minRem).padStart(2, '0') + ':' + secStr;
  }

  // Average stroke rate across populated 5m buckets (null if none)
  function avgStrokeRate(trial) {
    const rates = extractStrokeRates(trial?.mj || trial?.metrics_json);
    if (!rates.length) return null;
    const sum = rates.reduce((acc, r) => acc + r.rate, 0);
    return sum / rates.length;
  }

  // ── DPS / velocity / total-strokes helpers (v00.45) ───────────
  // DPS = distance per stroke. The natural granularity is per-lap
  // because v_race_trials only carries stroke counts per lap (not
  // per 5m). We derive lap distance from the race distance and the
  // number of laps that have a populated stroke count — robust to
  // partial captures (e.g. a 200 with only 3 of 4 laps captured
  // still gets DPS for the captured laps).
  //
  // Returns: [{ lap, count, dps, lapStart, lapEnd, distMid }]
  function extractDPS(trial) {
    if (!trial) return [];
    const mj    = trial.mj || trial.metrics_json || {};
    const counts = extractStrokeCounts(mj);
    if (!counts.length) return [];
    const labeled = parseFloat(trial.distance_m || mj.Distance || mj.distance);
    if (!labeled || isNaN(labeled)) return [];
    // v03.66 — SCY fix: convert labeled total to true meters.
    const totalDist = actualMeters(labeled, courseOf(trial));
    // numLaps is what was captured, not what the race truly has.
    // For DPS we want per-lap distance to reflect real lap lengths,
    // so use the highest captured lap index as numLaps.
    const numLaps = Math.max(...counts.map(c => c.lap));
    if (numLaps <= 0) return [];
    const lapDist = totalDist / numLaps;
    return counts.map(c => {
      const lapStart = (c.lap - 1) * lapDist;
      const lapEnd   = c.lap * lapDist;
      return {
        lap: c.lap,
        count: c.count,
        dps: c.count > 0 ? +(lapDist / c.count).toFixed(3) : null,
        lapStart, lapEnd,
        distMid: lapStart + lapDist / 2,
      };
    });
  }

  // Average DPS = total race distance / total strokes counted across
  // all captured laps. Captures only — partial laps don't inflate
  // the denominator.
  function avgDPS(trial) {
    const rows = extractDPS(trial);
    if (!rows.length) return null;
    const validCounts = rows.filter(r => r.count > 0);
    if (!validCounts.length) return null;
    const totalCount = validCounts.reduce((s, r) => s + r.count, 0);
    if (!totalCount) return null;
    // Sum of lap distances among captured laps.
    const lapDist = rows[0].lapEnd - rows[0].lapStart;
    const totalDist = lapDist * validCounts.length;
    return totalDist / totalCount;
  }

  // Average velocity = race distance / race time. Honest enough for
  // a summary tile; per-segment velocity remains in the chart.
  function avgVelocity(trial) {
    if (!trial) return null;
    const labeled = parseFloat(trial.distance_m
      || trial.mj?.Distance || trial.metrics_json?.Distance);
    const t = raceTotalTime(trial);
    if (!labeled || !t || t <= 0) return null;
    // v03.66 — SCY fix: convert labeled distance to true meters.
    const totalDist = actualMeters(labeled, courseOf(trial));
    return totalDist / t;
  }

  // Total strokes — sum across captured laps.
  function totalStrokes(trial) {
    const counts = extractStrokeCounts(trial?.mj || trial?.metrics_json);
    if (!counts.length) return null;
    return counts.reduce((s, c) => s + c.count, 0);
  }

  // ── Query: listRaceTrials ─────────────────────────────────────
  // RLS scopes v_race_trials to the athlete. We still pass an
  // explicit athlete_uuid .eq() — belt-and-suspenders per prototype
  // security rule #3 (no wildcards without eq).

  async function listRaceTrials(athleteUuid, opts) {
    const limit = (opts && opts.limit) || 200;
    if (!athleteUuid) return { data: [], error: null };
    try {
      // v01.68 — wrapped in withRecovery() to auto-recover from
      // stuck supabase client state. Falls back to direct call if
      // PA_AUTH not yet loaded.
      const exec = () => client
        .from('v_race_trials')
        .select('*')
        .eq('athlete_uuid', athleteUuid)
        .order('source_date', { ascending: false })
        .limit(limit);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'v_race_trials listRaceTrials' })
        : await exec();
      if (error) return { data: [], error };
      return { data: dedupe(data || []), error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Dedup strategy mirrors live:15655-15692
  //   L1 race_uuid → exact row identity
  //   L2 fingerprint → athlete|date|distance|style|time|source_file|session
  function dedupe(rows) {
    const seen = new Set();
    const out = [];
    rows.forEach(r => {
      const mj = r.metrics_json || {};
      // v03.07 — normalize event fields onto the row. v_race_trials
      // keeps Distance / Style / Course only inside metrics_json
      // (confirmed against the live dashboard's dedup). optionsFrom()
      // and applyFilters() read top-level t.distance_m / t.style, so
      // without this fold-up the FilterBar distance + stroke chips
      // never populate — selecting anything but "All" is impossible.
      const enriched = Object.assign({}, r, {
        mj,
        distance_m: r.distance_m != null ? r.distance_m
                  : (mj.Distance != null ? mj.Distance
                   : (mj.distance != null ? mj.distance : null)),
        style:  r.style  || mj.Style  || mj.style  || null,
        course: r.course || mj.Course || mj.course || null,
      });

      if (r.race_uuid) {
        const k = 'r:' + r.race_uuid;
        if (seen.has(k)) return;
        seen.add(k);
        out.push(enriched);
        return;
      }

      const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const dist  = norm(mj.Distance || mj.distance || r.distance_m);
      const style = norm(mj.Style    || mj.style    || r.style);
      const t     = raceTotalTime(enriched);
      const src   = norm(r.source_file || '');
      const key = [
        r.athlete_uuid || '',
        r.source_date  || '',
        dist,
        style,
        t != null ? t.toFixed(2) : '',
        src,
        r.session_uuid || '',
      ].join('|');

      const fk = 'f:' + key;
      if (!seen.has(fk)) { seen.add(fk); out.push(enriched); }
    });
    // v03.07 — explicit newest-first sort. The DB query already
    // orders by source_date desc, but dedupe iteration + same-day
    // ties can scramble it; sort here so the trial list is reliably
    // most-recent-first. source_date is 'YYYY-MM-DD' so a lexical
    // compare is chronological.
    out.sort((a, b) =>
      String(b.source_date || '').localeCompare(String(a.source_date || '')));
    return out;
  }

  // Filter helpers — pure, operate on the deduped list.
  // distance: number, style: string lowercase, course: 'LCM'|'SCM'|'SCY'
  function applyFilters(trials, f) {
    if (!f) return trials;
    return trials.filter(t => {
      if (f.distance && Number(t.distance_m) !== Number(f.distance)) return false;
      if (f.style && String(t.style || '').toLowerCase() !== String(f.style).toLowerCase()) return false;
      if (f.course && String(t.course || '').toUpperCase() !== String(f.course).toUpperCase()) return false;
      if (f.from && t.source_date && t.source_date < f.from) return false;
      if (f.to   && t.source_date && t.source_date > f.to)   return false;
      return true;
    });
  }

  // Unique sorted options for FilterBar chips
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

  // Trial identity key (for selection slots).
  // Prefer race_uuid; fall back to a composite so slot state survives.
  function trialKey(t) {
    if (!t) return null;
    if (t.race_uuid) return 'r:' + t.race_uuid;
    return 'f:' + [
      t.athlete_uuid || '',
      t.source_date  || '',
      t.distance_m   || '',
      (t.style || '').toLowerCase(),
      raceTotalTime(t) ?? '',
      t.source_file  || '',
    ].join('|');
  }

  function findByKey(trials, key) {
    if (!key) return null;
    return (trials || []).find(t => trialKey(t) === key) || null;
  }

  // ── Expose ────────────────────────────────────────────────────
  window.PA_KPIS = {
    // query
    listRaceTrials,
    // extractors
    extractSplits, extractStrokeRates, extractStrokeCounts, extractDPS, splitsToSegments,
    // derived
    raceTotalTime, raceTitle, raceDate,
    avgStrokeRate, avgDPS, avgVelocity, totalStrokes,
    fmtTime,
    // v03.66 — SCY unit helpers
    actualMeters, courseOf,
    // filters / selection
    applyFilters, optionsFrom, trialKey, findByKey,
  };

  try { console.log('[PA_KPIS] loaded (v00.54)'); } catch (_) {}
})();
