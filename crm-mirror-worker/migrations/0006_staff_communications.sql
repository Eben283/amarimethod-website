-- Staff-owned communications workspace.  GHL is initially a read source, but
-- these records are the durable application model rather than a cached UI list.
CREATE TABLE IF NOT EXISTS communication_threads (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'mixed')),
  last_event_at TEXT,
  last_preview TEXT,
  last_direction TEXT CHECK (last_direction IN ('inbound', 'outbound', 'unknown')),
  unread_inbound_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_inbound_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_thread_id)
);
CREATE INDEX IF NOT EXISTS idx_threads_contact_activity ON communication_threads(contact_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_inbox ON communication_threads(unread_inbound_count DESC, last_event_at DESC);

CREATE TABLE IF NOT EXISTS communication_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES communication_threads(id) ON DELETE SET NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('email', 'sms', 'call', 'appointment', 'note', 'payment')),
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  delivery_status TEXT,
  subject TEXT,
  body_clean TEXT,
  occurred_at TEXT NOT NULL,
  sender_label TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_events_contact_timeline ON communication_events(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_thread_timeline ON communication_events(thread_id, occurred_at DESC);
