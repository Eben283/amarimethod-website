-- Lossless source archive for every GHL communication object observed by the
-- mirror. This table is deliberately independent of owned contacts and Staff's
-- narrower communication projection so unsupported or unmatched records are
-- retained instead of being silently discarded.
CREATE TABLE IF NOT EXISTS ghl_communication_source_records (
  provider_event_id TEXT NOT NULL,
  provider_thread_id TEXT,
  contact_external_id TEXT,
  message_type TEXT,
  direction TEXT,
  delivery_status TEXT,
  occurred_at TEXT,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider_event_id, payload_sha256)
);

CREATE INDEX IF NOT EXISTS idx_ghl_communication_source_event
  ON ghl_communication_source_records(provider_event_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ghl_communication_source_thread
  ON ghl_communication_source_records(provider_thread_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ghl_communication_source_contact
  ON ghl_communication_source_records(contact_external_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ghl_communication_source_type
  ON ghl_communication_source_records(message_type, occurred_at DESC);
