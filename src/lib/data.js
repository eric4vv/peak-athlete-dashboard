/* ───────────────────────────────────────────────────────────
   Peak Athlete · Performance Lab v03 prototype
   Data layer — RLS-safe read helpers

   All Supabase reads for the prototype live here. Each function
   goes through a confirmed RLS-filtered view (v_race_kpis,
   v_start_kpis, v_turn_kpis, v_race_trials, v_athlete_sessions)
   or a properly-scoped table. The caller always passes an
   explicit athleteUuid — no implicit session magic in this file.

   Read-only. No inserts, no updates, no RPC side effects.
   Returns { data, error } to match Supabase idiom.

   Exposed as window.PA_DATA.
   ─────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const supa = () => window.supabaseClient;

  // ── Races (v_race_kpis) ──────────────────────────────────────
  // Surface used by the live dashboard. Columns:
  //   athlete_uuid, race_time_s, style, distance_m, source_date, course

  async function listRaces(athleteUuid, opts) {
    if (!athleteUuid) return { data: [], error: null };
    const limit = (opts && opts.limit) || 50;
    // v01.68 — wrapped in withRecovery() so a stuck supabase client
    // gets a refresh-and-retry rather than hanging the Races tab.
    const exec = () => supa()
      .from('v_race_kpis')
      .select('athlete_uuid, race_time_s, style, distance_m, source_date, course')
      .eq('athlete_uuid', athleteUuid)
      .not('race_time_s', 'is', null)
      .order('source_date', { ascending: false })
      .limit(limit);
    const recover = window.PA_AUTH?.withRecovery;
    const { data, error } = recover
      ? await recover(exec, { label: 'v_race_kpis listRaces' })
      : await exec();
    return { data: data || [], error };
  }

  async function latestRaces(athleteUuid, opts) {
    const limit = (opts && opts.limit) || 6;
    return listRaces(athleteUuid, { limit });
  }

  // Optional filter to races matching the athlete's most recent event
  // (same distance + style). Useful for a "your recent 100 free" view.
  function filterSameEvent(rows, event) {
    if (!event) return rows;
    return (rows || []).filter(r =>
      r.distance_m === event.distance_m && r.style === event.style);
  }

  // ── Starts / Turns (stubs for Phase 2) ───────────────────────

  async function listStarts(athleteUuid, opts) {
    if (!athleteUuid) return { data: [], error: null };
    const limit = (opts && opts.limit) || 50;
    const { data, error } = await supa()
      .from('v_start_kpis')
      .select('*')
      .eq('athlete_uuid', athleteUuid)
      .order('source_date', { ascending: false })
      .limit(limit);
    return { data: data || [], error };
  }

  async function listTurns(athleteUuid, opts) {
    if (!athleteUuid) return { data: [], error: null };
    const limit = (opts && opts.limit) || 50;
    const { data, error } = await supa()
      .from('v_turn_kpis')
      .select('*')
      .eq('athlete_uuid', athleteUuid)
      .order('source_date', { ascending: false })
      .limit(limit);
    return { data: data || [], error };
  }

  // ── Mappers (raw Supabase rows → shapes analytics expects) ───

  // v_race_kpis row → { date, value, event, course, raw }
  // value is race_time_s (seconds).
  function toRaceMetricRows(rows) {
    return (rows || []).map(r => ({
      date:   r.source_date,
      value:  r.race_time_s,
      event:  fmtEvent(r.distance_m, r.style),
      course: r.course || null,
      raw:    r,
    }));
  }

  function fmtEvent(distance_m, style) {
    if (!distance_m || !style) return null;
    // Capitalize first letter for display: "freestyle" → "Freestyle"
    const pretty = style.charAt(0).toUpperCase() + style.slice(1);
    return distance_m + ' ' + pretty;
  }

  // ── Expose ───────────────────────────────────────────────────

  window.PA_DATA = {
    listRaces,
    latestRaces,
    listStarts,
    listTurns,
    filterSameEvent,
    toRaceMetricRows,
    fmtEvent,
  };
})();
