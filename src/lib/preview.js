/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   PA_PREVIEW — Preview Pro mode (v01.50)

   Lets a free user temporarily experience Pro features (compare,
   full session history, video, etc.) using a hardcoded sample
   dataset. Sells the Pro tier by SHOWING what's locked instead
   of just saying "this is locked."

   Entry points (set by various components):
     - Empty state on Races / Starts / Turns ("Preview with sample data")
     - Session lock strip ("Try preview")
     - Compare gate toast ("Try compare in preview")
     - Account modal subscription tab (optional)

   When preview is on:
     - Consumer pages swap their real trials for the sample
       dataset (PA_SAMPLE.* — see src/lib/sample-data.js)
     - Pro gates treat the user as Pro
     - A persistent banner renders at the top of the page
     - Real session state is untouched; exiting reverts cleanly

   Single-state module — preview is global (one mode at a time).
   No persistence — exits on page reload.
   ─────────────────────────────────────────────────────────── */

(function () {
  let _on = false;

  function isOn() { return _on; }

  function enter() {
    if (_on) return;
    _on = true;
    try {
      window.dispatchEvent(new CustomEvent('pa:preview-changed', {
        detail: { on: true },
      }));
    } catch (_) {}
    try { console.log('[PA_PREVIEW] entered preview mode'); } catch (_) {}
  }

  function exit() {
    if (!_on) return;
    _on = false;
    try {
      window.dispatchEvent(new CustomEvent('pa:preview-changed', {
        detail: { on: false },
      }));
    } catch (_) {}
    try { console.log('[PA_PREVIEW] exited preview mode'); } catch (_) {}
  }

  // React hook helper — components read this to subscribe.
  // Returns the current bool and re-renders on pa:preview-changed.
  function usePreview() {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const onChange = () => bump((n) => n + 1);
      window.addEventListener('pa:preview-changed', onChange);
      return () => window.removeEventListener('pa:preview-changed', onChange);
    }, []);
    return _on;
  }

  // ── Expose ──────────────────────────────────────────────
  window.PA_PREVIEW = {
    isOn, enter, exit, usePreview,
  };

  try { console.log('[PA_PREVIEW] loaded (v01.50)'); } catch (_) {}
})();
