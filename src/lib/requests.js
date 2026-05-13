/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Race Analysis Requests — data layer (READ-ONLY)

   Mirrors the live v02.29 dashboard's surfaces exactly:
   - Subscription:    v_my_subscription (RLS-filtered, one row)
   - Quota:           rpc('check_analysis_quota', {p_athlete_uuid})
   - Request history: race_requests (RLS-filtered to athlete_uuid)
   - Pay links:       STRIPE_EXTRA_ANALYSIS, STRIPE_BUNDLE_4PACK
   - Edge functions:  r2-upload-url, r2-download-url,
                      notify-analysis-request, notify-analysis-complete

   v00.13 scope = reads only. No .insert/.update, no RPCs with
   side effects, no POSTs to edge functions. Those land in
   v00.14+ when the UI asks for them, still with Eric's review.

   Exposed on window.PA_REQUESTS.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const client = window.supabaseClient;
  const SUPABASE_URL = window.PA_AUTH?.SUPABASE_URL;

  // ── Constants — lifted verbatim from live index.html ──────────

  // Pay links (live v02.29: index.html:9480, 19301-19302)
  const STRIPE_LINKS = {
    extra:  'https://buy.stripe.com/3cI8wO9v7b9FaKF7JogjC02',
    bundle: 'https://buy.stripe.com/4gM6oG36J4Lh5ql3t8gjC03',
    pro:    'https://buy.stripe.com/eVq5kC6iVb9Fg4Z2p4gjC01',
  };

  // Edge function URLs — names kept identical so the same
  // Supabase deployment serves both the live dashboard and the
  // prototype. Reads only for now; v00.14+ will actually call them.
  const EDGE = {
    uploadUrl:      SUPABASE_URL + '/functions/v1/r2-upload-url',
    downloadUrl:    SUPABASE_URL + '/functions/v1/r2-download-url',
    notifyRequest:  SUPABASE_URL + '/functions/v1/notify-analysis-request',
    notifyComplete: SUPABASE_URL + '/functions/v1/notify-analysis-complete',
  };

  const STATUSES = ['pending', 'processing', 'completed', 'failed'];

  // ── Subscription ─────────────────────────────────────────────
  // v_my_subscription is RLS-filtered to the current user.
  // Columns observed in live: plan_id, is_active, status, trial_end,
  // features (array), cancel_at_period_end, current_period_end, ...

  async function getSubscription() {
    try {
      // v01.68 — wrapped in withRecovery(). This query is the prime
      // trigger for the stuck-client bug Eric reproduced: clicking
      // a Stripe pay-link → opening new tab → coming back → the
      // visibilitychange listener fires this query, and on certain
      // states it hangs the supabase client. With withRecovery, the
      // poll's hang gets caught and retried via refreshSession, so
      // the trigger event itself doesn't propagate a stuck state to
      // downstream tab clicks.
      const exec = () => client
        .from('v_my_subscription')
        .select('*')
        .maybeSingle();
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'v_my_subscription getSubscription' })
        : await exec();
      if (error && error.code !== 'PGRST116') {
        return { data: freeFallback(), error };
      }
      return { data: data || freeFallback(), error: null };
    } catch (e) {
      return { data: freeFallback(), error: e };
    }
  }

  function freeFallback() {
    return { plan_id: 'free', is_active: false, status: null, features: [] };
  }

  function isPro(sub) {
    return !!(sub && sub.plan_id === 'pro' && sub.is_active);
  }

  function isTrialing(sub) {
    return !!(sub && sub.status === 'trialing');
  }

  // Days left on trial (or null if not trialing / unknown)
  function trialDaysLeft(sub) {
    if (!sub?.trial_end) return null;
    const end = new Date(sub.trial_end);
    if (isNaN(end)) return null;
    return Math.max(0, Math.ceil((end - new Date()) / 86400000));
  }

  // ── Quota ────────────────────────────────────────────────────
  // RPC: check_analysis_quota(p_athlete_uuid) → [{ used, total_limit,
  //   has_quota, subscription_status }]
  // This is the authoritative quota source — the race_analyses_used
  // column is flagged unused in root CLAUDE.md.

  async function getQuota(athleteUuid) {
    if (!athleteUuid) {
      return { data: noQuota(), error: null };
    }
    try {
      // v01.71 — wrapped in withRecovery(). Part of the 4-parallel
      // Promise.all in useRequests.load() that fires on Stripe-return.
      // An unwrapped hang here propagates to the whole load(), stranding
      // all subsequent queries.
      const exec = () => client.rpc('check_analysis_quota', {
        p_athlete_uuid: athleteUuid,
      });
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'check_analysis_quota getQuota' })
        : await exec();
      if (error) return { data: noQuota(), error };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { data: noQuota(), error: null };
      return {
        data: {
          used:      Number.isFinite(row.used) ? row.used : 0,
          limit:     Number.isFinite(row.total_limit) ? row.total_limit : 0,
          hasQuota:  !!row.has_quota,
          status:    row.subscription_status || 'none',
        },
        error: null,
      };
    } catch (e) {
      return { data: noQuota(), error: e };
    }
  }

  function noQuota() {
    return { used: 0, limit: 0, hasQuota: false, status: 'none' };
  }

  // Human-readable summary: "2 of 3 used", "No subscription", etc.
  function quotaLabel(q) {
    if (!q || q.status === 'none') return 'No subscription';
    return q.used + ' of ' + q.limit + ' used';
  }

  // ── Race requests ────────────────────────────────────────────
  // RLS on race_requests scopes athlete reads to athlete_uuid.
  // Columns observed in live: request_uuid, athlete_uuid, video_key,
  //   video_filename, video_size_bytes, event_name, event_date,
  //   distance_m, style, course, lane_number, status, admin_notes,
  //   is_included_in_plan, created_at, updated_at, processed_at.

  async function listRequests(athleteUuid, opts) {
    const limit = (opts && opts.limit) || 10;
    if (!athleteUuid) return { data: [], error: null };
    try {
      // v01.71 — wrapped in withRecovery(). See getQuota note.
      const exec = () => client
        .from('race_requests')
        .select('*')
        .eq('athlete_uuid', athleteUuid)
        .order('created_at', { ascending: false })
        .limit(limit);
      const recover = window.PA_AUTH?.withRecovery;
      const { data, error } = recover
        ? await recover(exec, { label: 'race_requests listRequests' })
        : await exec();
      return { data: data || [], error: error || null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  // Pending badge: how many requests still in-flight?
  async function countPending(athleteUuid) {
    if (!athleteUuid) return { count: 0, error: null };
    try {
      // v01.71 — wrapped in withRecovery(). See getQuota note.
      const exec = () => client
        .from('race_requests')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_uuid', athleteUuid)
        .in('status', ['pending', 'processing']);
      const recover = window.PA_AUTH?.withRecovery;
      const { count, error } = recover
        ? await recover(exec, { label: 'race_requests countPending' })
        : await exec();
      return { count: count || 0, error: error || null };
    } catch (e) {
      return { count: 0, error: e };
    }
  }

  // Predicates for UI chip tone
  const isPending    = (r) => r && (r.status === 'pending' || r.status === 'processing');
  const isCompleted  = (r) => r && r.status === 'completed';
  const isFailed     = (r) => r && r.status === 'failed';

  // Compact title: "100 Freestyle · LCM" (+ event name if present).
  // Mirrors live index.html:19556 but without emojis (root rule).
  function fmtRequest(row) {
    if (!row) return '';
    const event = (row.distance_m ? row.distance_m + ' ' : '')
      + (row.style ? row.style.charAt(0).toUpperCase() + row.style.slice(1) : '');
    const parts = [];
    if (event.trim()) parts.push(event.trim());
    if (row.course)   parts.push(row.course);
    let line = parts.join(' · ');
    if (row.event_name) line += (line ? ' — ' : '') + row.event_name;
    return line || 'Race request';
  }

  // ── Stripe URL builder ───────────────────────────────────────
  // Live: index.html:19402-19417. Adds client_reference_id
  // (= auth user UUID, the key Stripe uses to match back) and
  // prefilled_email.

  function buildStripeUrl(baseUrl, opts) {
    if (!baseUrl) return '';
    const { authUserId, email } = opts || {};
    const params = new URLSearchParams();
    if (authUserId) params.set('client_reference_id', authUserId);
    if (email)      params.set('prefilled_email', email);
    const q = params.toString();
    return q ? (baseUrl + '?' + q) : baseUrl;
  }

  // ── Stripe customer portal (v01.15, Batch 2) ─────────────────
  // Calls the existing `create-portal` edge function (deployed
  // 2025-04 on the live project). Returns a one-shot URL for
  // Stripe's hosted Customer Portal where the user can update
  // their card, view invoices, and cancel.
  //
  // `returnUrl` is where Stripe redirects after the portal
  // session ends. Default is the current page so the user lands
  // back where they came from. Pass an explicit value if the
  // caller (e.g. AccountModal) wants to land somewhere specific.
  //
  // The edge function signs the request server-side using the
  // user's bearer token (auto-attached by supabase-js fetch),
  // looks up their stripe_customer_id, and creates the portal
  // session. Returns { url } on success or { error } on failure.
  async function openCustomerPortal(opts = {}) {
    const returnUrl = opts.returnUrl || window.location.href;
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        return { ok: false, error: { message: 'Not signed in.' } };
      }
      const res = await fetch(SUPABASE_URL + '/functions/v1/create-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ return_url: returnUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        return {
          ok: false,
          error: { message: payload?.error || ('Portal request failed (HTTP ' + res.status + ')') },
        };
      }
      // Open in a new tab — the prototype runs in an iframe on
      // mypeakathlete.com/blank-3 in production, so target=_self
      // would be trapped. _blank works on both prod (iframe) and
      // local dev.
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      return { ok: true, url: payload.url };
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e) } };
    }
  }

  // ── Upload orchestrator (v01.16, Batch 3) ────────────────────
  // Wires the four-step race-request submission, mirroring the
  // live dashboard's submitUpload() at index.html L19772 line-for-
  // line. No new schema, no new RPCs — just the existing edge
  // functions and the existing race_requests table:
  //
  //   1. POST /functions/v1/r2-upload-url with the file's metadata
  //      → response { uploadUrl, videoKey }
  //   2. PUT the file body directly to R2 (the presigned uploadUrl).
  //      Uses XHR so we can surface upload progress.
  //   3. INSERT a race_requests row with the videoKey + form
  //      metadata. The trg_consume_credit_on_request trigger fires
  //      automatically and calls consume_analysis_credit() —
  //      no client-side increment needed.
  //   4. Fire-and-forget POST /functions/v1/notify-analysis-request
  //      so Eric gets an email about the new request.
  //
  // Inputs:
  //   { file, metadata: { eventName, eventDate, distance, style,
  //                       course, lane, notes },
  //     athleteUuid, athleteName, athleteEmail, onProgress(pct) }
  //
  // Returns:
  //   { ok: true, requestUuid } on success
  //   { ok: false, error: { message, step } } on any failure;
  //     `step` ∈ 'auth' | 'upload-url' | 'upload' | 'insert' so
  //     the caller can branch UX (e.g. "video upload failed —
  //     no request was saved" vs. "saved but email may not have
  //     fired").
  //
  // Per Eric's CLAUDE.md note (2026-05-05): notify-analysis-request
  // is a transactional system notification — fires normally, NOT
  // subject to the Gmail-drafts rule.
  async function submitRaceRequest(opts) {
    const {
      file, metadata = {},
      athleteUuid, athleteName, athleteEmail,
      onProgress,
    } = opts || {};

    if (!file)         return { ok: false, error: { message: 'No video file selected.', step: 'validate' } };
    if (!athleteUuid)  return { ok: false, error: { message: 'No athlete UUID — sign in as an athlete.', step: 'validate' } };

    const setProgress = (pct, label) => {
      try { onProgress && onProgress(pct, label); } catch (_) {}
    };

    setProgress(2, 'Preparing upload…');

    // Step 0 — auth token (every edge function call requires the
    // signed-in user's bearer token + the project's anon apikey).
    let token;
    try {
      const { data: { session } } = await client.auth.getSession();
      token = session?.access_token;
      if (!token) {
        return { ok: false, error: { message: 'Not signed in.', step: 'auth' } };
      }
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e), step: 'auth' } };
    }

    const SUPABASE_KEY = window.PA_AUTH?.SUPABASE_KEY;

    // Step 1 — get presigned PUT URL from r2-upload-url edge fn.
    setProgress(8, 'Preparing upload…');
    let uploadUrl, videoKey;
    try {
      const res = await fetch(EDGE.uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey':        SUPABASE_KEY,
        },
        body: JSON.stringify({
          filename:    file.name,
          contentType: file.type,
          fileSize:    file.size,
          athleteUuid,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.uploadUrl || !body?.videoKey) {
        return {
          ok: false,
          error: {
            message: body?.error || ('Failed to get upload URL (HTTP ' + res.status + ')'),
            step: 'upload-url',
          },
        };
      }
      uploadUrl = body.uploadUrl;
      videoKey  = body.videoKey;
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e), step: 'upload-url' } };
    }

    // Step 2 — direct PUT to R2 with progress reporting.
    // XHR (not fetch) because fetch can't surface upload progress.
    setProgress(15, 'Uploading video…');
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = 15 + (e.loaded / e.total) * 70; // 15→85
          setProgress(Math.round(pct), 'Uploading video… ' + Math.round(e.loaded / e.total * 100) + '%');
        };
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 204) resolve(xhr);
          else reject(new Error('Upload failed (HTTP ' + xhr.status + ')'));
        };
        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
        xhr.send(file);
      });
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e), step: 'upload' } };
    }

    // Step 3 — INSERT race_requests row. RLS race_requests_insert
    // enforces athlete_uuid match. The trg_consume_credit_on_request
    // trigger fires automatically; no manual quota increment.
    setProgress(90, 'Saving request…');
    let requestUuid = null;
    try {
      const requestData = {
        athlete_uuid:      athleteUuid,
        video_key:         videoKey,
        video_filename:    file.name,
        video_size_bytes:  file.size,
        event_name:        metadata.eventName || null,
        event_date:        metadata.eventDate || null,
        distance_m:        metadata.distance != null && metadata.distance !== ''
                             ? parseInt(metadata.distance, 10)
                             : null,
        style:             metadata.style || null,
        course:            metadata.course || null,
        lane_number:       metadata.lane != null && metadata.lane !== ''
                             ? parseInt(metadata.lane, 10)
                             : null,
        status:            'pending',
        is_included_in_plan: true,
        admin_notes:       metadata.notes || null,
      };
      const { data, error } = await client
        .from('race_requests')
        .insert(requestData)
        .select('request_uuid')
        .single();
      if (error) {
        return { ok: false, error: { message: error.message || 'Insert failed.', step: 'insert' } };
      }
      requestUuid = data?.request_uuid || null;
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e), step: 'insert' } };
    }

    // Step 4 — fire-and-forget email notification.
    // Failures here don't fail the whole submission — the
    // request row is already saved. We log the warning and move on.
    setProgress(98, 'Notifying analyst…');
    try {
      fetch(EDGE.notifyRequest, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
          'apikey':        SUPABASE_KEY,
        },
        body: JSON.stringify({
          athleteName:   athleteName || 'Unknown',
          athleteEmail:  athleteEmail || null,
          eventName:     metadata.eventName || null,
          eventDate:     metadata.eventDate || null,
          distance:      metadata.distance || null,
          stroke:        metadata.style || null,
          course:        metadata.course || null,
          lane:          metadata.lane || null,
          videoFilename: file.name,
          videoSize:     file.size,
          requestId:     requestUuid,
        }),
      }).catch((e) => { try { console.warn('[PA_REQUESTS] notify failed:', e); } catch (_) {} });
    } catch (notifyErr) {
      try { console.warn('[PA_REQUESTS] notify error:', notifyErr); } catch (_) {}
    }

    setProgress(100, 'Done');
    return { ok: true, requestUuid };
  }

  // ── Video URL signing (v01.17, Batch 3 part 2) ───────────────
  // Wraps the existing `r2-download-url` edge function. Mirrors
  // live's loadVideoUrl() at index.html L17185:
  //
  //   POST /functions/v1/r2-download-url
  //   body: { videoKey, athleteUuid, requestUuid?, isBenchmark? }
  //   → response: { downloadUrl }
  //
  // The edge function checks RLS server-side: a user can only
  // download videos for their own athlete_uuid (or the team's
  // athletes if they're a coach with `is_active_coach_of_team`,
  // or any video if they're an admin). The signed URL is short-
  // lived (~5 minutes per the Cloudflare R2 default).
  //
  // Returns:
  //   { ok: true, url } on success
  //   { ok: false, error: { message } } on any failure
  //
  // Per Eric's CLAUDE.md note (2026-05-05): NEVER log the signed
  // URL itself — it's a short-lived but real credential. The
  // helper logs only the videoKey + status code.
  async function getVideoDownloadUrl(videoKey, opts = {}) {
    if (!videoKey) {
      return { ok: false, error: { message: 'No videoKey provided.' } };
    }
    const { athleteUuid, requestUuid, isBenchmark } = opts;
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        return { ok: false, error: { message: 'Not signed in.' } };
      }
      const SUPABASE_KEY = window.PA_AUTH?.SUPABASE_KEY;
      const body = {
        videoKey,
        athleteUuid: athleteUuid || null,
        requestUuid: requestUuid || null,
      };
      if (isBenchmark) body.isBenchmark = true;

      const res = await fetch(EDGE.downloadUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          'apikey':        SUPABASE_KEY,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        // Log the videoKey + status, NEVER the URL itself.
        try { console.warn('[PA_REQUESTS] r2-download-url failed:', { videoKey, status: res.status }); } catch (_) {}
        let detail = null;
        try { const j = await res.json(); detail = j?.error; } catch (_) {}
        return {
          ok: false,
          error: { message: detail || ('Video URL request failed (HTTP ' + res.status + ')') },
        };
      }
      const payload = await res.json();
      if (!payload?.downloadUrl) {
        return { ok: false, error: { message: 'Edge function returned no downloadUrl.' } };
      }
      return { ok: true, url: payload.downloadUrl };
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e) } };
    }
  }

  // ── Admin queue helpers (v01.27, Batch 5) ────────────────────
  // Three async helpers backing src/components/web-admin.jsx.
  // RLS handles access — `is_race_request_admin()` server-side
  // policy permits SELECT/UPDATE on race_requests for users with
  // can_manage_race_requests=true in the admins table.
  //
  // Mirrors live's loadAdminRequests / saveRequestStatus exactly
  // so the prototype's admin queue is functionally interchangeable
  // with live's admin page during Eric's daily ops.

  // SELECT race_requests + athlete + team join. Optional status
  // filter ('pending' | 'processing' | 'completed' | 'failed').
  // Returns { rows, error }; rows is always an array.
  async function listAdminRequests({ status } = {}) {
    let query = client
      .from('race_requests')
      .select(
        'request_uuid, athlete_uuid, video_key, video_filename, ' +
        'event_name, event_date, distance_m, style, course, lane_number, ' +
        'status, admin_notes, created_at, processed_at, ' +
        'athletes!inner(first_name, last_name, email, team_uuid, teams(team_name))'
      )
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) {
      try { console.warn('[PA_REQUESTS] listAdminRequests error:', error.message); } catch (_) {}
      return { rows: [], error };
    }
    return { rows: data || [], error: null };
  }

  // UPDATE race_requests SET status, admin_notes, processed_at,
  // updated_at. On status === 'completed', fire the
  // `notify-analysis-complete` edge function fire-and-forget so the
  // athlete gets an email (transactional notification, not subject
  // to the Gmail-drafts rule). Returns { ok, error }.
  async function updateAdminRequest(requestUuid, { status, adminNotes, athleteRow }) {
    if (!requestUuid) {
      return { ok: false, error: { message: 'No requestUuid' } };
    }
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (adminNotes != null) updateData.admin_notes = adminNotes;
    if (status === 'completed' || status === 'failed') {
      updateData.processed_at = new Date().toISOString();
    }

    const { error } = await client
      .from('race_requests')
      .update(updateData)
      .eq('request_uuid', requestUuid);
    if (error) return { ok: false, error };

    // Fire-and-forget completion email. Failure here doesn't undo
    // the row update — the email is best-effort.
    if (status === 'completed' && athleteRow?.email) {
      try {
        const { data: { session } } = await client.auth.getSession();
        const token = session?.access_token;
        if (token) {
          fetch(EDGE.notifyComplete, {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': 'Bearer ' + token,
              'apikey':        window.PA_AUTH?.SUPABASE_KEY,
            },
            body: JSON.stringify({
              athleteEmail: athleteRow.email,
              athleteName: [athleteRow.first_name, athleteRow.last_name].filter(Boolean).join(' '),
              eventName:   athleteRow.eventName || '',
              distance:    athleteRow.distance_m || null,
              stroke:      athleteRow.style || null,
              course:      athleteRow.course || null,
              adminNotes:  adminNotes || '',
              requestId:   requestUuid,
            }),
          }).catch((e) => { try { console.warn('[PA_REQUESTS] notify-analysis-complete failed:', e); } catch (_) {} });
        }
      } catch (notifyErr) {
        try { console.warn('[PA_REQUESTS] notify dispatch error:', notifyErr); } catch (_) {}
      }
    }

    return { ok: true, error: null };
  }

  // Admin variant of getVideoDownloadUrl that triggers a real file
  // download (creates a hidden <a download>, clicks it, removes).
  // Same edge function (`r2-download-url`) — server-side RLS lets
  // admins read any video by passing requestUuid + admin context.
  async function downloadAdminVideo(videoKey, filename, requestUuid) {
    if (!videoKey) {
      return { ok: false, error: { message: 'No videoKey' } };
    }
    try {
      const { ok, url, error } = await getVideoDownloadUrl(videoKey, { requestUuid });
      if (!ok || !url) {
        return { ok: false, error: error || { message: 'No download URL' } };
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || (videoKey.split('/').pop() || 'video.mp4');
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 250);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: { message: String(e?.message || e) } };
    }
  }

  // Admin pending count — same query as countPending but without
  // the athlete-uuid filter (admins see all). Used for the sidebar
  // Admin nav-item badge.
  async function countAdminPending() {
    const { count, error } = await client
      .from('race_requests')
      .select('request_uuid', { count: 'exact', head: true })
      .in('status', ['pending', 'processing']);
    if (error) {
      try { console.warn('[PA_REQUESTS] countAdminPending error:', error.message); } catch (_) {}
      return { count: 0, error };
    }
    return { count: count || 0, error: null };
  }

  // ── hasFeature (v01.48 — Batch 9 polish) ─────────────────
  //
  // Wraps live's `has_feature(feature_name, check_user_id)` RPC.
  // Returns true/false based on the caller's plan + entitlement
  // tables. Server-authoritative — the prototype never decides
  // feature unlock client-side.
  //
  // Feature name is a free-form string the server understands
  // (e.g. 'video_download', 'ai_coach', 'extra_analyses'). Each
  // surface that gates content calls `hasFeature(name)` once and
  // caches the boolean while the page is mounted.
  //
  // On error or missing user, returns false (fail-closed). The
  // prototype never silently elevates a free user to Pro.
  async function hasFeature(featureName, userIdOverride) {
    if (!featureName) return false;
    try {
      const { data: { user } } = await client.auth.getUser();
      const userId = userIdOverride || user?.id || null;
      if (!userId) return false;
      const { data, error } = await client.rpc('has_feature', {
        feature_name:  featureName,
        check_user_id: userId,
      });
      if (error) {
        try { console.warn('[PA_REQUESTS] has_feature error:', error.message); } catch (_) {}
        return false;
      }
      return !!data;
    } catch (e) {
      return false;
    }
  }

  // ── Expose ───────────────────────────────────────────────────

  window.PA_REQUESTS = {
    // surfaces
    getSubscription, getQuota, listRequests, countPending,
    // derived
    isPro, isTrialing, trialDaysLeft, quotaLabel, fmtRequest,
    isPending, isCompleted, isFailed,
    // helpers
    buildStripeUrl, openCustomerPortal, submitRaceRequest, getVideoDownloadUrl,
    // admin (Batch 5)
    listAdminRequests, updateAdminRequest, downloadAdminVideo, countAdminPending,
    // feature gates (Batch 9 polish, v01.48)
    hasFeature,
    // constants (kept exported so v00.14+ UI reads one source of truth)
    STRIPE_LINKS, EDGE, STATUSES,
  };

  // Load-confirm — makes it obvious in the console whether a stale
  // cache is masking the new module.
  try { console.log('[PA_REQUESTS] loaded (v01.48)'); } catch (_) {}
})();
