-- Evidence for a trustworthy read-only mirror. None of these tables drive a
-- sender, a booking write, or a session-ledger entry.

CREATE TABLE IF NOT EXISTS mirror_sync_cycles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('ghl', 'stripe')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  known_records INTEGER NOT NULL DEFAULT 0,
  missing_records INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_mirror_sync_cycles_provider
  ON mirror_sync_cycles(provider, started_at DESC);

CREATE TABLE IF NOT EXISTS payment_identity_exceptions (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('metadata_contact_email_conflict', 'unlinked_charge')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'not_an_issue')),
  detail_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_identity_exceptions_state
  ON payment_identity_exceptions(state, detected_at DESC);

CREATE TABLE IF NOT EXISTS mirror_recovery_checks (
  id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL CHECK (strategy = 'd1_time_travel'),
  bookmark TEXT,
  checked_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ready', 'failed')),
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_recovery_checks_recent
  ON mirror_recovery_checks(checked_at DESC);

CREATE TABLE IF NOT EXISTS mirror_health_events (
  id TEXT PRIMARY KEY,
  health_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('healthy', 'review', 'failed')),
  detail TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (health_key, detected_at)
);
CREATE INDEX IF NOT EXISTS idx_mirror_health_events_open
  ON mirror_health_events(resolved_at, detected_at DESC);

ALTER TABLE purchases ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE purchases ADD COLUMN ghl_invoice_id TEXT;
ALTER TABLE purchases ADD COLUMN ghl_transaction_id TEXT;
