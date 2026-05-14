/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   useRequests — React hook wrapping PA_REQUESTS (READ-ONLY)

   Single source of truth for the Deck's action button and the
   "Your requests" card. Loads in parallel:
     - subscription  (v_my_subscription)
     - quota         (rpc check_analysis_quota)
     - requests      (race_requests, last 10)
     - pending count (race_requests where status in pending|processing)

   refresh() re-runs all four in parallel so callers (e.g. after
   Stripe return) can cheaply repoll.

   v00.16 — Stripe-return polling. armStripeReturn() marks that a
   checkout tab was opened. When the tab becomes visible again AND
   the flag is armed, we poll refresh() every 4s for up to ~60s,
   bailing early when the plan or quota changes. Pure reads — no
   writes, no edge POSTs.

   Exposed as window.usePARequests.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const { useState, useEffect, useCallback, useRef } = React;

  // Polling tuning. Stripe webhook typically lands within seconds
  // of checkout success; giving up after 60s means a slow webhook
  // still surfaces without leaving the UI stuck in "Checking…".
  const POLL_INTERVAL_MS = 4000;
  const POLL_MAX_MS      = 60000;

  function usePARequests(athleteUuid) {
    const [state, setState] = useState({
      loading: true,
      error: null,
      subscription: null,
      quota: null,       // { used, limit, hasQuota, status }
      requests: [],
      pending: 0,
    });

    // Separate flag so we can show a subtle "Checking for updates…"
    // pill while polling without colliding with the main loading
    // flag (which gates the whole card into a loading state).
    const [isPolling, setIsPolling] = useState(false);

    // Guard against setState-after-unmount when the user navigates
    // away mid-fetch.
    const mountedRef     = useRef(true);
    const armedRef       = useRef(false);  // set by armStripeReturn()
    const pollingRef     = useRef(false);  // true while a poll loop is in-flight
    const pollSnapshotRef= useRef(null);   // baseline to diff against for early-exit
    useEffect(() => () => { mountedRef.current = false; }, []);

    const load = useCallback(async () => {
      if (!window.PA_REQUESTS) {
        setState(s => ({ ...s, loading: false, error: new Error('PA_REQUESTS not loaded') }));
        return null;
      }
      const R = window.PA_REQUESTS;
      setState(s => ({ ...s, loading: true, error: null }));

      try {
        const [subRes, quoRes, reqRes, penRes] = await Promise.all([
          R.getSubscription(),
          athleteUuid ? R.getQuota(athleteUuid)                    : Promise.resolve({ data: null, error: null }),
          athleteUuid ? R.listRequests(athleteUuid, { limit: 10 }) : Promise.resolve({ data: [], error: null }),
          athleteUuid ? R.countPending(athleteUuid)                : Promise.resolve({ count: 0, error: null }),
        ]);

        if (!mountedRef.current) return null;

        const firstErr =
          subRes.error || quoRes.error || reqRes.error || penRes.error || null;

        const next = {
          loading: false,
          error: firstErr,
          subscription: subRes.data || null,
          quota: quoRes.data || null,
          requests: reqRes.data || [],
          pending: penRes.count || 0,
        };
        setState(next);
        return next;
      } catch (e) {
        if (!mountedRef.current) return null;
        setState(s => ({ ...s, loading: false, error: e }));
        return null;
      }
    }, [athleteUuid]);

    // Initial + athlete-change load.
    useEffect(() => { load(); }, [load]);

    // ── Stripe-return polling ────────────────────────────────
    // Compares a fresh load against the snapshot captured when the
    // poll started. We consider the purchase "landed" when any of:
    //   - plan_id changes (free -> pro)
    //   - quota.limit increases (extra pack credited)
    //   - subscription.status changes
    function hasChanged(baseline, fresh) {
      if (!baseline || !fresh) return false;
      const b = baseline, f = fresh;
      if ((b.subscription?.plan_id || null) !== (f.subscription?.plan_id || null)) return true;
      if ((b.subscription?.status  || null) !== (f.subscription?.status  || null)) return true;
      const bLim = b.quota?.limit ?? 0;
      const fLim = f.quota?.limit ?? 0;
      if (fLim > bLim) return true;
      return false;
    }

    const startPoll = useCallback(async () => {
      if (pollingRef.current) return; // already running
      pollingRef.current = true;
      setIsPolling(true);

      // Baseline from current state BEFORE the first poll, so the
      // change detector has something to diff against.
      pollSnapshotRef.current = {
        subscription: state.subscription,
        quota:        state.quota,
      };

      const started = Date.now();
      // Kick an immediate refresh so the user sees updates the moment
      // they come back, without waiting a full interval.
      let latest = await load();

      while (
        mountedRef.current &&
        pollingRef.current &&
        Date.now() - started < POLL_MAX_MS
      ) {
        if (latest && hasChanged(pollSnapshotRef.current, latest)) break;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (!mountedRef.current || !pollingRef.current) break;
        latest = await load();
      }

      pollingRef.current = false;
      if (mountedRef.current) setIsPolling(false);
    }, [load, state.subscription, state.quota]);

    // Arm the flag — call right before opening the Stripe tab so
    // we know to poll when the user returns.
    const armStripeReturn = useCallback(() => {
      armedRef.current = true;
    }, []);

    // Visibilitychange listener — when the tab becomes visible and
    // we were armed, run a fast health probe BEFORE starting the
    // 4-query poll. If the client is wedged (Stripe-close-without-
    // purchase scenario), the probe times out in ~2s and dispatches
    // pa:client-stuck → StuckBanner shows. Otherwise we proceed to
    // startPoll() as normal. v03.04 — avoids the prior behavior
    // where startPoll itself wedged on the broken client and the
    // user waited 15s for withRecovery to surface a banner.
    useEffect(() => {
      const onVis = async () => {
        if (document.visibilityState !== 'visible') return;
        if (!armedRef.current) return;
        armedRef.current = false;
        const probe = window.PA_AUTH?.probeStuckClient;
        if (probe) {
          const r = await probe('stripe-return').catch(() => ({ healthy: true }));
          if (!r.healthy) return; // banner already dispatched
        }
        startPoll();
      };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }, [startPoll]);

    // Derived helpers — cheap, computed each render.
    const R = window.PA_REQUESTS;
    const isPro      = R ? R.isPro(state.subscription)      : false;
    const isTrialing = R ? R.isTrialing(state.subscription) : false;
    const trialDays  = R ? R.trialDaysLeft(state.subscription) : null;

    // Action the button should take if clicked now.
    // 'upload'      -> has quota, open UploadModal
    // 'buy'         -> had a sub but ran out, open BuyAnalysisModal (quota-exceeded tone)
    // 'try'         -> no subscription at all, open BuyAnalysisModal (try-first tone)
    // 'loading'     -> quota not yet known
    const nextAction = (() => {
      if (state.loading || !state.quota) return 'loading';
      if (state.quota.hasQuota)           return 'upload';
      if (state.quota.status === 'none')  return 'try';
      return 'buy';
    })();

    return {
      ...state,
      isPro, isTrialing, trialDays,
      nextAction,
      isPolling,
      refresh: load,
      armStripeReturn,
    };
  }

  window.usePARequests = usePARequests;

  try { console.log('[usePARequests] loaded (v00.16)'); } catch (_) {}
})();
