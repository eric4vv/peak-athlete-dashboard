/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Pulse AI — state + Supabase + SSE streaming

   v01.61 — minimal port from live index.html (~lines 20991–
   21690). Goal: preserve current Pulse function for the 2
   admin users who have it today (gated by ai_coach_access).
   Polish items intentionally deferred — see Claude memory file
   `project_pulse_post_launch_polish.md`.

   Public surface (window.PA_PULSE):
     checkAccess(authUserId)        → Promise<boolean>
     loadQuota(authUserId)          → Promise<{ allowed, used,
                                                limit, remaining }>
     setContext(ctx)                → updates module/primary/compare
     getContext()                   → reads current context
     send(promptType, opts)         → async generator yielding
                                       streamed AI text chunks
     formatText(rawText)            → markdown → HTML
                                       (subset: bold / italic /
                                        headers / lists / hr / br)
   ─────────────────────────────────────────────────────────── */

(function () {
  const SUPABASE_URL = 'https://wbqgshvbopfukwyqsndq.supabase.co';

  function sb() { return window.supabaseClient; }

  // ── Access ────────────────────────────────────────────────
  // Soft-launch gating per live (v02.29 line 21006-21020):
  // user must have a row in ai_coach_access. Pro alone does
  // not grant access until public launch flips the rule.
  async function checkAccess(authUserId) {
    if (!authUserId) return false;
    try {
      const { data, error } = await sb()
        .from('ai_coach_access')
        .select('user_id')
        .eq('user_id', authUserId)
        .maybeSingle();
      if (error) {
        try { console.warn('[PA_PULSE] access check error:', error.message); } catch (_) {}
        return false;
      }
      return !!data;
    } catch (e) {
      try { console.warn('[PA_PULSE] access check threw:', e?.message || e); } catch (_) {}
      return false;
    }
  }

  // ── Quota ─────────────────────────────────────────────────
  // RPC returns JSONB { allowed, used, limit, remaining }.
  // Identical shape to live, so the UI bindings transfer.
  async function loadQuota(authUserId) {
    const blank = { allowed: false, used: 0, limit: 50, remaining: 0 };
    if (!authUserId) return blank;
    try {
      const { data, error } = await sb().rpc('check_ai_quota', {
        p_user_id: authUserId,
      });
      if (error) {
        try { console.warn('[PA_PULSE] quota error:', error.message); } catch (_) {}
        return blank;
      }
      // RPC returns { allowed, used, limit/total_limit, remaining }.
      // Live used `limit` not `total_limit` so we'll align here too.
      return {
        allowed:   !!(data?.allowed),
        used:      data?.used      || 0,
        limit:     data?.limit     || data?.total_limit || 50,
        remaining: data?.remaining || 0,
      };
    } catch (e) {
      return blank;
    }
  }

  // ── Context ───────────────────────────────────────────────
  // Live gathers context from appState.currentPage + module-
  // specific module state. In prototype-v03 each analysis
  // surface (Races / Starts / Turns) calls setContext when
  // primary or compare changes. send() reads it via getContext.
  //
  // Shape:
  //   { module: 'race'|'start'|'turn'|'home',
  //     primary: <trial row | null>,
  //     compare: <trial row | null>,
  //     label:   'Race: 100 Free 2026-05-04' (human-readable) }
  let _context = { module: 'home', primary: null, compare: null, label: 'Dashboard' };

  function setContext(next) {
    if (!next) return;
    _context = Object.assign({ module: 'home', primary: null, compare: null, label: '' }, next);
  }
  function getContext() { return _context; }

  // ── Send prompt → ai-coach edge function (SSE) ────────────
  // Yields incremental text chunks. Caller renders each as
  // they arrive so the streaming UX matches live's drawer.
  //
  // promptType is one of:
  //   analyze | compare | focus | trend | explain | team
  //
  // opts may include:
  //   role          — 'athlete' | 'coach' (caller passes appShell state)
  //   athleteName   — first name for the AI to address the user
  //   language      — 'en' | 'es'
  //   trend         — optional pre-fetched trend payload (caller
  //                   supplies when promptType === 'trend')
  async function* send(promptType, opts) {
    const session = await sb().auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) {
      throw new Error('Not authenticated');
    }
    const ctx = _context;
    const payload = {
      prompt_type: promptType,
      context: {
        module:      ctx.module,
        primary:     ctx.primary,
        compare:     ctx.compare,
        trend:       opts?.trend ?? null,
        role:        opts?.role || null,
        athlete_name: opts?.athleteName || null,
        activeTab:   ctx.activeTab || null,
        language:    opts?.language || 'en',
      },
    };

    const response = await fetch(SUPABASE_URL + '/functions/v1/ai-coach', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const errData = await response.json();
        detail = errData?.error || '';
      } catch (_) {}
      throw new Error(detail || ('Request failed (' + response.status + ')'));
    }

    // Stream SSE chunks. Each line starting with `data: ` is one
    // chunk. JSON-parseable payloads carry `{ text }` or
    // `{ error }`; plain text payloads pass through verbatim.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep partial line
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed?.error) throw new Error(parsed.error);
          if (parsed?.text) yield parsed.text;
        } catch (e) {
          // Not JSON — yield raw (live's fallback path).
          if (data !== '[DONE]') yield data;
        }
      }
    }
  }

  // ── Markdown subset → HTML ────────────────────────────────
  // v01.61 minimal: bold, italic, headers (## ###), bullet
  // lists, numbered lists, horizontal rules, line breaks.
  // Table parsing intentionally omitted — see deferred memory.
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatText(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Headers — render with Ink & Signal tokens, not live's
    // hardcoded purple/blue palette. Eyebrow caps style for h3,
    // signal-color border for h2 to match the design system.
    html = html.replace(/^### (.+)$/gm,
      '<div style="font: 700 11px var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--signal-eff); margin: 12px 0 4px;">$1</div>');
    html = html.replace(/^## (.+)$/gm,
      '<div style="font: 700 14px var(--font-ui); color: var(--tx-hi); margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--line-soft);">$1</div>');

    // Horizontal rule
    html = html.replace(/^---$/gm,
      '<div style="border-top: 1px solid var(--line-soft); margin: 10px 0;"></div>');

    // Bold + italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Numbered list — keep number visible in mono font
    html = html.replace(/^(\d+)\.\s+(.+)$/gm,
      '<div style="display: flex; gap: 8px; margin: 3px 0;"><span style="color: var(--signal-eff); font-weight: 700; font-family: var(--font-mono); font-size: 12px; min-width: 16px;">$1.</span><span>$2</span></div>');

    // Bullet list
    html = html.replace(/^[-•]\s+(.+)$/gm,
      '<div style="display: flex; gap: 8px; margin: 3px 0; padding-left: 4px;"><span style="color: var(--signal-eff);">&bull;</span><span>$1</span></div>');

    // Line breaks (escape after block-level cleanups)
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<\/div><br>/g, '</div>');

    return html;
  }

  // ── Expose ────────────────────────────────────────────────
  window.PA_PULSE = {
    checkAccess, loadQuota,
    setContext, getContext,
    send, formatText,
  };

  try { console.log('[PA_PULSE] loaded (v01.61 — minimal port)'); } catch (_) {}
})();
