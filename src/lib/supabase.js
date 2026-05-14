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
  // v03.05 — storageKey namespaces our auth storage so any leftover
  // localStorage cruft from the legacy @2 supabase-js version can't
  // interfere with the pinned 2.45.4 build. Side effect: users
  // currently signed in get logged out once (no auth token under the
  // new key) and need to sign in again. One-time cost.
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'pa-prototype-v03-auth',
    },
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

    // Tier 2 (v03.04) — surface a non-blocking banner instead of
    // force-reloading. Earlier behavior was to local-signOut + auto
    // reload, but Eric reported the reload disrupted his workflow:
    // mid-task, mid-modal, mid-scroll. Now we dispatch
    // pa:client-stuck and the StuckBanner component (shared.jsx)
    // renders a top banner with a Reload button — the user decides
    // when to recover. The query still throws so the caller can
    // render its empty state.
    try { console.warn('[withRecovery] ' + label + ' stuck after retry — surfacing banner'); } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('pa:client-stuck', {
        detail: { source: 'withRecovery:' + label },
      }));
    } catch (_) {}
    throw new Error('client recovery — banner surfaced');
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

  // ── Stripe-return health probe (v03.04) ────────────────
  // Removed the always-on visibility probes (v01.73/v01.74) because
  // they were too aggressive — fired on every tab switch and caused
  // surprise reloads even when the client was perfectly healthy.
  //
  // Replaced by: a SINGLE targeted probe that runs only when a
  // Stripe checkout was just opened. useRequests.armStripeReturn()
  // sets window.PA_AUTH._stripeArmed = true right before opening
  // the Stripe tab; on visibilitychange→visible, we probe once,
  // then disarm. If the probe times out, we dispatch the
  // pa:client-stuck event instead of force-reloading — the
  // StuckBanner component in shared.jsx renders a non-blocking
  // banner so the user decides when to recover.
  //
  // Probes the data path (not auth) since Eric's diagnostic showed
  // both auth.getSession() AND data queries hang together when the
  // client wedges. v_my_subscription is RLS-filtered, returns 0/1
  // rows, lightweight.
  async function probeStuckClient(label) {
    try {
      await Promise.race([
        client.from('v_my_subscription').select('plan_id').maybeSingle(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('__probe_timeout')), 2000)
        ),
      ]);
      return { healthy: true };
    } catch (e) {
      if (e?.message === '__probe_timeout') {
        try { console.warn('[stuck-probe ' + label + '] supabase data path unresponsive'); } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('pa:client-stuck', {
            detail: { source: label || 'probe' },
          }));
        } catch (_) {}
        return { healthy: false };
      }
      // Non-timeout error — propagate (RLS denial, network 4xx,
      // anything that isn't a wedge). Caller decides.
      throw e;
    }
  }

  // Expose so useRequests can call it on Stripe-return. The
  // visibility listener that fires the probe lives in useRequests
  // (it owns the armed state). supabase.js intentionally does NOT
  // add its own listener — that would double-probe on every
  // Stripe-return.
  window.PA_AUTH.probeStuckClient = probeStuckClient;
})();
