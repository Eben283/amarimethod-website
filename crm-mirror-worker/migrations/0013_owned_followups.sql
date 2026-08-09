CREATE TABLE IF NOT EXISTS owned_followups (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_on TEXT NOT NULL,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  completed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_owned_followups_worklist
  ON owned_followups(completed_at, due_on, created_at);

CREATE INDEX IF NOT EXISTS idx_owned_followups_contact
  ON owned_followups(contact_id, completed_at, due_on);
