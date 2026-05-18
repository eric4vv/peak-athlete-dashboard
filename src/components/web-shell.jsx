/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Web shell — sidebar + topbar + PageShell wrapper

   Persona-aware: athlete vs coach swaps nav groups, user card,
   and the home page label (The Deck vs Squad Overview).

   Pure presentation. Profile/role are passed in as props —
   no data fetching here.
   ─────────────────────────────────────────────────────────── */

// ── Nav groupings ────────────────────────────────────────────
// v01.21 — Translation-driven. Each nav item carries an `i18nKey`
// instead of a hardcoded `name`; group labels carry a `labelKey`.
// Sidebar reads them through useT() so EN ↔ ES toggles re-render
// the entire nav stack instantly.
//
// `id` is the route key (matches App's active state). `icon` is
// the shared.jsx Icon name. `i18nKey` resolves through PA_I18N.

const NAV_ATHLETE = [
  { labelKey: 'pages.subHome',     items: [{ id: 'deck',    icon: 'home',   i18nKey: 'pages.home.athlete' }] },
  { labelKey: 'pages.subAnalysis', items: [
    { id: 'starts',  icon: 'starts', i18nKey: 'pages.starts' },
    { id: 'turns',   icon: 'turns',  i18nKey: 'pages.turns' },
    { id: 'races',   icon: 'races',  i18nKey: 'pages.races' },
  ]},
  { labelKey: 'pages.subRankings', items: [{ id: 'board',   icon: 'board',  i18nKey: 'pages.board' }] },
  { labelKey: 'pages.subTeam',     items: [{ id: 'team',    icon: 'team',   i18nKey: 'pages.team.athlete' }] },
];

const NAV_COACH = [
  { labelKey: 'pages.subHome',     items: [{ id: 'deck',    icon: 'home',   i18nKey: 'pages.home.coach' }] },
  { labelKey: 'pages.subAnalysis', items: [
    { id: 'starts',  icon: 'starts', i18nKey: 'pages.starts' },
    { id: 'turns',   icon: 'turns',  i18nKey: 'pages.turns' },
    { id: 'races',   icon: 'races',  i18nKey: 'pages.races' },
  ]},
  { labelKey: 'pages.subTeam',     items: [{ id: 'team',    icon: 'team',   i18nKey: 'pages.team.coach' }] },
  { labelKey: 'pages.subRankings', items: [{ id: 'board',   icon: 'board',  i18nKey: 'pages.board' }] },
];

// ── Utilities ────────────────────────────────────────────────

function initialsFrom(profile, role, fallbackEmail) {
  if (role === 'coach') {
    const n = profile?.coach_name || '';
    const parts = n.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  } else {
    const f = profile?.first_name?.[0] || '';
    const l = profile?.last_name?.[0]  || '';
    if (f || l) return (f + l).toUpperCase();
  }
  return (fallbackEmail || '?').slice(0, 2).toUpperCase();
}

function displayNameFrom(profile, role, fallbackEmail) {
  if (role === 'coach')  return profile?.coach_name || fallbackEmail || 'Coach';
  if (role === 'athlete') {
    const n = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
    return n || fallbackEmail || 'Athlete';
  }
  return fallbackEmail || '—';
}

// v01.21 — `roleSublabelFrom` now returns a translated string. Takes
// `t` (the translation function from useT()) so callers control the
// active language. Falls back to English-ish defaults if t isn't
// passed (e.g. early boot before the dict loads).
function roleSublabelFrom(profile, role, t) {
  const _t = t || ((k) => k);
  if (role === 'coach') {
    return profile?.role_label || _t('roles.headCoach');
  }
  if (role === 'athlete') {
    const code = profile?.athlete_code ? '· ' + profile.athlete_code : '';
    return (_t('roles.athlete') + ' ' + code).trim();
  }
  return '';
}

// ── Sidebar ──────────────────────────────────────────────────
// v01.06 — When `mobile` is true, the sidebar repositions as a
// fixed slide-in drawer (left edge, full height) controlled by
// `mobileOpen`. When `mobile` is false, sticky 240px column
// behaves exactly as before. Same component, same children —
// only the positioning shell flips.

const Sidebar = ({
  active, onNav, persona, profile, role, fallbackEmail, version, onSignOut,
  mobile, mobileOpen, onCloseMobile,
  onOpenAccount, isPro,
  badges,
  // v01.27 — extraGroups appended to the persona's nav stack (e.g.
  // an Admin group for users with isRaceAdmin or isSuperAdmin).
  // Each group is the same shape as NAV_ATHLETE entries:
  //   { labelKey, items: [{ id, icon, i18nKey }] }
  extraGroups,
}) => {
  // v01.21 — useT() bridges PA_I18N into render. Belt-and-suspenders
  // fallback so the Sidebar doesn't break if shared.jsx hasn't
  // compiled before web-shell.jsx mounts (rare race during boot).
  const t = (window.useT || (() => (k) => k))();
  const baseGroups = persona === 'coach' ? NAV_COACH : NAV_ATHLETE;
  const groups = extraGroups && extraGroups.length
    ? [...baseGroups, ...extraGroups]
    : baseGroups;
  const initials = initialsFrom(profile, role, fallbackEmail);
  const name     = displayNameFrom(profile, role, fallbackEmail);
  const sub      = roleSublabelFrom(profile, role, t);

  // Esc closes drawer when open on mobile.
  React.useEffect(() => {
    if (!mobile || !mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseMobile?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile, mobileOpen, onCloseMobile]);

  // Wrap nav clicks so mobile auto-closes the drawer after picking.
  const handleNav = (id) => {
    if (onNav) onNav(id);
    if (mobile) onCloseMobile?.();
  };

  const positioning = mobile
    ? {
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 280, maxWidth: '85vw',
        zIndex: 1100,
        transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.22s ease',
        boxShadow: mobileOpen ? '0 0 40px color-mix(in oklch, var(--ink) 40%, transparent)' : 'none',
        height: '100vh',
      }
    : {
        width: 240,
        flexShrink: 0,
        position: 'sticky', top: 0,
        height: '100vh', alignSelf: 'flex-start',
      };

  return (
    <aside style={{
      ...positioning,
      background: 'var(--bg-2)',
      borderRight: '1px solid var(--line)',
      padding: '22px 16px',
      display: 'flex', flexDirection: 'column', gap: 20,
      overflowY: 'auto',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 6px 14px' }}>
        <PeakMark size={28} color="var(--signal-eff)"/>
        <div style={{ lineHeight: 1, minWidth: 0 }}>
          <div className="display" style={{ fontSize: 17, letterSpacing: '-0.02em', color: 'var(--tx-hi)' }}>
            Performance&nbsp;<span style={{ color: 'var(--signal-eff)' }}>Lab</span>
          </div>
          <div className="eyebrow" style={{ fontSize: 9, color: 'var(--tx-lo)', marginTop: 6 }}>
            BY <span style={{ color: 'var(--tx-md)', fontWeight: 700 }}>PEAK&nbsp;ATHLETE</span>
          </div>
        </div>
      </div>

      {/* Nav groups */}
      {groups.map(g => (
        <div key={g.labelKey}>
          <div className="eyebrow" style={{ fontSize: 9, padding: '0 10px 8px', color: 'var(--tx-lo)' }}>
            {t(g.labelKey)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.items.map(it => {
              const isActive = active === it.id;
              const badgeCount = badges && badges[it.id];
              return (
                <div
                  key={it.id}
                  onClick={() => handleNav(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 10px', borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? 'color-mix(in oklch, var(--signal-eff) 14%, transparent)' : 'transparent',
                    color: isActive ? 'var(--signal-eff)' : 'var(--tx-md)',
                    font: '500 13px var(--font-ui)',
                    borderLeft: isActive ? '2px solid var(--signal-eff)' : '2px solid transparent',
                    paddingLeft: isActive ? 8 : 10,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <Icon name={it.icon} size={15}/>
                  <span style={{ flex: 1, minWidth: 0 }}>{t(it.i18nKey)}</span>
                  {/* v01.16 — pending-count badge. Renders only when
                      badges[id] is a positive integer. Uses amber so
                      it reads as "in progress" rather than "alert". */}
                  {badgeCount > 0 && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center',
                      minWidth: 18, height: 18, padding: '0 6px',
                      borderRadius: 999,
                      background: 'color-mix(in oklch, var(--amber-eff) 18%, transparent)',
                      color: 'var(--amber-eff)',
                      border: '1px solid color-mix(in oklch, var(--amber-eff) 40%, transparent)',
                      font: '700 10px var(--font-ui)',
                      letterSpacing: '0.04em',
                      flexShrink: 0,
                    }}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ flex: 1 }}/>

      {/* Request Analysis (v01.59 — synced from mobile v02.12) —
          secondary placement of the Deck hero's CTA, here so the
          action is reachable from any page. Athlete persona only —
          coaches don't request analyses for themselves. Component
          owns its own usePARequests() hook and dispatches
          pa:open-modal on click; AthleteDeck's modal manager picks
          it up and opens the right sub-modal (upload / buy). */}
      {persona === 'athlete' && profile?.athlete_uuid && window.RequestAnalysisInline && (
        <div style={{ padding: '0 2px' }}>
          <window.RequestAnalysisInline
            athleteUuid={profile.athlete_uuid}
            fullWidth={true}/>
        </div>
      )}

      {/* User card — v01.15: click avatar/name to open Account modal.
          Sign-out row stays a separate target so the upper area can
          be a single clickable surface. PRO badge sits next to the
          name when the user has an active Pro subscription. */}
      <div style={{
        padding: 14, borderRadius: 12,
        background: 'var(--bg-3)', border: '1px solid var(--line-soft)',
      }}>
        <button
          type="button"
          onClick={onOpenAccount}
          disabled={!onOpenAccount}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%',
            padding: 0,
            border: 'none', background: 'transparent',
            cursor: onOpenAccount ? 'pointer' : 'default',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            if (!onOpenAccount) return;
            const txt = e.currentTarget.querySelector('[data-uname]');
            if (txt) txt.style.color = 'var(--signal-eff)';
          }}
          onMouseLeave={(e) => {
            if (!onOpenAccount) return;
            const txt = e.currentTarget.querySelector('[data-uname]');
            if (txt) txt.style.color = 'var(--tx-hi)';
          }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--signal-eff), var(--lime-eff))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--ink)', font: '700 13px var(--font-display)',
            flexShrink: 0,
          }}>{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div data-uname style={{
                font: '600 13px var(--font-ui)', color: 'var(--tx-hi)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                transition: 'color 0.12s',
                minWidth: 0, flex: 1,
              }}>{name}</div>
              {isPro && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '2px 6px', borderRadius: 4,
                  background: 'color-mix(in oklch, var(--lime-eff) 16%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--lime-eff) 35%, transparent)',
                  color: 'var(--lime-eff)',
                  font: '700 9px var(--font-ui)',
                  letterSpacing: '0.08em',
                  flexShrink: 0,
                }}>{t('sidebar.proBadge')}</span>
              )}
            </div>
            <div style={{ font: '500 11px var(--font-ui)', color: 'var(--tx-lo)' }}>{sub}</div>
          </div>
        </button>

        {/* Sign-out row */}
        <div
          onClick={onSignOut}
          style={{
            marginTop: 10, padding: '8px 4px',
            borderTop: '1px solid var(--line-soft)',
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--tx-lo)', cursor: 'pointer',
            font: '500 11px var(--font-ui)',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--tx-md)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--tx-lo)'}
        >
          <Icon name="logout" size={13}/> {t('auth.signOut')}
        </div>
      </div>

      {/* v01.48 — Support email link. Plain mailto for now;
          obfuscation isn't worthwhile in an authenticated app
          (only signed-in users see this). Renders just above
          the version stamp so it's findable without competing
          with primary nav. */}
      <a
        href={'mailto:' + (window.PA_SUPPORT_EMAIL || 'eric@mypeakathlete.com')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 4, padding: '6px 4px',
          font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
          textDecoration: 'none',
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--tx-md)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--tx-lo)'}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        {t('sidebar.support')}
      </a>

      {/* Version stamp */}
      {version && (
        <div className="mono" style={{
          textAlign: 'center', fontSize: 9, color: 'var(--tx-lo)',
          letterSpacing: 0.1, textTransform: 'uppercase', marginTop: 4,
        }}>
          {t('sidebar.prototype')} {version}
        </div>
      )}
    </aside>
  );
};

// ── Topbar ───────────────────────────────────────────────────
// v01.06 — On mobile (<768px): hamburger appears on the left,
// search field hides (it was placeholder-only anyway — global
// search palette is post-cutover work), title font scales down,
// horizontal padding tightens. On desktop: identical to v01.05.

const Topbar = ({ title, sub, scope, onToggleScope, impersonating, mobile, onOpenDrawer, trialDays, onOpenAccount }) => {
  const t = (window.useT || (() => (k) => k))();
  return (
  <div style={{
    display: 'flex', alignItems: 'center', gap: mobile ? 10 : 16,
    padding: mobile ? '16px 16px 12px' : '22px 32px 16px',
    // v00.48: orange-tinted top + bottom borders when a super
    // admin is "viewing as" another athlete. Hard-to-miss visual
    // cue so PII is never accidentally read as the admin's own.
    borderTop: impersonating
      ? '3px solid var(--amber-eff)'
      : '3px solid transparent',
    borderBottom: impersonating
      ? '1px solid color-mix(in oklch, var(--amber-eff) 55%, transparent)'
      : '1px solid var(--line-soft)',
    background: impersonating
      ? 'color-mix(in oklch, var(--amber-eff) 4%, var(--bg))'
      : 'var(--bg)',
    position: 'sticky', top: 0, zIndex: 10,
  }}>
    {/* Hamburger — mobile only, leftmost */}
    {mobile && (
      <button
        onClick={onOpenDrawer}
        aria-label={t('topbar.openMenu')}
        style={{
          width: 40, height: 40, borderRadius: 10,
          border: '1px solid var(--line)',
          background: 'var(--bg-2)', color: 'var(--tx-md)',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="menu" size={18}/>
      </button>
    )}

    <div style={{ flex: 1, minWidth: 0 }}>
      {sub && <div className="eyebrow" style={{ marginBottom: 6 }}>{sub}</div>}
      <div className="display" style={{
        fontSize: mobile ? 19 : 26,
        color: 'var(--tx-hi)', letterSpacing: '-0.02em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {title}
      </div>
    </div>

    {/* v01.15 — Trial countdown chip. Shown when trialDays is a
        positive integer (i.e. user is on a Pro trial). Click opens
        the Account modal so the user can review/extend. Hidden on
        mobile to keep the topbar uncluttered; the Account modal's
        Subscription tab still surfaces the same info there. */}
    {!mobile && trialDays != null && trialDays >= 0 && (
      <button
        type="button"
        onClick={onOpenAccount}
        style={{
          padding: '6px 11px',
          borderRadius: 999,
          border: '1px solid color-mix(in oklch, var(--lime-eff) 35%, transparent)',
          background: 'color-mix(in oklch, var(--lime-eff) 12%, transparent)',
          color: 'var(--lime-eff)',
          font: '700 11px var(--font-ui)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor: onOpenAccount ? 'pointer' : 'default',
          flexShrink: 0,
        }}
        title={t('topbar.viewTrial')}>
        {/* trialDays interpolation. 0 → "trial ends today", 1+ →
            "{days} days left in trial". Uppercased for the chip
            style. Both EN and ES handle the plural cleanly via
            interpolation. */}
        {trialDays === 0
          ? t('topbar.trialEndsToday')
          : t('topbar.trialDaysLeft', { days: trialDays }).toUpperCase()}
      </button>
    )}

    {/* Search — hidden in v03.06 until the cmd-K palette is wired.
        Shipping a non-functional input on a live dashboard is worse
        than shipping no search at all. Restore this block when the
        palette + global search API exist. */}
    {false && !mobile && (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 999,
        border: '1px solid var(--line)', background: 'var(--bg-2)',
        color: 'var(--tx-md)', font: '500 12px var(--font-ui)',
      }}>
        <Icon name="search" size={14}/> {t('topbar.search')}
        <span className="mono" style={{
          marginLeft: 6, padding: '2px 6px', borderRadius: 4,
          background: 'var(--bg-3)', fontSize: 10, color: 'var(--tx-lo)',
        }}>⌘K</span>
      </div>
    )}

    {/* Scope toggle */}
    <button
      onClick={onToggleScope}
      title={t(scope === 'dark' ? 'topbar.switchToLight' : 'topbar.switchToDark')}
      style={{
        width: 36, height: 36, borderRadius: 999,
        border: '1px solid var(--line)',
        background: 'var(--bg-2)', color: 'var(--tx-md)',
        cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name={scope === 'dark' ? 'spark' : 'dot'} size={15}/>
    </button>

    {/* Bell — hidden in v03.06. The Batch 9 lock comment said this
        was already hidden but the `&&` gate was missing, so it was
        rendering as a non-functional decoration on a live build.
        Restore when a real notification source exists (coach notes,
        analysis-ready events, etc). */}
    {false && !mobile && (
      <div style={{
        width: 36, height: 36, borderRadius: 999,
        border: '1px solid var(--line)',
        background: 'var(--bg-2)', color: 'var(--tx-md)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', flexShrink: 0,
      }}>
        <Icon name="bell" size={15}/>
        <span style={{
          position: 'absolute', top: 7, right: 8,
          width: 7, height: 7, borderRadius: 999, background: 'var(--flag-eff)',
        }}/>
      </div>
    )}
  </div>
  );
};

// ── PageShell — wraps sidebar + topbar + content ─────────────
// v01.06 — Below 768px (`useIsMobile` flips true), Sidebar
// becomes a fixed slide-in drawer triggered by the Topbar
// hamburger; backdrop overlay closes on click; content padding
// tightens. Above 768px, layout is identical to v01.05.
//
// v01.65 — Threshold bumped from 768 → 1024 so iPad (portrait +
// landscape) and half-screen desktop browsers also get the drawer
// sidebar + hamburger topbar. At 1024+ the persistent sidebar fits
// comfortably alongside the content; below it, the sidebar steals
// too much horizontal room and forces the analysis grids into
// cramped layouts. Single threshold for everything (sidebar mode,
// drawer backdrop, topbar hamburger, content padding) so they flip
// together — partial states (drawer-only or hamburger-only) confuse
// users.
// v01.66 — Bumped 1024 → 1100. iPad Pro 12.9" portrait is exactly
// 1024 CSS pixels and was being missed by the strict less-than
// check. 1100 captures it plus buffer for orientation rotations
// where Safari reports off-by-one values.

const PageShell = ({
  active, onNav,
  title, sub,
  scope, onToggleScope,
  persona, profile, role, fallbackEmail, version, onSignOut,
  impersonating,
  // v01.15 — Batch 2 props
  onOpenAccount, isPro, trialDays,
  // v01.16 — Batch 3 nav badge map (e.g. { races: 2 })
  badges,
  // v01.27 — extra nav groups (admin, etc.)
  extraGroups,
  children,
}) => {
  const mobile = (window.useIsMobile || (() => false))(1100);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Whenever the breakpoint flips back to desktop, force-close
  // any in-flight drawer state so the next mobile rotation
  // starts fresh.
  React.useEffect(() => {
    if (!mobile) setDrawerOpen(false);
  }, [mobile]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar
        active={active} onNav={onNav}
        persona={persona} profile={profile} role={role}
        fallbackEmail={fallbackEmail} version={version}
        onSignOut={onSignOut}
        mobile={mobile}
        mobileOpen={drawerOpen}
        onCloseMobile={() => setDrawerOpen(false)}
        onOpenAccount={onOpenAccount}
        isPro={isPro}
        badges={badges}
        extraGroups={extraGroups}
      />

      {/* Mobile drawer backdrop — only renders when drawer open */}
      {mobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1090,
            background: 'color-mix(in oklch, var(--ink) 55%, transparent)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* v03.22 — overflowX:hidden on the content column so a page
          whose content momentarily runs wide (admin bar, a chart,
          a wide grid at an awkward breakpoint) clips here instead
          of dragging a horizontal scrollbar across the whole
          dashboard. minWidth:0 lets the flex child shrink; a
          nested element with its own overflow-x:auto still
          scrolls internally. */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>
        <Topbar
          title={title} sub={sub} scope={scope} onToggleScope={onToggleScope}
          impersonating={impersonating}
          mobile={mobile}
          onOpenDrawer={() => setDrawerOpen(true)}
          trialDays={trialDays}
          onOpenAccount={onOpenAccount}
        />
        <div style={{ padding: mobile ? '18px 16px 32px' : '24px 32px 40px' }}>
          {/* v01.50 — Preview Pro banner. Renders only when
              PA_PREVIEW.isOn() (subscribes via the usePreview
              hook inside the component). Sticky position above
              any page content. The banner's Upgrade CTA fires
              onOpenAccount which opens the Account modal
              subscription tab — same path the rest of the app uses. */}
          {window.PreviewBanner && (
            <window.PreviewBanner onUpgrade={onOpenAccount}/>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  NAV_ATHLETE, NAV_COACH,
  Sidebar, Topbar, PageShell,
});
