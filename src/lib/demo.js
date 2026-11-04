/* ─────────────────────────────────────
   Peak Athlete · Performance Lab
   PA_DEMO — Demo-team preview for coaches (v04.03, web only)

   Free coach accounts see nothing before Pro (coach gate, v03.90).
   This module lets them switch their workspace to the demo team
   (teams.is_demo, seeded 2026-11-02: one fictional athlete cloned
   from a real session) until they exit. Modelled on PA_PREVIEW.

   Security: nothing here grants access. The demo rows are readable
   by every signed-in user through the demo_read_* RLS policies, and
   every write policy still requires the coach's own team. Videos and
   reports are served by r2-download-url, which checks the demo team
   server-side. This module only decides WHAT the UI asks for.

   hideDemoRows(rows): because the demo rows are readable by everyone,
   list queries that rely on RLS alone (the Sessions tab, the library)
   would show the demo team to every user. They pass their rows
   through here, and the demo team is dropped unless demo mode is on.
   ───────────────────────────────────── */

(function () {
  let _on = false;
  let _team = null;          // { team_uuid, team_name } once fetched
  let _teamPromise = null;   // single in-flight / cached lookup
  let _ownTeamIsDemo = false; // the signed-in user's own team IS the demo team
  let _athletesPromise = null; // Set of demo-team athlete_uuids, fetched once

  function fetchDemoTeam() {
    if (_teamPromise) return _teamPromise;
    _teamPromise = (async () => {
      try {
        const c = window.supabaseClient;
        if (!c) return null;
        const { data, error } = await c
          .from('teams')
          .select('team_uuid, team_name')
          .eq('is_demo', true)
          .limit(1);
        if (error) { _teamPromise = null; return null; }
        return (data && data[0]) || null;
      } catch (_) { _teamPromise = null; return null; }
    })();
    return _teamPromise;
  }

  // Demo-team athletes (readable by every signed-in user via demo_read_athletes).
  function fetchDemoAthletes() {
    if (_athletesPromise) return _athletesPromise;
    _athletesPromise = (async () => {
      try {
        const t = await fetchDemoTeam();
        const c = window.supabaseClient;
        if (!t || !c) return new Set();
        const { data, error } = await c
          .from('athletes')
          .select('athlete_uuid')
          .eq('team_uuid', t.team_uuid);
        if (error) { _athletesPromise = null; return new Set(); }
        return new Set((data || []).map(r => r.athlete_uuid).filter(Boolean));
      } catch (_) { _athletesPromise = null; return new Set(); }
    })();
    return _athletesPromise;
  }

  // React hook: true when the given athlete belongs to the demo team. Used by
  // the players so demo CONTENT is watermarked and non-downloadable for every
  // viewer, admins included, not only for demo logins.
  function useDemoContent(athleteUuid) {
    const [isDemo, setIsDemo] = React.useState(false);
    React.useEffect(() => {
      let dead = false;
      if (!athleteUuid) { setIsDemo(false); return undefined; }
      fetchDemoAthletes().then(set => { if (!dead) setIsDemo(set.has(athleteUuid)); });
      return () => { dead = true; };
    }, [athleteUuid]);
    return isDemo;
  }

  function emit(on) {
    try { window.dispatchEvent(new CustomEvent('pa:demo-changed', { detail: { on } })); } catch (_) {}
  }
  function isOn() { return _on; }
  function team() { return _team; }

  // Restricted = demo preview on, or a login that lives on the demo team
  // (a shared demo coach). Restricted users play videos and view reports
  // in place but get no download or open-in-new-tab controls.
  async function setOwnTeam(teamUuid) {
    const t = teamUuid ? await fetchDemoTeam() : null;
    const next = !!(t && teamUuid && t.team_uuid === teamUuid);
    if (next !== _ownTeamIsDemo) { _ownTeamIsDemo = next; emit(_on); }
  }
  function isRestricted() { return _on || _ownTeamIsDemo; }
  function useRestricted() {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const onChange = () => bump((n) => n + 1);
      window.addEventListener('pa:demo-changed', onChange);
      return () => window.removeEventListener('pa:demo-changed', onChange);
    }, []);
    return _on || _ownTeamIsDemo;
  }

  async function enter() {
    if (_on) return true;
    const t = await fetchDemoTeam();
    if (!t) { try { console.warn('[PA_DEMO] no demo team found'); } catch (_) {} return false; }
    _team = t; _on = true; emit(true);
    try { console.log('[PA_DEMO] entered demo team'); } catch (_) {}
    return true;
  }
  function exit() {
    if (!_on) return;
    _on = false; emit(false);
    try { console.log('[PA_DEMO] exited demo team'); } catch (_) {}
  }

  // React hook: { on, team }, re-renders on pa:demo-changed.
  function useDemo() {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const onChange = () => bump((n) => n + 1);
      window.addEventListener('pa:demo-changed', onChange);
      return () => window.removeEventListener('pa:demo-changed', onChange);
    }, []);
    return { on: _on, team: _team };
  }

  // Drop demo-team rows from RLS-only lists unless demo mode is on.
  // Fails open (rows untouched) if the demo team cannot be read.
  async function hideDemoRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (_on || _ownTeamIsDemo || !list.length) return list;
    const t = await fetchDemoTeam();
    if (!t) return list;
    return list.filter(r => !r || r.team_uuid !== t.team_uuid);
  }

  // Leave demo mode when the user signs out.
  try {
    const c = window.supabaseClient;
    if (c && c.auth && c.auth.onAuthStateChange) {
      c.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') exit(); });
    }
  } catch (_) {}

  window.PA_DEMO = { isOn, team, enter, exit, useDemo, hideDemoRows, fetchDemoTeam,
                     setOwnTeam, isRestricted, useRestricted, useDemoContent, fetchDemoAthletes };
  try { console.log('[PA_DEMO] loaded (v04.03)'); } catch (_) {}
})();
