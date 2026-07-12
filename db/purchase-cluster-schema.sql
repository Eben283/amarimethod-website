-- Purchase-cluster tables (GHL exit Unit C) — apply to the SHARED amari-automation D1 (the
-- same database as reminder-engine-worker/schema.sql + nurture-engine-worker/schema.sql).
--   npx wrangler d1 execute amari-automation --remote --file=db/purchase-cluster-schema.sql
-- Consumers: functions/lib/upgrade-offer.js + functions/lib/purchase-confirmations.js (Pages
-- Functions) and series-reconcile-worker (hourly due sweep). Binding both sides: AUTOMATION_DB.

-- Post-Initial Upgrade Offer timers. Write-once per contact: sessions_completed crosses 0→1
-- once in a lifetime.
CREATE TABLE IF NOT EXISTS upgrade_offer_timers (
  contact_id   TEXT PRIMARY KEY,
  scheduled_at INTEGER NOT NULL,
  due_at       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' -- pending | cancelled | sent | would_send | suppressed | failed
);
CREATE INDEX IF NOT EXISTS idx_offer_due ON upgrade_offer_timers (status, due_at);

-- Purchase confirmation ledger — doubles as the idempotency claim (PK ref: one confirmation
-- per order/invoice, webhook retries can't double-send) and the observability row.
CREATE TABLE IF NOT EXISTS purchase_confirmations (
  ref         TEXT PRIMARY KEY,   -- order id / invoice ref, namespaced by source
  contact_id  TEXT NOT NULL,
  series_type TEXT,
  status      TEXT NOT NULL DEFAULT 'would_send', -- would_send | sent | failed | no_template
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_confirm_contact ON purchase_confirmations (contact_id, ts);
