// Atomic per-appointment debit claim, backed by D1 (amari-attendance database,
// binding ATTEND_DB). This replaces the racy KV "attended-debited" flag in
// staff-mark-attended.js.
//
// The bug it fixes: the KV flag was read-then-act on eventually-consistent KV, so
// two near-simultaneous mark-attended calls for the same appointment (dashboard tap
// + SMS-triggered flow, or a double-tap) both read the flag as absent and both
// decremented sessions_remaining — silently dropping a client's prepaid balance by 2
// for one visit. KV has no atomic compare-and-set, so it cannot prevent this.
//
// D1 is strongly consistent, and `INSERT ... ON CONFLICT(appointment_id) DO NOTHING`
// is atomic: of two concurrent inserts on the same PRIMARY KEY, exactly one reports
// changes=1 (it won the claim) and the other changes=0 (already claimed). The winner
// applies the count; the loser is turned away. True compare-and-set.
//
// Rollout-safe: callers pass env.ATTEND_DB and fall back to the legacy KV flag when
// it's absent (binding not yet set, or local dev) — see staff-mark-attended.js.

function changesOf(runResult) {
  // D1's .run() returns { success, meta: { changes, ... } }. Be defensive across
  // shapes so a changed return type can't silently read as "didn't claim".
  return runResult?.meta?.changes ?? runResult?.changes ?? 0;
}

// Try to claim the debit for this appointment. Returns true iff THIS call won the
// claim (caller should proceed to apply the count). Returns false iff the row already
// existed (another call already claimed/applied — caller should treat as already done).
export async function claimDebit(db, appointmentId, contactId) {
  const res = await db
    .prepare(
      "INSERT INTO attended_debits (appointment_id, contact_id, claimed_at) " +
        "VALUES (?, ?, ?) ON CONFLICT(appointment_id) DO NOTHING",
    )
    .bind(appointmentId, contactId || null, new Date().toISOString())
    .run();
  return changesOf(res) === 1;
}

// Release a claim after the count write FAILED, so a retry can re-claim and re-apply.
// This preserves the "appointment marked showed but count never applied → re-apply on
// retry instead of being permanently stuck" semantics the KV flag had.
export async function releaseDebit(db, appointmentId) {
  await db
    .prepare("DELETE FROM attended_debits WHERE appointment_id = ?")
    .bind(appointmentId)
    .run();
}

// Stamp the applied result onto the claim row (observability + parity with the old
// KV record's { at, completed, remaining } payload). Best-effort.
export async function finalizeDebit(db, appointmentId, completed, remaining) {
  await db
    .prepare(
      "UPDATE attended_debits SET applied_at = ?, completed = ?, remaining = ? WHERE appointment_id = ?",
    )
    .bind(new Date().toISOString(), completed, remaining, appointmentId)
    .run();
}

// Read-only: has this appointment already been debited? Used for the fast-path
// idempotency check before the atomic claim (the claim itself is the real gate).
export async function isDebited(db, appointmentId) {
  const row = await db
    .prepare("SELECT 1 FROM attended_debits WHERE appointment_id = ?")
    .bind(appointmentId)
    .first();
  return !!row;
}
