/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   i18n — Spanish parity infrastructure (Batch 4 / v01.20)

   What this module is:
     - Loads en.json + es.json from src/i18n/ via fetch on boot.
     - Exposes window.PA_I18N = { t, getLang, setLang, ... }.
     - Persists choice to localStorage `pa_lang` (matches live).
     - Dispatches `pa:lang-changed` on toggle so React components
       re-render in the new language.
     - Dispatches `pa:lang-loaded` once dicts arrive (first paint
       can pre-fill English fallbacks; once dicts land, components
       re-render with the user's chosen language).

   Translation strategy (locked 2026-05-05, see
   FEATURE-PARITY-AUDIT.md "Translation source — hybrid approach"):
     - Bootstrap shared concepts (nav, common buttons, modal
       chrome) from live's data-i18n table.
     - Write fresh for prototype-only surfaces (HeadlineStory,
       FocusCards, NextFocus, SquadFocus, ErrorState, EmptyState).

   Translation rollout order (locked):
     1. v01.20 — infrastructure + Account modal preferences (this version)
     2. v01.21 — Topbar / Sidebar / Nav
     3. v01.22 — Account modal (all 4 tabs)
     4. v01.23 — Deck (Athlete + Coach)
     5. v01.24 — Analysis pages (Races / Starts / Turns)
     6. v01.25 — Empty / Error / Loading states + story templates ES

   From v01.20 forward: every new component uses `useT()` from day
   one. No English-only code lands.

   `t(key, replacements)`:
     - Walks the dict on dot-path. e.g. `t('account.tabs.profile')`
       returns "Profile" / "Perfil".
     - {placeholder} interpolation. e.g.
       `t('greeting', { name: 'Eric' })` → "Hi, Eric".
     - Fallback chain: current lang dict → English dict → key itself.
   ─────────────────────────────────────────────────────────── */

(function () {
  const STORAGE_KEY = 'pa_lang';
  const DEFAULT_LANG = 'en';
  const SUPPORTED = ['en', 'es'];

  // Resolve initial lang from localStorage. Guard against any
  // malformed value (e.g. someone manually edited LS to 'fr').
  let currentLang = DEFAULT_LANG;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) currentLang = stored;
  } catch (_) { /* localStorage may be blocked in some contexts */ }

  // Dictionaries — null until fetch resolves. While null, t() falls
  // back to the key itself (which reads as English-ish since most
  // keys are written in English by convention).
  const DICTS = { en: null, es: null };

  // Walk a dot-path through a nested dict. Returns string or undefined.
  function lookup(dict, path) {
    if (!dict || !path) return undefined;
    const parts = String(path).split('.');
    let cur = dict;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return typeof cur === 'string' ? cur : undefined;
  }

  // Apply {placeholder} interpolation. Missing keys leave the literal
  // {placeholder} in place — easier to spot during testing than a
  // silent removal.
  function interpolate(str, replacements) {
    if (!replacements || typeof replacements !== 'object') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (replacements[k] != null ? String(replacements[k]) : m));
  }

  function t(key, replacements) {
    let raw = lookup(DICTS[currentLang], key);
    if (raw === undefined && currentLang !== DEFAULT_LANG) {
      raw = lookup(DICTS[DEFAULT_LANG], key);
    }
    if (raw === undefined) return key;
    return interpolate(raw, replacements);
  }

  function getLang() { return currentLang; }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return false;
    if (lang === currentLang) return false;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('pa:lang-changed', { detail: { lang } }));
    } catch (_) {}
    return true;
  }

  // Fetch dictionaries in parallel. Cache-bust with the current
  // PROTO_VERSION so each version's dict is fetched fresh (rather
  // than the browser holding a stale copy through a deploy).
  async function loadDicts() {
    const v = window.PROTO_VERSION || 'dev';
    const work = SUPPORTED.map(async (lang) => {
      try {
        const res = await fetch('src/i18n/' + lang + '.json?v=' + v);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        DICTS[lang] = await res.json();
      } catch (e) {
        try { console.warn('[PA_I18N] failed to load ' + lang + ':', e.message || e); } catch (_) {}
        DICTS[lang] = {};
      }
    });
    await Promise.all(work);
    try {
      window.dispatchEvent(new CustomEvent('pa:lang-loaded'));
    } catch (_) {}
  }

  // Kick off the load on module init. Async — components that mount
  // before this resolves will get key fallbacks; once the
  // pa:lang-loaded event fires, they re-render with translations.
  loadDicts();

  // ── Expose ──────────────────────────────────────────────
  window.PA_I18N = {
    t, getLang, setLang,
    SUPPORTED, DEFAULT_LANG, STORAGE_KEY,
  };

  // Dev hook (per locked Q12, 2026-05-05). Lets Eric flip languages
  // from the console without opening the Account modal:
  //   PA_DEV.setLang('es'); PA_DEV.setLang('en');
  window.PA_DEV = window.PA_DEV || {};
  window.PA_DEV.setLang = setLang;
  window.PA_DEV.getLang = getLang;

  try { console.log('[PA_I18N] loaded (v01.20) — current lang: ' + currentLang); } catch (_) {}
})();
