/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   The Deck — athlete home page

   Pulls real races from v_race_kpis via PA_DATA, feeds the
   story engine (PA_STORY) for the headline, and renders:

   - HeadlineStory (ported from design-reference)
     · Pill eyebrow + date range
     · Large display sentence (from PA_STORY.pickStory)
     · Supporting paragraph (kind-aware)
     · Three micro-stats (Latest · vs prior · Best)
     · HeroTrendChart (last 12 same-event times · median baseline)
     · Corner lightning mark
   - Recent races list (last 5)
   - Coach notes placeholder (no surface yet)
   - Next session placeholder

   Coach persona renders a minimal "Squad in Phase 4" placeholder.
   ─────────────────────────────────────────────────────────── */

const { useState: useDeckState, useEffect: useDeckEffect } = React;

// ── Small presentation helpers ───────────────────────────────

function storyEyebrow(kind) {
  const map = {
    new_pb:        'NEW PERSONAL BEST',
    coach_message: 'NOTE FROM YOUR COACH',
    metric_delta:  'VS. YOUR USUAL',
    trend:         'TREND',
    streak:        'STREAK',
    recent_race:   'RECENT RACE',
    welcome:       'TODAY',
  };
  return map[kind] || 'TODAY';
}

// Sub-paragraph beneath the display sentence. Pure-English, never
// surfaces sigma/z-scores. Returns '' when nothing useful to add.
function storySubtext({ story, latest, prior, best, sameEventCount }) {
  if (!story || !latest) return '';
  const event = latest.event || 'this event';
  const k = story.kind;
  if (k === 'new_pb' && best && prior) {
    return `Your fastest ${event} to date — the previous best stood since ${shortDate(best.priorDate || prior.date)}.`;
  }
  if (k === 'metric_delta') {
    const bucket = story.meta?.bucket;
    if (bucket === 'standout' || bucket === 'ahead' || bucket === 'above') {
      return `A step up from your recent ${event}s. Keep the same prep the next time out and see if it holds.`;
    }
    if (bucket === 'touch' || bucket === 'behind' || bucket === 'off') {
      return `Worth a look against your warm-up, sleep, and race prep. One race isn't a trend — two in a row is worth asking your coach about.`;
    }
    return '';
  }
  if (k === 'recent_race') {
    if (sameEventCount >= 3) {
      return `Sits in range with your last ${sameEventCount - 1} ${event} races. Nothing jumps out — solid and expected.`;
    }
    if (sameEventCount === 2) {
      return `Second ${event} on record. Your picture fills in with each race.`;
    }
    return `Your first ${event} on the Deck. The next one builds the comparison.`;
  }
  if (k === 'trend' || k === 'streak') {
    return `A consistent line across your last few ${event}s.`;
  }
  if (k === 'welcome') {
    return `Upload or sync a session to light up your numbers.`;
  }
  return '';
}

// Inline-color the punchy phrase inside the display sentence.
// Returns an array of React nodes (strings + a colored span).
// If highlight is falsy or not found, returns the plain sentence.
function renderSentenceWithHighlight(sentence, highlight, color) {
  if (!sentence) return '';
  if (!highlight || !sentence.includes(highlight)) return sentence;
  const idx = sentence.indexOf(highlight);
  const before = sentence.slice(0, idx);
  const after  = sentence.slice(idx + highlight.length);
  return [
    before,
    <span key="hl" style={{ color: color || 'var(--signal-eff)' }}>{highlight}</span>,
    after,
  ];
}

function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function longMonthDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase();
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── HeroTrendChart ───────────────────────────────────────────
// Custom SVG line + area, median baseline, newest point highlighted.

const HeroTrendChart = ({ data, avg }) => {
  if (!data || data.length < 2) return null;
  const W = 420, H = 130;
  const pad = 0.04;
  const max = Math.max(...data) + (Math.max(...data) - Math.min(...data)) * pad + 0.01;
  const min = Math.min(...data) - (Math.max(...data) - Math.min(...data)) * pad - 0.01;
  const span = (max - min) || 1;
  const xs = (i) => (i / (data.length - 1)) * W;
  const ys = (v) => H - ((v - min) / span) * H;
  const path = window.PA_SVG.smoothPath(data.map((v, i) => [xs(i), ys(v)]));
  const area = path + ` L${W},${H} L0,${H} Z`;
  const last = data[data.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ margin: '8px 0' }}>
      <defs>
        <linearGradient id="paHeroArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"  stopColor="var(--signal-eff)" stopOpacity="0.3"/>
          <stop offset="1"  stopColor="var(--signal-eff)" stopOpacity="0"/>
        </linearGradient>
      </defs>

      {Number.isFinite(avg) && (
        <>
          <line x1="0" y1={ys(avg)} x2={W} y2={ys(avg)}
                stroke="var(--tx-lo)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5"/>
          <text x={W - 4} y={ys(avg) - 4} textAnchor="end"
                fontSize="10" fontFamily="JetBrains Mono" fill="var(--tx-lo)">
            typical
          </text>
        </>
      )}

      <path d={area} fill="url(#paHeroArea)"/>
      <path d={path} fill="none" stroke="var(--signal-eff)" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round"/>

      {data.map((v, i) => (
        <circle key={i} cx={xs(i)} cy={ys(v)}
                r={i === data.length - 1 ? 5 : 2.8}
                fill={i === data.length - 1 ? 'var(--signal-eff)' : 'var(--bg-2)'}
                stroke="var(--signal-eff)"
                strokeWidth={i === data.length - 1 ? 0 : 1.8}/>
      ))}

      <text x={xs(data.length - 1) - 4} y={ys(last) - 12} textAnchor="end"
            fontSize="11" fontFamily="JetBrains Mono" fontWeight="700" fill="var(--tx-hi)">
        {PA_ANALYTICS.fmtTime(last)}
      </text>
    </svg>
  );
};

// ── HeadlineStory ────────────────────────────────────────────
// Full-width hero card. Two-column grid when we have a chart to
// show, single-column when we only have a sentence.

// ── YourRequestsCard ─────────────────────────────────────────
// Right-column card showing the last 5 race_requests with status
// chips. Chips mirror the live dashboard's states:
//   pending      -> amber "In queue"
//   processing   -> signal "Analyzing"
//   completed    -> lime  "Ready"
//   failed       -> flag  "Failed"

function statusChipStyle(status) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 7px', borderRadius: 5,
    font: '700 9px var(--font-ui)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
  };
  switch (status) {
    case 'completed':
      return { ...base, background: 'color-mix(in oklch, var(--lime-eff) 18%, transparent)', color: 'var(--lime-eff)' };
    case 'processing':
      return { ...base, background: 'color-mix(in oklch, var(--signal-eff) 16%, transparent)', color: 'var(--signal-eff)' };
    case 'failed':
      return { ...base, background: 'color-mix(in oklch, var(--flag-eff) 14%, transparent)', color: 'var(--flag-eff)' };
    case 'pending':
    default:
      return { ...base, background: 'var(--bg-3)', color: 'var(--tx-md)' };
  }
}

// v01.23 — `t` is now a parameter so callers can supply the
// translation function. Falls back to English-ish keys when no t
// is passed (callers that haven't been updated still work).
function statusLabel(status, t) {
  const _t = t || ((k) => k);
  switch (status) {
    case 'completed':  return _t('deck.status.completed');
    case 'processing': return _t('deck.status.processing');
    case 'failed':     return _t('deck.status.failed');
    case 'pending':
    default:           return _t('deck.status.pending');
  }
}

// v01.29 — admin notes, "check Races" hint, retry button.
//
// Live's Race Analysis Card renders three pieces the prototype was
// missing: the admin's note when a request is processed, a nudge to
// the Races tab on completed rows, and a way out of a failed upload.
// All three live here now.
//
// Retry dispatches `pa:open-modal` with `{ modal: 'upload', prefill }`
// — the AthleteDeck listener captures the prefill and forwards it
// to UploadModal. The original failed row stays in history.
const YourRequestsCard = ({ requestsState }) => {
  const R = window.PA_REQUESTS;
  const t = (window.useT || (() => (k) => k))();
  const rows = (requestsState.requests || []).slice(0, 5);

  // Build the prefill payload from a failed row so the user lands
  // in UploadModal with the same metadata they used last time.
  const onRetry = (r) => {
    const prefill = {
      eventName: r.event_name || '',
      eventDate: r.event_date || '',
      distance:  r.distance_m != null ? String(r.distance_m) : '',
      style:     r.style || '',
      course:    r.course || 'LCM',
      lane:      r.lane_number != null ? String(r.lane_number) : '',
      notes:     '',
    };
    try {
      window.dispatchEvent(new CustomEvent('pa:open-modal', {
        detail: { modal: 'upload', prefill },
      }));
    } catch (_) {}
  };

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <SectionLabel>{t('deck.requests.title')}</SectionLabel>
        {requestsState.pending > 0 && (
          <span style={{
            font: '600 10px var(--font-ui)', letterSpacing: '0.06em',
            color: 'var(--signal-eff)', textTransform: 'uppercase',
          }}>
            {t('deck.requests.inFlight', { n: requestsState.pending })}
          </span>
        )}
      </div>

      {requestsState.loading ? (
        <div style={{ color: 'var(--tx-lo)', font: '500 12px var(--font-ui)', marginTop: 8 }}>
          {t('deck.requests.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--tx-lo)', font: '500 12px var(--font-ui)', marginTop: 8 }}>
          {t('deck.requests.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {rows.map((r, i, arr) => {
            const note = (r.admin_notes || '').trim();
            const isCompleted = r.status === 'completed';
            const isFailed    = r.status === 'failed';
            // Default hint on completed rows when no admin note set —
            // matches live's "Check Races tab for results" behavior.
            const showCompletedHint = isCompleted && !note;
            return (
              <div key={r.request_uuid || i} style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                paddingBottom: 8,
                borderBottom: i < arr.length - 1 ? '1px solid var(--line-soft)' : 'none',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8,
                }}>
                  <span style={{
                    font: '500 12px var(--font-ui)', color: 'var(--tx-hi)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    flex: 1, minWidth: 0,
                  }}>
                    {R ? R.fmtRequest(r) : t('deck.headline.raceRequestLabel')}
                  </span>
                  <span style={statusChipStyle(r.status)}>{statusLabel(r.status, t)}</span>
                </div>
                <span className="mono" style={{
                  font: '500 10px var(--font-mono)', color: 'var(--tx-lo)',
                }}>
                  {shortDate(r.created_at)}
                </span>

                {/* Admin note — surfaces analyst feedback to the
                    athlete (e.g. "video too dark, please re-upload").
                    Tone slightly varies on failed rows so the cause
                    reads as a real signal, not a chip caption. */}
                {note && (
                  <div style={{
                    marginTop: 4,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: isFailed
                      ? 'color-mix(in oklch, var(--flag-eff) 8%, transparent)'
                      : 'var(--bg-3)',
                    border: '1px solid ' + (isFailed
                      ? 'color-mix(in oklch, var(--flag-eff) 30%, transparent)'
                      : 'var(--line-soft)'),
                    font: '500 11px var(--font-ui)',
                    color: 'var(--tx-md)',
                    lineHeight: 1.4,
                  }}>
                    <span style={{
                      font: '700 9px var(--font-ui)', letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: isFailed ? 'var(--flag-eff)' : 'var(--tx-lo)',
                      marginRight: 6,
                    }}>
                      {t('deck.requests.adminNoteLabel')}
                    </span>
                    {note}
                  </div>
                )}

                {/* "Check the Races tab for results" — only shown
                    when the request completed AND no admin note set
                    (the note already gives a clear signal). */}
                {showCompletedHint && (
                  <span style={{
                    font: '500 11px var(--font-ui)',
                    color: 'var(--lime-eff)',
                    marginTop: 2,
                  }}>
                    {t('deck.requests.checkRaces')}
                  </span>
                )}

                {/* Retry button — locked decision from the audit Q9.
                    Pre-fills the upload modal with the prior row's
                    metadata so the user only has to pick a new file
                    + adjust whatever was wrong. */}
                {isFailed && (
                  <button type="button"
                    onClick={() => onRetry(r)}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: 4,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid color-mix(in oklch, var(--signal-eff) 50%, transparent)',
                      background: 'transparent',
                      color: 'var(--signal-eff)',
                      font: '600 11px var(--font-ui)',
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                    }}>
                    {t('deck.requests.retry')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── RequestAnalysisButton ────────────────────────────────────
// Lives where the decorative lightning used to be (top-right of
// hero). Copy + tone shift with quota state: green when the user
// has quota, amber when they've run out, ghost when there's no
// subscription at all. The caption underneath is the readout —
// "2 of 3 used" / "No subscription" / "Trial — 4 days left".

const RequestAnalysisButton = ({ nextAction, quota, isTrialing, trialDays, isPolling, onClick }) => {
  const t = (window.useT || (() => (k) => k))();
  const label =
    nextAction === 'upload' ? t('deck.requestBtn.upload') :
    nextAction === 'buy'    ? t('deck.requestBtn.buy')    :
    nextAction === 'try'    ? t('deck.requestBtn.try')    :
    /* loading */             t('deck.requestBtn.loading');

  // Tone by action
  const tone =
    nextAction === 'upload' ? { bg: 'var(--signal-eff)', fg: 'var(--ink)',   border: 'transparent' } :
    nextAction === 'buy'    ? { bg: 'transparent',       fg: 'var(--flag-eff)', border: 'color-mix(in oklch, var(--flag-eff) 50%, transparent)' } :
                              { bg: 'transparent',       fg: 'var(--signal-eff)', border: 'color-mix(in oklch, var(--signal-eff) 50%, transparent)' };

  const R = window.PA_REQUESTS;
  const caption = (() => {
    if (isPolling) return t('deck.requestBtn.checking');
    if (!quota) return '';
    // The trial caption + quotaLabel come from PA_REQUESTS (`requests.js`)
    // which is still English-only. Translation of those small strings
    // lands together with the requests.js i18n pass (low priority — they
    // already read fine in either language).
    if (isTrialing && Number.isFinite(trialDays)) return `Trial · ${trialDays}d left`;
    if (quota.status === 'none') return t('deck.requestBtn.noSubscription');
    return R ? R.quotaLabel(quota) : `${quota.used} of ${quota.limit} used`;
  })();

  return (
    <div style={{
      position: 'absolute', top: 14, right: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
      zIndex: 2,
    }}>
      <button
        onClick={onClick}
        disabled={nextAction === 'loading'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 12px',
          borderRadius: 10,
          background: tone.bg,
          color: tone.fg,
          border: `1px solid ${tone.border}`,
          font: '600 12px var(--font-ui)', letterSpacing: '0.01em',
          cursor: nextAction === 'loading' ? 'wait' : 'pointer',
          opacity: nextAction === 'loading' ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <Icon name="plus" size={13}/> {label}
      </button>
      {caption && (
        <span className="mono" style={{
          font: '500 10px var(--font-mono)',
          color: isPolling ? 'var(--signal-eff)' : 'var(--tx-lo)',
          letterSpacing: '0.04em',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          {isPolling && (
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: 999,
              background: 'var(--signal-eff)',
              animation: 'paPulse 1.2s ease-in-out infinite',
            }}/>
          )}
          {caption}
        </span>
      )}
    </div>
  );
};

// ── HeadlineStory ────────────────────────────────────────────

const HeadlineStory = ({ story, latest, prior, best, sameEventRows, metricLabel, actionSlot }) => {
  const isMobile    = (window.useIsMobile || (() => false))();
  const t = (window.useT || (() => (k) => k))();
  const hasChart    = sameEventRows.length >= 2;
  const sparkSlice  = sameEventRows.slice(-12);
  const sparkData   = sparkSlice.map(r => r.value);
  const sparkFirst  = sparkSlice[0];
  const sparkLast   = sparkSlice[sparkSlice.length - 1];
  const sparkMid    = sparkSlice[Math.floor(sparkSlice.length / 2)];
  const chartAvg    = median(sparkData);

  const latestIsPB  = latest && best && latest.value === best.value;
  const deltaPrior  = (latest && prior) ? (latest.value - prior.value) : null;
  const deltaBest   = (latest && best && best.priorBest != null)
    ? (latest.value - best.priorBest)
    : null;

  const microStats = latest ? [
    {
      k: t('deck.headline.latest'),
      v: PA_ANALYTICS.fmtTime(latest.value),
      u: 's',
      d: null,
      hi: story.kind === 'metric_delta' || story.kind === 'recent_race',
    },
    prior ? {
      // "vs. May 12" — date is locale-formatted via shortDate; the
      // "vs." prefix is short enough to not need translation, but we
      // still pull through for consistency.
      k: 'vs. ' + shortDate(prior.date),
      v: PA_ANALYTICS.fmtTime(prior.value),
      u: 's',
      d: deltaPrior,
      hi: false,
    } : null,
    best ? {
      k: latestIsPB ? t('deck.headline.personalBestToday') : t('deck.headline.personalBest'),
      v: PA_ANALYTICS.fmtTime(best.value),
      u: 's',
      d: null,
      hi: latestIsPB,
      isPB: latestIsPB,
    } : null,
  ].filter(Boolean) : [];

  const subtext = storySubtext({
    story, latest, prior, best,
    sameEventCount: sameEventRows.length,
  });

  const rangeLabel = hasChart && sparkFirst && sparkLast
    ? `${longMonthDay(sparkFirst.date)} — ${longMonthDay(sparkLast.date)}`
    : (latest ? longMonthDay(latest.date) : '');

  return (
    <div className="card" style={{
      // Top-right action slot is a button (~32px) + 6px gap + caption
      // (~14px), starting at top:14 → bottom edge ≈ y:66. paddingTop:76
      // keeps the chart column header ("seconds", eyebrow) and hero
      // sentence fully below the button stack so nothing can overlap,
      // no matter the locale's caption width.
      padding: isMobile ? '60px 18px 22px 18px' : '76px 36px 32px 36px',
      position: 'relative', overflow: 'hidden',
      background: 'var(--bg-2)', borderRadius: 20,
      display: 'grid',
      gridTemplateColumns: (hasChart && !isMobile) ? '1.4fr 1fr' : '1fr',
      gap: isMobile ? 22 : 40,
    }}>
      {/* Left: pill + sentence + subtext + micro-stats */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span className="pill signal">
            <Icon name="spark" size={12}/> {storyEyebrow(story.kind)}
          </span>
          {rangeLabel && <span className="eyebrow">{rangeLabel}</span>}
        </div>

        <div className="display" style={{
          fontSize: isMobile ? 24 : 38, lineHeight: 1.12, color: 'var(--tx-hi)',
          letterSpacing: '-0.03em', marginBottom: 14, maxWidth: 560,
        }}>
          {renderSentenceWithHighlight(story.sentence, story.highlight)}
        </div>

        {subtext && (
          <p style={{
            font: '400 15px/1.55 var(--font-ui)',
            color: 'var(--tx-md)', maxWidth: 520, margin: 0,
          }}>
            {subtext}
          </p>
        )}

        {microStats.length > 0 && (
          <div style={{ display: 'flex', gap: 28, marginTop: 26, flexWrap: 'wrap' }}>
            {microStats.map(m => (
              <div key={m.k} style={{
                paddingLeft: m.hi ? 14 : 0,
                borderLeft: m.hi ? `2px solid ${m.isPB ? 'var(--lime-eff)' : 'var(--signal-eff)'}` : 'none',
              }}>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>{m.k}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="mono" style={{
                    font: '700 28px var(--font-mono)',
                    color: m.isPB ? 'var(--lime-eff)' : 'var(--tx-hi)',
                  }}>{m.v}</span>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--tx-lo)' }}>{m.u}</span>
                </div>
                {Number.isFinite(m.d) && (
                  <div style={{ marginTop: 4 }}>
                    <Delta value={m.d} unit={m.u} goodDir="down"/>
                  </div>
                )}
                {m.isPB && (
                  <div style={{ marginTop: 6 }}>
                    <span className="pill lime"><Icon name="trophy" size={10}/> NEW PB</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: chart column (only when we have enough points) */}
      {hasChart && (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            gap: 10,
          }}>
            <span className="eyebrow" style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {metricLabel} · LAST {sparkSlice.length}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>seconds</span>
          </div>

          <HeroTrendChart data={sparkData} avg={chartAvg}/>

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
          }}>
            <span>{longMonthDay(sparkFirst?.date)}</span>
            {sparkSlice.length >= 3 && <span>{longMonthDay(sparkMid?.date)}</span>}
            <span>{longMonthDay(sparkLast?.date)}</span>
          </div>
        </div>
      )}

      {/* Top-right action slot — Request / Buy / Try button with
          quota caption. Replaces the decorative lightning mark. */}
      {actionSlot}
    </div>
  );
};

// ── HeadlineEmpty — shown when the athlete has no races yet ──

const HeadlineEmpty = ({ athleteName, actionSlot }) => (
  <div className="card" style={{
    padding: '76px 36px 32px 36px', position: 'relative', overflow: 'hidden',
    background: 'var(--bg-2)', borderRadius: 20,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <span className="pill signal"><Icon name="spark" size={12}/> TODAY</span>
    </div>
    <div className="display" style={{
      fontSize: 34, lineHeight: 1.08, color: 'var(--tx-hi)',
      letterSpacing: '-0.03em', marginBottom: 14, maxWidth: 560,
    }}>
      {athleteName ? `Welcome, ${athleteName}.` : 'Welcome.'}
    </div>
    <p style={{
      font: '400 15px/1.55 var(--font-ui)',
      color: 'var(--tx-md)', maxWidth: 520, margin: 0,
    }}>
      Your deck lights up with your first race. Request your first analysis
      from the button above — once processed, you'll see how you stacked up,
      what moved, and where to look next.
    </p>
    {actionSlot}
  </div>
);

// ── FocusCards (v00.60) ───────────────────────────────────────
// Three modality summary cards on the AthleteDeck — Starts /
// Turns / Races. Each card surfaces the headline metric + a small
// sparkline of recent values + delta vs 30 d avg.
//
// Mirrors the design-reference `FocusCards` (web-deck.jsx
// lines 106-140) but data-driven from the athlete's own trial
// stream rather than the static mock the design used.
//
// Lives between the hero and the 2-col grid in `AthleteDeck`.

// Inline sparkline. ~88 px wide, normalizes to its own min/max
// with a small headroom so the line never slams the top/bottom.
const FocusSpark = ({ data, color, width, height }) => {
  if (!data || data.length < 2) {
    return <span style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)' }}>—</span>;
  }
  const W = width  || 88;
  const H = height || 34;
  const PAD = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = (max - min) || 1;
  const xOf = (i) => PAD + (i / (data.length - 1)) * (W - 2 * PAD);
  const yOf = (v) => PAD + (1 - (v - min) / range) * (H - 2 * PAD);
  const path = window.PA_SVG.smoothPath(data.map((v, i) => [xOf(i), yOf(v)]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
         style={{ display: 'block', overflow: 'visible' }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={xOf(data.length - 1)} cy={yOf(data[data.length - 1])}
              r="2.6" fill={color}/>
    </svg>
  );
};

// Per-modality data loader. Returns the headline payload the
// FocusCard renders, or null when no data is available.
//
//   { latest, spark, delta30d, isPB, eventLabel? }
//
// `latest` is the most recent metric value (in the trailing 90 d
// window so the sparkline has enough history to be meaningful).
// `spark` is up to the last 8 values in chronological order.
// `delta30d` is `latest - avg(last_30d)`. `isPB` flags when the
// latest value is the lowest in the loaded window — a soft PB
// proxy without doing a separate all-time-best query.
async function loadFocusModality({ view, metric, athleteUuid, sameEventOnly }) {
  if (!athleteUuid) return null;
  try {
    const sinceDate = new Date(Date.now() - 90 * 86400000)
      .toISOString().slice(0, 10);
    const select = sameEventOnly
      ? `${metric}, source_date, style, distance_m, course`
      : `${metric}, source_date`;
    const { data, error } = await window.supabaseClient
      .from(view)
      .select(select)
      .eq('athlete_uuid', athleteUuid)
      .not(metric, 'is', null)
      .gte('source_date', sinceDate)
      .order('source_date', { ascending: false })
      .limit(30);
    if (error || !data || !data.length) return null;

    let rows = data;
    let eventLabel = null;
    // For races, filter the trailing window to the latest race's
    // event so the sparkline + delta are apples-to-apples. A 50
    // free spark next to a 1500 spark would show a fake recovery.
    if (sameEventOnly) {
      const latest = data[0];
      rows = data.filter(r =>
        Number(r.distance_m) === Number(latest.distance_m) &&
        String(r.style || '').toLowerCase() ===
          String(latest.style || '').toLowerCase()
      );
      const dist  = latest.distance_m;
      const style = latest.style;
      const course = latest.course;
      eventLabel = (dist ? dist + ' ' : '')
        + (style ? style.charAt(0).toUpperCase() + style.slice(1) : '')
        + (course ? ' · ' + course : '');
    }
    if (!rows.length) return null;

    const values = rows.map(r => parseFloat(r[metric])).filter(v => !isNaN(v));
    if (!values.length) return null;
    const latest = values[0];

    // 30-day average for the delta line.
    const cutoff30 = new Date(Date.now() - 30 * 86400000)
      .toISOString().slice(0, 10);
    const within30 = rows
      .filter(r => r.source_date >= cutoff30)
      .map(r => parseFloat(r[metric]))
      .filter(v => !isNaN(v));
    const avg30 = within30.length
      ? within30.reduce((s, v) => s + v, 0) / within30.length
      : latest;

    // Sparkline — chronological order (oldest left, newest right).
    const spark = values.slice(0, 8).reverse();

    // Soft PB detection — latest matches the loaded-window
    // minimum within tolerance. Not all-time, but a coachable
    // recent-best signal.
    const minVal = Math.min(...values);
    const isPB = Math.abs(latest - minVal) < 0.005 && values.length >= 2;

    return {
      latest, spark,
      delta30d: +(latest - avg30).toFixed(2),
      isPB,
      eventLabel,
    };
  } catch (e) {
    return null;
  }
}

const FocusCard = ({ label, metric, value, unit, delta, spark, isPB,
                     eventLabel, sparkColor, fmtFn }) => {
  const tone = delta == null || delta === 0 ? 'var(--tx-lo)'
    : delta < 0 ? 'var(--lime-eff)' : 'var(--flag-eff)';
  const valueColor = isPB ? 'var(--lime-eff)' : 'var(--tx-hi)';

  return (
    <div className="card" style={{
      padding: 20, position: 'relative', overflow: 'hidden',
      background: 'var(--bg-2)',
      border: '1px solid ' + (isPB
        ? 'color-mix(in oklch, var(--lime-eff) 35%, transparent)'
        : 'var(--line-soft)'),
      borderRadius: 14,
    }}>
      {/* Lime accent bar at the top edge when PB */}
      {isPB && <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'var(--lime-eff)',
      }}/>}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{label}</span>
        {isPB && (
          <span className="pill lime" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10,
          }}>
            NEW PB
          </span>
        )}
      </div>
      <div style={{
        font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
        marginBottom: 8,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {eventLabel || metric}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          {value == null ? (
            <span className="mono" style={{
              font: '700 28px var(--font-mono)', color: 'var(--tx-lo)',
              letterSpacing: '-0.01em',
            }}>—</span>
          ) : (
            <span className="mono" style={{
              font: '700 28px var(--font-mono)', color: valueColor,
              letterSpacing: '-0.01em',
            }}>
              {fmtFn ? fmtFn(value) : value.toFixed(2)}
            </span>
          )}
          {value != null && unit && !(fmtFn && fmtFn(value).indexOf(':') >= 0) && (
            <span className="mono" style={{ fontSize: 13, color: 'var(--tx-lo)' }}>{unit}</span>
          )}
        </div>
        <FocusSpark data={spark} color={sparkColor} width={88} height={34}/>
      </div>
      <div style={{
        marginTop: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span className="mono" style={{
          font: '600 12px var(--font-mono)', color: tone,
        }}>
          {delta == null
            ? '—'
            : (delta > 0 ? '+' : '') + delta.toFixed(2) + (unit ? ' ' + unit : '')}
        </span>
        <span className="mono" style={{
          fontSize: 10, color: 'var(--tx-lo)', letterSpacing: 0.04,
        }}>
          vs 30 d avg
        </span>
      </div>
    </div>
  );
};

const FocusCards = ({ athleteUuid }) => {
  const [state, setState] = useDeckState({
    starts: null, turns: null, races: null, loading: true,
  });

  useDeckEffect(() => {
    let cancelled = false;
    if (!athleteUuid) {
      setState({ starts: null, turns: null, races: null, loading: false });
      return () => { cancelled = true; };
    }
    (async () => {
      const [starts, turns, races] = await Promise.all([
        loadFocusModality({
          view: 'v_start_kpis', metric: 'split_15m_s',
          athleteUuid,
        }),
        loadFocusModality({
          view: 'v_turn_kpis', metric: 'time_15in_15out_s',
          athleteUuid,
        }),
        loadFocusModality({
          view: 'v_race_kpis', metric: 'race_time_s',
          athleteUuid, sameEventOnly: true,
        }),
      ]);
      if (cancelled) return;
      setState({ starts, turns, races, loading: false });
    })();
    return () => { cancelled = true; };
  }, [athleteUuid]);

  // Destructure with defaults so the render below never sees
  // optional chaining inside JSX attribute values — keeps Babel
  // standalone happy and reads cleaner anyway.
  const sData = state.starts || {};
  const tData = state.turns  || {};
  const rData = state.races  || {};

  // Time formatter. Uses fmtTime when available so race times of
  // a minute or more render as M:SS.dd. Strips trailing space-s
  // because FocusCard handles unit display separately.
  const fmtFn = (window.PA_KPIS && window.PA_KPIS.fmtTime)
    ? function (v) {
        const out = window.PA_KPIS.fmtTime(v, 2);
        return out.replace(/ s$/, '');
      }
    : function (v) { return v.toFixed(2); };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 16,
    }}>
      <FocusCard
        label="STARTS"
        metric="Time to 15 m"
        value={sData.latest}
        unit="s"
        delta={sData.delta30d}
        spark={sData.spark}
        isPB={sData.isPB}
        sparkColor="var(--signal-eff)"
        fmtFn={fmtFn}
      />
      <FocusCard
        label="TURNS"
        metric="15-in / 15-out"
        value={tData.latest}
        unit="s"
        delta={tData.delta30d}
        spark={tData.spark}
        isPB={tData.isPB}
        sparkColor="var(--signal-eff)"
        fmtFn={fmtFn}
      />
      <FocusCard
        label="RACES"
        metric="Most recent"
        eventLabel={rData.eventLabel}
        value={rData.latest}
        unit="s"
        delta={rData.delta30d}
        spark={rData.spark}
        isPB={rData.isPB}
        sparkColor="var(--signal-eff)"
        fmtFn={fmtFn}
      />
    </div>
  );
};

// ── Next Focus card (v00.63) ─────────────────────────────────
//
// Builds on the FocusCards modality readers. For each of starts /
// turns / races, computes:
//
//   current = avg of last 4 trials (per-event for races)
//   target  = soft PB (min value in trailing 90 d window)
//   gap     = (current - target) / target           // relative
//
// Picks the modality with the LARGEST relative gap and surfaces it
// as a coachable headline + CURRENT / YOU / TARGET progress bar.
// Stroke filter narrows the scan to a single style across all
// three modalities.
//
// Phase 1 — rule-based ranking. Phase 4 — Pulse AI Haiku polishes
// the headline copy with athlete-specific context (see P-11).

async function loadNextFocus({ athleteUuid, strokeFilter }) {
  if (!athleteUuid) return null;
  try {
    const sinceDate = new Date(Date.now() - 90 * 86400000)
      .toISOString().slice(0, 10);

    // v_start_kpis and v_turn_kpis only expose the metric +
    // source_date (verified against the live v02.29 file — `style`
    // and `distance_m` aren't on those views). Selecting them here
    // would error out the query and silently return [], which is
    // exactly the v00.63 bug. v_race_kpis carries the event
    // metadata, so the stroke filter can only narrow races; starts
    // and turns are pooled across all strokes.
    const fetchSimple = async (view, metric) => {
      const { data, error } = await window.supabaseClient
        .from(view)
        .select(`${metric}, source_date`)
        .eq('athlete_uuid', athleteUuid)
        .not(metric, 'is', null)
        .gte('source_date', sinceDate)
        .order('source_date', { ascending: false })
        .limit(60);
      if (error || !data) return [];
      return data
        .map(r => ({ v: parseFloat(r[metric]), d: r.source_date }))
        .filter(r => !isNaN(r.v));
    };

    const fetchRaces = async () => {
      const { data, error } = await window.supabaseClient
        .from('v_race_kpis')
        .select('race_time_s, source_date, style, distance_m')
        .eq('athlete_uuid', athleteUuid)
        .not('race_time_s', 'is', null)
        .gte('source_date', sinceDate)
        .order('source_date', { ascending: false })
        .limit(60);
      if (error || !data) return [];
      let rows = data;
      if (strokeFilter && strokeFilter !== 'all') {
        rows = rows.filter(r =>
          String(r.style || '').toLowerCase() === strokeFilter
        );
      }
      return rows
        .map(r => ({
          v: parseFloat(r.race_time_s),
          d: r.source_date,
          style: r.style,
          distance: r.distance_m,
        }))
        .filter(r => !isNaN(r.v));
    };

    const [starts, turns, races] = await Promise.all([
      fetchSimple('v_start_kpis', 'split_15m_s'),
      fetchSimple('v_turn_kpis',  'time_15in_15out_s'),
      fetchRaces(),
    ]);

    const candidates = [];
    const strokeAll = !strokeFilter || strokeFilter === 'all';

    // Starts — pooled across all 15 m starts. Only scored when the
    // filter is "All" because v_start_kpis can't be narrowed by
    // stroke (no style column on the view).
    if (strokeAll && starts.length >= 2) {
      const last4 = starts.slice(0, 4).map(r => r.v);
      const cur = last4.reduce((s, v) => s + v, 0) / last4.length;
      const tgt = Math.min(...starts.map(r => r.v));
      if (cur > tgt) {
        candidates.push({
          modality: 'starts',
          // v01.23 — translation key resolved at render time. Lets
          // EN ↔ ES toggles re-render the candidate label without
          // re-running the async fetch.
          labelKey: 'deck.nextFocus.cutStart',
          current: cur, target: tgt, unit: 's',
          gap: (cur - tgt) / tgt,
        });
      }
    }

    // Turns — same constraint as starts.
    if (strokeAll && turns.length >= 2) {
      const last4 = turns.slice(0, 4).map(r => r.v);
      const cur = last4.reduce((s, v) => s + v, 0) / last4.length;
      const tgt = Math.min(...turns.map(r => r.v));
      if (cur > tgt) {
        candidates.push({
          modality: 'turns',
          labelKey: 'deck.nextFocus.sharpenTurn',
          current: cur, target: tgt, unit: 's',
          gap: (cur - tgt) / tgt,
        });
      }
    }

    // Races — group by event (distance + style), then pick the
    // most recently-raced event so we don't compare a 50 free
    // current to a 1500 free target.
    if (races.length >= 2) {
      const byEvent = {};
      races.forEach(r => {
        const key = `${r.distance}|${r.style}`;
        if (!byEvent[key]) byEvent[key] = [];
        byEvent[key].push(r);
      });
      let bestKey = null, bestDate = '';
      Object.entries(byEvent).forEach(([k, arr]) => {
        if (arr[0].d > bestDate) { bestDate = arr[0].d; bestKey = k; }
      });
      if (bestKey) {
        const grp = byEvent[bestKey];
        if (grp.length >= 2) {
          const cur = grp[0].v;
          const tgt = Math.min(...grp.map(r => r.v));
          if (cur > tgt) {
            const styleStr = grp[0].style
              ? grp[0].style.charAt(0).toUpperCase() + grp[0].style.slice(1)
              : '';
            const evLabel = (grp[0].distance ? grp[0].distance + ' ' : '')
              + styleStr;
            candidates.push({
              modality: 'races',
              // v01.23 — store the dynamic event label as a slot;
              // labelKey + labelVars get interpolated at render
              // time so EN ↔ ES toggles re-render the wrapper
              // ("Chase your X PB" / "Persigue tu PB de X") without
              // re-fetching. The event string itself stays in
              // language-neutral domain notation (e.g. "100 Freestyle").
              labelKey:  'deck.nextFocus.chasePB',
              labelVars: { event: evLabel },
              current: cur, target: tgt, unit: 's',
              gap: (cur - tgt) / tgt,
            });
          }
        }
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.gap - a.gap);
    return candidates[0];
  } catch (e) {
    return null;
  }
}

const NextFocus = ({ athleteUuid }) => {
  const t = (window.useT || (() => (k) => k))();
  const [strokeFilter, setStrokeFilter] = useDeckState('all');
  const [state, setState] = useDeckState({ focus: null, loading: true });

  useDeckEffect(() => {
    let cancelled = false;
    if (!athleteUuid) {
      setState({ focus: null, loading: false });
      return () => { cancelled = true; };
    }
    setState(prev => ({ ...prev, loading: true }));
    (async () => {
      const focus = await loadNextFocus({ athleteUuid, strokeFilter });
      if (cancelled) return;
      setState({ focus, loading: false });
    })();
    return () => { cancelled = true; };
  }, [athleteUuid, strokeFilter]);

  // Time formatter matches FocusCards — strips trailing " s" since
  // we render the unit separately as a small caption next to the
  // number.
  const fmt = (v) => {
    const f = (window.PA_KPIS && window.PA_KPIS.fmtTime)
      ? window.PA_KPIS.fmtTime(v, 2)
      : v.toFixed(2) + ' s';
    return f.replace(/ s$/, '');
  };

  // YOU position — for lower-is-better metrics (all three are
  // times), proximity to PB = target / current. Clamp so the marker
  // never sits on the bar's edge.
  const youPct = state.focus
    ? Math.max(0.06, Math.min(0.94, state.focus.target / state.focus.current))
    : 0;

  // v01.23 — stroke pill labels translate via t(). Keys map to
  // deck.strokes.* — same set used by SquadFocus below for
  // consistency across athlete + coach pages.
  const strokes = [
    { key: 'all',    label: t('deck.strokes.all')    },
    { key: 'free',   label: t('deck.strokes.free')   },
    { key: 'back',   label: t('deck.strokes.back')   },
    { key: 'breast', label: t('deck.strokes.breast') },
    { key: 'fly',    label: t('deck.strokes.fly')    },
  ];

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, gap: 8, flexWrap: 'wrap',
      }}>
        <span className="eyebrow">{t('deck.nextFocus.eyebrow')}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {strokes.map(s => {
            const active = strokeFilter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStrokeFilter(s.key)}
                style={{
                  font: '600 10px var(--font-mono)',
                  letterSpacing: 0.04,
                  padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                  background: active ? 'var(--ink)' : 'transparent',
                  color: active ? 'var(--paper)' : 'var(--tx-md)',
                  border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-soft)'),
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.loading ? (
        <div style={{
          color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
          padding: '18px 0',
        }}>{t('common.loading')}</div>
      ) : !state.focus ? (
        <div style={{
          color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
          padding: '18px 0',
        }}>
          {strokeFilter === 'all'
            ? t('deck.nextFocus.needMore')
            : t('deck.nextFocus.needTwoSame')}
        </div>
      ) : (
        <>
          <div className="display" style={{
            fontSize: 18, lineHeight: 1.25, marginBottom: 18,
            letterSpacing: '-0.015em',
          }}>
            {/* v01.23 — labelKey resolved at render time. labelVars
                handles the {event} interpolation for the races
                branch. Older candidates shipped a `label` string
                directly; preserve back-compat as the fallback. */}
            {state.focus.labelKey
              ? t(state.focus.labelKey, state.focus.labelVars)
              : state.focus.label}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'baseline', gap: 12,
          }}>
            <div>
              <div className="eyebrow" style={{ fontSize: 9 }}>{t('deck.nextFocus.current')}</div>
              <div className="mono" style={{
                font: '700 18px var(--font-mono)',
                marginTop: 4, letterSpacing: '-0.01em',
              }}>
                {fmt(state.focus.current)}
                <span style={{ fontSize: 11, color: 'var(--tx-lo)', marginLeft: 3 }}>
                  {state.focus.unit}
                </span>
              </div>
            </div>
            <div style={{
              flex: 1, margin: '0 8px', height: 6, borderRadius: 3,
              background: 'var(--bg-3)', position: 'relative', alignSelf: 'center',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                width: (youPct * 100).toFixed(1) + '%',
                background: 'var(--signal-eff)', borderRadius: 3,
              }}/>
              <div style={{
                position: 'absolute',
                left: (youPct * 100).toFixed(1) + '%', top: -14,
                transform: 'translateX(-50%)',
                font: '600 10px var(--font-mono)', color: 'var(--signal-eff)',
              }}>{t('deck.nextFocus.you')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>{t('deck.nextFocus.target')}</div>
              <div className="mono" style={{
                font: '700 18px var(--font-mono)',
                marginTop: 4, color: 'var(--tx-md)',
                letterSpacing: '-0.01em',
              }}>
                {fmt(state.focus.target)}
                <span style={{ fontSize: 11, color: 'var(--tx-lo)', marginLeft: 3 }}>
                  {state.focus.unit}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Athlete Deck ─────────────────────────────────────────────

const AthleteDeck = ({ profile, fallbackEmail, authUserId, adminAthleteUuid }) => {
  // v00.48: super-admin "view as athlete" override. The data fetch
  // below uses this UUID instead of the signed-in user's
  // profile.athlete_uuid when set. usePARequests stays keyed on the
  // SIGNED-IN user — quota / credit / billing is the admin's account
  // state, not the impersonated athlete's.
  const effectiveAthleteUuid = adminAthleteUuid || profile?.athlete_uuid;
  const isMobile = (window.useIsMobile || (() => false))();
  const t = (window.useT || (() => (k) => k))();
  const [state, setState] = useDeckState({ loading: true, rows: [], error: null });

  // Modal controller — null | 'buy' | 'upload'. Which modal, if any.
  const [modal, setModal] = useDeckState(null);

  // Dev-only preview overrides (toggled via window.PA_DEV helpers).
  // Lets us force Pro/Free flavor of BuyAnalysisModal without changing
  // the underlying account state. Never set by production code paths.
  const [devOverride, setDevOverride] = useDeckState(null);

  // Console API for design review:
  //   PA_DEV.openBuy()               -> BuyAnalysisModal using real state
  //   PA_DEV.openBuy({ free:true })  -> force Free/Try variant
  //   PA_DEV.openBuy({ pro:true })   -> force Pro + quota-exceeded variant
  //   PA_DEV.openUpload()            -> UploadModal skeleton
  //   PA_DEV.close()                 -> close whichever is open
  useDeckEffect(() => {
    const onOpen = (e) => {
      const d = e.detail || {};
      // v01.73 — 'buy' lifted to App level (index.html). AthleteDeck
      // only owns 'upload' now, which is deck-internal (needs
      // effectiveAthleteUuid and retry prefill that don't make sense
      // outside the deck context).
      if (d.modal === 'upload') {
        setModal('upload');
        setDevOverride(d);
      } else if (d.modal === null) {
        setModal(null);
        setDevOverride(null);
      }
    };
    window.addEventListener('pa:open-modal', onOpen);
    // v01.26 — Object.assign so we don't clobber hooks installed by
    // earlier modules. i18n.js (v01.20) writes setLang/getLang here,
    // and shared.jsx's Toaster/ConfirmHost may already have hooks
    // installed before this AthleteDeck mounts.
    window.PA_DEV = Object.assign({}, window.PA_DEV || {}, {
      openBuy: (opts = {}) => window.dispatchEvent(new CustomEvent('pa:open-modal', {
        detail: { modal: 'buy', ...opts },
      })),
      openUpload: () => window.dispatchEvent(new CustomEvent('pa:open-modal', {
        detail: { modal: 'upload' },
      })),
      close: () => window.dispatchEvent(new CustomEvent('pa:open-modal', {
        detail: { modal: null },
      })),
      // v01.26 — toast + confirm test hooks. Useful for verifying
      // the API + visual without writing throw-away buttons.
      testToast: (type) => window.PA_TOAST?.show(
        type === 'error'   ? 'Something failed' :
        type === 'warning' ? 'Quota almost full' :
        type === 'success' ? 'Saved!' :
        'Welcome back',
        { type: type || 'info' }
      ),
      testConfirm: async (danger) => {
        if (!window.PA_CONFIRM) return null;
        return window.PA_CONFIRM.ask({
          title: danger ? 'Delete this goal?' : 'Confirm action',
          message: danger ? 'This is permanent.' : 'This will save your changes.',
          isDanger: !!danger,
        });
      },
    });
    try { console.log('[PA_DEV] ready · try PA_DEV.openBuy() / PA_DEV.openUpload() / PA_DEV.testToast() / PA_DEV.testConfirm(true)'); } catch (_) {}
    return () => window.removeEventListener('pa:open-modal', onOpen);
  }, []);

  // Requests / quota / subscription — single hook, used by the hero
  // action button AND the "Your requests" card. Script-tag order in
  // index.html guarantees usePARequests is defined before this file
  // executes, so we call it unconditionally (Rules of Hooks).
  const requestsState = window.usePARequests(profile?.athlete_uuid);

  // Decide which modal a button click should open.
  // v01.74 — 'buy' is owned by App-level state (index.html); dispatch
  // pa:open-modal so the App listener picks it up. 'upload' stays
  // deck-internal because it needs effectiveAthleteUuid + retry prefill.
  const onRequestClick = () => {
    if (requestsState.nextAction === 'upload') {
      setModal('upload');
    } else {
      window.dispatchEvent(new CustomEvent('pa:open-modal', {
        detail: { modal: 'buy' },
      }));
    }
  };

  useDeckEffect(() => {
    let cancelled = false;
    (async () => {
      const athleteUuid = effectiveAthleteUuid;
      if (!athleteUuid) {
        setState({ loading: false, rows: [], error: null });
        return;
      }
      const { data, error } = await PA_DATA.latestRaces(athleteUuid, { limit: 20 });
      if (cancelled) return;
      setState({ loading: false, rows: data, error });
    })();
    return () => { cancelled = true; };
  }, [effectiveAthleteUuid]);

  const athleteName = (profile?.first_name || '').trim() || null;

  // Shape rows → metric rows for analytics.
  const metricRows = PA_DATA.toRaceMetricRows(state.rows);

  // Prefer the athlete's most recent event to narrate the headline —
  // races across different distances/strokes aren't directly comparable.
  const mostRecent = metricRows[0] || null;
  const sameEventRowsDesc = mostRecent
    ? metricRows.filter(r =>
        r.raw.distance_m === mostRecent.raw.distance_m &&
        r.raw.style      === mostRecent.raw.style)
    : [];

  const A = PA_ANALYTICS;
  const sortedAsc = A.sortByDate(sameEventRowsDesc);
  const latestRow = sortedAsc[sortedAsc.length - 1] || null;
  const priorRow  = sortedAsc[sortedAsc.length - 2] || null;

  // Best-so-far (min race_time). Track "priorBest" = best excluding latest,
  // so we can describe the PB margin without giving away the new time.
  let bestRow = null, bestExcludingLatest = null;
  if (sortedAsc.length) {
    bestRow = sortedAsc.reduce((b, r) => (b == null || r.value < b.value) ? r : b, null);
    if (sortedAsc.length >= 2) {
      const rest = sortedAsc.slice(0, -1);
      bestExcludingLatest = rest.reduce((b, r) => (b == null || r.value < b.value) ? r : b, null);
    }
  }

  // Pack facts for the story engine.
  const facts = {
    athleteName,
    metric: 'race_time',
    latest: latestRow
      ? { value: latestRow.value, date: latestRow.date, event: latestRow.event }
      : null,
    rows: sameEventRowsDesc, // engine sorts internally
    unreadCoachNotes: [],
    lastSeenDays: null,
  };
  // v01.25 — pickStory respects the current language so es() templates
  // fire when ES is active. PA_STORY re-runs on every render via the
  // useT() subscription further up in AthleteDeck — when the lang
  // event fires, AthleteDeck re-renders and pickStory recomputes.
  const currentLang = (window.PA_I18N?.getLang?.() || 'en');
  const story = PA_STORY.pickStory(facts, { locale: currentLang });

  const metricLabel = mostRecent ? (mostRecent.event || 'RACE').toUpperCase() : 'RACE';

  // Render the action button once so we can inject it into either
  // hero variant (loaded, empty, or populated).
  const actionSlot = (
    <RequestAnalysisButton
      nextAction={requestsState.nextAction}
      quota={requestsState.quota}
      isTrialing={requestsState.isTrialing}
      trialDays={requestsState.trialDays}
      isPolling={requestsState.isPolling}
      onClick={onRequestClick}
    />
  );

  const headlineProps = {
    story,
    latest: latestRow,
    prior:  priorRow,
    best: bestRow ? {
      value: bestRow.value,
      date:  bestRow.date,
      priorBest: bestExcludingLatest ? bestExcludingLatest.value : null,
      priorDate: bestExcludingLatest ? bestExcludingLatest.date  : null,
    } : null,
    sameEventRows: sortedAsc,
    metricLabel,
    actionSlot,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Hero */}
      {state.loading ? (
        <div className="card" style={{
          padding: '32px 36px', background: 'var(--bg-2)', borderRadius: 20,
          position: 'relative',
        }}>
          {window.LoadingState
            ? <window.LoadingState label="Loading your deck…"/>
            : <span style={{ color: 'var(--tx-lo)', font: '500 14px var(--font-ui)' }}>Loading your deck…</span>}
          {actionSlot}
        </div>
      ) : metricRows.length === 0 ? (
        <HeadlineEmpty athleteName={athleteName} actionSlot={actionSlot}/>
      ) : (
        <HeadlineStory {...headlineProps}/>
      )}

      {/* v00.60: 3 modality summary cards — Starts / Turns /
          Races. Each shows headline metric + spark + delta vs
          30 d avg. Mirrors the design-reference FocusCards. */}
      <FocusCards athleteUuid={effectiveAthleteUuid}/>

      {/* Body — recent races + side column */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.6fr) minmax(260px, 1fr)',
        gap: 20,
      }}>
        {/* Recent races list */}
        <div className="card" style={{ padding: 20 }}>
          <SectionLabel>{t('deck.recentRaces.title')}</SectionLabel>
          {!state.rows.length ? (
            <div style={{ color: 'var(--tx-lo)', font: '500 12px var(--font-ui)', marginTop: 8 }}>
              {state.loading ? t('deck.recentRaces.loading') : t('deck.recentRaces.empty')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {state.rows.slice(0, 6).map((r, i, arr) => {
                const isSameEvent = mostRecent
                  && r.distance_m === mostRecent.raw.distance_m
                  && r.style === mostRecent.raw.style;
                const isLatest = i === 0;
                return (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: '64px 1fr auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 4px',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--line-soft)' : 'none',
                  }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                      {shortDate(r.source_date)}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        font: '500 13px var(--font-ui)',
                        color: isSameEvent ? 'var(--tx-hi)' : 'var(--tx-md)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {PA_DATA.fmtEvent(r.distance_m, r.style) || '—'}
                      </span>
                      {r.course && (
                        <span className="mono" style={{
                          fontSize: 10, color: 'var(--tx-lo)',
                          padding: '2px 6px', borderRadius: 4, background: 'var(--bg-3)',
                        }}>{r.course}</span>
                      )}
                      {isLatest && (
                        <span className="pill signal" style={{ fontSize: 9, padding: '2px 7px' }}>
                          LATEST
                        </span>
                      )}
                    </div>
                    <span className="mono" style={{
                      fontSize: 14, fontWeight: 700, color: 'var(--tx-hi)',
                    }}>
                      {PA_ANALYTICS.fmtTime(r.race_time_s)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right stack — Your requests → Next focus → From your coach → Next session */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <YourRequestsCard requestsState={requestsState} />

          {/* v00.63: NextFocus card — coachable gap surfaced from
              recent trials across starts / turns / races, with a
              stroke filter. */}
          <NextFocus athleteUuid={effectiveAthleteUuid} />

          <div className="card" style={{ padding: 18 }}>
            <SectionLabel>From your coach</SectionLabel>
            <div style={{
              color: 'var(--tx-lo)', font: '500 12px var(--font-ui)', marginTop: 8,
            }}>
              No notes yet.
            </div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <SectionLabel>Next session</SectionLabel>
            <div style={{
              color: 'var(--tx-lo)', font: '500 12px var(--font-ui)', marginTop: 8,
            }}>
              Not scheduled.
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}
      {/* v01.73 — 'buy' branch lifted to App level (index.html). The
          BuyAnalysisModal now mounts at App so it's reachable from the
          sidebar Request Analysis button on any tab, not just AthleteDeck. */}
      {modal === 'upload' && (
        <UploadModal
          athleteUuid={effectiveAthleteUuid}
          athleteName={[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.coach_name || null}
          athleteEmail={profile?.email || fallbackEmail || null}
          prefill={devOverride?.prefill || null}
          onClose={() => { setModal(null); setDevOverride(null); }}/>
      )}

      {state.error && (
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'color-mix(in oklch, var(--flag-eff) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--flag-eff) 30%, transparent)',
          color: 'var(--flag-eff)', font: '500 12px var(--font-ui)',
        }}>
          Could not load races: {state.error.message || 'unknown error'}
        </div>
      )}
    </div>
  );
};

// ── Coach Deck — minimal placeholder for now ─────────────────

// ── Coach helpers (v00.56 / v00.57) ───────────────────────────
// initials(athlete) — 2-letter avatar fill from first + last
const coachInitials = (a) => {
  const f = (a?.first_name || '').trim();
  const l = (a?.last_name  || '').trim();
  return ((f[0] || '') + (l[0] || '')).toUpperCase() || '?';
};

// Human-readable "X days ago" / "today" for a YYYY-MM-DD source_date.
const relativeDate = (iso) => {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const then = new Date(iso + 'T00:00:00');
  if (isNaN(then.getTime())) return iso;
  const diffDays = Math.floor((today - then) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)   return diffDays + 'd ago';
  if (diffDays < 30)  return Math.floor(diffDays / 7) + 'w ago';
  return Math.floor(diffDays / 30) + 'mo ago';
};

// Activity status flag from per-athlete stats. Drives the colored
// dot on the roster card + the row tag in TeamRosterPage.
//   active   — at least one trial in 7 days
//   recent   — at least one trial in 30 days
//   dormant  — nothing in 30 days
const activityStatus = (stats) => {
  if (!stats || stats.trials_30d === 0) return 'dormant';
  if (stats.trials_7d > 0) return 'active';
  return 'recent';
};
const STATUS_LABELS = { active: 'Active', recent: 'Recent', dormant: 'Dormant' };
const STATUS_COLORS = {
  active:  'var(--lime-eff)',
  recent:  'var(--signal-eff)',
  dormant: 'var(--tx-lo)',
};

// ── useTeamData (v00.57) ──────────────────────────────────────
// Shared data loader for CoachDeck and TeamRosterPage. Pulls
// athletes once, then calls loadTeamActivity to aggregate
// last-30-day stats per athlete.
const useTeamData = (teamUuid) => {
  const [athletes, setAthletes] = useDeckState([]);
  const [activity, setActivity] = useDeckState({ byAthlete: {}, totals: {} });
  const [loading,  setLoading]  = useDeckState(true);

  useDeckEffect(() => {
    let cancelled = false;
    if (!teamUuid) { setLoading(false); return () => { cancelled = true; }; }
    (async () => {
      const { data } = await window.PA_ADMIN.loadAthletes(teamUuid);
      if (cancelled) return;
      const list = data || [];
      setAthletes(list);
      const uuids = list.map(a => a.athlete_uuid).filter(Boolean);
      const act = await window.PA_ADMIN.loadTeamActivity(uuids, 30);
      if (cancelled) return;
      setActivity(act);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teamUuid]);

  return { athletes, activity, loading };
};

// ── SquadFocus (v00.65 — coach macroview of NextFocus) ────────
//
// Coach-facing equivalent of the athlete NextFocus card. Where
// NextFocus picks ONE coachable gap for ONE athlete, SquadFocus
// picks ONE squad-wide attention pattern: which modality has the
// most athletes slipping vs their 30 d average?
//
// Picker: window.PA_ADMIN.loadSquadFocus(athletes, strokeFilter).
// 3 batched RLS-filtered queries total — never per-athlete.
//
// Visual differs from NextFocus on purpose. There is no "team
// target" the way an athlete has a personal best, so the bar
// shows DISTRIBUTION (improving / holding / slipping) instead of
// CURRENT vs TARGET.
//
// Stroke filter: same constraint as athlete-side. Filter narrows
// races only; starts/turns are pooled (no `style` column on
// v_start_kpis / v_turn_kpis).

const SquadFocus = ({ athletes }) => {
  const t = (window.useT || (() => (k) => k))();
  const [strokeFilter, setStrokeFilter] = useDeckState('all');
  const [state, setState] = useDeckState({ focus: null, loading: true });

  useDeckEffect(() => {
    let cancelled = false;
    if (!athletes || !athletes.length) {
      setState({ focus: null, loading: false });
      return () => { cancelled = true; };
    }
    setState(prev => ({ ...prev, loading: true }));
    (async () => {
      const focus = await window.PA_ADMIN.loadSquadFocus(athletes, strokeFilter);
      if (cancelled) return;
      setState({ focus, loading: false });
    })();
    return () => { cancelled = true; };
  }, [athletes, strokeFilter]);

  const strokes = [
    { key: 'all',    label: t('deck.strokes.all')    },
    { key: 'free',   label: t('deck.strokes.free')   },
    { key: 'back',   label: t('deck.strokes.back')   },
    { key: 'breast', label: t('deck.strokes.breast') },
    { key: 'fly',    label: t('deck.strokes.fly')    },
  ];

  const f = state.focus;
  const total = f?.total || 1;
  const segImproving = f ? f.improving.length / total : 0;
  const segHolding   = f ? f.holding.length   / total : 0;
  const segSlipping  = f ? f.slipping.length  / total : 0;

  const NameList = ({ label, names, color }) => {
    if (!names || !names.length) return null;
    const shown = names.slice(0, 3);
    const more  = names.length - shown.length;
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ fontSize: 9, color }}>
          {label} · {names.length}
        </div>
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          marginTop: 4, lineHeight: 1.4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {shown.join(' · ')}{more > 0 ? ` · +${more}` : ''}
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ padding: 22 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, gap: 8, flexWrap: 'wrap',
      }}>
        <span className="eyebrow">{t('deck.squadFocus.eyebrow')}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {strokes.map(s => {
            const active = strokeFilter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStrokeFilter(s.key)}
                style={{
                  font: '600 10px var(--font-mono)',
                  letterSpacing: 0.04,
                  padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                  background: active ? 'var(--ink)' : 'transparent',
                  color: active ? 'var(--paper)' : 'var(--tx-md)',
                  border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-soft)'),
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.loading ? (
        <div style={{
          color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
          padding: '18px 0',
        }}>{t('deck.squadFocus.loading')}</div>
      ) : !f ? (
        <div style={{
          color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
          padding: '18px 0',
        }}>
          {strokeFilter === 'all'
            ? t('deck.squadFocus.notEnoughTrials')
            : t('deck.squadFocus.noSignalInStroke')}
        </div>
      ) : (
        <>
          <div className="display" style={{
            fontSize: 18, lineHeight: 1.3, marginBottom: 18,
            letterSpacing: '-0.015em',
          }}>
            {f.label}
          </div>

          {/* Distribution bar — improving / holding / slipping.
              Segments hidden when their count is zero. */}
          <div style={{
            display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden',
            background: 'var(--bg-3)', marginBottom: 14,
          }}>
            {segImproving > 0 && <div style={{
              width: (segImproving * 100).toFixed(1) + '%',
              background: 'var(--lime-eff)',
            }}/>}
            {segHolding > 0 && <div style={{
              width: (segHolding * 100).toFixed(1) + '%',
              background: 'var(--signal-eff)',
            }}/>}
            {segSlipping > 0 && <div style={{
              width: (segSlipping * 100).toFixed(1) + '%',
              background: 'var(--flag-eff)',
            }}/>}
          </div>

          <div style={{
            display: 'flex', gap: 16, flexWrap: 'wrap',
          }}>
            <NameList label="IMPROVING" names={f.improving} color="var(--lime-eff)"/>
            <NameList label="HOLDING"   names={f.holding}   color="var(--signal-eff)"/>
            <NameList label="SLIPPING"  names={f.slipping}  color="var(--flag-eff)"/>
          </div>
        </>
      )}
    </div>
  );
};

// ── TeamActivityFeed (v01.28) ────────────────────────────────
// Recent-session feed for the CoachDeck. Surfaces the last 12
// sessions across the team (start / turn / race), newest-first,
// each row click-through to the relevant analysis page scoped
// to that athlete.
//
// Coaches want zero work + info already there — this is that
// surface. Reads from existing v_start_kpis / v_turn_kpis /
// v_race_kpis (RLS-filtered). No new schema, no new RPC.
//
// Translation:
//   deck.coach.activity.title / loading / empty / today /
//   yesterday / daysAgo / typeStart / typeTurn / typeRace
//
// Stroke labels reuse deck.strokes.{free,back,breast,fly}.
const TeamActivityFeed = ({ athletes, onPickAthlete, navigateTo }) => {
  const t = (window.useT || (() => (k) => k))();
  const isMobile = (window.useIsMobile || (() => false))();
  const [items, setItems]     = useDeckState([]);
  const [loading, setLoading] = useDeckState(true);

  useDeckEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (!window.PA_ADMIN?.loadTeamActivityFeed) {
        if (!cancelled) { setItems([]); setLoading(false); }
        return;
      }
      const rows = await window.PA_ADMIN.loadTeamActivityFeed(athletes, { top: 12 });
      if (cancelled) return;
      setItems(rows || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [athletes]);

  // ── Helpers ────────────────────────────────────────────────
  const styleKey = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'free' || v === 'freestyle')          return 'free';
    if (v === 'back' || v === 'backstroke')         return 'back';
    if (v === 'breast' || v === 'breaststroke')     return 'breast';
    if (v === 'fly' || v === 'butterfly' || v === 'fly') return 'fly';
    return null;
  };
  const styleLabel = (s) => {
    const k = styleKey(s);
    return k ? t('deck.strokes.' + k) : (s || '');
  };
  const ageLabel = (date) => {
    if (!date) return '';
    const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
    if (isNaN(days)) return '';
    if (days <= 0) return t('deck.coach.activity.today');
    if (days === 1) return t('deck.coach.activity.yesterday');
    return t('deck.coach.activity.daysAgo', { n: days });
  };
  const fmtRaceTime = (s) => {
    if (s == null || isNaN(s)) return '';
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return m + ':' + r.toFixed(2).padStart(5, '0');
    }
    return s.toFixed(2);
  };
  const courseUnit = (course) => (course === 'SCY' ? 'yd' : 'm');

  const dotColor = (type) => ({
    race:  'var(--signal-eff)',
    start: 'var(--amber-eff)',
    turn:  'var(--violet-eff, var(--signal-eff))',
  }[type] || 'var(--tx-lo)');

  const buildLabel = (it) => {
    const stroke = styleLabel(it.style);
    if (it.type === 'race') {
      const dist  = it.distance != null ? it.distance + courseUnit(it.course) : '';
      const courseTag = it.course ? ' ' + it.course : '';
      const timeTag = it.raceTime != null ? ' · ' + fmtRaceTime(it.raceTime) : '';
      const evt = [dist, stroke].filter(Boolean).join(' ');
      return (evt + courseTag + timeTag).trim();
    }
    if (it.type === 'start') {
      return [stroke, it.reaction != null ? 'RT ' + it.reaction.toFixed(3) + 's' : null]
        .filter(Boolean).join(' · ');
    }
    return stroke; // turn
  };

  const onClick = (it) => {
    try {
      if (onPickAthlete) onPickAthlete({ uuid: it.uuid, name: it.name });
      const navPage = it.type === 'race' ? 'races' : it.type === 'start' ? 'starts' : 'turns';
      // navigateTo is optional — if not wired, focus is at least
      // set on the athlete via onPickAthlete.
      if (navigateTo) setTimeout(() => navigateTo(navPage), 60);
    } catch (_) {}
  };

  // ── Render ─────────────────────────────────────────────────
  const Header = () => (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 8, marginBottom: 10,
    }}>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
        {t('deck.coach.activity.title')}
      </div>
      <span style={{
        font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
      }}>
        {items.length ? items.length : ''}
      </span>
    </div>
  );

  if (loading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <Header/>
        <div style={{
          padding: '12px 4px', font: '500 12px var(--font-ui)',
          color: 'var(--tx-lo)',
        }}>
          {t('deck.coach.activity.loading')}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <Header/>
        <div style={{
          padding: '12px 4px', font: '500 12px var(--font-ui)',
          color: 'var(--tx-lo)',
        }}>
          {t('deck.coach.activity.empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <Header/>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((it, i) => {
          const typeText =
            it.type === 'race'  ? t('deck.coach.activity.typeRace')  :
            it.type === 'start' ? t('deck.coach.activity.typeStart') :
                                  t('deck.coach.activity.typeTurn');
          const label = buildLabel(it);
          return (
            <button key={i} type="button"
              onClick={() => onClick(it)}
              style={{
                all: 'unset',
                display: 'grid',
                gridTemplateColumns: isMobile ? '10px 1fr auto' : '10px 1fr 1fr auto',
                alignItems: 'center', gap: 10,
                padding: '10px 6px',
                borderTop: i ? '1px solid var(--line-soft)' : 'none',
                cursor: 'pointer',
                borderRadius: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background =
                'color-mix(in oklch, var(--signal-eff) 6%, transparent)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <span aria-hidden="true" style={{
                width: 8, height: 8, borderRadius: '50%',
                background: dotColor(it.type),
              }}/>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{it.name}</div>
                {isMobile && (
                  <div style={{
                    font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
                    marginTop: 2, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span style={{ color: 'var(--tx-lo)' }}>{typeText}</span>
                    {label && <span> · {label}</span>}
                  </div>
                )}
              </div>
              {!isMobile && (
                <div style={{
                  font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  <span style={{ color: 'var(--tx-lo)' }}>{typeText}</span>
                  {label && <span> · {label}</span>}
                </div>
              )}
              <span style={{
                font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
                whiteSpace: 'nowrap', textAlign: 'right',
              }}>
                {ageLabel(it.date)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── CoachSquadKPIs (v00.57) ───────────────────────────────────
// Four-tile rail summarizing team activity. Mirrors the athlete-
// side summary-rail pattern (signal eyebrow + big mono value +
// optional sub).
const CoachSquadKPIs = ({ totals, rosterSize }) => {
  const t = (window.useT || (() => (k) => k))();
  const Tile = ({ label, value, sub }) => (
    <div className="card" style={{
      padding: 14, borderRadius: 12,
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      minWidth: 0,
    }}>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)', marginBottom: 10 }}>
        {label}
      </div>
      <div className="mono" style={{
        font: '700 22px var(--font-mono)', color: 'var(--tx-hi)',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 12,
    }}>
      <Tile label={t('deck.coach.kpiRoster')}    value={rosterSize ?? '—'}
            sub={t('deck.coach.kpiRosterSub')}/>
      <Tile label={t('deck.coach.kpiActive7d')}  value={(totals?.active_7d ?? 0) + ' / ' + (rosterSize ?? 0)}
            sub={t('deck.coach.kpiActive7dSub')}/>
      <Tile label={t('deck.coach.kpiSessions7d')} value={totals?.sessions_7d ?? 0}
            sub={t('deck.coach.kpiSessions7dSub')}/>
      <Tile label={t('deck.coach.kpiSessions30d')} value={totals?.sessions_30d ?? 0}
            sub={t('deck.coach.kpiSessions30dSub')}/>
    </div>
  );
};

// ── CoachRoster (v00.56, expanded v00.57) ─────────────────────
// Roster grid driven by athletes + per-athlete activity stats
// from useTeamData. Each card shows initials, name, status dot,
// last session relative date, trials this month, and a
// "View as athlete →" button.
const CoachRoster = ({ athletes, activity, onPickAthlete }) => {
  if (!athletes.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>YOUR TEAM · ROSTER</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
          {athletes.length} {athletes.length === 1 ? 'athlete' : 'athletes'}
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 12,
      }}>
        {athletes.map(a => {
          const stats   = activity?.byAthlete?.[a.athlete_uuid] || {};
          const status  = activityStatus(stats);
          const dotCol  = STATUS_COLORS[status];
          return (
            <div key={a.athlete_uuid} className="card" style={{
              padding: 16, borderRadius: 14,
              display: 'flex', flexDirection: 'column', gap: 12,
              background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
                  color: 'var(--signal-eff)',
                  font: '700 13px var(--font-ui)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative',
                }}>
                  {coachInitials(a)}
                  {/* Status dot — top-right corner of the avatar */}
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 10, height: 10, borderRadius: '50%',
                    background: dotCol,
                    border: '2px solid var(--bg-2)',
                  }}/>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    font: '600 14px var(--font-ui)', color: 'var(--tx-hi)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {window.PA_ADMIN.athleteName(a)}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--tx-lo)', marginTop: 2,
                    display: 'flex', gap: 8, alignItems: 'center',
                  }}>
                    <span style={{ color: dotCol, fontWeight: 600 }}>
                      {STATUS_LABELS[status]}
                    </span>
                    <span>·</span>
                    <span>
                      {stats.last_session ? relativeDate(stats.last_session) : 'no sessions'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Mini stat — trials this month */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              }}>
                <span>Sessions this month</span>
                <span className="mono" style={{ color: 'var(--tx-hi)', fontWeight: 700 }}>
                  {stats.trials_30d || 0}
                </span>
              </div>
              <button
                onClick={() => onPickAthlete && onPickAthlete({
                  uuid: a.athlete_uuid,
                  name: window.PA_ADMIN.athleteName(a),
                })}
                style={{
                  padding: '8px 12px', borderRadius: 10,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--tx-hi)', font: '600 12px var(--font-ui)',
                  cursor: 'pointer', letterSpacing: 0.04,
                  textTransform: 'uppercase',
                }}>
                View as athlete →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── GenderChip (v01.33 — Batch 7b) ──────────────────────────
//
// Small attention pill rendered next to a roster row's name when
// `athletes.gender` is null/empty. Coaches can quickly spot
// athletes missing this field — required for gender-filtered
// leaderboards (Batch 8). Clickable: opens RosterRowMenu directly
// to the gender sub-menu.
const GenderChip = ({ onClick }) => {
  const t = (window.useT || (() => (k) => k))();
  return (
    <button type="button"
      onClick={onClick}
      title={t('team.manage.genderMissing')}
      style={{
        all: 'unset',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 6px', borderRadius: 5,
        background: 'color-mix(in oklch, var(--amber-eff) 14%, transparent)',
        color: 'var(--amber-eff)',
        font: '700 9px var(--font-ui)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        cursor: 'pointer',
      }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: 'var(--amber-eff)',
      }}/>
      ?
    </button>
  );
};

// ── RosterRowMenu (v01.33 — Batch 7b) ───────────────────────
//
// 3-dot trigger that opens a small dropdown panel. Two action
// groups: Set gender (with submenu Male / Female / Clear) and
// Remove from team (danger). Used inline on roster rows in both
// CoachRoster cards and TeamRosterPage table rows.
//
// Click outside to dismiss. Esc to dismiss. Auto-dismisses after
// any action fires its confirm dialog.
//
// Props:
//   athlete: row from athletes table (athlete_uuid, first_name,
//            last_name, gender)
//   onChange: optional callback fired after a successful
//             remove/gender update so the parent can refetch.
const RosterRowMenu = ({ athlete, onChange, canRemove = false }) => {
  const t = (window.useT || (() => (k) => k))();
  const [open, setOpen] = useDeckState(false);
  const [submenu, setSubmenu] = useDeckState(null); // null | 'gender'
  const [busy, setBusy] = useDeckState(false);
  // v01.34 — pos in viewport coords. Lets the dropdown escape
  // any overflow:hidden ancestor (the roster table card clips
  // its overflow for the rounded bottom corners). Recomputed on
  // open + scroll + resize so the menu tracks the trigger.
  const [pos, setPos] = useDeckState({ top: 0, right: 0, openUp: false });
  const wrapperRef  = React.useRef(null);
  const triggerRef  = React.useRef(null);

  // v01.34 — gender immutability. Once a gender is set, coaches
  // cannot change or clear it from this menu (locked decision
  // 2026-05-07). The amber "?" chip only renders when gender is
  // unset, so this is visually consistent.
  const hasGender = athlete?.gender === 'male' || athlete?.gender === 'female';

  // v01.35 — when the menu would be empty (gender already set
  // AND user isn't the team owner so can't Remove), don't render
  // the trigger at all. Cleaner row + saves a useless click.
  const showGenderEntry = !hasGender;
  const showRemoveEntry = !!canRemove;
  const hasAnyAction = showGenderEntry || showRemoveEntry;
  if (!hasAnyAction) return null;

  const recomputePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Estimated menu dimensions — height varies by submenu state
    // but a single value works for both since the gap from trigger
    // is generous.
    const MENU_HEIGHT = 130;
    const openUp = (r.bottom + MENU_HEIGHT + 8) > window.innerHeight
                && (r.top - MENU_HEIGHT - 8) > 0;
    setPos({
      top:    openUp ? Math.max(8, r.top - MENU_HEIGHT - 4) : r.bottom + 4,
      // Right-anchored: keep menu's right edge aligned with the
      // trigger's right edge regardless of menu width.
      right:  Math.max(8, window.innerWidth - r.right),
      openUp,
    });
  };

  // Click-outside + Esc + recompute-on-scroll/resize.
  useDeckEffect(() => {
    if (!open) return undefined;
    recomputePos();
    const onDoc = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false); setSubmenu(null);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); setSubmenu(null); }
    };
    const onScrollResize = () => recomputePos();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open]);

  const fullName = [athlete?.first_name, athlete?.last_name]
    .filter(Boolean).join(' ').trim() || '—';

  const onRemove = async () => {
    setOpen(false); setSubmenu(null);
    const proceed = await window.PA_CONFIRM?.ask({
      title:    t('team.manage.removeConfirmTitle'),
      message:  t('team.manage.removeConfirmBody', { name: fullName }),
      isDanger: true,
    });
    if (!proceed) return;
    setBusy(true);
    const { ok } = await window.PA_TEAMS.removeMember(
      athlete.athlete_uuid, 'athlete'
    );
    setBusy(false);
    if (!ok) {
      try { window.PA_TOAST?.show(t('team.manage.toastRemoveError'), { type: 'error' }); } catch (_) {}
      return;
    }
    try { window.PA_TOAST?.show(t('team.manage.toastRemoved', { name: fullName }), { type: 'success' }); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
    onChange?.();
  };

  const onSetGender = async (value) => {
    setOpen(false); setSubmenu(null);
    setBusy(true);
    const { ok } = await window.PA_TEAMS.updateAthleteGender(
      athlete.athlete_uuid, value
    );
    setBusy(false);
    if (!ok) {
      try { window.PA_TOAST?.show(t('team.manage.toastGenderError'), { type: 'error' }); } catch (_) {}
      return;
    }
    try { window.PA_TOAST?.show(t('team.manage.toastGenderSaved', { name: fullName }), { type: 'success' }); } catch (_) {}
    onChange?.();
  };

  const itemBase = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 12px',
    background: 'transparent', border: 'none',
    color: 'var(--tx-md)',
    font: '500 12px var(--font-ui)',
    cursor: 'pointer', textAlign: 'left',
  };

  return (
    <div ref={wrapperRef} style={{ display: 'inline-block' }}>
      <button ref={triggerRef} type="button"
        onClick={() => { setOpen(o => !o); setSubmenu(null); }}
        disabled={busy}
        title={t('team.manage.menuOpen')}
        aria-label={t('team.manage.menuOpen')}
        style={{
          all: 'unset',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 8,
          color: 'var(--tx-md)',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.5 : 1,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6"/>
          <circle cx="12" cy="12" r="1.6"/>
          <circle cx="12" cy="19" r="1.6"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          right: pos.right,
          minWidth: 180,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: 'var(--shadow)',
          padding: 4,
          zIndex: 1200,
        }}>
          {submenu === 'gender' ? (
            <>
              <button type="button" onClick={() => onSetGender('male')}
                style={itemBase}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                {t('team.manage.menuSetGenderMale')}
              </button>
              <button type="button" onClick={() => onSetGender('female')}
                style={itemBase}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                {t('team.manage.menuSetGenderFemale')}
              </button>
              {/* v01.34 — Clear option removed per locked rule:
                  once gender is set, it cannot be changed or
                  cleared from the coach UI. */}
            </>
          ) : (
            <>
              {/* v01.34 — Set gender entry only renders when the
                  athlete has no gender yet. Once set, it's locked
                  in from this surface. */}
              {showGenderEntry && (
                <button type="button" onClick={() => setSubmenu('gender')}
                  style={itemBase}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
                  <span style={{ flex: 1 }}>{t('team.manage.menuSetGender')}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              )}
              {/* v01.35 — Remove entry only when the current user
                  is the team owner. Server-side RLS gates the
                  UPDATE to owners only; hiding the affordance
                  prevents the 403. */}
              {showGenderEntry && showRemoveEntry && (
                <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 8px' }}/>
              )}
              {showRemoveEntry && (
                <button type="button" onClick={onRemove}
                  style={{ ...itemBase, color: 'var(--flag-eff)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background =
                    'color-mix(in oklch, var(--flag-eff) 8%, transparent)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                  {t('team.manage.menuRemove')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── CoachesList (v01.33 — Batch 7b) ─────────────────────────
//
// Read-only section listing all coaches on a team. Active +
// pending statuses both render with status pills. The current
// user's own row is tagged "You" (and " · Owner" if they're the
// team_owner_uuid match). Active coaches list is sorted by
// coach_name; pending coaches sit at the bottom in a subtle
// separator group.
//
// teamUuid: required.
// myAuthId: optional — when supplied, the current user gets a
//           "You" tag. Pulled from session.user.id by parent.
const CoachesList = ({ teamUuid, myAuthId, ownerAuthId }) => {
  const t = (window.useT || (() => (k) => k))();
  const [state, setState] = useDeckState({ rows: [], loading: true, error: null });

  useDeckEffect(() => {
    if (!teamUuid || !window.PA_TEAMS?.listTeamCoaches) {
      setState({ rows: [], loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((p) => ({ ...p, loading: true, error: null }));
    (async () => {
      const { coaches, error } = await window.PA_TEAMS.listTeamCoaches(teamUuid);
      if (cancelled) return;
      setState({ rows: coaches, loading: false, error });
    })();
    const onChange = () => {
      (async () => {
        const { coaches, error } = await window.PA_TEAMS.listTeamCoaches(teamUuid);
        if (!cancelled) setState({ rows: coaches, loading: false, error });
      })();
    };
    window.addEventListener('pa:profile-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('pa:profile-changed', onChange);
    };
  }, [teamUuid]);

  if (state.loading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('team.coaches.title')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('team.coaches.loading')}
        </div>
      </div>
    );
  }

  if (!state.rows.length) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('team.coaches.title')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('team.coaches.empty')}
        </div>
      </div>
    );
  }

  // Sort: active first then pending; within each group alpha.
  const sorted = [...state.rows].sort((a, b) => {
    if (a.membership_status !== b.membership_status) {
      if (a.membership_status === 'active') return -1;
      if (b.membership_status === 'active') return 1;
    }
    return (a.coach_name || '').localeCompare(b.coach_name || '');
  });

  const statusPill = (status) => {
    const accent = status === 'active' ? 'var(--lime-eff)' : 'var(--amber-eff)';
    const label  = status === 'active'
      ? t('team.coaches.statusActive')
      : t('team.coaches.statusPending');
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 5,
        background: 'color-mix(in oklch, ' + accent + ' 14%, transparent)',
        color: accent,
        font: '700 9px var(--font-ui)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent }}/>
        {label}
      </span>
    );
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: 10,
      }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
          {t('team.coaches.title')}
        </div>
        <span style={{
          font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
        }}>
          {state.rows.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((c, i) => {
          const isMe    = myAuthId && c.auth_user_id === myAuthId;
          const isOwner = ownerAuthId && c.auth_user_id === ownerAuthId;
          return (
            <div key={c.coach_uuid} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0',
              borderTop: i ? '1px solid var(--line-soft)' : 'none',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
                color: 'var(--signal-eff)',
                font: '700 11px var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {(c.coach_name || 'C').charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {c.coach_name || '—'}
                  {isMe && (
                    <span style={{
                      marginLeft: 6,
                      font: '500 11px var(--font-ui)',
                      color: 'var(--tx-lo)',
                    }}>
                      ({t('team.coaches.you')})
                    </span>
                  )}
                  {isOwner && (
                    <span style={{
                      marginLeft: 6,
                      padding: '1px 6px', borderRadius: 4,
                      background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
                      color: 'var(--signal-eff)',
                      font: '700 9px var(--font-ui)',
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                      {t('team.coaches.labelOwner')}
                    </span>
                  )}
                </div>
              </div>
              {statusPill(c.membership_status)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── LeaveTeamButton (v01.33 — Batch 7b) ─────────────────────
//
// Used by both TeamRosterPage (coach) and AthleteTeamPage (active
// + pending states). Confirm dialog → fires PA_TEAMS.leaveTeamSelf
// → toast + dispatch pa:profile-changed.
//
// For coaches with `role==='coach'` and a team that has only ONE
// active coach, the click is intercepted with a toast "You're the
// only active coach — add another or remove athletes first" per
// locked Q3=A.
//
// mode: 'leave' | 'cancel' (cancel is for athlete pending state)
const LeaveTeamButton = ({ role, teamUuid, teamName, mode = 'leave' }) => {
  const t = (window.useT || (() => (k) => k))();
  const [busy, setBusy] = useDeckState(false);

  const onClick = async () => {
    if (busy) return;

    // Last-coach guard for coaches only.
    if (role === 'coach' && mode === 'leave' && window.PA_TEAMS?.countActiveCoaches) {
      const { count } = await window.PA_TEAMS.countActiveCoaches(teamUuid);
      if (count <= 1) {
        try { window.PA_TOAST?.show(t('team.leave.blockedLastCoach'), { type: 'warning' }); } catch (_) {}
        return;
      }
    }

    let titleKey, bodyKey;
    if (mode === 'cancel') {
      titleKey = 'team.leave.confirmCancelTitle';
      bodyKey  = 'team.leave.confirmCancelBody';
    } else if (role === 'coach') {
      titleKey = 'team.leave.confirmCoachTitle';
      bodyKey  = 'team.leave.confirmCoachBody';
    } else {
      titleKey = 'team.leave.confirmAthleteTitle';
      bodyKey  = 'team.leave.confirmAthleteBody';
    }

    const proceed = await window.PA_CONFIRM?.ask({
      title:    t(titleKey),
      message:  t(bodyKey, { team: teamName || '' }),
      isDanger: true,
    });
    if (!proceed) return;

    setBusy(true);
    const { ok } = await window.PA_TEAMS.leaveTeamSelf(role);
    setBusy(false);
    if (!ok) {
      try { window.PA_TOAST?.show(t('team.leave.toastError'), { type: 'error' }); } catch (_) {}
      return;
    }
    const successKey = mode === 'cancel'
      ? 'team.leave.toastCancelled'
      : 'team.leave.toastLeft';
    try { window.PA_TOAST?.show(t(successKey), { type: 'success' }); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
  };

  return (
    <button type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '9px 16px',
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--flag-eff) 38%, transparent)',
        background: 'transparent',
        color: 'var(--flag-eff)',
        font: '600 12px var(--font-ui)', letterSpacing: '0.02em',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.5 : 1,
      }}>
      {busy
        ? t('team.leave.loading')
        : (mode === 'cancel'
            ? t('team.leave.btnPending')
            : t('team.leave.btn'))}
    </button>
  );
};

// ── TeammatesList (v01.39) ──────────────────────────────────
//
// Read-only list of teammates rendered on AthleteTeamPage's
// active state. Pairs with CoachesList visually so both
// sections feel coherent. Loads via the same useTeamData hook
// that the coach roster uses — gets athletes (active-filtered
// since v01.37) plus activity aggregates (trials 30 d / last
// session) so we can show an activity dot + last-session date.
//
// Self is tagged "You" and floated to the top of the list so
// the athlete's own row is always at hand.
//
// Read-only by design — no 3-dot menu, no remove. Coaches
// manage roster on TeamRosterPage; this surface is informational.
const TeammatesList = ({ teamUuid, currentAthleteUuid }) => {
  const t = (window.useT || (() => (k) => k))();
  const { athletes, activity, loading } = useTeamData(teamUuid);

  if (loading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('team.teammates.title')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('team.teammates.loading')}
        </div>
      </div>
    );
  }

  if (!athletes.length) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('team.teammates.title')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('team.teammates.empty')}
        </div>
      </div>
    );
  }

  // Sort: self first (so the athlete sees themselves at top),
  // then active before recent before dormant, then alpha.
  const statusRank = { active: 0, recent: 1, dormant: 2 };
  const sorted = [...athletes].sort((a, b) => {
    const aIsMe = a.athlete_uuid === currentAthleteUuid;
    const bIsMe = b.athlete_uuid === currentAthleteUuid;
    if (aIsMe !== bIsMe) return aIsMe ? -1 : 1;
    const sa = activity.byAthlete[a.athlete_uuid] || { trials_30d: 0, trials_7d: 0 };
    const sb = activity.byAthlete[b.athlete_uuid] || { trials_30d: 0, trials_7d: 0 };
    const ra = statusRank[activityStatus(sa)] ?? 99;
    const rb = statusRank[activityStatus(sb)] ?? 99;
    if (ra !== rb) return ra - rb;
    const an = ((a.last_name || '') + (a.first_name || '')).toLowerCase();
    const bn = ((b.last_name || '') + (b.first_name || '')).toLowerCase();
    return an.localeCompare(bn);
  });

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: 10,
      }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
          {t('team.teammates.title')}
        </div>
        <span style={{ font: '500 11px var(--font-mono)', color: 'var(--tx-lo)' }}>
          {athletes.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((a, i) => {
          const isMe   = a.athlete_uuid === currentAthleteUuid;
          const stats  = activity.byAthlete[a.athlete_uuid] || { trials_30d: 0, trials_7d: 0 };
          const status = activityStatus(stats);
          const dotCol = STATUS_COLORS[status];
          const lastSessionLabel = stats.last_session
            ? relativeDate(stats.last_session)
            : t('team.teammates.noLastSession');
          return (
            <div key={a.athlete_uuid} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0',
              borderTop: i ? '1px solid var(--line-soft)' : 'none',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
                color: 'var(--signal-eff)',
                font: '700 11px var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                position: 'relative',
              }}>
                {coachInitials(a)}
                {/* Activity status dot — top-right of the avatar,
                    matching CoachRoster pattern. */}
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  width: 8, height: 8, borderRadius: '50%',
                  background: dotCol,
                  border: '2px solid var(--bg-2)',
                }} aria-hidden="true"/>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {window.PA_ADMIN.athleteName(a)}
                  {isMe && (
                    <span style={{
                      marginLeft: 6,
                      font: '500 11px var(--font-ui)',
                      color: 'var(--tx-lo)',
                    }}>
                      ({t('team.teammates.you')})
                    </span>
                  )}
                </div>
                <div style={{
                  font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
                  marginTop: 2,
                }}>
                  {lastSessionLabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── AthleteTeamPage (v01.31 — Batch 7a-bridge) ──────────────
//
// What an athlete sees on the "Equipo / Team" route. Three states
// driven by their own profile row:
//
//   No team       → empty state + "Join a team" CTA → opens
//                   TeamOnboardingModal in 'join' mode (athlete-
//                   flavored: no Create option, request lands in
//                   pending status).
//   Pending       → status card "Waiting for {team} to approve".
//                   Cancel-request button is a stub here; the real
//                   wiring lands in Batch 7b (leave team write).
//   Active        → minimal placeholder. Full team info (coaches
//                   list, leave team, etc.) ships in 7b.
//
// Coaches don't hit this page — the route still routes coach
// users to TeamRosterPage as before.
const AthleteTeamPage = ({ profile }) => {
  const t = (window.useT || (() => (k) => k))();
  const [modalOpen, setModalOpen] = useDeckState(false);

  const teamUuid = profile?.team_uuid || null;
  const teamName = (profile?.team_name || '').trim() || null;
  const status   = profile?.membership_status || (teamUuid ? 'active' : 'inactive');

  // v01.38 — treat 'inactive' the same as "no team". When the
  // athlete was removed/rejected/left, status flips to 'inactive'
  // but team_uuid stays linked (RLS WITH-CHECK constraint, see
  // v01.36). Without this guard, the page would render "You're
  // on {team}" even though their access was revoked. The Join CTA
  // path lets them re-request a team — joinTeamAsAthlete
  // overwrites team_uuid + sets status='pending' on their own row
  // via the auth.uid()-gated policy.
  const isInactive = status === 'inactive';

  // ── State 1: No team (or removed/inactive) ───────────────
  if (!teamUuid || isInactive) {
    return (
      <>
        <div className="card" style={{
          padding: 28, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
            {t('team.athleteEmpty.eyebrow')}
          </span>
          <div className="display" style={{
            fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          }}>
            {t('team.athleteEmpty.title')}
          </div>
          <p style={{
            margin: 0, maxWidth: 540, lineHeight: 1.5,
            font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
          }}>
            {t('team.athleteEmpty.body')}
          </p>
          <div>
            <button type="button"
              onClick={() => setModalOpen(true)}
              style={{
                marginTop: 6,
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--signal-eff)',
                color: 'var(--ink)',
                font: '700 13px var(--font-ui)', letterSpacing: '0.01em',
                cursor: 'pointer',
              }}>
              {t('team.athleteEmpty.joinBtn')}
            </button>
          </div>
        </div>
        {modalOpen && window.TeamOnboardingModal && (
          <window.TeamOnboardingModal
            initialMode="join"
            role="athlete"
            onClose={() => setModalOpen(false)}
            onComplete={() => { setModalOpen(false); }}/>
        )}
      </>
    );
  }

  // ── State 2: Pending approval ────────────────────────────
  if (status === 'pending') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{
          padding: 28, display: 'flex', flexDirection: 'column', gap: 10,
          border: '1px solid color-mix(in oklch, var(--amber-eff) 30%, transparent)',
        }}>
          <span className="eyebrow" style={{ color: 'var(--amber-eff)' }}>
            {t('team.athletePending.eyebrow')}
          </span>
          <div className="display" style={{
            fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          }}>
            {teamName
              ? t('team.athletePending.titleWithTeam', { team: teamName })
              : t('team.athletePending.title')}
          </div>
          <p style={{
            margin: 0, maxWidth: 540, lineHeight: 1.5,
            font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
          }}>
            {t('team.athletePending.body')}
          </p>
          {/* v01.33 — Cancel request button. Same write as leave;
              just different copy + toast. */}
          <div style={{ marginTop: 6 }}>
            <LeaveTeamButton
              role="athlete"
              teamUuid={teamUuid}
              teamName={teamName}
              mode="cancel"/>
          </div>
        </div>
      </div>
    );
  }

  // ── State 3: Active member ───────────────────────────────
  // v01.33 — full team view: coaches list + leave-team button.
  // Full athletes list comes in a later polish batch (currently
  // it's a coach-only surface on TeamRosterPage).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{
        padding: 28, display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <span className="eyebrow" style={{ color: 'var(--lime-eff)' }}>
          {t('team.athleteActive.eyebrow')}
        </span>
        <div className="display" style={{
          fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
        }}>
          {teamName
            ? t('team.athleteActive.titleWithTeam', { team: teamName })
            : t('team.athleteActive.title')}
        </div>
      </div>

      {/* v01.33 — coaches list visible to athletes too. Lets them
          see who their coaches are at a glance. */}
      <CoachesList teamUuid={teamUuid}/>

      {/* v01.39 — teammates list. Read-only view of squadmates,
          with self pinned to the top, activity dot per athlete,
          and last-session date. Same useTeamData hook coaches use,
          so the data is consistent across views. */}
      <TeammatesList
        teamUuid={teamUuid}
        currentAthleteUuid={profile?.athlete_uuid || null}/>

      {/* v01.33 — leave-team button. Sits at the bottom so it's
          out of the way for normal browsing. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <LeaveTeamButton
          role="athlete"
          teamUuid={teamUuid}
          teamName={teamName}
          mode="leave"/>
      </div>
    </div>
  );
};

// ── PendingApprovalAlert (v01.30 — Batch 7a) ────────────────
//
// Owner-coach-only banner that surfaces pending member requests
// (athletes + coaches with `membership_status='pending'`) on the
// CoachDeck. Click navigates to the team roster page where the
// PendingMembersPanel handles approve/reject. Mirrors live's
// `approvalAlert` div with the "X Pending Approval(s)" copy.
//
// Renders nothing when count is 0 — no hover-able dead space.
//
// Note: this is the read-only banner. The actual approve/reject
// writes happen in PendingMembersPanel below.
const PendingApprovalAlert = ({ count, onClick }) => {
  const t = (window.useT || (() => (k) => k))();
  if (!count || count <= 0) return null;
  const titleKey = count === 1 ? 'team.pending.bannerTitleOne' : 'team.pending.bannerTitleN';
  const bodyKey  = count === 1 ? 'team.pending.bannerBodyOne'  : 'team.pending.bannerBodyN';
  return (
    <button type="button" onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: 16, borderRadius: 14,
        background: 'color-mix(in oklch, var(--amber-eff) 12%, transparent)',
        border: '1px solid color-mix(in oklch, var(--amber-eff) 38%, transparent)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background =
        'color-mix(in oklch, var(--amber-eff) 18%, transparent)'}
      onMouseLeave={(e) => e.currentTarget.style.background =
        'color-mix(in oklch, var(--amber-eff) 12%, transparent)'}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="var(--amber-eff)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="8.5" cy="7" r="4"/>
        <line x1="20" y1="8" x2="20" y2="14"/>
        <line x1="23" y1="11" x2="17" y2="11"/>
      </svg>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          font: '700 14px var(--font-display)', color: 'var(--amber-eff)',
          letterSpacing: '-0.01em',
        }}>
          {t(titleKey, { n: count })}
        </div>
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          marginTop: 2, lineHeight: 1.45,
        }}>
          {t(bodyKey, { n: count })}
        </div>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="var(--tx-md)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  );
};

// ── PendingMembersPanel (v01.30 — Batch 7a) ─────────────────
//
// Panel rendered at the top of TeamRosterPage. Lists pending
// athletes + coaches with approve/reject buttons. Each action
// fires a confirm dialog (PA_CONFIRM), then PA_TEAMS UPDATE,
// then a toast (PA_TOAST), then dispatches `pa:profile-changed`
// so the sidebar badge + Deck banner re-fetch.
//
// Owner-only. Self-approval blocked (filtered out at the
// listPendingMembers query level).
const PendingMembersPanel = ({ teamUuid, onChange }) => {
  const t = (window.useT || (() => (k) => k))();
  const [state, setState] = useDeckState({
    athletes: [], coaches: [], loading: true, error: null,
  });
  const [busyId, setBusyId] = useDeckState(null); // id currently being approved/rejected
  const [token, setToken]   = useDeckState(0);

  useDeckEffect(() => {
    if (!teamUuid || !window.PA_TEAMS?.listPendingMembers) {
      setState({ athletes: [], coaches: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((p) => ({ ...p, loading: true, error: null }));
    (async () => {
      const res = await window.PA_TEAMS.listPendingMembers(teamUuid);
      if (cancelled) return;
      setState({
        athletes: res.athletes || [],
        coaches:  res.coaches  || [],
        loading:  false,
        error:    res.error || null,
      });
    })();
    return () => { cancelled = true; };
  }, [teamUuid, token]);

  const totalPending = state.athletes.length + state.coaches.length;

  const fmtName = (m) => {
    if (m.type === 'athlete') {
      return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || '—';
    }
    return (m.coach_name || '—').trim();
  };

  const fmtRequestedAt = (iso) => {
    if (!iso) return '';
    try {
      const lang = window.PA_I18N?.getLang?.() || 'en';
      const d = new Date(iso);
      return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
        month: 'short', day: 'numeric',
      });
    } catch (_) { return ''; }
  };

  const onApprove = async (m) => {
    if (busyId) return;
    const name = fmtName(m);
    const proceed = await window.PA_CONFIRM?.ask({
      title:   t('team.pending.confirmApproveTitle'),
      message: t('team.pending.confirmApproveBody', { name }),
      isDanger: false,
    });
    if (!proceed) return;
    setBusyId(m.id);
    const { ok, error } = await window.PA_TEAMS.approveMember(m.id, m.type);
    setBusyId(null);
    if (!ok) {
      try { window.PA_TOAST?.show(t('team.pending.toastError'), { type: 'error' }); } catch (_) {}
      try { console.warn('[PendingMembersPanel] approve error:', error); } catch (_) {}
      return;
    }
    try { window.PA_TOAST?.show(t('team.pending.toastApproved', { name }), { type: 'success' }); } catch (_) {}
    setToken((n) => n + 1);
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
    onChange?.();
  };

  const onReject = async (m) => {
    if (busyId) return;
    const name = fmtName(m);
    const proceed = await window.PA_CONFIRM?.ask({
      title:   t('team.pending.confirmRejectTitle'),
      message: t('team.pending.confirmRejectBody', { name }),
      isDanger: true,
    });
    if (!proceed) return;
    setBusyId(m.id);
    const { ok, error } = await window.PA_TEAMS.rejectMember(m.id, m.type);
    setBusyId(null);
    if (!ok) {
      try { window.PA_TOAST?.show(t('team.pending.toastError'), { type: 'error' }); } catch (_) {}
      try { console.warn('[PendingMembersPanel] reject error:', error); } catch (_) {}
      return;
    }
    try { window.PA_TOAST?.show(t('team.pending.toastRejected', { name }), { type: 'success' }); } catch (_) {}
    setToken((n) => n + 1);
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
    onChange?.();
  };

  // ── Render ────────────────────────────────────────────────
  if (state.loading) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t('team.pending.panelTitle')}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
          {t('team.pending.loading')}
        </div>
      </div>
    );
  }

  // Don't render anything when zero — prevents an "0 pending" anchor
  // from cluttering the team page on a healthy quiet day.
  if (totalPending === 0) return null;

  // Build merged list w/ display type for rendering.
  const items = [
    ...state.athletes.map(a => ({
      id: a.athlete_uuid, type: 'athlete',
      first_name: a.first_name, last_name: a.last_name,
      created_at: a.created_at, code: a.athlete_code, email: a.email,
    })),
    ...state.coaches.map(c => ({
      id: c.coach_uuid, type: 'coach',
      coach_name: c.coach_name,
      created_at: c.created_at,
    })),
  ];

  return (
    <div className="card" style={{
      padding: 18, marginBottom: 16,
      border: '1px solid color-mix(in oklch, var(--amber-eff) 30%, transparent)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 10, marginBottom: 12,
      }}>
        <div className="eyebrow" style={{ color: 'var(--amber-eff)' }}>
          {t('team.pending.panelTitle')}
        </div>
        <span style={{
          font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
        }}>
          {totalPending}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((m, i) => {
          const name = fmtName(m);
          const typeLabel = m.type === 'athlete'
            ? t('team.pending.athleteLabel')
            : t('team.pending.coachLabel');
          const isBusy = busyId === m.id;
          return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0',
              borderTop: i ? '1px solid var(--line-soft)' : 'none',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'color-mix(in oklch, var(--amber-eff) 14%, transparent)',
                color: 'var(--amber-eff)',
                font: '700 13px var(--font-ui)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {(name || '—').charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{name}</div>
                <div style={{
                  font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
                  marginTop: 2,
                }}>
                  <span>{typeLabel}</span>
                  {m.created_at && (
                    <>
                      <span style={{ margin: '0 6px' }}>·</span>
                      <span>{t('team.pending.requestedAt', { date: fmtRequestedAt(m.created_at) })}</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button"
                  onClick={() => onReject(m)}
                  disabled={isBusy}
                  style={{
                    padding: '7px 11px', borderRadius: 8,
                    border: '1px solid color-mix(in oklch, var(--flag-eff) 40%, transparent)',
                    background: 'transparent',
                    color: 'var(--flag-eff)',
                    font: '600 11px var(--font-ui)', letterSpacing: '0.04em',
                    cursor: isBusy ? 'wait' : 'pointer',
                    opacity: isBusy ? 0.5 : 1,
                  }}>
                  {isBusy ? t('team.pending.rejecting') : t('team.pending.reject')}
                </button>
                <button type="button"
                  onClick={() => onApprove(m)}
                  disabled={isBusy}
                  style={{
                    padding: '7px 11px', borderRadius: 8,
                    border: 'none',
                    background: 'var(--lime-eff)',
                    color: 'var(--ink)',
                    font: '700 11px var(--font-ui)', letterSpacing: '0.04em',
                    cursor: isBusy ? 'wait' : 'pointer',
                    opacity: isBusy ? 0.5 : 1,
                  }}>
                  {isBusy ? t('team.pending.approving') : t('team.pending.approve')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── CoachDeck (v00.57 — hero sentence + KPI rail + roster) ────
const CoachDeck = ({ profile, onPickAthlete, teamPendingCount, onNavigateTeam }) => {
  const teamUuid = profile?.team_uuid || null;
  const coachName = (profile?.first_name || profile?.coach_name || '').trim() || null;
  const teamName  = (profile?.team_name || '').trim() || null;
  const t = (window.useT || (() => (k) => k))();
  // v01.14 — Batch 1c. Coaches without a team see a CTA card that
  // launches the TeamOnboardingModal in either join or create mode.
  // The modal dispatches `pa:profile-changed` on success; AuthGate's
  // listener re-runs refreshProfile() so v_my_coach picks up the
  // new team_uuid and CoachDeck re-renders with real squad data.
  const [onbMode, setOnbMode] = useDeckState(null); // null | 'pick' | 'join' | 'create'

  const { athletes, activity, loading } = useTeamData(teamUuid);
  const totals = activity?.totals || {};
  const rosterSize = athletes.length;

  // Data-driven hero sentence. Branches on the most actionable
  // signal we have: an active week (sessions_7d > 0), a quiet
  // week (rosterSize > 0 but sessions_7d == 0), or a fresh team.
  // v01.23 — translated. Plural "trial" vs "trials" handled with
  // separate dict keys (deck.coach.trialWordSingular / Plural)
  // since Spanish has identical singular/plural for "prueba"/"pruebas"
  // and English needs the inflection.
  const heroNarrative = (() => {
    if (!teamUuid) return <>{t('deck.coach.noTeamLine')}</>;
    if (loading)   return <>{t('deck.coach.loadingSquad')}</>;
    if (!rosterSize) return <>{t('deck.coach.rosterEmptyHero')}</>;
    const a7 = totals.active_7d || 0;
    const s7 = totals.sessions_7d || 0;
    if (a7 === 0) return <>{t('deck.coach.noSessions7d')}</>;
    const trialWord = s7 === 1
      ? t('deck.coach.trialWordSingular')
      : t('deck.coach.trialWordPlural');
    if (a7 === rosterSize) {
      return (
        <span>
          <span style={{ color: 'var(--lime-eff)' }}>
            {t('deck.coach.allActiveLine', {
              n: rosterSize, s: s7, trialWord,
            }).split('—')[0].trim()}
          </span>
          {' — '}
          {t('deck.coach.allActiveLine', {
            n: rosterSize, s: s7, trialWord,
          }).split('—').slice(1).join('—').trim()}
        </span>
      );
    }
    return (
      <span>
        <span style={{ color: 'var(--lime-eff)' }}>
          {t('deck.coach.someActiveLine', {
            a: a7, n: rosterSize, s: s7, trialWord,
          }).split('—')[0].trim()}
        </span>
        {' — '}
        {t('deck.coach.someActiveLine', {
          a: a7, n: rosterSize, s: s7, trialWord,
        }).split('—').slice(1).join('—').trim()}
      </span>
    );
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* v01.30 — Pending approval alert. Owner-coach-only, only
          renders when there are pending members. Click navigates
          to the team roster page where the panel handles the
          actual approve/reject. */}
      {teamPendingCount > 0 && (
        <PendingApprovalAlert
          count={teamPendingCount}
          onClick={() => onNavigateTeam?.()}/>
      )}

      {/* Hero — free-standing, no card. Mirrors athlete deck pattern. */}
      <div>
        <div className="eyebrow" style={{
          color: 'var(--tx-lo)', marginBottom: 8,
        }}>
          {teamName ? t('deck.coach.squadDot') + teamName.toUpperCase() : t('deck.coach.squadOverview')}
        </div>
        <div className="display" style={{
          fontSize: 26, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          lineHeight: 1.2, maxWidth: 760,
        }}>
          {/* "Welcome, Eric." / "Bienvenido, entrenador." — comma-separated
              so the same JSX works for both languages. */}
          {t('deck.coach.welcome')}
          {', '}
          {coachName || t('deck.coach.welcomeFallback')}
          {'.'}
        </div>
        <div style={{
          color: 'var(--tx-md)', font: '500 14px var(--font-ui)',
          marginTop: 8, maxWidth: 720, lineHeight: 1.5,
        }}>
          {heroNarrative}
        </div>
      </div>

      {/* Summary KPI rail — 4 tiles. Always renders so the layout
          is stable; loading just shows zeros until aggregation completes. */}
      <CoachSquadKPIs totals={totals} rosterSize={rosterSize}/>

      {/* v00.65: Squad Focus — coachable team-wide signal.
          Surfaces the modality with the most athletes slipping
          vs their 30 d average. Pairs with the athlete-side
          NextFocus card. */}
      {teamUuid && rosterSize > 0 && (
        <SquadFocus athletes={athletes}/>
      )}

      {/* v01.28: Team Activity feed — recent sessions across the
          squad, click-through to the athlete's analysis page.
          Renders even when empty so the section is a stable
          layout anchor while data trickles in. Replaces live's
          "Recent Team Activity" collapsible section. */}
      {teamUuid && rosterSize > 0 && (
        <TeamActivityFeed athletes={athletes} onPickAthlete={onPickAthlete}/>
      )}

      {/* Roster grid */}
      {teamUuid && rosterSize > 0 && (
        <CoachRoster
          athletes={athletes}
          activity={activity}
          onPickAthlete={onPickAthlete}/>
      )}

      {/* Empty / no-team states inline — shown only when relevant.
          Keep the hero + KPIs visible even in these states so the
          page never renders as a single empty card. */}
      {!teamUuid && (
        <div className="card" style={{
          padding: 22, color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('deck.coach.noTeamEyebrow')}</span>
          <div className="display" style={{
            fontSize: 18, color: 'var(--tx-hi)', letterSpacing: '-0.015em',
            lineHeight: 1.3,
          }}>
            {t('deck.coach.noTeamTitle')}
          </div>
          <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.55, color: 'var(--tx-md)' }}>
            {t('deck.coach.noTeamBody')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setOnbMode('join')}
              style={{
                padding: '10px 16px', borderRadius: 10, border: 'none',
                background: 'var(--signal-eff)', color: 'var(--ink)',
                font: '700 13px var(--font-ui)', letterSpacing: '0.01em',
                cursor: 'pointer',
              }}>
              {t('deck.coach.joinExisting')}
            </button>
            <button
              type="button"
              onClick={() => setOnbMode('create')}
              style={{
                padding: '10px 16px', borderRadius: 10,
                border: '1px solid var(--line)', background: 'var(--bg-3)',
                color: 'var(--tx-hi)',
                font: '600 13px var(--font-ui)',
                cursor: 'pointer',
              }}>
              {t('deck.coach.createNew')}
            </button>
          </div>
        </div>
      )}

      {/* v01.14 — TeamOnboardingModal mounts when onbMode is set.
          window.TeamOnboardingModal comes from src/components/
          team-onboarding.jsx (loaded BEFORE web-deck.jsx). The
          belt-and-suspenders guard skips the modal cleanly if
          Babel hasn't compiled it yet on first paint. */}
      {!teamUuid && onbMode && window.TeamOnboardingModal && (
        <window.TeamOnboardingModal
          initialMode={onbMode}
          onClose={() => setOnbMode(null)}
          onComplete={() => setOnbMode(null)}/>
      )}
      {teamUuid && !loading && !rosterSize && (
        <div className="card" style={{
          padding: 22, color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('deck.coach.emptyRoster')}</span>
          <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
            {t('deck.coach.emptyRosterBody')}
          </p>
        </div>
      )}
    </div>
  );
};

// ── TeamRosterPage (v00.57) ───────────────────────────────────
// Full-page roster table. Columns: Name, Status, Last session,
// Sessions this month. Click anywhere on a row to drill into
// that athlete via the same impersonation hook.
const TeamRosterPage = ({ profile, onPickAthlete, sessionUserId, isTeamOwner }) => {
  const teamUuid = profile?.team_uuid || null;
  const teamName = (profile?.team_name || '').trim() || null;
  const { athletes, activity, loading } = useTeamData(teamUuid);

  if (loading) {
    return (
      <div className="card" style={{ padding: 22, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
        Loading roster…
      </div>
    );
  }
  if (!teamUuid) {
    return (
      <div className="card" style={{
        padding: 22, color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>NO TEAM YET</span>
        <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
          Once your team's set up in Peak Athlete, the roster table will
          populate here.
        </p>
      </div>
    );
  }

  // Sort: active first (by trials_7d desc), then recent (by trials_30d
  // desc), then dormant (alphabetical).
  const sorted = [...athletes].sort((a, b) => {
    const sa = activity.byAthlete[a.athlete_uuid] || { trials_7d: 0, trials_30d: 0 };
    const sb = activity.byAthlete[b.athlete_uuid] || { trials_7d: 0, trials_30d: 0 };
    const stA = activityStatus(sa);
    const stB = activityStatus(sb);
    const order = { active: 0, recent: 1, dormant: 2 };
    if (order[stA] !== order[stB]) return order[stA] - order[stB];
    if (stA === 'active') return sb.trials_7d - sa.trials_7d;
    if (stA === 'recent') return sb.trials_30d - sa.trials_30d;
    return (a.last_name || '').localeCompare(b.last_name || '');
  });

  const totals = activity.totals || {};

  const headerCell = {
    padding: '12px 14px', textAlign: 'left',
    font: '600 11px var(--font-ui)', color: 'var(--tx-lo)',
    letterSpacing: 0.06, textTransform: 'uppercase',
    borderBottom: '1px solid var(--line)',
  };
  const dataCell = {
    padding: '14px', verticalAlign: 'middle',
    borderBottom: '1px solid var(--line-soft)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {teamName ? 'ROSTER · ' + teamName.toUpperCase() : 'ROSTER & FLAGS'}
        </div>
        <div className="display" style={{
          fontSize: 24, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
        }}>
          {athletes.length} {athletes.length === 1 ? 'athlete' : 'athletes'}
          {totals.active_7d != null && (
            <span style={{ color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 8 }}>
              · {totals.active_7d} active this week
            </span>
          )}
        </div>
      </div>

      {/* v01.30 — pending member approvals. Owner-only; auto-hides
          when count is zero so the rest of the roster page is the
          primary surface on a quiet day. */}
      <PendingMembersPanel teamUuid={teamUuid}/>

      <div className="card" style={{
        padding: 0, borderRadius: 14, overflow: 'hidden',
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headerCell}>Athlete</th>
              <th style={Object.assign({}, headerCell, { width: 110 })}>Status</th>
              <th style={Object.assign({}, headerCell, { width: 130 })}>Last session</th>
              <th style={Object.assign({}, headerCell, { textAlign: 'right', width: 130 })}>Sessions 30 d</th>
              <th style={Object.assign({}, headerCell, { textAlign: 'right', width: 110 })}> </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => {
              const stats  = activity.byAthlete[a.athlete_uuid] || {};
              const status = activityStatus(stats);
              const dotCol = STATUS_COLORS[status];
              return (
                <tr key={a.athlete_uuid}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onPickAthlete && onPickAthlete({
                      uuid: a.athlete_uuid,
                      name: window.PA_ADMIN.athleteName(a),
                    })}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-3)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <td style={dataCell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
                        color: 'var(--signal-eff)',
                        font: '700 11px var(--font-ui)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {coachInitials(a)}
                      </div>
                      <div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                          flexWrap: 'wrap',
                        }}>
                          <span>{window.PA_ADMIN.athleteName(a)}</span>
                          {/* v01.33 — gender attention chip when unset */}
                          {!a.gender && (
                            <span onClick={(e) => e.stopPropagation()}>
                              <GenderChip onClick={() => {/* opens menu via the row's menu — chip is just an indicator */}}/>
                            </span>
                          )}
                        </div>
                        <div className="mono" style={{
                          fontSize: 10, color: 'var(--tx-lo)', marginTop: 2,
                        }}>
                          {(a.athlete_uuid || '').slice(0, 8).toUpperCase()}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={dataCell}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 9px', borderRadius: 999,
                      border: '1px solid color-mix(in oklch, ' + dotCol + ' 40%, transparent)',
                      background: 'color-mix(in oklch, ' + dotCol + ' 10%, transparent)',
                      color: dotCol,
                      font: '700 10px var(--font-mono)',
                      letterSpacing: 0.06, textTransform: 'uppercase',
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', background: dotCol,
                      }}/>
                      {STATUS_LABELS[status]}
                    </span>
                  </td>
                  <td style={dataCell}>
                    <div style={{
                      font: '500 13px var(--font-ui)', color: 'var(--tx-hi)',
                    }}>
                      {stats.last_session ? relativeDate(stats.last_session) : '—'}
                    </div>
                    {stats.last_session && (
                      <div style={{ fontSize: 10, color: 'var(--tx-lo)', marginTop: 2 }}>
                        {stats.last_event_type ? stats.last_event_type : ''}
                      </div>
                    )}
                  </td>
                  <td style={Object.assign({}, dataCell, { textAlign: 'right' })}>
                    <span className="mono" style={{
                      font: '700 14px var(--font-mono)', color: 'var(--tx-hi)',
                    }}>
                      {stats.trials_30d || 0}
                    </span>
                  </td>
                  <td style={Object.assign({}, dataCell, { textAlign: 'right' })}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      justifyContent: 'flex-end',
                    }}>
                      <span style={{
                        font: '600 11px var(--font-ui)', color: 'var(--signal-eff)',
                      }}>
                        View as →
                      </span>
                      {/* v01.33 — 3-dot menu (Set gender + Remove).
                          stopPropagation so menu interactions don't
                          trigger the row's view-as onClick. */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <RosterRowMenu athlete={a} canRemove={!!isTeamOwner}/>
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} style={Object.assign({}, dataCell, {
                  textAlign: 'center', color: 'var(--tx-lo)',
                  font: '500 13px var(--font-ui)',
                })}>
                  No athletes on your team yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* v01.33 — Coaches list section. Coach view shows everyone
          on the team with "You" tag for self. */}
      <CoachesList teamUuid={teamUuid} myAuthId={sessionUserId || null}/>

      {/* v01.33 — Leave team. Footer-aligned so it's out of the
          way for normal browsing. Last-coach guard runs inside
          the button (counts active coaches before allowing). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <LeaveTeamButton
          role="coach"
          teamUuid={teamUuid}
          teamName={teamName}
          mode="leave"/>
      </div>
    </div>
  );
};

// ── Entry ────────────────────────────────────────────────────

const WebDeck = ({ profile, role, fallbackEmail, authUserId, adminAthleteUuid, onPickAthlete, teamPendingCount, onNavigateTeam }) => {
  const persona = role === 'coach' ? 'coach' : 'athlete';
  // v00.48: when admin impersonation is active, render the
  // AthleteDeck regardless of role — the data is scoped to a
  // single athlete, so the coach/team dashboard isn't relevant.
  if (persona === 'coach' && !adminAthleteUuid) {
    // v00.56: CoachDeck gets onPickAthlete so the roster cards
    // can drive the same impersonation state the AdminBar does.
    return <CoachDeck
      profile={profile}
      onPickAthlete={onPickAthlete}
      teamPendingCount={teamPendingCount || 0}
      onNavigateTeam={onNavigateTeam}/>;
  }
  return <AthleteDeck
    profile={profile}
    fallbackEmail={fallbackEmail}
    authUserId={authUserId}
    adminAthleteUuid={adminAthleteUuid}/>;
};

// Expose -------------------------------------------------------
Object.assign(window, {
  WebDeck, AthleteDeck, CoachDeck, TeamRosterPage,
  HeadlineStory, HeroTrendChart, HeadlineEmpty,
  RequestAnalysisButton, YourRequestsCard,
  FocusCards, FocusCard, FocusSpark,
  NextFocus, SquadFocus, TeamActivityFeed,
  PendingApprovalAlert, PendingMembersPanel,
  AthleteTeamPage,
  CoachesList, RosterRowMenu, GenderChip, LeaveTeamButton,
  TeammatesList,
});

try { console.log('[web-deck] loaded (v01.39)'); } catch (_) {}
