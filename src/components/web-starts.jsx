/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Starts — analysis page (v00.20, Option D: slots + unified pane)

   Flow (mirrors Races):
     1. Fetch all start trials for the athlete (RLS-filtered).
     2. Build filter options from the returned set.
     3. User clicks a row → assigns to slotA (or slotB if A is set).
     4. DetailPane renders single-trial or compare view based on
        slotB state (null | another-trial-key | 'PB' | 'MEDIAN').

   Hero sentence (Headline) highlights Time to 15 m. In compare
   mode, buildStartStory swaps the title color + appends a verdict
   (e.g. "−0.12 s ahead of your median.") and the sub-line calls
   out the biggest gain / watch metric.

   Layout inside the detail column (top → bottom):
     Headline · PhaseTimeline · MetricGrid (Δ-tiles) ·
     reserved velocity/progression slot · VideoCard (last)

   Phase-1 contract: READ-ONLY. No writes, no edge functions,
   no signed video URLs yet.
   ─────────────────────────────────────────────────────────── */

const {
  useState:  useStartsState,
  useEffect: useStartsEffect,
  useMemo:   useStartsMemo,
} = React;

// v00.81 — full WebTeamStarts using the shared TeamBrowsePage
// from web-races.jsx (window.PA_TEAMUI.TeamBrowsePage). Browse
// mode only; cross-athlete compare for Starts is deferred until
// StartDetail's prop shape is reworked to accept arbitrary
// trial pairs.
const StartsTeamSummary = ({ rows }) => {
  // rows = v_start_kpis rows for one athlete
  if (!rows || !rows.length) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-md)' }}>
        No starts yet
      </div>
    );
  }
  // Pick best (lowest) split_15m_s across rows
  let best = null;
  let latest = null;
  rows.forEach(r => {
    const v = parseFloat(r.split_15m_s);
    if (!isNaN(v) && (best == null || v < best)) best = v;
    if (!latest || (r.source_date || '') > (latest.source_date || '')) latest = r;
  });
  const reaction = latest && parseFloat(latest.reaction_time_s);
  return (
    <div style={{
      font: '500 12px var(--font-ui)', color: 'var(--tx-md)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
      }}>
        <span>Best 15 m</span>
        <span className="mono" style={{
          font: '700 13px var(--font-mono)', color: 'var(--tx-hi)',
          letterSpacing: '-0.01em',
        }}>
          {best != null ? best.toFixed(2) + ' s' : '—'}
        </span>
      </div>
      {reaction != null && !isNaN(reaction) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
          color: 'var(--tx-lo)',
        }}>
          <span>Reaction (last)</span>
          <span className="mono" style={{
            fontSize: 11, color: 'var(--tx-lo)',
          }}>{reaction.toFixed(2)} s</span>
        </div>
      )}
    </div>
  );
};

// v00.82 — cross-athlete detail render for Starts. Mirrors what
// the per-athlete WebStarts builds (story / phases / items /
// applyDeltas) so StartDetail gets the full prop bundle it
// expects, even with primary + compare from different athletes.
const StartsCompareDetail = ({ primary, compare }) => {
  const [phase, setPhase] = useStartsState('Block');
  if (!primary || !compare) return null;
  const PA_S  = window.PA_STARTS;
  const PA_SC = window.PA_STARTS_COMPARE;
  if (!PA_S || !PA_SC) return null;
  const diff    = PA_SC.diffStarts(primary, compare);
  const phases  = PA_S.phaseSpans(primary);
  let items     = PA_S.metricItems(primary);
  if (diff) items = PA_SC.applyDeltas(items, diff);
  // Cross-athlete bests across just the two trials available.
  items = PA_SC.applyBests(items, [primary, compare], primary);
  const story   = PA_S.buildStartStory(primary, compare);
  return <StartDetail
    primary={primary} compare={compare} diff={diff}
    story={story} phases={phases} items={items}
    phase={phase} onChangePhase={setPhase}
    trials={[primary, compare]}/>;
};

const formatStartTrial = (r) => {
  const d = (() => {
    if (!r.source_date) return '—';
    const dt = new Date(r.source_date);
    return isNaN(dt) ? r.source_date
      : dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  })();
  const t = parseFloat(r.split_15m_s);
  const tStr = !isNaN(t) ? t.toFixed(2) + ' s' : '—';
  const rt = parseFloat(r.reaction_time_s);
  const rtStr = !isNaN(rt) ? ' · RT ' + rt.toFixed(2) : '';
  return d + ' · 15 m ' + tStr + rtStr;
};

const fetchFullStartTrial = async (slot) => {
  if (!window.PA_STARTS || !window.PA_STARTS.listStartTrials) {
    throw new Error('Slot: PA_STARTS not loaded');
  }
  const { data, error } = await window.PA_STARTS.listStartTrials(
    slot.athlete_uuid, { limit: 200 }
  );
  if (error) throw new Error('Slot: ' + (error.message || 'query error'));
  const rows = data || [];
  if (!rows.length) throw new Error('Slot: no start trials for athlete');
  // Match by date first, then closest split_15m_s.
  const slotDay = String(slot.source_date || '').slice(0, 10);
  let cands = rows.filter(r =>
    String(r.source_date || '').slice(0, 10) === slotDay);
  if (!cands.length) cands = rows;
  const target = parseFloat(slot.split_15m_s);
  if (!isFinite(target)) return cands[0];
  let best = cands[0];
  let bestDiff = Math.abs((parseFloat(best.split_15m_s) || Infinity) - target);
  cands.forEach(c => {
    const d = Math.abs((parseFloat(c.split_15m_s) || Infinity) - target);
    if (d < bestDiff) { best = c; bestDiff = d; }
  });
  return best;
};

const WebTeamStarts = ({ profile, onPickAthlete, isPro, onUpgrade }) => {
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
    heroLabel="STARTS"
    heroNoun="start"
    modalityView="v_start_kpis"
    modalitySelect="athlete_uuid, split_15m_s, reaction_time_s, source_date"
    summaryFor={(a, rows) => <StartsTeamSummary rows={rows}/>}
    compareConfig={{
      formatTrial:    formatStartTrial,
      fetchFullTrial: fetchFullStartTrial,
      DetailComponent: StartsCompareDetail,
    }}
    isPro={isPro}
    onUpgrade={onUpgrade}
  />;
};

const WebStarts = ({ session, authUserId, lang, adminAthleteUuid, isPro: realIsPro, onUpgrade }) => {
  // v01.50 — Preview Pro mode subscription. See web-races.jsx.
  const previewOn = window.PA_PREVIEW?.usePreview?.() || false;
  const isPro = previewOn ? true : !!realIsPro;
  // P-9 (v00.74) — index.html App routes to TeamStartsPlaceholder
  // when persona is coach + no impersonation. Per-athlete WebStarts
  // is unchanged.
  const [athleteUuid, setAthleteUuid] = useStartsState(null);
  const [trials,      setTrials]      = useStartsState([]);
  const [loading,     setLoading]     = useStartsState(true);
  const [error,       setError]       = useStartsState(null);
  // v01.05 — refetchToken: bumping it triggers a fresh fetch via the
  // listStartTrials effect dependency. The shared ErrorState's RETRY
  // button calls setError(null) + setRefetchToken(t => t + 1) so users
  // can recover from a transient network failure without a page reload.
  const [refetchToken, setRefetchToken] = useStartsState(0);
  // v01.07 — mobile breakpoint for grid stacking
  const isMobile = (window.useIsMobile || (() => false))();
  // v01.24 — translation hook
  const t = (window.useT || (() => (k) => k))();

  // Selection (Option D)
  const [slotAKey,  setSlotAKey]  = useStartsState(null);
  const [slotBKey,  setSlotBKey]  = useStartsState(null);
  const [slotBKind, setSlotBKind] = useStartsState(null); // 'PB' | 'MEDIAN' | null

  // Phase filter (non-filtering, cosmetic)
  const [phase, setPhase] = useStartsState('Block');

  // Filters
  const [filters, setFilters] = useStartsState({ distance: null, style: null, course: null });

  // v00.48: reset slot + filter selections whenever the resolved
  // athlete changes. Prevents stale slotAKey from one athlete
  // bleeding through to another's trials list when an admin
  // switches the impersonation target.
  useStartsEffect(() => {
    setSlotAKey(null);
    setSlotBKey(null);
    setSlotBKind(null);
    setFilters({ distance: null, style: null, course: null });
    setPhase('Block');
  }, [adminAthleteUuid]);

  // ── Resolve athlete_uuid ─────────────────────────────────────
  // v00.48: when a super-admin selects an athlete via AdminBar,
  // `adminAthleteUuid` is passed in as an override. Use it
  // directly. Otherwise fall back to v_my_athlete (RLS-filtered
  // single-row lookup against the signed-in user).
  useStartsEffect(() => {
    let cancelled = false;
    if (adminAthleteUuid) {
      // Reset trials immediately so we don't briefly show the
      // previous athlete's data while the new fetch runs.
      setAthleteUuid(adminAthleteUuid);
      setTrials([]);
      setError(null);
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
  useStartsEffect(() => {
    if (!athleteUuid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await window.PA_STARTS.listStartTrials(athleteUuid, { limit: 200 });
      if (cancelled) return;
      if (error) setError(error.message || 'Query failed');
      setTrials(data || []);
      // Pre-select most recent as slotA so the page isn't empty on load
      if (data && data.length && !slotAKey) {
        setSlotAKey(window.PA_STARTS.trialKey(data[0]));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [athleteUuid, refetchToken]);

  // ── Helper bundle for shared analysis-shell atoms ────────────
  // Matches the shape DEFAULT_HELPERS expects: title/date/time/key.
  const startsHelpers = useStartsMemo(() => ({
    title:   (t) => window.PA_STARTS.startTitle(t),
    date:    (t) => window.PA_STARTS.startDate(t),
    time:    (t) => window.PA_STARTS.startSplit15(t),
    key:     (t) => window.PA_STARTS.trialKey(t),
    // v01.49 — raw ISO date for the free-tier session lock sort.
    rawDate: (t) => t?.source_date || null,
  }), []);

  // ── Derived: options, filtered list, slot objects, diff ──────
  // v01.50 — sample swap when preview is on.
  const effectiveTrials = previewOn && window.PA_SAMPLE
    ? window.PA_SAMPLE.STARTS
    : trials;
  const options  = useStartsMemo(
    () => window.PA_STARTS.optionsFrom(effectiveTrials),
    [effectiveTrials]
  );
  const filtered = useStartsMemo(
    () => window.PA_STARTS.applyFilters(effectiveTrials, filters),
    [effectiveTrials, filters]
  );

  const slotATrial = useStartsMemo(
    () => window.PA_STARTS.findByKey(effectiveTrials, slotAKey),
    [effectiveTrials, slotAKey]
  );

  const slotBTrial = useStartsMemo(() => {
    if (slotBKind && slotATrial) {
      return window.PA_STARTS_COMPARE.benchmarkTrial(effectiveTrials, slotBKind, slotATrial);
    }
    return window.PA_STARTS.findByKey(effectiveTrials, slotBKey);
  }, [effectiveTrials, slotBKey, slotBKind, slotATrial]);

  const diff = useStartsMemo(() => {
    if (!slotATrial || !slotBTrial) return null;
    return window.PA_STARTS_COMPARE.diffStarts(slotATrial, slotBTrial);
  }, [slotATrial, slotBTrial]);

  // Phase timeline + metric grid data (always primary-based)
  const phases = useStartsMemo(() => window.PA_STARTS.phaseSpans(slotATrial), [slotATrial]);
  const baseItems = useStartsMemo(() => window.PA_STARTS.metricItems(slotATrial), [slotATrial]);
  // v00.41 pipeline:
  //   baseItems  → applyDeltas (compare context: Δ chip + watch flag)
  //              → applyBests  (all-time PB across same-stroke trials → BEST pill)
  // Order doesn't matter (the helpers don't write to overlapping
  // fields anymore), but keep applyDeltas first so the BEST flag is
  // the last word — applied to the trial regardless of compare state.
  const items = useStartsMemo(() => {
    let pile = baseItems;
    if (diff) pile = window.PA_STARTS_COMPARE.applyDeltas(pile, diff);
    pile = window.PA_STARTS_COMPARE.applyBests(pile, effectiveTrials, slotATrial);
    return pile;
  }, [baseItems, diff, effectiveTrials, slotATrial]);

  // Story — buildStartStory already handles compare verdict + hero
  // Time-to-15m highlight, so we just pass primary and compare.
  const story = useStartsMemo(
    () => window.PA_STARTS.buildStartStory(slotATrial, slotBTrial),
    [slotATrial, slotBTrial]
  );

  // v01.61 — Publish current trial context for Pulse AI. The Pulse
  // drawer reads this on open + on send so prompts like "Analyze this
  // trial" have the trial payload to reason about.
  useStartsEffect(() => {
    if (!window.PA_PULSE) return;
    const title = slotATrial ? (window.PA_STARTS?.startTitle?.(slotATrial) || 'trial') : null;
    window.PA_PULSE.setContext({
      module: 'start',
      primary: slotATrial || null,
      compare: slotBTrial || null,
      label: slotATrial ? ('Start · ' + title) : 'Starts (no trial selected)',
    });
  }, [slotATrial, slotBTrial]);

  // ── Row click semantics (Option D) ───────────────────────────
  const onAssign = (trial) => {
    const k = window.PA_STARTS.trialKey(trial);
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

  // PB / MEDIAN resolves via benchmarkTrial — if no peer matches the
  // primary's event (same distance · stroke · course), it returns null
  // and the compare slot would silently do nothing. Flag it so the UI
  // tells the user why.
  const benchmarkUnavailable = !!slotBKind && !!slotATrial && !slotBTrial;

  // ── Render states ────────────────────────────────────────────
  if (loading) {
    const LS = window.LoadingState;
    return LS
      ? <LS label={t('analysis.loadingState.starts')} large/>
      : (
        <div style={{ padding: 24, color: 'var(--tx-lo)', font: '500 13px var(--font-ui)' }}>
          {t('analysis.loadingState.starts')}
        </div>
      );
  }
  if (error) {
    const ES = window.ErrorState;
    const onRetry = () => { setError(null); setRefetchToken(tok => tok + 1); };
    return ES
      ? <ES message={t('analysis.errorState.startsMessage')}
            onRetry={onRetry}
            technical={String(error)}/>
      : (
        <div style={{ padding: 24, color: 'var(--flag-eff)', font: '500 13px var(--font-ui)' }}>
          {error}
        </div>
      );
  }
  // v01.50 — guard on effectiveTrials so preview mode (which
  // populates sample data) bypasses the page-level empty state
  // and renders the analysis UI with the sample dataset.
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
        eyebrow={t('analysis.emptyState.startsEyebrow')}
        title={t('analysis.emptyState.startsTitle')}
        body={t('analysis.emptyState.startsBody')}
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
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>NO STARTS YET</span>
        <div className="display" style={{ fontSize: 20, color: 'var(--tx-hi)' }}>
          Book a start analysis session
        </div>
        <p style={{ margin: 0, maxWidth: 540, lineHeight: 1.5 }}>
          Once a start is processed, your reaction time, flight phase,
          entry geometry, and 15 m split will appear here. You can
          compare any two starts side by side, or a start against your
          personal best.
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
        helpers={startsHelpers}
        emptyLabel={t('analysis.slot.selectStart')}
        benchmarkUnavailable={benchmarkUnavailable}
        warnHint={t('analysis.slot.warnHintStroke')}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(280px, 360px) 1fr',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* ── LEFT: trials picker card ──────────────────────── */}
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
            emptyMessage="No starts match these filters."
            helpers={startsHelpers}
            isPro={isPro}
            onUpgrade={onUpgrade}
          />
        </ChartCard>

        {/* ── RIGHT: detail column ──────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          {!slotATrial ? (
            <ChartCard title="START DETAIL">
              <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-lo)',
                            padding: '24px 0', textAlign: 'center' }}>
                Select a start from the list to see its phase-by-phase breakdown,
                reaction time, flight geometry, and how it stacks up against your
                personal best.
              </div>
            </ChartCard>
          ) : (
            <StartDetail
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

// ── StartDetail — detail column composition ───────────────────
// Layout (v00.30, Option C hybrid):
//   Headline (hero sentence)
//   PhaseTimeline (4 functional tabs)
//   MetricGrid (summary rail — 7 KPIs in one row, cols=items.length)
//   PhaseDetail (NEW — content swaps based on active tab)
//   reserved velocity / progression slot (cross-phase, stays put)
//   VideoCard (last)
//
// The summary rail shows whole-start indicators that read at a glance
// regardless of which phase is open. PhaseDetail dives into the active
// phase's metrics — including ones intentionally omitted from the rail
// (e.g. Push Time lives in the Block tab). In compare mode each row
// stacks primary / compare / Δ in the same idiom Stroke Mechanics uses.
const StartDetail = ({ primary, compare, diff, story, phases, items, phase, onChangePhase, trials, isPro, onUpgrade }) => (
  <React.Fragment>
    {/* Hero — free-standing, no card wrapper */}
    {story && (
      <Headline
        eyebrow={story.eyebrow}
        title={story.titleNode}
        sub={story.sub}
        right={story.rightChip}
      />
    )}

    {/* Phase timeline — drives PhaseDetail below. */}
    <PhaseTimeline phases={phases} active={phase} onChange={onChangePhase}/>

    {/* Summary rail — single row, fixed cols = item count. */}
    <MetricGrid items={items} cols={items.length || 'auto'}/>

    {/* Phase detail — swaps content when the tab changes. v00.38
        moves HorizontalVelocityCard inside the Block tab body so
        each phase keeps a distinct payload (otherwise the tabs are
        decorative — same chart everywhere). Underwater restores its
        5-station chart as its phase-unique visual. */}
    <PhaseDetail phase={phase} primary={primary} compare={compare}/>

    {/* Last-8-session progression — v00.40 replaces the v00.20 dashed
        reserved slot. Bar chart of time-to-15 m for the most recent
        8 same-stroke starts; current trial highlighted in lime. */}
    <Last8Sessions primary={primary} trials={trials}/>

    {/* v01.18 — Start video with switcher / Pro gate / download. */}
    <VideoCard
      title={'START VIDEO · ' + (window.PA_STARTS.startTitle(primary) || '').toUpperCase()}
      hint="block to breakout"
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
      isPro={isPro}
      onUpgrade={onUpgrade}
    />
  </React.Fragment>
);

// ── FlightPathChart (v00.42) ───────────────────────────────────
// Side-profile of the swimmer's hip trajectory during the Flight
// phase: from takeoff (left) to water entry (right). Renders as a
// parabolic arc anchored at two measured points:
//
//   takeoff: x = 0 m (block edge), y = height_hip_takeoff (m above water)
//   entry:   x = distance_to_water_entry (m), y = 0 (water surface)
//
// IMPORTANT: the apex of the rendered arc is INTERPOLATED for visual
// realism — we don't have a measured apex column, only the takeoff
// height. The curve uses a quadratic Bézier with the control point
// slightly above takeoff height to suggest the natural rise-then-fall
// of a dive, but the visualization does NOT claim a specific apex
// value. The labeled data points are takeoff + entry only.
//
// Compare overlay draws beneath the primary (lower z) in compare-eff
// — same convention used by BlockVelocityChart.
const FlightPathChart = ({ primary, compare }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  const build = (t) => {
    if (!t) return null;
    const takeoff = num(t, 'height_hip_takeoff');
    const dist    = num(t, 'distance_to_water_entry');
    const angle   = num(t, 'angle_hip_entry_deg');
    if (takeoff == null || dist == null) return null;
    return { takeoff, dist, angle };
  };

  const a = build(primary);
  const b = compare ? build(compare) : null;

  if (!a) {
    return (
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
          FLIGHT PATH · TAKEOFF → ENTRY
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                      padding: '14px 0', textAlign: 'center' }}>
          Flight geometry columns missing for this trial.
        </div>
      </div>
    );
  }

  // Domain — fit both primary and compare with headroom. Defaults
  // are sized for typical dive geometry (entry ~3 m, takeoff ~1.2 m)
  // so a single trial doesn't render in a cramped half-frame.
  const allDist    = [a.dist,    b ? b.dist    : null].filter(x => x != null);
  const allTakeoff = [a.takeoff, b ? b.takeoff : null].filter(x => x != null);
  const xMax = Math.max(...allDist,    4)   + 0.5;
  const yMax = Math.max(...allTakeoff, 1.5) + 0.5;

  const W = 480, H = 220;
  const PAD_L = 50, PAD_R = 30, PAD_T = 24, PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xOf    = (m) => PAD_L + (m / xMax) * innerW;
  const yOf    = (m) => PAD_T + innerH - (m / yMax) * innerH;
  const waterY = yOf(0);

  // Quadratic Bézier from (0, takeoff) → control (mid, ~1.18×takeoff)
  // → (entry distance, 0). The 1.18 factor lifts the control above
  // takeoff height so the curve visibly rises-then-falls instead of
  // collapsing to a straight line.
  const arcPath = (g) => {
    const x0 = xOf(0),   y0 = yOf(g.takeoff);
    const x1 = xOf(g.dist), y1 = waterY;
    const cx = (x0 + x1) / 2;
    const cy = yOf(g.takeoff * 1.18);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };

  // Mini-KPI tile.
  const Mini = ({ label, value, unit, dec = 2 }) => (
    <div>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>{label}</div>
      <div style={{ font: '700 18px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 4 }}>
        {value != null ? value.toFixed(dec) : '—'}
        {value != null && unit && (
          <span style={{ fontSize: 11, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );

  // Narrative — declarative, what we measured. v03.11 — colored
  // tokens (primary green, compare delta purple) + compare-aware:
  // when a compare trial is selected the angle tail swaps for an
  // entry-distance verdict against the compare.
  const narrative = (() => {
    const G = (txt) => <span style={{ color: 'var(--lime-eff)' }}>{txt}</span>;
    const P = (txt) => <span style={{ color: 'var(--compare-eff)' }}>{txt}</span>;
    const takeoffStr = a.takeoff.toFixed(2) + ' m';
    const distStr    = a.dist.toFixed(2) + ' m';
    if (b && b.dist != null) {
      const targetName = compare._benchmarkKind === 'PB'     ? 'your best'
                       : compare._benchmarkKind === 'MEDIAN' ? 'your median'
                                                              : 'compare';
      const d = +(a.dist - b.dist).toFixed(2);
      if (Math.abs(d) < 0.005) {
        return <>Hip cleared {G(takeoffStr)} off the block, entered at {G(distStr)} — even with {targetName}.</>;
      }
      const word = d > 0 ? 'farther than' : 'shorter than';
      return <>Hip cleared {G(takeoffStr)} off the block, entered at {G(distStr)} — {P(Math.abs(d).toFixed(2) + ' m')} {word} {targetName}.</>;
    }
    const angleFragment = a.angle != null ? <> at {G(a.angle.toFixed(1) + '°')}</> : null;
    return <>Hip cleared {G(takeoffStr)} off the block, entered the water at {G(distStr)}{angleFragment}.</>;
  })();

  // Inline legend.
  const legend = (
    <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 12, height: 2, background: 'var(--lime-eff)' }}/>
        Primary
      </span>
      {b && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                       font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
          <span style={{ width: 12, height: 2, background: 'var(--compare-eff)' }}/>
          Compare
        </span>
      )}
    </div>
  );

  // Y-tick set — only show ticks within yMax.
  const yTicks = [0, 0.5, 1, 1.5, 2].filter(v => v <= yMax);
  const xTicks = [0, 1, 2, 3, 4].filter(v => v <= xMax);

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
        FLIGHT PATH · TAKEOFF → ENTRY
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 1fr) minmax(280px, 1.1fr)',
        gap: isMobile ? 14 : 24, alignItems: isMobile ? 'stretch' : 'center',
      }}>
        {/* Left: narrative + mini-KPIs */}
        <div>
          <div className="display" style={{
            fontSize: 18, lineHeight: 1.3, marginBottom: 14, letterSpacing: '-0.015em',
            color: 'var(--tx-hi)', maxWidth: 360,
          }}>
            {narrative}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Mini label="Hip @ takeoff"  value={a.takeoff} unit="m" dec={2}/>
            <Mini label="Entry distance" value={a.dist}    unit="m" dec={2}/>
            <Mini label="Entry angle"    value={a.angle}   unit="°" dec={1}/>
          </div>
        </div>
        {/* Right: side-profile SVG */}
        <div>
          <window.ChartScroll minWidth={W}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
               style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 260 }}>
            {/* Y gridlines */}
            {yTicks.map(y => y > 0 && (
              <line key={'gy' + y} x1={PAD_L} x2={W - PAD_R} y1={yOf(y)} y2={yOf(y)}
                    stroke="var(--line-soft)" strokeDasharray="2 4"
                    strokeWidth="1" opacity="0.5"/>
            ))}
            {/* Block — small visual on the left of the takeoff point */}
            <rect x={PAD_L - 18} y={waterY - (0.75 / yMax) * innerH}
                  width={18}     height={(0.75 / yMax) * innerH}
                  fill="var(--tx-md)" opacity="0.25"/>
            {/* Water line (lime dashed) */}
            <line x1={PAD_L} y1={waterY} x2={W - PAD_R} y2={waterY}
                  stroke="var(--lime-eff)" strokeWidth="1.5"
                  strokeDasharray="4 4" opacity="0.55"/>
            {/* X tick labels (m from block edge) */}
            {xTicks.map(x => (
              <text key={'tx' + x} x={xOf(x)} y={H - PAD_B + 16}
                    fontSize="10" fontFamily="var(--font-mono)"
                    fill="var(--tx-lo)" textAnchor="middle">
                {x} m
              </text>
            ))}
            {/* Y tick labels (height above water) */}
            {yTicks.map(y => (
              <text key={'ty' + y} x={PAD_L - 8} y={yOf(y) + 3}
                    fontSize="10" fontFamily="var(--font-mono)"
                    fill="var(--tx-lo)" textAnchor="end">
                {y.toFixed(1)} m
              </text>
            ))}
            {/* Compare arc + endpoints (drawn first so primary sits on top) */}
            {b && (
              <g>
                <path d={arcPath(b)} fill="none"
                      stroke="var(--compare-eff)" strokeWidth="2.4"
                      strokeLinecap="round"/>
                <circle cx={xOf(0)}      cy={yOf(b.takeoff)} r="3.6" fill="var(--compare-eff)"/>
                <circle cx={xOf(b.dist)} cy={waterY}         r="3.6" fill="var(--compare-eff)"/>
              </g>
            )}
            {/* Primary arc + endpoints */}
            <path d={arcPath(a)} fill="none"
                  stroke="var(--lime-eff)" strokeWidth="2.6"
                  strokeLinecap="round"/>
            <circle cx={xOf(0)}      cy={yOf(a.takeoff)} r="4" fill="var(--lime-eff)"/>
            <circle cx={xOf(a.dist)} cy={waterY}         r="4" fill="var(--lime-eff)"/>
            {/* Primary takeoff + entry labels (above + above-water-line)
                v00.50: when compare is active, primary labels stay
                in the original position; compare labels render in
                the OPPOSITE position (takeoff → below the takeoff
                dot, entry → below the water line) so the two
                trials' labels never collide. */}
            <text x={xOf(0) + 8} y={yOf(a.takeoff) - 8}
                  fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                  fill="var(--lime-eff)">
              TAKEOFF {a.takeoff.toFixed(2)} m
            </text>
            <text x={xOf(a.dist) - 4} y={waterY - 10}
                  fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                  fill="var(--lime-eff)" textAnchor="end">
              ENTRY {a.dist.toFixed(2)} m{a.angle != null ? ' · ' + a.angle.toFixed(1) + '°' : ''}
            </text>
            {/* Compare takeoff + entry labels.
                Takeoff: primary above the dot, compare below.
                Entry: both above the water line — primary at -10,
                compare at -24 — so when entry distances are close
                the labels stack vertically (14 px gap) instead of
                pushing into the x-axis tick zone below the water. */}
            {b && (
              <g>
                <text x={xOf(0) + 8} y={yOf(b.takeoff) + 16}
                      fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                      fill="var(--compare-eff)">
                  TAKEOFF {b.takeoff.toFixed(2)} m
                </text>
                <text x={xOf(b.dist) - 4} y={waterY - 24}
                      fontSize="10" fontFamily="var(--font-mono)" fontWeight="700"
                      fill="var(--compare-eff)" textAnchor="end">
                  ENTRY {b.dist.toFixed(2)} m{b.angle != null ? ' · ' + b.angle.toFixed(1) + '°' : ''}
                </text>
              </g>
            )}
          </svg>
          </window.ChartScroll>
          {legend}
        </div>
      </div>
    </div>
  );
};

// ── Last8Sessions (v00.40) ─────────────────────────────────────
// Bar chart of the last 8 same-stroke starts' time-to-15 m. Today's
// trial (the primary) renders in lime; the other 7 in muted grey.
// Replaces the v00.20 dashed reserved slot ("velocity curve and
// last-8-session progression land in a later drop").
//
// Data path:
//   - Read athlete's trials list (already on the page).
//   - Filter to the primary's stroke.
//   - Drop trials missing split_15m_s (can't plot what we don't have).
//   - Sort ascending by source_date; take the last 8.
//   - The primary trial — found by trialKey — is the highlight bar.
//
// Narrative is data-driven, three cases:
//   A) Today = the best of the 8 → "You're trending down — and today
//      is your best."
//   B) Average of last 4 < average of older 4 → "Trending down —
//      recent starts are faster."
//   C) Otherwise → "Holding within X.XX s across last 8 starts."
const Last8Sessions = ({ primary, trials }) => {
  if (!primary || !trials || !trials.length) return null;

  const num = (v) => (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  const styleOf = (t) => {
    const mj = (t && (t.mj || t.metrics_json)) || {};
    return String(t.style || mj.Style || mj.style || '').toLowerCase();
  };

  const primaryStroke = styleOf(primary);
  const primaryKey    = window.PA_STARTS && window.PA_STARTS.trialKey
                        ? window.PA_STARTS.trialKey(primary)
                        : null;

  // Build candidate set: same stroke + has 15 m split + has a date
  const candidates = trials.filter(t =>
    styleOf(t) === primaryStroke &&
    num(t.split_15m_s) != null &&
    !!t.source_date
  );

  // Sort ascending by date so the timeline reads left → right.
  candidates.sort((a, b) => String(a.source_date).localeCompare(String(b.source_date)));

  // If the primary itself doesn't carry split_15m_s, the chart has
  // no anchor — bail to an empty state.
  if (!candidates.length) {
    return (
      <div style={{
        padding: 22, borderRadius: 14,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        color: 'var(--tx-lo)', font: '500 13px var(--font-ui)',
      }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>TIME TO 15 M · LAST 8 SESSIONS</div>
        <div>Not enough same-stroke starts with a 15 m split to draw a trend.</div>
      </div>
    );
  }

  // Take the last 8 (most recent up to and including the primary).
  const last8 = candidates.slice(-8);
  const isPrimaryBar = (t) => window.PA_STARTS.trialKey(t) === primaryKey;

  // Y-axis padding for visual breathing room.
  const values = last8.map(t => num(t.split_15m_s));
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const pad    = Math.max(0.05, (rawMax - rawMin) * 0.18);
  const yMax   = rawMax + pad;
  const yMin   = Math.max(0, rawMin - pad);

  // Narrative — derived from the actual data.
  const narrative = (() => {
    const todayV = num(primary.split_15m_s);
    if (todayV == null) return null;
    const isToday = (v) => Math.abs(v - todayV) < 1e-6;
    const minV = rawMin;
    if (isToday(minV)) {
      return <>You're trending down — <span style={{ color: 'var(--lime-eff)' }}>today is your best</span>.</>;
    }
    if (last8.length >= 4) {
      const half = Math.floor(last8.length / 2);
      const olderAvg  = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const recentAvg = values.slice(-half).reduce((a, b) => a + b, 0) / half;
      const delta = +(recentAvg - olderAvg).toFixed(2);
      if (delta < -0.05) {
        return <>Trending down — <span style={{ color: 'var(--lime-eff)' }}>recent starts are faster</span>.</>;
      }
      if (delta > 0.05) {
        return <>Trending up — <span style={{ color: 'var(--flag-eff)' }}>recent starts are slower</span>.</>;
      }
    }
    const span = +(rawMax - rawMin).toFixed(2);
    return <>Holding within <span style={{ color: 'var(--lime-eff)' }}>{span.toFixed(2)} s</span> across last {last8.length} starts.</>;
  })();

  // Layout the SVG bars.
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
            TIME TO 15 M · LAST {last8.length} SESSIONS
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
        {/* Y-axis baseline */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B}
              stroke="var(--line-soft)" strokeWidth="1"/>
        {/* Bars */}
        {last8.map((t, i) => {
          const v       = num(t.split_15m_s);
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

// ── BlockVelocityChart (v00.39, replaces HorizontalVelocityCard) ─
// Simple velocity-vs-distance chart for the Block tab. The point of
// the Block tab visual is to show **how fast you came off the
// block** and how that bled off across the start. The cleanest
// honest read uses only the three data points where we know both
// the velocity AND the distance:
//
//   0 m  — peak takeoff velocity   (hor_vel_hip_flight)
//   ~3 m — velocity at hands entry (hor_vel_hands_entry, plotted at
//          distance_to_water_entry on the x-axis)
//   15 m — average velocity over the full start (15 ÷ split_15m_s)
//
// We deliberately do NOT plot the underwater event-anchored stations
// (kick 1 / 3 kicks / stroke 1 / stroke 2) here — those happen at
// unknown meter marks, so showing them on a meter axis would make up
// distances. They live on the Underwater tab's categorical chart
// instead.
//
// Peak is labeled with a "PEAK X.XX" callout — matches the design
// reference's velocity card signature.
const BlockVelocityChart = ({ primary, compare }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const ChartFrame  = window.ChartFrame;
  if (!ChartFrame) return null;

  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  // v02.22 — Labels now describe WHERE the sample was taken, not who's
  // the peak. The peak is determined after building points by selecting
  // the highest-y point regardless of position. This fixes the case where
  // entry velocity is actually higher than takeoff (gravity adds horizontal
  // speed on a non-zero takeoff angle), which previously mis-labeled
  // takeoff as PEAK on the chart and in the narrative.
  const buildPoints = (t) => {
    if (!t) return [];
    const takeoffV = num(t, 'hor_vel_hip_flight');
    const entryV   = num(t, 'hor_vel_hands_entry');
    const entryX   = num(t, 'distance_to_water_entry');
    const t15      = num(t, 'split_15m_s');
    const avg15    = (t15 && t15 > 0) ? +(15 / t15).toFixed(3) : null;

    const pts = [];
    if (takeoffV != null) pts.push({ x: 0,      y: takeoffV, label: 'Takeoff' });
    if (entryV != null && entryX != null && entryX > 0)
                          pts.push({ x: entryX, y: entryV,   label: 'Entry'   });
    if (avg15 != null)    pts.push({ x: 15,     y: avg15,    label: 'Avg 15m' });
    return pts.sort((a, b) => a.x - b.x);
  };

  const seriesA = buildPoints(primary);
  const seriesB = compare ? buildPoints(compare) : [];

  if (!seriesA.length && !seriesB.length) {
    return (
      <div>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
          VELOCITY · 0 m → 15 m
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                      padding: '14px 0', textAlign: 'center' }}>
          No velocity / split data captured for this trial.
        </div>
      </div>
    );
  }

  // v02.22 — Mini-KPI helpers + dynamic peak selection.
  // `peakOf` picks the highest-y point in a series. The PEAK callout
  // and the narrative both anchor on this value rather than always
  // assuming takeoff is the peak. `takeoff` and `entry` are kept as
  // named helpers for the narrative (we describe WHERE the peak fell).
  const at = (series, lbl) => series.find(p => p.label === lbl);
  const peakOf = (series) => series.length
    ? series.reduce((best, p) => (best == null || p.y > best.y) ? p : best, null)
    : null;
  const takeoff = at(seriesA, 'Takeoff');
  const entry   = at(seriesA, 'Entry');
  const avg15   = at(seriesA, 'Avg 15m');
  const peak    = peakOf(seriesA);
  const peakCmp = peakOf(seriesB);

  // Data-driven narrative. v02.22 — describes WHERE the peak fell.
  // v03.11 — colored tokens (primary green, compare delta purple) +
  // compare-aware: with a compare trial the station list swaps for
  // a verdict against the compare's peak velocity.
  const narrative = (() => {
    if (!peak) return null;
    const G = (txt) => <span style={{ color: 'var(--lime-eff)' }}>{txt}</span>;
    const P = (txt) => <span style={{ color: 'var(--compare-eff)' }}>{txt}</span>;
    const peakV = peak.y.toFixed(2) + ' m/s';
    const peakWhere = peak.label === 'Entry' ? 'at entry' : peak.label === 'Avg 15m' ? 'across 15 m' : 'at takeoff';
    if (compare && peakCmp) {
      const targetName = compare._benchmarkKind === 'PB'     ? 'your best'
                       : compare._benchmarkKind === 'MEDIAN' ? 'your median'
                                                              : 'compare';
      const d = +(peak.y - peakCmp.y).toFixed(2);
      if (Math.abs(d) < 0.005) {
        return <>Peak {G(peakV)} {peakWhere} — even with {targetName}.</>;
      }
      const word = d > 0 ? 'faster than' : 'slower than';
      return <>Peak {G(peakV)} {peakWhere} — {P(Math.abs(d).toFixed(2) + ' m/s')} {word} {targetName}.</>;
    }
    if (avg15 && entry && takeoff) {
      const o1 = peak.label !== 'Takeoff'
        ? <>{G(takeoff.y.toFixed(2) + ' m/s')} at takeoff, </> : null;
      const o2 = peak.label !== 'Entry'
        ? <>{G(entry.y.toFixed(2) + ' m/s')} at entry, </> : null;
      return <>Peak {G(peakV)} {peakWhere}, {o1}{o2}{G(avg15.y.toFixed(2) + ' m/s')} avg through 15 m.</>;
    }
    if (avg15) {
      return <>Peak {G(peakV)} {peakWhere}, {G(avg15.y.toFixed(2) + ' m/s')} avg through 15 m.</>;
    }
    return <>Peak velocity hit {G(peakV)} {peakWhere}.</>;
  })();

  // Y-scale across both series with 15 % headroom.
  const all    = seriesA.concat(seriesB);
  const rawMax = Math.max(...all.map(p => p.y));
  const rawMin = Math.min(...all.map(p => p.y));
  const padY   = Math.max(0.05, (rawMax - rawMin) * 0.15);
  const yMin   = Math.max(0, rawMin - padY);
  const yMax   = rawMax + padY;

  // X-axis: fixed 0..15 m so the spatial scale is intuitive.
  const xMin = 0, xMax = 15;

  // Mini-KPI tile.
  const Mini = ({ label, value, unit }) => (
    <div>
      <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)' }}>{label}</div>
      <div style={{ font: '700 18px var(--font-mono)', color: 'var(--tx-hi)', marginTop: 4 }}>
        {value != null ? value.toFixed(2) : '—'}
        {value != null && unit && (
          <span style={{ fontSize: 11, color: 'var(--tx-lo)', fontWeight: 500, marginLeft: 3 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );

  // Inline legend in lime + compare-eff.
  const legend = (
    <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 12, height: 2, background: 'var(--lime-eff)' }}/>
        Primary
      </span>
      {compare && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                       font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
          <span style={{ width: 12, height: 2, background: 'var(--compare-eff)' }}/>
          Compare
        </span>
      )}
    </div>
  );

  // Render a custom inline SVG so we can drop the PEAK label exactly
  // on the takeoff point. (LineOverlay is generic — annotating one
  // station inline is cleaner than threading a callback into it.)
  const W = 480, H = 200, PAD_L = 38, PAD_R = 16, PAD_T = 24, PAD_B = 28;
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const pathOf = (pts, color) => pts.length
    ? window.PA_SVG.smoothPath(pts.map(p => [xOf(p.x), yOf(p.y)]))
    : '';

  const xTicks = [0, 5, 10, 15];
  const yTicks = [yMax, (yMax + yMin) / 2, yMin];

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
        VELOCITY · 0 m → 15 m
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 1fr) minmax(280px, 1.1fr)',
        gap: isMobile ? 14 : 24, alignItems: isMobile ? 'stretch' : 'center',
      }}>
        {/* Left: narrative + mini-KPIs */}
        <div>
          {narrative && (
            <div className="display" style={{
              fontSize: 18, lineHeight: 1.3, marginBottom: 14, letterSpacing: '-0.015em',
              color: 'var(--tx-hi)', maxWidth: 360,
            }}>
              {narrative}
            </div>
          )}
          {/* v02.22 — Show Takeoff + Entry as separate tiles instead of
              an "At entry" tile alongside a hard-coded "Peak". Peak still
              displayed (max of the two samples). User sees the comparison
              between takeoff and entry directly. */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Mini label="Peak"     value={peak    ? peak.y    : null} unit="m/s"/>
            <Mini label="Takeoff"  value={takeoff ? takeoff.y : null} unit="m/s"/>
            <Mini label="Entry"    value={entry   ? entry.y   : null} unit="m/s"/>
            <Mini label="Avg 15 m" value={avg15   ? avg15.y   : null} unit="m/s"/>
          </div>
        </div>
        {/* Right: distance-anchored SVG line chart */}
        <div>
          <window.ChartScroll minWidth={W}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
               style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 240 }}>
            {/* Y gridlines */}
            {[0.25, 0.5, 0.75].map(f => {
              const y = PAD_T + f * (H - PAD_T - PAD_B);
              return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                           stroke="var(--line-soft)" strokeDasharray="2 4"
                           strokeWidth="1" opacity="0.5"/>;
            })}
            {/* Axes */}
            <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B}
                  stroke="var(--line-soft)" strokeWidth="1"/>
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B}
                  stroke="var(--line-soft)" strokeWidth="1"/>
            {/* X tick labels */}
            {xTicks.map(x => (
              <text key={'x' + x} x={xOf(x)} y={H - PAD_B + 16}
                    fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
                    textAnchor="middle">{x} m</text>
            ))}
            {/* Y tick labels */}
            {yTicks.map((y, i) => (
              <text key={'y' + i} x={PAD_L - 8} y={yOf(y) + 3}
                    fill="var(--tx-lo)" fontSize="10" fontFamily="var(--font-mono)"
                    textAnchor="end">{y.toFixed(2)} m/s</text>
            ))}
            {/* Compare line first so primary draws on top */}
            {seriesB.length > 0 && (
              <path d={pathOf(seriesB)} fill="none"
                    stroke="var(--compare-eff)" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round"/>
            )}
            {seriesB.map((p, i) => (
              <circle key={'cb' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.2" fill="var(--compare-eff)"/>
            ))}
            {/* Primary line + dots */}
            {seriesA.length > 0 && (
              <path d={pathOf(seriesA)} fill="none"
                    stroke="var(--lime-eff)" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round"/>
            )}
            {seriesA.map((p, i) => (
              <circle key={'ca' + i} cx={xOf(p.x)} cy={yOf(p.y)} r="3.6" fill="var(--lime-eff)"/>
            ))}
            {/* v02.22 — PEAK callout anchors on the ACTUAL highest-y
                point per series (could be Takeoff or Entry depending on
                the swimmer). The primary callout sits above (y-8) in
                lime; compare sits below (y+16) in compare-eff so the
                labels don't collide when both peaks share an x. */}
            {peak && (
              <text x={xOf(peak.x) + 8} y={yOf(peak.y) - 8}
                    fill="var(--lime-eff)" fontSize="11"
                    fontFamily="var(--font-mono)" fontWeight="700">
                PEAK {peak.y.toFixed(2)}
              </text>
            )}
            {peakCmp && (
              <text x={xOf(peakCmp.x) + 8} y={yOf(peakCmp.y) + 16}
                    fill="var(--compare-eff)" fontSize="11"
                    fontFamily="var(--font-mono)" fontWeight="700">
                PEAK {peakCmp.y.toFixed(2)}
              </text>
            )}
          </svg>
          </window.ChartScroll>
          {legend}
        </div>
      </div>
    </div>
  );
};

// ── BlockSplitBar (v00.34, refactored v00.35) ──────────────────
// Horizontal bar of off-block time, broken into two phases that
// ADD UP to reaction_time_s:
//
//   Latency = signal → first movement on the block
//             (Templo column block_reaction_s; falls back to
//              reaction_time_s − push_time_s when missing)
//   Push    = first movement → feet leaving the block
//             (Templo column push_time_s)
//   Total   = reaction_time_s (Latency + Push), shown right-edge.
//
// IMPORTANT: an earlier version showed `reaction + push` as the
// total, which double-counted the push interval (push_time_s is
// already part of reaction_time_s). v00.35 makes the segments
// geometrically correct and adds HelpDot tooltips so coaches and
// athletes can see exactly what each interval means without having
// to memorize the terminology.
const BlockSplitBar = ({ primary, compare }) => {
  const HelpDot = window.HelpDot;
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  const buildRow = (t) => {
    if (!t) return null;
    const reaction = num(t, 'reaction_time_s');
    const push     = num(t, 'push_time_s');
    if (reaction == null || push == null) return null;
    // block_reaction_s in our actual v_start_kpis data is unreliable —
    // some trials store an absolute timestamp (e.g. 3.51 s into the
    // recording) instead of the signal-to-first-movement interval.
    // Only trust it when it looks like an interval (0 ≤ x ≤ reaction).
    // Otherwise derive latency = reaction − push so the segments stay
    // geometrically consistent with the Reaction total.
    const explicit = num(t, 'block_reaction_s');
    let latency;
    if (explicit != null && explicit >= 0 && explicit <= reaction) {
      latency = explicit;
    } else {
      latency = +(reaction - push).toFixed(3);
    }
    if (latency < 0) latency = 0;
    return { reaction, push, latency };
  };

  const a = buildRow(primary);
  const b = compare ? buildRow(compare) : null;

  if (!a) {
    return (
      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
                    padding: '14px 0', textAlign: 'center' }}>
        Block phase columns missing for this trial.
      </div>
    );
  }

  // Normalize widths to the larger of the two reaction times so the
  // slower trial visibly extends past the faster one.
  const maxReaction = Math.max(a.reaction, b ? b.reaction : 0);

  const fmt = (v, dec) => v == null ? '' : v.toFixed(dec) + ' s';

  const Row = ({ row, label, accent }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <span className="eyebrow" style={{
        minWidth: 64, color: 'var(--tx-lo)', letterSpacing: 0.08,
      }}>
        {label}
      </span>
      <div style={{
        flex: 1, position: 'relative', height: 32, borderRadius: 6,
        background: 'var(--bg-3)', overflow: 'hidden', display: 'flex',
      }}>
        <div style={{
          width: ((row.latency / maxReaction) * 100) + '%',
          background: accent,
          display: 'flex', alignItems: 'center',
          padding: '0 8px',
          color: 'var(--ink)', font: '600 11px var(--font-mono)',
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          {fmt(row.latency, 2)}
        </div>
        <div style={{
          width: ((row.push / maxReaction) * 100) + '%',
          background: 'color-mix(in oklch, ' + accent + ' 45%, transparent)',
          borderLeft: '1px solid var(--bg)',
          display: 'flex', alignItems: 'center',
          padding: '0 8px',
          color: 'var(--tx-hi)', font: '600 11px var(--font-mono)',
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          {fmt(row.push, 3)}
        </div>
      </div>
      <span style={{
        minWidth: 64, textAlign: 'right',
        font: '600 13px var(--font-mono)', color: 'var(--tx-hi)',
      }}>
        {row.reaction.toFixed(2)} s
      </span>
    </div>
  );

  // Compare row label — prefer the benchmark kind when set, fall back to "COMPARE".
  const compareLabel = compare
    ? (compare._benchmarkKind === 'PB'      ? 'PB'
     : compare._benchmarkKind === 'MEDIAN'  ? 'MEDIAN'
     : 'COMPARE')
    : null;

  // Legend — explains the two opacities. Help dots clarify the
  // intervals without forcing coach-jargon onto the swatch label.
  const legend = (
    <div style={{ display: 'flex', gap: 14, marginTop: 10, padding: '0 2px', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--lime-eff)' }}/>
        Latency
        {HelpDot && <HelpDot text="Pre-movement time: from start signal to first movement on the block. Sometimes called auditory reaction time."/>}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 2,
                       background: 'color-mix(in oklch, var(--lime-eff) 45%, transparent)' }}/>
        Push
        {HelpDot && <HelpDot text="Push phase: from first movement on the block to feet leaving the block."/>}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
                     marginLeft: 'auto' }}>
        Total = Reaction
        {HelpDot && <HelpDot text="Reaction time: from start signal to feet leaving the block. Equals Latency + Push." placement="top"/>}
      </span>
    </div>
  );

  return (
    <div>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 4 }}>
        OFF-BLOCK BREAKDOWN · LATENCY + PUSH
      </div>
      <Row row={a} label="YOU" accent="var(--lime-eff)"/>
      {b && <Row row={b} label={compareLabel} accent="var(--compare-eff)"/>}
      {legend}
    </div>
  );
};

// ── UnderwaterVelocityChart (v00.32) ───────────────────────────
// 5-station velocity progression for the Underwater phase. Reads
// horizontal velocity columns the live dashboard already flattens
// onto v_start_kpis: hands entry → kick 1 → 3 kicks → stroke 1 →
// stroke 2. The x axis is categorical (station names) — same
// LineOverlay primitive as the race velocity chart, but with the
// xLabelsOverride hook added in v00.32 so we can label each station
// instead of "0 m / N m".
//
// Colors: primary in --lime-eff, compare in --compare-eff (no dash,
// matching the v00.27 compare grammar — bars use solid compare-eff
// and the line should too so it reads the same).
const VEL_KEYS   = ['hor_vel_hands_entry', 'hor_vel_hip_to_kick1', 'hor_vel_hip_3kicks', 'hor_vel_hip_stroke1', 'hor_vel_hip_stroke2'];
const VEL_LABELS = ['Hands entry', 'Kick 1', '3 Kicks', 'Stroke 1', 'Stroke 2'];

const UnderwaterVelocityChart = ({ primary, compare }) => {
  const ChartFrame  = window.ChartFrame;
  const LineOverlay = window.LineOverlay;
  if (!ChartFrame || !LineOverlay) return null;

  const numAt = (t, col) => {
    if (!t) return null;
    const v = t[col];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };
  const buildSeries = (t) => {
    if (!t) return [];
    return VEL_KEYS
      .map((k, i) => ({ x: i, y: numAt(t, k) }))
      .filter(p => p.y != null);
  };

  const seriesA = buildSeries(primary);
  const seriesB = compare ? buildSeries(compare) : [];
  const all = seriesA.concat(seriesB);

  if (!all.length) {
    return <ChartFrame title="UNDERWATER VELOCITY · HANDS ENTRY → STROKE 2"
                       empty="No underwater velocity captured for this trial."/>;
  }

  const rawMax = Math.max(...all.map(p => p.y));
  const rawMin = Math.min(...all.map(p => p.y));
  const pad    = Math.max(0.05, (rawMax - rawMin) * 0.15);
  const yMin   = Math.max(0, rawMin - pad);
  const yMax   = rawMax + pad;

  // Categorical x labels — anchor first/last to start/end, middles centered.
  const xLabelsOverride = VEL_LABELS.map((text, i) => ({
    x: i,
    text,
    anchor: i === 0 ? 'start' : (i === VEL_LABELS.length - 1 ? 'end' : 'middle'),
  }));

  // Inline legend so we can use compare-eff instead of CHART.COLOR_B.
  const legend = (
    <div style={{ display: 'flex', gap: 14, marginTop: 6, padding: '0 2px', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                     font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
        <span style={{ width: 12, height: 2, background: 'var(--lime-eff)' }}/>
        Primary
      </span>
      {compare && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                       font: '500 11px var(--font-ui)', color: 'var(--tx-md)' }}>
          <span style={{ width: 12, height: 2, background: 'var(--compare-eff)' }}/>
          Compare
        </span>
      )}
    </div>
  );

  return (
    <ChartFrame title="UNDERWATER VELOCITY · HANDS ENTRY → STROKE 2"
                legend={legend}>
      <LineOverlay seriesA={seriesA} seriesB={seriesB}
                   xMin={0} xMax={VEL_KEYS.length - 1}
                   yMin={yMin} yMax={yMax}
                   yUnit=" m/s" yFormat={(v) => v.toFixed(2)}
                   colorA="var(--lime-eff)"
                   colorB="var(--compare-eff)"
                   dashB=""
                   xLabelsOverride={xLabelsOverride}/>
    </ChartFrame>
  );
};

// ── PhaseHero (v01.55, node-sentence v03.10) ────────────────
//
// Sentence-style hero for phase tabs. v03.10 — `sentence` is a
// fully pre-colored React node built by the heroProps builder
// (primary numbers green, compare numbers purple). The hero just
// renders it — no substring highlight matching, no delta chip.
//
// Props:
//   sentence: React node (or plain string for unavailable states)
//   subtext:  secondary copy
const PhaseHero = ({ sentence, subtext }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  if (!sentence) {
    return (
      <div style={{
        padding: 18, borderRadius: 12,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
        textAlign: 'center',
        marginBottom: 14,
      }}>
        Headline unavailable for this trial.
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

// ── PhaseContributionBar (v01.54) ─────────────────────────────
//
// Horizontal stacked bar showing how time was distributed across
// the four start phases (Block / Flight / Underwater / Surface).
// Total = split_15m_s. Each segment colored to match the phase's
// canonical accent. Hover tooltip shows duration + percentage of
// total.
//
// Coachable: at a glance reveals where time is going. Strong UW
// kickers will show Underwater dominating; athletes who linger
// after breakout will show Surface bigger than peers.
//
// Compare mode: stacks two bars, primary on top, compare below.
//
// Edge case: when abs_time_surface_break > split_15m_s (athlete
// reaches 15 m while still underwater — common with elite kickers),
// the surface segment goes negative. Fold the negative back into
// underwater and label the bar accordingly.
const PhaseContributionBar = ({ primary, compare, compareLabel }) => {
  const num = (t, c) => {
    if (!t) return null;
    const v = t[c];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };

  const segmentsFor = (t) => {
    if (!t) return null;
    const reaction = num(t, 'reaction_time_s');
    const flight   = num(t, 'flight_phase_s');
    // v02.21 — abs time-base correction. abs_time_surface_break is
    // VIDEO-relative; subtract abs_time_start_signal to get race-relative
    // breakout time before comparing against split_15m_s (race-relative).
    const startSig = num(t, 'abs_time_start_signal');
    const surfaceAbs = num(t, 'abs_time_surface_break');
    const surface = (surfaceAbs != null && startSig != null) ? surfaceAbs - startSig : null;
    const fifteen  = num(t, 'split_15m_s');
    if (reaction == null || flight == null || surface == null || fifteen == null) {
      return null;
    }
    const block = reaction;
    const flightSpan = flight;
    const flightEnd = block + flightSpan;
    let underwater = surface - flightEnd;
    let surfaceSpan = fifteen - surface;
    let invertedSurface = false;
    if (underwater < 0) underwater = 0;
    // Athlete still underwater at 15 m — fold negative surface
    // back into underwater so the bar geometry stays clean.
    if (surfaceSpan < 0) {
      underwater += -surfaceSpan;
      surfaceSpan = 0;
      invertedSurface = true;
    }
    return {
      total: fifteen,
      Block:      block,
      Flight:     flightSpan,
      Underwater: underwater,
      Surface:    surfaceSpan,
      invertedSurface,
    };
  };

  const a = segmentsFor(primary);
  const b = compare ? segmentsFor(compare) : null;

  if (!a) {
    return (
      <div style={{
        padding: 16, borderRadius: 12,
        background: 'var(--bg-2)', border: '1px solid var(--line-soft)',
        font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
        textAlign: 'center',
      }}>
        Phase contribution unavailable — needs reaction, flight, breakout, and 15m times.
      </div>
    );
  }

  // Normalize bar widths against the larger total so a slower
  // trial visibly extends past a faster one in compare mode.
  const maxTotal = Math.max(a.total, b ? b.total : 0);

  // v01.55 — Flight color fixed. The token --violet-eff doesn't
  // exist in tokens.css; the fallback was --signal-eff which is
  // the same as Underwater (visually indistinguishable). Switched
  // to --compare-eff which IS a violet (oklch(72% 0.14 285)) and
  // is already part of the design system. The compare-slot UI
  // never renders alongside this chart, so no semantic conflict.
  const PHASES = [
    { key: 'Block',      color: 'var(--amber-eff)' },
    { key: 'Flight',     color: 'var(--compare-eff)' },
    { key: 'Underwater', color: 'var(--signal-eff)' },
    { key: 'Surface',    color: 'var(--lime-eff)' },
  ];

  const fmtSec = (v) => v == null ? '—' : (v < 1 ? v.toFixed(2) : v.toFixed(2)) + ' s';
  const pct = (v, total) => total > 0 ? Math.round((v / total) * 1000) / 10 : 0;

  const Row = ({ row, label, accent }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <span className="eyebrow" style={{
        minWidth: 72, color: 'var(--tx-lo)', letterSpacing: 0.08,
      }}>
        {label}
      </span>
      <div style={{
        flex: 1, position: 'relative', height: 30, borderRadius: 6,
        background: 'var(--bg-3)', overflow: 'hidden', display: 'flex',
      }}>
        {PHASES.map((p, i) => {
          const v = row[p.key];
          if (v == null || v <= 0) return null;
          const w = (v / maxTotal) * 100;
          const segPct = pct(v, row.total);
          // Hide label when segment is too narrow (< 10% of bar width).
          const showLabel = w >= 10;
          return (
            <div
              key={p.key}
              title={p.key + ': ' + fmtSec(v) + ' (' + segPct + '%)'}
              style={{
                width: w + '%',
                background: p.color,
                borderRight: i < PHASES.length - 1 ? '1px solid var(--bg)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                font: '600 10px var(--font-mono)',
                color: 'var(--ink)', letterSpacing: 0.04,
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
              {showLabel ? fmtSec(v) : ''}
            </div>
          );
        })}
      </div>
      <span style={{
        minWidth: 64, textAlign: 'right',
        font: '600 13px var(--font-mono)', color: 'var(--tx-hi)',
      }}>
        {fmtSec(row.total)}
      </span>
    </div>
  );

  const cmpLabel = compare
    ? (compare._benchmarkKind === 'PB'      ? 'PB'
     : compare._benchmarkKind === 'MEDIAN'  ? 'MEDIAN'
                                              : (compareLabel || 'COMPARE'))
    : null;

  return (
    <div>
      <Row row={a} label="PRIMARY" accent="var(--lime-eff)"/>
      {b && cmpLabel && (
        <Row row={b} label={cmpLabel} accent="var(--compare-eff)"/>
      )}
      {/* Legend: 4 colored swatches — each phase's accent + name +
          percentage of primary's total. Renders in a flex-wrap
          row so it adapts to narrow widths. */}
      <div style={{
        display: 'flex', gap: 12, marginTop: 10, padding: '0 2px',
        flexWrap: 'wrap',
      }}>
        {PHASES.map(p => {
          const v = a[p.key];
          const segPct = pct(v, a.total);
          return (
            <span key={p.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              font: '500 11px var(--font-ui)', color: 'var(--tx-md)',
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2, background: p.color,
              }}/>
              {p.key}
              <span style={{ color: 'var(--tx-lo)' }}>· {segPct}%</span>
            </span>
          );
        })}
      </div>
      {a.invertedSurface && (
        <div style={{
          font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
          marginTop: 8, fontStyle: 'italic',
        }}>
          Note: athlete still underwater at 15 m — surface phase folded into underwater.
        </div>
      )}
    </div>
  );
};

// ── PhaseDetail (Option C, v00.30; v00.32 adds UW velocity chart) ─
// Per-phase detail card. Picks rows from existing v_start_kpis cols.
// Each row in compare mode shows primary / compare / Δ stacked,
// reusing the Stroke Mechanics three-line idiom.
//
// Direction tags ('lower' / 'higher') drive the Δ chip color:
//   lower  → negative delta is good (lime), positive bad (flag)
//   higher → positive delta is good (lime), negative bad (flag)
//
// Underwater tab leads with a 5-station velocity line chart
// (v00.32) above the rows table. Surface still thin; more columns
// land when v_start_kpis exposes them.
const PhaseDetail = ({ phase, primary, compare }) => {
  const ranges = {
    Block:      'OFF-BLOCK BREAKDOWN',
    Flight:     'TAKEOFF → ENTRY',
    Underwater: 'ENTRY → BREAKOUT',
    Surface:    'BREAKOUT → 15 m',
  };
  const name = phase || 'Block';
  const num = (t, col) => {
    if (!t) return null;
    const v = t[col];
    return (v == null || isNaN(parseFloat(v))) ? null : parseFloat(v);
  };
  // Latency = signal → first movement on the block. Templo's
  // block_reaction_s column is unreliable in our real data — some
  // trials store an absolute timestamp (e.g. 3.51 s) rather than the
  // signal-to-first-movement interval. Trust it ONLY when it falls
  // inside [0, reaction_time_s]; otherwise derive latency from
  // reaction_time_s − push_time_s so the rows stay consistent with
  // the bar geometry (Latency + Push = Reaction).
  const latencyOf = (t) => {
    const r = num(t, 'reaction_time_s');
    const p = num(t, 'push_time_s');
    const explicit = num(t, 'block_reaction_s');
    if (explicit != null && r != null && explicit >= 0 && explicit <= r) {
      return explicit;
    }
    if (r == null || p == null) return null;
    const v = +(r - p).toFixed(3);
    return v < 0 ? 0 : v;
  };
  // Underwater duration is computed as surface break − flight end.
  // Flight end = reaction_time_s + flight_phase_s (reaction already
  // includes push, so we DO NOT add push here — that was a v00.34
  // bug fix riding along with the Block redefinition).
  //
  // v02.21 — abs time-base correction. abs_time_surface_break is
  // VIDEO-relative (camera timestamps). To get race-relative time we
  // subtract abs_time_start_signal. Helper `sbRace(t)` does this
  // consistently for both helpers below. Prior to this fix, the math
  // mixed two time bases and was off by the value of start_signal.
  const sbRace = (t) => {
    if (!t) return null;
    const sb = num(t, 'abs_time_surface_break');
    const sig = num(t, 'abs_time_start_signal');
    return (sb != null && sig != null) ? sb - sig : null;
  };
  const surfaceToFifteen = (t) => {
    const sb = sbRace(t);
    const t15 = num(t, 'split_15m_s');
    return (sb != null && t15 != null) ? t15 - sb : null;
  };
  const underwaterDuration = (t) => {
    const r = num(t, 'reaction_time_s');
    const f = num(t, 'flight_phase_s');
    const flightEnd = (r != null && f != null) ? r + f : null;
    const sb = sbRace(t);
    return (flightEnd != null && sb != null && sb > flightEnd) ? sb - flightEnd : null;
  };

  // tip = HelpDot copy. Optional per row; renders an "i" icon next
  // to the row label that toggles a popover with the explanation.
  const rowsByPhase = {
    Block: [
      { k: 'Reaction', p: num(primary, 'reaction_time_s'), c: num(compare, 'reaction_time_s'), u: 's', dec: 2, dir: 'lower',
        tip: 'Total off-block time: from start signal to feet leaving the block. Equals Latency + Push.' },
      { k: 'Latency',  p: latencyOf(primary),              c: latencyOf(compare),              u: 's', dec: 2, dir: 'lower',
        tip: 'Pre-movement time: from start signal to first movement on the block. Sometimes called auditory reaction time.' },
      { k: 'Push',     p: num(primary, 'push_time_s'),     c: num(compare, 'push_time_s'),     u: 's', dec: 3, dir: 'lower',
        tip: 'Push phase: from first movement on the block to feet leaving the block.' },
    ],
    Flight: [
      { k: 'Flight phase',   p: num(primary, 'flight_phase_s'),         c: num(compare, 'flight_phase_s'),         u: 's', dec: 3, dir: 'lower'  },
      { k: 'Hip @ takeoff',  p: num(primary, 'height_hip_takeoff'),     c: num(compare, 'height_hip_takeoff'),     u: 'm', dec: 2, dir: 'higher' },
      { k: 'Entry distance', p: num(primary, 'distance_to_water_entry'),c: num(compare, 'distance_to_water_entry'),u: 'm', dec: 2, dir: 'higher' },
      { k: 'Entry angle',    p: num(primary, 'angle_hip_entry_deg'),    c: num(compare, 'angle_hip_entry_deg'),    u: '°', dec: 1, dir: 'lower'  },
    ],
    // Underwater rows pull directly from v_start_kpis columns the
    // live dashboard already reads. Velocity progression (hands
    // entry → kick 1 → 3 kicks → stroke 1 → stroke 2) is better
    // suited to a line chart and lands in v00.32+. Here we surface
    // two anchor velocities (entry and mid-UW at 3 kicks) plus the
    // headline kick / surface metrics.
    // v02.21 — "Surface break" and "Deepest dive" now display race-relative
    // time (seconds from start signal). Before the fix, they showed the
    // raw video-absolute value, which read as misleading (a swimmer would
    // see "10.30 s" for surface break when their race time was 6.88 s).
    Underwater: [
      { k: 'Kick rate',           p: num(primary, 'kick_rate'),               c: num(compare, 'kick_rate'),               u: '/min', dec: 1, dir: 'higher' },
      { k: 'Surface break',       p: sbRace(primary),                         c: sbRace(compare),                         u: 's',    dec: 2, dir: 'lower'  },
      { k: 'Deepest dive',        p: (function(){ const a=num(primary,'abs_time_deepest_dive'),s=num(primary,'abs_time_start_signal'); return (a!=null&&s!=null)?a-s:null; })(),
                                  c: (function(){ const a=num(compare,'abs_time_deepest_dive'),s=num(compare,'abs_time_start_signal'); return (a!=null&&s!=null)?a-s:null; })(),
                                  u: 's',    dec: 2, dir: 'neutral'},
      { k: 'Vel @ hands entry',   p: num(primary, 'hor_vel_hands_entry'),     c: num(compare, 'hor_vel_hands_entry'),     u: 'm/s',  dec: 2, dir: 'higher' },
      { k: 'Vel @ 3 kicks',       p: num(primary, 'hor_vel_hip_3kicks'),      c: num(compare, 'hor_vel_hip_3kicks'),      u: 'm/s',  dec: 2, dir: 'higher' },
      { k: 'Underwater duration', p: underwaterDuration(primary),             c: underwaterDuration(compare),             u: 's',    dec: 2, dir: 'lower'  },
    ],
    Surface: (() => {
      // v02.21 — Surface tab content refined. The ultimate metric for a
      // start is time-to-15m; the Surface tab now breaks down exactly
      // what happened in the breakout-to-15m segment:
      //   • Surface duration (or "Underwater past 15 m" for fast kickers)
      //   • Breakout location — interpolated from split_10m / split_15m
      //     and the race-relative breakout time. Shown as approximate
      //     (~XX.X m) since it's a derived estimate, not a direct measure.
      //   • 10-15m avg velocity — direct from v_start_kpis (avg_vel_10_15).
      //     Most of this zone is post-breakout for typical breakouts.
      //   • Strokes before 15m — count of abs_time_stroke{1..3} timestamps
      //     that fall between the (race-relative) breakout and 15m times.
      //     Most elite kickers will have 0-2 here.
      //   • First-stroke delay — time from breakout to first stroke.
      //     Suppressed when no stroke is recorded before 15m.
      //
      // v00.83 — when breakout happens AFTER the swimmer hit 15m, the
      // surface duration goes negative ("still underwater at 15m") —
      // we surface that as "Underwater past 15 m" with inverted direction.

      // --- Breakout location, interpolated between adjacent splits ---
      const breakoutDistance = (t) => {
        const sb = sbRace(t);
        if (sb == null) return null;
        const s5  = num(t, 'split_5m_s');
        const s10 = num(t, 'split_10m_s');
        const s15 = num(t, 'split_15m_s');
        if (s10 != null && s15 != null && sb >= s10 && sb <= s15) {
          return 10 + 5 * ((sb - s10) / (s15 - s10));
        }
        if (s5 != null && s10 != null && sb >= s5 && sb < s10) {
          return 5 + 5 * ((sb - s5) / (s10 - s5));
        }
        if (s15 != null && sb > s15) return null; // inverted — handled elsewhere
        return null;
      };

      // v02.22 — "Strokes to 15 m" and "First stroke after breakout"
      // metrics removed. Both relied on abs_time_stroke{1..3} timestamps,
      // and Eric confirmed the values they produced did NOT match what's
      // visible in the source video. Until the underlying stroke timing
      // data is verified end-to-end (Templo export → DB → app), suppressing
      // both rows protects analysis credibility. Better to omit than to
      // present numbers that contradict the user's own eyes.

      const sP = surfaceToFifteen(primary);
      const sC = surfaceToFifteen(compare);
      const inverted = sP != null && sP < 0;

      const rows = [
        {
          k: inverted ? 'Underwater past 15 m' : 'Surface → 15 m',
          p: sP == null ? null : Math.abs(sP),
          c: sC == null ? null : Math.abs(sC),
          u: 's', dec: 2,
          dir: inverted ? 'higher' : 'lower',
          tip: inverted
            ? 'Stayed underwater past the 15 m mark. Strong underwater kicking — keep going farther before breakout for an even better time-to-15m.'
            : 'Time from the moment your head broke the surface until you hit the 15 m mark.',
        },
      ];

      // Breakout location — only show when NOT inverted (otherwise it's null)
      if (!inverted) {
        rows.push({
          k: 'Breakout location',
          p: breakoutDistance(primary),
          c: breakoutDistance(compare),
          u: 'm', dec: 1,
          dir: 'higher',
          // Shown with ~ prefix to indicate it's interpolated from splits.
          approx: true,
          tip: 'Approximate distance from the wall where you broke the surface. Derived from your breakout time and adjacent split times.',
        });
      }

      rows.push(
        { k: '10–15 m velocity', p: num(primary, 'avg_vel_10_15'), c: num(compare, 'avg_vel_10_15'), u: 'm/s', dec: 2, dir: 'higher',
          tip: 'Average horizontal velocity over the final 5 m before the 15 m mark.' },
      );

      // v02.22 — Stroke-count + first-stroke-delay rows removed (see note
      // above the surfaceToFifteen call). Re-enable once stroke timestamps
      // are validated against video.

      return rows;
    })(),
  };
  const rows = rowsByPhase[name] || [];
  const showCompare = !!compare;

  // v02.21 — `approx` prefixes the formatted value with `~` to signal
  // that the number is interpolated/estimated rather than directly
  // measured. Used by the breakout-location row in the Surface tab.
  const fmtVal = (v, dec, u, approx) => v == null
    ? '—'
    : ((approx ? '~' : '') + v.toFixed(dec) + (u ? ' ' + u : ''));
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

  // v00.42: per-tab phase-specific visuals — each tab carries a
  // distinct payload so the timeline is real navigation, not chrome.
  //   Block      → BlockSplitBar (Latency + Push) + BlockVelocityChart
  //                (meter-axis with PEAK callout)
  //   Flight     → FlightPathChart (side-profile dive arc, takeoff →
  //                entry geometry)
  //   Underwater → PhaseHero + UnderwaterVelocityChart
  //   Surface    → PhaseHero + PhaseContributionBar + rows
  const showBlockSplitBar  = name === 'Block';
  const showBlockVelCard   = name === 'Block';
  const showFlightPathChart = name === 'Flight';
  const showUWVelChart     = name === 'Underwater';
  const showUWHero         = name === 'Underwater';
  const showSurfaceHero    = name === 'Surface';
  const showContributionBar = name === 'Surface';

  const compareLabel = compare
    ? (compare._benchmarkKind === 'PB'      ? 'PB'
     : compare._benchmarkKind === 'MEDIAN'  ? 'MEDIAN'
                                              : 'COMPARE')
    : null;

  // v01.55 — Hero sentences for Underwater + Surface tabs.
  // v03.10 — `sentence` is a fully pre-colored React node. Every
  // number is a colored span: PRIMARY values green (--lime-eff),
  // COMPARE-related values (verdict delta) purple (--compare-eff),
  // matching the chart legend. In compare mode the self-context
  // tail swaps for the verdict clause.
  const heroProps = (() => {
    const fmtSec = (v, d = 2) => v == null ? null : v.toFixed(d) + ' s';
    // Colored-span helpers. G = primary (green), P = compare (purple).
    const G = (txt) => <span style={{ color: 'var(--lime-eff)' }}>{txt}</span>;
    const P = (txt) => <span style={{ color: 'var(--compare-eff)' }}>{txt}</span>;

    // Compare-target name. Benchmark holder names are never surfaced
    // (CLAUDE.md) — only the kind.
    const targetName = compare
      ? (compare._benchmarkKind === 'PB'     ? 'your best'
       : compare._benchmarkKind === 'MEDIAN' ? 'your median'
                                              : 'compare')
      : null;

    // verdict — Approach A comparative clause. Returns { mag, rest }
    // where mag is the compare-delta magnitude (purple) and rest is
    // the directional phrase + target. null when nothing to compare.
    const verdict = (delta, goodDir, betterWord, worseWord, magStr) => {
      if (delta == null) return null;
      if (delta === 0) return { mag: null, rest: 'matching ' + targetName };
      const better = goodDir === 'higher' ? delta > 0 : delta < 0;
      return { mag: magStr, rest: (better ? betterWord : worseWord) + ' ' + targetName };
    };
    // tail — assembles the " — <purple mag> <rest>." verdict node.
    const tail = (v) => v.mag
      ? <> — {P(v.mag)} {v.rest}.</>
      : <> — {v.rest}.</>;

    if (showUWHero) {
      // v02.22 — peak uses the peakVelocity helper (max across all
      // measured velocity samples), matching the Peak Velocity metric.
      const peak = window.PA_STARTS?.peakVelocity?.(primary) ?? num(primary, 'hor_vel_hip_flight');
      const last = num(primary, 'hor_vel_hip_stroke2');
      const retention = (peak != null && last != null && peak > 0)
        ? Math.round((last / peak) * 100)
        : null;
      const dur = underwaterDuration(primary);
      if (retention != null) {
        const cmpPeak = compare ? (window.PA_STARTS?.peakVelocity?.(compare) ?? num(compare, 'hor_vel_hip_flight')) : null;
        const cmpLast = compare ? num(compare, 'hor_vel_hip_stroke2') : null;
        const cmpRetention = (cmpPeak != null && cmpLast != null && cmpPeak > 0)
          ? Math.round((cmpLast / cmpPeak) * 100) : null;
        const hl = retention + '%';
        const d = cmpRetention != null ? (retention - cmpRetention) : null;
        const magAbs = Math.abs(d || 0);
        const v = verdict(d, 'higher', 'above', 'below',
                          magAbs + ' point' + (magAbs === 1 ? '' : 's'));
        return {
          sentence: v
            ? <>You retained {G(hl)} of peak velocity{tail(v)}</>
            : <>You retained {G(hl)} of peak velocity through your second stroke.</>,
          subtext: dur != null ? fmtSec(dur) + ' from entry to breakout.' : '',
        };
      }
      // Fallback when velocity columns aren't populated — lead with duration.
      const cmpDur = compare ? underwaterDuration(compare) : null;
      const durStr = dur != null ? dur.toFixed(2) + ' s' : null;
      const d = (dur != null && cmpDur != null) ? +(dur - cmpDur).toFixed(2) : null;
      const v = verdict(d, 'lower', 'shorter than', 'longer than',
                        Math.abs(d || 0).toFixed(2) + ' s');
      return {
        sentence: !durStr
          ? 'Underwater duration unavailable for this trial.'
          : v
            ? <>You spent {G(durStr)} underwater{tail(v)}</>
            : <>You spent {G(durStr)} underwater from entry to breakout.</>,
        subtext: 'Time from water entry to head breaking the surface.',
      };
    }

    if (showSurfaceHero) {
      const surfaceTime = surfaceToFifteen(primary);
      const total = num(primary, 'split_15m_s');
      const inverted = surfaceTime != null && surfaceTime < 0;
      // v02.21 — When the swimmer reaches 15 m while still underwater
      // (common with elite kickers), flip the framing to recognize the
      // extended underwater work instead of reporting a negative surface.
      if (inverted) {
        const overshoot = Math.abs(surfaceTime).toFixed(2) + ' s';
        return {
          sentence: <>Stayed underwater past the 15 m mark by {G(overshoot)}.</>,
          subtext: 'Strong underwater kicking — your breakout happened after the 15 m line.',
        };
      }
      const sharePct = (surfaceTime != null && total != null && total > 0)
        ? Math.round((surfaceTime / total) * 100)
        : null;
      if (sharePct != null && surfaceTime != null) {
        const durStr = surfaceTime.toFixed(2) + ' s';
        const cmpSurface = compare ? surfaceToFifteen(compare) : null;
        const d = cmpSurface != null ? +(surfaceTime - cmpSurface).toFixed(2) : null;
        const v = verdict(d, 'lower', 'tighter than', 'longer than',
                          Math.abs(d || 0).toFixed(2) + ' s');
        return {
          sentence: v
            ? <>Surface phase covered {G(durStr)}{tail(v)}</>
            : <>Surface phase covered {G(durStr)} from breakout to 15 m.</>,
          subtext: sharePct + '% of your time to the 15 m mark.',
        };
      }
      return {
        sentence: 'Surface phase data unavailable for this trial.',
        subtext: 'Needs breakout time + 15 m split.',
      };
    }

    return null;
  })();

  return (
    <ChartCard title={(name + ' · ' + (ranges[name] || '')).toUpperCase()}>
      {/* v01.54 — Hero sentence for Underwater + Surface tabs.
          v01.55 — redesigned to match HeadlineStory pattern from
          AthleteDeck (sentence-with-highlight + subtext + optional
          delta chip). Lands first so the narrative reads before
          the supporting chart / rows. */}
      {heroProps && (
        <PhaseHero {...heroProps}/>
      )}
      {showBlockSplitBar && (
        <div style={{ marginBottom: 18 }}>
          <BlockSplitBar primary={primary} compare={compare}/>
        </div>
      )}
      {showBlockVelCard && (
        <div style={{ marginBottom: 18 }}>
          <BlockVelocityChart primary={primary} compare={compare}/>
        </div>
      )}
      {showFlightPathChart && (
        <div style={{ marginBottom: 18 }}>
          <FlightPathChart primary={primary} compare={compare}/>
        </div>
      )}
      {showUWVelChart && (
        <div style={{ marginBottom: 18 }}>
          <UnderwaterVelocityChart primary={primary} compare={compare}/>
        </div>
      )}
      {/* v01.54 — Phase Contribution stacked bar on Surface tab.
          Shows where time was spent across all 4 phases — answers
          "is my underwater dominant or my surface dragging?" at
          a glance. */}
      {showContributionBar && (
        <div style={{ marginBottom: 18 }}>
          <PhaseContributionBar
            primary={primary}
            compare={compare}
            compareLabel={compareLabel}
          />
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
                    <span style={valStyle}>{fmtVal(r.p, r.dec, r.u, r.approx)}</span>
                    {showCompare && (
                      <span style={cmpStyle}>{fmtVal(r.c, r.dec, r.u, r.approx)}</span>
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

window.WebStarts = WebStarts;
window.WebTeamStarts = WebTeamStarts;

try { console.log('[web-starts] loaded (v01.56)'); } catch (_) {}
