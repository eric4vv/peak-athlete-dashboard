/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Shared atoms — Icon, PeakMark, BigNumber, Delta, sparks

   Pure-presentation building blocks reused across web + mobile.
   Exposed on window for later components to pick up.
   ─────────────────────────────────────────────────────────── */

// ── Icon set (stroke-based SVG, sized + coloured from parent) ──
const Icon = ({ name, size = 18, stroke = 2, style }) => {
  const paths = {
    home:    <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/></>,
    starts:  <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
    turns:   <><path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.6"/><polyline points="21 3 21 9 15 9"/></>,
    races:   <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></>,
    board:   <><rect x="3" y="12" width="4" height="9"/><rect x="10" y="6" width="4" height="15"/><rect x="17" y="9" width="4" height="12"/></>,
    team:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></>,
    bell:    <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
    search:  <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></>,
    arrow:   <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    arrowUp: <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
    arrowDn: <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
    play:    <><polygon points="6 4 20 12 6 20 6 4"/></>,
    video:   <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></>,
    trophy:  <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>,
    flame:   <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.4 0 2.5-1.1 2.5-2.5 0-.8-.5-1.7-1-2 .5.7 1 1.3 1 2 0 1.4-1.1 2.5-2.5 2.5S8.5 15.9 8.5 14.5zM12 2c1 2 3 4 3 7a3 3 0 0 1-6 0c0-1 .5-2 1-3 1.5 1 2 2 2 2s-.5-3 0-6z"/></>,
    check:   <><polyline points="20 6 9 17 4 12"/></>,
    dot:     <><circle cx="12" cy="12" r="3"/></>,
    target:  <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    clock:   <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    chev:    <><polyline points="9 18 15 12 9 6"/></>,
    chevDn:  <><polyline points="6 9 12 15 18 9"/></>,
    plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    spark:   <><path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2z"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3H9a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8V9a1.65 1.65 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z"/></>,
    note:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    share:   <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>,
    lightning:<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
    logout:  <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    user:    <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    menu:    <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    close:   <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...(style || {}) }}>
      {paths[name] || null}
    </svg>
  );
};

// ── Peak Athlete logo mark — bold hollow chevron peak ──
// Matches the official Peak Athlete mark from /marketing/Logos.
// Single filled path (fills with `color` or currentColor).
const PeakMark = ({ size = 28, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
    <path
      d="M 4 28 L 16 4 L 28 28 L 22 28 L 16 14 L 10 28 Z"
      fill={color}
      strokeLinejoin="round"
    />
  </svg>
);

// ── Big numeric display (tabular mono, optional unit + tone) ──
const BigNumber = ({ value, unit, tone }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, color: tone || 'inherit' }}>
    <span className="num-xl display" style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
    {unit && <span style={{ font: '600 18px var(--font-mono)', opacity: 0.5 }}>{unit}</span>}
  </div>
);

// ── Delta chip ("▲ 0.12 s" / "▼ 0.18 s") ──
// goodDir tells the chip which direction is "good" for this metric:
//   'down' (default) → smaller is better (times, reaction, splits)
//   'up'             → bigger is better (velocity, rank, streak)
const Delta = ({ value, unit = '', goodDir = 'down' }) => {
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  const isDown = v < 0;
  const isGood = goodDir === 'down' ? isDown : !isDown;
  const color  = v === 0 ? 'var(--tx-lo)' : isGood ? 'var(--lime-eff)' : 'var(--flag-eff)';
  const arrow  = v === 0 ? '–' : isDown ? '▼' : '▲';
  return (
    <span className="mono" style={{
      color, fontSize: 12, fontWeight: 600, letterSpacing: 0.02,
      display: 'inline-flex', gap: 4, alignItems: 'center'
    }}>
      <span style={{ fontSize: 9 }}>{arrow}</span>
      {Math.abs(v).toFixed(Math.abs(v) < 1 ? 2 : 1)}{unit}
    </span>
  );
};

// ── Inline bar sparkline ──
const BarSpark = ({ data, height = 28, width = 96, color = 'var(--signal-eff)', baseline = true }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const n = data.length;
  const barW = width / n - 2;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {baseline && <line x1="0" y1={height-0.5} x2={width} y2={height-0.5}
                         stroke="var(--line-soft)" strokeWidth="1"/>}
      {data.map((v, i) => {
        const h = ((v - min) / (max - min + 0.0001)) * (height - 4) + 3;
        return (
          <rect key={i} x={i * (barW + 2)} y={height - h} width={barW} height={h}
                rx="1.5" fill={color}
                opacity={i === n - 1 ? 1 : 0.4 + (i / n) * 0.5}/>
        );
      })}
    </svg>
  );
};

// ── Smooth-path helper (v00.70) ────────────────────────────────
// Catmull-Rom → cubic Bezier converter. Takes an array of
// [x, y] points and returns an SVG path string with smooth
// curves between them. Velocities, stroke rates, and most
// physical signals don't have abrupt peaks — they degrade
// continuously — so curved interpolation reads more honestly
// than straight L-segment polylines.
//
// `tension` controls slack: 1 = standard Catmull-Rom, lower =
// looser (more bow), higher = tighter (closer to straight).
// Default 1. Two-point series fall back to a straight line so
// short sparklines still draw correctly.
//
// Exposed on window.PA_SVG so every chart in the prototype can
// use one helper instead of each component re-rolling its own.
function smoothPath(points, tension) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    return 'M' + points[0][0].toFixed(2) + ',' + points[0][1].toFixed(2);
  }
  if (points.length === 2) {
    return 'M' + points[0][0].toFixed(2) + ',' + points[0][1].toFixed(2)
         + ' L' + points[1][0].toFixed(2) + ',' + points[1][1].toFixed(2);
  }
  const t = tension == null ? 1 : tension;
  const n = points.length;
  let d = 'M' + points[0][0].toFixed(2) + ',' + points[0][1].toFixed(2);
  for (let i = 1; i < n; i++) {
    const p0 = points[i - 2] || points[i - 1];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[i + 1] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6 * t;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6 * t;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6 * t;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6 * t;
    d += ' C' + cp1x.toFixed(2) + ',' + cp1y.toFixed(2)
       + ' ' + cp2x.toFixed(2) + ',' + cp2y.toFixed(2)
       + ' ' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2);
  }
  return d;
}
window.PA_SVG = Object.assign(window.PA_SVG || {}, { smoothPath });

// ── Inline line sparkline (with soft area fill) ──
const LineSpark = ({ data, height = 32, width = 110, color = 'var(--signal-eff)', area = true }) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const step = width / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const y = height - ((v - min) / (max - min + 0.0001)) * (height - 4) - 2;
    return [i * step, y];
  });
  const path = window.PA_SVG.smoothPath(pts);
  const areaPath = path + ` L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {area && <path d={areaPath} fill={color} opacity="0.14"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.5" fill={color}/>
    </svg>
  );
};

// ── Editorial section label (eyebrow + optional action) ──
const SectionLabel = ({ children, action }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 14, padding: '0 2px' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span className="eyebrow">{children}</span>
    </div>
    {action && (
      <span style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-md)', cursor: 'pointer' }}>
        {action}
      </span>
    )}
  </div>
);

// ── Striped placeholder for imagery (video thumbs before R2 load) ──
const ImagePlaceholder = ({ height = 160, label = 'video thumb', aspect }) => (
  <div style={{
    height: aspect ? undefined : height,
    aspectRatio: aspect || undefined,
    borderRadius: 10, position: 'relative', overflow: 'hidden',
    background: 'repeating-linear-gradient(135deg, rgba(127,127,127,.08), rgba(127,127,127,.08) 6px, transparent 6px, transparent 12px)',
    border: '1px solid var(--line-soft)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <span className="mono" style={{
      fontSize: 10, color: 'var(--tx-lo)', letterSpacing: 0.08, textTransform: 'uppercase',
    }}>
      {label}
    </span>
  </div>
);

// ── LoadingState (v01.03) ─────────────────────────────────────
// Replaces the plain "Loading…" text scattered across pages with
// a small animated pulse + label so loading reads as deliberate
// rather than as a stalled page. Single-color (signal-eff)
// pulse. Inline-block at typical body size by default; the
// `large` prop bumps padding for full-page loading panels.
const _loadingKeyframes = `
@keyframes pa-pulse-dot {
  0%   { transform: scale(0.6); opacity: 0.4; }
  50%  { transform: scale(1.0); opacity: 1.0; }
  100% { transform: scale(0.6); opacity: 0.4; }
}`;
// Inject keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('pa-pulse-style')) {
  const s = document.createElement('style');
  s.id = 'pa-pulse-style';
  s.textContent = _loadingKeyframes;
  document.head.appendChild(s);
}
const LoadingState = ({ label, large }) => (
  <div style={{
    padding: large ? '32px 24px' : '14px 0',
    color: 'var(--tx-lo)', font: '500 13px var(--font-ui)',
    display: 'flex', alignItems: 'center', gap: 10,
    justifyContent: large ? 'center' : 'flex-start',
  }}>
    <span style={{
      display: 'inline-flex', gap: 4, alignItems: 'center',
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--signal-eff)',
          animation: 'pa-pulse-dot 1.2s ease-in-out infinite',
          animationDelay: (i * 0.18) + 's',
          display: 'inline-block',
        }}/>
      ))}
    </span>
    <span>{label || 'Loading…'}</span>
  </div>
);

// ── EmptyState (v01.03) ───────────────────────────────────────
// Consistent shape for "nothing here yet" messages across the
// prototype. Eyebrow + display title + body + optional action
// button. Each section is optional so callers can keep things
// short ("No races yet") or add a CTA ("Request your first
// analysis").
const EmptyState = ({ eyebrow, title, body, action, dense }) => (
  <div className="card" style={{
    padding: dense ? 22 : 28, borderRadius: 14,
    background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
    display: 'flex', flexDirection: 'column', gap: 10,
    color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
    lineHeight: 1.5,
  }}>
    {eyebrow && (
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>
        {eyebrow}
      </span>
    )}
    {title && (
      <div className="display" style={{
        fontSize: dense ? 18 : 22, color: 'var(--tx-hi)',
        letterSpacing: '-0.02em', lineHeight: 1.25,
      }}>
        {title}
      </div>
    )}
    {body && <div style={{ maxWidth: 540 }}>{body}</div>}
    {action && <div style={{ marginTop: 6 }}>{action}</div>}
  </div>
);

// ── ErrorState (v01.05) ───────────────────────────────────────
// Top-level error UI for failed data fetches. Shows a friendly
// title + the actual error message + a retry button. Optional
// `technical` slot collapses the verbose error details under
// a small "Details" disclosure for power users / debugging.
//
// Used by WebRaces / WebStarts / WebTurns / TeamBrowsePage when
// their lazy-fetch effects fail. The retry callback re-runs
// the query without a page reload — typical pattern is to
// increment a `refetchToken` state that the effect's
// dependency array includes.
// v01.25 — atom defaults translate via useT(). The eyebrow,
// title, RETRY button label, and Details summary all flip with
// the active language. `message` and `technical` come from the
// caller and stay as-passed (callers translate their own context-
// specific copy via the dict; see analysis.errorState.* etc.).
const ErrorState = ({ message, onRetry, technical, dense }) => {
  const tFn = (window.useT || (() => (k) => k))();
  return (
  <div className="card" style={{
    padding: dense ? 22 : 28, borderRadius: 14,
    background: 'color-mix(in oklch, var(--flag-eff) 6%, var(--bg-2))',
    border: '1px solid color-mix(in oklch, var(--flag-eff) 35%, var(--line))',
    color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
    display: 'flex', flexDirection: 'column', gap: 10,
    lineHeight: 1.5,
  }}>
    <span className="eyebrow" style={{ color: 'var(--flag-eff)' }}>
      {tFn('errorState.eyebrow')}
    </span>
    <div className="display" style={{
      fontSize: dense ? 16 : 18, color: 'var(--tx-hi)',
      letterSpacing: '-0.02em', lineHeight: 1.3,
    }}>
      {tFn('errorState.title')}
    </div>
    {message && (
      <div style={{ color: 'var(--tx-md)', maxWidth: 560 }}>
        {message}
      </div>
    )}
    {(onRetry || technical) && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        {onRetry && (
          <button onClick={onRetry} style={{
            padding: '7px 14px', borderRadius: 8,
            background: 'var(--signal-eff)', color: 'var(--ink)',
            border: 'none', font: '700 12px var(--font-ui)',
            letterSpacing: 0.04, cursor: 'pointer',
          }}>
            {tFn('common.retryUpper')}
          </button>
        )}
        {technical && (
          <details style={{ font: '500 11px var(--font-mono)', color: 'var(--tx-lo)' }}>
            <summary style={{ cursor: 'pointer' }}>{tFn('common.details')}</summary>
            <pre style={{
              marginTop: 6, padding: 8, borderRadius: 6,
              background: 'var(--bg-3)', color: 'var(--tx-md)',
              fontSize: 11, overflow: 'auto', maxWidth: '100%',
              whiteSpace: 'pre-wrap',
            }}>{technical}</pre>
          </details>
        )}
      </div>
    )}
  </div>
  );
};

// ── useIsMobile (v01.06) ──────────────────────────────────────
// Boolean hook that flips at the configured breakpoint. Used by
// the web-shell (Sidebar drawer, Topbar collapse) and by any
// page-level layout that needs to stack columns or hide a panel.
//
// Default threshold: 768px — matches Tailwind's `md:` boundary
// and what most users intuit as "mobile". Every current iPhone
// (375-430px CSS width) falls below; iPad portrait (768) and up
// gets the desktop layout, which fits the 240px sidebar plus
// content cleanly.
//
// Subscribes to window resize and re-renders when the boolean
// flips. Safe during SSR (no window check needed in this
// prototype but keeping the early-return for portability).
const useIsMobile = (threshold = 768) => {
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < threshold;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth < threshold);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return isMobile;
};

// ── useT (v01.20) ─────────────────────────────────────────────
// Bridges window.PA_I18N into React's render loop. Returns a
// `t(key, replacements)` function that re-binds whenever the
// current language changes — so any component using `useT()`
// re-renders cleanly when the user toggles EN ↔ ES via the
// Account modal Preferences tab (or via PA_DEV.setLang from the
// console).
//
// Two events drive re-renders:
//   - pa:lang-changed — user (or dev hook) flipped the language.
//   - pa:lang-loaded  — async fetch of en.json / es.json finished.
//                       Any component that mounted before the
//                       dicts arrived needs to re-render with the
//                       real translations instead of key fallbacks.
//
// Falls back gracefully when PA_I18N hasn't loaded yet (the
// hook returns `t = (key) => key`, which renders the key
// literally — fine as a transient state during boot).
const useT = () => {
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    window.addEventListener('pa:lang-changed', onChange);
    window.addEventListener('pa:lang-loaded',  onChange);
    return () => {
      window.removeEventListener('pa:lang-changed', onChange);
      window.removeEventListener('pa:lang-loaded',  onChange);
    };
  }, []);
  // Returned function reads PA_I18N at call time, so components
  // get the latest translations on every render.
  return (key, replacements) => {
    if (window.PA_I18N && typeof window.PA_I18N.t === 'function') {
      return window.PA_I18N.t(key, replacements);
    }
    return key;
  };
};

// ── Toaster (v01.26 — Batch 4.5) ─────────────────────────────
// Imperative, side-effect-style toast system used throughout the
// app for transient feedback ("Saved!", "Could not connect", etc.).
//
// API (window.PA_TOAST):
//   show(message, opts) → id
//     opts: { type?: 'info' | 'success' | 'warning' | 'error',
//             duration?: number,  // ms, default 3000
//             action?: { label, onClick } }   // optional CTA on the toast
//   dismiss(id)
//   clear()  // dismiss all
//
// Mounting: <Toaster/> renders ONCE from AuthGate (sibling to the
// rest of the tree). On mount, it installs its API on window. On
// unmount (rare — only on full app teardown), it deletes the API.
//
// Multiple toasts stack vertically, newest on top. Auto-dismiss
// after `duration` ms unless duration === 0 (sticky). Click X
// or click the toast body's "Dismiss" button to close early.
//
// Bilingual via the existing `toast.dismiss` key. Caller-supplied
// messages stay as-passed (callers translate their own context).
const Toaster = () => {
  const [toasts, setToasts] = React.useState([]);
  const isMobile = useIsMobile();
  const tFn = useT();
  const idRef = React.useRef(0);

  React.useEffect(() => {
    const api = {
      show(message, opts = {}) {
        idRef.current += 1;
        const id = idRef.current;
        const toast = {
          id,
          message: message == null ? '' : String(message),
          type: opts.type || 'info',
          action: opts.action || null,
          duration: opts.duration == null ? 3000 : opts.duration,
        };
        setToasts((arr) => [toast, ...arr].slice(0, 5)); // cap stack at 5
        if (toast.duration > 0) {
          setTimeout(() => {
            setToasts((arr) => arr.filter((t) => t.id !== id));
          }, toast.duration);
        }
        return id;
      },
      dismiss(id) {
        setToasts((arr) => arr.filter((t) => t.id !== id));
      },
      clear() { setToasts([]); },
    };
    window.PA_TOAST = api;
    return () => { if (window.PA_TOAST === api) delete window.PA_TOAST; };
  }, []);

  if (!toasts.length) return null;

  // Tone tokens per type. All four use the same card surface so
  // the visual rhythm with the rest of the app stays consistent;
  // only the accent border + eyebrow color shifts.
  const accentFor = (type) => ({
    info:    'var(--signal-eff)',
    success: 'var(--lime-eff)',
    warning: 'var(--amber-eff)',
    error:   'var(--flag-eff)',
  }[type] || 'var(--signal-eff)');

  return (
    <div
      // Container: top-right on desktop, top-center on mobile.
      // Above page content (zIndex > sticky topbar's 10) but below
      // backdrop modals (which use zIndex 1000+).
      style={{
        position: 'fixed',
        top: isMobile ? 12 : 18,
        right: isMobile ? 12 : 18,
        left:  isMobile ? 12 : 'auto',
        zIndex: 900,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none', // pass-through except on toasts
        maxWidth: isMobile ? 'auto' : 380,
      }}>
      {toasts.map((t) => {
        const accent = accentFor(t.type);
        return (
          <div key={t.id}
            role="status"
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            style={{
              pointerEvents: 'auto',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-2)',
              border: '1px solid color-mix(in oklch, ' + accent + ' 35%, var(--line))',
              borderLeft: '3px solid ' + accent,
              boxShadow: 'var(--shadow)',
              color: 'var(--tx-hi)',
              font: '500 13px var(--font-ui)',
              lineHeight: 1.45,
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              {t.message}
            </span>
            {t.action && (
              <button type="button"
                onClick={() => {
                  try { t.action.onClick && t.action.onClick(); } catch (_) {}
                  setToasts((arr) => arr.filter((x) => x.id !== t.id));
                }}
                style={{
                  background: 'transparent', border: 'none',
                  color: accent,
                  font: '700 12px var(--font-ui)', letterSpacing: 0.04,
                  cursor: 'pointer', padding: 0, flexShrink: 0,
                }}>
                {t.action.label}
              </button>
            )}
            <button type="button"
              aria-label={tFn('toast.dismiss')}
              onClick={() => setToasts((arr) => arr.filter((x) => x.id !== t.id))}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--tx-lo)', cursor: 'pointer',
                padding: 0, lineHeight: 1, flexShrink: 0,
              }}>
              <Icon name="close" size={14}/>
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ── ConfirmHost (v01.26 — Batch 4.5) ─────────────────────────
// Promise-based confirm dialog. Usage:
//
//   const ok = await window.PA_CONFIRM.ask({
//     title: 'Delete this goal?',
//     message: 'This is permanent.',
//     confirmLabel: 'Delete',
//     cancelLabel: 'Cancel',
//     isDanger: true,
//   });
//   if (!ok) return;
//
// All option fields are optional — defaults pull from the dict
// (confirm.title / confirm.confirm / confirm.cancel / confirm.dangerConfirm).
//
// Only one dialog can be open at a time. Calling ask() while open
// rejects the in-flight promise and replaces it with the new one.
// Esc / backdrop-click resolve as `false`.
const ConfirmHost = () => {
  const [state, setState] = React.useState(null); // { options, resolve } | null
  const tFn = useT();
  const isMobile = useIsMobile();

  React.useEffect(() => {
    const api = {
      ask(options) {
        return new Promise((resolve) => {
          // If a prior dialog is open, settle it false and replace.
          setState((prev) => {
            if (prev && prev.resolve) { try { prev.resolve(false); } catch (_) {} }
            return { options: options || {}, resolve };
          });
        });
      },
    };
    window.PA_CONFIRM = api;
    return () => { if (window.PA_CONFIRM === api) delete window.PA_CONFIRM; };
  }, []);

  // Esc closes (resolves false). Listener attached only when open.
  React.useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (!state) return null;
  const opts = state.options || {};
  const close = (val) => {
    try { state.resolve(val); } catch (_) {}
    setState(null);
  };

  const title        = opts.title        || tFn('confirm.title');
  const message      = opts.message      || '';
  const cancelLabel  = opts.cancelLabel  || tFn('confirm.cancel');
  const confirmLabel = opts.confirmLabel
    || (opts.isDanger ? tFn('confirm.dangerConfirm') : tFn('confirm.confirm'));

  return (
    <div
      onClick={() => close(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'color-mix(in oklch, var(--ink) 72%, transparent)',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '40px 20px',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          padding: isMobile ? 22 : 28,
          borderRadius: 16,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
        <div className="display" style={{
          fontSize: 18, color: 'var(--tx-hi)', letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}>
          {title}
        </div>
        {message && (
          <p style={{
            margin: 0, font: '500 13px var(--font-ui)',
            color: 'var(--tx-md)', lineHeight: 1.55,
          }}>
            {message}
          </p>
        )}
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          marginTop: 8, flexWrap: 'wrap',
        }}>
          <button type="button" onClick={() => close(false)}
            style={{
              padding: '10px 16px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'transparent',
              color: 'var(--tx-md)', font: '600 13px var(--font-ui)',
              cursor: 'pointer',
            }}>
            {cancelLabel}
          </button>
          <button type="button" onClick={() => close(true)}
            style={{
              padding: '10px 16px', borderRadius: 10,
              border: 'none',
              background: opts.isDanger ? 'var(--flag-eff)' : 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 13px var(--font-ui)', letterSpacing: 0.01,
              cursor: 'pointer',
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── PreviewBanner (v01.50) ───────────────────────────────────
//
// Sticky banner rendered above the page content when a free
// user is in Preview Pro mode (PA_PREVIEW.isOn() === true).
// Offers two actions: Upgrade to Pro (opens Account modal
// subscription tab via dispatch) and Exit preview (calls
// PA_PREVIEW.exit()).
//
// ── ChartScroll (v03.12) ──────────────────────────────────────
// Responsive wrapper for the data-chart SVGs. The analysis charts
// use fixed viewBox widths (480-720 units) with width:100%, so on
// a phone (~345 px usable) the whole SVG scales to ~0.5x and all
// in-SVG text/dots shrink to unreadable size.
//
// On mobile this wraps the chart in a horizontal-scroll container
// with an inner div forced to the chart's natural width — the SVG
// then renders at ~1x scale (crisp text) and the user swipes
// sideways to see the full chart. On desktop it's a transparent
// passthrough (renders children directly, zero layout change, so
// no desktop regression risk).
//
// Usage: <ChartScroll minWidth={W}><svg .../></ChartScroll>
// v03.20 — REVERTED to a passthrough. The horizontal-scroll
// approach (v03.12-v03.18) caused charts to overflow their cards
// and the document to scroll horizontally across the various
// flex/grid layout contexts on web + mobile. Charts now simply
// render at width:100% and scale to fit their card — the
// behavior before the iPhone-Pro readability experiment. The
// "small charts on a phone" cosmetic issue is accepted for now;
// if revisited, do it without a layout-affecting wrapper (e.g.
// larger in-SVG font sizes), not horizontal scroll.
const ChartScroll = ({ children }) => children;

// ── StuckBanner (v03.04) ──────────────────────────────────────
// Non-blocking top banner that appears when the supabase client
// gets internally wedged. Replaces the auto-reload behavior in
// withRecovery (Tier 2) and the always-on visibility probes
// (v01.73-v01.74) — both were too aggressive and disrupted the
// user's workflow with surprise reloads.
//
// Listens for `pa:client-stuck` events dispatched by:
//   1. withRecovery (supabase.js) — when a query hangs even after
//      a forced token refresh + retry
//   2. probeStuckClient (supabase.js) — when the Stripe-return
//      probe times out
//
// Banner offers a Reload button (user-initiated recovery) and a
// dismiss X. Stays visible until the user acts — no auto-hide.
// Mounted once at the App level in index.html.
const StuckBanner = () => {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    const onStuck = () => setActive(true);
    window.addEventListener('pa:client-stuck', onStuck);
    return () => window.removeEventListener('pa:client-stuck', onStuck);
  }, []);
  if (!active) return null;
  return (
    <div role="alert" style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      zIndex: 9999,
      background: 'color-mix(in oklch, var(--amber-eff) 92%, transparent)',
      color: 'var(--ink)',
      borderBottom: '1px solid var(--line)',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
      font: '500 13px var(--font-ui)',
    }}>
      <span style={{ flex: 1, lineHeight: 1.4 }}>
        Connection looks stuck. A page reload usually fixes it.
      </span>
      <button type="button"
        onClick={() => { try { window.location.reload(); } catch (_) {} }}
        style={{
          padding: '6px 12px', borderRadius: 8, border: 'none',
          background: 'var(--ink)', color: 'var(--paper)',
          font: '700 12px var(--font-ui)', letterSpacing: 0.02,
          cursor: 'pointer',
        }}>
        Reload
      </button>
      <button type="button" aria-label="Dismiss"
        onClick={() => setActive(false)}
        style={{
          width: 28, height: 28, borderRadius: 8, border: 'none',
          background: 'transparent', color: 'var(--ink)',
          font: '700 16px var(--font-ui)', cursor: 'pointer',
        }}>
        ×
      </button>
    </div>
  );
};

// Renders nothing when preview is off — zero overhead in the
// normal UX. Subscribes to pa:preview-changed via PA_PREVIEW's
// usePreview hook so it appears/disappears reactively.
const PreviewBanner = ({ onUpgrade }) => {
  const t = (window.useT || (() => (k) => k))();
  const previewOn = window.PA_PREVIEW?.usePreview?.() || false;
  if (!previewOn) return null;
  const exit = () => window.PA_PREVIEW?.exit?.();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 18px', borderRadius: 12,
      marginBottom: 16,
      background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
      border: '1px solid color-mix(in oklch, var(--signal-eff) 40%, transparent)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          font: '700 10px var(--font-ui)', color: 'var(--signal-eff)',
          letterSpacing: 0.08, textTransform: 'uppercase',
          marginBottom: 4,
        }}>
          {t('preview.bannerEyebrow')}
        </div>
        <div style={{
          font: '700 14px var(--font-display)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em',
        }}>
          {t('preview.bannerTitle')}
        </div>
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          marginTop: 2, lineHeight: 1.4,
        }}>
          {t('preview.bannerBody')}
        </div>
      </div>
      <button type="button" onClick={() => onUpgrade?.()}
        style={{
          padding: '9px 16px', borderRadius: 10,
          border: 'none', background: 'var(--signal-eff)',
          color: 'var(--ink)',
          font: '700 12px var(--font-ui)', letterSpacing: 0.02,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        {t('preview.upgrade')}
      </button>
      <button type="button" onClick={exit}
        style={{
          padding: '9px 12px', borderRadius: 10,
          border: '1px solid var(--line)', background: 'transparent',
          color: 'var(--tx-md)',
          font: '600 12px var(--font-ui)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        {t('preview.exit')}
      </button>
    </div>
  );
};

// ── RequestAnalysisInline (v01.59) ────────────────────────────
// Synced from mobile v02.12. Inline (non-overlay) variant of the
// Deck hero's RequestAnalysisButton. Used by the sidebar (always-
// visible global access) and by the Races page header (contextual).
// Self-contained: owns its own usePARequests() call and dispatches
// `pa:open-modal` on click — AthleteDeck's modal manager listens
// for that event and routes to the correct sub-modal (upload /
// buy / try) based on quota state.
//
// Why a NEW component instead of reusing RequestAnalysisButton from
// web-deck.jsx: the Deck button is positioned `absolute, top:14, right:14`
// to overlay the hero card. That positioning is wrong for inline
// placements. Rather than refactor the existing button (risk on the
// Deck), this component duplicates ~40 lines of label/tone/caption
// logic. If this becomes a third placement, factor a
// `useRequestAction(athleteUuid)` hook out of both into a shared lib.
const RequestAnalysisInline = ({ athleteUuid, fullWidth = true, compact = false }) => {
  const tFn = (window.useT || (() => (k) => k))();
  const requestsState = (window.usePARequests
    ? window.usePARequests(athleteUuid)
    : { nextAction: 'loading', quota: null, isTrialing: false, trialDays: null, isPolling: false });
  const { nextAction, quota, isTrialing, trialDays, isPolling } = requestsState;

  const label =
    nextAction === 'upload' ? tFn('deck.requestBtn.upload') :
    nextAction === 'buy'    ? tFn('deck.requestBtn.buy')    :
    nextAction === 'try'    ? tFn('deck.requestBtn.try')    :
                              tFn('deck.requestBtn.loading');

  const tone =
    nextAction === 'upload' ? { bg: 'var(--signal-eff)', fg: 'var(--ink)',       border: 'transparent' } :
    nextAction === 'buy'    ? { bg: 'transparent',       fg: 'var(--flag-eff)',   border: 'color-mix(in oklch, var(--flag-eff) 50%, transparent)' } :
                              { bg: 'transparent',       fg: 'var(--signal-eff)', border: 'color-mix(in oklch, var(--signal-eff) 50%, transparent)' };

  const R = window.PA_REQUESTS;
  const caption = (() => {
    if (isPolling) return tFn('deck.requestBtn.checking');
    if (!quota) return '';
    if (isTrialing && Number.isFinite(trialDays)) return 'Trial · ' + trialDays + 'd left';
    if (quota.status === 'none') return tFn('deck.requestBtn.noSubscription');
    return R ? R.quotaLabel(quota) : (quota.used + ' of ' + quota.limit + ' used');
  })();

  const onClick = () => {
    const target = nextAction === 'upload' ? 'upload' : 'buy';
    try {
      window.dispatchEvent(new CustomEvent('pa:open-modal', { detail: { modal: target } }));
    } catch (_) {}
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5,
      alignItems: fullWidth ? 'stretch' : 'flex-end',
      width: fullWidth ? '100%' : 'auto',
    }}>
      <button
        type="button"
        onClick={onClick}
        disabled={nextAction === 'loading'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: 6,
          padding: compact ? '7px 11px' : '9px 12px',
          borderRadius: 10,
          background: tone.bg, color: tone.fg,
          border: '1px solid ' + tone.border,
          font: '600 ' + (compact ? '11px' : '12px') + ' var(--font-ui)',
          letterSpacing: '0.01em',
          cursor: nextAction === 'loading' ? 'wait' : 'pointer',
          opacity: nextAction === 'loading' ? 0.5 : 1,
          width: fullWidth ? '100%' : 'auto',
          whiteSpace: 'nowrap',
        }}>
        <Icon name="plus" size={compact ? 12 : 13}/> {label}
      </button>
      {caption && (
        <span className="mono" style={{
          font: '500 10px var(--font-mono)',
          color: isPolling ? 'var(--signal-eff)' : 'var(--tx-lo)',
          letterSpacing: '0.04em',
          textAlign: fullWidth ? 'center' : 'right',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          gap: 5,
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

// ── ProUpgradeBanner (v01.60 / 2026-05-12) ────────────────────
// Persistent "Upgrade to Pro" call-to-action shown above athlete
// surfaces (Deck / Races / Starts / Turns) for free users.
//
// Web variant: clicks open the Stripe pay-link directly (no Buy
// modal exists on web prototype-v03 — payment routing is handled
// by Stripe customer portal / pay-link, not a dedicated modal).
// Mobile variant (in prototype-v03-mobile) dispatches a
// pa:open-modal event instead, which routes through BuyAnalysisModal
// → IAP on native. Banner UI is otherwise identical.
//
// X dismisses for the session via sessionStorage. Visibility gating
// (free user, on athlete view) is done by the parent (index.html App
// render) — banner only handles its own dismissed state.
const ProUpgradeBanner = ({ authUserId, email }) => {
  const { useState } = React;
  const t = (window.useT || (() => (k) => k))();
  const isMobile = (window.useIsMobile || (() => false))();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof sessionStorage !== 'undefined'
        && sessionStorage.getItem('pa_pro_banner_dismissed') === '1';
    } catch (_) { return false; }
  });

  if (dismissed) return null;

  const openStripe = () => {
    const url = window.PA_REQUESTS?.STRIPE_LINKS?.pro;
    if (!url) return;
    const finalUrl = window.PA_REQUESTS?.buildStripeUrl
      ? window.PA_REQUESTS.buildStripeUrl(url, { authUserId, email })
      : url;
    try { window.open(finalUrl, '_blank', 'noopener,noreferrer'); } catch (_) {}
  };

  const dismiss = (e) => {
    e.stopPropagation();
    try { sessionStorage.setItem('pa_pro_banner_dismissed', '1'); } catch (_) {}
    setDismissed(true);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openStripe}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openStripe(); }}
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: isMobile ? 12 : 20,
        padding: isMobile ? '14px 16px' : '14px 20px',
        marginBottom: 16,
        background: 'color-mix(in oklch, var(--signal-eff) 8%, var(--bg-2))',
        border: '1.5px solid color-mix(in oklch, var(--signal-eff) 40%, var(--line))',
        borderRadius: 14,
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          font: '700 14px var(--font-ui)',
          color: 'var(--tx-hi)',
          marginBottom: 4,
        }}>
          {t('deck.proBanner.headline')}
        </div>
        <div style={{
          font: '500 12px var(--font-ui)',
          color: 'var(--tx-md)',
          lineHeight: 1.4,
        }}>
          {t('deck.proBanner.subline')}
        </div>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        justifyContent: isMobile ? 'space-between' : 'flex-end',
      }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openStripe(); }}
          style={{
            background: 'var(--signal-eff)',
            color: 'var(--ink)',
            border: 'none',
            padding: '9px 16px',
            borderRadius: 10,
            font: '700 12px var(--font-ui)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('deck.proBanner.cta')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            width: 30, height: 30,
            background: 'transparent',
            border: 'none',
            color: 'var(--tx-lo)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
};

// ── Expose for later components ──
Object.assign(window, {
  Icon, PeakMark, BigNumber, Delta,
  BarSpark, LineSpark,
  SectionLabel, ImagePlaceholder,
  LoadingState, EmptyState, ErrorState,
  useIsMobile, useT,
  Toaster, ConfirmHost,
  PreviewBanner,
  RequestAnalysisInline,
  ProUpgradeBanner,
  StuckBanner,
  ChartScroll,
});
