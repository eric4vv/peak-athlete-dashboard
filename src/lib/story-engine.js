/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Story engine — picks the headline sentence for The Deck

   Pure. No Supabase, no React, no DOM. The Deck queries
   Supabase, packs a `facts` bundle, and calls
   PA_STORY.pickStory(facts, { locale }).

   Returns: { kind, sentence, meta, score }.
   Falls back to 'welcome' if nothing clears significance.

   Ranking: new_pb > coach_message > metric_delta>2%
          > trend > streak > welcome
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const A = window.PA_ANALYTICS;
  const T = window.PA_STORY_TEMPLATES;

  // Facts shape (all fields optional — engine degrades gracefully):
  //   athleteName:      string
  //   locale:           'en' | 'es'
  //   metric:           string (e.g. 'race_time') — the primary metric to narrate
  //   latest:           { value, date, event? }
  //   rows:             [{ date, value, ...}]  — history for `metric`
  //   unreadCoachNotes: [{ coach, subject?, date }]
  //   lastSeenDays:     number (days since last visit)

  // ── Candidate builders ───────────────────────────────────────
  // Each builder either returns null (not applicable) or
  // { kind, score, data }. Higher score wins.

  function candidatePB(facts) {
    if (!facts.rows || !facts.metric) return null;
    const r = A.isLatestPB(facts.rows, facts.metric);
    if (!r || !r.isPB || !Number.isFinite(r.margin)) return null;
    // Base 100; bigger margin ranks higher (cap the bonus).
    const meta = A.metricMeta(facts.metric);
    const marginPct = Math.abs(r.margin) / Math.max(1e-9, Math.abs(r.priorBest)) * 100;
    const bonus = Math.min(20, marginPct);
    return {
      kind: 'new_pb',
      score: 100 + bonus,
      data: {
        metric: facts.metric,
        latest: facts.latest || { value: r.latest.value, date: r.latest.date },
        margin: r.margin,
        priorBest: r.priorBest,
        unit: meta.unit,
      },
    };
  }

  function candidateCoachMessage(facts) {
    const notes = facts.unreadCoachNotes || [];
    if (!notes.length) return null;
    const note = notes[0]; // most recent — caller sorts
    return {
      kind: 'coach_message',
      score: 80,
      data: { note },
    };
  }

  function candidateMetricDelta(facts) {
    if (!facts.rows || !facts.metric) return null;
    const s = A.sortByDate(facts.rows);
    // Needs enough same-event history to compute a trustworthy sigma.
    if (s.length < 6) return null; // latest + 5 prior minimum
    const latest = s[s.length - 1];
    const prior = s.slice(0, -1).map(r => r.value);
    const z = A.zScore(latest.value, prior);
    if (z == null) return null;
    const phrase = A.zPhrase(z, facts.metric);
    if (phrase.bucket === 'flat') return null; // within normal range — let recent_race narrate
    // Score: 55 base for regressions, 60 for improvements, bump by |z|.
    const score = (phrase.isBetter ? 60 : 55) + Math.min(20, Math.abs(z) * 6);
    return {
      kind: 'metric_delta',
      score,
      data: {
        metric: facts.metric,
        latest: {
          value: latest.value,
          date:  latest.date,
          event: (facts.latest && facts.latest.event) || latest.event || null,
        },
        bucket:    phrase.bucket,
        isBetter:  phrase.isBetter,
        z,
        sampleSize: prior.length,
      },
    };
  }

  function candidateRecentRace(facts) {
    // Always fires if the athlete has at least one race. It's the
    // floor — ensures the hero card always has a real sentence.
    if (!facts.rows || !facts.metric) return null;
    const s = A.sortByDate(facts.rows);
    if (!s.length) return null;
    const latest = s[s.length - 1];
    const prior  = s.length >= 2 ? s[s.length - 2] : null;
    return {
      kind: 'recent_race',
      score: 10,
      data: {
        metric: facts.metric,
        latest: {
          value: latest.value,
          date:  latest.date,
          event: (facts.latest && facts.latest.event) || latest.event || null,
        },
        prior: prior ? { value: prior.value, date: prior.date } : null,
      },
    };
  }

  function candidateTrend(facts) {
    if (!facts.rows || !facts.metric) return null;
    const windowSize = 4;
    const t = A.trend(facts.rows, { window: windowSize, metric: facts.metric });
    if (!t || t.dir === 'flat') return null;
    const totalPct = Math.abs(t.pctPerUnit) * (windowSize - 1);
    return {
      kind: 'trend',
      score: t.dir === 'improving' ? 50 : 45,
      data: {
        metric: facts.metric,
        dir: t.dir,
        window: windowSize,
        totalPct,
      },
    };
  }

  function candidateStreak(facts) {
    if (!facts.rows || !facts.metric || facts.rows.length < 2) return null;
    // Count backwards: how many trailing rows were each an improvement
    // over the one before? (Strict — every step has to be better.)
    const s = A.sortByDate(facts.rows);
    const goodDir = A.metricMeta(facts.metric).goodDir;
    let len = 0;
    for (let i = s.length - 1; i > 0; i--) {
      const better = goodDir === 'down'
        ? s[i].value < s[i - 1].value
        : s[i].value > s[i - 1].value;
      if (better) len++; else break;
    }
    if (len < 2) return null; // "streak" is only meaningful at 2+
    return {
      kind: 'streak',
      score: 40 + Math.min(20, len * 4),
      data: {
        metric: facts.metric,
        length: len + 1, // inclusive of the first improving point's anchor
        event: (facts.latest && facts.latest.event) || null,
      },
    };
  }

  function candidateWelcome(facts) {
    return {
      kind: 'welcome',
      score: 0,
      data: {
        athleteName: facts.athleteName || null,
        lastSeenDays: Number.isFinite(facts.lastSeenDays) ? facts.lastSeenDays : null,
      },
    };
  }

  const BUILDERS = [
    candidatePB,
    candidateCoachMessage,
    candidateMetricDelta,
    candidateTrend,
    candidateStreak,
    candidateRecentRace,
    candidateWelcome,
  ];

  // ── Main entry ───────────────────────────────────────────────

  function pickStory(facts, opts) {
    const locale = (opts && opts.locale) || (facts && facts.locale) || 'en';
    const candidates = BUILDERS
      .map(fn => {
        try { return fn(facts || {}); }
        catch (_) { return null; }
      })
      .filter(Boolean);

    if (!candidates.length) {
      // Shouldn't happen — welcome always builds — but guard anyway.
      return {
        kind: 'welcome',
        sentence: 'Welcome back.',
        highlight: null,
        meta: {},
        score: 0,
      };
    }

    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];
    const rendered = T.render(winner.kind, winner.data, locale) || { text: '', highlight: null };

    return {
      kind: winner.kind,
      sentence: rendered.text,
      highlight: rendered.highlight || null,
      meta: winner.data,
      score: winner.score,
      // Debug: runner-ups so we can tune the ranker in dev.
      _candidates: candidates,
    };
  }

  // Expose ------------------------------------------------------

  window.PA_STORY = {
    pickStory,
    // exported for unit-poking in the console
    _builders: {
      candidatePB, candidateCoachMessage, candidateMetricDelta,
      candidateTrend, candidateStreak, candidateRecentRace, candidateWelcome,
    },
  };
})();
