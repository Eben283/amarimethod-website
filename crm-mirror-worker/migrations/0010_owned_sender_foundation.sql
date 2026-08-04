-- Reserved for the future staff-owned sender. This migration intentionally
-- creates no provider connection, queued job, compose action, or send path.
-- Rows are append-only evidence of a future, staff-initiated delivery attempt.
CREATE TABLE IF NOT EXISTS outbound_delivery_attempts (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  provider TEXT NOT NULL,
  consent_state TEXT NOT NULL CHECK (consent_state IN ('granted', 'revoked', 'unknown')),
  policy_state TEXT NOT NULL CHECK (policy_state IN ('eligible', 'blocked')),
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_delivery_attempts_contact
  ON outbound_delivery_attempts(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbound_delivery_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES outbound_delivery_attempts(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_delivery_events_attempt
  ON outbound_delivery_events(attempt_id, occurred_at ASC);
