/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03
   Trial custom names (v03.72)

   Lets athletes / coaches / admins rename a race / start / turn
   trial to a custom label (e.g. the meet name) that overrides the
   auto-generated "800 Freestyle · LCM" title everywhere.

   Storage: the label lives in metrics_json["Custom Name"] on the
   raw row (race_raw / start_raw / turn_raw). It is WRITTEN only via
   the set_trial_custom_name() RPC — a SECURITY DEFINER function
   that re-checks ownership (same get_my_athlete_uuid / is_coach /
   is_admin helpers the SELECT RLS uses) and can touch ONLY that one
   jsonb key. It is READ via the v_trial_custom_names view
   (security_invoker = true, so the caller's RLS applies).

   The prototype never grants the client table-level UPDATE on the
   raw tables for this — the RPC is the single, narrow write surface.

   Exposed as window.PA_TRIALS.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const client = () => window.supabaseClient;

  // Valid kinds the RPC + view understand.
  const KINDS = ['race', 'start', 'turn'];

  // ── setCustomName ────────────────────────────────────────────
  // kind: 'race' | 'start' | 'turn'
  // uuid: the trial's record_uuid (race_uuid / start_uuid / turn_uuid)
  // name: new label, or '' / null to CLEAR the custom name.
  // Returns { error }. The DB trims + caps at 80 chars and clears
  // on empty, so the client doesn't have to.
  async function setCustomName(kind, uuid, name) {
    if (!KINDS.includes(kind)) return { error: new Error('invalid kind') };
    if (!uuid) return { error: new Error('missing trial id') };
    const c = client();
    if (!c) return { error: new Error('no supabase client') };
    const { error } = await c.rpc('set_trial_custom_name', {
      p_kind: kind,
      p_uuid: uuid,
      p_name: (name == null ? '' : String(name)),
    });
    if (!error) invalidate();   // next load reflects the new label
    return { error: error || null };
  }

  // ── loadCustomNames ──────────────────────────────────────────
  // One lightweight fetch of every custom name the caller can see
  // (the view only returns rows that HAVE a custom name, so this is
  // usually small or empty). Returns a Map keyed by `${kind}:${uuid}`
  // AND by bare `uuid` so callers can look up either way.
  //
  // Short in-flight + TTL cache so the race/start/turn list loaders
  // (which fire close together) share one round-trip. invalidate()
  // clears it after a rename so the new label shows on next load.
  let _cache = null;       // { map, at }
  let _inflight = null;    // Promise<Map>
  const TTL_MS = 8000;

  function invalidate() { _cache = null; _inflight = null; }

  async function _fetch() {
    const map = new Map();
    const c = client();
    if (!c) return map;
    try {
      const { data, error } = await c
        .from('v_trial_custom_names')
        .select('kind, record_uuid, custom_name');
      if (error || !data) return map;
      data.forEach(r => {
        if (!r || !r.record_uuid || !r.custom_name) return;
        map.set(r.kind + ':' + r.record_uuid, r.custom_name);
        map.set(r.record_uuid, r.custom_name);
      });
    } catch (_) { /* swallow — titles just fall back to computed */ }
    return map;
  }

  async function loadCustomNames() {
    // Note: no Date.now() ban concern here — this is the browser.
    const now = Date.now();
    if (_cache && (now - _cache.at) < TTL_MS) return _cache.map;
    if (_inflight) return _inflight;
    _inflight = _fetch().then(map => {
      _cache = { map, at: Date.now() };
      _inflight = null;
      return map;
    }).catch(() => { _inflight = null; return new Map(); });
    return _inflight;
  }

  // ── applyCustomNames ─────────────────────────────────────────
  // Folds a custom-name Map onto an array of trial rows, setting
  // `custom_name` on each that has one. `idKeys` lists the possible
  // id fields a trial row may carry (race_uuid, record_uuid, etc.).
  // Mutates a shallow copy; returns the new array.
  const ID_KEYS = ['record_uuid', 'race_uuid', 'start_uuid', 'turn_uuid'];
  function applyCustomNames(trials, map) {
    if (!Array.isArray(trials) || !map || !map.size) return trials || [];
    return trials.map(t => {
      if (!t) return t;
      for (const k of ID_KEYS) {
        const id = t[k];
        if (id && map.has(id)) {
          return Object.assign({}, t, { custom_name: map.get(id) });
        }
      }
      return t;
    });
  }

  // Resolve the id a trial carries, regardless of which view it came
  // from. Used by the rename UI to target the RPC.
  function trialId(trial) {
    if (!trial) return null;
    for (const k of ID_KEYS) {
      if (trial[k]) return trial[k];
    }
    return null;
  }

  window.PA_TRIALS = {
    setCustomName,
    loadCustomNames,
    applyCustomNames,
    invalidate,
    trialId,
  };

  try { console.log('[PA_TRIALS] loaded (v03.72)'); } catch (_) {}
})();
