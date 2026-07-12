// Cron schedule declarations for this worker — the single source that the
// scheduled() handler AND the cron-decl test both read, so the code's cron
// strings can never silently drift from wrangler.toml again.
//
// Why this module exists: the full-reconcile guard used to compare event.cron
// against a hardcoded "0 */3 * * *" that matched NEITHER real cron, so every
// 3-hourly run did a full reconcile (rescan + transcribe batch 20 not 8) for
// weeks before it was caught (todo ih32, fixed 2026-07-11). schedule.test.js
// asserts these constants match wrangler.toml, which would have caught it.

export const INCREMENTAL_CRON = "30 */3 * * *"; // cheap incremental sync, every 3h
export const WEEKLY_FULL_CRON = "30 2 * * 1";   // full reconcile (drift insurance), Mondays

// The Monday weekly cron does a FULL reconcile; the 3-hourly cron does the cheap
// incremental sync. Keyed against the INCREMENTAL cron (not the weekly one) so a
// future change to the weekly schedule's exact time can't silently disable the
// full reconcile again.
export function isFullReconcile(cron) {
  return cron !== INCREMENTAL_CRON;
}
