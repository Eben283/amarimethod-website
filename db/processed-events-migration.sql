-- D1 migration: processed_events table for atomic webhook idempotency.
--
-- Replaces the racy KV read-then-write pattern in ghl-purchase-webhook.js and
-- ghl-invoice-webhook.js. Two concurrent requests can both pass a KV read-before-write
-- check; D1 INSERT ON CONFLICT is atomic, so only one caller ever wins.
--
-- Applied to: amari-attendance database (binding ATTEND_DB).
-- Apply with:
--   npx wrangler d1 execute amari-attendance --remote --file=db/processed-events-migration.sql

CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,  -- e.g. "order:<orderId>" or "invoice:<invoiceId>"
  processed_at TEXT NOT NULL      -- ISO timestamp of first processing
);
