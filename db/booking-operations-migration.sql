-- Durable appointment operation state for Portal and paid-booking handoffs.
-- Apply to the ATTEND_DB / amari-attendance D1 database before deploying code
-- that requires this table.
CREATE TABLE IF NOT EXISTS booking_operations (
  op_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'retryable', 'completed', 'manual_review')),
  appointment_id TEXT,
  result_json TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_booking_operations_status_lease
  ON booking_operations(status, lease_until);

CREATE TABLE IF NOT EXISTS paid_booking_intents (
  intent_id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'bound', 'completed', 'manual_review')),
  order_id TEXT UNIQUE,
  appointment_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paid_booking_intents_match
  ON paid_booking_intents(contact_id, product_id, status, created_at, expires_at);
