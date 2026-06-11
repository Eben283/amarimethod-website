-- D1 schema for the mark-attended atomic claim (amari-attendance database).
--
-- Purpose: eliminate the double-decrement race in functions/api/staff-mark-attended.js.
-- The KV "attended-debited" flag it replaced was read-then-act on eventually-consistent
-- KV, so two near-simultaneous mark-attended calls for the same appointment both passed
-- the idempotency check and both decremented sessions_remaining (e.g. 4 → 2 for one
-- visit). D1 is strongly consistent, and an INSERT on a PRIMARY KEY is atomic, so a
-- claim row gives a true compare-and-set: only the first caller wins the INSERT and
-- applies the count; the loser is turned away instantly.
--
-- Apply with:
--   npx wrangler d1 execute amari-attendance --remote --file=db/attendance-schema.sql

CREATE TABLE IF NOT EXISTS attended_debits (
  appointment_id TEXT PRIMARY KEY,   -- the claim key (one row per appointment)
  contact_id     TEXT,
  claimed_at     TEXT NOT NULL,      -- ISO timestamp when the claim was won
  applied_at     TEXT,              -- ISO timestamp when the count write succeeded (NULL until then)
  completed      INTEGER,           -- sessions_completed value written
  remaining      INTEGER            -- sessions_remaining value written
);
