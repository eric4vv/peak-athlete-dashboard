/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Supabase client + auth helpers + role detection

   Connects to the existing Peak Athlete Supabase project
   (READ-ONLY from the prototype — no writes until v03 ships).

   Role detection mirrors the live dashboard: query v_my_athlete
   first, fall back to v_my_coach. Both views are RLS-filtered
   to the current user, so each returns 0 or 1 row.

   Wrapped in an IIFE to avoid clashing with window.supabase
   (the global exposed by the CDN UMD build).
   ─────────────────────────────────────────────────────────── */

(function () {
  const SUPABASE_URL = 'https://wbqgshvbopfukwyqsndq.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndicWdzaHZib3BmdWt3eXFzbmRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMDk4OTAsImV4cCI6MjA4NDU4NTg5MH0.lmbqvVTyfmlkgkUCo8dAGZuK7Z9tGXUA4Fq9FAsmvhU';

  // Email redirect for magic-link / email confirmation flows.
  // Not used for password sign-in, but set here for parity with live.
  const AUTH_REDIRECT_URL = 'https://www.mypeakathlete.com/blank-3';

  // Create client (uses window.supabase, exposed by the CDN UMD build)
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  // ── Auth ─────────────────────────────────────────────────

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  function onAuthChange(cb) {
    // cb receives (event, session)
    return client.auth.onAuthStateChange(cb);
  }

  async function signInWithEmail(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    return { session: data?.session || null, error };
  }

  // v01.10 — sign up new user with email + password + profile metadata.
  // `metadata` is the shape Supabase stores under `auth.users.raw_user_meta_data`
  // and is what live's account-creation flow uses to seed downstream
  // `athletes` / `coaches` rows via DB triggers. Expected fields:
  //   { first_name, last_name, gender, role: 'athlete'|'coach' }
  // Coaches sign up WITHOUT a team code per the locked Batch 1b decision —
  // team join/create happens post-login in Batch 1c via the "no team yet"
  // empty state on Coach Deck.
  async function signUpWithEmail(email, password, metadata = {}) {
    const { data, error } = await client.auth.signUp({
      email, password,
      options: {
        data: metadata,
        emailRedirectTo: AUTH_REDIRECT_URL,
      },
    });
    return {
      session: data?.session || null,
      user: data?.user || null,
      error,
    };
  }

  // v01.10 — kick off Supabase's recovery email flow. The user gets an
  // email with a link that includes `#access_token=...&type=recovery` in
  // its hash; clicking lands them on AUTH_REDIRECT_URL with that hash,
  // and the AuthScreen detects the recovery hash to switch into reset
  // mode (wired in v01.12).
  async function requestPasswordReset(email) {
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: AUTH_REDIRECT_URL,
    });
    return { ok: !error, data, error };
  }

  // v01.10 — set a new password while signed in. Used after the user
  // arrives via a recovery link (the link auto-creates a recovery
  // session). Per Supabase docs, calling updateUser with `password` is
  // the standard finish-reset path.
  async function updatePassword(newPassword) {
    const { data, error } = await client.auth.updateUser({ password: newPassword });
    return { user: data?.user || null, error };
  }

  // v01.10 — re-send the email verification link. Useful on the
  // "Check your email" landing card after sign-up.
  async function resendVerification(email) {
    const { data, error } = await client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: AUTH_REDIRECT_URL },
    });
    return { ok: !error, data, error };
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    return { error };
  }

  // ── Consent (v01.13) ─────────────────────────────────────
  // Wraps the existing `check_user_consent` / `record_user_consent`
  // RPCs in the production database. Both share the same canonical
  // version with live: `'v1.0'` (confirmed via Supabase audit;
  // consent_logs already has 32 rows from real users at v1.0).
  //
  // RPC signatures (locked server-side, same project as live):
  //   check_user_consent(p_required_version DEFAULT 'v1.0')
  //     → TABLE(has_consent boolean, consent_version text, consent_date timestamptz)
  //   record_user_consent(p_consent_type DEFAULT 'combined',
  //                       p_version DEFAULT 'v1.0',
  //                       p_ip_address text DEFAULT NULL,
  //                       p_user_agent text DEFAULT NULL)
  //     → boolean (true on insert)
  //
  // record_user_consent ALSO mirrors the acceptance into
  // athletes.consent_accepted_at + consent_version for quick lookup.
  // Both apps stay in sync via the shared DB.

  const CONSENT_VERSION = 'v1.0';

  async function checkConsent(requiredVersion = CONSENT_VERSION) {
    const { data, error } = await client.rpc('check_user_consent', {
      p_required_version: requiredVersion,
    });
    if (error) {
      console.warn('[supabase] check_user_consent error:', error.message);
      return { hasConsent: false, version: null, date: null, error };
    }
    // RPC returns TABLE — supabase-js gives us an array; first row has fields.
    const row = Array.isArray(data) ? data[0] : data;
    return {
      hasConsent: !!row?.has_consent,
      version:    row?.consent_version || null,
      date:       row?.consent_date    || null,
      error:      null,
    };
  }

  async function recordConsent(version = CONSENT_VERSION, consentType = 'combined') {
    // user_agent is the only client-side signal worth recording from
    // the browser. ip_address is left null — Supabase can fill it via
    // x-forwarded-for if a proxy is configured; we don't have a clean
    // way to source the real client IP from the prototype.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || null;
    const { data, error } = await client.rpc('record_user_consent', {
      p_consent_type: consentType,
      p_version:      version,
      p_ip_address:   null,
      p_user_agent:   ua,
    });
    return { ok: !!data && !error, error };
  }

  // ── Role + profile ──────────────────────────────────────

  // Returns { role: 'athlete'|'coach'|null, profile: object|null }
  // RLS on v_my_athlete / v_my_coach filters to the current user.
  // v01.68 — both queries wrapped in withRecovery() so a stuck
  // supabase client doesn't strand AuthGate at "Checking session…"
  // forever. function-hoisted within this IIFE so it's safe to call
  // here even though declared further down.
  async function loadCurrentProfile() {
    const { data: athlete, error: aErr } = await withRecovery(
      () => client.from('v_my_athlete').select('*').maybeSingle(),
      { label: 'v_my_athlete loadCurrentProfile' }
    );
    if (athlete) return { role: 'athlete', profile: athlete };
    if (aErr && aErr.code !== 'PGRST116') console.warn('[supabase] v_my_athlete error:', aErr);

    const { data: coach, error: cErr } = await withRecovery(
      () => client.from('v_my_coach').select('*').maybeSingle(),
      { label: 'v_my_coach loadCurrentProfile' }
    );
    if (coach) return { role: 'coach', profile: coach };
    if (cErr && cErr.code !== 'PGRST116') console.warn('[supabase] v_my_coach error:', cErr);

    return { role: null, profile: null };
  }

  // ── withRecovery (v01.68) ────────────────────────────────
  // 3-tier watchdog for hung Supabase queries. Rare-but-real
  // supabase-js failure mode where the client's internal state
  // (token refresh promise, etc) gets stuck and a query never
  // even fires to the network — Network tab shows no request,
  // page stuck in loading. Reproduced by Eric across Brave +
  // Edge so it's a client-state issue, not browser-specific.
  //
  // Tier 1 (most common): query timeout → force refreshSession
  //   → retry the query once. Recovers without user noticing.
  // Tier 2: refresh or retry fails → local signOut + page
  //   reload. User stays signed in via stored refresh token,
  //   just sees a brief reload.
  // Tier 3: refresh token has rotted entirely → user lands on
  //   sign-in screen (handled by AuthGate's existing logic).
  //
  // Usage:
  //   const { data, error } = await window.PA_AUTH.withRecovery(
  //     () => client.from('v_race_kpis').select('*'),
  //     { label: 'v_race_kpis listTrials', timeoutMs: 15000 }
  //   );
  //
  // The wrapped function is RE-INVOKED on retry (not awaited
  // again) so the underlying supabase client gets a chance to
  // re-mint the query against the refreshed token.
  async function withRecovery(queryFn, opts) {
    const o = opts || {};
    const timeoutMs = o.timeoutMs || 15000;
    const label = o.label || 'query';
    const timeoutPromise = (ms) => new Promise((_, rej) =>
      setTimeout(() => rej(new Error('__withRecovery_timeout')), ms)
    );

    // Attempt 1 — fire as normal with timeout.
    try {
      return await Promise.race([queryFn(), timeoutPromise(timeoutMs)]);
    } catch (e) {
      if (e?.message !== '__withRecovery_timeout') throw e;
      try { console.warn('[withRecovery] ' + label + ' timed out — attempting refreshSession'); } catch (_) {}
    }

    // Tier 1 — force token refresh, retry query once.
    let refreshed = false;
    try {
      await Promise.race([
        client.auth.refreshSession(),
        timeoutPromise(5000),
      ]);
      refreshed = true;
    } catch (e) {
      try { console.warn('[withRecovery] refreshSession failed: ' + (e?.message || e)); } catch (_) {}
    }

    if (refreshed) {
      try {
        return await Promise.race([queryFn(), timeoutPromise(timeoutMs)]);
      } catch (e) {
        if (e?.message !== '__withRecovery_timeout') throw e;
        try { console.warn('[withRecovery] retry timed out too'); } catch (_) {}
      }
    }

    // Tier 2 — recover via local signOut + reload. User stays
    // signed in via the stored refresh token on the new page.
    try { console.warn('[withRecovery] forcing client recovery via local signOut + reload'); } catch (_) {}
    try {
      await Promise.race([
        client.auth.signOut({ scope: 'local' }),
        timeoutPromise(3000),
      ]);
    } catch (_) {}
    setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 100);
    throw new Error('client recovery — page will reload');
  }

  // ── Expose to the rest of the app ────────────────────────
  window.supabaseClient = client;
  window.PA_AUTH = {
    getSession, onAuthChange,
    signInWithEmail, signUpWithEmail,
    requestPasswordReset, updatePassword, resendVerification,
    signOut, loadCurrentProfile,
    checkConsent, recordConsent, CONSENT_VERSION,
    SUPABASE_URL, SUPABASE_KEY, AUTH_REDIRECT_URL,
    withRecovery,
  };

  // ── Visibility-change health probes (v01.73) ────────────
  // Targeted at the Stripe-return scenario:
  // user clicks Buy → Stripe tab opens → closes Stripe without
  // purchasing → returns to Lab → supabase client is internally
  // wedged → next tab click hangs.
  //
  // Two probes fire on each visibility-becomes-visible event:
  //
  //   Probe A (immediate, t=0)
  //   Catches the case where the client was ALREADY stuck before
  //   the user returned (rare). Throttled to once per 30s.
  //
  //   Probe B (delayed, t=1500ms)
  //   Catches the more common case where the client becomes wedged
  //   DURING the useRequests load() that fires on visibility change
  //   (4 parallel queries kick off → one breaks the client state).
  //   By 1.5 seconds in, the breakage has developed; probe B catches
  //   it. Worst-case user wait: ~3 seconds (1.5s delay + 1.5s probe
  //   timeout + reload), down from 5s in v01.73 and 15s withRecovery
  //   wait. Tuned in v01.74 — 1.5s is the lowest delay that still
  //   gives useRequests.load() enough headroom to actually wedge
  //   before we probe (queries normally complete <500ms healthy).
  //
  // Both probes hit the data path (not auth), since Eric's
  // diagnostic showed both auth.getSession() AND data queries hang
  // together when the client wedges. v_my_subscription is RLS-
  // filtered, returns 0 or 1 row, lightweight.
  let _lastImmediateProbeAt = 0;
  let _delayedProbeTimer = null;

  async function _runDataProbe(label) {
    try {
      await Promise.race([
        client.from('v_my_subscription').select('plan_id').maybeSingle(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('__probe_timeout')), 1500)
        ),
      ]);
      // Healthy.
    } catch (e) {
      if (e?.message === '__probe_timeout') {
        try { console.warn('[health-probe ' + label + '] supabase data path unresponsive, reloading'); } catch (_) {}
        try { window.location.reload(); } catch (_) {}
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      // Tab hidden — cancel any pending delayed probe so we don't
      // probe on a tab the user isn't even looking at.
      if (_delayedProbeTimer) {
        clearTimeout(_delayedProbeTimer);
        _delayedProbeTimer = null;
      }
      return;
    }

    // Probe A (immediate) — throttled to once per 30s
    const now = Date.now();
    if (now - _lastImmediateProbeAt >= 30000) {
      _lastImmediateProbeAt = now;
      _runDataProbe('immediate');
    }

    // Probe B (delayed) — always re-armed on visibility-become-visible
    if (_delayedProbeTimer) clearTimeout(_delayedProbeTimer);
    _delayedProbeTimer = setTimeout(() => {
      _delayedProbeTimer = null;
      _runDataProbe('delayed-1500ms');
    }, 1500);
  });
})();
