/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Request-Analysis modals — BuyAnalysisModal + UploadModal

   v00.15 scope:
     - BuyAnalysisModal is fully working: Stripe pay-links only,
       no writes, no edge POSTs. Uses the exact translation keys
       from the live dashboard (index.html v02.29) so copy stays
       consistent across both surfaces.
     - UploadModal is a structural skeleton: fields render but
       the submit button is disabled with a "Wiring lands in
       v00.16" hint. No r2-upload-url call, no race_requests
       insert, no notify-analysis-request POST yet.

   Both modals share a minimal Ink & Signal styled overlay so
   they match the Deck without importing a third-party modal lib.
   ─────────────────────────────────────────────────────────── */

const { useEffect: useModalEffect, useState: useModalState } = React;

// ── i18n (lifted from live index.html, lines 7928-7941 EN +
//    8361-8370 ES) ──────────────────────────────────────────
// Phase 1 = English only per CLAUDE.md. Spanish map is kept here
// so Phase 4 i18n wiring can read from the same source of truth.

const REQ_I18N = {
  en: {
    modal_quota_title:     'Analysis Quota Reached',
    modal_quota_desc:      "You've used all your included analyses this month. Purchase additional analyses to continue.",
    modal_buy_more:        'Get More Race Analyses',
    modal_try_analysis:    'Try a Race Analysis',
    modal_buy_single_price:'$9.99',
    modal_buy_single_label:'1 Extra Analysis',
    modal_buy_single_desc: 'Perfect for a single race',
    modal_buy_bundle_price:'$34.99',
    modal_buy_bundle_label:'4-Pack Bundle',
    modal_buy_bundle_desc: 'Save $5 - great for meets!',
    modal_best_value:      'Best Value',
    modal_never_expire:    'Purchased analyses never expire',
    modal_data_viewable:   'Data viewable for 2 weeks',
    modal_maybe_later:     'Maybe Later',
    // v00.16b: copy correction — Pro is 3 analyses/mo, not unlimited.
    // Value prop = 3 monthly analyses + Pulse AI + full dashboard access.
    modal_want_unlimited:  'Want 3 analyses every month plus full access?',
    modal_subscribe_pro:   'Subscribe to Pro — $19.99/mo',
    modal_buy_more_desc:   'Unlock additional video analyses to track your progress.',
    modal_try_desc:        'Get professional video analysis of your race performance.',
  },
  es: {
    modal_quota_title:     'Cuota de Análisis Alcanzada',
    modal_quota_desc:      'Has utilizado todos tus análisis incluidos este mes. Compra análisis adicionales para continuar.',
    modal_buy_more:        'Obtener Más Análisis de Carreras',
    modal_try_analysis:    'Prueba un Análisis de Carrera',
    modal_buy_single_price:'$9.99',
    modal_buy_single_label:'1 Análisis Extra',
    modal_buy_single_desc: 'Perfecto para una sola carrera',
    modal_buy_bundle_price:'$34.99',
    modal_buy_bundle_label:'Paquete de 4',
    modal_buy_bundle_desc: 'Ahorra $5 - ideal para competencias',
    modal_best_value:      'Mejor Valor',
    modal_never_expire:    'Los análisis comprados nunca expiran',
    modal_data_viewable:   'Datos visibles por 2 semanas',
    modal_maybe_later:     'Quizás Después',
    modal_want_unlimited:  '¿Quieres 3 análisis cada mes y acceso completo?',
    modal_subscribe_pro:   'Suscribirse a Pro — $19.99/mes',
    modal_buy_more_desc:   'Desbloquea análisis de video adicionales para seguir tu progreso.',
    modal_try_desc:        'Obtén análisis profesional en video de tu rendimiento en carreras.',
  },
};

function t(key, locale) {
  const map = REQ_I18N[locale || 'en'] || REQ_I18N.en;
  return map[key] || REQ_I18N.en[key] || key;
}

// ── Shared overlay shell ─────────────────────────────────────

const ModalShell = ({ onClose, width, children }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  // Esc-to-close + body scroll lock — lightweight UX parity with the
  // live dashboard without pulling in a modal library.
  useModalEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'color-mix(in oklch, var(--ink) 72%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? 12 : 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width || 520,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          boxShadow: 'var(--shadow)',
          padding: isMobile ? 20 : 28,
          maxHeight: '92vh', overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
};

const ModalHeader = ({ title, sub, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16, marginBottom: 18,
  }}>
    <div style={{ minWidth: 0 }}>
      <div className="display" style={{
        fontSize: 22, color: 'var(--tx-hi)', letterSpacing: '-0.02em', margin: 0,
      }}>
        {title}
      </div>
      {sub && (
        <p style={{
          font: '400 13px/1.5 var(--font-ui)', color: 'var(--tx-md)',
          margin: '8px 0 0', maxWidth: 440,
        }}>{sub}</p>
      )}
    </div>
    <button
      onClick={onClose}
      aria-label="Close"
      style={{
        flexShrink: 0, width: 30, height: 30, borderRadius: 8,
        border: '1px solid var(--line)', background: 'var(--bg-3)',
        color: 'var(--tx-md)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: '600 16px var(--font-ui)', lineHeight: 1,
      }}
    >×</button>
  </div>
);

// ── BuyAnalysisModal ─────────────────────────────────────────
// Two flavors, mirrored from live:
//   - Pro with quota exceeded: show single + bundle, no upgrade CTA
//   - Free / no subscription:  show single only, add "Want unlimited?" CTA
// Free-tier users intentionally do NOT see the 4-pack (live rule).

const OptionCard = ({ price, label, desc, bestValue, onClick, featured }) => (
  <a
    href="#"
    onClick={(e) => { e.preventDefault(); onClick?.(); }}
    style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: 18,
      borderRadius: 14,
      background: featured
        ? 'color-mix(in oklch, var(--signal-eff) 10%, var(--bg-3))'
        : 'var(--bg-3)',
      border: featured
        ? '1.5px solid var(--signal-eff)'
        : '1px solid var(--line)',
      textDecoration: 'none', color: 'var(--tx-hi)',
      cursor: 'pointer',
      position: 'relative',
      transition: 'transform 0.12s',
    }}
    onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.99)'; }}
    onMouseUp={(e)   => { e.currentTarget.style.transform = 'scale(1)'; }}
    onMouseLeave={(e)=> { e.currentTarget.style.transform = 'scale(1)'; }}
  >
    {bestValue && (
      <span style={{
        position: 'absolute', top: -10, right: 14,
        font: '700 10px var(--font-ui)', letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: 'var(--signal-eff)', color: 'var(--ink)',
        padding: '3px 8px', borderRadius: 6,
      }}>
        {bestValue}
      </span>
    )}
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
    }}>
      <span style={{ font: '600 14px var(--font-ui)', color: 'var(--tx-hi)' }}>{label}</span>
      <span className="mono" style={{
        font: '700 18px var(--font-mono)', color: 'var(--tx-hi)',
      }}>{price}</span>
    </div>
    <span style={{ font: '400 12px var(--font-ui)', color: 'var(--tx-md)' }}>{desc}</span>
  </a>
);

const BuyAnalysisModal = ({
  locale = 'en',
  isPro = false,
  quotaExceeded = false,
  authUserId,
  email,
  onBeforeCheckout,  // v00.16: called right before opening Stripe (arms return-poll)
  onClose,
}) => {
  const R = window.PA_REQUESTS;
  if (!R) return null;

  // Title + description logic mirrors live index.html:19471-19490.
  // Pro quota-exceeded -> "Analysis Quota Reached" / "modal_buy_more" flavor
  // Free / try          -> "Try a Race Analysis" flavor
  const title = isPro
    ? t('modal_buy_more', locale)
    : t('modal_try_analysis', locale);

  const desc = isPro
    ? (quotaExceeded ? t('modal_quota_desc', locale) : t('modal_buy_more_desc', locale))
    : t('modal_try_desc', locale);

  const singleUrl = R.buildStripeUrl(R.STRIPE_LINKS.extra,  { authUserId, email });
  const bundleUrl = R.buildStripeUrl(R.STRIPE_LINKS.bundle, { authUserId, email });
  const proUrl    = R.buildStripeUrl(R.STRIPE_LINKS.pro,    { authUserId, email });

  // Arm the Stripe-return poll BEFORE opening the tab so the
  // visibilitychange listener has the flag set when the user comes
  // back. Then close the modal so the Deck is what they return to.
  const open = (url) => {
    try { onBeforeCheckout?.(); } catch (_) {}
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
    onClose?.();
  };

  return (
    <ModalShell onClose={onClose} width={520}>
      <ModalHeader title={title} sub={desc} onClose={onClose}/>

      {/* Quota-reached callout — only when a Pro user actually hit the wall */}
      {isPro && quotaExceeded && (
        <div style={{
          padding: '12px 14px',
          borderRadius: 10,
          background: 'color-mix(in oklch, var(--flag-eff) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--flag-eff) 30%, transparent)',
          color: 'var(--flag-eff)',
          font: '600 12px var(--font-ui)',
          marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="flame" size={14}/>
          {t('modal_quota_title', locale)}
        </div>
      )}

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <OptionCard
          price={t('modal_buy_single_price', locale)}
          label={t('modal_buy_single_label', locale)}
          desc={t('modal_buy_single_desc', locale)}
          onClick={() => open(singleUrl)}
        />
        {/* 4-pack: Pro only (intentional live rule — free users don't see bundle) */}
        {isPro && (
          <OptionCard
            price={t('modal_buy_bundle_price', locale)}
            label={t('modal_buy_bundle_label', locale)}
            desc={t('modal_buy_bundle_desc', locale)}
            bestValue={t('modal_best_value', locale)}
            featured
            onClick={() => open(bundleUrl)}
          />
        )}
      </div>

      {/* Footer — permanence / viewing-window note */}
      <p style={{
        font: '400 11px var(--font-ui)', color: 'var(--tx-lo)',
        margin: '14px 0 0', textAlign: 'center',
      }}>
        {t('modal_never_expire', locale)}
        {!isPro ? ' · ' + t('modal_data_viewable', locale) : ''}
      </p>

      {/* Free -> Pro upsell — exactly the live dashboard's placement */}
      {!isPro && (
        <div style={{
          marginTop: 20, paddingTop: 18,
          borderTop: '1px solid var(--line-soft)',
          display: 'flex', flexDirection: 'column', gap: 10,
          alignItems: 'center',
        }}>
          <span style={{
            font: '500 12px var(--font-ui)', color: 'var(--tx-md)', textAlign: 'center',
          }}>
            {t('modal_want_unlimited', locale)}
          </span>
          <button
            onClick={() => open(proUrl)}
            className="btn-signal"
            style={{
              background: 'var(--signal-eff)', color: 'var(--ink)',
              border: 'none', padding: '10px 16px', borderRadius: 10,
              font: '700 13px var(--font-ui)', cursor: 'pointer',
              width: 'auto',
            }}
          >
            {t('modal_subscribe_pro', locale)}
          </button>
        </div>
      )}

      {/* Dismiss */}
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--tx-lo)', font: '500 12px var(--font-ui)',
            cursor: 'pointer', padding: 6,
          }}
        >
          {t('modal_maybe_later', locale)}
        </button>
      </div>
    </ModalShell>
  );
};

// ── UploadModal (skeleton only in v00.15) ────────────────────
// Fields are wired for state; submit is disabled with a clear
// note that the real write lands in v00.16. This keeps the UI
// shape visible for feedback without violating the read-only
// prototype rule.

const Field = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span style={{
      font: '600 11px var(--font-ui)', letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--tx-lo)',
    }}>{label}</span>
    {children}
  </label>
);

const inputStyle = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--bg-3)',
  color: 'var(--tx-hi)',
  font: '500 13px var(--font-ui)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const UploadModal = ({ onClose, athleteUuid, athleteName, athleteEmail, prefill }) => {
  const isMobile = (window.useIsMobile || (() => false))();
  const t = (window.useT || (() => (k) => k))();
  // v01.29 — accept an optional `prefill` payload so the failed-row
  // Retry button on YourRequestsCard can drop the user into the
  // upload modal with the prior request's metadata already populated.
  // file is always reset (a retry needs a fresh video).
  const [form, setForm] = useModalState({
    file: null,
    eventName: prefill?.eventName || '',
    eventDate: prefill?.eventDate || '',
    distance:  prefill?.distance  || '',
    style:     prefill?.style     || '',
    course:    prefill?.course    || 'LCM',
    lane:      prefill?.lane      || '',
    notes:     prefill?.notes     || '',
  });
  const [busy,     setBusy]     = useModalState(false);
  const [progress, setProgress] = useModalState(0);
  const [phase,    setPhase]    = useModalState('');
  const [err,      setErr]      = useModalState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // v01.16 — required-field validation per locked Q7.
  // All metadata fields except eventName + notes are required for
  // submit. Submit button stays disabled until valid + not busy.
  const isValid =
    !!form.file &&
    !!form.eventDate &&
    !!form.distance &&
    !!form.style &&
    !!form.course &&
    !!form.lane;

  const onSubmit = async () => {
    if (!isValid || busy) return;
    setBusy(true); setErr(null); setProgress(0); setPhase('Starting…');
    const { ok, requestUuid, error } = await window.PA_REQUESTS.submitRaceRequest({
      file: form.file,
      metadata: {
        eventName: form.eventName,
        eventDate: form.eventDate,
        distance:  form.distance,
        style:     form.style,
        course:    form.course,
        lane:      form.lane,
        notes:     form.notes,
      },
      athleteUuid, athleteName, athleteEmail,
      onProgress: (pct, label) => { setProgress(pct); if (label) setPhase(label); },
    });
    setBusy(false);
    if (!ok) {
      setErr(error?.message || 'Upload failed.');
      return;
    }
    // Notify rest of the app — YourRequestsCard, sidebar pending
    // badge, and any other consumer of the requests stream picks
    // up the new row via useRequests' refresh on this event.
    try { window.dispatchEvent(new CustomEvent('pa:profile-changed')); } catch (_) {}
    onClose?.({ submitted: true, requestUuid });
  };

  return (
    <ModalShell onClose={busy ? undefined : onClose} width={560}>
      <ModalHeader
        title="Request Race Analysis"
        sub="Upload your race video and tell us about it. We'll email you when the analysis is ready."
        onClose={busy ? undefined : onClose}
      />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Video file">
            <input
              type="file" accept="video/*"
              onChange={(e) => set('file', e.target.files?.[0] || null)}
              style={{ ...inputStyle, padding: '8px 10px' }}
            />
            {/* v01.29 — file format hint, mirrors live's
                "MP4, MOV up to 500MB" under the upload button.
                Translation key shared with the dashboard's
                YourRequestsCard area. */}
            <span style={{
              display: 'block', marginTop: 4,
              font: '500 11px var(--font-ui)', color: 'var(--tx-lo)',
            }}>
              {t('deck.requests.fileHint')}
            </span>
          </Field>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Event name (optional)">
            <input type="text" value={form.eventName} placeholder="e.g. Regional Championships"
              onChange={(e) => set('eventName', e.target.value)} style={inputStyle}/>
          </Field>
        </div>
        <Field label="Event date">
          <input type="date" value={form.eventDate}
            onChange={(e) => set('eventDate', e.target.value)} style={inputStyle}/>
        </Field>
        <Field label="Course">
          <select value={form.course}
            onChange={(e) => set('course', e.target.value)} style={inputStyle}>
            <option value="LCM">LCM</option>
            <option value="SCM">SCM</option>
            <option value="SCY">SCY</option>
          </select>
        </Field>
        <Field label="Distance (m)">
          <input type="number" min="25" step="25" value={form.distance}
            onChange={(e) => set('distance', e.target.value)} style={inputStyle}/>
        </Field>
        <Field label="Style">
          <select value={form.style}
            onChange={(e) => set('style', e.target.value)} style={inputStyle}>
            <option value="">Select…</option>
            <option value="freestyle">Freestyle</option>
            <option value="backstroke">Backstroke</option>
            <option value="breaststroke">Breaststroke</option>
            <option value="butterfly">Butterfly</option>
            <option value="medley">Medley</option>
          </select>
        </Field>
        <Field label="Lane">
          <input type="number" min="1" max="10" required value={form.lane}
            onChange={(e) => set('lane', e.target.value)} style={inputStyle}/>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Notes for your analyst (optional)">
            <textarea rows={3} value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}/>
          </Field>
        </div>
      </div>

      {/* Progress + status — v01.16. Renders only while busy.
          The pct is driven by submitRaceRequest's onProgress
          callback (preparing → uploading → saving → notifying). */}
      {busy && (
        <div style={{ marginTop: 18 }}>
          <div style={{
            height: 8, borderRadius: 999,
            background: 'var(--bg-3)', overflow: 'hidden',
          }}>
            <div style={{
              width: progress + '%', height: '100%',
              background: 'var(--signal-eff)',
              transition: 'width 0.2s ease',
            }}/>
          </div>
          <div style={{
            marginTop: 8,
            font: '500 12px var(--font-ui)',
            color: 'var(--tx-md)',
          }}>
            {phase || 'Uploading…'}
          </div>
        </div>
      )}

      {err && (
        <p style={{
          font: '500 12px var(--font-ui)',
          color: 'var(--flag-eff)',
          margin: '14px 0 0',
          lineHeight: 1.4,
        }}>{err}</p>
      )}

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20,
      }}>
        <button
          onClick={() => onClose?.()}
          disabled={busy}
          style={{
            background: 'transparent', border: '1px solid var(--line)',
            color: 'var(--tx-md)', padding: '10px 14px', borderRadius: 10,
            font: '600 12px var(--font-ui)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}
        >Cancel</button>
        <button
          onClick={onSubmit}
          disabled={!isValid || busy}
          style={{
            background: 'var(--signal-eff)', color: 'var(--ink)', border: 'none',
            padding: '10px 16px', borderRadius: 10,
            font: '700 13px var(--font-ui)',
            cursor: (!isValid || busy) ? 'not-allowed' : 'pointer',
            opacity: (!isValid || busy) ? 0.5 : 1,
          }}
        >{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </ModalShell>
  );
};

// ── Expose ───────────────────────────────────────────────────

Object.assign(window, {
  BuyAnalysisModal, UploadModal, REQ_I18N,
});

try { console.log('[request-modals] loaded (v01.29)'); } catch (_) {}
