/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   PA_GROUPS — DB-backed athlete groups (v01.41 — Batch 7c)

   Replaces the prototype's localStorage-only groups (`pa.team.groups`)
   with the same `athlete_groups` + `athlete_group_members` tables
   that live's index.html has been writing to since v02.x. Mirrors
   live's queries 1:1 so RLS that authorizes one app authorizes the
   other. No schema changes, no new RPCs, no new edge functions.

   Group shape returned from listGroups (mirrors the existing
   prototype localStorage shape so the React render code is
   unchanged — only the persistence layer flips):

     {
       id:           group_uuid,
       name:         group_name,
       color:        group_color,
       preset:       false,
       athleteUuids: [athlete_uuid, ...],
     }

   Preset groups (Sprinters / IM / Distance) are computed
   client-side in web-races.jsx from athlete trial sets — those
   stay client-side. PA_GROUPS only handles custom (coach-defined)
   groups.

   RLS notes:
     athlete_groups        — `is_coach_of_team` policy (live-tested)
     athlete_group_members — same; member rows are SELECT-able by
                             coaches of the team and by the
                             athletes themselves
   ─────────────────────────────────────────────────────────── */

(function () {
  const sb = () => window.supabaseClient;

  // Rotating palette for one-time migration (locked Q5=B).
  // Falls back to the signal accent if any token is missing.
  const PALETTE = [
    'var(--signal-eff)', // teal
    'var(--lime-eff)',   // lime
    'var(--amber-eff)',  // amber
    'var(--flag-eff)',   // ember (red-ish, distinct from amber)
  ];
  function paletteColor(i) {
    return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }

  // ── List groups (with members) ──────────────────────────
  // Two queries: groups, then members. Joining client-side
  // because Supabase REST nested SELECT requires FK metadata
  // and the existing live code does it this way too
  // (index.html:11038-11053).
  async function listGroups(teamUuid) {
    if (!teamUuid) return { groups: [], error: null };
    const client = sb();
    try {
      const { data: groups, error: gErr } = await client
        .from('athlete_groups')
        .select('group_uuid, group_name, group_color, created_at')
        .eq('team_uuid', teamUuid)
        .order('created_at', { ascending: true });
      if (gErr) return { groups: [], error: gErr };
      const groupRows = groups || [];
      if (!groupRows.length) return { groups: [], error: null };

      const groupUuids = groupRows.map(g => g.group_uuid);
      const { data: members, error: mErr } = await client
        .from('athlete_group_members')
        .select('group_uuid, athlete_uuid')
        .in('group_uuid', groupUuids);
      if (mErr) return { groups: [], error: mErr };

      const byGroup = {};
      groupRows.forEach(g => { byGroup[g.group_uuid] = []; });
      (members || []).forEach(m => {
        if (byGroup[m.group_uuid]) byGroup[m.group_uuid].push(m.athlete_uuid);
      });

      const shaped = groupRows.map(g => ({
        id:           g.group_uuid,
        name:         g.group_name,
        color:        g.group_color || 'var(--signal-eff)',
        preset:       false,
        athleteUuids: byGroup[g.group_uuid] || [],
      }));
      return { groups: shaped, error: null };
    } catch (e) {
      return { groups: [], error: e };
    }
  }

  // ── Create group (with optional initial members) ────────
  // Two-step: INSERT group → INSERT members. If member insert
  // fails after group is created, the group exists with zero
  // members. That's recoverable via editGroupMembers; not worth
  // the complexity of cleanup here.
  async function createGroup(teamUuid, name, color, athleteUuids) {
    if (!teamUuid || !name || !name.trim()) {
      return { ok: false, groupUuid: null, error: { message: 'Missing team or name.' } };
    }
    const client = sb();
    const { data: { user } } = await client.auth.getUser();

    try {
      const { data, error } = await client
        .from('athlete_groups')
        .insert({
          team_uuid:       teamUuid,
          group_name:      name.trim(),
          group_color:     color || 'var(--signal-eff)',
          created_by_uuid: user?.id || null,
        })
        .select('group_uuid')
        .single();
      if (error) return { ok: false, groupUuid: null, error };

      const newUuid = data.group_uuid;
      if (athleteUuids && athleteUuids.length) {
        const rows = athleteUuids.map(uuid => ({
          group_uuid:   newUuid,
          athlete_uuid: uuid,
        }));
        const { error: mErr } = await client
          .from('athlete_group_members')
          .insert(rows);
        if (mErr) {
          try { console.warn('[PA_GROUPS] createGroup: member insert failed', mErr.message); } catch (_) {}
          // Group created but members failed — return ok with the group;
          // caller can retry editGroupMembers.
        }
      }
      return { ok: true, groupUuid: newUuid, error: null };
    } catch (e) {
      return { ok: false, groupUuid: null, error: e };
    }
  }

  // ── Delete group ─────────────────────────────────────────
  // FK CASCADE on athlete_group_members removes member rows
  // automatically (live's index.html:11086 does just the
  // group delete, so the cascade is in place server-side).
  async function deleteGroup(groupUuid) {
    if (!groupUuid) {
      return { ok: false, error: { message: 'Missing group uuid.' } };
    }
    const { error } = await sb()
      .from('athlete_groups')
      .delete()
      .eq('group_uuid', groupUuid);
    return { ok: !error, error: error || null };
  }

  // ── Replace group members ────────────────────────────────
  // Implemented as DELETE-all-then-INSERT-new for simplicity.
  // Atomic at the SQL level it isn't, but the worst case (insert
  // fails after delete) leaves the group empty — recoverable on
  // retry. Same pattern as live's editGroupMembers chains.
  async function updateGroupMembers(groupUuid, athleteUuids) {
    if (!groupUuid) {
      return { ok: false, error: { message: 'Missing group uuid.' } };
    }
    const client = sb();
    const next = athleteUuids || [];
    try {
      const { error: dErr } = await client
        .from('athlete_group_members')
        .delete()
        .eq('group_uuid', groupUuid);
      if (dErr) return { ok: false, error: dErr };

      if (next.length) {
        const rows = next.map(uuid => ({
          group_uuid:   groupUuid,
          athlete_uuid: uuid,
        }));
        const { error: iErr } = await client
          .from('athlete_group_members')
          .insert(rows);
        if (iErr) return { ok: false, error: iErr };
      }
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // ── Single add / remove ──────────────────────────────────
  // Granular helpers for future drag-and-drop or per-row
  // toggles. Not used by the current filter-drawer UX but
  // kept on the API for parity with live and future use.
  async function addToGroup(groupUuid, athleteUuid) {
    if (!groupUuid || !athleteUuid) {
      return { ok: false, error: { message: 'Missing group or athlete uuid.' } };
    }
    const { error } = await sb()
      .from('athlete_group_members')
      .insert({ group_uuid: groupUuid, athlete_uuid: athleteUuid });
    return { ok: !error, error: error || null };
  }
  async function removeFromGroup(groupUuid, athleteUuid) {
    if (!groupUuid || !athleteUuid) {
      return { ok: false, error: { message: 'Missing group or athlete uuid.' } };
    }
    const { error } = await sb()
      .from('athlete_group_members')
      .delete()
      .eq('group_uuid', groupUuid)
      .eq('athlete_uuid', athleteUuid);
    return { ok: !error, error: error || null };
  }

  // ── One-time migration from localStorage ─────────────────
  // Locked decision (Q5=B, 2026-05-07): silent migration.
  //
  // Reads `pa.team.groups` (legacy localStorage), creates each
  // group + members in the DB for the given team_uuid, sets a
  // per-team flag to ensure idempotency.
  //
  // The legacy localStorage data is NOT deleted — this gives a
  // safety undo path. Future polish can clear it once the DB
  // path has been verified in production.
  //
  // Returns { migrated: <int>, alreadyMigrated: bool, error }.
  // Callers can fire-and-forget; the result is informational.
  const LEGACY_LS_KEY    = 'pa.team.groups';
  const MIGRATED_LS_BASE = 'pa.team.groups.migrated.';

  async function migrateLocalStorageToDb(teamUuid) {
    if (!teamUuid) return { migrated: 0, alreadyMigrated: false, error: null };
    const flagKey = MIGRATED_LS_BASE + teamUuid;

    try {
      if (localStorage.getItem(flagKey) === 'true') {
        return { migrated: 0, alreadyMigrated: true, error: null };
      }
      const raw = localStorage.getItem(LEGACY_LS_KEY);
      if (!raw) {
        // Nothing to migrate — set flag anyway so we don't
        // recheck on every page load.
        try { localStorage.setItem(flagKey, 'true'); } catch (_) {}
        return { migrated: 0, alreadyMigrated: false, error: null };
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
      const legacyGroups = Array.isArray(parsed) ? parsed : [];
      if (!legacyGroups.length) {
        try { localStorage.setItem(flagKey, 'true'); } catch (_) {}
        return { migrated: 0, alreadyMigrated: false, error: null };
      }

      let count = 0;
      for (let i = 0; i < legacyGroups.length; i++) {
        const lg = legacyGroups[i];
        if (!lg || !lg.name || !Array.isArray(lg.athleteUuids)) continue;
        const color = paletteColor(i);
        const { ok } = await createGroup(
          teamUuid, lg.name, color, lg.athleteUuids
        );
        if (ok) count++;
      }
      try { localStorage.setItem(flagKey, 'true'); } catch (_) {}
      try { console.log('[PA_GROUPS] migrated ' + count + ' group(s) for team ' + teamUuid.slice(0, 8)); } catch (_) {}
      return { migrated: count, alreadyMigrated: false, error: null };
    } catch (e) {
      return { migrated: 0, alreadyMigrated: false, error: e };
    }
  }

  // ── Expose ──────────────────────────────────────────────
  window.PA_GROUPS = {
    listGroups,
    createGroup,
    deleteGroup,
    updateGroupMembers,
    addToGroup,
    removeFromGroup,
    migrateLocalStorageToDb,
    // constants exposed for tests / introspection
    PALETTE, LEGACY_LS_KEY, MIGRATED_LS_BASE,
  };

  try { console.log('[PA_GROUPS] loaded (v01.41)'); } catch (_) {}
})();
