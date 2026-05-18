/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Auth screens — SignInCard, SignUpCard, ForgotCard,
   VerifySentCard, ResetCard, plus AuthScreen (mode router).

   Mounted by AuthGate (in index.html) when no session is
   active. Each card is a self-contained card visual; AuthScreen
   owns the mode state and routes between them.

   Design language: matches the Ink & Signal token system.
   Inline styles only (no CSS classes) so the file is portable
   and survives any later move out of index.html. The pre-React
   bootstrap shell HTML in index.html still uses the `.card-auth`
   CSS classes — those are for the loading flash before Babel
   compiles, not for these React-rendered cards.

   Mobile responsive via window.useIsMobile (v01.06). On phones
   the card padding tightens, the title scales down, and the
   shell vertical centering switches to top-aligned so long
   forms (Sign Up) don't get pushed off-screen.

   v01.10 ships with SignInCard + AuthScreen wrapper (mode
   plumbing in place). SignUp / Forgot / VerifySent / Reset
   cards land in v01.11 / v01.12.
   ─────────────────────────────────────────────────────────── */

const { useState: useAuthState, useEffect: useAuthEffect } = React;

// ── Style atoms (inline, mobile-aware) ───────────────────────
// Returns the full sheet, customized for mobile vs desktop. Each
// component grabs the sheet at render time so resizing flips
// styles without remount.
const authStyles = (isMobile) => ({
  shell: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: isMobile ? 'flex-start' : 'center',
    justifyContent: 'center',
    padding: isMobile ? '32px 16px' : '40px 20px',
    background: 'var(--bg)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    padding: isMobile ? 22 : 32,
    borderRadius: 18,
    background: 'var(--bg-2)',
    border: '1px solid var(--line)',
    boxShadow: 'var(--shadow)',
  },
  mark: {
    width: 44, height: 44, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
    color: 'var(--signal-eff)',
    font: '700 20px var(--font-display)',
    // v03.19 — centered at the top of the auth card.
    margin: '0 auto 18px',
  },
  h1: {
    font: '700 ' + (isMobile ? 20 : 24) + 'px var(--font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tx-hi)',
    margin: '0 0 6px',
  },
  sub: {
    font: '500 13px var(--font-ui)',
    color: 'var(--tx-lo)',
    margin: '0 0 22px',
    lineHeight: 1.5,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
  },
  label: {
    font: '600 11px var(--font-ui)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--tx-lo)',
  },
  input: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--bg-3)',
    color: 'var(--tx-hi)',
    font: '500 14px var(--font-ui)',
    outline: 'none',
    transition: 'border-color 0.15s',
    width: '100%',
    boxSizing: 'border-box',
  },
  btnPrimary: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--signal-eff)',
    color: 'var(--ink)',
    font: '700 14px var(--font-ui)',
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    marginTop: 8,
  },
  btnGhost: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'transparent',
    color: 'var(--tx-md)',
    font: '600 13px var(--font-ui)',
    cursor: 'pointer',
    marginTop: 8,
  },
  link: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    color: 'var(--signal-eff)',
    font: '600 12px var(--font-ui)',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  err: {
    font: '500 12px var(--font-ui)',
    color: 'var(--flag-eff)',
    margin: '12px 0 0',
    lineHeight: 1.4,
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTop: '1px solid var(--line-soft)',
  },
  meta: {
    font: '500 11px var(--font-mono)',
    letterSpacing: '0.08em',
    color: 'var(--tx-lo)',
  },
  switchRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
    flexWrap: 'wrap',
  },
});

// ── Shared frame: brand mark + title + sub + body ────────────
// Every card uses the same outer chrome — this keeps the visual
// identity consistent across Login / SignUp / Forgot.
const AuthFrame = ({ title, sub, children }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  return (
    <div style={s.shell}>
      <div style={s.card}>
        <div style={s.mark}>
          {window.PeakMark ? <window.PeakMark size={24}/> : 'P'}
        </div>
        <h1 style={s.h1}>{title}</h1>
        {sub && <p style={s.sub}>{sub}</p>}
        {children}
      </div>
    </div>
  );
};

// ── SignInCard ───────────────────────────────────────────────
const SignInCard = ({ onSignedIn, onSwitchMode }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [email,    setEmail]    = useAuthState('');
  const [password, setPassword] = useAuthState('');
  const [busy,     setBusy]     = useAuthState(false);
  const [err,      setErr]      = useAuthState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true); setErr(null);
    const { session, error } = await window.PA_AUTH.signInWithEmail(email.trim(), password);
    setBusy(false);
    if (error) {
      setErr(error.message || t('auth.signinCard.errFallback'));
      return;
    }
    if (session) onSignedIn?.(session);
  };

  return (
    <AuthFrame title={t('auth.signinCard.title')} sub={t('auth.signinCard.sub')}>
      <form onSubmit={submit}>
        <div style={s.field}>
          <label style={s.label} htmlFor="auth-email">{t('auth.email')}</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={s.input}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}
          />
        </div>

        <div style={s.field}>
          <label style={s.label} htmlFor="auth-password">{t('auth.password')}</label>
          <input
            id="auth-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}
          />
        </div>

        <button
          type="submit"
          disabled={busy || !email || !password}
          style={{
            ...s.btnPrimary,
            opacity: (busy || !email || !password) ? 0.5 : 1,
            cursor: (busy || !email || !password) ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? t('auth.signinCard.submitBusy') : t('auth.signinCard.submit')}
        </button>

        {err && <p style={s.err}>{err}</p>}

        {/* Mode switchers — Forgot / Create account links. Both
            translated; the switcher targets are now real cards
            (v01.11 SignUp, v01.12 Forgot). */}
        <div style={s.switchRow}>
          <button type="button" style={s.link}
            onClick={() => onSwitchMode?.('forgot')}>
            {t('auth.forgotPassword')}
          </button>
          <button type="button" style={s.link}
            onClick={() => onSwitchMode?.('signup')}>
            {t('auth.createAccount')}
          </button>
        </div>

        <div style={s.metaRow}>
          <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
          <span style={s.meta}>{t('auth.signinCard.metaRight')}</span>
        </div>
      </form>
    </AuthFrame>
  );
};

// ── Toggle pill — used for Role + Gender pickers in SignUp ────
// Renders a horizontal segmented control (~iOS UISegmentedControl
// or shadcn Tabs). One option is selected at a time. Each option
// is a real `<button type="button">` so it never accidentally
// submits the parent form.
const TogglePill = ({ options, value, onChange, ariaLabel }) => (
  <div role="radiogroup" aria-label={ariaLabel}
       style={{
         display: 'flex',
         gap: 6,
         padding: 4,
         background: 'var(--bg-3)',
         border: '1px solid var(--line)',
         borderRadius: 12,
       }}>
    {options.map(opt => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            padding: '9px 10px',
            borderRadius: 8,
            border: 'none',
            background: active ? 'var(--bg)' : 'transparent',
            boxShadow: active ? '0 1px 2px color-mix(in oklch, var(--ink) 25%, transparent)' : 'none',
            color: active ? 'var(--tx-hi)' : 'var(--tx-md)',
            font: '600 13px var(--font-ui)',
            cursor: 'pointer',
            transition: 'background 0.12s, color 0.12s',
          }}>
          {opt.label}
        </button>
      );
    })}
  </div>
);

// ── SignUpCard — v01.11 ──────────────────────────────────────
// Six fields: email, password, first/last name, gender, role.
// Per locked Q19 (2026-05-05): NO confirm-password (matches live).
// Per locked Q1 (2026-05-05): NO team-code field — coaches join
// or create a team post-login via the "no team yet" Coach Deck
// empty state (Batch 1c, v01.14+).
//
// On submit, calls window.PA_AUTH.signUpWithEmail. The metadata
// `{ first_name, last_name, gender, role }` is read by the
// `handle_new_user` trigger on auth.users INSERT, which:
//   - links a pre-imported athlete/coach row by email if one
//     exists with auth_user_id = NULL, OR
//   - creates a new athletes/coaches row with the metadata.
// The `handle_new_user_subscription` trigger then provisions a
// 30-day Pro plan (if pre-imported with team) or a free plan.
//
// Three result paths:
//   1. error  → render the error message inline
//   2. session != null  → Supabase auto-confirmed (project config);
//      call onSignedIn so AuthGate flips to App immediately.
//   3. session == null && user != null → email confirmation
//      required; switch to 'verify-sent' mode with the email.
const SignUpCard = ({ onSwitchMode, onSignedIn, onVerifySent }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [email,     setEmail]     = useAuthState('');
  const [password,  setPassword]  = useAuthState('');
  const [firstName, setFirstName] = useAuthState('');
  const [lastName,  setLastName]  = useAuthState('');
  const [gender,    setGender]    = useAuthState('female');
  const [role,      setRole]      = useAuthState('athlete');
  const [busy,      setBusy]      = useAuthState(false);
  const [err,       setErr]       = useAuthState(null);

  const canSubmit =
    !busy &&
    email.trim().length > 3 &&
    password.length >= 6 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null);

    const cleanEmail = email.trim().toLowerCase();
    const metadata = {
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
      gender,
      role,
    };

    const { session, user, error } = await window.PA_AUTH.signUpWithEmail(
      cleanEmail, password, metadata
    );
    setBusy(false);

    if (error) {
      // Common Supabase error messages — surface them as-is. Examples:
      //   "User already registered"
      //   "Password should be at least 6 characters"
      //   "Unable to validate email address: invalid format"
      setErr(error.message || t('auth.signupCard.errFallback'));
      return;
    }

    if (session) {
      // Project config has email confirmation OFF — user is signed in
      // immediately. Hand off to AuthGate.
      onSignedIn?.(session);
      return;
    }

    if (user) {
      // Email confirmation required. Switch to verify-sent mode and
      // pass the email along so VerifySentCard can show it.
      onVerifySent?.(cleanEmail);
      return;
    }

    // Defensive fallback — shouldn't happen with current Supabase API.
    setErr(t('auth.signupCard.errNoUser'));
  };

  const inputFx = {
    onFocus: (e) => { e.target.style.borderColor = 'var(--signal-eff)'; },
    onBlur:  (e) => { e.target.style.borderColor = 'var(--line)'; },
  };

  return (
    <AuthFrame
      title={t('auth.signupCard.title')}
      sub={t('auth.signupCard.sub')}>
      <form onSubmit={submit}>
        <div style={s.field}>
          <label style={s.label} htmlFor="su-email">{t('auth.email')}</label>
          <input id="su-email" type="email" autoComplete="email" required
                 value={email} onChange={(e) => setEmail(e.target.value)}
                 style={s.input} {...inputFx}/>
        </div>

        <div style={s.field}>
          <label style={s.label} htmlFor="su-pass">{t('auth.password')}</label>
          <input id="su-pass" type="password" autoComplete="new-password" required
                 minLength={6}
                 placeholder={t('auth.signupCard.passwordPlaceholder')}
                 value={password} onChange={(e) => setPassword(e.target.value)}
                 style={s.input} {...inputFx}/>
        </div>

        {/* First + last name. Side-by-side on desktop, stacked on mobile. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 12,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={s.label} htmlFor="su-first">{t('auth.signupCard.firstName')}</label>
            <input id="su-first" type="text" autoComplete="given-name" required
                   value={firstName} onChange={(e) => setFirstName(e.target.value)}
                   style={s.input} {...inputFx}/>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={s.label} htmlFor="su-last">{t('auth.signupCard.lastName')}</label>
            <input id="su-last" type="text" autoComplete="family-name" required
                   value={lastName} onChange={(e) => setLastName(e.target.value)}
                   style={s.input} {...inputFx}/>
          </div>
        </div>

        <div style={s.field}>
          <span style={s.label}>{t('auth.signupCard.iAmAn')}</span>
          <TogglePill
            ariaLabel={t('auth.signupCard.iAmAn')}
            value={role}
            onChange={setRole}
            options={[
              { value: 'athlete', label: t('auth.signupCard.roleAthlete') },
              { value: 'coach',   label: t('auth.signupCard.roleCoach') },
            ]}/>
        </div>

        <div style={s.field}>
          <span style={s.label}>{t('auth.signupCard.gender')}</span>
          <TogglePill
            ariaLabel={t('auth.signupCard.gender')}
            value={gender}
            onChange={setGender}
            options={[
              { value: 'female', label: t('auth.signupCard.genderFemale') },
              { value: 'male',   label: t('auth.signupCard.genderMale') },
            ]}/>
        </div>

        <button type="submit" disabled={!canSubmit}
          style={{
            ...s.btnPrimary,
            opacity: canSubmit ? 1 : 0.5,
            cursor:  canSubmit ? 'pointer' : 'not-allowed',
          }}>
          {busy ? t('auth.signupCard.submitBusy') : t('auth.signupCard.submit')}
        </button>

        {err && <p style={s.err}>{err}</p>}

        <div style={{ ...s.switchRow, justifyContent: 'center' }}>
          <span style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)' }}>
            {t('auth.signupCard.switchPrompt')}
          </span>
          <button type="button" style={s.link}
            onClick={() => onSwitchMode?.('login')}>
            {t('auth.signupCard.switchLink')}
          </button>
        </div>

        <div style={s.metaRow}>
          <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
          <span style={s.meta}>{t('auth.signupCard.metaRight')}</span>
        </div>
      </form>
    </AuthFrame>
  );
};

// ── VerifySentCard — v01.11 ──────────────────────────────────
// Shown after a successful sign-up when Supabase requires email
// confirmation. Tells the user to check their inbox + offers a
// resend link in case the first email got lost.
//
// The verification email itself is sent by Supabase's auth
// transactional infrastructure, not by the prototype — so this
// card calls `window.PA_AUTH.resendVerification(email)` (added in
// v01.10) which uses Supabase's `auth.resend({ type: 'signup' })`.
//
// Per locked Q18 (2026-05-05), the redirect URL is
// `AUTH_REDIRECT_URL` (live dashboard URL). When the user clicks
// the verification link in their email, they'll land on live —
// they need to come back to the prototype manually for now.
// Acceptable trade-off for the testing phase.
const VerifySentCard = ({ email, onSwitchMode }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [busy,   setBusy]   = useAuthState(false);
  const [info,   setInfo]   = useAuthState(null);
  const [err,    setErr]    = useAuthState(null);

  const onResend = async () => {
    if (busy || !email) return;
    setBusy(true); setInfo(null); setErr(null);
    const { ok, error } = await window.PA_AUTH.resendVerification(email);
    setBusy(false);
    if (!ok) {
      setErr(error?.message || t('auth.verifyCard.errFallback'));
      return;
    }
    setInfo(t('auth.verifyCard.info'));
  };

  return (
    <AuthFrame
      title={t('auth.verifyCard.title')}
      sub={
        <>
          {t('auth.verifyCard.subA')}<strong style={{ color: 'var(--tx-hi)' }}>{email}</strong>{t('auth.verifyCard.subB')}
        </>
      }>
      <button type="button" onClick={onResend} disabled={busy || !email}
        style={{
          ...s.btnPrimary,
          opacity: (busy || !email) ? 0.5 : 1,
          cursor:  (busy || !email) ? 'not-allowed' : 'pointer',
        }}>
        {busy ? t('auth.verifyCard.resending') : t('auth.verifyCard.resend')}
      </button>

      <button type="button" style={s.btnGhost}
        onClick={() => onSwitchMode?.('login')}>
        {t('auth.verifyCard.back')}
      </button>

      {info && (
        <p style={{ ...s.err, color: 'var(--lime-eff)' }}>{info}</p>
      )}
      {err && <p style={s.err}>{err}</p>}

      <div style={s.metaRow}>
        <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
        <span style={s.meta}>{t('auth.verifyCard.metaRight')}</span>
      </div>
    </AuthFrame>
  );
};

// ── ForgotCard — v01.12 ──────────────────────────────────────
// Step 1 of the password-reset flow. User enters their email →
// we call window.PA_AUTH.requestPasswordReset(email) which fires
// Supabase's recovery email infrastructure. On success, the card
// flips to a confirmation state ("Check your inbox for a reset
// link"). On error, message renders inline.
//
// Supabase's auth.resetPasswordForEmail intentionally returns
// `ok: true` even when the email doesn't exist in auth.users
// (anti-enumeration). So our success copy is the same regardless
// of whether the email matched a real account — that's correct
// security behavior and matches live's pattern.
//
// Per locked Q18 (2026-05-05), the redirect URL is
// AUTH_REDIRECT_URL (live dashboard URL). When the user clicks
// the email link, they land on live, not on the prototype.
// The ResetCard below is reachable only by manually pasting the
// recovery hash into a prototype URL — useful for testing, but
// the typical user flow goes through live's reset card.
const ForgotCard = ({ onSwitchMode }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [email, setEmail] = useAuthState('');
  const [busy,  setBusy]  = useAuthState(false);
  const [sent,  setSent]  = useAuthState(false);
  const [err,   setErr]   = useAuthState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true); setErr(null);
    const { ok, error } = await window.PA_AUTH.requestPasswordReset(email.trim().toLowerCase());
    setBusy(false);
    if (!ok) {
      setErr(error?.message || t('auth.forgotCard.errFallback'));
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthFrame
        title={t('auth.forgotCard.sentTitle')}
        sub={
          <>
            {t('auth.forgotCard.sentSubA')}<strong style={{ color: 'var(--tx-hi)' }}>{email}</strong>{t('auth.forgotCard.sentSubB')}
          </>
        }>
        <button type="button" style={s.btnGhost}
          onClick={() => onSwitchMode?.('login')}>
          {t('auth.forgotCard.back')}
        </button>
        <div style={s.metaRow}>
          <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
          <span style={s.meta}>{t('auth.forgotCard.sentMetaRight')}</span>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={t('auth.forgotCard.title')}
      sub={t('auth.forgotCard.sub')}>
      <form onSubmit={submit}>
        <div style={s.field}>
          <label style={s.label} htmlFor="fp-email">{t('auth.email')}</label>
          <input
            id="fp-email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            style={s.input}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}/>
        </div>

        <button type="submit" disabled={busy || !email.trim()}
          style={{
            ...s.btnPrimary,
            opacity: (busy || !email.trim()) ? 0.5 : 1,
            cursor:  (busy || !email.trim()) ? 'not-allowed' : 'pointer',
          }}>
          {busy ? t('auth.forgotCard.submitBusy') : t('auth.forgotCard.submit')}
        </button>

        {err && <p style={s.err}>{err}</p>}

        <button type="button" style={s.btnGhost}
          onClick={() => onSwitchMode?.('login')}>
          {t('auth.forgotCard.back')}
        </button>

        <div style={s.metaRow}>
          <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
          <span style={s.meta}>{t('auth.forgotCard.metaRight')}</span>
        </div>
      </form>
    </AuthFrame>
  );
};

// ── ResetCard — v01.12 ───────────────────────────────────────
// Step 2 of the password-reset flow. Triggered by AuthGate when
// the Supabase `PASSWORD_RECOVERY` event fires (the user clicked
// the reset link in their email and supabase-js parsed the
// recovery hash from the URL).
//
// At this point Supabase has already created a recovery session
// for the user — we don't need to verify a token. We just call
// auth.updateUser({ password: newPassword }) via PA_AUTH.updatePassword.
// On success, supabase fires a SIGNED_IN event with the now-fully-
// authenticated session, AuthGate's recoveryMode flag clears, and
// AuthGate flips to App.
//
// Per locked Q19 (2026-05-05): no confirm-password field. Matches
// live + Sign Up. If the user mistypes, they can request another
// reset link.
const ResetCard = ({ onComplete, onCancel }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [password, setPassword] = useAuthState('');
  const [busy,     setBusy]     = useAuthState(false);
  const [err,      setErr]      = useAuthState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || password.length < 6 || busy) return;
    setBusy(true); setErr(null);
    const { user, error } = await window.PA_AUTH.updatePassword(password);
    setBusy(false);
    if (error) {
      setErr(error.message || t('auth.resetCard.errFallback'));
      return;
    }
    if (user) {
      // Clear the recovery hash so a refresh doesn't re-enter reset mode.
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
      onComplete?.();
    }
  };

  return (
    <AuthFrame
      title={t('auth.resetCard.title')}
      sub={t('auth.resetCard.sub')}>
      <form onSubmit={submit}>
        <div style={s.field}>
          <label style={s.label} htmlFor="rp-pass">{t('auth.resetCard.passwordLabel')}</label>
          <input
            id="rp-pass" type="password" autoComplete="new-password" required
            minLength={6} placeholder={t('auth.resetCard.passwordPlaceholder')}
            value={password} onChange={(e) => setPassword(e.target.value)}
            style={s.input}
            onFocus={(e) => { e.target.style.borderColor = 'var(--signal-eff)'; }}
            onBlur={(e)  => { e.target.style.borderColor = 'var(--line)'; }}/>
        </div>

        <button type="submit" disabled={busy || password.length < 6}
          style={{
            ...s.btnPrimary,
            opacity: (busy || password.length < 6) ? 0.5 : 1,
            cursor:  (busy || password.length < 6) ? 'not-allowed' : 'pointer',
          }}>
          {busy ? t('auth.resetCard.submitBusy') : t('auth.resetCard.submit')}
        </button>

        {err && <p style={s.err}>{err}</p>}

        {onCancel && (
          <button type="button" style={s.btnGhost} onClick={onCancel}>
            {t('auth.resetCard.cancel')}
          </button>
        )}

        <div style={s.metaRow}>
          <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
          <span style={s.meta}>{t('auth.resetCard.metaRight')}</span>
        </div>
      </form>
    </AuthFrame>
  );
};

// ── ConsentModal — v01.13 ────────────────────────────────────
// Blocking dialog shown when AuthGate detects an authenticated
// session whose user has NOT recorded acceptance of the current
// consent version. The user must accept to continue into the App.
//
// Backed by the existing production RPCs:
//   check_user_consent(p_required_version)  — read in AuthGate
//   record_user_consent(p_consent_type='combined', p_version, ...)
// Both apps share the same consent_logs table; recording here is
// recognized identically by live (and vice-versa).
//
// Canonical version is 'v1.0' (confirmed via Supabase audit;
// consent_logs already has 32 rows from production users at v1.0).
// `record_user_consent` also mirrors the acceptance into
// athletes.consent_accepted_at + consent_version for quick lookup.
//
// No close button. No "Decline." Acceptance is required to use
// the product — declining just sits on the modal forever (user
// can sign out from the bottom). This matches live's behavior.
const ConsentModal = ({ onAccept, onSignOut }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [agreed, setAgreed] = useAuthState(false);
  const [busy,   setBusy]   = useAuthState(false);
  const [err,    setErr]    = useAuthState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!agreed || busy) return;
    setBusy(true); setErr(null);
    const { ok, error } = await window.PA_AUTH.recordConsent();
    setBusy(false);
    if (!ok) {
      setErr(error?.message || t('auth.consentModal.errFallback'));
      return;
    }
    onAccept?.();
  };

  // Visual: backdrop + centered card. Looks like an `AuthFrame`
  // but with explicit z-index over everything (including any
  // accidentally-rendered App below). Uses inline-style backdrop
  // so we don't depend on ModalShell from request-modals.jsx
  // (this needs to render before App boots fully).
  const cardWidth = isMobile ? '100%' : 480;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'color-mix(in oklch, var(--ink) 85%, transparent)',
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '40px 20px',
        overflowY: 'auto',
      }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%', maxWidth: cardWidth,
          padding: isMobile ? 22 : 32,
          borderRadius: 18,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow)',
        }}>
        <div style={s.mark}>
          {window.PeakMark ? <window.PeakMark size={24}/> : 'P'}
        </div>
        <h1 style={s.h1}>{t('auth.consentModal.title')}</h1>
        <p style={s.sub}>{t('auth.consentModal.sub')}</p>

        {/* Two stacked sections: ToS + Privacy. Live has the same
            shape — short summary with a "view full" link. */}
        <section style={{
          padding: 14, borderRadius: 10,
          background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
          marginBottom: 12,
        }}>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
            {t('auth.consentModal.tosEyebrow')}
          </div>
          <p style={{ margin: 0, font: '500 13px var(--font-ui)', color: 'var(--tx-md)', lineHeight: 1.55 }}>
            {t('auth.consentModal.tosBody')}
            {' '}
            <a href="https://www.mypeakathlete.com/terms" target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--signal-eff)', textDecoration: 'none' }}>
              {t('auth.consentModal.tosLink')}
            </a>
          </p>
        </section>

        <section style={{
          padding: 14, borderRadius: 10,
          background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
          marginBottom: 16,
        }}>
          <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 6 }}>
            {t('auth.consentModal.privEyebrow')}
          </div>
          <p style={{ margin: 0, font: '500 13px var(--font-ui)', color: 'var(--tx-md)', lineHeight: 1.55 }}>
            {t('auth.consentModal.privBody')}
            {' '}
            <a href="https://www.mypeakathlete.com/privacy" target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--signal-eff)', textDecoration: 'none' }}>
              {t('auth.consentModal.privLink')}
            </a>
          </p>
        </section>

        {/* Accept checkbox — block-level so the whole row is clickable */}
        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px', borderRadius: 10,
            border: '1px solid ' + (agreed ? 'var(--signal-eff)' : 'var(--line)'),
            background: agreed
              ? 'color-mix(in oklch, var(--signal-eff) 10%, transparent)'
              : 'var(--bg-3)',
            cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
            marginBottom: 16,
          }}>
          <input
            type="checkbox" checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{
              marginTop: 3,
              accentColor: 'var(--signal-eff)',
              width: 16, height: 16,
              cursor: 'pointer',
            }}/>
          <span style={{
            font: '500 13px var(--font-ui)', color: 'var(--tx-md)',
            lineHeight: 1.45,
          }}>
            {t('auth.consentModal.agreeLabel')}
          </span>
        </label>

        <button type="submit" disabled={!agreed || busy}
          style={{
            ...s.btnPrimary,
            opacity: (!agreed || busy) ? 0.5 : 1,
            cursor:  (!agreed || busy) ? 'not-allowed' : 'pointer',
            marginTop: 0,
          }}>
          {busy ? t('auth.consentModal.submitBusy') : t('auth.consentModal.submit')}
        </button>

        {err && <p style={s.err}>{err}</p>}

        {/* Sign-out escape hatch — the only way out without accepting.
            Matches live: declining means signing out, no soft no. */}
        {onSignOut && (
          <button type="button" style={s.btnGhost} onClick={onSignOut}>
            {t('auth.consentModal.signOutInstead')}
          </button>
        )}

        <div style={s.metaRow}>
          <span style={s.meta}>
            {t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''} · v{window.PA_AUTH?.CONSENT_VERSION || '1.0'}
          </span>
          <span style={s.meta}>{t('auth.consentModal.metaRight')}</span>
        </div>
      </form>
    </div>
  );
};

// ── Placeholder card for modes not yet built ─────────────────
// All Batch 1b modes are built now (v01.13). PlaceholderCard
// stays exposed in case future batches want to scaffold a card
// before its real implementation lands.
const PlaceholderCard = ({ title, body, onSwitchMode }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = authStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  return (
    <AuthFrame title={title} sub={body}>
      <button type="button" style={s.btnGhost}
        onClick={() => onSwitchMode?.('login')}>
        {t('auth.placeholder.back')}
      </button>
      <div style={s.metaRow}>
        <span style={s.meta}>{t('auth.signinCard.metaLeft')} {window.PROTO_VERSION || ''}</span>
        <span style={s.meta}>{t('auth.placeholder.metaRight')}</span>
      </div>
    </AuthFrame>
  );
};

// ── AuthScreen — mode router ─────────────────────────────────
// Owns the mode state and the email-in-flight for verify-sent.
// Default 'login'. Sub-cards switch via onSwitchMode callback.
//
// v01.12 — `forceMode` prop lets AuthGate pin the mode externally,
// used when Supabase's PASSWORD_RECOVERY event fires (user clicked
// the reset link in their email). When forceMode='reset',
// AuthScreen renders the ResetCard regardless of internal state.
// `onResetComplete` lets AuthGate clear its recoveryMode flag
// after the reset finishes so it can flip to App.
const AuthScreen = ({ onSignedIn, forceMode, onResetComplete }) => {
  const [mode, setMode] = useAuthState('login');
  // v01.11 — `pendingEmail` is set by SignUpCard when sign-up
  // succeeds but Supabase requires email confirmation. The
  // VerifySentCard reads it to render "We sent a link to <email>".
  const [pendingEmail, setPendingEmail] = useAuthState('');

  const effectiveMode = forceMode || mode;

  const onSwitchMode = (next) => setMode(next);
  const onVerifySent = (email) => {
    setPendingEmail(email);
    setMode('verify-sent');
  };

  if (effectiveMode === 'reset') {
    return <ResetCard
      onComplete={onResetComplete}
      onCancel={onResetComplete /* same handler — exits recovery */}/>;
  }
  if (effectiveMode === 'signup') {
    return <SignUpCard
      onSignedIn={onSignedIn}
      onSwitchMode={onSwitchMode}
      onVerifySent={onVerifySent}/>;
  }
  if (effectiveMode === 'verify-sent') {
    return <VerifySentCard
      email={pendingEmail}
      onSwitchMode={onSwitchMode}/>;
  }
  if (effectiveMode === 'forgot') {
    return <ForgotCard onSwitchMode={onSwitchMode}/>;
  }
  // default: login
  return <SignInCard onSignedIn={onSignedIn} onSwitchMode={onSwitchMode}/>;
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  AuthScreen, SignInCard, SignUpCard, VerifySentCard,
  ForgotCard, ResetCard, ConsentModal,
  AuthFrame, TogglePill,
});

try { console.log('[auth] loaded (v01.25)'); } catch (_) {}
