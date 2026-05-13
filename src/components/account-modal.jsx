/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   AccountModal — tabbed account / subscription panel.

   v01.15 (Batch 2 — money path). Replaces the live dashboard's
   single-purpose "subscription modal" with a tabbed Account
   surface per locked decision (2026-05-05, Q10):
     Subscription | Profile | Preferences | Notifications

   Entry point: clicking the user name/avatar block in the
   Sidebar (per locked Q4). Single overlay, single modal, one
   surface for every account-related decision.

   Backend reuse — no new schema:
     - Subscription state from v_my_subscription view
       (computed: is_active, is_trialing, days_remaining)
     - Manage billing / cancel via existing create-portal edge
       function (wrapped in window.PA_REQUESTS.openCustomerPortal)
     - Upgrade via existing STRIPE_LINKS.pro pay-link with
       client_reference_id + email prefill (buildStripeUrl)
     - Plan, status, period_end, trial_end all from the view

   Mobile-aware: tabs collapse to a horizontal scroll row,
   panels stack, padding tightens. Same visual language as
   auth.jsx (inline styles, brand mark in header).
   ─────────────────────────────────────────────────────────── */

const { useState: useAcctState, useEffect: useAcctEffect } = React;

// ── Tab definitions ──────────────────────────────────────────
// v01.22 — `labelKey` resolved via useT() at render time. The id
// is route-stable; only the visible label translates.
const ACCOUNT_TABS = [
  { id: 'subscription', labelKey: 'account.tabs.subscription'  },
  { id: 'profile',      labelKey: 'account.tabs.profile'       },
  { id: 'preferences',  labelKey: 'account.tabs.preferences'   },
  { id: 'notifications',labelKey: 'account.tabs.notifications' },
];

// ── Style helpers ────────────────────────────────────────────
const acctStyles = (isMobile) => ({
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1500,
    background: 'color-mix(in oklch, var(--ink) 78%, transparent)',
    display: 'flex',
    alignItems: isMobile ? 'flex-start' : 'center',
    justifyContent: 'center',
    padding: isMobile ? '24px 16px' : '40px 20px',
    overflowY: 'auto',
  },
  card: {
    width: '100%', maxWidth: 560,
    padding: 0,
    borderRadius: 18,
    background: 'var(--bg-2)',
    border: '1px solid var(--line)',
    boxShadow: 'var(--shadow)',
    overflow: 'hidden',
  },
  headerRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: isMobile ? '18px 18px 0' : '22px 24px 0',
  },
  brandRow: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  mark: {
    width: 36, height: 36, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in oklch, var(--signal-eff) 14%, transparent)',
    color: 'var(--signal-eff)',
    font: '700 17px var(--font-display)',
  },
  title: {
    font: '700 18px var(--font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tx-hi)',
    margin: 0,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'transparent', color: 'var(--tx-md)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  tabRow: {
    display: 'flex', gap: 4,
    padding: isMobile ? '12px 12px 0' : '14px 18px 0',
    overflowX: 'auto',
    borderBottom: '1px solid var(--line-soft)',
    WebkitOverflowScrolling: 'touch',
  },
  tabBtn: (active) => ({
    padding: '10px 14px',
    borderRadius: '8px 8px 0 0',
    border: 'none',
    borderBottom: active ? '2px solid var(--signal-eff)' : '2px solid transparent',
    background: 'transparent',
    color: active ? 'var(--tx-hi)' : 'var(--tx-md)',
    font: (active ? '700 ' : '600 ') + '13px var(--font-ui)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    marginBottom: -1, // overlap the borderBottom on the row
  }),
  panel: {
    padding: isMobile ? '20px 18px 22px' : '22px 24px 26px',
    minHeight: 200,
  },
  // Reusable subscription-card primitives
  statusPill: (tone) => ({
    display: 'inline-flex', alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'color-mix(in oklch, ' + tone + ' 14%, transparent)',
    color: tone,
    border: '1px solid color-mix(in oklch, ' + tone + ' 35%, transparent)',
    font: '700 11px var(--font-ui)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  }),
  bigPlanLabel: {
    font: '700 26px var(--font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tx-hi)',
    margin: '8px 0 4px',
  },
  metaText: {
    font: '500 13px var(--font-ui)',
    color: 'var(--tx-md)',
    lineHeight: 1.55,
  },
  primaryBtn: {
    padding: '11px 18px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--signal-eff)',
    color: 'var(--ink)',
    font: '700 13px var(--font-ui)',
    letterSpacing: '0.01em',
    cursor: 'pointer',
  },
  ghostBtn: {
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'transparent',
    color: 'var(--tx-md)',
    font: '600 13px var(--font-ui)',
    cursor: 'pointer',
  },
  err: {
    font: '500 12px var(--font-ui)',
    color: 'var(--flag-eff)',
    margin: '12px 0 0',
  },
});

// ── Status-aware Subscription tab body ───────────────────────
// v01.22 — fully translated. Locale-aware date formatting via
// PA_I18N.getLang() so periodEnd / trialEnd render in the user's
// language (e.g. "May 12, 2026" vs "12 may 2026"). Status pills,
// plan label, meta lines, feature list, and action buttons all
// resolve through useT().
const SubscriptionPanel = ({ subscription, profile, role, session }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = acctStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const lang = (window.PA_I18N?.getLang?.() || 'en');
  const [busy, setBusy] = useAcctState(false);
  const [err,  setErr]  = useAcctState(null);

  const sub = subscription || { plan_id: 'free', is_active: false };
  const isProActive  = window.PA_REQUESTS?.isPro?.(sub) || false;
  const isTrialingNow = window.PA_REQUESTS?.isTrialing?.(sub) || false;
  const daysLeft = window.PA_REQUESTS?.trialDaysLeft?.(sub);
  const cancelAtEnd = !!sub.cancel_at_period_end;
  const planLabel = isProActive
    ? t(isTrialingNow ? 'account.subscription.planProTrial' : 'account.subscription.planPro')
    : t('account.subscription.planFree');

  // Locale-aware date. 'es' → "12 may 2026"; 'en' → "May 12, 2026".
  // Defaults to user's browser locale if PA_I18N is unavailable.
  const fmtDate = (d) => {
    if (!d) return null;
    try {
      const localeArg = lang === 'es' ? 'es' : (lang === 'en' ? 'en' : undefined);
      return new Date(d).toLocaleDateString(localeArg, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch (_) { return null; }
  };

  const periodEnd = fmtDate(sub.current_period_end);
  const trialEnd  = fmtDate(sub.trial_end);

  // Status pill — tone + label reflect the current state.
  let pill = null;
  if (cancelAtEnd && isProActive) {
    pill = (
      <span style={s.statusPill('var(--amber-eff)')}>
        {periodEnd
          ? t('account.subscription.statusCancelsOn', { date: periodEnd })
          : t('account.subscription.statusCancelsEnd')}
      </span>
    );
  } else if (isTrialingNow) {
    pill = (
      <span style={s.statusPill('var(--lime-eff)')}>
        {daysLeft != null
          ? t('account.subscription.statusTrialDays', { days: daysLeft })
          : t('account.subscription.statusTrial')}
      </span>
    );
  } else if (isProActive) {
    pill = <span style={s.statusPill('var(--signal-eff)')}>{t('account.subscription.statusActive')}</span>;
  } else {
    pill = <span style={s.statusPill('var(--tx-lo)')}>{t('account.subscription.statusFree')}</span>;
  }

  const onUpgrade = () => {
    if (!window.PA_REQUESTS?.STRIPE_LINKS?.pro) return;
    const url = window.PA_REQUESTS.buildStripeUrl(
      window.PA_REQUESTS.STRIPE_LINKS.pro,
      { authUserId: session?.user?.id, email: session?.user?.email || profile?.email }
    );
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onManage = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const { ok, error } = await window.PA_REQUESTS.openCustomerPortal();
    setBusy(false);
    if (!ok) setErr(error?.message || t('account.subscription.portalError'));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('account.subscription.yourPlan')}</span>
        {pill}
      </div>

      <div style={s.bigPlanLabel}>{planLabel}</div>

      {/* State-specific meta line. {date} + interpolation handles
          the embedded date for both languages cleanly. */}
      {isProActive && !cancelAtEnd && periodEnd && (
        <div style={s.metaText}>
          {isTrialingNow
            ? t('account.subscription.trialEndsOn', { date: trialEnd || periodEnd })
            : t('account.subscription.renewsOn',    { date: periodEnd })}
        </div>
      )}
      {isProActive && cancelAtEnd && periodEnd && (
        <div style={s.metaText}>
          {t('account.subscription.cancelsAtEnd', { date: periodEnd })}
        </div>
      )}
      {!isProActive && (
        <div style={s.metaText}>{t('account.subscription.freePlanLine')}</div>
      )}

      {/* Pro feature list */}
      <div style={{
        marginTop: 18, padding: '14px 16px',
        background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
        borderRadius: 12,
      }}>
        <div className="eyebrow" style={{ color: 'var(--tx-lo)', marginBottom: 8 }}>
          {t(isProActive ? 'account.subscription.includedInPro' : 'account.subscription.whatProUnlocks')}
        </div>
        <ul style={{
          margin: 0, paddingLeft: 18,
          font: '500 13px var(--font-ui)', color: 'var(--tx-md)', lineHeight: 1.7,
        }}>
          <li>{t('account.subscription.feature1')}</li>
          <li>{t('account.subscription.feature2')}</li>
          <li>{t('account.subscription.feature3')}</li>
          <li>{t('account.subscription.feature4')}</li>
          <li>{t('account.subscription.feature5')}</li>
        </ul>
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap',
      }}>
        {isProActive ? (
          <button type="button" style={{
            ...s.primaryBtn,
            opacity: busy ? 0.5 : 1,
            cursor: busy ? 'not-allowed' : 'pointer',
          }} onClick={onManage} disabled={busy}>
            {busy ? t('account.subscription.opening') : t('account.subscription.manageBilling')}
          </button>
        ) : (
          <button type="button" style={s.primaryBtn} onClick={onUpgrade}>
            {t('account.subscription.upgradeToPro')}
          </button>
        )}
        {isProActive && !cancelAtEnd && (
          <button type="button" style={s.ghostBtn} onClick={onManage} disabled={busy}>
            {t('account.subscription.cancelSubscription')}
          </button>
        )}
      </div>

      {err && <p style={s.err}>{err}</p>}

      <div style={{
        marginTop: 16, font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
        lineHeight: 1.55,
      }}>
        {t('account.subscription.billingByStripe')}
      </div>
    </div>
  );
};

// ── Profile tab body ─────────────────────────────────────────
const ProfilePanel = ({ profile, role, session }) => {
  const t = (window.useT || (() => (k) => k))();
  const email = session?.user?.email || profile?.email || '—';
  const fullName = role === 'coach'
    ? (profile?.coach_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' '))
    : [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const teamName = profile?.team_name || null;
  const athleteCode = profile?.athlete_code || null;
  // v01.22 — translated role label. Falls back to capitalised raw
  // role string if the key is missing (defensive — the role values
  // are 'athlete' / 'coach' from v_my_athlete / v_my_coach views).
  const roleLabel = role
    ? t('roles.' + role)
    : null;

  const Row = ({ label, value }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12,
      padding: '11px 0',
      borderBottom: '1px solid var(--line-soft)',
    }}>
      <div className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{label}</div>
      <div style={{
        font: '600 13px var(--font-ui)',
        color: value ? 'var(--tx-hi)' : 'var(--tx-lo)',
        textAlign: 'right', maxWidth: '60%',
        wordBreak: 'break-word',
      }}>
        {value || '—'}
      </div>
    </div>
  );

  return (
    <div>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('account.profile.title')}</span>
      <div style={{ marginTop: 12 }}>
        <Row label={t('account.profile.name')}  value={fullName || null}/>
        <Row label={t('account.profile.email')} value={email}/>
        <Row label={t('account.profile.role')}  value={roleLabel}/>
        {role === 'athlete' && <Row label={t('account.profile.athleteCode')} value={athleteCode}/>}
        <Row label={t('account.profile.team')}  value={teamName}/>
      </div>
      <p style={{
        margin: '14px 0 0', font: '500 12px var(--font-ui)', color: 'var(--tx-lo)',
        lineHeight: 1.55,
      }}>
        {t('account.profile.editingHint')}
      </p>
    </div>
  );
};

// ── Preferences tab body ─────────────────────────────────────
// v01.20 — language row is now a real EN/ES TogglePill backed by
// window.PA_I18N. Theme + accent rows still render. Accent picker
// (locked at teal per Q8) stays disabled until the post-cutover
// polish pass.
//
// useT() lives in shared.jsx (v01.20). Window.TogglePill comes
// from auth.jsx which is loaded BEFORE account-modal.jsx in
// index.html — same component used by SignUpCard.
const PreferencesPanel = ({ scope, onToggleScope }) => {
  const t = (window.useT || (() => (k) => k))();
  const lang = (window.PA_I18N?.getLang?.() || 'en');
  const setLang = window.PA_I18N?.setLang || (() => false);
  const TogglePill = window.TogglePill;
  const Row = ({ label, sub, control }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '13px 0',
      borderBottom: '1px solid var(--line-soft)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: '600 13px var(--font-ui)', color: 'var(--tx-hi)' }}>{label}</div>
        {sub && (
          <div style={{ font: '500 12px var(--font-ui)', color: 'var(--tx-lo)', marginTop: 3 }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );

  return (
    <div>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('account.preferences.title')}</span>
      <div style={{ marginTop: 12 }}>
        <Row
          label={t('account.preferences.theme')}
          sub={t(scope === 'dark' ? 'account.preferences.themeSubDark' : 'account.preferences.themeSubLight')}
          control={
            <button type="button" onClick={onToggleScope} style={{
              padding: '8px 14px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'var(--bg-3)',
              color: 'var(--tx-md)', font: '600 12px var(--font-ui)',
              cursor: 'pointer',
            }}>
              {t(scope === 'dark' ? 'account.preferences.switchToLight' : 'account.preferences.switchToDark')}
            </button>
          }/>
        <Row
          label={t('account.preferences.language')}
          sub={t('account.preferences.languageSub')}
          control={
            TogglePill
              ? <div style={{ minWidth: 180 }}>
                  <TogglePill
                    ariaLabel={t('account.preferences.language')}
                    value={lang}
                    onChange={(v) => setLang(v)}
                    options={[
                      { value: 'en', label: t('lang.en') },
                      { value: 'es', label: t('lang.es') },
                    ]}/>
                </div>
              : (
                <span className="mono" style={{
                  padding: '6px 10px', borderRadius: 8,
                  background: 'var(--bg-3)', color: 'var(--tx-lo)',
                  font: '600 11px var(--font-mono)', letterSpacing: '0.06em',
                }}>{lang.toUpperCase()}</span>
              )
          }/>
        <Row
          label={t('account.preferences.accent')}
          sub={t('account.preferences.accentSub')}
          control={
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'var(--signal-eff)',
              border: '1px solid var(--line)',
              display: 'inline-block',
            }}/>
          }/>
      </div>
    </div>
  );
};

// ── Notifications tab body ───────────────────────────────────
// Placeholder — there are no real notifications yet (the bell
// icon is hidden until a real source exists per locked Q6).
// Email preferences will come when the notification surfaces
// land in later batches.
const NotificationsPanel = () => {
  const t = (window.useT || (() => (k) => k))();
  return (
    <div>
      <span className="eyebrow" style={{ color: 'var(--tx-lo)' }}>{t('account.notifications.title')}</span>
      <div style={{
        marginTop: 14, padding: '20px',
        background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
        borderRadius: 12,
      }}>
        <div style={{
          font: '600 14px var(--font-ui)', color: 'var(--tx-hi)', marginBottom: 6,
        }}>
          {t('account.notifications.comingSoon')}
        </div>
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--tx-md)', lineHeight: 1.55 }}>
          {t('account.notifications.body')}
        </div>
      </div>
    </div>
  );
};

// ── AccountModal — top-level wrapper ─────────────────────────
const AccountModal = ({ onClose, profile, role, session, subscription, scope, onToggleScope, initialTab = 'subscription' }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const s = acctStyles(isMobile);
  const t = (window.useT || (() => (k) => k))();
  const [tab, setTab] = useAcctState(initialTab);

  // Esc to close + body scroll lock — same lightweight pattern as
  // request-modals.jsx.
  useAcctEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const Icon = window.Icon;

  return (
    <div onClick={onClose} style={s.backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={s.card}>
        {/* Header */}
        <div style={s.headerRow}>
          <div style={s.brandRow}>
            <div style={s.mark}>P</div>
            <h2 style={s.title}>{t('account.title')}</h2>
          </div>
          <button type="button" onClick={onClose} style={s.closeBtn} aria-label={t('common.close')}>
            {Icon ? <Icon name="close" size={16}/> : <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>}
          </button>
        </div>

        {/* Tabs */}
        <div style={s.tabRow}>
          {ACCOUNT_TABS.map(tab2 => (
            <button
              key={tab2.id}
              type="button"
              onClick={() => setTab(tab2.id)}
              style={s.tabBtn(tab === tab2.id)}>
              {t(tab2.labelKey)}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div style={s.panel}>
          {tab === 'subscription' && (
            <SubscriptionPanel
              subscription={subscription}
              profile={profile} role={role} session={session}/>
          )}
          {tab === 'profile' && (
            <ProfilePanel profile={profile} role={role} session={session}/>
          )}
          {tab === 'preferences' && (
            <PreferencesPanel scope={scope} onToggleScope={onToggleScope}/>
          )}
          {tab === 'notifications' && (
            <NotificationsPanel/>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  AccountModal,
  ACCOUNT_TABS,
});

try { console.log('[account-modal] loaded (v01.22)'); } catch (_) {}
