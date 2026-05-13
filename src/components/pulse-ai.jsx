/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Pulse AI — FAB + Drawer components

   v01.61 — minimal port. PulseFab is the floating entry point
   (admin-gated by ai_coach_access). PulseDrawer is the slide-
   out panel with prompt buttons + streaming message list.

   Polish deferred (see Claude memory
   `project_pulse_post_launch_polish.md`):
     - Auto-context refresh every 2 s while drawer open
     - Markdown table rendering
     - Welcome state animation
     - Mobile drawer slides from bottom (vs right on desktop)
     - Quota tag color emphasis at low remaining

   Both components consume window.PA_PULSE (loaded earlier by
   src/lib/pulse.js).
   ─────────────────────────────────────────────────────────── */

const { useState: usePulseState, useEffect: usePulseEffect, useRef: usePulseRef } = React;

const PROMPTS = [
  { id: 'analyze', i18n: 'pulse.prompt.analyze' },
  { id: 'compare', i18n: 'pulse.prompt.compare' },
  { id: 'focus',   i18n: 'pulse.prompt.focus'   },
  { id: 'trend',   i18n: 'pulse.prompt.trend'   },
  { id: 'explain', i18n: 'pulse.prompt.explain' },
  { id: 'team',    i18n: 'pulse.prompt.team'    },
];

// ── PulseFab ─────────────────────────────────────────────────
// Floating bottom-right button. Visible to:
//   - admins (ai_coach_access row): badge shows remaining quota
//   - non-admins: hidden entirely during soft launch (mirrors live)
//
// On click → opens PulseDrawer. The drawer renders portal-style
// from the same component for state colocation.
const PulseFab = ({ authUserId, role, athleteName }) => {
  // ── All hooks unconditionally at the top, per Rules of Hooks ──
  // Calling useT() or useIsMobile() AFTER an early return would
  // change the hook count between renders (first render returns null
  // before reaching them; later renders run them) → React error #310.
  const isMobile = (window.useIsMobile || (() => false))();
  const tFn      = (window.useT       || (() => (k) => k))();
  const lang     = (window.PA_I18N?.getLang?.() || 'en');
  const [access, setAccess] = usePulseState(null); // null = unknown, false = no, true = yes
  const [quota,  setQuota]  = usePulseState({ used: 0, limit: 50, remaining: 0, allowed: false });
  const [open,   setOpen]   = usePulseState(false);

  // Check access + load quota on mount + when auth id changes.
  usePulseEffect(() => {
    let cancelled = false;
    if (!authUserId || !window.PA_PULSE) { setAccess(false); return; }
    (async () => {
      const has = await window.PA_PULSE.checkAccess(authUserId);
      if (cancelled) return;
      setAccess(has);
      if (has) {
        const q = await window.PA_PULSE.loadQuota(authUserId);
        if (cancelled) return;
        setQuota(q);
      }
    })();
    return () => { cancelled = true; };
  }, [authUserId]);

  // Early return AFTER all hooks have been called.
  if (access !== true) return null; // soft-launch: no FAB for non-admins

  // Refresh quota helper — exposed to drawer via callback.
  const refreshQuota = async () => {
    if (!authUserId || !window.PA_PULSE) return;
    const q = await window.PA_PULSE.loadQuota(authUserId);
    setQuota(q);
  };

  return (
    <React.Fragment>
      {/* The FAB itself */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={tFn('pulse.aria.toggle')}
        style={{
          position: 'fixed',
          right: isMobile ? 16 : 24,
          bottom: isMobile ? 16 : 24,
          width: 56, height: 56,
          borderRadius: 28,
          background: 'var(--signal-eff)',
          color: 'var(--ink)',
          border: 'none',
          boxShadow: 'var(--shadow)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100,
          transition: 'transform 0.12s ease',
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)'; }}
        onMouseUp={(e) =>   { e.currentTarget.style.transform = 'scale(1)'; }}
        onMouseLeave={(e) =>{ e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {/* AI / spark icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        {/* Quota badge */}
        <span style={{
          position: 'absolute',
          top: -6, right: -6,
          minWidth: 22, height: 22,
          padding: '0 6px',
          borderRadius: 11,
          background: 'var(--bg-2)',
          color: 'var(--tx-hi)',
          border: '2px solid var(--signal-eff)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {quota.remaining}
        </span>
      </button>
      {open && (
        <PulseDrawer
          onClose={() => setOpen(false)}
          quota={quota}
          onQuotaChange={refreshQuota}
          role={role}
          athleteName={athleteName}
          lang={lang}
          tFn={tFn}
        />
      )}
    </React.Fragment>
  );
};

// ── PulseDrawer ──────────────────────────────────────────────
// Slide-out panel from the right. Contains:
//   • Header (title + quota + close)
//   • Context bar (current module label)
//   • Prompt buttons (5 always, +Team only for coach team view)
//   • Messages area (streaming user/AI bubbles)
//   • Disclaimer
const PulseDrawer = ({ onClose, quota, onQuotaChange, role, athleteName, lang, tFn }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const [messages, setMessages] = usePulseState([]);
  const [loading,  setLoading]  = usePulseState(false);
  const [ctxLabel, setCtxLabel] = usePulseState('');
  const messagesEndRef = usePulseRef(null);

  // Gather context once on open. Live re-gathers every 2 s while
  // open — deferred polish item.
  usePulseEffect(() => {
    if (!window.PA_PULSE) return;
    const ctx = window.PA_PULSE.getContext();
    setCtxLabel(ctx?.label || tFn('pulse.context.none'));
  }, []);

  // Auto-scroll to latest message
  usePulseEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  // Esc to close + scroll lock
  usePulseEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const ctx = window.PA_PULSE?.getContext?.() || {};
  const hasPrimary = !!ctx.primary;
  const hasCompare = !!ctx.compare;
  const isCoachTeamView = role === 'coach' && ctx.module === 'home';
  const noQuota = (quota?.remaining || 0) <= 0;

  // Per-prompt enablement — match live's pulseUpdatePromptStates.
  const isPromptEnabled = (id) => {
    if (loading || noQuota) return false;
    if (id === 'analyze' || id === 'focus' || id === 'explain') return hasPrimary;
    if (id === 'compare') return hasCompare;
    if (id === 'trend')   return true; // requires data, but check happens on send
    if (id === 'team')    return isCoachTeamView;
    return true;
  };

  const onSend = async (promptType) => {
    if (loading || noQuota || !window.PA_PULSE) return;
    const userText = tFn('pulse.prompt.' + promptType);
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    // Placeholder AI message we'll stream into
    const aiIndex = (m => m.length)(messages) + 1;
    setMessages(prev => [...prev, { role: 'ai', text: '' }]);
    setLoading(true);

    try {
      let acc = '';
      const stream = window.PA_PULSE.send(promptType, { role, athleteName, language: lang });
      for await (const chunk of stream) {
        acc += chunk;
        setMessages(prev => {
          const next = prev.slice();
          next[next.length - 1] = { role: 'ai', text: acc };
          return next;
        });
      }
      // Final fallback if streaming yielded nothing
      if (!acc) {
        setMessages(prev => {
          const next = prev.slice();
          next[next.length - 1] = { role: 'ai', text: tFn('pulse.error.empty') };
          return next;
        });
      }
      onQuotaChange?.();
    } catch (err) {
      setMessages(prev => {
        const next = prev.slice();
        next[next.length - 1] = { role: 'ai', text: tFn('pulse.error.generic') + ' ' + (err?.message || '') };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const fmt = window.PA_PULSE?.formatText || ((s) => s);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'color-mix(in oklch, var(--ink) 60%, transparent)',
        display: 'flex',
        justifyContent: isMobile ? 'stretch' : 'flex-end',
        alignItems: 'stretch',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? '100%' : 'min(440px, 100%)',
          height: '100%',
          background: 'var(--bg-2)',
          borderLeft: '1px solid var(--line-soft)',
          boxShadow: 'var(--shadow)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--line-soft)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              font: '700 16px var(--font-ui)',
              color: 'var(--tx-hi)', letterSpacing: '-0.01em',
            }}>{tFn('pulse.title')}</span>
            <span style={{
              font: '600 10px var(--font-mono)',
              padding: '3px 7px',
              borderRadius: 6,
              background: noQuota ? 'color-mix(in oklch, var(--flag-eff) 18%, transparent)' : 'var(--bg-3)',
              color: noQuota ? 'var(--flag-eff)' : 'var(--tx-md)',
              letterSpacing: '0.04em',
            }}>{quota.remaining} / {quota.limit}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tFn('common.close')}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'var(--bg-3)', border: '1px solid var(--line)',
              color: 'var(--tx-md)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: '600 16px var(--font-ui)', lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Context bar */}
        <div style={{
          padding: '10px 18px',
          font: '500 11px var(--font-mono)',
          color: 'var(--tx-lo)',
          letterSpacing: '0.04em',
          background: 'var(--bg-3)',
          borderBottom: '1px solid var(--line-soft)',
          flexShrink: 0,
        }}>
          {(ctxLabel || tFn('pulse.context.none')).toUpperCase()}
        </div>

        {/* Prompts */}
        <div style={{
          padding: '12px 18px',
          display: 'flex', flexWrap: 'wrap', gap: 6,
          borderBottom: '1px solid var(--line-soft)',
          flexShrink: 0,
        }}>
          {PROMPTS.map(p => {
            if (p.id === 'team' && !isCoachTeamView) return null;
            const enabled = isPromptEnabled(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={!enabled}
                onClick={() => onSend(p.id)}
                style={{
                  font: '600 11px var(--font-ui)',
                  padding: '7px 11px',
                  borderRadius: 8,
                  background: enabled ? 'var(--bg-3)' : 'var(--bg-2)',
                  color: enabled ? 'var(--tx-hi)' : 'var(--tx-lo)',
                  border: '1px solid var(--line)',
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : 0.55,
                  whiteSpace: 'nowrap',
                }}
              >{tFn(p.i18n)}</button>
            );
          })}
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 18px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{
              padding: '24px 0',
              textAlign: 'center',
              font: '500 13px var(--font-ui)',
              color: 'var(--tx-lo)',
              lineHeight: 1.5,
            }}>
              {tFn('pulse.welcome')}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: m.role === 'user'
                  ? '14px 14px 4px 14px'
                  : '14px 14px 14px 4px',
                background: m.role === 'user'
                  ? 'color-mix(in oklch, var(--signal-eff) 16%, var(--bg-3))'
                  : 'var(--bg-3)',
                border: '1px solid var(--line-soft)',
                color: 'var(--tx-hi)',
                font: '500 13px var(--font-ui)',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                {m.role === 'ai' && m.text === '' && loading
                  ? <span style={{ color: 'var(--tx-lo)' }}>{tFn('pulse.thinking')}…</span>
                  : <span dangerouslySetInnerHTML={{ __html: fmt(m.text) }}/>}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef}/>
        </div>

        {/* Disclaimer */}
        <div style={{
          padding: '10px 18px',
          font: '400 10px var(--font-ui)',
          color: 'var(--tx-lo)',
          borderTop: '1px solid var(--line-soft)',
          textAlign: 'center',
          lineHeight: 1.4,
          flexShrink: 0,
        }}>
          {tFn('pulse.disclaimer')}
        </div>
      </div>
    </div>
  );
};

// ── Expose ───────────────────────────────────────────────────
Object.assign(window, { PulseFab });

try { console.log('[pulse-ai] loaded (v01.61 — minimal port)'); } catch (_) {}
