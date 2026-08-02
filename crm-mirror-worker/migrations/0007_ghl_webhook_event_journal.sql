CREATE TABLE IF NOT EXISTS ghl_webhook_events (
  webhook_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  contact_external_id TEXT,
  conversation_external_id TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  processing_state TEXT NOT NULL CHECK (processing_state IN ('projected', 'observed', 'ignored'))
);
CREATE INDEX IF NOT EXISTS idx_ghl_webhook_events_contact ON ghl_webhook_events(contact_external_id, received_at DESC);
