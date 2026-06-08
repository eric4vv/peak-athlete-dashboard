/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Analysis shell — shared atoms for Races / Starts / Turns

   The same shell is reused across all three analysis pages so
   the selection, filter, and detail UX is identical everywhere.

   Components (all exposed on window):
     FilterBar        — distance / style / course chips + date range
     HeadlineStrip    — 3–4 KPI tiles computed off slotA (± slotB)
     SelectionSlots   — two slot chips (Option D selection model)
     TrialRow         — one clickable trial in the list
     TrialList        — virtualized-friendly flat list of TrialRow
     DetailPane       — single / compare / benchmark body wrapper
     BenchmarkMenu    — "Compare to PB / Median" dropdown

   Selection model (Option D):
     { slotA: trialKey | null,
       slotB: trialKey | 'PB' | 'MEDIAN' | 'WR' | null }

   Clicking a row:
     - empty slots            → fills slotA
     - slotA filled, slotB 0  → fills slotB (compare mode)
     - clicking assigned row  → clears that slot
   ─────────────────────────────────────────────────────────── */

const K = window.PA_KPIS;
const C = window.PA_COMPARE;

// Default helper bundle (races). Starts pass their own via `helpers`
// prop so the same Slot / TrialRow / TrialList / SelectionSlots
// atoms can drive either page. Shape:
//   { title(trial), date(trial), time(trial), key(trial) }
//   - title: event/trial display string
//   - date:  short human date
//   - time:  headline numeric (race total or 15 m split)
//   - key:   stable selection key
const DEFAULT_HELPERS = {
  title: (t) => K.raceTitle(t),
  date:  (t) => K.raceDate(t),
  time:  (t) => K.raceTotalTime(t),
  key:   (t) => K.trialKey(t),
  // v01.49 — raw ISO date used for the free-tier session-lock
  // sort. Defaults to source_date which all kpi views expose.
  rawDate: (t) => t?.source_date || null,
};

// ── FilterBar ─────────────────────────────────────────────────

const FilterBar = ({ options, filters, onChange }) => {
  // v01.24 — translated chrome. Distance / Style / Course eyebrows
  // and the "All" reset chip flip on EN ↔ ES. Stroke values use
  // the existing `deck.strokes.*` table for consistency with the
  // Deck NextFocus / SquadFocus pills.
  const t = (window.useT || (() => (k) => k))();
  const set = (patch) => onChange({ ...filters, ...patch });
  const chip = (label, active, onClick) => (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line)'),
        background: active ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)' : 'transparent',
        color: active ? 'var(--signal-eff)' : 'var(--tx-md)',
        font: '600 12px var(--font-ui)',
        letterSpacing: 0.02,
        cursor: 'pointer',
      }}>
      {label}
    </button>
  );

  // Map style values to translation keys. Live's data shape is
  // 'freestyle' / 'backstroke' / 'breaststroke' / 'butterfly' /
  // 'medley'. The deck.strokes.* table uses the short forms; map
  // long → short here. Unknown values fall back to capitalised raw.
  const strokeLabel = (s) => {
    const lower = String(s || '').toLowerCase();
    if (lower.startsWith('free'))  return t('deck.strokes.free');
    if (lower.startsWith('back'))  return t('deck.strokes.back');
    if (lower.startsWith('breast'))return t('deck.strokes.breast');
    if (lower.startsWith('fly') || lower.startsWith('butter')) return t('deck.strokes.fly');
    if (lower === 'medley' || lower === 'im') return 'IM';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                  padding: '10px 12px', background: 'var(--bg-2)',
                  border: '1px solid var(--line-soft)', borderRadius: 12 }}>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 6 }}>{t('analysis.filter.distance')}</span>
      {chip(t('analysis.filter.all'), !filters.distance, () => set({ distance: null }))}
      {(options.distances || []).map(d => chip(d + ' ' + t('analysis.filter.metersUnit'), filters.distance === d, () => set({ distance: d })))}

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-soft)', margin: '0 4px' }}/>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 6 }}>{t('analysis.filter.style')}</span>
      {chip(t('analysis.filter.all'), !filters.style, () => set({ style: null }))}
      {(options.styles || []).map(s => chip(strokeLabel(s),
         filters.style === s, () => set({ style: s })))}

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-soft)', margin: '0 4px' }}/>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)', marginRight: 6 }}>{t('analysis.filter.course')}</span>
      {chip(t('analysis.filter.all'), !filters.course, () => set({ course: null }))}
      {/* Course values (LCM / SCM / SCY) are universal — same in EN/ES. */}
      {(options.courses || []).map(c => chip(c, filters.course === c, () => set({ course: c })))}
    </div>
  );
};

// ── HelpDot (v00.35) ──────────────────────────────────────────
// Small "i" icon that toggles a styled popover with explainer copy.
// Click/tap to open, click outside to close. Mobile-friendly —
// native `title` attributes don't surface on touch devices, so this
// atom is the prototype's canonical way to attach explanations to
// labels (KPI tiles, bar legends, table rows).
//
// Inputs:
//   text       — string or React node shown inside the popover
//   placement  — 'top' (default) | 'bottom'
//   size       — px diameter of the dot (default 14)
const HelpDot = ({ text, placement = 'top', size = 14 }) => {
  const [open, setOpen] = React.useState(false);
  // v01.63 — anchor adapts to viewport so popovers near edges don't
  // overflow horizontally. Measured on open via getBoundingClientRect.
  //   'center' — popover centered on the dot (default, plenty of room)
  //   'right'  — popover's right edge anchored to dot (near right viewport edge)
  //   'left'   — popover's left edge anchored to dot (near left viewport edge)
  const [anchor, setAnchor] = React.useState('center');
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  // Measure viewport position on open. Choose anchor that keeps the
  // popover fully visible. 280 px = matches maxWidth below; 8 px margin
  // from viewport edges feels comfortable.
  React.useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const POPOVER_W = 280;
    const MARGIN = 8;
    const centerX = r.left + r.width / 2;
    if (centerX + POPOVER_W / 2 > vw - MARGIN) {
      setAnchor('right');
    } else if (centerX - POPOVER_W / 2 < MARGIN) {
      setAnchor('left');
    } else {
      setAnchor('center');
    }
  }, [open]);

  // Position style swap based on anchor. Always rendered absolute
  // relative to the dot wrapper.
  const posStyle = anchor === 'center'
    ? { left: '50%', transform: 'translateX(-50%)' }
    : anchor === 'right'
    ? { right: 0 }
    : { left: 0 };

  return (
    <span ref={ref} style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      marginLeft: 4, verticalAlign: 'middle',
    }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label="More info"
        style={{
          width: size, height: size, borderRadius: '50%',
          border: '1px solid var(--line)',
          background: open ? 'var(--bg)' : 'var(--bg-3)',
          color: 'var(--tx-md)',
          font: '700 9px var(--font-ui)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0, lineHeight: 1,
        }}>
        i
      </button>
      {open && (
        <span style={{
          position: 'absolute',
          bottom: placement === 'top'    ? 'calc(100% + 8px)' : 'auto',
          top:    placement === 'bottom' ? 'calc(100% + 8px)' : 'auto',
          ...posStyle,
          minWidth: 220, maxWidth: 280, zIndex: 30,
          padding: '10px 12px', borderRadius: 10,
          // bg-3 contrasts against the page in both dark and light
          // scope; bg-1 (the page background) made the popover blend
          // in dark mode. Stronger border + shadow lifts the popover
          // off the surrounding card.
          background: 'var(--bg-3)',
          border: '1px solid var(--line)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          font: '500 12px var(--font-ui)',
          color: 'var(--tx-hi)', lineHeight: 1.5,
          whiteSpace: 'normal', textAlign: 'left',
        }}>
          {text}
        </span>
      )}
    </span>
  );
};

// ── SelectionSlots ────────────────────────────────────────────

const Slot = ({ role, trial, benchmarkKind, onClear, onOpen, helpers = DEFAULT_HELPERS, emptyLabel, benchmarkUnavailable = false, warnHint }) => {
  // v01.24 — translated. Role string ("Primary" / "Compare") is
  // still passed in by call sites (WebRaces / WebStarts / WebTurns)
  // for the accent color test below; we map it to the translated
  // label via t() at render. emptyLabel + warnHint defaults are
  // now resolved here from the dict so callers don't have to
  // pre-translate them.
  const t = (window.useT || (() => (k) => k))();
  const filled = !!trial || !!benchmarkKind;
  // Unavailable = a benchmark was picked but no peer trial matched
  // (same event / stroke / course). We still show the slot as
  // "filled" so the × clear button is usable, but use a muted
  // warning treatment so it reads as "this didn't resolve" rather
  // than a successful compare.
  const warn = !!benchmarkKind && benchmarkUnavailable;
  // Role-driven accent. Compare slot uses --compare-eff (matches the
  // blue-violet bars/values in LapBars / Stroke Mechanics / VS PB),
  // so the user can trace a compare trial from selection → graphs by
  // color. Primary stays on the theme accent (--signal-eff).
  const isCompare = role === 'Compare';
  const accent = isCompare ? 'var(--compare-eff)' : 'var(--signal-eff)';
  // Role label — translated. Falls back to the raw string if the
  // dict doesn't have a match (e.g. unknown future roles).
  const roleLabel = isCompare
    ? t('analysis.slot.compare')
    : (role === 'Primary' ? t('analysis.slot.primary') : role);
  // empty-label + warn-hint defaults from dict.
  const effectiveEmpty = emptyLabel || t('analysis.slot.selectRace');
  const effectiveWarnHint = warnHint || t('analysis.slot.warnHintRace');
  const label  = benchmarkKind
    ? (warn
        ? t('analysis.slot.noComparable')
        : ({
            PB:     t('analysis.benchmark.personalBest'),
            MEDIAN: t('analysis.benchmark.medianRace'),
            WR:     t('analysis.benchmark.worldRecord'),
          }[benchmarkKind] || benchmarkKind))
    : trial ? helpers.title(trial) : effectiveEmpty;
  const border = warn
    ? 'var(--tx-lo)'
    : filled ? accent : 'var(--line)';
  const bg = warn
    ? 'var(--bg-2)'
    : filled ? ('color-mix(in oklch, ' + accent + ' 10%, transparent)') : 'var(--bg-2)';
  const labelTone = warn
    ? 'var(--tx-md)'
    : filled ? 'var(--tx-hi)' : 'var(--tx-lo)';

  return (
    <div style={{
      flex: 1, minWidth: 0,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 12,
      border: '1px ' + (warn ? 'dashed ' : 'solid ') + border,
      background: bg,
      cursor: onOpen ? 'pointer' : 'default',
    }} onClick={onOpen}>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)', letterSpacing: 0.1 }}>
        {role}
      </span>
      <span style={{
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        font: '600 13px var(--font-ui)',
        color: labelTone,
      }}>
        {label}
        {trial && !warn && <span style={{ color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 8 }}>
          · {helpers.date(trial)}
        </span>}
        {warn && <span style={{ color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 8 }}>
          · {warnHint}
        </span>}
      </span>
      {filled && (
        <button onClick={(e) => { e.stopPropagation(); onClear && onClear(); }}
          style={{
            border: 'none', background: 'transparent', color: 'var(--tx-lo)',
            cursor: 'pointer', padding: 4, lineHeight: 1,
          }}
          title="Clear slot">×</button>
      )}
    </div>
  );
};

// v01.19 — `showWR` prop opts the menu into the World Record
// option. Race contexts (WebRaces) pass true; starts/turns leave
// it false (the benchmarks table only carries race records, and
// "WR" for a start or turn isn't a standard concept). The label
// "World record" never exposes the holder name (see CLAUDE.md
// security rule 5; the resolver in race-compare.js also omits
// holder_name from its SELECT for defense-in-depth).
const BenchmarkMenu = ({ onPick, disabled, showWR = false }) => {
  const t = (window.useT || (() => (k) => k))();
  const [open, setOpen] = React.useState(false);
  const items = [
    { key: 'PB',     label: t('analysis.benchmark.personalBest'),  hint: t('analysis.benchmark.personalBestHint') },
    { key: 'MEDIAN', label: t('analysis.benchmark.medianRace'),    hint: t('analysis.benchmark.medianRaceHint') },
    ...(showWR
      ? [{ key: 'WR', label: t('analysis.benchmark.worldRecord'), hint: t('analysis.benchmark.worldRecordHint') }]
      : []),
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        style={{
          padding: '10px 14px', borderRadius: 12,
          border: '1px solid var(--line)', background: 'var(--bg-2)',
          color: disabled ? 'var(--tx-lo)' : 'var(--tx-md)',
          font: '600 12px var(--font-ui)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}>
        {t('analysis.benchmark.compareTo')}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 200,
          background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 12,
          boxShadow: 'var(--shadow)', zIndex: 10, padding: 6,
        }}>
          {items.map(it => (
            <button key={it.key} onClick={() => { onPick(it.key); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 10px', borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--tx-hi)',
                font: '600 13px var(--font-ui)', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {it.label}
              <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 2 }}>
                {it.hint}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SelectionSlots = ({ slotATrial, slotBTrial, slotBKind, onClearA, onClearB, onPickBenchmark, helpers = DEFAULT_HELPERS, emptyLabel = 'Select a race', benchmarkUnavailable = false, warnHint, showWR = false }) => (
  // v01.08 — `flexWrap: 'wrap'` lets the two Slot cards + BenchmarkMenu
  // wrap to a second row on narrow screens (the trio totals ~390px,
  // overflowing a 343px iPhone content area). Each Slot has
  // `flex: '1 1 calc(50% - 5px)'` so they share the row two-up; the
  // BenchmarkMenu pill drops below them.
  <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
    <Slot role="Primary" trial={slotATrial} onClear={onClearA}
          helpers={helpers} emptyLabel={emptyLabel}/>
    <Slot role="Compare" trial={slotBTrial} benchmarkKind={slotBKind} onClear={onClearB}
          helpers={helpers} emptyLabel={emptyLabel}
          benchmarkUnavailable={benchmarkUnavailable}
          warnHint={warnHint}/>
    <BenchmarkMenu onPick={onPickBenchmark} disabled={!slotATrial} showWR={showWR}/>
  </div>
);

// ── HeadlineStrip ─────────────────────────────────────────────

const Tile = ({ label, value, unit, tone, sub }) => (
  <div style={{
    flex: 1, minWidth: 0,
    padding: '14px 16px', borderRadius: 12,
    background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
  }}>
    <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
      <span className="num-lg display" style={{
        fontFamily: 'var(--font-mono)', color: tone || 'var(--tx-hi)',
      }}>
        {value ?? '—'}
      </span>
      {unit && value != null && (
        <span style={{ font: '600 13px var(--font-mono)', color: 'var(--tx-lo)' }}>{unit}</span>
      )}
    </div>
    {sub && <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 4 }}>{sub}</div>}
  </div>
);

const fmtSec = (v) => v == null ? null : Number(v).toFixed(2);
const fmtDelta = (v) => {
  if (v == null) return null;
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(2);
};

const HeadlineStrip = ({ primary, compare, diff }) => {
  if (!primary) return null;
  const total     = K.raceTotalTime(primary);
  const avgRate   = K.avgStrokeRate(primary);
  const splits    = K.extractSplits(primary.mj || primary.metrics_json);
  const segs      = K.splitsToSegments(splits);
  const bestSeg   = segs.length ? segs.reduce((a, b) => a.segTime < b.segTime ? a : b) : null;
  const tDeltaTone = diff?.totalDelta == null ? null :
    (diff.totalDelta < 0 ? 'var(--lime-eff)' : diff.totalDelta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)');

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <Tile label="Race time" value={fmtSec(total)} unit="s"
            sub={K.raceTitle(primary)}/>
      <Tile label="Avg stroke rate" value={avgRate != null ? avgRate.toFixed(1) : null} unit="spm"
            sub={splits.length + ' splits captured'}/>
      <Tile label="Best split" value={bestSeg ? bestSeg.segTime.toFixed(2) : null} unit="s"
            sub={bestSeg ? bestSeg.label : null}/>
      {compare && diff && (
        <Tile label="vs compare"
              value={fmtDelta(diff.totalDelta)} unit="s"
              tone={tDeltaTone}
              sub={diff.totalDelta != null ? (diff.totalDelta < 0 ? 'faster overall' : 'slower overall') : null}/>
      )}
    </div>
  );
};

// ── TrialRow + TrialList ──────────────────────────────────────

const SlotTag = ({ which }) => (
  <span style={{
    padding: '2px 7px', borderRadius: 6,
    background: 'var(--signal-eff)', color: 'var(--ink)',
    font: '700 10px var(--font-mono)', letterSpacing: 0.06,
  }}>{which}</span>
);

const TrialRow = ({ trial, state, onAssign, helpers = DEFAULT_HELPERS, locked = false, onLockedClick }) => {
  const t = (window.useT || (() => (k) => k))();
  const isSlotA = state === 'slotA';
  const isSlotB = state === 'slotB';
  const isActive = isSlotA || isSlotB;
  const total = helpers.time(trial);

  // v01.49 — locked rows route to onUpgrade via onLockedClick
  // instead of firing onAssign. Free users see the row at half
  // opacity with a lock icon and a Pro hint on hover.
  const handleClick = () => {
    if (locked) { onLockedClick?.(); return; }
    onAssign(trial);
  };

  return (
    <div
      onClick={handleClick}
      title={locked ? t('analysis.trialLock.tooltip') : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        border: '1px solid ' + (
          locked   ? 'color-mix(in oklch, var(--amber-eff) 30%, transparent)'
        : isActive ? 'var(--signal-eff)'
                   : 'var(--line-soft)'
        ),
        background: locked
          ? 'color-mix(in oklch, var(--amber-eff) 5%, transparent)'
          : isActive
            ? 'color-mix(in oklch, var(--signal-eff) 8%, transparent)'
            : 'var(--bg-2)',
        cursor: 'pointer',
        opacity: locked ? 0.7 : 1,
      }}>
      <div style={{ minWidth: 36, display: 'flex', justifyContent: 'flex-start' }}>
        {isSlotA && !locked && <SlotTag which="A"/>}
        {isSlotB && !locked && <SlotTag which="B"/>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          font: '600 13px var(--font-ui)',
          color: locked ? 'var(--tx-md)' : 'var(--tx-hi)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {helpers.title(trial)}
        </div>
        <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 2 }}>
          {helpers.date(trial)}
        </div>
      </div>
      <div style={{
        font: '600 13px var(--font-mono)',
        color: locked ? 'var(--tx-lo)' : 'var(--tx-hi)',
        textAlign: 'right',
      }}>
        {total != null
          ? (window.PA_KPIS && window.PA_KPIS.fmtTime
              ? window.PA_KPIS.fmtTime(total, 2)
              : total.toFixed(2) + ' s')
          : '—'}
      </div>
      <div style={{ width: 20, color: 'var(--tx-lo)', textAlign: 'right' }}>
        {locked
          ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--amber-eff)" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          )
          : <Icon name="chev" size={14}/>}
      </div>
    </div>
  );
};

const TrialList = ({
  trials, slotAKey, slotBKey, onAssign, emptyMessage,
  helpers = DEFAULT_HELPERS, isPro = true, onUpgrade,
  // v03.28 — optional collapse controls. When `onToggleCollapsed`
  // is provided, the list renders a chevron toggle and switches
  // to a thin rail view when `collapsed` is true. Each tab
  // (web-races, web-starts, web-turns) owns the state and also
  // narrows the parent grid column when collapsed.
  collapsed = false,
  onToggleCollapsed = null,
}) => {
  const t = (window.useT || (() => (k) => k))();
  const Icon = window.Icon;

  // Collapsed rail — just chevron + count. No rows. The user
  // expands first to switch trials. Slot indicators are visible
  // on the right-hand detail panel anyway, so we don't repeat
  // them here.
  // v03.64 — Mobile-specific collapsed UI: a horizontal pill
  // instead of the vertical rail (vertical rail only saves space
  // on multi-column desktop layouts). The pill fills the row and
  // taps to expand.
  if (collapsed && onToggleCollapsed) {
    const isMobile = window.useIsMobile && window.useIsMobile();
    const trialCount = (trials || []).length;
    if (isMobile) {
      return (
        <button type="button" onClick={onToggleCollapsed}
          title="Show trial list"
          style={{
            display: 'flex', width: '100%',
            alignItems: 'center', justifyContent: 'space-between',
            font: '700 12px var(--font-mono)', letterSpacing: 0.08,
            padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
            background: 'var(--bg-2)', color: 'var(--tx-md)',
            border: '1px solid var(--line-soft)',
          }}>
          <span>TRIALS · {trialCount}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: 'var(--tx-lo)', font: '500 11px var(--font-ui)',
          }}>
            Tap to expand
            {Icon && <Icon name="chev" size={12}/>}
          </span>
        </button>
      );
    }
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 10,
        padding: '6px 0',
      }}>
        <button type="button" onClick={onToggleCollapsed}
          title="Show trial list"
          style={{
            font: '600 11px var(--font-ui)',
            padding: '6px 8px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent', color: 'var(--tx-md)',
            border: '1px solid var(--line-soft)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
          {Icon && <Icon name="chev" size={11}/>}
        </button>
        <div style={{
          font: '700 9px var(--font-mono)', letterSpacing: 0.08,
          color: 'var(--tx-lo)', writingMode: 'vertical-rl',
          transform: 'rotate(180deg)', padding: '6px 0',
        }}>
          TRIALS · {trialCount}
        </div>
      </div>
    );
  }
  // v01.50 — Preview-aware empty state. When the user has zero
  // trials AND isn't already in preview mode, surface the
  // "Preview with sample data" CTA so new users can experience
  // the dashboard before uploading. Highest-leverage onboarding
  // entry point.
  const previewOn = window.PA_PREVIEW?.isOn?.() || false;
  const enterPreview = () => window.PA_PREVIEW?.enter?.();
  if (!trials || !trials.length) {
    return (
      <div style={{
        padding: 28, borderRadius: 12, background: 'var(--bg-2)',
        border: '1px dashed var(--line)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          font: '700 14px var(--font-display)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em',
        }}>
          {t('preview.emptyTitle')}
        </div>
        <div style={{
          font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
          maxWidth: 420, textAlign: 'center', lineHeight: 1.5,
        }}>
          {emptyMessage || t('preview.emptyBody')}
        </div>
        {!previewOn && window.PA_PREVIEW && (
          <button type="button"
            onClick={enterPreview}
            style={{
              marginTop: 4,
              padding: '9px 16px', borderRadius: 10,
              border: 'none', background: 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 12px var(--font-ui)', letterSpacing: 0.02,
              cursor: 'pointer',
            }}>
            {t('preview.previewBtn')}
          </button>
        )}
      </div>
    );
  }

  // v01.49 — Free-tier session lock. Mirrors live's pattern
  // (index.html:13088): non-Pro users see only the 2 most-recent
  // sessions unlocked; older rows are visually locked and click
  // upgrades instead of assigning a slot. We compute unlock keys
  // here (in the chokepoint) so each consumer page (web-races,
  // web-starts, web-turns) inherits the gate without per-page logic.
  const unlockedKeys = (() => {
    if (isPro) return null; // null = no gate
    const dated = trials.map(tr => ({
      tr, k: helpers.key(tr), d: helpers.rawDate ? helpers.rawDate(tr) : null,
    }));
    dated.sort((a, b) => {
      const da = a.d || '';
      const db = b.d || '';
      if (da === db) return 0;
      return da < db ? 1 : -1; // newest first
    });
    return new Set(dated.slice(0, 2).map(x => x.k));
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* v03.28 — Hide chevron at the top. Lets the coach
          reclaim ~280 px for charts / video by collapsing the
          trial list to a thin rail. Only shown when the parent
          tab provides onToggleCollapsed. */}
      {onToggleCollapsed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onToggleCollapsed}
            title="Hide trial list"
            style={{
              font: '600 11px var(--font-ui)',
              padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
              background: 'transparent', color: 'var(--tx-md)',
              border: '1px solid var(--line-soft)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
            {Icon && (
              <Icon name="chev" size={11}
                style={{ transform: 'rotate(180deg)' }}/>
            )}
            Hide
          </button>
        </div>
      )}
      {/* v01.49 — Pro upsell strip on top of the list when there
          are locked sessions. Two CTAs: Upgrade (paid) and
          Try Pro (preview mode, v01.50). */}
      {!isPro && unlockedKeys && trials.length > 2 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 10,
            background: 'color-mix(in oklch, var(--signal-eff) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--signal-eff) 30%, transparent)',
            flexWrap: 'wrap',
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--signal-eff)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              font: '700 12px var(--font-ui)', color: 'var(--tx-hi)',
              letterSpacing: 0.02,
            }}>
              {t('analysis.trialLock.title')}
            </div>
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
              marginTop: 2, lineHeight: 1.4,
            }}>
              {t('analysis.trialLock.body')}
            </div>
          </div>
          {/* v01.50 — Preview Pro alongside Upgrade. Lower-friction
              path: lets the user TRY the locked feature with sample
              data instead of paying upfront. */}
          {window.PA_PREVIEW && !previewOn && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); enterPreview(); }}
              style={{
                padding: '6px 10px', borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--signal-eff) 50%, transparent)',
                background: 'transparent', color: 'var(--signal-eff)',
                font: '700 11px var(--font-ui)', letterSpacing: 0.04,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {t('preview.tryHistory')}
            </button>
          )}
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onUpgrade?.(); }}
            style={{
              padding: '6px 10px', borderRadius: 8,
              border: 'none', background: 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 11px var(--font-ui)', letterSpacing: 0.04,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {t('analysis.trialLock.cta')}
          </button>
        </div>
      )}
      {trials.map((tr, i) => {
        const k = helpers.key(tr);
        const state = k === slotAKey ? 'slotA' : k === slotBKey ? 'slotB' : 'idle';
        const locked = unlockedKeys ? !unlockedKeys.has(k) : false;
        return (
          <TrialRow
            key={k || i}
            trial={tr}
            state={state}
            onAssign={onAssign}
            helpers={helpers}
            locked={locked}
            onLockedClick={() => onUpgrade?.()}
          />
        );
      })}
    </div>
  );
};

// ── Card primitives ───────────────────────────────────────────
// ChartCard — the design-reference pattern: .card .card-pad with
// an eyebrow title header and optional right slot (pill, toggle,
// delta chip). All charts/tables render inside one of these.

const ChartCard = ({ title, right, children, padded = true, style }) => (
  <div className={'card' + (padded ? ' card-pad' : '')} style={style}>
    {(title || right) && (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 14,
      }}>
        {title && <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{title}</div>}
        {right}
      </div>
    )}
    {children}
  </div>
);

// Hero headline card — mirrors the design-reference Headline block
// but lives inside its own .card so it visually anchors the detail
// column. Shows the race time (colored if PB or compare-faster),
// event name, and a compare sub-line when slotB is set.
const RaceHeadlineCard = ({ primary, compare, diff, summary }) => {
  if (!primary) return null;
  const total = K.raceTotalTime(primary);
  const toneTime = diff?.totalDelta != null
    ? (diff.totalDelta < 0 ? 'var(--lime-eff)' : diff.totalDelta > 0 ? 'var(--flag-eff)' : 'var(--tx-hi)')
    : 'var(--tx-hi)';
  const fmt = (v) => v == null ? '—' : Number(v).toFixed(2);

  // Subtitle — compare mode shows a short story, otherwise show event date
  let sub = K.raceDate(primary);
  if (compare && diff?.totalDelta != null) {
    const abs = Math.abs(diff.totalDelta).toFixed(2);
    const verb = diff.totalDelta < 0 ? 'faster' : diff.totalDelta > 0 ? 'slower' : 'even';
    sub = compare._benchmarkKind
      ? `${abs}s ${verb} than your ${compare._benchmarkKind === 'PB' ? 'personal best' : 'median race'}`
      : `${abs}s ${verb} than ${K.raceTitle(compare)} on ${K.raceDate(compare)}`;
    if (summary?.biggestLoss) {
      sub += ' — lost most time at ' + summary.biggestLoss.label;
    } else if (summary?.biggestGain && !summary?.biggestLoss) {
      sub += ' — gained most at ' + summary.biggestGain.label;
    }
  }

  const rightChip = compare && diff?.totalDelta != null
    ? (
      <span className={'pill ' + (diff.totalDelta < 0 ? 'lime' : 'flag')}
            style={{ fontSize: 11 }}>
        {diff.totalDelta < 0 ? '−' : '+'}{Math.abs(diff.totalDelta).toFixed(2)}s
      </span>
    )
    : null;

  return (
    <div className="card card-pad" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--tx-lo)' }}>
            {K.raceTitle(primary).toUpperCase()}
          </div>
          <div className="display" style={{
            fontSize: 38, lineHeight: 1.05, letterSpacing: '-0.025em',
            fontFamily: 'var(--font-mono)', color: toneTime,
          }}>
            {fmt(total)}<span style={{ fontSize: 22, marginLeft: 6, opacity: 0.55 }}>s</span>
          </div>
          {sub && (
            <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
                          marginTop: 8, maxWidth: 560 }}>
              {sub}
            </div>
          )}
        </div>
        {rightChip}
      </div>
    </div>
  );
};

// ── Headline (free-standing hero — NOT a card) ────────────────
// Mirrors design-reference/web-analysis.jsx:Headline exactly.
// eyebrow + display-size title + subtitle story + right chip slot.
// Lives ABOVE the cards; no border, no padding, no card wrapper.
const Headline = ({ eyebrow, title, sub, right }) => (
  <div style={{
    display: 'flex', gap: 24, alignItems: 'flex-end',
    justifyContent: 'space-between', marginBottom: 4,
  }}>
    <div style={{ minWidth: 0, flex: 1 }}>
      {eyebrow && (
        <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--tx-lo)' }}>
          {eyebrow}
        </div>
      )}
      <div className="display" style={{
        fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.025em', maxWidth: 620,
      }}>
        {title}
      </div>
      {sub && (
        <div style={{
          font: '400 14px var(--font-ui)', color: 'var(--tx-md)',
          marginTop: 8, maxWidth: 640,
        }}>
          {sub}
        </div>
      )}
    </div>
    {right}
  </div>
);

// ── Race story derivation ─────────────────────────────────────
// Packs everything the Headline needs into one object so the page
// doesn't branch on compare state inline. Returns null if no
// primary trial.
function buildRaceStory(primary, compare, diff) {
  if (!primary) return null;
  const total  = K.raceTotalTime(primary);
  const splits = K.extractSplits(primary.mj || primary.metrics_json);
  const segs   = K.splitsToSegments(splits);

  // Eyebrow: "RACES · 100 FREESTYLE · 17 APR"
  const title = K.raceTitle(primary) || '';
  const date  = K.raceDate(primary) || '';
  const eyebrow = ('RACES · ' + title + (date ? ' · ' + date : '')).toUpperCase();

  // Verdict + number tone
  let verdict = null;
  let timeTone = 'var(--tx-hi)';
  let rightChip = null;

  if (compare && diff?.totalDelta != null) {
    // race-compare.diffTrials: totalDelta = totalB - totalA.
    // totalDelta > 0 → B took longer → primary (A) is FASTER than compare.
    // totalDelta < 0 → B was shorter → primary (A) is SLOWER than compare.
    const abs = Math.abs(diff.totalDelta).toFixed(2);
    if (diff.totalDelta > 0) {
      timeTone = 'var(--lime-eff)';
      const kind = compare._benchmarkKind;
      if (kind === 'PB') {
        verdict = 'Personal best by ' + abs + ' s.';
        rightChip = (
          <span className="pill lime" style={{ fontSize: 11 }}>NEW PB</span>
        );
      } else if (kind === 'MEDIAN') {
        verdict = abs + ' s faster than your median race.';
      } else {
        verdict = abs + ' s faster than ' + (K.raceTitle(compare) || 'compare') + '.';
      }
    } else if (diff.totalDelta < 0) {
      timeTone = 'var(--flag-eff)';
      const kind = compare._benchmarkKind;
      if (kind === 'PB') {
        verdict = abs + ' s off personal best.';
      } else if (kind === 'MEDIAN') {
        verdict = abs + ' s slower than your median race.';
      } else {
        verdict = abs + ' s slower than ' + (K.raceTitle(compare) || 'compare') + '.';
      }
    } else {
      verdict = 'Matched compare time.';
    }
  }

  // Subtitle: negative/positive split story
  // v00.79: format halves through fmtTime so a 1500's "first half
  // 7:30, second half 7:34" reads correctly instead of "450.00 out,
  // 454.20 home." fmtTime keeps sub-60s halves in seconds form.
  let sub = null;
  if (segs.length >= 2) {
    const half = Math.floor(segs.length / 2);
    const firstSum  = segs.slice(0, half).reduce((a, s) => a + s.segTime, 0);
    const secondSum = segs.slice(-half).reduce((a, s) => a + s.segTime, 0);
    if (firstSum > 0 && secondSum > 0) {
      const f = K.fmtTime ? K.fmtTime(firstSum,  2).replace(/ s$/, '') : firstSum.toFixed(2);
      const s = K.fmtTime ? K.fmtTime(secondSum, 2).replace(/ s$/, '') : secondSum.toFixed(2);
      if (secondSum + 0.001 < firstSum) {
        sub = 'Negative split — ' + f + ' out, ' + s + ' home.';
      } else if (secondSum > firstSum + 0.001) {
        sub = 'Positive split — ' + f + ' out, ' + s + ' home.';
      } else {
        sub = 'Even split — ' + f + ' out, ' + s + ' home.';
      }
    }
  }

  // Title node: colored number + verdict sentence (design reference pattern).
  // v00.79: total goes through fmtTime so a 200 free shows 1:52.70
  // instead of 112.70. fmtTime returns trailing " s" for sub-minute
  // values which we strip here — the page already implies seconds.
  const totalDisplay = total == null
    ? '—'
    : (K.fmtTime ? K.fmtTime(total, 2).replace(/ s$/, '') : total.toFixed(2));
  const titleNode = (
    <>
      <span style={{ color: timeTone, fontFamily: 'var(--font-mono)' }}>
        {totalDisplay}
      </span>
      {verdict && (
        <>
          <span style={{ color: 'var(--tx-md)' }}> · </span>
          <span style={{ color: 'var(--tx-hi)' }}>{verdict}</span>
        </>
      )}
    </>
  );

  return { eyebrow, titleNode, sub, rightChip };
}

// ── Per-lap derivation ────────────────────────────────────────
// Combines splits (cumulative times) + stroke counts (per lap) +
// stroke rates (per 5m) into a single per-lap record the design
// reference visualizations need.
//
// Lap length is inferred: total distance / number of stroke-count
// rows. Falls back to segmenting by totalDistance / 4 when stroke
// counts are absent.
function derivePerLap(trial) {
  if (!trial) return [];
  const mj     = trial.mj || trial.metrics_json || {};
  const splits = K.extractSplits(mj);
  const counts = K.extractStrokeCounts(mj);
  const rates  = K.extractStrokeRates(mj);
  if (!splits.length) return [];

  // v03.66 — SCY unit fix. Templo labels split columns "Split N m"
  // for all course types, but SCY races measure those at YARD
  // positions. We use TRUE meters for velocity / DPS math and
  // keep the labeled value for the display string + splits lookup
  // so visualizations match Templo's column headers.
  const course      = K.courseOf ? K.courseOf(trial) : null;
  const totalLabel  = splits[splits.length - 1].distance;
  const totalDist   = K.actualMeters ? K.actualMeters(totalLabel, course) : totalLabel;
  const numLaps     = counts.length || Math.max(1, Math.round(totalLabel / 25));
  const lapLen      = totalDist / numLaps;         // TRUE meters per lap
  const lapLenLabel = totalLabel / numLaps;        // labeled (for display + splits lookup)

  const out = [];
  for (let l = 1; l <= numLaps; l++) {
    const startDLabel = (l - 1) * lapLenLabel;
    const endDLabel   = l * lapLenLabel;

    // Cumulative time at lap boundary (nearest split at or below endD)
    const cumAtEnd   = splits.filter(s => s.distance <= endDLabel + 0.5).pop();
    const cumAtStart = l === 1
      ? { cumTime: 0 }
      : (splits.filter(s => s.distance <= startDLabel + 0.5).pop() || { cumTime: 0 });
    if (!cumAtEnd) continue;
    const segTime = +(cumAtEnd.cumTime - cumAtStart.cumTime).toFixed(2);

    // Stroke count for this lap
    const c = counts.find(cc => cc.lap === l);
    const count = c ? c.count : null;

    // Average stroke rate over this lap's 5m buckets (LABELED positions)
    const inLap = rates.filter(r => r.distance > startDLabel && r.distance <= endDLabel);
    const rate  = inLap.length
      ? +(inLap.reduce((a, r) => a + r.rate, 0) / inLap.length).toFixed(1)
      : null;

    // Distance per stroke — TRUE meters / strokes (SCY-correct)
    const dps = count ? +(lapLen / count).toFixed(2) : null;

    out.push({
      lap: l,
      label: 'Lap ' + l + ' · ' + startDLabel.toFixed(0) + '–' + endDLabel.toFixed(0) + 'm',
      t: segTime, count, rate, dps,
      // startD / endD remain in LABELED meters (positional / axis use)
      startD: startDLabel, endD: endDLabel,
    });
  }

  // Rank by time + per-lap pace zone (v00.47).
  //   rank      — coarse 3-bucket: 'fast' (single fastest lap),
  //               'slow' (single slowest), else 'avg'. Kept for
  //               back-compat — older callers may still read it.
  //   delta     — lap_time minus race avg lap time, signed.
  //   paceZone  — 4-level deviation tier driven by % from avg:
  //                 fast: pct ≤ -1%   (banking time, lime)
  //                 on:   -1% < pct ≤ +1%   (on pace, signal/teal)
  //                 slow: +1% < pct ≤ +3%   (drifting, amber)
  //                 drop: pct > +3%   (significant fade, flag)
  //
  // Why % and not absolute seconds: a 30 s lap and a 60 s lap need
  // different absolute thresholds to be classified the same way.
  // Percent of avg gives one rule that scales across event lengths.
  if (out.length >= 2) {
    const ts = out.map(r => r.t);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const avg  = ts.reduce((a, b) => a + b, 0) / ts.length;
    out.forEach(r => {
      r.rank  = r.t === tMin ? 'fast' : r.t === tMax ? 'slow' : 'avg';
      r.delta = +(r.t - avg).toFixed(2);
      const pct = avg > 0 ? ((r.t - avg) / avg) * 100 : 0;
      r.pctDev = +pct.toFixed(2);
      r.paceZone = pct <= -1 ? 'fast'
                 : pct <=  1 ? 'on'
                 : pct <=  3 ? 'slow'
                 :             'drop';
    });
  } else {
    // Single-lap case (50 free SCM, 25 yd dash) — no avg comparison
    // possible. Tag the lone lap as 'on' so it gets a neutral tint.
    out.forEach(r => { r.paceZone = 'on'; r.pctDev = 0; });
  }
  return out;
}

// ── aggregateLaps (v00.53) ────────────────────────────────────
// Groups consecutive lap rows from `derivePerLap` into ~100 m
// buckets. The canonical fix for long-race chart density —
// 60-lap 1500/1650 trials become readable 15-bucket charts.
//
// Bucket size: round(100 / lapDistance). Examples:
//   - 25 m laps (SCY 100/200/500/1000/1650 yd, SCM 100/200/...): 4 laps/bucket = 100 m
//   - 50 m laps (LCM 100/200/400/800/1500): 2 laps/bucket = 100 m
//   - 33.33 m laps (rare): 3 laps/bucket = 100 m
//
// Output shape mirrors derivePerLap rows so LapBars / DPSChart /
// any consumer can render either interchangeably:
//   { lap, label, t, count, rate, dps, startD, endD,
//     rank, delta, pctDev, paceZone }
//
// `lap` here means "bucket number" (1, 2, 3, …). Each bucket sums
// time + stroke counts, averages stroke rate, recomputes DPS from
// the bucket's distance + total strokes, and re-derives paceZone
// from the bucketed times. The pace-zone analysis at bucket
// granularity tells a different story (faded vs held across 100 m
// chunks rather than per-lap), which is the right abstraction
// when the per-lap view is too noisy.
function aggregateLaps(laps, bucketM = 100) {
  if (!laps || laps.length === 0) return [];
  const lapDist = laps[0].endD - laps[0].startD;
  if (!isFinite(lapDist) || lapDist <= 0) return laps;
  // v03.16 — bucketM parameterizes the grouping distance (50 or
  // 100 m). 50 m laps + bucketM 50 → 1 lap/bucket (no-op). 25 m
  // laps + bucketM 50 → 2 laps/bucket. bucketM 100 → 100 m as before.
  const lapsPerBucket = Math.max(1, Math.round(bucketM / lapDist));
  // No-op when each "bucket" would be exactly one lap (bucket size
  // 1) — return the input unchanged so the caller doesn't burn
  // cycles on a meaningless grouping.
  if (lapsPerBucket === 1) return laps;

  const buckets = [];
  for (let i = 0; i < laps.length; i += lapsPerBucket) {
    const group = laps.slice(i, i + lapsPerBucket);
    if (!group.length) continue;
    const tSum = group.reduce((s, l) => s + (l.t || 0), 0);
    const counts = group.map(l => l.count).filter(v => v != null);
    const countSum = counts.length === group.length
      ? counts.reduce((s, v) => s + v, 0)
      : null;
    const rates = group.map(l => l.rate).filter(v => v != null);
    const rateAvg = rates.length
      ? +(rates.reduce((s, v) => s + v, 0) / rates.length).toFixed(1)
      : null;
    const startD = group[0].startD;
    const endD   = group[group.length - 1].endD;
    const bucketDist = endD - startD;
    const dps = (countSum != null && countSum > 0)
      ? +(bucketDist / countSum).toFixed(2)
      : null;
    buckets.push({
      lap: buckets.length + 1,
      label: Math.round(startD) + '–' + Math.round(endD) + ' m',
      t: +tSum.toFixed(2),
      count: countSum,
      rate: rateAvg,
      dps,
      startD, endD,
    });
  }

  // Re-derive rank / delta / paceZone on the bucketed times.
  if (buckets.length >= 2) {
    const ts = buckets.map(r => r.t);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const avg  = ts.reduce((a, b) => a + b, 0) / ts.length;
    buckets.forEach(r => {
      r.rank  = r.t === tMin ? 'fast' : r.t === tMax ? 'slow' : 'avg';
      r.delta = +(r.t - avg).toFixed(2);
      const pct = avg > 0 ? ((r.t - avg) / avg) * 100 : 0;
      r.pctDev = +pct.toFixed(2);
      r.paceZone = pct <= -1 ? 'fast'
                 : pct <=  1 ? 'on'
                 : pct <=  3 ? 'slow'
                 :             'drop';
    });
  } else {
    buckets.forEach(r => { r.paceZone = 'on'; r.pctDev = 0; });
  }
  return buckets;
}

// ── derivePerSegment (v00.95 — sprint support) ────────────────
// For 50 m and shorter races, per-lap data gives only 1-2 dots
// — too few for the SR × DPS efficiency chart to be useful.
// This helper steps down to 5 m segment granularity:
//
//   • velocity per 5 m  = 5 / (cumTime[d] − cumTime[d−5])
//   • SR per 5 m        = directly from extractStrokeRates
//   • DPS per 5 m       = 60 × velocity / SR  (derived; SR × DPS / 60 = velocity by definition)
//
// Output rows mirror the per-lap row shape so the chart code
// reads them identically:
//
//   { lap: <sequence 1..N>, rate, dps, t, startD, endD, segLabel }
//
// `lap` is a sequence number (1, 2, 3…) so the dot labels stay
// short and consistent. `segLabel` carries the human-readable
// "5 m mark" / "0-5 m" form used by the inspect panel + story
// headline.
function derivePerSegment(trial, preferredSize) {
  preferredSize = preferredSize || 5;
  if (!trial) return [];
  const mj = trial.mj || trial.metrics_json || {};
  const splits = K.extractSplits(mj, preferredSize);
  const rates  = K.extractStrokeRates(mj);
  if (!splits.length) return [];

  const sorted = splits.slice().sort((a, b) => a.distance - b.distance);
  const rateByDist = new Map();
  rates.forEach(r => { rateByDist.set(Number(r.distance), r.rate); });

  // v00.99 — try each candidate grid in order, finest first.
  // Pick the first grid that has ≥ 2 consecutive splits starting
  // from the grid size. This handles all the Templo shapes:
  //
  //   trial w/ full 5 m capture  → 5 m grid wins  → 10 dots on 50
  //   trial w/ 25 m + 50 m only   → 25 m grid wins → 2 dots
  //   trial w/ 50 m only          → all grids fail → empty []
  //
  // Per-segment math uses the WINNING grid's size for vel/DPS so
  // numbers stay correct regardless of which granularity Templo
  // actually captured.
  const buildOnGrid = (gridSize) => {
    const onGrid = sorted.filter(s =>
      Number.isFinite(s.distance) && (s.distance % gridSize === 0)
    );
    const byDist = new Map();
    onGrid.forEach(s => byDist.set(Number(s.distance), s));
    const ordered = [];
    for (let d = gridSize; ; d += gridSize) {
      const s = byDist.get(d);
      if (!s) break;
      ordered.push(s);
    }
    return ordered;
  };

  // Prefer the requested size if it produces ≥2 consecutive
  // splits, then drop to coarser grids until something works.
  const candidates = [];
  [preferredSize, 5, 10, 25, 50].forEach(c => {
    if (!candidates.includes(c)) candidates.push(c);
  });

  let segmentSize = null;
  let ordered = [];
  for (const c of candidates) {
    const seq = buildOnGrid(c);
    if (seq.length >= 2) {
      segmentSize = c;
      ordered = seq;
      break;
    }
  }

  if (!segmentSize || ordered.length < 2) {
    try { console.warn('[derivePerSegment] no consecutive grid found, using trial average',
      { rawDistances: sorted.map(s => s.distance) }); }
    catch (_) {}
    // v00.99 — final fallback: a single trial-average row at the
    // trial's overall (avgSR, avgDPS) position. Better than an
    // empty chart when Templo only captured the final split.
    // Coach still sees iso-curves and the PB diamond; the single
    // dot just lacks the per-segment trajectory story.
    if (K.avgStrokeRate && K.avgVelocity) {
      const avgSR = K.avgStrokeRate(trial);
      let   avgDPS = K.avgDPS ? K.avgDPS(trial) : null;
      const avgVel = K.avgVelocity(trial);
      if (avgDPS == null && avgSR != null && avgVel != null && avgSR > 0) {
        avgDPS = (60 * avgVel) / avgSR;
      }
      const dist = parseFloat(trial.distance_m
        || mj.Distance || mj.distance) || null;
      if (avgSR != null && avgDPS != null && dist != null) {
        return [{
          lap: 1, rate: avgSR, dps: avgDPS,
          t: K.raceTotalTime ? K.raceTotalTime(trial) : null,
          startD: 0, endD: dist,
          segLabel: 'trial avg',
          isTrialAvg: true,
        }];
      }
    }
    return [];
  }

  if (!rates.length) {
    // We have a usable grid but no SR samples to derive DPS — bail.
    try { console.warn('[derivePerSegment] no SR samples',
      { detectedGrid: segmentSize }); }
    catch (_) {}
    return [];
  }

  // v03.66 — SCY fix: convert labeled segment size to true meters
  // for the velocity calc.
  const courseSeg     = K.courseOf ? K.courseOf(trial) : null;
  const segmentSizeM  = K.actualMeters ? K.actualMeters(segmentSize, courseSeg) : segmentSize;

  const out = [];
  let prevT = 0;
  ordered.forEach((s, idx) => {
    const segT   = s.cumTime - prevT;
    const startD = s.distance - segmentSize;   // LABELED (axes / lookups)
    const endD   = s.distance;                  // LABELED
    let rate = rateByDist.get(endD) != null
      ? rateByDist.get(endD)
      : rateByDist.get(startD);
    if ((rate == null || rate <= 0) && K.avgStrokeRate) {
      const fallback = K.avgStrokeRate(trial);
      if (fallback != null && fallback > 0) rate = fallback;
    }
    if (rate != null && rate > 0 && segT > 0) {
      const vel = segmentSizeM / segT;      // TRUE m/s for SCY
      const dps = (60 * vel) / rate;
      out.push({
        lap: idx + 1,
        rate, dps,
        t: +segT.toFixed(2),
        startD, endD,
        segLabel: endD + ' m',
      });
    }
    prevT = s.cumTime;
  });
  return out;
}

// ── LapBars (horizontal bar per lap, design-reference RaceSplits) ──
// When `compare` is supplied, each row stacks two bars (primary on top
// in rank color, compare below muted) — matching the RaceCompareBars
// double-bar idiom — and the right-side Δ becomes primary − compare
// instead of lap-vs-self-average. Solo mode renders identically to
// pre-v00.26.
const LapBars = ({ primary, compare, compareLabel, mode }) => {
  // v00.53: when `mode === 'per-100m'`, group the per-lap rows into
  // ~100 m buckets via aggregateLaps. The output rows have the same
  // shape (lap, label, t, count, rate, dps, paceZone, …), so the
  // rendering below works either way without branching.
  const lapsRaw    = derivePerLap(primary);
  const lapsCmpRaw = compare ? derivePerLap(compare) : [];
  // v03.16/17 — per-lap / per-50m / per-100m bucketing.
  // aggregateLaps with 25 is always a no-op (per-lap = raw laps).
  const _bM = mode === 'per-100m' ? 100 : mode === 'per-lap' ? 25 : 50;
  const laps    = aggregateLaps(lapsRaw, _bM);
  const lapsCmp = aggregateLaps(lapsCmpRaw, _bM);
  const cmpByLap = new Map(lapsCmp.map(r => [r.lap, r]));
  const showCompare = !!compare && lapsCmp.length > 0;

  if (!laps.length) {
    return (
      <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '22px 0', textAlign: 'center' }}>
        No split data captured for this race.
      </div>
    );
  }
  // Bars share a common max so widths read true relative to each other —
  // when compare is on, include compare's lap times in the max set.
  const allTimes = showCompare
    ? [...laps.map(l => l.t), ...lapsCmp.map(l => l.t)]
    : laps.map(l => l.t);
  const max = Math.max(...allTimes);
  // v00.47 pace zones — colors per `paceZone` from derivePerLap.
  // `rank` (legacy 3-bucket) is still respected as a fallback for
  // any older lap row that didn't carry a paceZone.
  const colorMap = {
    fast: 'var(--lime-eff)',     // pct ≤ -1%   banking time
    on:   'var(--signal-eff)',   // -1 to +1%   on pace
    slow: 'var(--amber-eff)',    // +1 to +3%   drifting
    drop: 'var(--flag-eff)',     // > +3%       significant fade
    avg:  'var(--signal-eff)',   // legacy rank fallback
  };
  const zoneLabelMap = {
    fast: 'Fast',
    on:   'On pace',
    slow: 'Slow',
    drop: 'Drop',
    // Legacy rank fallback labels — only used if paceZone missing.
    avg:  'Mid',
  };

  // v00.46 adaptive density. Long races (1500/1650) put 60+ rows in
  // a single card. Three tiers:
  //   ≤ 16 laps  → full layout (current behavior, no change)
  //   17–32 laps → compact: smaller bars, no per-lap stroke/rate
  //                sub-line, abbreviated label "L{n}"
  //   > 32 laps  → very compact: minimum bars, every-2nd-row time
  //                label hide on long bars, compressed grid columns
  // v03.67 — mobile (<768 CSS px) forces dense mode regardless of
  // lap count. Default layout's 160+1fr+90+100 = 410 px of fixed
  // columns overflows a typical iPhone Safari viewport, squeezing
  // the bar column to ~0 px and clipping split-time labels.
  const isMobile    = (window.useIsMobile || (() => false))();
  const dense       = laps.length > 16 || isMobile;
  const veryDense   = laps.length > 32;
  const rowGap      = veryDense ? 3  : dense ? 8  : 18;
  const soloH       = veryDense ? 10 : dense ? 20 : 26;
  const cmpH        = veryDense ? 8  : dense ? 16 : 16;
  const cmpGap      = veryDense ? 2  : dense ? 4  : 6;
  const cmpBarTotal = cmpH * 2 + cmpGap;
  const labelTplCol = veryDense ? '46px 1fr 46px 50px'
                     : dense    ? '70px 1fr 56px 64px'
                                : '160px 1fr 90px 100px';
  const labelFont   = veryDense ? '9px'  : dense ? '11px' : '13px';
  const timeFont    = veryDense ? 9      : dense ? 10     : 11;
  // v03.67 — keep the "X strokes · Y spm" subline on short races
  // even when mobile forces dense mode. Only hide once there are
  // genuinely too many rows (the original > 16 trigger).
  const showSubLine = !veryDense && laps.length <= 16;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap }}>
      {laps.map(l => {
        // Prefer paceZone (v00.47) and fall back to legacy rank.
        const zoneKey = l.paceZone || l.rank || 'on';
        const color   = colorMap[zoneKey] || colorMap.on;
        const pillTxt = zoneLabelMap[zoneKey] || 'On pace';
        const c = showCompare ? cmpByLap.get(l.lap) : null;
        const cmpDelta = c ? +(l.t - c.t).toFixed(2) : null;
        // Compact label: "L{n}" for dense, full for default.
        const labelText = dense ? ('L' + l.lap) : l.label;
        // Hide the rank pill at very-dense to recover horizontal real estate.
        const showPill = !veryDense;
        return (
          <div key={l.lap} style={{
            display: 'grid',
            gridTemplateColumns: labelTplCol,
            gap: dense ? 10 : 20, alignItems: 'center',
          }}>
            <div>
              <div style={{ font: '600 ' + labelFont + ' var(--font-ui)', color: 'var(--tx-hi)' }}>
                {labelText}
              </div>
              {showSubLine && (l.count != null || l.rate != null) && (
                <div className="mono" style={{
                  fontSize: 10, color: 'var(--tx-lo)', marginTop: 3,
                }}>
                  {l.count != null ? l.count + ' strokes' : ''}
                  {l.count != null && l.rate != null ? ' · ' : ''}
                  {l.rate != null ? l.rate + ' spm' : ''}
                </div>
              )}
            </div>
            {/* Bar track — heights scale with density tier. */}
            {!c ? (
              <div style={{
                position: 'relative', height: soloH,
                background: 'var(--bg-3)', borderRadius: dense ? 4 : 6,
              }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: ((l.t / max) * 100) + '%',
                  background: color, borderRadius: dense ? 4 : 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  padding: dense ? '0 6px' : '0 10px', minWidth: dense ? 48 : 64,
                }}>
                  <span className="mono" style={{
                    fontSize: timeFont, fontWeight: 700, color: 'var(--ink)', lineHeight: 1,
                  }}>
                    {K.fmtTime(l.t, 2)}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{
                position: 'relative', height: cmpBarTotal,
                display: 'flex', flexDirection: 'column', gap: cmpGap,
              }}>
                {/* Primary bar (top) */}
                <div style={{
                  position: 'relative', height: cmpH,
                  background: 'var(--bg-3)', borderRadius: 4,
                }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: ((l.t / max) * 100) + '%',
                    background: color, borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    padding: dense ? '0 6px' : '0 8px', minWidth: dense ? 44 : 60,
                  }}>
                    <span className="mono" style={{
                      fontSize: timeFont, fontWeight: 700, color: 'var(--ink)', lineHeight: 1,
                    }}>
                      {K.fmtTime(l.t, 2)}
                    </span>
                  </div>
                </div>
                {/* Compare bar (bottom) — uses --compare-eff token. */}
                <div style={{
                  position: 'relative', height: cmpH,
                  background: 'var(--bg-3)', borderRadius: 4,
                }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: ((c.t / max) * 100) + '%',
                    background: 'var(--compare-eff)', borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    padding: dense ? '0 6px' : '0 8px', minWidth: dense ? 44 : 60,
                  }}>
                    <span className="mono" style={{
                      fontSize: timeFont, fontWeight: 700, color: 'var(--ink)', lineHeight: 1,
                    }}>
                      {K.fmtTime(c.t, 2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {showPill ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="pill" style={{
                  color,
                  border: '1px solid color-mix(in oklch, ' + color + ' 40%, transparent)',
                  background: 'color-mix(in oklch, ' + color + ' 10%, transparent)',
                  textTransform: 'uppercase', fontSize: dense ? 8 : 9,
                  padding: dense ? '1px 5px' : undefined,
                }}>
                  {pillTxt}
                </span>
              </div>
            ) : <div/>}
            <div className="mono" style={{
              textAlign: 'right', fontSize: dense ? 10 : 12, fontWeight: 700,
              color: c
                ? (cmpDelta < 0 ? 'var(--lime-eff)'
                  : cmpDelta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)')
                : (l.delta < 0 ? 'var(--lime-eff)'
                  : l.delta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)'),
            }}>
              {c
                ? (cmpDelta == null ? '—'
                    : (cmpDelta > 0 ? '+' : '') + cmpDelta.toFixed(2) + 's')
                : (l.delta == null ? '—'
                    : (l.delta > 0 ? '+' : '') + l.delta.toFixed(2) + 's')}
            </div>
          </div>
        );
      })}
      {/* Legend — only when compare is active, mirrors RaceCompareBars. */}
      {showCompare && (
        <div style={{ display: 'flex', gap: 16, marginTop: 4, paddingTop: 8,
                      borderTop: '1px solid var(--line-soft)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6,
                         font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
            <span style={{ width: 12, height: 3, background: 'var(--lime-eff)' }}/>
            Today
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6,
                         font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
            <span style={{ width: 12, height: 3, background: 'var(--compare-eff)' }}/>
            {compareLabel || 'Compare'}
          </span>
        </div>
      )}
    </div>
  );
};

// ── StrokeMechanicsTable (flat table, not a chart) ────────────
// When `compare` is supplied, each numeric cell stacks three lines:
//   1. primary value (bold mono, hi-contrast)
//   2. compare value (mono, --compare-eff tint)
//   3. Δ chip (primary − compare) in tone color where direction is
//      defined (count: fewer better, dps: more better) or neutral.
// v00.71 — `mode` prop respects the RaceDetail toggle
// (per-lap | per-100m). Aggregated rows from aggregateLaps
// already carry { count, rate, dps } so the rendering loop
// doesn't need to branch on mode.
//
// P-4 (v00.72) — density tiers match LapBars / DPSChart:
//   ≤ 16 rows → full layout
//   17–32      → compact: tighter padding, smaller fonts
//   > 32       → very compact: minimal padding, no per-row
//                compare/delta sub-lines (delta-only via tone),
//                shorter "L{n}" lap label
const StrokeMechanicsTable = ({ primary, compare, mode }) => {
  const lapsRaw    = derivePerLap(primary);
  const lapsCmpRaw = compare ? derivePerLap(compare) : [];
  // v03.16/17 — per-lap / per-50m / per-100m bucketing.
  // aggregateLaps with 25 is always a no-op (per-lap = raw laps).
  const _bM = mode === 'per-100m' ? 100 : mode === 'per-lap' ? 25 : 50;
  const laps    = aggregateLaps(lapsRaw, _bM);
  const lapsCmp = aggregateLaps(lapsCmpRaw, _bM);
  const cmpByLap = new Map(lapsCmp.map(r => [r.lap, r]));
  const showCompare = !!compare && lapsCmp.length > 0;

  if (!laps.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '14px 0', textAlign: 'center' }}>
        No stroke data captured.
      </div>
    );
  }

  // P-4 density tiers. Mirrors LapBars rules so the SPLIT card
  // and this table compact at the same thresholds.
  // v01.59 (synced from mobile v02.12) — `isMobile` adds a phone-
  // specific compaction layer: shorter headers (drops "(spm)" /
  // "(m)" — the column's role makes the unit obvious from one row
  // of values) and a lower minWidth so the table fits a 380 px
  // viewport without horizontal scroll for the common case.
  const isMobile  = (window.useIsMobile || (() => false))();
  const dense     = laps.length > 16;
  const veryDense = laps.length > 32;
  const padCell   = veryDense ? '4px 6px' : dense ? '7px 7px' : (isMobile ? '10px 6px' : '12px 8px');
  const labelFont = veryDense ? 11      : dense ? 12      : (isMobile ? 12 : 13);
  const numFont   = veryDense ? 12      : dense ? 13      : (isMobile ? 13 : 14);
  const cmpFont   = veryDense ? 11      : dense ? 12      : (isMobile ? 12 : 14);
  const deltaFont = veryDense ? 9       : dense ? 10      : (isMobile ? 10 : 11);

  const cell = {
    padding: padCell,
    font: '500 ' + labelFont + 'px var(--font-ui)',
    color: 'var(--tx-md)', verticalAlign: 'top',
    whiteSpace: 'nowrap',
  };
  const numCell = {
    padding: padCell, fontSize: numFont, fontWeight: 600,
    color: 'var(--tx-hi)', fontFamily: 'var(--font-mono)',
    verticalAlign: 'top',
  };
  const cmpStyle = {
    display: 'block', marginTop: 2,
    fontSize: cmpFont, fontWeight: 600,
    color: 'var(--compare-eff)', fontFamily: 'var(--font-mono)',
  };
  const deltaBase = {
    display: 'block', marginTop: 2,
    fontSize: deltaFont, fontWeight: 700,
    fontFamily: 'var(--font-mono)',
  };
  // Direction: 'lower' → negative is good; 'higher' → positive is good;
  // 'neutral' → no verdict.
  const fmtCmpVal = (v, decimals) => v == null ? '—' : v.toFixed(decimals);
  const buildDelta = (a, b, decimals, dir) => {
    if (a == null || b == null) return null;
    const raw = +(a - b).toFixed(decimals);
    let label;
    if (raw === 0) label = '±0';
    else label = (raw > 0 ? '+' : '') + raw.toFixed(decimals);
    let color = 'var(--tx-md)';
    if (raw !== 0 && dir === 'lower')  color = raw < 0 ? 'var(--lime-eff)' : 'var(--flag-eff)';
    if (raw !== 0 && dir === 'higher') color = raw > 0 ? 'var(--lime-eff)' : 'var(--flag-eff)';
    return { label, color };
  };
  // Lap label format. In per-100m mode aggregateLaps gives a
  // distance-range label like "100–200 m"; honor that when
  // present. In per-lap mode use "Lap n" or "L{n}" depending on
  // density.
  const lapLabel = (r) => {
    if (mode === 'per-100m' && r.label) return r.label;
    return veryDense ? 'L' + r.lap : 'Lap ' + r.lap;
  };

  // Very-dense rows hide the compare row + delta sub-lines —
  // they'd push each row to 4 lines tall and the table would
  // scroll forever. Tone-only deltas keep the at-a-glance read.
  const showSubLines = !veryDense;

  return (
    // v01.08 — `overflow-x: auto` wrapper lets the table horizontally
    // scroll on narrow screens without compressing the numeric cells.
    // `width: max-content` on the inner table holds its native size
    // when the viewport is too narrow; on wide viewports `100%` wins.
    // v01.59 — mobile lowers minWidth so the table fits the viewport
    // without horizontal scroll, and the headers drop "(spm)" / "(m)"
    // (the unit reads from one row of values, redundant in the header).
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
    <table style={{
      width: '100%',
      minWidth: isMobile
        ? (showCompare ? 320 : 240)
        : (showCompare ? 380 : 280),
      borderCollapse: 'collapse',
    }}>
      <thead>
        <tr>
          {(isMobile
              ? ['Lap', 'Strokes', 'Rate', 'DPS']
              : ['Lap', 'Strokes', 'Rate (spm)', 'DPS (m)']
          ).map(h => (
            <th key={h} className="eyebrow" style={{
              fontSize: veryDense ? 8 : 9, textAlign: 'left',
              padding: veryDense ? '5px 6px' : '8px 8px',
              borderBottom: '1px solid var(--line-soft)', color: 'var(--tx-lo)',
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {laps.map(r => {
          const c = showCompare ? cmpByLap.get(r.lap) : null;
          const dCount = c ? buildDelta(r.count, c.count, 0, 'lower')   : null;
          const dRate  = c ? buildDelta(r.rate,  c.rate,  1, 'neutral') : null;
          const dDps   = c ? buildDelta(r.dps,   c.dps,   2, 'higher')  : null;
          // Very-dense rows: tint the primary number with the
          // delta tone so the row still reads as good/bad even
          // without sub-lines. Per-lap mode preserves full sub-lines.
          const tintCount = (!showSubLines && dCount) ? dCount.color : 'var(--tx-hi)';
          const tintRate  = (!showSubLines && dRate)  ? dRate.color  : 'var(--tx-hi)';
          const tintDps   = (!showSubLines && dDps)   ? dDps.color   : 'var(--tx-hi)';
          return (
            <tr key={r.lap}>
              <td style={cell}>{lapLabel(r)}</td>
              <td style={{ ...numCell, color: tintCount }}>
                {r.count != null ? r.count : '—'}
                {showSubLines && c && <span style={cmpStyle}>{fmtCmpVal(c.count, 0)}</span>}
                {showSubLines && dCount && <span style={{ ...deltaBase, color: dCount.color }}>{dCount.label}</span>}
              </td>
              <td style={{ ...numCell, color: tintRate }}>
                {r.rate != null ? r.rate : '—'}
                {showSubLines && c && <span style={cmpStyle}>{fmtCmpVal(c.rate, 1)}</span>}
                {showSubLines && dRate && <span style={{ ...deltaBase, color: dRate.color }}>{dRate.label}</span>}
              </td>
              <td style={{ ...numCell, color: tintDps }}>
                {r.dps != null ? r.dps : '—'}
                {showSubLines && c && <span style={cmpStyle}>{fmtCmpVal(c.dps, 2)}</span>}
                {showSubLines && dDps && <span style={{ ...deltaBase, color: dDps.color }}>{dDps.label}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
};

// ── RaceCompareBars (double horizontal bars per segment) ──────
// Today (lime, top) vs compare (gray, bottom).
const RaceCompareBars = ({ primary, compare, mode }) => {
  if (!primary || !compare) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '18px 0', textAlign: 'center' }}>
        Pick a second race or benchmark to compare.
      </div>
    );
  }
  const segA = K.splitsToSegments(K.extractSplits(primary.mj || primary.metrics_json));
  const segB = K.splitsToSegments(K.extractSplits(compare.mj || compare.metrics_json));

  // v00.71 — per-100m mode bucket-sums consecutive 5 m segments
  // into 100 m chunks. Each output bucket has the same shape
  // {distStart, distEnd, segTime} so the rest of this component
  // doesn't need to know which mode it's rendering. Per-lap mode
  // passes through unchanged.
  const bucketize = (segs) => {
    if (!segs.length) return [];
    const out = [];
    let cur = null;
    segs.forEach(s => {
      const bStart = Math.floor(s.distStart / 100) * 100;
      if (!cur || cur.distStart !== bStart) {
        if (cur) out.push(cur);
        cur = { distStart: bStart, distEnd: bStart + 100, segTime: 0 };
      }
      cur.segTime += s.segTime;
      cur.distEnd = Math.max(cur.distEnd, s.distEnd);
    });
    if (cur) out.push(cur);
    return out.map(b => ({ ...b, segTime: +b.segTime.toFixed(2) }));
  };
  const finalA = mode === 'per-100m' ? bucketize(segA) : segA;
  const finalB = mode === 'per-100m' ? bucketize(segB) : segB;
  const bByDist = new Map(finalB.map(s => [s.distEnd, s]));
  const data = finalA
    .filter(a => bByDist.has(a.distEnd))
    .map(a => ({
      seg:   a.distStart + '–' + a.distEnd,
      now:   a.segTime,
      then:  bByDist.get(a.distEnd).segTime,
    }));

  if (!data.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '18px 0', textAlign: 'center' }}>
        No aligned segments to compare.
      </div>
    );
  }

  const max = Math.max(...data.flatMap(d => [d.now, d.then]));
  // v00.46 adaptive density. Long races have many segments — same
  // tier rules as LapBars: compact at >16, very compact at >32.
  const dense     = data.length > 16;
  const veryDense = data.length > 32;
  const rowGap    = veryDense ? 4  : dense ? 8  : 14;
  const barH      = veryDense ? 4  : dense ? 6  : 8;
  const stackGap  = veryDense ? 1  : dense ? 2  : 3;
  const headerFont = veryDense ? '10px' : dense ? '11px' : '12px';
  const valueFont  = veryDense ? 9      : dense ? 10     : 11;
  const minLabelW  = veryDense ? 32     : dense ? 40     : 48;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap }}>
      {data.map(d => {
        const delta = d.now - d.then;
        const tone  = delta < 0 ? 'var(--lime-eff)'
                    : delta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)';
        return (
          <div key={d.seg}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: dense ? 2 : 4 }}>
              <span style={{ font: '500 ' + headerFont + ' var(--font-ui)', color: 'var(--tx-md)' }}>
                {d.seg} m
              </span>
              <span className="mono" style={{ fontSize: valueFont, color: tone, fontWeight: 700 }}>
                {(delta > 0 ? '+' : '') + delta.toFixed(2)}s
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: stackGap }}>
              {/* Compare row (top) — same color as legend swatch */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1, height: barH, borderRadius: Math.max(2, barH / 2),
                  background: 'var(--bg-3)',
                }}>
                  <div style={{
                    height: '100%', width: ((d.then / max) * 100) + '%',
                    background: 'var(--compare-eff)', borderRadius: Math.max(2, barH / 2),
                  }}/>
                </div>
                <span className="mono" style={{
                  fontSize: valueFont, fontWeight: 600, minWidth: minLabelW,
                  textAlign: 'right', color: 'var(--compare-eff)',
                }}>
                  {d.then.toFixed(2)}s
                </span>
              </div>
              {/* Primary row (bottom) — Today, lime */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1, height: barH, borderRadius: Math.max(2, barH / 2),
                  background: 'var(--bg-3)',
                }}>
                  <div style={{
                    height: '100%', width: ((d.now / max) * 100) + '%',
                    background: 'var(--lime-eff)', borderRadius: Math.max(2, barH / 2),
                  }}/>
                </div>
                <span className="mono" style={{
                  fontSize: valueFont, fontWeight: 600, minWidth: minLabelW,
                  textAlign: 'right', color: 'var(--lime-eff)',
                }}>
                  {d.now.toFixed(2)}s
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6,
          font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
        }}>
          <span style={{ width: 12, height: 3, background: 'var(--lime-eff)' }}/> Today
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6,
          font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
        }}>
          <span style={{ width: 12, height: 3, background: 'var(--compare-eff)' }}/>
          {compare._benchmarkKind === 'PB' ? 'Personal best'
            : compare._benchmarkKind === 'MEDIAN' ? 'Median race'
            : 'Compare'}
        </span>
      </div>
    </div>
  );
};

// ── VideoCard (v01.18 — switcher + Pro gate + download) ───────
// Renders a 16:9 video player driven by Cloudflare R2 signed URLs.
//
// Source selection (v01.18):
//   videoKey   — primary R2 object key (My Race).
//   compareVideoKey — optional, the compare trial's video. When
//                     present, the card renders a 2-chip switcher
//                     above the player so the user can flip between
//                     primary and compare without leaving the page.
//   compareLabel — display label for the compare chip
//                  (e.g. "Compare", "PB", "World record").
//                  When omitted, defaults to "Compare".
//   compareAthleteUuid / compareRequestUuid / compareIsBenchmark —
//                  RLS-context props for the compare fetch.
//                  compareIsBenchmark routes to the benchmark bucket
//                  (used by WR / record-pace videos in v01.19+).
//
// Pro gate (v01.18, per locked Q6 'surface' pattern):
//   isPro      — when false AND a videoKey is present, replaces the
//                player with an inline upsell card. Free users still
//                see the card frame so the page layout is stable;
//                they just get a CTA to upgrade instead of playback.
//   onUpgrade  — callback fired when the upsell CTA is clicked. The
//                deck wires this to open the Account modal on the
//                Subscription tab.
//
// Download (v01.18, Pro-only):
//   When isPro is true AND the active source has a videoKey, a small
//   download button shows in the header. Click → fresh signed URL →
//   browser downloads the file. Per CLAUDE.md the signed URL never
//   lands in console logs.
//
// RLS-context props for the primary fetch:
//   athleteUuid / requestUuid / isBenchmark — same as v01.17.
//
// Other props:
//   title    — card eyebrow, defaults to 'VIDEO'
//   aspect   — CSS aspect-ratio, defaults to '16 / 9'
//   hint     — optional mono string in the header
//   children — escape hatch; if provided, replaces the body entirely
//              (skips fetch, switcher, Pro gate).
//
// Per CLAUDE.md (2026-05-05): NEVER log the signed URL. NEVER expose
// the benchmark holder name; the compare label must come from the
// caller (e.g. "World record"), not from holder_name.
// ── NotifyAthleteButton (v03.58) ─────────────────────────────
// Super-admin-only pill that fires the notify-trial-complete
// edge function to email the athlete "Your start/turn analysis
// is ready". Reads + writes `notified_at` on the underlying
// trial row to track the once-sent state so the button can
// show "Notified · MMM DD" after sending. Race trials are
// skipped — they go through the existing race_requests
// completion flow which has its own email trigger.
const NotifyAthleteButton = ({
  trialKind, trialUuid, athleteUuid, eventName,
  notifiedAt: initialNotifiedAt,
}) => {
  const Hooks  = (window.React || React);
  const t      = (window.useT  || (() => (k) => k))();
  const client = window.supabaseClient;
  const [admin, setAdmin]   = Hooks.useState({ isSuperAdmin: false });
  const [sending, setSending] = Hooks.useState(false);
  const [notifiedAt, setNotifiedAt] = Hooks.useState(initialNotifiedAt || null);

  Hooks.useEffect(() => { setNotifiedAt(initialNotifiedAt || null); }, [initialNotifiedAt]);
  Hooks.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (window.PA_ADMIN && window.PA_ADMIN.checkAdmin) {
        const a = await window.PA_ADMIN.checkAdmin();
        if (!cancelled) setAdmin(a || { isSuperAdmin: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!admin.isSuperAdmin) return null;
  if (!trialKind || !trialUuid || !athleteUuid) return null;
  // race kind — existing notify-analysis-complete flow already
  // emails on completion; don't surface a second button.
  if (trialKind === 'race') return null;

  const alreadyNotified = !!notifiedAt;
  const sentDateLabel = notifiedAt
    ? new Date(notifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : '';

  const onClick = async () => {
    if (sending) return;
    const msg = alreadyNotified
      ? t('analysis.notify.confirmResend')
      : t('analysis.notify.confirmSend');
    const proceed = window.PA_CONFIRM
      ? await window.PA_CONFIRM.ask({ message: msg, confirmLabel: t('analysis.notify.confirmLabel') })
      : window.confirm(msg);
    if (!proceed) return;
    setSending(true);
    try {
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        alert(t('analysis.notify.notSignedIn'));
        setSending(false);
        return;
      }
      const SUPABASE_URL = client?.supabaseUrl || 'https://wbqgshvbopfukwyqsndq.supabase.co';
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/notify-trial-complete`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
          apikey:          client?.supabaseKey || '',
        },
        body: JSON.stringify({ trialKind, trialUuid, athleteUuid, eventName }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || !out.ok) {
        alert(t('analysis.notify.failed') + (out?.error || `HTTP ${resp.status}`));
        setSending(false);
        return;
      }
      // v03.59 — table names per the existing import scripts:
      // `start_raw` and `turn_raw`, not `starts` / `turns`.
      const table   = trialKind === 'start' ? 'start_raw'  : 'turn_raw';
      const uuidCol = trialKind === 'start' ? 'start_uuid' : 'turn_uuid';
      const nowIso = new Date().toISOString();
      const { error: upErr } = await client
        .from(table)
        .update({ notified_at: nowIso })
        .eq(uuidCol, trialUuid);
      if (upErr) console.warn('[notify-trial-complete] DB update failed:', upErr);
      setNotifiedAt(nowIso);
    } catch (e) {
      alert(t('analysis.notify.failed') + String((e && e.message) || e));
    } finally {
      setSending(false);
    }
  };

  return (
    <button type="button" onClick={onClick} disabled={sending}
      title={alreadyNotified
        ? t('analysis.notify.tooltipSent', { date: sentDateLabel })
        : t('analysis.notify.tooltipSend')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 8,
        border: '1px solid ' + (alreadyNotified ? 'var(--lime-eff)' : 'var(--line)'),
        background: alreadyNotified
          ? 'color-mix(in oklch, var(--lime-eff) 14%, var(--bg-2))'
          : 'var(--bg-2)',
        color: alreadyNotified ? 'var(--lime-eff)' : 'var(--tx-md)',
        font: '600 11px var(--font-ui)', letterSpacing: 0.04,
        cursor: sending ? 'wait' : 'pointer',
        opacity: sending ? 0.6 : 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
      {sending ? t('analysis.notify.sending')
        : alreadyNotified ? `✓ ${t('analysis.notify.sentShort')} · ${sentDateLabel}`
        : t('analysis.notify.send')}
    </button>
  );
};

// ── AddTrialToSessionButton (v03.46) ─────────────────────────
// Replaces the v03.44 auto-promote "Save to Library" pattern
// with an explicit picker. Coach (or athlete) now picks which
// session the trial gets added to, or creates a new one inline.
//
// Pill states:
//   - "+ Add trial to session" → opens picker popover
//   - "In session ↗"           → click jumps to Sessions tab
//                                and pre-opens the clip
//
// Picker shows the trial's athlete's sessions + a "+ Create
// new session" row that opens an inline form (same fields as
// the standalone CreateSessionModal: title + date + notes).
const AddTrialToSessionButton = ({
  trialKind, trialUuid,
  athleteUuid, teamUuid,
  trialVideoKey, trialDate, trialTitle,
}) => {
  const Hooks = (window.React || React);
  const SA = window.PA_SESSIONS;
  const t = (window.useT || (() => (k) => k))();
  const [state, setState] = Hooks.useState('loading'); // 'loading'|'absent'|'saved'|'saving'
  const [clipUuid, setClipUuid] = Hooks.useState(null);
  const [showPicker, setShowPicker] = Hooks.useState(false);
  const [sessions, setSessions] = Hooks.useState([]);
  const [sessionsLoading, setSessionsLoading] = Hooks.useState(false);
  const [creating, setCreating] = Hooks.useState(false); // inline "new session" form mode
  const [newTitle, setNewTitle] = Hooks.useState('');
  const [newDate, setNewDate]   = Hooks.useState(trialDate || new Date().toISOString().slice(0, 10));

  // Re-check whether a clip exists for this trial on every key change.
  Hooks.useEffect(() => {
    if (!SA?.findClipForTrial || !trialKind || !trialUuid) {
      setState('absent'); setClipUuid(null); return;
    }
    let cancelled = false;
    setState('loading');
    (async () => {
      const { data } = await SA.findClipForTrial(trialKind, trialUuid);
      if (cancelled) return;
      if (data) {
        setClipUuid(data.clip_uuid);
        setState('saved');
      } else {
        setClipUuid(null);
        setState('absent');
      }
    })();
    return () => { cancelled = true; };
  }, [trialKind, trialUuid]);

  // Load athlete's sessions when picker opens.
  Hooks.useEffect(() => {
    if (!showPicker || !athleteUuid || !SA?.listSessionsForAthlete) return;
    let cancelled = false;
    setSessionsLoading(true);
    (async () => {
      const { data } = await SA.listSessionsForAthlete(athleteUuid);
      if (!cancelled) {
        setSessions(data || []);
        setSessionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showPicker, athleteUuid]);

  const promoteInto = async (sessionUuid) => {
    setState('saving');
    setShowPicker(false);
    setCreating(false);
    const { clipUuid: newId, error } = await SA.promoteTrialToClip({
      trialKind, trialUuid,
      athleteUuid, teamUuid,
      trialVideoKey, trialDate,
      title: trialTitle,
      sessionUuid,
    });
    if (error || !newId) {
      setState('absent');
      alert(t('sessions.couldNotSave') + ((error && error.message) || 'unknown'));
      return;
    }
    setClipUuid(newId);
    setState('saved');
  };

  const onClickPill = () => {
    if (state === 'saving' || state === 'loading') return;
    if (state === 'saved' && clipUuid) {
      try {
        window.dispatchEvent(new CustomEvent('pa:open-sessions-clip',
          { detail: { clipUuid } }));
      } catch (_) {}
      return;
    }
    setShowPicker(s => !s);
  };

  const onSubmitNewSession = async () => {
    if (!newTitle.trim()) return;
    const { data, error } = await SA.createSession({
      athleteUuid, teamUuid,
      title:       newTitle,
      sessionDate: newDate,
    });
    if (error || !data) {
      alert(t('sessions.couldNotCreate') + ((error && error.message) || 'unknown'));
      return;
    }
    await promoteInto(data.session_uuid);
  };

  if (!trialKind || !trialUuid || !athleteUuid || !trialVideoKey) {
    // Helpful one-liner when the pill silently fails to render —
    // logs which input was missing so we can spot column-name
    // mismatches between v_race / v_start / v_turn views and the
    // analysis-tab wiring without a screen-by-screen audit.
    try {
      console.warn('[AddTrialToSessionButton] hidden, missing inputs:', {
        trialKind, trialUuid, athleteUuid,
        hasVideoKey: !!trialVideoKey,
      });
    } catch (_) {}
    return null;
  }

  const saved   = state === 'saved';
  const saving  = state === 'saving';
  const loading = state === 'loading';

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={onClickPill}
        disabled={saving || loading}
        title={saved
          ? t('sessions.pickerInSessionTooltip')
          : t('sessions.pickerAddTooltip')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 8,
          border: '1px solid ' + (saved ? 'var(--signal-eff)' : 'var(--line)'),
          background: saved
            ? 'color-mix(in oklch, var(--signal-eff) 14%, var(--bg-2))'
            : 'var(--bg-2)',
          color: saved ? 'var(--signal-eff)' : 'var(--tx-md)',
          font: '600 11px var(--font-ui)', letterSpacing: 0.04,
          cursor: (saving || loading) ? 'wait' : 'pointer',
          opacity: (saving || loading) ? 0.6 : 1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
        {saving ? t('sessions.addingBtn')
          : loading ? '…'
          : saved ? t('sessions.inSessionBtn')
          : t('sessions.addTrialBtn')}
      </button>

      {showPicker && !saved && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          minWidth: 260, maxWidth: 340,
          background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
          borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
          padding: 6, zIndex: 30,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div className="eyebrow" style={{
            color: 'var(--tx-lo)', padding: '6px 8px 4px',
          }}>
            {t('sessions.pickerHeader')}
          </div>

          {/* + Create new — top of the list */}
          {!creating && (
            <button type="button"
              onClick={() => setCreating(true)}
              style={{
                textAlign: 'left',
                padding: '7px 9px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent',
                color: 'var(--signal-eff)',
                border: '1px dashed color-mix(in oklch, var(--signal-eff) 50%, transparent)',
                font: '700 11px var(--font-ui)', letterSpacing: 0.04,
              }}>
              {t('sessions.pickerCreateNew')}
            </button>
          )}
          {creating && (
            <div style={{
              padding: 8, borderRadius: 8,
              background: 'color-mix(in oklch, var(--signal-eff) 6%, var(--bg-3))',
              border: '1px solid color-mix(in oklch, var(--signal-eff) 40%, transparent)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <input type="text" value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('sessions.pickerSessionTitle')}
                autoFocus
                style={{
                  padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--tx-hi)', font: '500 12px var(--font-ui)',
                }}/>
              <input type="date" value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                style={{
                  padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--line)', background: 'var(--bg-3)',
                  color: 'var(--tx-hi)', font: '500 12px var(--font-ui)',
                }}/>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setCreating(false)}
                  style={{
                    padding: '5px 9px', borderRadius: 6, cursor: 'pointer',
                    background: 'transparent', color: 'var(--tx-md)',
                    border: '1px solid var(--line-soft)',
                    font: '600 10px var(--font-ui)',
                  }}>Cancel</button>
                <button type="button" onClick={onSubmitNewSession}
                  disabled={!newTitle.trim()}
                  style={{
                    padding: '5px 11px', borderRadius: 6,
                    cursor: !newTitle.trim() ? 'default' : 'pointer',
                    background: 'var(--signal-eff)', color: 'var(--ink)',
                    border: 'none', font: '700 10px var(--font-ui)',
                    opacity: !newTitle.trim() ? 0.5 : 1,
                  }}>{t('sessions.pickerCreateAndAdd')}</button>
              </div>
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 6px' }}/>

          {/* Existing sessions */}
          {sessionsLoading ? (
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              padding: '8px 10px', textAlign: 'center',
            }}>Loading…</div>
          ) : sessions.length === 0 ? (
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              padding: '8px 10px', textAlign: 'center', lineHeight: 1.5,
            }}>
              {t('sessions.pickerNoSessions')}
            </div>
          ) : (
            sessions.map(s => (
              <button key={s.session_uuid} type="button"
                onClick={() => promoteInto(s.session_uuid)}
                style={{
                  textAlign: 'left',
                  padding: '7px 9px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', color: 'var(--tx-hi)',
                  border: 'none',
                  font: '500 12px var(--font-ui)',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.title || 'Session'}
                </span>
                <span className="mono" style={{
                  font: '500 9px var(--font-mono)', color: 'var(--tx-lo)',
                  letterSpacing: 0.04,
                }}>
                  {(s.session_date || '').toUpperCase()}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </span>
  );
};

const VideoCard = ({
  title = 'VIDEO', aspect = '16 / 9', hint, children,
  // primary
  videoKey, athleteUuid, requestUuid, isBenchmark,
  // compare
  compareVideoKey, compareLabel,
  compareAthleteUuid, compareRequestUuid, compareIsBenchmark,
  // v03.44 — Save to Library props. Optional; when present the
  // VideoCard header shows the "Save" pill. trialKind is the
  // primary determinant: omit it and no pill renders.
  trialKind,
  primaryTrialUuid, primaryTeamUuid, primaryTrialDate, primaryTrialTitle,
  compareTrialUuid, compareTeamUuid, compareTrialDate, compareTrialTitle,
  // v03.58 — notify-athlete props. notified_at flows in from
  // each tab's trial row so the button can show its sent state.
  primaryNotifiedAt, compareNotifiedAt,
  // gating
  isPro, onUpgrade,
}) => {
  const Hooks = (window.React || React);
  // v01.24 — translated. compareLabel default flips to t() at
  // render so EN ↔ ES toggles re-label the chip without remount.
  // Caller-supplied compareLabel (e.g. "Personal best", "World record")
  // wins because those come from BenchmarkMenu kind labels which
  // already translate at their source.
  const t = (window.useT || (() => (k) => k))();
  const effectiveCompareLabel = compareLabel || t('analysis.video.compareChip');
  // Active source within the card. Reset to 'primary' if compare
  // disappears (e.g. user clears slot B).
  const [activeSource, setActiveSource] = Hooks.useState('primary');
  Hooks.useEffect(() => {
    if (!compareVideoKey && activeSource === 'compare') {
      setActiveSource('primary');
    }
  }, [compareVideoKey]);
  const hasCompare = !!compareVideoKey;
  const useCompare = hasCompare && activeSource === 'compare';

  const activeKey         = useCompare ? compareVideoKey         : videoKey;
  const activeAthleteUuid = useCompare ? compareAthleteUuid      : athleteUuid;
  const activeRequestUuid = useCompare ? compareRequestUuid      : requestUuid;
  const activeIsBenchmark = useCompare ? !!compareIsBenchmark    : !!isBenchmark;
  // Free users get the upsell card instead of fetching at all.
  // Saves an edge function call + avoids a brief player flash.
  const proGated = isPro === false && !!activeKey;

  const [url,   setUrl]   = Hooks.useState(null);
  const [phase, setPhase] = Hooks.useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [err,   setErr]   = Hooks.useState(null);
  const [tick,  setTick]  = Hooks.useState(0); // bump to force re-fetch

  Hooks.useEffect(() => {
    if (proGated) {
      setUrl(null); setPhase('idle'); setErr(null);
      return undefined;
    }
    if (!activeKey || !window.PA_REQUESTS?.getVideoDownloadUrl) {
      setUrl(null); setPhase('idle'); setErr(null);
      return undefined;
    }
    let cancelled = false;
    setPhase('loading'); setErr(null);
    (async () => {
      const { ok, url: signedUrl, error } = await window.PA_REQUESTS.getVideoDownloadUrl(
        activeKey,
        { athleteUuid: activeAthleteUuid, requestUuid: activeRequestUuid, isBenchmark: activeIsBenchmark }
      );
      if (cancelled) return;
      if (ok && signedUrl) {
        setUrl(signedUrl); setPhase('ready'); setErr(null);
      } else {
        setUrl(null); setPhase('error');
        setErr(error?.message || 'Could not load video.');
      }
    })();
    return () => { cancelled = true; };
  }, [activeKey, activeAthleteUuid, activeRequestUuid, activeIsBenchmark, proGated, tick]);

  // Download — Pro-only. Fetches a fresh signed URL (never re-uses
  // the in-state url, which may have rotated by the time the user
  // clicks). Triggers a browser download via a hidden <a download>.
  // The signed URL is never logged.
  const [downloading, setDownloading] = Hooks.useState(false);
  const onDownload = async () => {
    if (!activeKey || downloading) return;
    setDownloading(true);
    try {
      const { ok, url: dlUrl } = await window.PA_REQUESTS.getVideoDownloadUrl(
        activeKey,
        { athleteUuid: activeAthleteUuid, requestUuid: activeRequestUuid, isBenchmark: activeIsBenchmark }
      );
      if (!ok || !dlUrl) return;
      // Filename heuristic: tail of the videoKey path. R2 typically
      // stores videos as e.g. "races/A0042/2026-04-21/uuid.mp4".
      const filename = (activeKey.split('/').pop() || 'video.mp4');
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Tiny delay before removing so the browser actually starts
      // the download in some browsers (Safari especially).
      setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 250);
    } finally {
      setDownloading(false);
    }
  };

  const onRetry = () => {
    setPhase('loading'); setErr(null);
    setTick((t) => t + 1);
  };

  // Pick the body content based on phase. children prop overrides
  // everything (escape hatch for special embeds).
  let body;
  if (children) {
    body = children;
  } else if (proGated) {
    // Pro upsell — replaces the player. Per locked Q6 'surface'
    // pattern: inline upsell card in-place, with a CTA that opens
    // the Account modal.
    body = (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        padding: '28px 24px',
        font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
        textAlign: 'center', maxWidth: 460,
      }}>
        <span className="eyebrow" style={{ color: 'var(--signal-eff)' }}>
          {t('analysis.video.proEyebrow')}
        </span>
        <div className="display" style={{
          fontSize: 18, color: 'var(--tx-hi)', letterSpacing: '-0.015em',
          lineHeight: 1.3,
        }}>
          {t('analysis.video.proTitle')}
        </div>
        <p style={{ margin: 0, lineHeight: 1.55, color: 'var(--tx-md)', maxWidth: 420 }}>
          {t('analysis.video.proBody')}
        </p>
        {onUpgrade && (
          <button type="button" onClick={onUpgrade}
            style={{
              padding: '10px 18px', borderRadius: 10,
              border: 'none', background: 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 13px var(--font-ui)', letterSpacing: 0.04,
              cursor: 'pointer', marginTop: 4,
            }}>
            {t('analysis.video.proCta')}
          </button>
        )}
      </div>
    );
  } else if (!activeKey) {
    body = (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
      }}>
        {/* v01.63 — Peak Athlete brand mark replaces the generic
            film-strip placeholder. Feels on-brand for the empty state. */}
        {window.PeakMark
          ? <window.PeakMark size={48} color="var(--tx-lo)"/>
          : null}
        <span>{t('analysis.video.noVideo')}</span>
      </div>
    );
  } else if (phase === 'loading') {
    body = (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        font: '500 13px var(--font-ui)',
      }}>
        <span>{t('analysis.video.loading')}</span>
      </div>
    );
  } else if (phase === 'ready' && url) {
    body = (
      <video
        key={url /* force a fresh element when URL changes */}
        controls
        playsInline
        preload="metadata"
        src={url}
        style={{
          width: '100%', height: '100%',
          display: 'block', objectFit: 'contain',
          background: 'black',
        }}>
        Your browser doesn't support the video tag.
      </video>
    );
  } else {
    // error
    body = (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
        textAlign: 'center', padding: '0 18px',
      }}>
        <span style={{ color: 'var(--flag-eff)', fontWeight: 600 }}>
          {t('analysis.video.unavailable')}
        </span>
        {err && (
          <span style={{
            font: '500 11px var(--font-mono)', color: 'var(--tx-lo)',
            maxWidth: 360, lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            {err}
          </span>
        )}
        <button
          type="button" onClick={onRetry}
          style={{
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--bg-2)',
            color: 'var(--tx-hi)',
            font: '600 12px var(--font-ui)',
            letterSpacing: 0.04,
            cursor: 'pointer',
            marginTop: 4,
          }}>
          {t('analysis.video.retry')}
        </button>
      </div>
    );
  }

  // Header right-side cluster: optional download (Pro + active key),
  // then the existing hint string. Keep them on one row so the card
  // header stays compact.
  const showDownload = isPro === true && !!activeKey && !proGated;

  return (
  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: 12,
      padding: '14px 18px', borderBottom: '1px solid var(--line-soft)',
    }}>
      <span className="eyebrow" style={{
        color: 'var(--tx-lo)',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* v03.44 — Save to Library. Active slot determines which
            trial gets promoted: primary if showing the primary
            video, compare if the user flipped to the compare clip.
            Benchmarks have no trialUuid → the button hides itself.
            Skipped when Pro-gated (no point offering features
            behind a paywall flow). */}
        {!proGated && trialKind && (() => {
          const activeTrialUuid    = useCompare ? compareTrialUuid    : primaryTrialUuid;
          const activeTeamUuid     = useCompare ? compareTeamUuid     : primaryTeamUuid;
          const activeTrialDate    = useCompare ? compareTrialDate    : primaryTrialDate;
          const activeTrialTitle   = useCompare ? compareTrialTitle   : primaryTrialTitle;
          const activeNotifiedAt   = useCompare ? compareNotifiedAt   : primaryNotifiedAt;
          if (!activeTrialUuid || activeIsBenchmark) return null;
          return (
            <>
              <NotifyAthleteButton
                trialKind={trialKind}
                trialUuid={activeTrialUuid}
                athleteUuid={activeAthleteUuid}
                eventName={activeTrialTitle}
                notifiedAt={activeNotifiedAt}
              />
              <AddTrialToSessionButton
                trialKind={trialKind}
                trialUuid={activeTrialUuid}
                athleteUuid={activeAthleteUuid}
                teamUuid={activeTeamUuid}
                trialVideoKey={activeKey}
                trialDate={activeTrialDate}
                trialTitle={activeTrialTitle}
              />
            </>
          );
        })()}
        {showDownload && (
          <button
            type="button" onClick={onDownload} disabled={downloading}
            title="Download video"
            aria-label="Download video"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 8,
              border: '1px solid var(--line)', background: 'var(--bg-2)',
              color: 'var(--tx-md)',
              font: '600 11px var(--font-ui)', letterSpacing: 0.04,
              cursor: downloading ? 'wait' : 'pointer',
              opacity: downloading ? 0.6 : 1,
              textTransform: 'uppercase',
            }}>
            {/* down-arrow SVG inline so we don't depend on shared icon set */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {downloading ? t('analysis.video.downloading') : t('analysis.video.download')}
          </button>
        )}
        {hint && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--tx-lo)' }}>{hint}</span>
        )}
      </div>
    </div>

    {/* v01.18 — primary/compare chip switcher. Renders only when
        a compare videoKey is provided. Disabled while the active
        source is loading so the user can't queue up swaps. */}
    {hasCompare && !proGated && (
      <div style={{
        display: 'flex', gap: 6,
        padding: '10px 14px',
        background: 'var(--bg-3)',
        borderBottom: '1px solid var(--line-soft)',
      }}>
        <VideoSourceChip
          label={t('analysis.video.myRace')} active={activeSource === 'primary'}
          onClick={() => setActiveSource('primary')}/>
        <VideoSourceChip
          label={effectiveCompareLabel} active={activeSource === 'compare'}
          onClick={() => setActiveSource('compare')}/>
      </div>
    )}

    <div style={{
      position: 'relative', width: '100%', aspectRatio: aspect,
      background: (phase === 'ready' && !proGated) ? 'black' : 'var(--bg-3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--tx-lo)',
      overflow: 'hidden',
    }}>
      {body}
    </div>
  </div>
  );
};

// ── VideoSourceChip — internal helper for the switcher row ────
const VideoSourceChip = ({ label, active, onClick }) => (
  <button
    type="button" onClick={onClick}
    style={{
      flex: 1,
      padding: '8px 12px',
      borderRadius: 8,
      border: '1px solid ' + (active ? 'var(--signal-eff)' : 'var(--line)'),
      background: active
        ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)'
        : 'transparent',
      color: active ? 'var(--signal-eff)' : 'var(--tx-md)',
      font: '600 12px var(--font-ui)',
      letterSpacing: 0.02,
      cursor: 'pointer',
      transition: 'border-color 0.12s, background 0.12s, color 0.12s',
    }}>
    {label}
  </button>
);

// ── PhaseTimeline (interactive 4-segment bar) ─────────────────
// Ported from design-reference/web-analysis.jsx:PhaseTimeline.
// Used on Starts and Turns as the hero navigation under the
// headline. Clicking a phase calls onChange(phaseName); caller
// decides what to do with that selection.
//
// Each phase:
//   { label, name, range, weight }
// weight = formerly drove proportional segment width by phase
//   duration. v01.59 — equal-width segments instead (synced from
//   the mobile fork's v02.11 polish pass). The duration is already
//   shown explicitly in the `range` line ("0.00s · 0.68s"), and
//   the proportional sizing crushed short phases (Block ~6 % of
//   total time) below the threshold where their label could render
//   without truncation. Equal width is more readable on phone AND
//   on desktop windows narrower than ~900 px. `weight` is kept on
//   the data shape so callers don't break, but ignored here.
const PhaseTimeline = ({ phases, active, onChange }) => (
  <div style={{
    display: 'flex', borderRadius: 12, overflow: 'hidden',
    border: '1px solid var(--line)',
  }}>
    {phases.map((p, i) => {
      const isActive = p.name === active;
      const clickable = !!onChange;
      return (
        <div key={p.name}
          onClick={() => clickable && onChange(p.name)}
          onMouseEnter={e => {
            if (!isActive && clickable) e.currentTarget.style.background = 'var(--bg-3)';
          }}
          onMouseLeave={e => {
            if (!isActive && clickable) e.currentTarget.style.background = 'var(--bg-2)';
          }}
          style={{
            flex: 1,
            // v01.64 — reduced horizontal padding (16→10) so the phase
            // name has more room at iPad portrait + half-screen browser
            // widths where "Underwater" was getting clipped to "Underwate"
            // by the parent's overflow: hidden.
            padding: '14px 10px',
            cursor: clickable ? 'pointer' : 'default',
            background: isActive
              ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)'
              : 'var(--bg-2)',
            borderRight: i < phases.length - 1 ? '1px solid var(--line)' : 'none',
            borderBottom: isActive ? '2px solid var(--signal-eff)' : '2px solid transparent',
            transition: 'background 0.15s ease',
            minWidth: 0,
          }}>
          <div className="eyebrow" style={{
            fontSize: 9, color: isActive ? 'var(--signal-eff)' : 'var(--tx-lo)',
            marginBottom: 6,
            // Range eyebrow can wrap if narrow — better than clipping.
            whiteSpace: 'normal', wordBreak: 'break-word',
          }}>
            {p.label}
          </div>
          <div style={{
            font: '600 14px var(--font-ui)',
            color: isActive ? 'var(--tx-hi)' : 'var(--tx-md)',
            // v01.64 — explicit wrap so "Underwater" wraps to 2 lines
            // before getting clipped at narrow widths.
            whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.2,
          }}>
            {p.name}
          </div>
          {p.range && (
            <div className="mono" style={{
              fontSize: 11, color: 'var(--tx-lo)', marginTop: 3,
              whiteSpace: 'normal', wordBreak: 'break-word',
            }}>
              {p.range}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

// ── MetricGrid (4-col responsive tile grid) ───────────────────
// Mirrors design-reference/web-analysis.jsx lines 148-174.
// Each item: { k (label), v (value), u (unit), d (delta), best, goodDir, tip }
// - d (optional): if present, renders a Δ chip underneath the value.
//                 goodDir ('up' | 'down') tells the tile whether a
//                 positive delta is good or bad (defaults to 'down',
//                 since most metrics are times and lower = better).
// - best: renders a small "BEST" badge in the top-right corner.
// - tip (optional, v00.43): when set, renders an inline HelpDot
//                 beside the eyebrow label. Click/tap reveals the
//                 explanation popover. Mobile-friendly. No-op when
//                 omitted, so callers (Races) can keep passing items
//                 without `tip` and skip the dots entirely.
const MetricTile = ({ k, v, u, d, vCompare, best, watch, goodDir, tip }) => {
  const HelpDot = window.HelpDot;
  const dir = goodDir || 'down';
  const tone = d == null || d === 0 ? 'var(--tx-lo)'
    : (dir === 'down' ? (d < 0 ? 'var(--lime-eff)' : 'var(--flag-eff)')
                      : (d > 0 ? 'var(--lime-eff)' : 'var(--flag-eff)'));
  const borderColor = best
    ? 'color-mix(in oklch, var(--signal-eff) 35%, transparent)'
    : watch
    ? 'color-mix(in oklch, var(--amber-eff) 35%, transparent)'
    : 'var(--line)';
  return (
    <div className="card" style={{
      padding: 14, position: 'relative', borderColor, minWidth: 0,
    }}>
      {best && (
        <span className="mono" style={{
          position: 'absolute', top: 10, right: 10, fontSize: 9,
          color: 'var(--signal-eff)', fontWeight: 700,
        }}>
          BEST
        </span>
      )}
      {watch && !best && (
        <span className="mono" style={{
          position: 'absolute', top: 10, right: 10, fontSize: 9,
          color: 'var(--amber-eff)', fontWeight: 700,
        }}>
          WATCH
        </span>
      )}
      <div className="eyebrow" style={{
        fontSize: 9, marginBottom: 10, color: 'var(--tx-lo)',
        display: 'inline-flex', alignItems: 'center', gap: 2,
        // Reserve right space so the BEST/WATCH pill doesn't collide
        // with the help dot on tiles that show both.
        paddingRight: best || watch ? 36 : 0,
      }}>
        {k}
        {tip && HelpDot && <HelpDot text={tip} size={12}/>}
      </div>
      {/* v00.80 — primary + compare side-by-side. Primary keeps
          its full 22 px prominence; compare renders smaller and
          muted on the right with a vertical separator so the eye
          reads it as a paired number. Wraps onto its own line on
          narrow tiles. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        flexWrap: 'wrap', minWidth: 0,
      }}>
        <span className="mono" style={{
          font: '700 22px var(--font-mono)', color: 'var(--tx-hi)',
          whiteSpace: 'nowrap',
        }}>
          {v == null ? '—' : v}
          {/* v00.54: when v is already a formatted string (contains
              ':' for M:SS time, or trailing ' s' / unit), suppress
              the auto-appended unit so we don't render "1:23.45 s"
              or "23.45 s s". Delta below still uses u directly. */}
          {(() => {
            if (!u || v == null) return null;
            if (typeof v === 'string' && (v.indexOf(':') >= 0 || / s$/.test(v) || / m$/.test(v))) return null;
            return (
              <span style={{
                fontSize: 11, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3,
              }}>{u}</span>
            );
          })()}
        </span>
        {vCompare != null && (
          <span className="mono" style={{
            font: '600 14px var(--font-mono)',
            color: 'var(--compare-eff)', whiteSpace: 'nowrap',
            paddingLeft: 8, borderLeft: '1px solid var(--line-soft)',
            opacity: 0.95,
          }}>
            {vCompare}
            {(() => {
              if (!u) return '';
              if (typeof vCompare === 'string'
                  && (vCompare.indexOf(':') >= 0
                      || / s$/.test(vCompare)
                      || / m$/.test(vCompare))) return '';
              return (
                <span style={{
                  fontSize: 10, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 2,
                }}>{u}</span>
              );
            })()}
          </span>
        )}
      </div>
      {d != null && (
        <div style={{
          marginTop: 6, font: '600 11px var(--font-mono)', color: tone,
        }}>
          {(d > 0 ? '+' : '') + Number(d).toFixed(2)}{u ? ' ' + u : ''}
        </div>
      )}
    </div>
  );
};

// MetricGrid layout:
//   cols = 'auto' (default) → responsive auto-fit, 160 px min per tile,
//                              wraps freely. Best for variable counts.
//   cols = <number>          → fixed column count, equal widths, no
//                              wrap. Use when the caller wants a
//                              guaranteed single row (e.g. Starts rail
//                              with cols={items.length}).
const MetricGrid = ({ items, cols = 'auto' }) => {
  // v01.64 — Always use auto-fit so the grid wraps gracefully at ANY
  // viewport width, not just below the 768 mobile threshold. Previously
  // a numeric `cols` forced N columns even when the content area was
  // too narrow to render them legibly — e.g. Chrome at half-screen on
  // a 1920px monitor (960 px wide, MINUS the sidebar) tried to fit 7
  // tiles and crushed each one to ~100 px, splitting labels like "RACE
  // TIME" into "RA TIME" or "TOTAL STROKES" into "TOTAL STROK".
  // With auto-fit, the grid renders all N when the container is wide
  // enough; otherwise it wraps to as many rows as needed. The `cols`
  // prop is now a hint, not a constraint.
  // 160 px min reads cleanly on both phone and desktop for values like
  // "130.2 spm" or "+0.04 s" without label-crushing.
  const template = 'repeat(auto-fit, minmax(160px, 1fr))';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: template,
      gap: 12,
    }}>
      {(items || []).map((m, i) => <MetricTile key={m.k || i} {...m}/>)}
    </div>
  );
};

// ── TrialRail (left-column sticky trial list) ─────────────────
// Used by Starts and Turns where the list is short (per-session
// trials, not full historical). Races uses its own wider picker
// because it needs filters.
//
// Props:
//   title       — eyebrow text, e.g. 'TRIALS · 17 APR'
//   trials      — list of { key, label, when, time } (pre-formatted)
//   activeKey   — currently-selected trial key
//   onPick      — click handler
//   extra       — optional React node rendered below (e.g. Video/Share)
const TrialRail = ({ title, trials, activeKey, onPick, extra, countLabel }) => (
  <div className="card" style={{
    padding: 16, height: 'fit-content',
    position: 'sticky', top: 110,
  }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      marginBottom: 12,
    }}>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{title}</span>
      {countLabel && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--tx-lo)' }}>
          {countLabel}
        </span>
      )}
    </div>
    {(!trials || !trials.length) ? (
      <div style={{
        font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
        padding: '18px 4px', textAlign: 'center',
      }}>
        No trials captured yet.
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {trials.map((t, i) => {
          const isActive = t.key === activeKey;
          return (
            <div key={t.key || i}
              onClick={() => onPick && onPick(t)}
              style={{
                padding: '11px 14px', borderRadius: 10,
                background: isActive ? 'var(--bg-3)' : 'transparent',
                border: '1px solid ' + (isActive ? 'var(--signal-eff)' : 'transparent'),
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                minWidth: 0,
              }}>
              <div className="mono" style={{
                width: 22, textAlign: 'center', fontSize: 11,
                color: isActive ? 'var(--signal-eff)' : 'var(--tx-lo)',
                fontWeight: 700,
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  font: '500 13px var(--font-ui)', color: 'var(--tx-hi)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.label}
                </div>
                {t.when && (
                  <div className="mono" style={{
                    fontSize: 10, color: 'var(--tx-lo)', marginTop: 2,
                  }}>
                    {t.when}
                  </div>
                )}
              </div>
              {t.time != null && (
                <div className="mono" style={{
                  font: '700 14px var(--font-mono)',
                  color: isActive ? 'var(--signal-eff)' : 'var(--tx-md)',
                }}>
                  {t.time}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}
    {extra && (
      <>
        <hr style={{
          border: 'none', borderTop: '1px solid var(--line-soft)', margin: '14px 0',
        }}/>
        {extra}
      </>
    )}
  </div>
);

// DetailPane retained as a thin wrapper for callers that still use
// it (none inside web-races.jsx after v00.17b, but keep the export
// so no breakage if another page picks it up mid-port).
const DetailPane = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {children}
  </div>
);

// ── Chart primitives ──────────────────────────────────────────
// Responsive via viewBox + width:100%. SVG scales to whatever
// width the container gives it, so charts fit the pane without
// horizontal scroll.
//
// All charts render in a shared 720 x 240 viewBox "drawing space"
// regardless of rendered pixel size, so coordinate math is stable.

const CHART = {
  W: 720, H: 240,
  PAD_L: 44, PAD_R: 16, PAD_T: 16, PAD_B: 32,
  COLOR_A: 'var(--signal-eff)',
  COLOR_B: 'var(--amber-eff, #e0a13a)',
};

const chartInnerW = () => CHART.W - CHART.PAD_L - CHART.PAD_R;
const chartInnerH = () => CHART.H - CHART.PAD_T - CHART.PAD_B;

// v00.44: optional colorA / colorB / dashB overrides. Defaults
// preserve the existing signal/amber dashed compare swatch so any
// legacy caller stays unchanged. New callers pass colors that match
// their chart fills, so the legend is never lying about what's
// drawn (the v00.32+ underwater + horizontal velocity charts
// already inlined their own legend to dodge this; the migration in
// v00.44 lets them — and the four race detail charts — use the
// shared atom instead).
const Legend = ({ compareLabel, primaryLabel, colorA, colorB, dashB }) => {
  const cA = colorA || CHART.COLOR_A;
  const cB = colorB || CHART.COLOR_B;
  // dashB === '' means "solid line", undefined keeps the dashed default.
  const compareSwatchStyle = dashB === ''
    ? { width: 12, height: 2, background: cB }
    : { width: 12, height: 2,
        backgroundImage: 'linear-gradient(90deg, ' + cB + ' 60%, transparent 0)',
        backgroundSize: '5px 2px' };
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 6, padding: '0 2px', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 12, height: 2, background: cA }}/>
        {primaryLabel || 'Primary'}
      </span>
      {compareLabel && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                       font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
          <span style={compareSwatchStyle}/>
          {compareLabel}
        </span>
      )}
    </div>
  );
};

// Empty-state shell so every chart uses the same framing
const ChartFrame = ({ title, children, legend, empty }) => (
  <div>
    {title && (
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>{title}</div>
    )}
    {empty ? (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '22px 0', textAlign: 'center' }}>
        {empty}
      </div>
    ) : (
      <>
        <window.ChartScroll minWidth={CHART.W}>
        <svg viewBox={`0 0 ${CHART.W} ${CHART.H}`}
             preserveAspectRatio="xMidYMid meet"
             style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 260 }}>
          {children}
        </svg>
        </window.ChartScroll>
      </>
    )}
  </div>
);

// Shared axis + gridline rendering for line charts
const LineAxes = ({ xLabels, yLabels, yMax }) => {
  const { PAD_L, PAD_R, PAD_T, PAD_B, W, H } = CHART;
  return (
    <g>
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B}
            stroke="var(--line-soft)" strokeWidth="1"/>
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B}
            stroke="var(--line-soft)" strokeWidth="1"/>
      {[0.25, 0.5, 0.75].map(f => {
        const y = PAD_T + f * (H - PAD_T - PAD_B);
        return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                     stroke="var(--line-soft)" strokeDasharray="2 4"
                     strokeWidth="1" opacity="0.5"/>;
      })}
      {(xLabels || []).map((lbl, i) => (
        <text key={'x' + i} x={lbl.x} y={H - PAD_B + 16}
              fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
              textAnchor={lbl.anchor || 'middle'}>{lbl.text}</text>
      ))}
      {(yLabels || []).map((lbl, i) => (
        <text key={'y' + i} x={PAD_L - 8} y={lbl.y + 3}
              fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
              textAnchor="end">{lbl.text}</text>
      ))}
    </g>
  );
};

// Generic two-series line overlay.
// datum shape: { x: number, y: number }
//
// Optional color/dash overrides let callers re-tint the chart to
// match the v00.27+ compare grammar (primary lime, compare blue-
// violet) without touching the shared CHART constants. Defaults
// preserve the original signal/amber behavior so existing callers
// (SplitsChart, etc.) are unchanged.
//
// xLabels override (optional) replaces the default "<xMin> m / <xMax> m"
// axis labels — useful when the x axis is categorical (e.g. velocity
// stations: "Hands entry · Kick 1 · 3 Kicks · Stroke 1 · Stroke 2").
const LineOverlay = ({
  seriesA, seriesB, xMax, xMin, yMax, yMin, yUnit, yFormat,
  colorA, colorB, dashB, xLabelsOverride, showDots,
}) => {
  const { PAD_L, PAD_R, PAD_T, PAD_B, W, H } = CHART;
  const cA = colorA || CHART.COLOR_A;
  const cB = colorB || CHART.COLOR_B;
  const dB = (dashB === undefined) ? '6 4' : dashB; // pass '' to disable
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;
  const xOf = (v) => PAD_L + ((v - xMin) / xRange) * (W - PAD_L - PAD_R);
  const yOf = (v) => PAD_T + (1 - (v - yMin) / yRange) * (H - PAD_T - PAD_B);

  const toPath = (arr) => arr.length
    ? window.PA_SVG.smoothPath(arr.map(p => [xOf(p.x), yOf(p.y)]))
    : '';

  const fmt = yFormat || ((v) => Number(v).toFixed(1));

  // v00.46 adaptive density. Long races (300+ 5m samples) put so
  // many circles on the line that they overlap into a continuous
  // smear. Default behavior preserves the dot rendering when the
  // series fits comfortably; long series auto-suppress dots.
  // Callers can force either way with the `showDots` prop:
  //   showDots === true   → always draw
  //   showDots === false  → never draw
  //   showDots === undefined (default) → auto-decide on point count
  const maxLen   = Math.max(seriesA?.length || 0, seriesB?.length || 0);
  const drawDots = showDots === undefined ? (maxLen <= 60) : !!showDots;

  // Default x-axis labels — for wide ranges (long races) add
  // intermediate ticks at evenly-spaced meters so the user can
  // anchor the curve to a position. xLabelsOverride still wins.
  const defaultXLabels = (() => {
    if (xMax - xMin <= 1) return [];
    if (xMax - xMin <= 60) {
      return [
        { x: PAD_L,     text: xMin + ' m', anchor: 'start' },
        { x: W - PAD_R, text: xMax + ' m', anchor: 'end'   },
      ];
    }
    // Wide domain — pick 4–5 ticks at sensible round numbers
    const step = xMax - xMin <= 200 ? 50
              : xMax - xMin <= 600 ? 100
              : xMax - xMin <= 1200 ? 200
                                    : 400;
    const ticks = [];
    for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) {
      ticks.push({ x: xOf(v), text: v + ' m', anchor: v === xMin ? 'start' : v === xMax ? 'end' : 'middle' });
    }
    return ticks;
  })();
  const xLabels = xLabelsOverride
    ? xLabelsOverride.map(l => Object.assign({}, l, { x: xOf(l.x) }))
    : defaultXLabels;

  return (
    <>
      {toPath(seriesA) && (
        <path d={toPath(seriesA)} fill="none" stroke={cA}
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      )}
      {toPath(seriesB) && (
        <path d={toPath(seriesB)} fill="none" stroke={cB}
              strokeWidth="2.4" strokeDasharray={dB}
              strokeLinecap="round" strokeLinejoin="round"/>
      )}
      {drawDots && seriesA.map((p, i) => (
        <circle key={'a' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.2" fill={cA}/>
      ))}
      {drawDots && seriesB.map((p, i) => (
        <circle key={'b' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.2" fill={cB}/>
      ))}
      <LineAxes
        xLabels={xLabels}
        yLabels={[
          { y: PAD_T,                         text: fmt(yMax) + (yUnit || '') },
          { y: PAD_T + (H - PAD_T - PAD_B)/2, text: fmt((yMax + yMin)/2) + (yUnit || '') },
          { y: H - PAD_B,                     text: fmt(yMin) + (yUnit || '') },
        ]}/>
    </>
  );
};

// v00.44: race-detail charts use lime + compare-eff (solid, no dash)
// to match the prototype-wide compare grammar landed in v00.27.
// Centralized here so all four chart components stay consistent if
// the palette ever shifts again.
const RACE_CHART_COLORS = {
  colorA: 'var(--lime-eff)',
  colorB: 'var(--compare-eff)',
  dashB:  '',
};

// ── SplitsChart (cumulative race time over distance) ──────────
// Chart components render just the SVG body — the surrounding
// titled card is supplied by the caller via ChartCard.
const SplitsChart = ({ primary, compare }) => {
  const a = K.extractSplits(primary?.mj || primary?.metrics_json);
  const b = compare ? K.extractSplits(compare.mj || compare.metrics_json) : [];
  const all = a.concat(b);
  if (!all.length) return <ChartFrame empty="No split data captured."/>;
  const seriesA = a.map(p => ({ x: p.distance, y: p.cumTime }));
  const seriesB = b.map(p => ({ x: p.distance, y: p.cumTime }));
  const xMax = Math.max(...all.map(s => s.distance));
  const yMax = Math.max(...all.map(s => s.cumTime));
  return (
    <ChartFrame legend={<Legend compareLabel={compare ? 'Compare' : null} {...RACE_CHART_COLORS}/>}>
      <LineOverlay seriesA={seriesA} seriesB={seriesB}
                   xMin={0} xMax={xMax}
                   yMin={0} yMax={yMax}
                   yUnit="s" yFormat={(v) => v.toFixed(1)}
                   {...RACE_CHART_COLORS}/>
    </ChartFrame>
  );
};

// ── StrokeRateChart (spm per 5m distance) ─────────────────────
const StrokeRateChart = ({ primary, compare }) => {
  const a = K.extractStrokeRates(primary?.mj || primary?.metrics_json);
  const b = compare ? K.extractStrokeRates(compare.mj || compare.metrics_json) : [];
  const all = a.concat(b);
  if (!all.length) return <ChartFrame empty="No stroke-rate data captured."/>;
  const seriesA = a.map(p => ({ x: p.distance, y: p.rate }));
  const seriesB = b.map(p => ({ x: p.distance, y: p.rate }));
  const xMax = Math.max(...all.map(s => s.distance));
  const rawMax = Math.max(...all.map(s => s.rate));
  const rawMin = Math.min(...all.map(s => s.rate));
  // Add 10% headroom so tops aren't clipped flat against axis
  const pad = Math.max(2, (rawMax - rawMin) * 0.1);
  return (
    <ChartFrame legend={<Legend compareLabel={compare ? 'Compare' : null} {...RACE_CHART_COLORS}/>}>
      <LineOverlay seriesA={seriesA} seriesB={seriesB}
                   xMin={0} xMax={xMax}
                   yMin={Math.max(0, rawMin - pad)} yMax={rawMax + pad}
                   yUnit="" yFormat={(v) => v.toFixed(0)}
                   {...RACE_CHART_COLORS}/>
    </ChartFrame>
  );
};

// ── VelocityChart (m/s per segment) ───────────────────────────
// Derived: distance per segment / segment time
const VelocityChart = ({ primary, compare }) => {
  const segA = K.splitsToSegments(K.extractSplits(primary?.mj || primary?.metrics_json));
  const segB = compare ? K.splitsToSegments(K.extractSplits(compare.mj || compare.metrics_json)) : [];
  const toVel = (segs) => segs
    .filter(s => s.segTime > 0)
    .map(s => ({ x: s.distEnd, y: (s.distEnd - s.distStart) / s.segTime }));
  const seriesA = toVel(segA);
  const seriesB = toVel(segB);
  const all = seriesA.concat(seriesB);
  if (!all.length) return <ChartFrame empty="Not enough splits to derive velocity."/>;
  const xMax = Math.max(...all.map(p => p.x));
  const rawMax = Math.max(...all.map(p => p.y));
  const rawMin = Math.min(...all.map(p => p.y));
  const pad = Math.max(0.05, (rawMax - rawMin) * 0.15);
  return (
    <ChartFrame legend={<Legend compareLabel={compare ? 'Compare' : null} {...RACE_CHART_COLORS}/>}>
      <LineOverlay seriesA={seriesA} seriesB={seriesB}
                   xMin={0} xMax={xMax}
                   yMin={Math.max(0, rawMin - pad)} yMax={rawMax + pad}
                   yFormat={(v) => v.toFixed(2)}
                   {...RACE_CHART_COLORS}/>
    </ChartFrame>
  );
};

// ── DPSChart (v00.45 · distance per stroke, per lap) ──────────
// Per-lap DPS bars over distance. The natural granularity is per-lap
// because v_race_trials only carries stroke counts per lap (not per
// 5m). Each bar is centered at the lap's mid-distance with width
// scaled to the lap length, so the x-axis still reads as meters.
//
// In compare mode, primary and compare bars are shown grouped at
// each lap (lime + compare-eff), matching StrokeCountChart's pattern.
const DPSChart = ({ primary, compare, mode }) => {
  // v00.71 — per-100m mode: pull rows from derivePerLap +
  // aggregateLaps (which already produces bucketed dps from
  // total strokes / bucket distance) and reshape into the
  // {lap, lapStart, lapEnd, distMid, dps} contract this chart
  // expects. Per-lap mode falls through to extractDPS unchanged.
  const reshape = (laps) => laps
    .filter(r => r.dps != null && r.startD != null && r.endD != null)
    .map((r, i) => ({
      lap:      i + 1,
      lapStart: r.startD,
      lapEnd:   r.endD,
      distMid:  (r.startD + r.endD) / 2,
      dps:      r.dps,
    }));
  // v03.16 — per-50m / per-100m. For the finest granularity that
  // is a no-op on the lap distance (LCM per-50 = per-lap), keep
  // K.extractDPS so per-lap fidelity is unchanged; otherwise
  // bucket via aggregateLaps.
  const _perLapA = derivePerLap(primary);
  const _lapDist = _perLapA.length ? (_perLapA[0].endD - _perLapA[0].startD) : 0;
  const _fineNoOp = _lapDist > 0 && Math.round(50 / _lapDist) <= 1;
  // v03.17 — per-lap always uses K.extractDPS (raw per-lap DPS).
  const a = mode === 'per-100m'
    ? reshape(aggregateLaps(_perLapA, 100))
    : mode === 'per-lap'
      ? K.extractDPS(primary)
      : (_fineNoOp ? K.extractDPS(primary) : reshape(aggregateLaps(_perLapA, 50)));
  const b = mode === 'per-100m'
    ? (compare ? reshape(aggregateLaps(derivePerLap(compare), 100)) : [])
    : mode === 'per-lap'
      ? (compare ? K.extractDPS(compare) : [])
      : (compare
          ? (_fineNoOp ? K.extractDPS(compare) : reshape(aggregateLaps(derivePerLap(compare), 50)))
          : []);
  if (!a.length && !b.length) {
    return <ChartFrame empty="No stroke-count data captured."/>;
  }

  // Pair on lap so groups align even if compare has more/fewer laps
  const lapsSet = new Set();
  a.forEach(r => lapsSet.add(r.lap));
  b.forEach(r => lapsSet.add(r.lap));
  const laps = [...lapsSet].sort((x, y) => x - y);
  const aMap = new Map(a.map(r => [r.lap, r]));
  const bMap = new Map(b.map(r => [r.lap, r]));

  const all = [...a, ...b];
  const yRaw = all.map(r => r.dps).filter(v => v != null);
  const yMax = Math.max(...yRaw) * 1.1;
  const yMin = 0;

  // X-domain: always 0 → race distance (use whichever series is
  // longer to set the x-axis end).
  const xMaxA = a.length ? a[a.length - 1].lapEnd : 0;
  const xMaxB = b.length ? b[b.length - 1].lapEnd : 0;
  const xMax  = Math.max(xMaxA, xMaxB) || 50;

  const { PAD_L, PAD_R, PAD_T, PAD_B, W, H } = CHART;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf = (m) => PAD_L + (m / xMax) * innerW;
  const yOf = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  const showB = compare && b.length > 0;
  // Lap distance (assume equal — matches extractDPS's contract)
  const sample  = a[0] || b[0];
  const lapDist = sample ? (sample.lapEnd - sample.lapStart) : (xMax / Math.max(laps.length, 1));
  // v00.46: tighten the bar-group factor when laps get dense so the
  // bars don't fuse into a continuous wall on 1500/1650-m races.
  const dense   = laps.length > 16;
  const veryDense = laps.length > 32;
  const groupFactor = veryDense ? 0.55 : dense ? 0.65 : 0.78;
  const groupW  = (lapDist / xMax) * innerW * groupFactor;
  const barW    = showB ? groupW / 2 - 2 : groupW;
  // Tick label every Nth lap so the axis isn't unreadable.
  const labelEvery = veryDense ? 5 : dense ? 2 : 1;

  return (
    <ChartFrame legend={<Legend compareLabel={compare ? 'Compare' : null} {...RACE_CHART_COLORS}/>}>
      {laps.map((lap, idx) => {
        const aR = aMap.get(lap);
        const bR = bMap.get(lap);
        const ref = aR || bR;
        const cx  = xOf(ref.distMid);
        const groupLeft = cx - groupW / 2;
        const labelThis = idx % labelEvery === 0 || idx === laps.length - 1;
        return (
          <g key={lap}>
            {aR && aR.dps != null && (
              <rect
                x={showB ? groupLeft : cx - barW / 2}
                y={yOf(aR.dps)}
                width={barW}
                height={Math.max(2, H - PAD_B - yOf(aR.dps))}
                fill={RACE_CHART_COLORS.colorA}
                rx="2"/>
            )}
            {bR && bR.dps != null && showB && (
              <rect
                x={groupLeft + barW + 4}
                y={yOf(bR.dps)}
                width={barW}
                height={Math.max(2, H - PAD_B - yOf(bR.dps))}
                fill={RACE_CHART_COLORS.colorB}
                rx="2"
                opacity="0.9"/>
            )}
            {/* Lap tick under bar group */}
            {labelThis && (
              <text x={cx} y={H - PAD_B + 14}
                    fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
                    textAnchor="middle">
                {Math.round(ref.lapEnd)}m
              </text>
            )}
          </g>
        );
      })}
      <LineAxes
        xLabels={[]}
        yLabels={[
          { y: PAD_T,                         text: yMax.toFixed(2) + ' m' },
          { y: PAD_T + (H - PAD_T - PAD_B)/2, text: (yMax / 2).toFixed(2) + ' m' },
          { y: H - PAD_B,                     text: '0' },
        ]}/>
    </ChartFrame>
  );
};

// ── StrokeCountChart (grouped bars per lap) ───────────────────
const StrokeCountChart = ({ primary, compare }) => {
  const a = K.extractStrokeCounts(primary?.mj || primary?.metrics_json);
  const b = compare ? K.extractStrokeCounts(compare.mj || compare.metrics_json) : [];
  const all = a.concat(b);
  if (!all.length) return <ChartFrame empty="No stroke-count data captured."/>;

  // Pair on lap index so bars align
  const lapsSet = new Set();
  a.forEach(r => lapsSet.add(r.lap));
  b.forEach(r => lapsSet.add(r.lap));
  const laps = [...lapsSet].sort((x, y) => x - y);
  const aMap = new Map(a.map(r => [r.lap, r.count]));
  const bMap = new Map(b.map(r => [r.lap, r.count]));

  const { PAD_L, PAD_R, PAD_T, PAD_B, W, H } = CHART;
  const yMax = Math.max(...all.map(r => r.count));
  const yOf = (v) => PAD_T + (1 - v / yMax) * (H - PAD_T - PAD_B);
  const bandW = (W - PAD_L - PAD_R) / laps.length;
  const inner = Math.min(bandW * 0.78, 40);
  const showB = compare && b.length > 0;
  const barW = showB ? inner / 2 - 2 : inner;

  return (
    <ChartFrame legend={<Legend compareLabel={compare ? 'Compare' : null} {...RACE_CHART_COLORS}/>}>
      {laps.map((lap, i) => {
        const cx = PAD_L + (i + 0.5) * bandW;
        const aVal = aMap.get(lap);
        const bVal = bMap.get(lap);
        const groupLeft = cx - inner / 2;
        return (
          <g key={lap}>
            {aVal != null && (
              <rect
                x={showB ? groupLeft : cx - barW / 2}
                y={yOf(aVal)}
                width={barW}
                height={Math.max(2, H - PAD_B - yOf(aVal))}
                fill={RACE_CHART_COLORS.colorA}
                rx="2"/>
            )}
            {bVal != null && showB && (
              <rect
                x={groupLeft + barW + 4}
                y={yOf(bVal)}
                width={barW}
                height={Math.max(2, H - PAD_B - yOf(bVal))}
                fill={RACE_CHART_COLORS.colorB}
                rx="2"
                opacity="0.9"/>
            )}
            <text x={cx} y={H - PAD_B + 14}
                  fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
                  textAnchor="middle">
              L{lap}
            </text>
          </g>
        );
      })}
      <LineAxes
        xLabels={[]}
        yLabels={[
          { y: PAD_T,                         text: yMax.toFixed(0) },
          { y: PAD_T + (H - PAD_T - PAD_B)/2, text: (yMax / 2).toFixed(0) },
          { y: H - PAD_B,                     text: '0' },
        ]}/>
    </ChartFrame>
  );
};

// ── Numeric tables ────────────────────────────────────────────

// Full splits readout — distance, cum A, cum B, seg A, seg B, Δ
const SplitsTable = ({ primary, compare }) => {
  const a = K.extractSplits(primary?.mj || primary?.metrics_json);
  const b = compare ? K.extractSplits(compare.mj || compare.metrics_json) : [];
  if (!a.length) return null;

  const segA = K.splitsToSegments(a);
  const segB = K.splitsToSegments(b);
  const segBByDist = new Map(segB.map(s => [s.distEnd, s]));
  const cumBByDist = new Map(b.map(s => [s.distance, s.cumTime]));

  const showCompare = compare && b.length > 0;
  const cols = showCompare
    ? ['Distance', 'Cum A', 'Seg A', 'Cum B', 'Seg B', 'Δ seg']
    : ['Distance', 'Cum',   'Seg'];

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', minWidth: showCompare ? 420 : 260,
          borderCollapse: 'collapse', font: '500 12px var(--font-mono)',
        }}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} style={{
                  textAlign: c === 'Distance' ? 'left' : 'right',
                  padding: '6px 8px', color: 'var(--tx-lo)',
                  borderBottom: '1px solid var(--line-soft)',
                  fontWeight: 600, letterSpacing: 0.04,
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segA.map(sa => {
              const sb = segBByDist.get(sa.distEnd);
              const cumB = cumBByDist.get(sa.distEnd);
              const delta = sb ? sb.segTime - sa.segTime : null;
              const tone = delta == null ? 'var(--tx-lo)'
                : delta < 0 ? 'var(--lime-eff)'
                : delta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)';
              return (
                <tr key={sa.distEnd}>
                  <td style={{ padding: '5px 8px', color: 'var(--tx-md)' }}>{sa.label}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--tx-hi)' }}>
                    {sa.cumTime.toFixed(2)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--tx-hi)' }}>
                    {sa.segTime.toFixed(2)}
                  </td>
                  {showCompare && (
                    <>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--tx-hi)' }}>
                        {cumB != null ? cumB.toFixed(2) : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--tx-hi)' }}>
                        {sb ? sb.segTime.toFixed(2) : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: tone }}>
                        {delta != null ? ((delta > 0 ? '+' : '') + delta.toFixed(2)) : '—'}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Segment delta table — only renders when a diff exists (kept for
// backwards compat with v00.17; the new SplitsTable supersedes it,
// but existing places still import the name).
const SegmentDeltaTable = ({ diff }) => {
  if (!diff || !diff.perSegment || !diff.perSegment.length) return null;
  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
        Segment deltas (B − A)
      </div>
      {/* v01.08 — overflow-x wrapper protects the 4-column min-content (~280px)
          from compressing when the parent card is narrower. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'grid',
                    gridTemplateColumns: 'minmax(70px, 1fr) repeat(3, minmax(60px, 90px))',
                    gap: '6px 12px', font: '500 12px var(--font-mono)',
                    minWidth: 280 }}>
        <div style={{ color: 'var(--tx-lo)' }}>Segment</div>
        <div style={{ color: 'var(--tx-lo)', textAlign: 'right' }}>A</div>
        <div style={{ color: 'var(--tx-lo)', textAlign: 'right' }}>B</div>
        <div style={{ color: 'var(--tx-lo)', textAlign: 'right' }}>Δ</div>
        {diff.perSegment.map(s => {
          const tone = s.delta < 0 ? 'var(--lime-eff)' : s.delta > 0 ? 'var(--flag-eff)' : 'var(--tx-lo)';
          return (
            <React.Fragment key={s.distance}>
              <div style={{ color: 'var(--tx-md)' }}>{s.label}</div>
              <div style={{ color: 'var(--tx-hi)', textAlign: 'right' }}>{s.aSeg.toFixed(2)}</div>
              <div style={{ color: 'var(--tx-hi)', textAlign: 'right' }}>{s.bSeg.toFixed(2)}</div>
              <div style={{ color: tone, textAlign: 'right' }}>
                {(s.delta > 0 ? '+' : '') + s.delta.toFixed(2)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      </div>
    </div>
  );
};

// ── Expose ────────────────────────────────────────────────────

Object.assign(window, {
  FilterBar, SelectionSlots, Slot, BenchmarkMenu,
  HelpDot,
  HeadlineStrip, Tile,
  TrialRow, TrialList,
  // card primitives
  ChartCard, RaceHeadlineCard, DetailPane,
  // design-reference atoms (v00.17c)
  Headline, LapBars, StrokeMechanicsTable, RaceCompareBars,
  buildRaceStory, derivePerLap, aggregateLaps, derivePerSegment,
  // Starts / Turns / shared atoms (v00.18)
  VideoCard, PhaseTimeline, MetricGrid, MetricTile, TrialRail,
  // charts (kept available for future detail drill-downs)
  SplitsChart, StrokeRateChart, VelocityChart, StrokeCountChart, DPSChart,
  // tables
  SplitsTable, SegmentDeltaTable,
  // shared chart primitives (exposed in case Starts/Turns want them raw)
  ChartFrame, Legend, LineOverlay, LineAxes, CHART,
});

try { console.log('[analysis-shell] loaded (v01.50)'); } catch (_) {}
