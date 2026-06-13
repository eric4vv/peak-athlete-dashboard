/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Turns — analysis page (v00.51)

   Mirrors web-starts.jsx structurally:
     - FilterBar / SelectionSlots / TrialList shared atoms
     - Headline + PhaseTimeline + summary rail
     - PhaseDetail with per-phase rows tables
     - Last8Sessions progression at the bottom

   Phase 2 v1: shell + summary rail + per-phase rows. Per-phase
   visuals (approach/depart velocity bars, push-off arc, etc.)
   land in v00.52+.

   Read-only. v_turn_kpis is RLS-filtered server-side.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useTurnsState,
  useEffect: useTurnsEffect,
  useMemo:   useTurnsMemo,
} = React;

// v00.81 — full WebTeamTurns using the shared TeamBrowsePage
// from web-races.jsx. Browse mode only; cross-athlete compare
// for Turns is deferred (TurnDetail's prop shape needs rework).
const TurnsTeamSummary = ({ rows }) => {
  if (!rows || !rows.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-md)' }}>
        No turns yet
      </div>
    );
  }
  let best = null;
  let latest = null;
  rows.forEach(r => {
    const v = parseFloat(r.time_15in_15out_s);
    if (!isNaN(v) && (best == null || v < best)) best = v;
    if (!latest || (r.source_date || '') > (latest.source_date || '')) latest = r;
  });
  const split15 = latest && parseFloat(latest.split_15m_s);
  return (
    <div style={{
      font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
      }}>
        <span>Best 15-in / 15-out</span>
        <span className="mono" style={{
          font: '700 13px var(--font-mono)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em',
        }}>
          {best != null ? best.toFixed(2) + ' s' : '—'}
        </span>
      </div>
      {split15 != null && !isNaN(split15) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
          color: 'var(--tx-lo)',
        }}>
          <span>Split 15 m (last)</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
            {split15.toFixed(2)} s
          </span>
        </div>
      )}
    </div>
  );
};

// v00.82 — cross-athlete detail render for Turns. Mirrors the
// per-athlete WebTurns prop pattern.
const TurnsCompareDetail = ({ primary, compare }) => {
  const [phase, setPhase] = useTurnsState('Approach');
  if (!primary || !compare) return null;
  const PA_T  = window.PA_TURNS;
  const PA_TC = window.PA_TURNS_COMPARE;
  if (!PA_T || !PA_TC) return null;
  const diff   = PA_TC.diffTurns(primary, compare);
  const phases = PA_T.phaseSpans(primary);
  let items    = PA_T.metricItems(primary);
  if (diff) items = PA_TC.applyDeltas(items, diff);
  items = PA_TC.applyBests(items, [primary, compare], primary);
  const story  = PA_T.buildTurnStory(primary, compare);
  return <TurnDetail
    primary={primary} compare={compare} diff={diff}
    story={story} phases={phases} items={items}
    phase={phase} onChangePhase={setPhase}
    trials={[primary, compare]}/>;
};

const formatTurnTrial = (r) => {
  const d = (() => {
    if (!r.source_date) return '—';
    const dt = new Date(r.source_date);
    return isNaN(dt) ? r.source_date
      : dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  })();
  const t = parseFloat(r.time_15in_15out_s);
  const tStr = !isNaN(t) ? t.toFixed(2) + ' s' : '—';
  return d + ' · 15-in/15-out ' + tStr;
};

const fetchFullTurnTrial = async (slot) => {
  if (!window.PA_TURNS || !window.PA_TURNS.listTurnTrials) {
    throw new Error('Slot: PA_TURNS not loaded');
  }
  const { data, error } = await window.PA_TURNS.listTurnTrials(
    slot.athlete_uuid, { limit: 200 }
  );
  if (error) throw new Error('Slot: ' + (error.message || 'query error'));
  const rows = data || [];
  if (!rows.length) throw new Error('Slot: no turn trials for athlete');
  const slotDay = String(slot.source_date || '').slice(0, 10);
  let cands = rows.filter(r =>
    String(r.source_date || '').slice(0, 10) === slotDay);
  if (!cands.length) cands = rows;
  const target = parseFloat(slot.time_15in_15out_s);
  if (!isFinite(target)) return cands[0];
  let best = cands[0];
  let bestDiff = Math.abs((parseFloat(best.time_15in_15out_s) || Infinity) - target);
  cands.forEach(c => {
    const d = Math.abs((parseFloat(c.time_15in_15out_s) || Infinity) - target);
    if (d < bestDiff) { best = c; bestDiff = d; }
  });
  return best;
};

const WebTeamTurns = ({ profile, onPickAthlete, isPro, onUpgrade }) => {
  const TBP = window.PA_TEAMUI && window.PA_TEAMUI.TeamBrowsePage;
  if (!TBP) {
    return (
      <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
        Team UI not loaded.
      </div>
    );
  }
  return <TBP
    profile={profile}
    onPickAthlete={onPickAthlete}
    heroLabel="TURNS"
    heroNoun="turn"
    modalityView="v_turn_kpis"
    modalitySelect="athlete_uuid, time_15in_15out_s, split_15m_s, source_date"
    summaryFor={(a, rows) => <TurnsTeamSummary rows={rows}/>}
    compareConfig={{
      formatTrial:    formatTurnTrial,
      fetchFullTrial: fetchFullTurnTrial,
      DetailComponent: TurnsCompareDetail,
    }}
    isPro={isPro}
    onUpgrade={onUpgrade}
  />;
};

const WebTurns = ({ session, authUserId, lang, adminAthleteUuid, isPro: realIsPro, onUpgrade }) => {
  // v01.50 — Preview Pro mode subscription. See web-races.jsx.
  const previewOn = window.PA_PREVIEW?.usePreview?.() || false;
  const isPro = previewOn ? true : !!realIsPro;
  // P-9 (v00.74) — index.html App routes to TeamTurnsPlaceholder
  // when persona is coach + no impersonation. Per-athlete WebTurns
  // is unchanged.
  const [athleteUuid, setAthleteUuid] = useTurnsState(null);
  const [trials,      setTrials]      = useTurnsState([]);
  const [loading,     setLoading]     = useTurnsState(true);
  const [error,       setError]       = useTurnsState(null);
  // v01.05 — refetchToken: bumping it triggers a fresh fetch via the
  // listTurnTrials effect dependency. The shared ErrorState's RETRY
  // button calls setError(null) + setRefetchToken(t => t + 1) so users
  // can recover from a transient network failure without a page reload.
  const [refetchToken, setRefetchToken] = useTurnsState(0);
  // v01.07 — mobile breakpoint for grid stacking
  const isMobile = (window.useIsMobile || (() => false))();
  // v01.24 — translation hook
  const t = (window.useT || (() => (k) => k))();

  // Selection (Option D — same shape as Races / Starts)
  const [slotAKey,  setSlotAKey]  = useTurnsState(null);
  const [slotBKey,  setSlotBKey]  = useTurnsState(null);
  const [slotBKind, setSlotBKind] = useTurnsState(null); // 'PB' | 'MEDIAN' | null

  const [phase,   setPhase]   = useTurnsState('Approach');
  const [filters, setFilters] = useTurnsState({ distance: null, style: null, course: null });
  // v03.28 — collapsible trial list (same pattern as Sessions clip list).
  const [trialListCollapsed, setTrialListCollapsed] = useTurnsState(false);

  // ── Resolve athlete_uuid (admin override aware) ──────────────
  useTurnsEffect(() => {
    let cancelled = false;
    if (adminAthleteUuid) {
      setAthleteUuid(adminAthleteUuid);
      setTrials([]);
      setError(null);
      setSlotAKey(null);
      setSlotBKey(null);
      setSlotBKind(null);
      setFilters({ distance: null, style: null, course: null });
      setPhase('Approach');
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const { data, error } = await window.supabaseClient
          .from('v_my_athlete').select('athlete_uuid').maybeSingle();
        if (cancelled) return;
        if (error && error.code !== 'PGRST116') {
          setError('Could not resolve athlete'); setLoading(false); return;
        }
        setAthleteUuid(data?.athlete_uuid || null);
      } catch (e) {
        if (!cancelled) { setError(String(e.message || e)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [authUserId, adminAthleteUuid]);

  // ── Fetch trials once athlete_uuid is known ──────────────────
  useTurnsEffect(() => {
    if (!athleteUuid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await window.PA_TURNS.listTurnTrials(athleteUuid, { limit: 200 });
      if (cancelled) return;
      if (error) setError(error.message || 'Query failed');
      setTrials(data || []);
      if (data && data.length && !slotAKey) {
        setSlotAKey(window.PA_TURNS.trialKey(data[0]));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [athleteUuid, refetchToken]);

  // Helper bundle for shared atoms (TrialList / SelectionSlots).
  const turnsHelpers = useTurnsMemo(() => ({
    title:   (t) => window.PA_TURNS.turnTitle(t),
    date:    (t) => window.PA_TURNS.turnDate(t),
    time:    (t) => window.PA_TURNS.turn15in15out(t),
    key:     (t) => window.PA_TURNS.trialKey(t),
    // v01.49 — raw ISO date for the free-tier session lock sort.
    rawDate: (t) => t?.source_date || null,
  }), []);

  // v01.50 — sample swap when preview is on.
  const effectiveTrials = previewOn && window.PA_SAMPLE
    ? window.PA_SAMPLE.TURNS
    : trials;
  const options  = useTurnsMemo(
    () => window.PA_TURNS.optionsFrom(effectiveTrials),
    [effectiveTrials]
  );
  const filtered = useTurnsMemo(
    () => window.PA_TURNS.applyFilters(effectiveTrials, filters),
    [effectiveTrials, filters]
  );

  const slotATrial = useTurnsMemo(
    () => window.PA_TURNS.findByKey(effectiveTrials, slotAKey),
    [effectiveTrials, slotAKey]
  );

  const slotBTrial = useTurnsMemo(() => {
    if (slotBKind && slotATrial) {
      return window.PA_TURNS_COMPARE.benchmarkTrial(effectiveTrials, slotBKind, slotATrial);
    }
    return window.PA_TURNS.findByKey(effectiveTrials, slotBKey);
  }, [effectiveTrials, slotBKey, slotBKind, slotATrial]);

  const diff = useTurnsMemo(() => {
    if (!slotATrial || !slotBTrial) return null;
    return window.PA_TURNS_COMPARE.diffTurns(slotATrial, slotBTrial);
  }, [slotATrial, slotBTrial]);

  const phases   = useTurnsMemo(() => window.PA_TURNS.phaseSpans(slotATrial), [slotATrial]);
  const baseItems = useTurnsMemo(() => window.PA_TURNS.metricItems(slotATrial), [slotATrial]);
  const items = useTurnsMemo(() => {
    let pile = baseItems;
    if (diff) pile = window.PA_TURNS_COMPARE.applyDeltas(pile, diff);
    pile = window.PA_TURNS_COMPARE.applyBests(pile, effectiveTrials, slotATrial);
    return pile;
  }, [baseItems, diff, effectiveTrials, slotATrial]);

  const story = useTurnsMemo(
    () => window.PA_TURNS.buildTurnStory(slotATrial, slotBTrial),
    [slotATrial, slotBTrial]
  );

  // v01.61 — Publish current trial context for Pulse AI.
  useTurnsEffect(() => {
    if (!window.PA_PULSE) return;
    const title = slotATrial ? (window.PA_TURNS?.turnTitle?.(slotATrial) || 'trial') : null;
    window.PA_PULSE.setContext({
      module: 'turn',
      primary: slotATrial || null,
      compare: slotBTrial || null,
      label: slotATrial ? ('Turn · ' + title) : 'Turns (no trial selected)',
    });
  }, [slotATrial, slotBTrial]);

  // Slot click semantics — same Option D as Races / Starts.
  const onAssign = (trial) => {
    const k = window.PA_TURNS.trialKey(trial);
    if (k === slotAKey) { setSlotAKey(null); return; }
    if (k === slotBKey) { setSlotBKey(null); setSlotBKind(null); return; }
    if (!slotAKey) { setSlotAKey(k); return; }
    // v02.21 — Compare gate refined (2026-05-12). See web-races.jsx for
    // the strategy. Coach/admin viewing an athlete (adminAthleteUuid set)
    // gets free same-swimmer compare; athletes on own page stay Pro-locked.
    const isCoachOrAdminMode = !!adminAthleteUuid;
    if (!isPro && !isCoachOrAdminMode) {
      try {
        const tt = (window.useT || (() => (k) => k))();
        window.PA_TOAST?.show(tt('analysis.compareLock.toastBody'), {
          type: 'info',
          title: tt('analysis.compareLock.toastTitle'),
        });
      } catch (_) {}
      onUpgrade?.();
      return;
    }
    setSlotBKey(k);
    setSlotBKind(null);
  };

  const onPickBenchmark = (kind) => { setSlotBKey(null); setSlotBKind(kind); };
  const onClearA = () => setSlotAKey(null);
  const onClearB = () => { setSlotBKey(null); setSlotBKind(null); };

  const benchmarkUnavailable = !!slotBKind && !!slotATrial && !slotBTrial;

  // ── Render states ────────────────────────────────────────────
  if (loading) {
    const LS = window.LoadingState;
    return LS
      ? <LS label={t('analysis.loadingState.turns')} large/>
      : (
        <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
          {t('analysis.loadingState.turns')}
        </div>
      );
  }
  if (error) {
    const ES = window.ErrorState;
    const onRetry = () => { setError(null); setRefetchToken(tok => tok + 1); };
    return ES
      ? <ES message={t('analysis.errorState.turnsMessage')}
            onRetry={onRetry}
            technical={String(error)}/>
      : (
        <div style={{ padding: 24, color: 'var(--flag-eff)', font: '500 13px var(--font-ui)' }}>
          {error}
        </div>
      );
  }
  // v01.50 — guard on effectiveTrials so preview mode bypasses.
  if (!effectiveTrials.length) {
    if (window.EmptyState) {
      const previewBtn = (window.PA_PREVIEW && !previewOn)
        ? (
          <button type="button"
            onClick={() => window.PA_PREVIEW.enter()}
            style={{
              padding: '9px 16px', borderRadius: 10,
              border: 'none', background: 'var(--signal-eff)',
              color: 'var(--ink)',
              font: '700 12px var(--font-ui)', letterSpacing: 0.02,
              cursor: 'pointer',
            }}>
            {t('preview.previewBtn')}
          </button>
        )
        : null;
      return <window.EmptyState
        eyebrow={t('analysis.emptyState.turnsEyebrow')}
        title={t('analysis.emptyState.turnsTitle')}
        body={t('analysis.emptyState.turnsBody')}
        action={previewBtn}
      />;
    }
    return (
      <div style={{
        padding: 28, borderRadius: 14,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        color: 'var(--tx-md)', font: '500 13px var(--font-ui)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>NO TURNS YET</span>
        <div className="display" style={{ fontSize: 20, color: 'var(--tx-hi)' }}>
          Book a turn analysis session
        </div>
        <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
          Once a turn is processed, your approach velocity, wall contact,
          push-off, and breakout metrics will appear here. Compare any two
          turns side by side, or a turn against your personal best.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FilterBar options={options} filters={filters} onChange={setFilters}/>

      <SelectionSlots
        slotATrial={slotATrial}
        slotBTrial={slotBKind ? null : slotBTrial}
        slotBKind={slotBKind}
        onClearA={onClearA}
        onClearB={onClearB}
        onPickBenchmark={onPickBenchmark}
        helpers={turnsHelpers}
        emptyLabel={t('analysis.slot.selectTurn')}
        benchmarkUnavailable={benchmarkUnavailable}
        warnHint={t('analysis.slot.warnHintStroke')}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile
          ? '1fr'
          : (trialListCollapsed ? '56px 1fr' : 'minmax(280px, 360px) 1fr'),
        gap: 16, alignItems: 'start',
      }}>
        {/* LEFT: trial picker — collapsible on desktop + mobile (v03.64).
            Collapsed mode replaces the ChartCard with a thin rail (desktop)
            or a horizontal pill (mobile). */}
        {trialListCollapsed ? (
          <div style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line-soft)',
            borderRadius: 12, padding: '6px 4px',
          }}>
            <TrialList
              trials={filtered}
              slotAKey={slotAKey}
              slotBKey={slotBKind ? null : slotBKey}
              onAssign={onAssign}
              emptyMessage="No turns match these filters."
              helpers={turnsHelpers}
              isPro={isPro}
              onUpgrade={onUpgrade}
              collapsed
              onToggleCollapsed={() => setTrialListCollapsed(false)}
            />
          </div>
        ) : (
          <ChartCard
            title={t('analysis.trials.title')}
            right={
              <span className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
                {t('analysis.trials.filterCount', { filtered: filtered.length, total: effectiveTrials.length })}
              </span>
            }>
            <TrialList
              trials={filtered}
              slotAKey={slotAKey}
              slotBKey={slotBKind ? null : slotBKey}
              onAssign={onAssign}
              emptyMessage="No turns match these filters."
              helpers={turnsHelpers}
              isPro={isPro}
              onUpgrade={onUpgrade}
              // v03.64 — Toggle active on mobile too.
              onToggleCollapsed={() => setTrialListCollapsed(true)}
            />
          </ChartCard>
        )}

        {/* RIGHT: detail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {!slotATrial ? (
            <ChartCard title="TURN DETAIL">
              <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
                            padding: '24px 0', textAlign: 'center' }}>
                Select a turn from the list to see its phase-by-phase breakdown,
                approach velocity, push-off, and 15-in / 15-out time.
              </div>
            </ChartCard>
          ) : (
            <TurnDetail
              primary={slotATrial}
              compare={slotBTrial}
              diff={diff}
              story={story}
              phases={phases}
              items={items}
              phase={phase}
              onChangePhase={setPhase}
              trials={effectiveTrials}
              isPro={isPro}
              onUpgrade={onUpgrade}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ── TurnWallContactBar (v00.54) ───────────────────────────────
// Four-phase stacked bar showing the structure of wall contact.
// Mirrors live's `renderTurnWallContact`. Biomechanical order:
//
//   ADAPT   — last stroke → wall contact
//   HAND    — hands on the wall
//   ROTATE  — flip / rotation around the body axis
//   PUSH    — feet driving off the wall
//
// Each segment width is its share of total wall time. Compare
// trial renders as a second, slightly thinner bar underneath at
// 85% opacity (matches live's compare-trial pattern).
//
// Below the bar: 5 mini-KPIs (one per phase + total). Phase
// colors: amber (Adapt = caution), signal (Hand = neutral),
// compare-eff (Rotate = distinct), lime (Push = explosive output).
//
// Lives on the Wall tab body of TurnPhaseDetail.
const TurnWallContactBar = ({ primary, compare }) => {
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  const phasesFor = (t) => {
    if (!t) return null;
    const adapt = num(t, 'adaption_time_s');
    const hand  = num(t, 'hand_contact_time_s');
    const rot   = num(t, 'rotation_time_s');
    const push  = num(t, 'push_off_time_s');
    if (adapt == null && hand == null && rot == null && push == null) return null;
    const safe = (v) => (v == null ? 0 : v);
    return {
      adapt: safe(adapt), hand: safe(hand), rot: safe(rot), push: safe(push),
      total: safe(adapt) + safe(hand) + safe(rot) + safe(push),
    };
  };

  const a = phasesFor(primary);
  const b = compare ? phasesFor(compare) : null;
  if (!a || a.total <= 0) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '14px 0', textAlign: 'center' }}>
        Wall contact phase columns missing for this trial.
      </div>
    );
  }

  // Anchor both bars to the larger of the two totals so the
  // visible widths read true relative to each other.
  const totalMax = Math.max(a.total, b ? b.total : 0);

  // Phase definitions in biomechanical render order.
  const PHASES = [
    { key: 'adapt', label: 'Adapt',  color: 'var(--amber-eff)'   },
    { key: 'hand',  label: 'Hand',   color: 'var(--signal-eff)'  },
    { key: 'rot',   label: 'Rotate', color: 'var(--compare-eff)' },
    { key: 'push',  label: 'Push',   color: 'var(--lime-eff)'    },
  ];

  const Bar = ({ row, height, opacity, label }) => {
    if (!row) return null;
    return (
      <div style={{ marginTop: 8 }}>
        <span className="eyebrow" style={{
          fontSize: 9, color: 'var(--tx-lo)', letterSpacing: 0.08,
        }}>
          {label}
        </span>
        <div style={{
          display: 'flex', height, marginTop: 4,
          borderRadius: 6, overflow: 'hidden',
          background: 'var(--bg-3)',
        }}>
          {PHASES.map(p => {
            const phaseTime = row[p.key] || 0;
            const widthPct = (phaseTime / totalMax) * 100;
            if (widthPct <= 0) return null;
            return (
              <div key={p.key} style={{
                width: widthPct + '%',
                background: p.color,
                opacity,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--ink)',
                font: '700 10px var(--font-mono)',
                whiteSpace: 'nowrap', overflow: 'hidden',
                padding: '0 4px',
              }}>
                {phaseTime.toFixed(3)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const compareLabel = compare
    ? (compare._benchmarkKind === 'PB'      ? 'PB'
     : compare._benchmarkKind === 'MEDIAN'  ? 'MEDIAN'
     : 'COMPARE')
    : null;

  // Mini-KPI tile for the row underneath. Color-coded to match
  // each phase's bar color so the visual link is explicit.
  const Mini = ({ label, value, color, dec }) => (
    <div>
      <div className="eyebrow" style={{
        fontSize: 9, color: 'var(--tx-lo)', letterSpacing: 0.08,
      }}>
        {label}
      </div>
      <div style={{
        font: '700 16px var(--font-mono)',
        color: color || 'var(--tx-hi)',
        marginTop: 4,
      }}>
        {value != null ? value.toFixed(dec != null ? dec : 3) : '—'}
        {value != null && (
          <span style={{
            fontSize: 11, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3,
          }}>s</span>
        )}
      </div>
    </div>
  );

  // Inline phase legend so the user can match colors to names
  // without reading the bar segments.
  const Legend = () => (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10,
      font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
    }}>
      {PHASES.map(p => (
        <span key={p.key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2, background: p.color,
          }}/>
          {p.label}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 4 }}>
        WALL CONTACT · ADAPT → HAND → ROTATE → PUSH
      </div>
      <Bar row={a} height={32} opacity={1}    label="YOU"/>
      {b && <Bar row={b} height={24} opacity={0.85} label={compareLabel}/>}
      <Legend/>

      {/* Mini-KPI strip — 5 tiles: 4 phases + total */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 12, marginTop: 18,
      }}>
        <Mini label="Adapt"  value={a.adapt} color="var(--amber-eff)"/>
        <Mini label="Hand"   value={a.hand}  color="var(--signal-eff)"/>
        <Mini label="Rotate" value={a.rot}   color="var(--compare-eff)"/>
        <Mini label="Push"   value={a.push}  color="var(--lime-eff)"/>
        <Mini label="Total"  value={a.total} dec={2}/>
      </div>
    </div>
  );
};

// ── TurnFullVelocityProfile (v00.55) ──────────────────────────
// Continuous-line velocity profile across all 6 zones spanning
// 30 m of swimming through the wall. Replaces the v00.52
// TurnApproachDepartCard as the primary turn-velocity surface.
//
// Why continuous line beats split columns for this: the swim
// story is "what speed did you carry IN, how much did the wall
// take from you, what speed did you LEAVE with, and how steeply
// did the streamline decay after?" That story reads as one
// trajectory, not two. The wall annotation marks the gap —
// a vertical band between zones 3 (5-0 pre) and 4 (0-5 post)
// — so the user can see the velocity discontinuity (which is
// also where the push-off injection happens).
//
// Insight strip below the chart calls out:
//   - PEAK VELOCITY  (typically at 0-5 post, just after push-off)
//   - PUSH-OFF GAIN  (delta between 5-0 pre and 0-5 post —
//                    positive means push-off added speed beyond
//                    what the swimmer carried in)
const TurnFullVelocityProfile = ({ primary, compare }) => {
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  const ZONES = [
    { label: '15-10', col: 'avg_vel_15_10_pre', side: 'pre'  },
    { label: '10-5',  col: 'avg_vel_10_5_pre',  side: 'pre'  },
    { label: '5-0',   col: 'avg_vel_5_0_pre',   side: 'pre'  },
    { label: '0-5',   col: 'avg_vel_0_5',       side: 'post' },
    { label: '5-10',  col: 'avg_vel_5_10',      side: 'post' },
    { label: '10-15', col: 'avg_vel_10_15',     side: 'post' },
  ];

  const buildSeries = (t) => {
    if (!t) return [];
    return ZONES.map((z, i) => ({
      x: i, y: num(t, z.col), label: z.label, side: z.side,
    })).filter(p => p.y != null);
  };

  const seriesA = buildSeries(primary);
  const seriesB = compare ? buildSeries(compare) : [];

  if (!seriesA.length && !seriesB.length) {
    return (
      <ChartCard title="VELOCITY PROFILE · 15 M PRE → WALL → 15 M POST">
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                      padding: '22px 0', textAlign: 'center' }}>
          No velocity zones captured for this trial.
        </div>
      </ChartCard>
    );
  }

  // Domain — symmetric padding + headroom for labels above each
  // primary point.
  const xMax = ZONES.length - 1;
  const xMin = 0;
  const allY = [...seriesA, ...seriesB].map(p => p.y);
  const rawMax = Math.max(...allY);
  const rawMin = Math.min(...allY);
  const padY   = Math.max(0.1, (rawMax - rawMin) * 0.20);
  const yMax   = rawMax + padY;
  const yMin   = Math.max(0, rawMin - padY);

  // SVG layout — taller than usual to fit two-line x-axis labels
  // (zone range + side tag) without crowding.
  const W = 720, H = 270, PAD_L = 52, PAD_R = 24, PAD_T = 30, PAD_B = 60;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf = (i) => PAD_L + (i / xMax) * innerW;
  const yOf = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const baseY = H - PAD_B;

  // Wall position — between zones 2 (5-0 pre) and 3 (0-5 post).
  const wallX = xOf(2.5);
  const wallBandHalfWidth = 16;

  // Path helpers
  const linePath = (series) => series.length
    ? window.PA_SVG.smoothPath(series.map(p => [xOf(p.x), yOf(p.y)]))
    : '';

  // Filled area beneath the primary line. Reuses the smooth top
  // edge so the fill matches the line's shape exactly, then
  // closes to the baseline.
  const areaPath = (series) => {
    if (series.length < 2) return '';
    const top = window.PA_SVG.smoothPath(
      series.map(p => [xOf(p.x), yOf(p.y)])
    );
    const lastX  = xOf(series[series.length - 1].x);
    const firstX = xOf(series[0].x);
    return top
      + ' L' + lastX.toFixed(2) + ',' + baseY
      + ' L' + firstX.toFixed(2) + ',' + baseY
      + ' Z';
  };

  // Insights — peak point + push-off gain (5-0 pre → 0-5 post).
  const peak = seriesA.length
    ? seriesA.reduce((max, p) => p.y > max.y ? p : max, seriesA[0])
    : null;
  const preEnd = seriesA.find(p => p.x === 2);
  const postStart = seriesA.find(p => p.x === 3);
  const pushOffGain = (preEnd && postStart) ? +(postStart.y - preEnd.y).toFixed(2) : null;
  // Streamline decay = avg_vel_0_5 → avg_vel_10_15 (drop across
  // 15 m of post-wall swimming). Smaller decay = tighter
  // streamline.
  const postEnd = seriesA.find(p => p.x === 5);
  const streamlineDecay = (postStart && postEnd)
    ? +(postStart.y - postEnd.y).toFixed(2) : null;

  // v03.43 — compare-trial counterparts so each KPI tile can
  // show primary + compare + delta side by side (matching the
  // Starts mini-KPI pattern shipped at v03.23).
  const peakCmp = seriesB.length
    ? seriesB.reduce((max, p) => p.y > max.y ? p : max, seriesB[0])
    : null;
  const preEndCmp    = seriesB.find(p => p.x === 2);
  const postStartCmp = seriesB.find(p => p.x === 3);
  const postEndCmp   = seriesB.find(p => p.x === 5);
  const pushOffGainCmp = (preEndCmp && postStartCmp)
    ? +(postStartCmp.y - preEndCmp.y).toFixed(2) : null;
  const streamlineDecayCmp = (postStartCmp && postEndCmp)
    ? +(postStartCmp.y - postEndCmp.y).toFixed(2) : null;

  // Delta colour helper. `goodWhen` = 'higher' (peak/push-off
  // gain — primary faster than compare is good) OR 'lower'
  // (streamline decay — primary loses less velocity is good).
  const deltaColor = (d, goodWhen) => {
    if (d == null || d === 0) return 'var(--tx-md)';
    const better = goodWhen === 'higher' ? d > 0 : d < 0;
    return better ? 'var(--lime-eff)' : 'var(--flag-eff)';
  };
  const fmtDelta = (d) => d == null
    ? null
    : (d > 0 ? '+' : '') + d.toFixed(2);

  const yTicks = [yMax, (yMax + yMin) / 2, yMin];

  return (
    <ChartCard title="VELOCITY PROFILE · 15 M PRE → WALL → 15 M POST">
      <window.ChartScroll minWidth={W}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 320 }}>
        {/* Y gridlines */}
        {[0.25, 0.5, 0.75].map(f => {
          const y = PAD_T + f * innerH;
          return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                       stroke="var(--line-soft)" strokeDasharray="2 4"
                       strokeWidth="1" opacity="0.5"/>;
        })}
        {/* Wall band — tinted vertical column between pre and post */}
        <rect x={wallX - wallBandHalfWidth} y={PAD_T}
              width={wallBandHalfWidth * 2} height={innerH}
              fill="color-mix(in oklch, var(--compare-eff) 10%, transparent)"/>
        <line x1={wallX} y1={PAD_T} x2={wallX} y2={baseY}
              stroke="var(--compare-eff)" strokeWidth="1.5"
              strokeDasharray="4 4" opacity="0.75"/>
        <text x={wallX} y={PAD_T - 10}
              textAnchor="middle"
              fontSize="11" fontFamily="var(--font-mono)" fontWeight="700"
              fill="var(--compare-eff)" letterSpacing="0.1em">
          WALL
        </text>
        {/* X-axis baseline */}
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY}
              stroke="var(--line-soft)" strokeWidth="1"/>
        {/* Filled area beneath primary */}
        {seriesA.length > 1 && (
          <path d={areaPath(seriesA)}
                fill="var(--lime-eff)" opacity="0.10"/>
        )}
        {/* Compare line first so primary draws on top */}
        {seriesB.length > 0 && (
          <path d={linePath(seriesB)} fill="none"
                stroke="var(--compare-eff)" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"/>
        )}
        {/* Primary line */}
        <path d={linePath(seriesA)} fill="none"
              stroke="var(--lime-eff)" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round"/>
        {/* Per-zone dots — primary on top, compare below */}
        {seriesB.map((p, i) => (
          <circle key={'pb' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.4"
                  fill="var(--compare-eff)"/>
        ))}
        {seriesA.map((p, i) => (
          <circle key={'pa' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="4"
                  fill="var(--lime-eff)"/>
        ))}
        {/* PEAK marker — open ring around the primary peak point */}
        {peak && (
          <circle cx={xOf(peak.x)} cy={yOf(peak.y)} r="8"
                  fill="none" stroke="var(--lime-eff)"
                  strokeWidth="1.5" opacity="0.7"/>
        )}
        {/* Per-zone value labels — primary above, compare below
            (v00.50 anti-overlap rule: opposite y-offsets so labels
            don't collide when values are close). */}
        {seriesA.map((p, i) => (
          <text key={'la' + i} x={xOf(p.x)} y={yOf(p.y) - 12}
                textAnchor="middle"
                fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                fill="var(--lime-eff)">
            {p.y.toFixed(2)}
          </text>
        ))}
        {seriesB.map((p, i) => (
          <text key={'lb' + i} x={xOf(p.x)} y={yOf(p.y) + 16}
                textAnchor="middle"
                fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                fill="var(--compare-eff)">
            {p.y.toFixed(2)}
          </text>
        ))}
        {/* X-axis labels — two lines per tick: zone range + side tag */}
        {ZONES.map((z, i) => (
          <g key={'xl' + i}>
            <text x={xOf(i)} y={baseY + 16}
                  textAnchor="middle"
                  fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-md)">
              {z.label} m
            </text>
            <text x={xOf(i)} y={baseY + 30}
                  textAnchor="middle"
                  fontSize="9" fontFamily="var(--font-ui)" fill="var(--tx-lo)"
                  letterSpacing="0.06em">
              {z.side.toUpperCase()}
            </text>
          </g>
        ))}
        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={'yt' + i} x={PAD_L - 8} y={yOf(v) + 3}
                textAnchor="end"
                fontSize="10" fontFamily="var(--font-mono)" fill="var(--tx-lo)">
            {v.toFixed(2)} m/s
          </text>
        ))}
        {/* v03.71 — hover/tap value tooltip per zone. dataX is the
            zone label (e.g. "5-0") since the x-axis is zone index. */}
        {window.ChartHoverLayer && (
          <window.ChartHoverLayer
            pointsA={seriesA.map(p => ({ cx: xOf(p.x), cy: yOf(p.y), dataX: p.label, dataY: p.y }))}
            pointsB={seriesB.map(p => ({ cx: xOf(p.x), cy: yOf(p.y), dataX: p.label, dataY: p.y }))}
            colorA="var(--lime-eff)" colorB="var(--compare-eff)"
            fmt={(v) => v.toFixed(2)} unit=" m/s" xUnit=" m"
            geom={{ W, PAD_L, PAD_R, PAD_T }}/>
        )}
      </svg>
      </window.ChartScroll>

      {/* Insight strip — three coaching-relevant readings derived
          from the chart shape. Renders only when the relevant data
          exists. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 18,
        marginTop: 14,
        paddingTop: 14,
        borderTop: '1px solid var(--line-soft)',
      }}>
        {peak && (() => {
          const dPeak = (peakCmp != null) ? +(peak.y - peakCmp.y).toFixed(2) : null;
          return (
          <div>
            <div className="eyebrow" style={{
              fontSize: 9, color: 'var(--tx-lo)', letterSpacing: 0.08,
            }}>
              PEAK VELOCITY
            </div>
            <div style={{
              font: '700 18px var(--font-mono)',
              color: 'var(--lime-eff)', marginTop: 4,
            }}>
              {peak.y.toFixed(2)}
              <span style={{
                fontSize: 11, color: 'var(--tx-lo)',
                fontWeight: 500, marginLeft: 3,
              }}>m/s</span>
            </div>
            {peakCmp != null && (
              <div style={{
                font: '700 13px var(--font-mono)',
                color: 'var(--compare-eff)', marginTop: 2,
              }}>
                {peakCmp.y.toFixed(2)}
                <span style={{
                  fontSize: 10, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            {dPeak != null && (
              <div style={{
                font: '700 11px var(--font-mono)',
                color: deltaColor(dPeak, 'higher'), marginTop: 2,
              }}>
                {fmtDelta(dPeak)}
                <span style={{
                  fontSize: 9, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              marginTop: 3,
            }}>
              at {peak.label} m {peak.side}
            </div>
          </div>
          );
        })()}
        {pushOffGain != null && (() => {
          const dGain = (pushOffGainCmp != null) ? +(pushOffGain - pushOffGainCmp).toFixed(2) : null;
          return (
          <div>
            <div className="eyebrow" style={{
              fontSize: 9, color: 'var(--tx-lo)', letterSpacing: 0.08,
            }}>
              PUSH-OFF GAIN
            </div>
            <div style={{
              font: '700 18px var(--font-mono)',
              color: pushOffGain > 0 ? 'var(--lime-eff)' : 'var(--flag-eff)',
              marginTop: 4,
            }}>
              {(pushOffGain > 0 ? '+' : '') + pushOffGain.toFixed(2)}
              <span style={{
                fontSize: 11, color: 'var(--tx-lo)',
                fontWeight: 500, marginLeft: 3,
              }}>m/s</span>
            </div>
            {pushOffGainCmp != null && (
              <div style={{
                font: '700 13px var(--font-mono)',
                color: 'var(--compare-eff)', marginTop: 2,
              }}>
                {(pushOffGainCmp > 0 ? '+' : '') + pushOffGainCmp.toFixed(2)}
                <span style={{
                  fontSize: 10, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            {dGain != null && (
              <div style={{
                font: '700 11px var(--font-mono)',
                color: deltaColor(dGain, 'higher'), marginTop: 2,
              }}>
                {fmtDelta(dGain)}
                <span style={{
                  fontSize: 9, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              marginTop: 3,
            }}>
              vs approach into wall
            </div>
          </div>
          );
        })()}
        {streamlineDecay != null && (() => {
          // Both decays are stored as positive numbers (postStart - postEnd);
          // displayed as negative (a velocity LOSS) in the UI. For the delta,
          // compare the raw decay magnitudes: less decay (lower value) is
          // better. d = primary - compare; d < 0 means primary lost less.
          const dDecay = (streamlineDecayCmp != null) ? +(streamlineDecay - streamlineDecayCmp).toFixed(2) : null;
          return (
          <div>
            <div className="eyebrow" style={{
              fontSize: 9, color: 'var(--tx-lo)', letterSpacing: 0.08,
            }}>
              STREAMLINE DECAY
            </div>
            <div style={{
              font: '700 18px var(--font-mono)',
              color: streamlineDecay < 0.3 ? 'var(--lime-eff)'
                   : streamlineDecay < 0.6 ? 'var(--signal-eff)'
                                            : 'var(--flag-eff)',
              marginTop: 4,
            }}>
              −{Math.abs(streamlineDecay).toFixed(2)}
              <span style={{
                fontSize: 11, color: 'var(--tx-lo)',
                fontWeight: 500, marginLeft: 3,
              }}>m/s</span>
            </div>
            {streamlineDecayCmp != null && (
              <div style={{
                font: '700 13px var(--font-mono)',
                color: 'var(--compare-eff)', marginTop: 2,
              }}>
                −{Math.abs(streamlineDecayCmp).toFixed(2)}
                <span style={{
                  fontSize: 10, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            {dDecay != null && (
              <div style={{
                font: '700 11px var(--font-mono)',
                color: deltaColor(dDecay, 'lower'), marginTop: 2,
              }}>
                {fmtDelta(dDecay)}
                <span style={{
                  fontSize: 9, color: 'var(--tx-lo)',
                  fontWeight: 500, marginLeft: 3,
                }}>m/s</span>
              </div>
            )}
            <div style={{
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
              marginTop: 3,
            }}>
              0–5 m → 10–15 m post
            </div>
          </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap',
        font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 2, background: 'var(--lime-eff)' }}/>
          Primary
        </span>
        {seriesB.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 2, background: 'var(--compare-eff)' }}/>
            Compare
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 12, height: 12, borderRadius: '50%',
            border: '1.5px solid var(--lime-eff)',
            background: 'transparent',
          }}/>
          Peak
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 0, height: 12, borderLeft: '2px dashed var(--compare-eff)' }}/>
          Wall
        </span>
      </div>
    </ChartCard>
  );
};

// ── TurnApproachDepartCard (v00.52, DORMANT v00.55) ───────────
// Replaced by TurnFullVelocityProfile above. The continuous-line
// across-the-wall narrative reads better for the velocity story
// than the side-by-side two-column bar layout did. Component
// kept in the file for reference / quick rollback. No caller.
// Hero visualization for the Turns detail page, ported from the
// design-reference TurnsPage. Two-column card showing the
// velocity profile across the 6 zones that span a turn:
//
//   APPROACH (left)  · 15-10 m → 10-5 m → 5-0 m  (closing on wall)
//   DEPARTURE (right) · 0-5 m  → 5-10 m → 10-15 m (leaving wall)
//
// Each column has a headline number (the closest-to-wall zone —
// 5-0 m for approach, 0-5 m for departure), an optional time-delta
// vs compare for the 5 m segment, and three horizontal bars showing
// each zone's velocity normalized to the peak across both columns.
//
// Compare overlay: a thinner secondary bar in compare-eff under
// each primary bar. Same convention as LapBars / RaceCompareBars.
//
// Responsive: at narrow widths the two columns stack 1-col so
// nothing crowds. Vertical divider only renders when side-by-side.
const TurnApproachDepartCard = ({ primary, compare }) => {
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  // Zone column maps. Live `v_turn_kpis` exposes pre-turn zones
  // with `_pre` suffix and post-turn zones without — keep the
  // mapping declarative so it's easy to refactor if the view
  // changes.
  const APPROACH = [
    { label: '15-10 m', col: 'avg_vel_15_10_pre' },
    { label: '10-5 m',  col: 'avg_vel_10_5_pre'  },
    { label: '5-0 m',   col: 'avg_vel_5_0_pre'   },
  ];
  const DEPARTURE = [
    { label: '0-5 m',   col: 'avg_vel_0_5'   },
    { label: '5-10 m',  col: 'avg_vel_5_10'  },
    { label: '10-15 m', col: 'avg_vel_10_15' },
  ];

  const zonesFor = (t, defs) => defs.map(d => ({
    label: d.label,
    v: num(t, d.col),
  }));

  const apA = zonesFor(primary,  APPROACH);
  const apB = compare ? zonesFor(compare, APPROACH) : APPROACH.map(d => ({ label: d.label, v: null }));
  const dpA = zonesFor(primary,  DEPARTURE);
  const dpB = compare ? zonesFor(compare, DEPARTURE) : DEPARTURE.map(d => ({ label: d.label, v: null }));

  // If neither approach nor departure has any data → empty state.
  const allVels = [...apA, ...apB, ...dpA, ...dpB].map(z => z.v).filter(v => v != null);
  if (!allVels.length) {
    return (
      <ChartCard title="VELOCITY · APPROACH ↔ DEPARTURE">
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                      padding: '18px 0', textAlign: 'center' }}>
          No approach / departure velocity zones captured for this trial.
        </div>
      </ChartCard>
    );
  }
  const peak = Math.max(...allVels);

  // Headline velocities — the closest-to-wall zones in each phase.
  const apHead    = apA[apA.length - 1]?.v;
  const dpHead    = dpA[0]?.v;
  const apHeadCmp = apB[apB.length - 1]?.v;
  const dpHeadCmp = dpB[0]?.v;

  // Time delta for the 5 m segment vs compare. Faster velocity
  // = lower segment time, so the delta sign aligns with the
  // direction we want.
  const segTimeDelta = (vp, vc) => {
    if (vp == null || vc == null || vp <= 0 || vc <= 0) return null;
    return +(5 / vp - 5 / vc).toFixed(2);
  };
  const apDelta = segTimeDelta(apHead, apHeadCmp);
  const dpDelta = segTimeDelta(dpHead, dpHeadCmp);

  // Render one column.
  const Column = ({ eyebrow, head, delta, zones, zonesCmp }) => {
    const tone = delta == null || delta === 0
      ? 'var(--tx-lo)'
      : (delta < 0 ? 'var(--lime-eff)' : 'var(--flag-eff)');

    return (
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{
          marginBottom: 6, color: 'var(--tx-lo)',
          letterSpacing: 0.08, fontSize: 10,
        }}>
          {eyebrow}
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 12,
          marginBottom: 14, flexWrap: 'wrap',
        }}>
          <span style={{
            font: '700 28px var(--font-mono)', color: 'var(--tx-hi)',
            letterSpacing: '-0.01em',
          }}>
            {head != null ? head.toFixed(2) : '—'}
            {head != null && (
              <span style={{
                fontSize: 13, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 4,
              }}>m/s</span>
            )}
          </span>
          {delta != null && (
            <span className="mono" style={{
              fontSize: 12, fontWeight: 700, color: tone,
            }}>
              {(delta > 0 ? '+' : '') + delta.toFixed(2)} s · 5 m
            </span>
          )}
        </div>

        {/* Per-zone bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {zones.map((z, i) => {
            const cmp = zonesCmp[i];
            const isPeak = z.v != null && Math.abs(z.v - peak) < 1e-6;
            return (
              <div key={i}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
                  marginBottom: 3,
                }}>
                  <span>
                    {z.label}
                    {isPeak && (
                      <span style={{ color: 'var(--lime-eff)', marginLeft: 6,
                                     fontWeight: 700, fontSize: 10,
                                     letterSpacing: 0.06 }}>
                        · PEAK
                      </span>
                    )}
                  </span>
                  <span className="mono" style={{ color: 'var(--tx-hi)', fontWeight: 700 }}>
                    {z.v != null ? z.v.toFixed(2) : '—'}
                  </span>
                </div>
                {/* Primary bar */}
                <div style={{ height: 8, background: 'var(--bg-3)', borderRadius: 4 }}>
                  {z.v != null && (
                    <div style={{
                      height: '100%', width: ((z.v / peak) * 100) + '%',
                      background: 'var(--lime-eff)', borderRadius: 4,
                    }}/>
                  )}
                </div>
                {/* Compare bar — thinner, beneath, in compare-eff */}
                {cmp && cmp.v != null && (
                  <div style={{ height: 6, background: 'var(--bg-3)',
                                borderRadius: 4, marginTop: 3 }}>
                    <div style={{
                      height: '100%', width: ((cmp.v / peak) * 100) + '%',
                      background: 'var(--compare-eff)', borderRadius: 4,
                    }}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <ChartCard title="VELOCITY · APPROACH ↔ DEPARTURE">
      <div style={{
        display: 'grid',
        // 2-col when wide; stacks to 1-col below ~600 px so the
        // bars stay readable on mobile.
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 32,
      }}>
        <Column
          eyebrow="APPROACH · LAST 5 M"
          head={apHead}
          delta={apDelta}
          zones={apA}
          zonesCmp={apB}/>
        <Column
          eyebrow="DEPARTURE · FIRST 5 M"
          head={dpHead}
          delta={dpDelta}
          zones={dpA}
          zonesCmp={dpB}/>
      </div>
      {/* Compact legend so the user can read the two-tone bars. */}
      <div style={{
        display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap',
        font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 6, background: 'var(--lime-eff)', borderRadius: 3 }}/>
          Primary
        </span>
        {compare && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 4, background: 'var(--compare-eff)', borderRadius: 3 }}/>
            Compare
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--tx-lo)', fontSize: 11 }}>
          Bars normalized to peak across all 6 zones
        </span>
      </div>
    </ChartCard>
  );
};

// ── TurnDetail — composition mirrors StartDetail ──────────────
const TurnDetail = ({ primary, compare, diff, story, phases, items, phase, onChangePhase, trials, isPro, onUpgrade }) => (
  <React.Fragment>
    {/* v03.72 — inline rename control for this turn trial */}
    {primary && window.TrialNameEditor && (
      <div style={{ marginBottom: 4 }}>
        <window.TrialNameEditor kind="turn" trial={primary}
          title={window.PA_TURNS.turnTitle(primary)}/>
      </div>
    )}
    {story && (
      <Headline
        eyebrow={story.eyebrow}
        title={story.titleNode}
        sub={story.sub}
        right={story.rightChip}
      />
    )}

    <PhaseTimeline phases={phases} active={phase} onChange={onChangePhase}/>

    <MetricGrid items={items} cols={items.length || 'auto'}/>

    {/* Hero visualization — Full Velocity Profile across all 6
        zones with WALL annotation. v00.55 replaces the v00.52
        TurnApproachDepartCard (kept in file as DORMANT). The
        continuous line tells the speed-in / push-off-gain /
        streamline-decay story in one trace. */}
    <TurnFullVelocityProfile primary={primary} compare={compare}/>

    <TurnPhaseDetail phase={phase} primary={primary} compare={compare}/>

    <TurnLast8Sessions primary={primary} trials={trials}/>

    {/* v01.18 — Turn video with switcher / Pro gate / download. */}
    <VideoCard
      title={'TURN VIDEO · ' + (window.PA_TURNS.turnTitle(primary) || '').toUpperCase()}
      hint="approach to breakout"
      videoKey={primary?.video_key}
      athleteUuid={primary?.athlete_uuid}
      compareVideoKey={compare?.video_key}
      compareAthleteUuid={compare?.athlete_uuid}
      compareIsBenchmark={compare?._benchmarkKind === 'WR'}
      compareLabel={
        compare?._benchmarkKind === 'PB'     ? 'Personal best' :
        compare?._benchmarkKind === 'MEDIAN' ? 'Median race'   :
        compare?._benchmarkKind === 'WR'     ? 'World record'  :
        'Compare'
      }
      /* v03.44 / v03.47 — Save-to-Library wiring. v_turn_kpis
         doesn't expose turn_uuid (kpis.js has dead code that
         references it); record_uuid is the universal trial id. */
      trialKind="turn"
      primaryTrialUuid={primary?.record_uuid}
      primaryTeamUuid={primary?.team_uuid}
      primaryTrialDate={primary?.source_date}
      primaryTrialTitle={window.PA_TURNS.turnTitle(primary)}
      compareTrialUuid={compare && !compare._benchmarkKind ? compare.record_uuid : null}
      compareTeamUuid={compare?.team_uuid}
      compareTrialDate={compare?.source_date}
      compareTrialTitle={compare && !compare._benchmarkKind ? window.PA_TURNS.turnTitle(compare) : null}
      /* v03.58 — notified_at flows in from the trial row so the
         NotifyAthleteButton can show its sent state. */
      primaryNotifiedAt={primary?.notified_at}
      compareNotifiedAt={compare && !compare._benchmarkKind ? compare.notified_at : null}
      isPro={isPro}
      onUpgrade={onUpgrade}
    />
  </React.Fragment>
);

// ── TurnPhaseHero (v03.01, node-sentence v03.10) ──────────────
// Sentence-style hero for the four Turn phase tabs (Approach /
// Wall / Underwater / Breakout). v03.10 — `sentence` is a fully
// pre-colored React node (primary numbers green, compare numbers
// purple), built by buildTurnPhaseStory. The hero just renders
// it — no substring highlight matching anymore.
const TurnPhaseHero = ({ sentence, subtext }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  if (!sentence) {
    return (
      <div style={{
        padding: 18, borderRadius: 12,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
        textAlign: 'center', marginBottom: 14,
      }}>
        Headline unavailable for this phase.
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="display" style={{
        fontSize: isMobile ? 22 : 28,
        lineHeight: 1.2, color: 'var(--tx-hi)',
        letterSpacing: '-0.02em', maxWidth: 620,
      }}>
        {sentence}
      </div>
      {subtext && (
        <p style={{
          font: '500 14px/1.5 var(--font-ui)',
          color: 'var(--tx-md)', maxWidth: 580, margin: 0,
        }}>
          {subtext}
        </p>
      )}
    </div>
  );
};

// ── TurnPhaseDetail — per-phase rows table ────────────────────
// v00.51 v1 ships rows tables only. Per-phase visuals
// (approach/depart velocity bars, push-off arc) land in v00.52+.
// v03.01 — Added TurnPhaseHero above the rows table for all four
// phase tabs. Matches the PhaseHero pattern Starts uses for
// Underwater + Surface, closing a long-standing parity gap.
//
// HelpDot tooltips on each row label (v00.43 pattern).
const TurnPhaseDetail = ({ phase, primary, compare }) => {
  const ranges = {
    Approach:   'ENTRY → WALL',
    Wall:       'PLANT → PUSH-OFF',
    Underwater: 'PUSH-OFF → BREAKOUT',
    Breakout:   '5 m → 15 m',
  };
  const name = phase || 'Approach';
  const num = (t, col) => {
    if (!t) return null;
    const v = t[col];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  // Derive 5-in to 15-out time (post-turn from 5 m to 15 m past
  // the wall) when the explicit column isn't populated. Uses
  // 5in_5out + (15in_15out - 10) which is approximate.
  const derived5to15 = (t) => {
    const t1515 = num(t, 'time_15in_15out_s');
    const t5out = num(t, 'time_5in_5out_s');
    if (t1515 == null || t5out == null) return null;
    // 15-in/15-out = 15-in to wall + wall to 15-out. We don't have
    // the split directly, so this is a rough breakout proxy.
    return null;
  };

  const rowsByPhase = {
    Approach: [
      { k: 'Stroke rate (pre)', p: num(primary, 'stroke_rate_pre_turn'), c: num(compare, 'stroke_rate_pre_turn'), u: '/min', dec: 1, dir: 'higher',
        tip: 'Stroke rate measured in the last few meters before the wall plant.' },
      { k: 'Vel 15-10 m',        p: num(primary, 'avg_vel_15_10_pre'),    c: num(compare, 'avg_vel_15_10_pre'),    u: 'm/s',  dec: 2, dir: 'higher',
        tip: 'Average velocity from 15 m before the wall to 10 m before the wall.' },
      { k: 'Vel 10-5 m',         p: num(primary, 'avg_vel_10_5_pre'),     c: num(compare, 'avg_vel_10_5_pre'),     u: 'm/s',  dec: 2, dir: 'higher',
        tip: 'Average velocity from 10 m before the wall to 5 m before the wall.' },
      { k: 'Vel 5-0 m',          p: num(primary, 'avg_vel_5_0_pre'),      c: num(compare, 'avg_vel_5_0_pre'),      u: 'm/s',  dec: 2, dir: 'higher',
        tip: 'Average velocity from 5 m before the wall to the wall itself.' },
    ],
    Wall: (() => {
      // v03.01 — Derived "Push-off gain" replaces the dead
      // push_off_velocity column (Templo importer doesn't populate
      // it). Matches the metric the chart hero calls PUSH-OFF GAIN.
      const pushOffGain = (t) => {
        const pre  = num(t, 'avg_vel_5_0_pre');
        const post = num(t, 'avg_vel_0_5');
        return (pre != null && post != null) ? +(post - pre).toFixed(2) : null;
      };
      return [
        { k: '5-in / 5-out',  p: num(primary, 'time_5in_5out_s'), c: num(compare, 'time_5in_5out_s'), u: 's',   dec: 2, dir: 'lower',
          tip: 'Time window 5 m before the wall to 5 m after — the tight wall-plant + push-off measurement.' },
        { k: 'Push-off gain', p: pushOffGain(primary),            c: pushOffGain(compare),            u: 'm/s', dec: 2, dir: 'higher',
          tip: 'Velocity difference between the 5 m before wall and the 5 m after wall. Positive = push-off added speed beyond what you carried in.' },
      ];
    })(),
    Underwater: [
      { k: 'Kick rate',          p: num(primary, 'kick_rate'),            c: num(compare, 'kick_rate'),            u: '/min', dec: 1, dir: 'higher',
        tip: 'Underwater kicks per minute between push-off and surface break.' },
      { k: 'Surface break',      p: num(primary, 'surface_break_s'),      c: num(compare, 'surface_break_s'),      u: 's',    dec: 2, dir: 'lower',
        tip: 'Time from push-off to head breaking the water surface.' },
    ],
    Breakout: [
      { k: 'Stroke rate (post)', p: num(primary, 'stroke_rate_post_turn'), c: num(compare, 'stroke_rate_post_turn'), u: '/min', dec: 1, dir: 'higher',
        tip: 'Stroke rate after the breakout, swimming back to 15 m.' },
      { k: '5-in / 15-out',      p: num(primary, 'time_5in_15out_s'),     c: num(compare, 'time_5in_15out_s'),     u: 's',    dec: 2, dir: 'lower',
        tip: 'Time from 5 m before the wall to 15 m after. Captures wall + breakout phases together.' },
      { k: '15-in / 15-out',     p: num(primary, 'time_15in_15out_s'),    c: num(compare, 'time_15in_15out_s'),    u: 's',    dec: 2, dir: 'lower',
        tip: 'Full canonical turn time — 15 m before to 15 m after the wall.' },
    ],
  };
  const rows = rowsByPhase[name] || [];
  const showCompare = !!compare;

  const fmtVal = (v, dec, u) => v == null ? '—' : (v.toFixed(dec) + (u ? ' ' + u : ''));
  const fmtDelta = (a, b, dec, dir) => {
    if (a == null || b == null) return null;
    const raw = +(a - b).toFixed(dec);
    const label = raw === 0 ? '±0' : ((raw > 0 ? '+' : '') + raw.toFixed(dec));
    let color = 'var(--tx-md)';
    if (raw !== 0 && dir === 'lower')  color = raw < 0 ? 'var(--lime-eff)' : 'var(--flag-eff)';
    if (raw !== 0 && dir === 'higher') color = raw > 0 ? 'var(--lime-eff)' : 'var(--flag-eff)';
    return { label, color };
  };

  const cellLabel = { padding: '12px 8px', font: '500 13px var(--font-ui)', color: 'var(--tx-md)', verticalAlign: 'top' };
  const cellNum   = { padding: '12px 8px', textAlign: 'right', verticalAlign: 'top' };
  const valStyle  = { fontSize: 14, fontWeight: 600, color: 'var(--tx-hi)', fontFamily: 'var(--font-mono)' };
  const cmpStyle  = { display: 'block', marginTop: 2, fontSize: 14, fontWeight: 600, color: 'var(--compare-eff)', fontFamily: 'var(--font-mono)' };
  const dStyleBase= { display: 'block', marginTop: 2, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' };

  const showWallContactBar = name === 'Wall';

  // v03.01 — Per-phase hero sentence (parity with Starts'
  // PhaseHero for Underwater + Surface). Lands first inside the
  // ChartCard so the narrative reads before the supporting
  // visual and rows.
  const phaseStory = (() => {
    const builder = window.PA_TURNS && window.PA_TURNS.buildTurnPhaseStory;
    if (!builder) return null;
    try { return builder(name, primary, compare); }
    catch (_) { return null; }
  })();

  return (
    <ChartCard title={(name + ' · ' + (ranges[name] || '')).toUpperCase()}>
      {phaseStory && (
        <TurnPhaseHero {...phaseStory}/>
      )}
      {showWallContactBar && (
        <div style={{ marginBottom: 18 }}>
          <TurnWallContactBar primary={primary} compare={compare}/>
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                      padding: '14px 0', textAlign: 'center' }}>
          No {name.toLowerCase()} data available.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(r => {
              const d = showCompare ? fmtDelta(r.p, r.c, r.dec, r.dir) : null;
              const HelpDot = window.HelpDot;
              return (
                <tr key={r.k} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  <td style={cellLabel}>
                    {r.k}
                    {r.tip && HelpDot && <HelpDot text={r.tip}/>}
                  </td>
                  <td style={cellNum}>
                    <span style={valStyle}>{fmtVal(r.p, r.dec, r.u)}</span>
                    {showCompare && (
                      <span style={cmpStyle}>{fmtVal(r.c, r.dec, r.u)}</span>
                    )}
                    {d && (
                      <span style={{ ...dStyleBase, color: d.color }}>{d.label}{r.u ? ' ' + r.u : ''}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ChartCard>
  );
};

// ── TurnLast8Sessions — last 8 same-stroke turns by 15-in/15-out
// Mirrors web-starts.jsx Last8Sessions but keyed on
// time_15in_15out_s instead of split_15m_s.
const TurnLast8Sessions = ({ primary, trials }) => {
  if (!primary || !trials || !trials.length) return null;

  const num = (v) => (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  const styleOf = (t) => {
    const mj = (t && (t.mj || t.metrics_json)) || {};
    return String(t.style || mj.Style || mj.style || '').toLowerCase();
  };

  const primaryStroke = styleOf(primary);
  const primaryKey    = window.PA_TURNS && window.PA_TURNS.trialKey
                        ? window.PA_TURNS.trialKey(primary)
                        : null;

  const candidates = trials.filter(t =>
    styleOf(t) === primaryStroke &&
    num(t.time_15in_15out_s) != null &&
    !!t.source_date
  );
  candidates.sort((a, b) => String(a.source_date).localeCompare(String(b.source_date)));

  if (!candidates.length) {
    return (
      <div style={{
        padding: 22, borderRadius: 14,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        color: 'var(--tx-lo)', font: '500 13px var(--font-ui)',
      }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>15-IN / 15-OUT · LAST 8 SESSIONS</div>
        <div>Not enough same-stroke turns with a 15-in/15-out time to draw a trend.</div>
      </div>
    );
  }

  const last8 = candidates.slice(-8);
  const isPrimaryBar = (t) => window.PA_TURNS.trialKey(t) === primaryKey;

  const values = last8.map(t => num(t.time_15in_15out_s));
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const pad    = Math.max(0.05, (rawMax - rawMin) * 0.18);
  const yMax   = rawMax + pad;
  const yMin   = Math.max(0, rawMin - pad);

  const narrative = (() => {
    const todayV = num(primary.time_15in_15out_s);
    if (todayV == null) return null;
    const isToday = (v) => Math.abs(v - todayV) < 1e-6;
    if (isToday(rawMin)) {
      return <>You're trending down — <span style={{ color: 'var(--lime-eff)' }}>today is your best</span>.</>;
    }
    if (last8.length >= 4) {
      const half = Math.floor(last8.length / 2);
      const olderAvg  = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const recentAvg = values.slice(-half).reduce((a, b) => a + b, 0) / half;
      const delta = +(recentAvg - olderAvg).toFixed(2);
      if (delta < -0.05) {
        return <>Trending down — <span style={{ color: 'var(--lime-eff)' }}>recent turns are faster</span>.</>;
      }
      if (delta > 0.05) {
        return <>Trending up — <span style={{ color: 'var(--flag-eff)' }}>recent turns are slower</span>.</>;
      }
    }
    const span = +(rawMax - rawMin).toFixed(2);
    return <>Holding within <span style={{ color: 'var(--lime-eff)' }}>{span.toFixed(2)} s</span> across last {last8.length} turns.</>;
  })();

  const W = 480, H = 200, PAD_L = 28, PAD_R = 16, PAD_T = 26, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const slot   = innerW / last8.length;
  const barW   = Math.max(18, slot * 0.62);
  const yOf    = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;
  const xOf    = (i) => PAD_L + slot * (i + 0.5);

  return (
    <div style={{
      padding: 22, borderRadius: 14,
      background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 14, gap: 18 }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 4 }}>
            15-IN / 15-OUT · LAST {last8.length} SESSIONS
          </div>
          <div className="display" style={{
            fontSize: 18, lineHeight: 1.3, letterSpacing: '-0.015em',
            color: 'var(--tx-hi)', maxWidth: 480,
          }}>
            {narrative}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--tx-lo)' }}>
          {primaryStroke || 'all'} · same stroke
        </div>
      </div>
      <window.ChartScroll minWidth={W}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 240 }}>
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B}
              stroke="var(--line-soft)" strokeWidth="1"/>
        {last8.map((t, i) => {
          const v       = num(t.time_15in_15out_s);
          const isToday = isPrimaryBar(t);
          const barH    = (H - PAD_B) - yOf(v);
          const x       = xOf(i) - barW / 2;
          const fill    = isToday ? 'var(--lime-eff)' : 'var(--bg-3)';
          const stroke  = isToday ? 'none' : 'var(--line)';
          return (
            <g key={i}>
              <rect x={x} y={yOf(v)} width={barW} height={barH} rx={3}
                    fill={fill} stroke={stroke} strokeWidth="1"/>
              <text x={xOf(i)} y={yOf(v) - 6}
                    fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                    fill={isToday ? 'var(--lime-eff)' : 'var(--tx-md)'}
                    textAnchor="middle">
                {v.toFixed(2)}
              </text>
              {isToday && (
                <text x={xOf(i)} y={H - PAD_B + 16}
                      fontSize="9" fontFamily="var(--font-mono)" fontWeight="700"
                      fill="var(--lime-eff)" textAnchor="middle"
                      letterSpacing="0.08em">
                  TODAY
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </window.ChartScroll>
    </div>
  );
};

window.WebTurns = WebTurns;
window.WebTeamTurns = WebTeamTurns;

try { console.log('[web-turns] loaded (v01.52)'); } catch (_) {}
