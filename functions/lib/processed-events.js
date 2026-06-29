// Atomic event-dedup for webhook idempotency, backed by D1 (amari-attendance
// database, binding ATTEND_DB). Replaces the racy KV read-then-write pattern.
//
// KV is eventually consistent: two concurrent requests can both pass the
// "already processed?" read before either write completes, causing double-credit.
// D1 INSERT ON CONFLICT(event_id) DO NOTHING is atomic — only one caller gets
// changes=1 and proceeds; the other gets changes=0 and is turned away immediately.
//
// Callers that don't have ATTEND_DB bound (test environments, local dev) receive
// null and fall back to the legacy KV path.

function changesOf(runResult) {
  return runResult?.meta?.changes ?? runResult?.changes ?? 0;
}

/**
 * Attempt to claim an event for processing.
 *
 * Returns:
 *   { ok: true }                  — claim won; caller should process
 *   { ok: false, duplicate: true } — already claimed; caller should return 200 early
 *   null                           — db not available; caller should fall back to KV
 */
export async function claimProcessedEvent(db, eventId) {
  if (!db || !eventId) return null;
  const res = await db
    .prepare(
      "INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?) ON CONFLICT(event_id) DO NOTHING",
    )
    .bind(eventId, new Date().toISOString())
    .run();
  return changesOf(res) === 1
    ? { ok: true }
    : { ok: false, duplicate: true };
}
