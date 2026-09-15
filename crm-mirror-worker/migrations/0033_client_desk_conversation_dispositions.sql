-- Staff-owned work state for a complete mirrored conversation. The disposition
-- is anchored to the latest event observed when Staff acts; a later event does
-- not inherit the old resolution and therefore returns to normal triage.
CREATE TABLE IF NOT EXISTS client_desk_conversation_dispositions (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('done', 'spam')),
  resolved_thread_id TEXT NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,
  resolved_event_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_desk_dispositions_state
  ON client_desk_conversation_dispositions(state, updated_at DESC);
