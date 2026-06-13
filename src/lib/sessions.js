/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03
   Video Sessions read layer — v03.24

   Queries the two new tables added in Phase 1 of the Video
   Sessions feature:
     - video_sessions  (one row per swim session)
     - session_clips   (one row per video clip)

   RLS-scoped at the DB: athletes see their own; admin override
   + coach + squad policies land in later phases. This module
   just reads — never writes (Phase 1 is read-only UI).

   Exposed on window.PA_SESSIONS.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const client = window.supabaseClient;

  // ── listSessions ─────────────────────────────────────────────
  // All sessions visible to the current user, newest first.
  // RLS enforces athlete-self-view; admin override (when added)
  // will widen automatically. No client-side filtering.
  async function listSessions(opts) {
    const limit = (opts && opts.limit) || 100;
    // v03.53 — optional athlete filter so the Sessions tab scopes
    // to a super_admin/coach impersonation target, matching the
    // single-athlete behavior of Starts / Turns / Races.
    const athleteUuid = opts && opts.athleteUuid;
    try {
      const exec = () => {
        let q = client
          .from('video_sessions')
          .select('session_uuid, athlete_uuid, team_uuid, source, ' +
                  'session_date, title, notes, coach_shared_to_squad, ' +
                  'athlete_shared_to_pool, created_at, notified_at');
        if (athleteUuid) q = q.eq('athlete_uuid', athleteUuid);
        return q
          .order('session_date', { ascending: false })
          .order('created_at',   { ascending: false })
          .limit(limit);
      };
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'video_sessions listSessions' })
        : await exec();
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── listClipsForSession ──────────────────────────────────────
  // All clips in one session, ordered by order_idx then created_at.
  async function listClipsForSession(sessionUuid) {
    if (!sessionUuid) return { data: [], error: null };
    try {
      const exec = () => client
        .from('session_clips')
        .select('clip_uuid, session_uuid, athlete_uuid, team_uuid, ' +
                'r2_key, duration_s, order_idx, title, ' +
                'trial_uuid, trial_kind, ' +
                'athlete_shared_to_pool, coach_shared_to_squad, ' +
                'created_at')
        .eq('session_uuid', sessionUuid)
        .order('order_idx',  { ascending: true })
        .order('created_at', { ascending: true });
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'session_clips listClipsForSession' })
        : await exec();
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── Notes CRUD (Phase 2) ─────────────────────────────────────
  // Time-stamped coach/athlete notes on a clip. RLS enforces
  // "author = auth.uid()" on insert/update/delete; SELECT visible
  // to anyone who can see the parent clip.
  async function listNotesForClip(clipUuid) {
    if (!clipUuid) return { data: [], error: null };
    try {
      const exec = () => client
        .from('clip_notes')
        .select('note_uuid, clip_uuid, author_uuid, author_role, ' +
                't_sec, text, created_at, updated_at')
        .eq('clip_uuid', clipUuid)
        .order('t_sec',      { ascending: true,  nullsFirst: true })
        .order('created_at', { ascending: true });
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'clip_notes listNotesForClip' })
        : await exec();
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function addClipNote({ clipUuid, tSec, text, authorRole }) {
    if (!clipUuid || !text || !text.trim()) {
      return { data: null, error: { message: 'Missing clip or text.' } };
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      const authorUuid = session && session.user && session.user.id;
      if (!authorUuid) {
        return { data: null, error: { message: 'Not signed in.' } };
      }
      const row = {
        clip_uuid:   clipUuid,
        author_uuid: authorUuid,
        author_role: authorRole || 'athlete',
        t_sec:       (tSec == null || isNaN(tSec)) ? null : Number(tSec),
        text:        text.trim(),
      };
      const { data, error } = await client
        .from('clip_notes')
        .insert(row)
        .select('note_uuid, clip_uuid, author_uuid, author_role, ' +
                't_sec, text, created_at, updated_at')
        .single();
      return { data, error };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function deleteClipNote(noteUuid) {
    if (!noteUuid) return { ok: false, error: { message: 'Missing noteUuid.' } };
    try {
      const { error } = await client
        .from('clip_notes')
        .delete()
        .eq('note_uuid', noteUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // ── Annotations CRUD (Phase 4) ───────────────────────────────
  // Freeze-frame drawings on a clip. RLS mirrors clip_notes:
  // SELECT if you can see the clip, write only your own rows.
  // `strokes` is JSONB: array of stroke objects, each with
  // `tool`, `color`, `width`, and a `points` array. Coordinates
  // in points are normalized to [0..1] of the video box, so the
  // same drawing renders correctly at any screen size.
  async function listAnnotationsForClip(clipUuid) {
    if (!clipUuid) return { data: [], error: null };
    try {
      const exec = () => client
        .from('clip_annotations')
        .select('annotation_uuid, clip_uuid, author_uuid, author_role, ' +
                't_sec, strokes, label, created_at, updated_at')
        .eq('clip_uuid', clipUuid)
        .order('t_sec',      { ascending: true })
        .order('created_at', { ascending: true });
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'clip_annotations listAnnotationsForClip' })
        : await exec();
      if (error) {
        // Table-not-yet-deployed is the only "expected" failure here.
        // Return empty so the UI degrades gracefully until Eric runs
        // the v03.32 SQL.
        try { console.warn('[PA_SESSIONS] annotations select error', error.message || error); } catch (_) {}
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function addClipAnnotation({ clipUuid, tSec, strokes, label, authorRole }) {
    if (!clipUuid || !Array.isArray(strokes) || !strokes.length) {
      return { data: null, error: { message: 'Missing clip or strokes.' } };
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      const authorUuid = session && session.user && session.user.id;
      if (!authorUuid) {
        return { data: null, error: { message: 'Not signed in.' } };
      }
      const row = {
        clip_uuid:   clipUuid,
        author_uuid: authorUuid,
        author_role: authorRole || 'athlete',
        t_sec:       (tSec == null || isNaN(tSec)) ? 0 : Number(tSec),
        strokes:     strokes,
        label:       (label && label.trim()) || null,
      };
      const { data, error } = await client
        .from('clip_annotations')
        .insert(row)
        .select('annotation_uuid, clip_uuid, author_uuid, author_role, ' +
                't_sec, strokes, label, created_at, updated_at')
        .single();
      return { data, error };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function deleteClipAnnotation(annotationUuid) {
    if (!annotationUuid) return { ok: false, error: { message: 'Missing annotationUuid.' } };
    try {
      const { error } = await client
        .from('clip_annotations')
        .delete()
        .eq('annotation_uuid', annotationUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // Resolve "var(--xxx)" strings to their computed oklch / hex
  // value. Canvas 2D has no DOM context, so passing it the raw
  // CSS-variable name silently falls back to black — we hit
  // this in v03.32 (all annotation strokes painted black). The
  // cache avoids a getComputedStyle() call per stroke per
  // frame; it's keyed on the variable name + current theme so
  // a light/dark toggle picks up the new value next frame.
  const __cssVarCache = Object.create(null);
  function resolveCssColor(input) {
    if (!input || typeof input !== 'string') return '#7ee5b5';
    const m = input.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!m) return input; // already a literal color (oklch, hex, etc.)
    // The dashboard puts data-scope on <body>, not <html>, so
    // we have to read computed styles from body. v03.33 read
    // documentElement, which returned the browser default for
    // unknown custom properties — that's where the "all blue"
    // bug came from. Cache key includes the scope attribute so
    // a light/dark toggle invalidates correctly.
    const scope = (document.body && document.body.getAttribute('data-scope'))
      || document.documentElement.getAttribute('data-scope') || '';
    const key = m[1] + '::' + scope;
    if (__cssVarCache[key]) return __cssVarCache[key];
    try {
      const root = document.body || document.documentElement;
      const v = getComputedStyle(root).getPropertyValue(m[1]).trim();
      const resolved = v || '#7ee5b5';
      __cssVarCache[key] = resolved;
      return resolved;
    } catch (_) {
      return '#7ee5b5';
    }
  }

  // Render one stroke onto a 2D canvas context. `w` and `h` are
  // the canvas pixel dimensions; the stroke's normalized [0..1]
  // points get multiplied by them. Used for both live drawing
  // (during annotate mode) and read-only display (during
  // playback). Centralized here so the JSX never has to know
  // how a particular tool draws.
  function renderStroke(ctx, stroke, w, h) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 1) return;
    const pts = stroke.points;
    const color = resolveCssColor(stroke.color);
    const width = Math.max(1, Number(stroke.width) || 3);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = width;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (stroke.tool === 'pen') {
      // Freehand path through every point.
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.stroke();
    } else if (pts.length >= 2) {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      const x1 = p1.x * w, y1 = p1.y * h;
      const x2 = p2.x * w, y2 = p2.y * h;
      if (stroke.tool === 'line' || stroke.tool === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (stroke.tool === 'arrow') {
          // Arrowhead at p2, sized off lineWidth.
          const head = Math.max(8, width * 3);
          const ang = Math.atan2(y2 - y1, x2 - x1);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7),
                     y2 - head * Math.sin(ang - Math.PI / 7));
          ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7),
                     y2 - head * Math.sin(ang + Math.PI / 7));
          ctx.closePath();
          ctx.fill();
        }
      } else if (stroke.tool === 'rectangle') {
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2),
                       Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (stroke.tool === 'circle') {
        // Ellipse fitted to bounding box of p1..p2.
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Tags & assignments CRUD (Phase 5) ────────────────────────
  // Per-user tag library. `clip_tags` rows are owned by the
  // creator; assignments are written by the tagger. RLS lets
  // athletes see (read-only) tags coaches applied to their
  // clips so collaboration works, but only owners can mutate.
  //
  // The lib exposes:
  //   listMyTags()                       → tags I own
  //   listTagsForClip(clipUuid)          → tags currently on this clip
  //   listVisibleTagsAcrossClips()       → tags appearing on any
  //                                        visible clip — used by
  //                                        the Library filter chip
  //                                        strip
  //   createTag({ name, color })         → insert + return new row
  //   applyTagToClip(clipUuid, tagUuid)  → assignment insert
  //   removeTagFromClip(clipUuid, tagUuid) → assignment delete
  //   deleteTag(tagUuid)                 → tag delete (cascade
  //                                        removes assignments)

  async function listMyTags() {
    try {
      const { data: { session } } = await client.auth.getSession();
      const me = session && session.user && session.user.id;
      if (!me) return { data: [], error: null };
      const exec = () => client
        .from('clip_tags')
        .select('tag_uuid, owner_uuid, name, color, created_at')
        .eq('owner_uuid', me)
        .order('name', { ascending: true });
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'clip_tags listMyTags' })
        : await exec();
      if (error) {
        try { console.warn('[PA_SESSIONS] tags select error', error.message || error); } catch (_) {}
        return { data: [], error };
      }
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function listTagsForClip(clipUuid) {
    if (!clipUuid) return { data: [], error: null };
    try {
      // Two-step: fetch assignments, then fetch the tag rows.
      // Keeps the round-trip simple and avoids relying on PostgREST
      // resource embedding (which would need an FK relationship
      // alias to expose two FK paths cleanly).
      const exec1 = () => client
        .from('clip_tag_assignments')
        .select('assignment_uuid, clip_uuid, tag_uuid, tagged_by, created_at')
        .eq('clip_uuid', clipUuid);
      const recover = window.PA_AUTH?.withRecovery;
      const a = recover
        ? await recover(exec1, { label: 'clip_tag_assignments listTagsForClip' })
        : await exec1();
      if (a.error) return { data: [], error: a.error };
      const assignments = a.data || [];
      if (!assignments.length) return { data: [], error: null };
      const tagIds = assignments.map(x => x.tag_uuid);
      const { data: tagRows, error: tagErr } = await client
        .from('clip_tags')
        .select('tag_uuid, owner_uuid, name, color')
        .in('tag_uuid', tagIds);
      if (tagErr) return { data: [], error: tagErr };
      // Stitch: return assignment rows decorated with tag fields
      // (and the assignment_uuid + tagged_by so the UI can decide
      // whether to render a delete button).
      const byTag = Object.create(null);
      (tagRows || []).forEach(t => { byTag[t.tag_uuid] = t; });
      const merged = assignments.map(asg => {
        const t = byTag[asg.tag_uuid] || {};
        return {
          assignment_uuid: asg.assignment_uuid,
          clip_uuid:       asg.clip_uuid,
          tag_uuid:        asg.tag_uuid,
          tagged_by:       asg.tagged_by,
          name:            t.name  || '(unknown tag)',
          color:           t.color || null,
          tag_owner_uuid:  t.owner_uuid || null,
        };
      });
      return { data: merged, error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Build a deduplicated list of every tag that's been applied
  // to any clip the current user can see. Used by the Library
  // filter chip strip. Returns rows shaped like clip_tags rows.
  async function listVisibleTagsAcrossClips() {
    try {
      const exec1 = () => client
        .from('clip_tag_assignments')
        .select('tag_uuid');
      const recover = window.PA_AUTH?.withRecovery;
      const a = recover
        ? await recover(exec1, { label: 'clip_tag_assignments listVisibleTagsAcrossClips' })
        : await exec1();
      if (a.error) return { data: [], error: a.error };
      const ids = Array.from(new Set((a.data || []).map(r => r.tag_uuid)));
      if (!ids.length) return { data: [], error: null };
      const { data, error } = await client
        .from('clip_tags')
        .select('tag_uuid, owner_uuid, name, color')
        .in('tag_uuid', ids)
        .order('name', { ascending: true });
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function createTag({ name, color }) {
    const trimmed = (name || '').trim();
    if (!trimmed) return { data: null, error: { message: 'Name required.' } };
    try {
      const { data: { session } } = await client.auth.getSession();
      const me = session && session.user && session.user.id;
      if (!me) return { data: null, error: { message: 'Not signed in.' } };
      const { data, error } = await client
        .from('clip_tags')
        .insert({ owner_uuid: me, name: trimmed, color: color || null })
        .select('tag_uuid, owner_uuid, name, color, created_at')
        .single();
      return { data, error };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function applyTagToClip(clipUuid, tagUuid) {
    if (!clipUuid || !tagUuid) {
      return { data: null, error: { message: 'Missing clip or tag.' } };
    }
    try {
      const { data: { session } } = await client.auth.getSession();
      const me = session && session.user && session.user.id;
      if (!me) return { data: null, error: { message: 'Not signed in.' } };
      const { data, error } = await client
        .from('clip_tag_assignments')
        .insert({ clip_uuid: clipUuid, tag_uuid: tagUuid, tagged_by: me })
        .select('assignment_uuid, clip_uuid, tag_uuid, tagged_by, created_at')
        .single();
      // Duplicate-assignment is a unique-constraint hit and should
      // not be treated as a hard error — the UI should just refresh.
      if (error && /duplicate key/i.test(error.message || '')) {
        return { data: null, error: null };
      }
      return { data, error };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function removeTagFromClip(clipUuid, tagUuid) {
    if (!clipUuid || !tagUuid) return { ok: false, error: { message: 'Missing clip or tag.' } };
    try {
      const { error } = await client
        .from('clip_tag_assignments')
        .delete()
        .eq('clip_uuid', clipUuid)
        .eq('tag_uuid',  tagUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async function deleteTag(tagUuid) {
    if (!tagUuid) return { ok: false, error: { message: 'Missing tagUuid.' } };
    try {
      const { error } = await client
        .from('clip_tags')
        .delete()
        .eq('tag_uuid', tagUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // Library — list every clip the user can see, joined to its
  // session row for display. Optionally filter by a set of
  // tag_uuids (ANY-match: a clip is included if it has at
  // least one of the listed tags).
  async function listAllClipsForLibrary({ tagUuids } = {}) {
    try {
      let clipIdsFilter = null;
      if (Array.isArray(tagUuids) && tagUuids.length) {
        const { data: aRows, error: aErr } = await client
          .from('clip_tag_assignments')
          .select('clip_uuid, tag_uuid')
          .in('tag_uuid', tagUuids);
        if (aErr) return { data: [], error: aErr };
        clipIdsFilter = Array.from(new Set((aRows || []).map(r => r.clip_uuid)));
        if (!clipIdsFilter.length) return { data: [], error: null };
      }
      let q = client
        .from('session_clips')
        .select('clip_uuid, session_uuid, athlete_uuid, team_uuid, ' +
                'r2_key, duration_s, order_idx, title, ' +
                'trial_uuid, trial_kind, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (clipIdsFilter) q = q.in('clip_uuid', clipIdsFilter);
      const { data: clips, error: clipErr } = await q;
      if (clipErr) return { data: [], error: clipErr };
      const sessionIds = Array.from(new Set((clips || []).map(c => c.session_uuid).filter(Boolean)));
      if (!sessionIds.length) return { data: clips || [], error: null };
      const { data: sessions } = await client
        .from('video_sessions')
        .select('session_uuid, title, session_date, source, coach_shared_to_squad, team_uuid')
        .in('session_uuid', sessionIds);
      const bySession = Object.create(null);
      (sessions || []).forEach(s => { bySession[s.session_uuid] = s; });
      const decorated = (clips || []).map(c => ({
        ...c,
        _session: bySession[c.session_uuid] || null,
      }));
      return { data: decorated, error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── Team library (Phase 6, evolved v03.49) ───────────────────
  // v03.49 moved the share toggle from per-clip → per-session.
  // setSessionCoachSharedToSquad is the new entry point; the old
  // setCoachSharedToSquad (per-clip) is kept as a no-op-safe
  // shim so any caller still passing it doesn't crash, but the
  // UI no longer wires it.
  async function setSessionCoachSharedToSquad(sessionUuid, value) {
    if (!sessionUuid) return { ok: false, error: { message: 'Missing sessionUuid.' } };
    try {
      const { error } = await client
        .from('video_sessions')
        .update({ coach_shared_to_squad: !!value })
        .eq('session_uuid', sessionUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }
  // Deprecated — keep for back-compat with any cached UI; UI no
  // longer calls this from v03.49 forward.
  async function setCoachSharedToSquad(clipUuid, value) {
    if (!clipUuid) return { ok: false, error: { message: 'Missing clipUuid.' } };
    try {
      const { error } = await client
        .from('session_clips')
        .update({ coach_shared_to_squad: !!value })
        .eq('clip_uuid', clipUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // Returns { isAthlete, isCoach, teamUuids } for the signed-in
  // user. Drives "show Share pill?" and "show ⇄ team chip?"
  // decisions in the workspace + Library. Cached for the
  // lifetime of the session module — re-mount the workspace
  // (or refresh) if your team membership just changed.
  let __teamMembershipCache = null;
  async function getMyTeamMembership() {
    if (__teamMembershipCache) return __teamMembershipCache;
    const out = { isAthlete: false, isCoach: false, athleteUuid: null, teamUuids: [] };
    try {
      const { data: { session } } = await client.auth.getSession();
      const me = session && session.user && session.user.id;
      if (!me) return out;
      const [aRes, cRes] = await Promise.all([
        client.from('athletes')
          .select('athlete_uuid, team_uuid, membership_status')
          .eq('auth_user_id', me)
          .eq('membership_status', 'active'),
        client.from('coaches')
          .select('team_uuid, membership_status')
          .eq('auth_user_id', me)
          .eq('membership_status', 'active'),
      ]);
      const aRows = aRes.data || [];
      const cRows = cRes.data || [];
      if (aRows.length) {
        out.isAthlete   = true;
        out.athleteUuid = aRows[0].athlete_uuid;
      }
      if (cRows.length) {
        out.isCoach = true;
      }
      const teamIds = new Set();
      aRows.forEach(r => r.team_uuid && teamIds.add(r.team_uuid));
      cRows.forEach(r => r.team_uuid && teamIds.add(r.team_uuid));
      out.teamUuids = Array.from(teamIds);
      __teamMembershipCache = out;
      return out;
    } catch (_) {
      return out;
    }
  }

  // ── Library at session granularity (v03.51) ─────────────────
  // Same shape + same filters as listAllClipsForLibraryV2 but
  // returns SESSION rows (decorated with clip count + athlete
  // name + source role + team-share flag). Drives the Library
  // view's session grid — easier to scan when a coach has 50+
  // athletes worth of clips visible via RLS.
  async function listAllSessionsForLibrary({ tagUuids, source, viewerAthleteUuid } = {}) {
    try {
      const me = await getMyTeamMembership();
      const effectiveAthleteUuid = viewerAthleteUuid || me.athleteUuid;

      // v03.54 — when impersonating an athlete (super_admin
      // "View As" or coach roster pick), scope visibility to
      // what that athlete would see if logged in. RLS bypasses
      // for super_admin so without this filter the Library
      // would leak cross-team sessions during impersonation.
      // Rule: (own session) OR (same team + coach_shared_to_squad).
      let impersonatedTeamUuid = null;
      if (viewerAthleteUuid) {
        try {
          const { data: athRow } = await client
            .from('athletes')
            .select('team_uuid')
            .eq('athlete_uuid', viewerAthleteUuid)
            .limit(1);
          impersonatedTeamUuid = (athRow && athRow[0] && athRow[0].team_uuid) || null;
        } catch (_) {}
      }

      // Step 1: fetch all sessions visible via RLS. We don't pre-
      // filter by source in the query because 'own' is computed
      // client-side off athlete_uuid; team is a column predicate
      // we CAN push down.
      let q = client
        .from('video_sessions')
        .select('session_uuid, athlete_uuid, team_uuid, source, ' +
                'session_date, title, notes, coach_shared_to_squad, ' +
                'athlete_shared_to_pool, created_at')
        .order('session_date', { ascending: false })
        .order('created_at',   { ascending: false })
        .limit(500);
      if (source === 'team') {
        q = q.eq('coach_shared_to_squad', true);
      }
      const { data: sessions, error } = await q;
      if (error) return { data: [], error };
      if (!sessions || !sessions.length) return { data: [], error: null };

      // Step 2: if filtering by tag, intersect with sessions that
      // contain at least one clip carrying one of those tags.
      let sessionFilter = null;
      if (Array.isArray(tagUuids) && tagUuids.length) {
        const { data: aRows } = await client
          .from('clip_tag_assignments')
          .select('clip_uuid')
          .in('tag_uuid', tagUuids);
        const clipIds = Array.from(new Set((aRows || []).map(a => a.clip_uuid)));
        if (!clipIds.length) return { data: [], error: null };
        const { data: scRows } = await client
          .from('session_clips')
          .select('session_uuid')
          .in('clip_uuid', clipIds);
        sessionFilter = new Set((scRows || []).map(r => r.session_uuid));
      }

      // Step 3: clip counts per session (single round-trip).
      const sessionIds = sessions.map(s => s.session_uuid);
      const { data: clipRows } = await client
        .from('session_clips')
        .select('session_uuid')
        .in('session_uuid', sessionIds);
      const countBySession = Object.create(null);
      (clipRows || []).forEach(c => {
        countBySession[c.session_uuid] = (countBySession[c.session_uuid] || 0) + 1;
      });

      // Step 4: athlete names (best-effort — RLS may restrict).
      const athleteIds = Array.from(new Set(
        sessions.map(s => s.athlete_uuid).filter(Boolean)
      ));
      let byAthlete = Object.create(null);
      if (athleteIds.length) {
        const { data: ath } = await client
          .from('athletes')
          .select('athlete_uuid, first_name, last_name')
          .in('athlete_uuid', athleteIds);
        (ath || []).forEach(a => { byAthlete[a.athlete_uuid] = a; });
      }

      let decorated = sessions.map(s => {
        const isOwn = effectiveAthleteUuid && s.athlete_uuid === effectiveAthleteUuid;
        const a = byAthlete[s.athlete_uuid] || null;
        const fullName = a
          ? [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
          : '';
        return {
          ...s,
          _athlete_name: fullName || (isOwn ? 'You' : 'Athlete'),
          _clip_count:   countBySession[s.session_uuid] || 0,
          _source_role:  isOwn ? 'own' : 'team',
        };
      });

      if (sessionFilter)        decorated = decorated.filter(s => sessionFilter.has(s.session_uuid));
      if (source === 'own')     decorated = decorated.filter(s => s._source_role === 'own');
      // Hide empty sessions from the Library view — they're just
      // noise if there's nothing to drill into.
      decorated = decorated.filter(s => s._clip_count > 0);

      // v03.54 — impersonation visibility scope (see above).
      if (viewerAthleteUuid) {
        decorated = decorated.filter(s =>
          s.athlete_uuid === viewerAthleteUuid
          || (impersonatedTeamUuid && s.team_uuid === impersonatedTeamUuid && s.coach_shared_to_squad)
        );
      }

      return { data: decorated, error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Library — extended for Phase 6. Augments each clip with:
  //   _source_role: 'own' | 'team'
  //   _athlete_name: best-effort name string for non-own clips
  // and supports an optional source filter ('own' | 'team').
  //
  // v03.48 — accepts an explicit `viewerAthleteUuid` so super-admin
  // "Viewing as <athlete>" impersonation classifies clips correctly
  // (without it, every clip showed as TEAM because the auth.uid()
  // has no athlete row of its own).
  async function listAllClipsForLibraryV2({ tagUuids, source, viewerAthleteUuid } = {}) {
    try {
      const me = await getMyTeamMembership();
      // Impersonation override: when a super_admin is "Viewing as
      // Juan," classify clips from Juan's perspective.
      const effectiveAthleteUuid = viewerAthleteUuid || me.athleteUuid;
      let clipIdsFilter = null;
      if (Array.isArray(tagUuids) && tagUuids.length) {
        const { data: aRows, error: aErr } = await client
          .from('clip_tag_assignments')
          .select('clip_uuid, tag_uuid')
          .in('tag_uuid', tagUuids);
        if (aErr) return { data: [], error: aErr };
        clipIdsFilter = Array.from(new Set((aRows || []).map(r => r.clip_uuid)));
        if (!clipIdsFilter.length) return { data: [], error: null };
      }
      let q = client
        .from('session_clips')
        .select('clip_uuid, session_uuid, athlete_uuid, team_uuid, ' +
                'r2_key, duration_s, order_idx, title, ' +
                'trial_uuid, trial_kind, ' +
                'athlete_shared_to_pool, coach_shared_to_squad, ' +
                'created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (clipIdsFilter) q = q.in('clip_uuid', clipIdsFilter);
      const { data: clips, error: clipErr } = await q;
      if (clipErr) return { data: [], error: clipErr };

      // Pull parent sessions for date/title.
      const sessionIds = Array.from(new Set((clips || []).map(c => c.session_uuid).filter(Boolean)));
      let bySession = {};
      if (sessionIds.length) {
        const { data: sessions } = await client
          .from('video_sessions')
          .select('session_uuid, title, session_date, source, coach_shared_to_squad, team_uuid')
          .in('session_uuid', sessionIds);
        (sessions || []).forEach(s => { bySession[s.session_uuid] = s; });
      }

      // Pull athlete names (best-effort — RLS may restrict for
      // some viewers; missing names fall through to "Teammate").
      const athleteIds = Array.from(new Set(
        (clips || []).map(c => c.athlete_uuid).filter(Boolean)
      ));
      let byAthlete = {};
      if (athleteIds.length) {
        const { data: ath } = await client
          .from('athletes')
          .select('athlete_uuid, first_name, last_name')
          .in('athlete_uuid', athleteIds);
        (ath || []).forEach(a => { byAthlete[a.athlete_uuid] = a; });
      }

      const decorated = (clips || []).map(c => {
        const isOwn = effectiveAthleteUuid && c.athlete_uuid === effectiveAthleteUuid;
        const a = byAthlete[c.athlete_uuid] || null;
        const fullName = a
          ? [a.first_name, a.last_name].filter(Boolean).join(' ').trim()
          : '';
        return {
          ...c,
          _session: bySession[c.session_uuid] || null,
          _source_role: isOwn ? 'own' : 'team',
          _athlete_name: fullName || (isOwn ? 'You' : 'Teammate'),
        };
      });

      // Apply source filter client-side (RLS already does the
      // hard work; this is just for the "Mine / Team" toggle
      // chip in the Library).
      //   'own'  → clips the viewer owns (their own athlete)
      //   'team' → clips from sessions a coach shared with the
      //            team (post-v03.49, share lives at the session
      //            level, so filter on _session.coach_shared_to_squad).
      const filtered = source === 'own'
        ? decorated.filter(c => c._source_role === 'own')
        : source === 'team'
          ? decorated.filter(c => c._session && c._session.coach_shared_to_squad)
          : decorated;

      return { data: filtered, error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // ── Save to Library (Phase 7, v03.44) ────────────────────────
  // Promote a race/start/turn trial video into a session_clips
  // row so it gets the full Sessions tab toolkit (notes,
  // annotations, tags, team share). Idempotent via the
  // session_clips_trial_uniq unique index — second click
  // returns the existing clip instead of duplicating.
  //
  // We group every promoted clip for an athlete under a single
  // "Promoted trials" video_sessions row (one per athlete,
  // created lazily on first promotion). Keeps Sessions tab clean.

  async function findClipForTrial(trialKind, trialUuid) {
    if (!trialKind || !trialUuid) return { data: null, error: null };
    try {
      const exec = () => client
        .from('session_clips')
        .select('clip_uuid, session_uuid')
        .eq('trial_kind', trialKind)
        .eq('trial_uuid', trialUuid)
        .limit(1);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'session_clips findClipForTrial' })
        : await exec();
      if (error) return { data: null, error };
      const row = (data && data[0]) || null;
      return { data: row, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  // Single-clip fetch used by the cross-tab jump (Sessions tab
  // pre-opens this clip when the user clicks "In Library ↗"
  // from an analysis tab).
  async function getClipForLibrary(clipUuid) {
    if (!clipUuid) return { data: null, error: null };
    try {
      const { data: clip, error: clipErr } = await client
        .from('session_clips')
        .select('clip_uuid, session_uuid, athlete_uuid, team_uuid, ' +
                'r2_key, duration_s, order_idx, title, ' +
                'trial_uuid, trial_kind, ' +
                'athlete_shared_to_pool, coach_shared_to_squad, ' +
                'created_at')
        .eq('clip_uuid', clipUuid)
        .limit(1);
      if (clipErr) return { data: null, error: clipErr };
      const row = (clip && clip[0]) || null;
      if (!row) return { data: null, error: null };
      // Pull parent session so SessionDetail has a header to render.
      const { data: sess } = await client
        .from('video_sessions')
        .select('session_uuid, title, session_date, source, athlete_uuid, team_uuid, notes, coach_shared_to_squad, athlete_shared_to_pool')
        .eq('session_uuid', row.session_uuid)
        .limit(1);
      return {
        data: { ...row, _session: (sess && sess[0]) || null },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function promoteTrialToClip({
    trialKind, trialUuid,
    athleteUuid, teamUuid,
    trialVideoKey, trialDate, title,
    sessionUuid, // v03.46 — explicit target session (now required)
  }) {
    if (!trialKind || !trialUuid) {
      return { error: { message: 'Missing trialKind or trialUuid.' } };
    }
    if (!athleteUuid) {
      return { error: { message: 'Missing athleteUuid.' } };
    }
    if (!trialVideoKey) {
      return { error: { message: 'Trial has no video.' } };
    }
    if (!sessionUuid) {
      return { error: { message: 'Pick a session to add this trial to.' } };
    }

    // 1. Idempotency — if a clip already exists for this trial,
    //    return its uuid as "alreadyExisted". (We don't move
    //    existing promoted clips between sessions on re-click —
    //    that would surprise users.)
    const existing = await findClipForTrial(trialKind, trialUuid);
    if (existing.data) {
      return {
        clipUuid:       existing.data.clip_uuid,
        sessionUuid:    existing.data.session_uuid,
        alreadyExisted: true,
        error:          null,
      };
    }

    try {
      // 2. Validate the target session belongs to the same athlete.
      //    (RLS would also catch a bad write, but better UX to
      //    surface the mismatch upfront.)
      const { data: sessRow } = await client
        .from('video_sessions')
        .select('session_uuid, athlete_uuid')
        .eq('session_uuid', sessionUuid)
        .limit(1);
      if (!sessRow || !sessRow[0]) {
        return { error: { message: 'Target session not found.' } };
      }
      if (sessRow[0].athlete_uuid !== athleteUuid) {
        return { error: { message: 'Session belongs to a different athlete.' } };
      }

      // 3. Next order_idx within that session.
      const { data: maxRow } = await client
        .from('session_clips')
        .select('order_idx')
        .eq('session_uuid', sessionUuid)
        .order('order_idx', { ascending: false })
        .limit(1);
      const nextIdx = ((maxRow && maxRow[0] && maxRow[0].order_idx) || 0) + 1;

      // 4. Insert the new clip pointing at the trial's video.
      const { data: newClip, error: clipErr } = await client
        .from('session_clips')
        .insert({
          session_uuid: sessionUuid,
          athlete_uuid: athleteUuid,
          team_uuid:    teamUuid || null,
          r2_key:       trialVideoKey,
          duration_s:   null,
          order_idx:    nextIdx,
          title:        title || ('Promoted ' + trialKind),
          trial_uuid:   trialUuid,
          trial_kind:   trialKind,
        })
        .select('clip_uuid')
        .single();
      if (clipErr || !newClip) {
        // Race condition: another tab promoted concurrently.
        // Re-fetch and return the existing row instead of erroring.
        const retry = await findClipForTrial(trialKind, trialUuid);
        if (retry.data) {
          return {
            clipUuid:       retry.data.clip_uuid,
            sessionUuid:    retry.data.session_uuid,
            alreadyExisted: true,
            error:          null,
          };
        }
        return { error: clipErr || { message: 'Could not create clip.' } };
      }

      return {
        clipUuid:       newClip.clip_uuid,
        sessionUuid,
        alreadyExisted: false,
        error:          null,
      };
    } catch (e) {
      return { error: e };
    }
  }

  // ── v03.46 — curated sessions ────────────────────────────────
  // Trials now get added to a specific user-named session via a
  // picker instead of dumped into an auto-"Promoted trials" bucket.
  // These helpers back the picker + create form.

  async function listSessionsForAthlete(athleteUuid) {
    if (!athleteUuid) return { data: [], error: null };
    try {
      const exec = () => client
        .from('video_sessions')
        .select('session_uuid, athlete_uuid, team_uuid, source, ' +
                'session_date, title, notes, coach_shared_to_squad, ' +
                'athlete_shared_to_pool, created_at')
        .eq('athlete_uuid', athleteUuid)
        .order('session_date', { ascending: false })
        .order('created_at',   { ascending: false })
        .limit(100);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'video_sessions listSessionsForAthlete' })
        : await exec();
      if (error) return { data: [], error };
      return { data: data || [], error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function createSession({ athleteUuid, teamUuid, title, sessionDate, notes }) {
    if (!athleteUuid) return { data: null, error: { message: 'Missing athleteUuid.' } };
    const trimmed = (title || '').trim();
    if (!trimmed) return { data: null, error: { message: 'Title is required.' } };
    try {
      const row = {
        athlete_uuid: athleteUuid,
        team_uuid:    teamUuid || null,
        session_date: sessionDate || new Date().toISOString().slice(0, 10),
        source:       'peak_athlete',
        title:        trimmed,
        notes:        (notes && notes.trim()) || null,
      };
      const { data, error } = await client
        .from('video_sessions')
        .insert(row)
        .select('session_uuid, athlete_uuid, team_uuid, source, session_date, title, notes, coach_shared_to_squad, athlete_shared_to_pool, created_at')
        .single();
      return { data, error };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  async function deleteClip(clipUuid) {
    if (!clipUuid) return { ok: false, error: { message: 'Missing clipUuid.' } };
    try {
      // Cascade on clip_notes / clip_annotations / clip_tag_assignments
      // handles children automatically.
      const { error } = await client
        .from('session_clips')
        .delete()
        .eq('clip_uuid', clipUuid);
      return { ok: !error, error };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // ── Delete session (v03.45) ──────────────────────────────────
  // Removes a video_sessions row + all its clips. Order matters:
  // delete clips first because session_clips.session_uuid →
  // video_sessions(session_uuid) does NOT have ON DELETE CASCADE
  // (Phase 1 schema). Cascading FKs on clip_notes /
  // clip_annotations / clip_tag_assignments handle the
  // grandchildren automatically as each clip dies.
  //
  // RLS gates BOTH delete operations per the v03.45 policies:
  // athletes can drop their own, coaches can drop their team's,
  // super_admin can drop anything.
  async function deleteSession(sessionUuid) {
    if (!sessionUuid) return { ok: false, error: { message: 'Missing sessionUuid.' } };
    try {
      const { error: clipsErr } = await client
        .from('session_clips')
        .delete()
        .eq('session_uuid', sessionUuid);
      if (clipsErr) return { ok: false, error: clipsErr };
      const { error: sessErr } = await client
        .from('video_sessions')
        .delete()
        .eq('session_uuid', sessionUuid);
      if (sessErr) return { ok: false, error: sessErr };
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  // Format a t_sec value as "0:08" / "1:23.4".
  function fmtTimestamp(sec) {
    if (sec == null || isNaN(sec)) return '—';
    const s = Math.max(0, Number(sec));
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    if (m === 0) return r.toFixed(1) + ' s';
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }

  // ── Display helpers ──────────────────────────────────────────
  // Format a session row's title for the list. Falls back to a
  // sensible date-based label when title is null.
  function sessionTitle(session) {
    if (!session) return '';
    if (session.title) return session.title;
    const d = sessionDate(session);
    return d ? 'Session · ' + d : 'Session';
  }

  function sessionDate(session) {
    if (!session || !session.source) return '';
    if (!session.session_date) return '';
    const d = new Date(session.session_date + 'T00:00:00');
    if (isNaN(d.getTime())) return session.session_date;
    return d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  // Short source-label chip for the list view.
  function sourceLabel(session) {
    const s = session && session.source;
    if (s === 'peak_athlete')  return 'PEAK ATHLETE';
    if (s === 'self_upload')   return 'SELF UPLOAD';
    if (s === 'templo_import') return 'TEMPLO';
    return '';
  }

  // ── Expose ──────────────────────────────────────────────────
  window.PA_SESSIONS = {
    listSessions,
    listClipsForSession,
    // Phase 2 — notes CRUD
    listNotesForClip, addClipNote, deleteClipNote,
    // Phase 4 — annotations CRUD + render helper
    listAnnotationsForClip, addClipAnnotation, deleteClipAnnotation,
    renderStroke,
    // Phase 5 — tags + library
    listMyTags, listTagsForClip, listVisibleTagsAcrossClips,
    createTag, applyTagToClip, removeTagFromClip, deleteTag,
    listAllClipsForLibrary,
    listAllSessionsForLibrary,
    // Phase 6 / v03.49 — team library (session-level share)
    setSessionCoachSharedToSquad, setCoachSharedToSquad,
    getMyTeamMembership,
    listAllClipsForLibraryV2,
    // Phase 7 (v03.44) — Save to Library
    findClipForTrial, getClipForLibrary, promoteTrialToClip,
    // v03.45 — Delete session
    deleteSession,
    // v03.46 — curated sessions
    listSessionsForAthlete, createSession, deleteClip,
    fmtTimestamp,
    sessionTitle, sessionDate, sourceLabel,
  };

  try { console.log('[PA_SESSIONS] loaded (v03.55)'); } catch (_) {}
})();
