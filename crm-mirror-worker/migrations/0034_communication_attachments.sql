-- Private provider attachment locators for mirrored communication events.
-- The Client Desk receives only opaque attachment IDs. Provider URLs remain
-- server-side and are resolved behind the existing authenticated Desk session.
CREATE TABLE IF NOT EXISTS communication_event_attachments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES communication_events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('ghl', 'gmail')),
  provider_locator TEXT NOT NULL,
  display_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 26214400)),
  position INTEGER NOT NULL CHECK (position >= 0 AND position < 10),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, position)
);
CREATE INDEX IF NOT EXISTS idx_communication_attachments_event
  ON communication_event_attachments(event_id, position);
