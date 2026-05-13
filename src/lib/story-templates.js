/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Story templates — headline sentences, keyed by kind

   Each template's en()/es() renderer returns either:
     - a plain string, OR
     - an object { text, highlight }  ← preferred
   Where `highlight` is a substring of `text` that the Deck
   will wrap in a signal-colored span. Falsy highlight → no
   emphasis applied (plain sentence).

   Pure — no Supabase, no React, no DOM.
   Exposed as window.PA_STORY_TEMPLATES.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const A = window.PA_ANALYTICS;

  // Small helpers local to this file ---------------------------

  function fmtMetric(metric, value) {
    if (!Number.isFinite(value)) return '—';
    const meta = A.metricMeta(metric);
    if (meta.fmt === 'time') return A.fmtTime(value);
    return value.toFixed(2);
  }

  function absPctStr(pct) {
    if (!Number.isFinite(pct)) return '';
    return Math.abs(pct).toFixed(1) + '%';
  }

  // "faster" / "slower" for time-style metrics, "higher" / "lower"
  // for everything else. Based on improvement semantics.
  function directionWord(metric, isBetter) {
    const meta = A.metricMeta(metric);
    if (meta.fmt === 'time') return isBetter ? 'faster' : 'slower';
    return isBetter ? 'higher' : 'lower';
  }

  // v01.25 — Spanish equivalent. "más rápido" / "más lento" for
  // time metrics, "más alto" / "más bajo" for value metrics.
  function directionWordEs(metric, isBetter) {
    const meta = A.metricMeta(metric);
    if (meta.fmt === 'time') return isBetter ? 'más rápido' : 'más lento';
    return isBetter ? 'más alto' : 'más bajo';
  }

  // v01.25 — Spanish localized short date, e.g. "12 may".
  function shortDateEs(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es', { month: 'short', day: 'numeric' });
  }

  // ── Templates ────────────────────────────────────────────────
  // Each entry: { en(data), es(data) }.
  // Return { text, highlight } so the Deck can colorize the
  // punchy phrase inline.

  const TEMPLATES = {

    // data: { metric, latest: {value, date, event?}, margin }
    new_pb: {
      en(d) {
        const v = fmtMetric(d.metric, d.latest.value);
        const m = fmtMetric(d.metric, Math.abs(d.margin));
        const event = d.latest.event ? ' on the ' + d.latest.event : '';
        const word = directionWord(d.metric, true);
        const highlight = m + (A.metricMeta(d.metric).unit || '') + ' ' + word;
        const text = 'New personal best' + event + ' — ' + v
          + ', ' + highlight + ' than your previous mark.';
        return { text, highlight };
      },
      es(d) {
        const v = fmtMetric(d.metric, d.latest.value);
        const m = fmtMetric(d.metric, Math.abs(d.margin));
        const event = d.latest.event ? ' en ' + d.latest.event : '';
        const word = directionWordEs(d.metric, true);
        const highlight = m + (A.metricMeta(d.metric).unit || '') + ' ' + word;
        const text = 'Nueva mejor marca personal' + event + ' — ' + v
          + ', ' + highlight + ' que tu marca anterior.';
        return { text, highlight };
      },
    },

    // data: { note: { coach, subject? } }
    coach_message: {
      en(d) {
        const coach = d.note.coach || 'Your coach';
        const subject = d.note.subject ? ' on ' + d.note.subject : '';
        const text = coach + ' dropped a note' + subject + '.';
        return { text, highlight: coach };
      },
      es(d) {
        const coach = d.note.coach || 'Tu entrenador';
        const subject = d.note.subject ? ' sobre ' + d.note.subject : '';
        const text = coach + ' dejó una nota' + subject + '.';
        return { text, highlight: coach };
      },
    },

    // data: { metric, latest: {value, event?}, bucket, isBetter }
    // bucket: 'standout' | 'ahead' | 'above' | 'touch' | 'behind' | 'off'
    metric_delta: {
      en(d) {
        const phrases = {
          standout: 'a standout performance for you',
          ahead:    'well ahead of your usual',
          above:    'above your usual pace',
          touch:    'a touch off your pace',
          behind:   'behind your usual',
          off:      'well off your usual',
        };
        const phrase = phrases[d.bucket] || 'within your usual range';
        const v = fmtMetric(d.metric, d.latest.value);
        const event = d.latest.event || metricLabel(d.metric);
        const text = 'Your ' + event + ' — ' + v + ', ' + phrase + '.';
        return { text, highlight: phrase };
      },
      es(d) {
        const phrases = {
          standout: 'una actuación destacada',
          ahead:    'bastante por delante de tu ritmo habitual',
          above:    'por encima de tu ritmo habitual',
          touch:    'un poco por debajo de tu ritmo',
          behind:   'por detrás de tu ritmo habitual',
          off:      'bastante por debajo de tu ritmo habitual',
        };
        const phrase = phrases[d.bucket] || 'dentro de tu rango habitual';
        const v = fmtMetric(d.metric, d.latest.value);
        const event = d.latest.event || metricLabelEs(d.metric);
        const text = 'Tu ' + event + ' — ' + v + ', ' + phrase + '.';
        return { text, highlight: phrase };
      },
    },

    // data: { metric, latest: {value, event?, date}, prior: {value, date} | null }
    // Always-fires floor story — narrates the latest race plainly.
    recent_race: {
      en(d) {
        const v = fmtMetric(d.metric, d.latest.value);
        const event = d.latest.event || metricLabel(d.metric);
        if (!d.prior) {
          return { text: 'Most recent ' + event + ' — ' + v + '.', highlight: null };
        }
        const diff = Math.abs(d.latest.value - d.prior.value);
        const meta = A.metricMeta(d.metric);
        const diffStr = meta.fmt === 'time'
          ? A.fmtTime(diff) + (meta.unit || '')
          : diff.toFixed(2) + (meta.unit ? ' ' + meta.unit : '');
        const isBetter = meta.goodDir === 'down'
          ? d.latest.value < d.prior.value
          : d.latest.value > d.prior.value;
        const word = directionWord(d.metric, isBetter);
        const highlight = diffStr + ' ' + word;
        const text = 'Most recent ' + event + ' — ' + v
          + ', ' + highlight + ' than ' + shortDate(d.prior.date) + '.';
        return { text, highlight };
      },
      es(d) {
        const v = fmtMetric(d.metric, d.latest.value);
        const event = d.latest.event || metricLabelEs(d.metric);
        if (!d.prior) {
          return { text: event + ' más reciente — ' + v + '.', highlight: null };
        }
        const diff = Math.abs(d.latest.value - d.prior.value);
        const meta = A.metricMeta(d.metric);
        const diffStr = meta.fmt === 'time'
          ? A.fmtTime(diff) + (meta.unit || '')
          : diff.toFixed(2) + (meta.unit ? ' ' + meta.unit : '');
        const isBetter = meta.goodDir === 'down'
          ? d.latest.value < d.prior.value
          : d.latest.value > d.prior.value;
        const word = directionWordEs(d.metric, isBetter);
        const highlight = diffStr + ' ' + word;
        const text = event + ' más reciente — ' + v
          + ', ' + highlight + ' que el ' + shortDateEs(d.prior.date) + '.';
        return { text, highlight };
      },
    },

    // data: { metric, dir: 'improving' | 'regressing', window, totalPct }
    trend: {
      en(d) {
        const label = metricLabel(d.metric);
        const pct = absPctStr(d.totalPct);
        if (d.dir === 'improving') {
          const highlight = pct + ' better';
          const text = 'Your ' + label + ' has trended ' + highlight
            + ' across the last ' + d.window + ' sessions.';
          return { text, highlight };
        }
        const highlight = 'drifted ' + pct;
        const text = 'Your ' + label + ' has ' + highlight
          + ' over the last ' + d.window + ' sessions.';
        return { text, highlight };
      },
      es(d) {
        const label = metricLabelEs(d.metric);
        const pct = absPctStr(d.totalPct);
        if (d.dir === 'improving') {
          const highlight = 'mejorado un ' + pct;
          const text = 'Tu ' + label + ' ha ' + highlight
            + ' en las últimas ' + d.window + ' sesiones.';
          return { text, highlight };
        }
        const highlight = 'desviado un ' + pct;
        const text = 'Tu ' + label + ' se ha ' + highlight
          + ' en las últimas ' + d.window + ' sesiones.';
        return { text, highlight };
      },
    },

    // data: { metric, length, event? }
    streak: {
      en(d) {
        const label = metricLabel(d.metric);
        const event = d.event ? ' on the ' + d.event : '';
        const nth = ordinal(d.length);
        const highlight = nth + ' straight';
        const text = highlight + ' ' + label + ' improvement' + event + '.';
        return { text, highlight };
      },
      es(d) {
        const label = metricLabelEs(d.metric);
        const event = d.event ? ' en ' + d.event : '';
        // Spanish ordinal-style ("3.ª consecutiva") feels heavy for a
        // headline; "{n} mejoras consecutivas" reads cleaner and
        // pluralizes naturally for n>=2 (which is when streak fires).
        const highlight = d.length + ' consecutivas';
        const text = highlight + ' mejoras de ' + label + event + '.';
        return { text, highlight };
      },
    },

    // data: { athleteName, lastSeenDays }
    welcome: {
      en(d) {
        const name = d.athleteName ? ', ' + d.athleteName : '';
        if (Number.isFinite(d.lastSeenDays) && d.lastSeenDays >= 2) {
          return {
            text: 'Welcome back' + name + '. '
                + d.lastSeenDays + ' days since your last visit.',
            highlight: null,
          };
        }
        return { text: 'Welcome back' + name + '.', highlight: null };
      },
      es(d) {
        const name = d.athleteName ? ', ' + d.athleteName : '';
        if (Number.isFinite(d.lastSeenDays) && d.lastSeenDays >= 2) {
          return {
            text: 'Bienvenido de vuelta' + name + '. '
                + d.lastSeenDays + ' días desde tu última visita.',
            highlight: null,
          };
        }
        return { text: 'Bienvenido de vuelta' + name + '.', highlight: null };
      },
    },
  };

  // ── Small utilities used by templates ────────────────────────

  function metricLabel(metric) {
    const map = {
      race_time:      'race time',
      reaction_time:  'reaction time',
      underwater_vel: 'underwater velocity',
      turn_time:      'turn time',
      stroke_rate:    'stroke rate',
      stroke_count:   'stroke count',
      split:          'split',
      velocity:       'velocity',
      rank:           'rank',
    };
    return map[metric] || metric;
  }

  // v01.25 — Spanish equivalent. Used by every es() template.
  function metricLabelEs(metric) {
    const map = {
      race_time:      'tiempo de carrera',
      reaction_time:  'tiempo de reacción',
      underwater_vel: 'velocidad subacuática',
      turn_time:      'tiempo de vuelta',
      stroke_rate:    'frecuencia de brazada',
      stroke_count:   'número de brazadas',
      split:          'parcial',
      velocity:       'velocidad',
      rank:           'puesto',
    };
    return map[metric] || metric;
  }

  function ordinal(n) {
    if (!Number.isFinite(n)) return '';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function shortDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ── Expose ───────────────────────────────────────────────────

  window.PA_STORY_TEMPLATES = {
    TEMPLATES,
    // Main entry: render(kind, data, locale) → { text, highlight }
    // Back-compat: a template that still returns a plain string is
    // normalized to { text, highlight: null }.
    render(kind, data, locale) {
      const t = TEMPLATES[kind];
      if (!t) return null;
      const fn = (locale === 'es' && t.es) ? t.es : t.en;
      let out = fn(data);
      if (out == null) out = t.en(data);
      if (typeof out === 'string') return { text: out, highlight: null };
      return out;
    },
    helpers: { fmtMetric, directionWord, metricLabel, ordinal, absPctStr },
  };
})();
