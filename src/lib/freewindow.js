/* ─────────────────────────────────────
   Peak Athlete · Performance Lab
   PA_FREEWINDOW — 30-day visibility window for Free accounts (v04.04)

   Business rule (Eric, 2026-11-03): a Free account sees each upload for
   30 days from its system timestamp (later of the row's timestamp and the
   launch date), then the row is locked. Pro, active entitlements and
   admins keep full history. Nothing is deleted. The demo team is exempt.

   The rule is ENFORCED on the server (lab_settings switch, helpers, RLS,
   r2-download-url). This module only reads the state so the UI can:
     - drop the old "2 most recent" client gate while the switch is on,
     - show "Expires in N days" on rows about to close,
     - render locked placeholders from get_my_locked_items(),
     - show the one-time announcement.
   While the switch is OFF every consumer falls back to today's behaviour.
   ───────────────────────────────────── */

(function () {
  const EMPTY = { ready: false, enabled: false, days: 30, launchAt: null, fullHistory: false, locked: [], freeVideo: true };
  let _state = { ...EMPTY };
  let _inflight = null;
  let _loadedFor = null; // user id the state was loaded for

  const emit = () => { try { window.dispatchEvent(new CustomEvent('pa:freewindow-changed')); } catch (_) {} };

  async function load(force) {
    const c = window.supabaseClient;
    if (!c) return _state;
    let uid = null;
    try { const { data: { session } } = await c.auth.getSession(); uid = session && session.user && session.user.id; } catch (_) {}
    if (!uid) { _state = { ...EMPTY, ready: true }; _loadedFor = null; emit(); return _state; }
    if (!force && _loadedFor === uid && _state.ready) return _state;
    if (_inflight) return _inflight;
    _inflight = (async () => {
      const next = { ...EMPTY, ready: true };
      try {
        // free_window() is the single source of truth: it returns enabled=true
        // for everyone once the switch is on, or only for listed test users
        // while it is off (staged testing).
        const [{ data: w }, { data: fh }, { data: cfg }] = await Promise.all([
          c.rpc('free_window'),
          c.rpc('has_full_history'),
          c.from('lab_settings').select('value').eq('key', 'free_window').maybeSingle(),
        ]);
        // free_video (default true): Free accounts play trial video inside the
        // window. Set it to false in lab_settings to return video to Pro-only
        // without a release.
        next.freeVideo = !(cfg && cfg.value && cfg.value.free_video === false);
        const v = (Array.isArray(w) ? w[0] : w) || {};
        next.enabled = !!v.enabled;
        next.days = Number(v.days) || 30;
        next.launchAt = v.launch_at ? new Date(v.launch_at) : null;
        next.fullHistory = fh === true;
        if (next.enabled && !next.fullHistory) {
          const { data: locked } = await c.rpc('get_my_locked_items');
          next.locked = Array.isArray(locked) ? locked : [];
        }
      } catch (_) { /* fail closed to the old behaviour: enabled stays false */ }
      _state = next; _loadedFor = uid; _inflight = null; emit();
      return _state;
    })();
    return _inflight;
  }
  function invalidate() { _loadedFor = null; load(true); }

  // Expiry for a row timestamp under the current window; null when the
  // window is off or the viewer has full history.
  function expiresAt(ts) {
    if (!_state.ready || !_state.enabled || _state.fullHistory || !ts) return null;
    const t = new Date(ts); if (isNaN(t)) return null;
    const start = (_state.launchAt && _state.launchAt > t) ? _state.launchAt : t;
    return new Date(start.getTime() + _state.days * 86400000);
  }
  function daysLeft(ts) {
    const e = expiresAt(ts); if (!e) return null;
    return Math.max(0, Math.ceil((e.getTime() - Date.now()) / 86400000));
  }

  // React hook: current state, re-renders on change; loads on first use.
  function useFreeWindow() {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const onChange = () => bump((n) => n + 1);
      window.addEventListener('pa:freewindow-changed', onChange);
      window.addEventListener('pa:profile-changed', invalidate);
      load(false);
      return () => {
        window.removeEventListener('pa:freewindow-changed', onChange);
        window.removeEventListener('pa:profile-changed', invalidate);
      };
    }, []);
    return _state;
  }

  // One-time announcement (user_flags). Shown once per account while the
  // window is on and the viewer does not have full history.
  const FLAG = 'free_window_announce_v1';
  let _announce = null; // null = unknown, true/false once checked
  async function shouldAnnounce() {
    const c = window.supabaseClient; if (!c) return false;
    const st = await load(false);
    if (!st.enabled || st.fullHistory) return false;
    if (_announce !== null) return _announce;
    try {
      const { data } = await c.from('user_flags').select('flag_key').eq('flag_key', FLAG).maybeSingle();
      _announce = !data;
    } catch (_) { _announce = false; }
    return _announce;
  }
  async function markAnnounced() {
    _announce = false;
    const c = window.supabaseClient; if (!c) return;
    try {
      const { data: { session } } = await c.auth.getSession();
      const uid = session && session.user && session.user.id;
      if (uid) await c.from('user_flags').insert({ user_id: uid, flag_key: FLAG });
    } catch (_) {}
  }
  function useAnnouncement() {
    const [show, setShow] = React.useState(false);
    React.useEffect(() => {
      let dead = false;
      shouldAnnounce().then(v => { if (!dead) setShow(!!v); });
      const onChange = () => shouldAnnounce().then(v => { if (!dead) setShow(!!v); });
      window.addEventListener('pa:freewindow-changed', onChange);
      return () => { dead = true; window.removeEventListener('pa:freewindow-changed', onChange); };
    }, []);
    return { show, dismiss: () => { setShow(false); markAnnounced(); } };
  }

  // Badge text for a row timestamp: null unless it closes within 7 days.
  function badgeText(ts, t) {
    const n = daysLeft(ts);
    if (n == null || n > 7) return null;
    if (n <= 0) return t('freeWindow.expiresToday');
    return n === 1 ? t('freeWindow.expiresIn1') : t('freeWindow.expiresIn', { n });
  }

  window.PA_FREEWINDOW = { load, invalidate, useFreeWindow, expiresAt, daysLeft, badgeText, useAnnouncement, markAnnounced };
  try { console.log('[PA_FREEWINDOW] loaded (v04.04)'); } catch (_) {}
})();
