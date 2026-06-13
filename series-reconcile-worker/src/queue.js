// Pure helpers for the active-series field-sync sweep queue.
//
// The drift fix: the field-sync used to only run on contacts pulled from the
// last-24h orders window (index.js), so a mid-package client who buys once and
// draws down over weeks (no new orders) was never re-synced and drifted
// permanently (Danny's case). Instead we keep a KV queue of ALL active-series
// contacts and chip through it a chunk per hourly run, rebuilding when stale —
// the same chunk-queue pattern as partner-activity-refresh.
//
// These functions are pure (no KV / no GHL) so the chunk + rebuild logic is
// unit-tested; the I/O lives in index.js.

// Take the next `size` ids off the front of the queue.
export function nextChunk(queue, size) {
  const q = Array.isArray(queue) ? queue : [];
  const n = Math.max(0, Math.floor(size) || 0);
  return { chunk: q.slice(0, n), remaining: q.slice(n) };
}

// Stale = missing, empty, no generation timestamp, or older than ttlMs.
// A stale queue triggers a rebuild from GHL.
export function isQueueStale(queue, generatedAtMs, nowMs, ttlMs) {
  if (!Array.isArray(queue) || queue.length === 0) return true;
  // Missing timestamp (KV returns null on first run) → rebuild. Guard before
  // Number(), since Number(null) is 0 (would read as "generated at epoch 0").
  if (generatedAtMs === null || generatedAtMs === undefined || generatedAtMs === "") return true;
  const gen = Number(generatedAtMs);
  if (!Number.isFinite(gen)) return true;
  return nowMs - gen >= ttlMs;
}

// After a run, the queue to persist = the part of the chunk we did NOT get to
// (consecutive-failure abort, budget) followed by everything after the chunk.
export function remainderAfterProcessing(chunk, processedCount, rest) {
  const unprocessed = (Array.isArray(chunk) ? chunk : []).slice(
    Math.max(0, Math.floor(processedCount) || 0),
  );
  return [...unprocessed, ...(Array.isArray(rest) ? rest : [])];
}

// Build the next queue after a sweep, re-queuing contacts that ERRORED this run
// so a transient GHL failure (5xx / subrequest-budget) is retried instead of
// being dropped until the ~daily rebuild. Errored ids go to the BACK — never
// the front — so a persistently-failing contact can't dominate the chunk budget
// or starve the rest of the queue. Deduped against the base so an id can't appear
// twice (e.g. if it was both unprocessed and errored).
export function requeueAfterSweep(chunk, processedCount, rest, erroredIds) {
  const base = remainderAfterProcessing(chunk, processedCount, rest);
  const seen = new Set(base);
  const errs = [...new Set(erroredIds || [])].filter((id) => id && !seen.has(id));
  return [...base, ...errs];
}
