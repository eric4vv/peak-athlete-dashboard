/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   PA_COMP — Competition opt-in (v01.45 — Batch 8b)

   Wraps live's competition_opt_ins + competition_entries write
   path 1:1 (live `index.html:18883-19007`). RLS gates these to
   the athlete's own row via `auth.uid() = auth_user_id`.

   Pro gate is enforced CLIENT-SIDE only (live does the same):
   athletes without an active Pro subscription can read everyone
   else's leaderboard rows but can't UPSERT their own opt-in.
   The DB itself doesn't check plan; the client refuses to fire
   the write when not Pro.

   Four competition keys (matches live's COMP_BOARDS):
     - fastest_start_15m
     - best_reaction
     - fastest_turn_15_15
     - best_race_pb

   No new schema, no new RPCs.
   ─────────────────────────────────────────────────────────── */

(function () {
  const sb = () => window.supabaseClient;

  // Canonical competition keys, ordered. Each key matches a board
  // surfaced in WebBoard. Adding a new board = add a key here +
  // wire it in web-board.jsx.
  const COMP_KEYS = [
    'fastest_start_15m',
    'best_reaction',
    'fastest_turn_15_15',
    'best_race_pb',
  ];

  // ── Read: opt-in status ─────────────────────────────────
  // Returns { optedIn: bool, error }. Default false on
  // missing/error so the UI fails closed.
  async function getOptInStatus(athleteUuid) {
    if (!athleteUuid) return { optedIn: false, error: null };
    try {
      const { data, error } = await sb()
        .from('competition_opt_ins')
        .select('opted_in')
        .eq('athlete_uuid', athleteUuid)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        return { optedIn: false, error };
      }
      return { optedIn: !!(data && data.opted_in), error: null };
    } catch (e) {
      return { optedIn: false, error: e };
    }
  }

  // ── Read: per-event entries ─────────────────────────────
  // Returns { entries: { [key]: bool }, error }. Keys not in
  // the result default to false (the UI assumes no row = not
  // enrolled).
  async function listEntries(athleteUuid) {
    if (!athleteUuid) return { entries: {}, error: null };
    try {
      const { data, error } = await sb()
        .from('competition_entries')
        .select('competition_key, enrolled')
        .eq('athlete_uuid', athleteUuid);
      if (error) return { entries: {}, error };
      const entries = {};
      (data || []).forEach(r => { entries[r.competition_key] = !!r.enrolled; });
      return { entries, error: null };
    } catch (e) {
      return { entries: {}, error: e };
    }
  }

  // ── Write: master opt-in ────────────────────────────────
  // UPSERT with onConflict on athlete_uuid (per live's pattern).
  // Mirrors live's `toggleCompetitionOptIn` (index.html:18883)
  // sans the Pro gate — that's the caller's responsibility, since
  // some callers may have already verified Pro elsewhere.
  async function setOptInStatus(athleteUuid, authUserId, optedIn) {
    if (!athleteUuid || !authUserId) {
      return { ok: false, error: { message: 'Missing athlete or user uuid.' } };
    }
    const { error } = await sb()
      .from('competition_opt_ins')
      .upsert({
        athlete_uuid: athleteUuid,
        auth_user_id: authUserId,
        opted_in:     !!optedIn,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'athlete_uuid' });
    return { ok: !error, error: error || null };
  }

  // ── Write: single per-event entry ───────────────────────
  // Mirrors live's `toggleCompetitionEntry` (index.html:18992).
  async function setEntry(athleteUuid, authUserId, compKey, enrolled) {
    if (!athleteUuid || !authUserId || !compKey) {
      return { ok: false, error: { message: 'Missing athlete, user, or key.' } };
    }
    const { error } = await sb()
      .from('competition_entries')
      .upsert({
        athlete_uuid:    athleteUuid,
        auth_user_id:    authUserId,
        competition_key: compKey,
        enrolled:        !!enrolled,
        updated_at:      new Date().toISOString(),
      }, { onConflict: 'athlete_uuid,competition_key' });
    return { ok: !error, error: error || null };
  }

  // ── Write: bulk auto-enroll (first opt-in) ──────────────
  // Live's pattern: when an athlete opts in for the first time
  // (no entries rows yet), auto-enroll in all comp keys with
  // enrolled=true. The user can disable individual ones later
  // via setEntry. Single batched UPSERT.
  async function bulkEnrollAll(athleteUuid, authUserId, keys) {
    if (!athleteUuid || !authUserId) {
      return { ok: false, error: { message: 'Missing athlete or user uuid.' } };
    }
    const list = (keys && keys.length) ? keys : COMP_KEYS;
    const now = new Date().toISOString();
    const rows = list.map(k => ({
      athlete_uuid:    athleteUuid,
      auth_user_id:    authUserId,
      competition_key: k,
      enrolled:        true,
      updated_at:      now,
    }));
    const { error } = await sb()
      .from('competition_entries')
      .upsert(rows, { onConflict: 'athlete_uuid,competition_key' });
    return { ok: !error, error: error || null };
  }

  // ── Expose ──────────────────────────────────────────────
  window.PA_COMP = {
    COMP_KEYS,
    getOptInStatus,
    listEntries,
    setOptInStatus,
    setEntry,
    bulkEnrollAll,
  };

  try { console.log('[PA_COMP] loaded (v01.45)'); } catch (_) {}
})();
