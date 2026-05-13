/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Analytics — pure data helpers

   No Supabase. No React. No DOM. Just math on rows of
   { date, value } and friends. Consumed by the story engine,
   The Deck, and the analysis pages.

   Exposed as window.PA_ANALYTICS.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Time helpers ─────────────────────────────────────────────

  // "1:23.45" or "54.32" or "54.32s" → seconds (Number)
  // Returns null on unparseable input.
  function parseTime(str) {
    if (str == null) return null;
    if (typeof str === 'number') return Number.isFinite(str) ? str : null;
    const s = String(str).trim().replace(/s$/i, '');
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2) return null;
      const m = Number(parts[0]);
      const sec = Number(parts[1]);
      if (!Number.isFinite(m) || !Number.isFinite(sec)) return null;
      return m * 60 + sec;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // 83.42 → "1:23.42"  ·  54.32 → "54.32"
  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '—';
    const sign = sec < 0 ? '-' : '';
    const abs = Math.abs(sec);
    if (abs >= 60) {
      const m = Math.floor(abs / 60);
      const s = abs - m * 60;
      return sign + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    }
    return sign + abs.toFixed(2);
  }

  function daysAgo(iso) {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const now = Date.now();
    return Math.floor((now - then) / 86400000);
  }

  // ── Series math ──────────────────────────────────────────────
  // Rows are { date: ISO string, value: number, ...anything else }.

  function sortByDate(rows) {
    return (rows || []).slice().sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return da - db;
    });
  }

  function lastN(rows, n) {
    const s = sortByDate(rows);
    return n >= s.length ? s : s.slice(s.length - n);
  }

  function withinDays(rows, n) {
    if (!Number.isFinite(n)) return sortByDate(rows);
    const cutoff = Date.now() - n * 86400000;
    return sortByDate(rows).filter(r => new Date(r.date).getTime() >= cutoff);
  }

  function rollingAvg(rows, n) {
    const s = sortByDate(rows);
    const out = [];
    let sum = 0;
    const buf = [];
    for (const r of s) {
      buf.push(r.value);
      sum += r.value;
      if (buf.length > n) sum -= buf.shift();
      out.push(Object.assign({}, r, { value: sum / buf.length }));
    }
    return out;
  }

  function minValue(rows) {
    const s = rows || [];
    if (!s.length) return null;
    let best = s[0];
    for (const r of s) if (r.value < best.value) best = r;
    return { value: best.value, row: best };
  }

  function maxValue(rows) {
    const s = rows || [];
    if (!s.length) return null;
    let best = s[0];
    for (const r of s) if (r.value > best.value) best = r;
    return { value: best.value, row: best };
  }

  function median(values) {
    const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function mean(values) {
    const v = (values || []).filter(Number.isFinite);
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  // Sample standard deviation (n-1 in denominator). Null if < 2 values.
  function stdDev(values) {
    const v = (values || []).filter(Number.isFinite);
    if (v.length < 2) return null;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sq = v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1);
    return Math.sqrt(sq);
  }

  // z-score of `value` against a sample. Null if < 2 samples or zero spread.
  function zScore(value, sampleValues) {
    const v = (sampleValues || []).filter(Number.isFinite);
    if (v.length < 2) return null;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = stdDev(v);
    if (!sd || sd === 0) return null;
    return (value - m) / sd;
  }

  // Classify a raw z into plain-English buckets, aware of metric goodness.
  // Returns { isBetter, bucket }.
  //   buckets for improvement (in order of magnitude):
  //     'above' (1.0–1.5σ), 'ahead' (1.5–2.0σ), 'standout' (>=2.0σ)
  //   buckets for regression:
  //     'touch' (-1.0 to -1.5σ), 'behind' (-1.5 to -2.0σ), 'off' (<=-2.0σ)
  //   'flat' means within ±1σ — no significant story.
  function zPhrase(z, metric) {
    if (!Number.isFinite(z)) return { isBetter: false, bucket: 'flat' };
    const goodDir = metricMeta(metric).goodDir;
    // Normalize so positive = better regardless of metric.
    const eff = goodDir === 'down' ? -z : z;
    if (eff >=  2.0) return { isBetter: true,  bucket: 'standout' };
    if (eff >=  1.5) return { isBetter: true,  bucket: 'ahead'    };
    if (eff >=  1.0) return { isBetter: true,  bucket: 'above'    };
    if (eff <= -2.0) return { isBetter: false, bucket: 'off'      };
    if (eff <= -1.5) return { isBetter: false, bucket: 'behind'   };
    if (eff <= -1.0) return { isBetter: false, bucket: 'touch'    };
    return { isBetter: eff > 0, bucket: 'flat' };
  }

  // ── Deltas ───────────────────────────────────────────────────

  function delta(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
      return { abs: null, pct: null, dir: 'flat' };
    }
    const abs = a - b;
    const pct = (abs / Math.abs(b)) * 100;
    const dir = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
    return { abs, pct, dir };
  }

  // Compare the latest row to the median of the prior window.
  // Returns { latest, baseline, delta, sampleSize }.
  function deltaVsWindow(rows, opts) {
    const windowDays = (opts && opts.windowDays) || 30;
    const s = sortByDate(rows);
    if (!s.length) return null;
    const latest = s[s.length - 1];
    const cutoff = new Date(latest.date).getTime() - windowDays * 86400000;
    const prior = s.slice(0, -1).filter(r => new Date(r.date).getTime() >= cutoff);
    if (!prior.length) {
      return { latest, baseline: null, delta: { abs: null, pct: null, dir: 'flat' }, sampleSize: 0 };
    }
    const baseline = median(prior.map(r => r.value));
    return { latest, baseline, delta: delta(latest.value, baseline), sampleSize: prior.length };
  }

  // ── Metric registry ──────────────────────────────────────────

  const METRICS = {
    race_time:      { goodDir: 'down', unit: 's',   fmt: 'time' },
    reaction_time:  { goodDir: 'down', unit: 's',   fmt: 'num'  },
    underwater_vel: { goodDir: 'up',   unit: 'm/s', fmt: 'num'  },
    turn_time:      { goodDir: 'down', unit: 's',   fmt: 'time' },
    stroke_rate:    { goodDir: 'up',   unit: 'spm', fmt: 'num'  },
    stroke_count:   { goodDir: 'down', unit: '',    fmt: 'num'  },
    split:          { goodDir: 'down', unit: 's',   fmt: 'time' },
    velocity:       { goodDir: 'up',   unit: 'm/s', fmt: 'num'  },
    rank:           { goodDir: 'down', unit: '',    fmt: 'num'  }, // lower rank number = better
  };

  function metricMeta(metric) {
    return METRICS[metric] || { goodDir: 'down', unit: '', fmt: 'num' };
  }

  // Given a metric name and a delta direction, is it an improvement?
  function isImprovement(metric, d) {
    if (!d || d.dir === 'flat') return false;
    return d.dir === metricMeta(metric).goodDir;
  }

  // ── PB detection ─────────────────────────────────────────────

  // Returns rows that were a new best at the moment they happened.
  // Respects metric goodness (down-is-good vs up-is-good).
  function findPBs(rows, opts) {
    const metric = opts && opts.metric;
    const goodDir = metricMeta(metric).goodDir;
    const s = sortByDate(rows);
    const out = [];
    let best = null;
    for (const r of s) {
      if (best === null
        || (goodDir === 'down' && r.value < best)
        || (goodDir === 'up'   && r.value > best)) {
        best = r.value;
        out.push(r);
      }
    }
    return out;
  }

  // Is the latest row a PB? If so, how much did it beat the prior best by?
  function isLatestPB(rows, metric) {
    const s = sortByDate(rows);
    if (s.length < 2) return { isPB: s.length === 1, margin: null };
    const latest = s[s.length - 1];
    const prior = s.slice(0, -1);
    const goodDir = metricMeta(metric).goodDir;
    const priorBest = goodDir === 'down'
      ? Math.min.apply(null, prior.map(r => r.value))
      : Math.max.apply(null, prior.map(r => r.value));
    const isPB = goodDir === 'down' ? latest.value < priorBest : latest.value > priorBest;
    const margin = isPB ? Math.abs(latest.value - priorBest) : null;
    return { isPB, margin, priorBest, latest };
  }

  // ── Streaks & trends ─────────────────────────────────────────

  // Longest current run (counting backward from latest) of rows where pred(row) is true.
  function streak(rows, pred) {
    const s = sortByDate(rows);
    let count = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      if (pred(s[i])) count++;
      else break;
    }
    return count;
  }

  // Linear regression on the last `window` points; classify slope.
  // Returns { slope, pctPerUnit, dir: 'improving' | 'flat' | 'regressing' }.
  function trend(rows, opts) {
    const window = (opts && opts.window) || 4;
    const metric = opts && opts.metric;
    const s = lastN(rows, window);
    if (s.length < 2) return { slope: 0, pctPerUnit: 0, dir: 'flat' };

    // x = index, y = value. Simple OLS slope.
    const n = s.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sx += i; sy += s[i].value;
      sxy += i * s[i].value;
      sxx += i * i;
    }
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const meanY = sy / n;
    const pctPerUnit = meanY === 0 ? 0 : (slope / Math.abs(meanY)) * 100;

    // Threshold: ≥2% total drift across the window counts as a real trend.
    const totalPct = Math.abs(pctPerUnit) * (n - 1);
    if (totalPct < 2) return { slope, pctPerUnit, dir: 'flat' };

    const goodDir = metric ? metricMeta(metric).goodDir : 'down';
    const slopeDir = slope > 0 ? 'up' : 'down';
    const dir = slopeDir === goodDir ? 'improving' : 'regressing';
    return { slope, pctPerUnit, dir };
  }

  // ── Expose ───────────────────────────────────────────────────

  window.PA_ANALYTICS = {
    // time
    parseTime, fmtTime, daysAgo,
    // series
    sortByDate, lastN, withinDays, rollingAvg, minValue, maxValue, median,
    mean, stdDev, zScore, zPhrase,
    // deltas
    delta, deltaVsWindow,
    // metric registry
    METRICS, metricMeta, isImprovement,
    // PB
    findPBs, isLatestPB,
    // trends
    streak, trend,
  };
})();
