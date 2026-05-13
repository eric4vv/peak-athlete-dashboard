/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Team onboarding helpers — lookup, create, join.

   Backs the TeamOnboardingModal (v01.14, Batch 1c). Wraps the
   existing `teams` and `coaches` tables. No new schema, no new
   RPCs — just direct .from() reads/writes that respect the
   already-deployed RLS policies:

     teams:
       - teams_select_authed (any authed user can SELECT)
       - teams_insert_authed (any authed user can INSERT)
       - teams_update_own    (only active coaches of the team)

     coaches:
       - coaches_select_own       (own row)
       - coaches_select_teammates (teammates if on a team)
       - coaches_update_own       (own row, including team_uuid)

   Coach onboarding flow (per locked decisions 2026-05-05):
     1. Coach signs up via prototype → handle_new_user trigger
        creates a coaches row with team_uuid = NULL.
     2. After login, CoachDeck shows a "no team yet" empty
        state with two CTAs: Join existing team / Create team.
     3. Join: lookupTeamByCode → joinTeamAsCoach.
     4. Create: createTeam → coach is auto-linked.
     5. After either path, dispatch a `pa:profile-changed`
        event so AuthGate refreshes v_my_coach.
   ─────────────────────────────────────────────────────────── */

(function () {
  const sb = () => window.supabaseClient;

  // ── Code generation ─────────────────────────────────────
  // Existing codes follow `T_<short>` (e.g. T_SOFLO, T_WVU,
  // T_VEN). For brand-new teams, derive a code from the first
  // alpha block of the name. Collision is handled by
  // `createTeam` appending a numeric suffix.
  function generateTeamCode(name) {
    const cleaned = String(name || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5);
    return cleaned ? ('T_' + cleaned) : 'T_NEW';
  }

  // ── Lookup ──────────────────────────────────────────────
  // SELECT a team by its code. Returns the row or null. Case-
  // insensitive (`ilike`) and prefix-tolerant: users can enter
  // either the bare code (`VEN`) or the canonical form (`T_VEN`).
  // Mirrors live's two-shot lookup (index.html:18253) so the
  // prototype's UX matches the dashboard users already know.
  //
  // v01.32 — relaxed input: tries `T_<code>` first, then the raw
  // input. The reverse order is wrong (typing `T_VEN` would land
  // on `T_T_VEN` first, miss, then succeed) but fine because the
  // raw fallback catches it on the second try. Same as live.
  async function lookupTeamByCode(rawCode) {
    const raw = String(rawCode || '').trim().toUpperCase();
    if (!raw) return { team: null, error: null };
    const client = sb();

    // First try: prefixed form (covers users who typed just `VEN`).
    // Skip when the raw input already starts with `T_` so we don't
    // waste a round trip on `T_T_VEN`.
    const prefixed = raw.startsWith('T_') ? null : ('T_' + raw);
    if (prefixed) {
      const r1 = await client
        .from('teams')
        .select('team_uuid, team_code, team_name')
        .ilike('team_code', prefixed)
        .maybeSingle();
      if (r1.data) return { team: r1.data, error: null };
      if (r1.error && r1.error.code !== 'PGRST116') {
        return { team: null, error: r1.error };
      }
    }

    // Second try: raw input as-is. Catches `T_VEN`, fully-custom
    // codes without the prefix (`GATOR`), and miscellaneous edge
    // cases.
    const r2 = await client
      .from('teams')
      .select('team_uuid, team_code, team_name')
      .ilike('team_code', raw)
      .maybeSingle();
    if (r2.error && r2.error.code !== 'PGRST116') {
      return { team: null, error: r2.error };
    }
    return { team: r2.data || null, error: null };
  }

  // ── Create ──────────────────────────────────────────────
  // INSERT a new teams row, then UPDATE coaches.team_uuid for
  // the current user. If the generated code collides, append a
  // numeric suffix and retry up to MAX_TRIES times.
  //
  // Returns { team, error }. `team` is the inserted row on
  // success.
  async function createTeam(name) {
    const trimmed = String(name || '').trim();
    if (trimmed.length < 3) {
      return { team: null, error: { message: 'Team name must be at least 3 characters.' } };
    }

    const baseCode = generateTeamCode(trimmed);
    const MAX_TRIES = 5;

    for (let i = 0; i < MAX_TRIES; i++) {
      const code = i === 0 ? baseCode : (baseCode + i);

      // Check uniqueness up-front so we can suggest a friendlier
      // suffix instead of relying on the unique constraint to
      // throw. Race conditions still possible — the INSERT below
      // catches them.
      const { team: existing } = await lookupTeamByCode(code);
      if (existing) continue;

      const { data, error } = await sb()
        .from('teams')
        .insert({ team_name: trimmed, team_code: code })
        .select('team_uuid, team_code, team_name')
        .single();

      if (error) {
        // 23505 = unique_violation. Race lost — retry next code.
        if (error.code === '23505') continue;
        return { team: null, error };
      }

      // Link the current coach to the new team. RLS on coaches
      // (coaches_update_own) requires auth.uid() to match. The
      // INSERT above does NOT set the coach's team_uuid; that's
      // a follow-up step here.
      const linked = await joinTeamAsCoach(data.team_uuid);
      if (linked.error) return { team: null, error: linked.error };

      return { team: data, error: null };
    }

    return {
      team: null,
      error: { message: 'Could not generate a unique team code. Try a different team name.' },
    };
  }

  // ── Join ────────────────────────────────────────────────
  // UPDATE the current coach's team_uuid. RLS coaches_update_own
  // restricts this to auth.uid() = auth_user_id, so callers can
  // only modify their own row. Pre-existing team membership (a
  // coach who's already on a team and wants to switch) works the
  // same way — UPDATE replaces the value.
  async function joinTeamAsCoach(teamUuid) {
    if (!teamUuid) {
      return { ok: false, error: { message: 'No team to join.' } };
    }
    const { data: { user } } = await sb().auth.getUser();
    if (!user) {
      return { ok: false, error: { message: 'Not signed in.' } };
    }
    const { error } = await sb()
      .from('coaches')
      .update({ team_uuid: teamUuid })
      .eq('auth_user_id', user.id);
    return { ok: !error, error: error || null };
  }

  // ── Join team as ATHLETE (v01.31 — Batch 7a-bridge) ─────
  // Mirrors live's athlete-join (index.html:18324). Sets the
  // athlete's team_uuid AND flips membership_status to 'pending'
  // so they appear in the coach's PendingMembersPanel for
  // approval. Self-update only — RLS policy `athletes_update_own`
  // restricts the row to auth.uid() = auth_user_id.
  //
  // Athletes go through approval; coaches don't. That's the only
  // semantic difference vs joinTeamAsCoach.
  async function joinTeamAsAthlete(teamUuid) {
    if (!teamUuid) {
      return { ok: false, error: { message: 'No team to join.' } };
    }
    const { data: { user } } = await sb().auth.getUser();
    if (!user) {
      return { ok: false, error: { message: 'Not signed in.' } };
    }
    const { error } = await sb()
      .from('athletes')
      .update({ team_uuid: teamUuid, membership_status: 'pending' })
      .eq('auth_user_id', user.id);
    return { ok: !error, error: error || null };
  }

  // ── Pending member queries (v01.30 — Batch 7a) ──────────
  // Read + manage athletes / coaches with `membership_status = 'pending'`
  // on the active coach's team. Mirrors live's `loadPendingMembers`,
  // `approveMember`, `rejectMember` exactly so RLS policies that
  // already authorize live also authorize the prototype.
  //
  // The two role-specific tables (`athletes`, `coaches`) each carry
  // their own `membership_status` and `team_uuid` columns — there
  // is NO single `team_members` table. Approve/reject must dispatch
  // to the right table by `type`.

  // Returns { athletes:[], coaches:[], error } for the given team.
  // Filters out the caller's own coach row from the coaches list
  // so a pending-coach signed in can never see/self-approve.
  async function listPendingMembers(teamUuid) {
    if (!teamUuid) return { athletes: [], coaches: [], error: null };
    const client = sb();
    const { data: { user } } = await client.auth.getUser();
    const myAuthId = user?.id || null;

    const [aRes, cRes] = await Promise.all([
      client
        .from('athletes')
        .select('athlete_uuid, first_name, last_name, athlete_code, email, created_at')
        .eq('team_uuid', teamUuid)
        .eq('membership_status', 'pending')
        .order('created_at', { ascending: false }),
      client
        .from('coaches')
        .select('coach_uuid, coach_name, auth_user_id, created_at')
        .eq('team_uuid', teamUuid)
        .eq('membership_status', 'pending')
        .order('created_at', { ascending: false }),
    ]);

    const athletes = aRes.error ? [] : (aRes.data || []);
    const coaches  = cRes.error ? [] :
      (cRes.data || []).filter(c => c.auth_user_id !== myAuthId);

    const error = aRes.error || cRes.error || null;
    return { athletes, coaches, error };
  }

  // Cheap count for the sidebar badge + Deck banner. Returns 0 on
  // error rather than crashing the badge surface.
  async function countPendingMembers(teamUuid) {
    if (!teamUuid) return { count: 0, error: null };
    try {
      const { athletes, coaches, error } = await listPendingMembers(teamUuid);
      if (error) return { count: 0, error };
      return { count: (athletes.length + coaches.length), error: null };
    } catch (e) {
      return { count: 0, error: e };
    }
  }

  // Approve a single pending member. type is 'athlete' or 'coach'.
  // Mirrors live's approveMember exactly: just flips
  // membership_status to 'active'. RLS gates the UPDATE so non-
  // owners get a server-side denial.
  async function approveMember(memberId, type) {
    if (!memberId || !type) {
      return { ok: false, error: { message: 'Missing member id or type.' } };
    }
    const table = type === 'athlete' ? 'athletes' : 'coaches';
    const idCol = type === 'athlete' ? 'athlete_uuid' : 'coach_uuid';
    const { error } = await sb()
      .from(table)
      .update({ membership_status: 'active' })
      .eq(idCol, memberId);
    return { ok: !error, error: error || null };
  }

  // Reject a pending member. v01.36 — only flips status to
  // 'inactive'; does NOT null team_uuid. Reason: the RLS policy
  // `athletes_update_coach` is `USING (is_coach() AND team_uuid =
  // get_my_team_uuid())` with no separate WITH CHECK, so PostgreSQL
  // re-evaluates against the NEW row. Setting team_uuid=null
  // means `NULL = get_my_team_uuid()` is NULL → 403. Same problem
  // affects the coaches table policy. Keeping team_uuid linked
  // preserves the audit trail and supports an undo path
  // (re-approve flips status back to 'active').
  //
  // All listing queries filter by membership_status, so an
  // inactive row with a stale team_uuid is invisible everywhere
  // it matters. If the user later joins a different team, their
  // own `athletes_update_own` policy authorizes overwriting
  // team_uuid (auth.uid()-gated, doesn't check team_uuid).
  async function rejectMember(memberId, type) {
    if (!memberId || !type) {
      return { ok: false, error: { message: 'Missing member id or type.' } };
    }
    const table = type === 'athlete' ? 'athletes' : 'coaches';
    const idCol = type === 'athlete' ? 'athlete_uuid' : 'coach_uuid';
    const { error } = await sb()
      .from(table)
      .update({ membership_status: 'inactive' })
      .eq(idCol, memberId);
    return { ok: !error, error: error || null };
  }

  // ── Team coaches list (v01.33 — Batch 7b) ───────────────
  // Read all coaches on a team filtered by status. Mirrors live's
  // loadTeamCoaches (index.html:18000). Status filter defaults to
  // ['active','pending'] so the panel can render both with a
  // visual distinction (live does this).
  async function listTeamCoaches(teamUuid, statuses) {
    if (!teamUuid) return { coaches: [], error: null };
    const filter = (statuses && statuses.length) ? statuses : ['active', 'pending'];
    try {
      const { data, error } = await sb()
        .from('coaches')
        .select('coach_uuid, coach_name, auth_user_id, created_at, membership_status')
        .eq('team_uuid', teamUuid)
        .in('membership_status', filter)
        .order('coach_name');
      if (error) return { coaches: [], error };
      return { coaches: data || [], error: null };
    } catch (e) {
      return { coaches: [], error: e };
    }
  }

  // Count active coaches on a team — used by the last-coach guard
  // before allowing a coach's leaveTeam. Returns 0 on error to
  // fail-safe (block the leave rather than allow it on a transient
  // network blip).
  async function countActiveCoaches(teamUuid) {
    if (!teamUuid) return { count: 0, error: null };
    try {
      const { count, error } = await sb()
        .from('coaches')
        .select('coach_uuid', { count: 'exact', head: true })
        .eq('team_uuid', teamUuid)
        .eq('membership_status', 'active');
      if (error) return { count: 0, error };
      return { count: count || 0, error: null };
    } catch (e) {
      return { count: 0, error: e };
    }
  }

  // ── Remove member (v01.33 — Batch 7b) ───────────────────
  // Owner-coach acting on someone else's row. Mirrors live's
  // removeMember (index.html:18093). Sets status='inactive' and
  // nulls team_uuid. RLS gates which (id, type) combos the caller
  // can write — non-owners get a server-side denial.
  //
  // Self-removal must be blocked CLIENT-side too because RLS may
  // allow self-update via the owner policy if the owner is also
  // the target. Caller should pre-check `id !== currentUser`.
  //
  // v01.36 — same RLS gotcha as rejectMember above: don't null
  // team_uuid in the UPDATE, just flip status. PostgreSQL's
  // WITH CHECK evaluates the new row against `team_uuid =
  // get_my_team_uuid()`, which fails when team_uuid becomes
  // null. Status-only flip keeps the audit trail and supports
  // an undo path.
  async function removeMember(memberId, type) {
    if (!memberId || !type) {
      return { ok: false, error: { message: 'Missing member id or type.' } };
    }
    const table = type === 'athlete' ? 'athletes' : 'coaches';
    const idCol = type === 'athlete' ? 'athlete_uuid' : 'coach_uuid';
    const { error } = await sb()
      .from(table)
      .update({ membership_status: 'inactive' })
      .eq(idCol, memberId);
    return { ok: !error, error: error || null };
  }

  // ── Leave team (self) ──────────────────────────────────
  // Mirrors live's leaveTeam (index.html:18119). Self-update on
  // athletes or coaches table (auth.uid() = auth_user_id RLS
  // already in place). LEAVE != REJECT in RLS — different policy
  // gates this UPDATE on the caller's own row.
  //
  // role: 'athlete' | 'coach'. Required because we need to know
  // which table to write.
  // v01.36 — same RLS-friendly approach: don't null team_uuid.
  // For self-leave, the relevant policy is `*_update_own` which
  // checks auth_user_id, not team_uuid — so technically the null
  // would work HERE for the own row. But keeping consistency:
  // status-only flip across all leave/remove operations. If the
  // user rejoins another team, joinTeamAsAthlete /
  // joinTeamAsCoach overwrites team_uuid via the same own-row
  // policy.
  async function leaveTeamSelf(role) {
    const r = role === 'coach' ? 'coach' : 'athlete';
    const { data: { user } } = await sb().auth.getUser();
    if (!user) {
      return { ok: false, error: { message: 'Not signed in.' } };
    }
    const table = r === 'athlete' ? 'athletes' : 'coaches';
    const { error } = await sb()
      .from(table)
      .update({ membership_status: 'inactive' })
      .eq('auth_user_id', user.id);
    return { ok: !error, error: error || null };
  }

  // ── Check team ownership (v01.35) ───────────────────────
  // Mirrors live's two-shot owner check (index.html:9431-9455):
  //   1. Primary: teams.created_by_uuid === auth.uid()
  //   2. Fallback: earliest active coach on the team (when
  //      created_by_uuid is null/missing).
  //
  // Owner-only actions (remove member, remove coach) are RLS-
  // gated server-side too. This client check just hides the UI
  // affordances for non-owners so they don't hit a 403.
  //
  // Returns { isOwner: bool, error }. Errors degrade to false
  // (fail-safe — better to hide the option than expose a write
  // that will fail).
  async function checkIsTeamOwner(teamUuid, authUserId, coachUuid) {
    if (!teamUuid || !authUserId) return { isOwner: false, error: null };
    const client = sb();
    try {
      // Primary check
      const { data: teamInfo, error: teamErr } = await client
        .from('teams')
        .select('created_by_uuid')
        .eq('team_uuid', teamUuid)
        .maybeSingle();
      if (!teamErr && teamInfo && teamInfo.created_by_uuid === authUserId) {
        return { isOwner: true, error: null };
      }
      // Fallback: earliest active coach
      if (!teamInfo?.created_by_uuid && coachUuid) {
        const { data: earliest } = await client
          .from('coaches')
          .select('coach_uuid')
          .eq('team_uuid', teamUuid)
          .eq('membership_status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (earliest && earliest.coach_uuid === coachUuid) {
          return { isOwner: true, error: null };
        }
      }
      return { isOwner: false, error: null };
    } catch (e) {
      return { isOwner: false, error: e };
    }
  }

  // ── Update athlete gender (coach action) ────────────────
  // Mirrors live's updateAthleteGender (index.html:11151). UPDATE
  // athletes.gender for a single athlete the coach has rights
  // over. RLS authorizes coach-of-team to write this column. Pass
  // gender as 'male' | 'female' | null (null clears the value).
  async function updateAthleteGender(athleteUuid, gender) {
    if (!athleteUuid) {
      return { ok: false, error: { message: 'Missing athlete uuid.' } };
    }
    const value = (gender === 'male' || gender === 'female') ? gender : null;
    const { error } = await sb()
      .from('athletes')
      .update({ gender: value })
      .eq('athlete_uuid', athleteUuid);
    return { ok: !error, error: error || null };
  }

  // ── Expose ──────────────────────────────────────────────
  window.PA_TEAMS = {
    lookupTeamByCode,
    createTeam,
    joinTeamAsCoach,
    joinTeamAsAthlete,
    generateTeamCode,
    // v01.30 — pending member approval (Batch 7a)
    listPendingMembers,
    countPendingMembers,
    approveMember,
    rejectMember,
    // v01.33 — team management (Batch 7b)
    listTeamCoaches,
    countActiveCoaches,
    removeMember,
    leaveTeamSelf,
    updateAthleteGender,
    // v01.35 — owner gate
    checkIsTeamOwner,
  };

  try { console.log('[PA_TEAMS] loaded (v01.36)'); } catch (_) {}
})();
