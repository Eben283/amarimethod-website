CREATE TABLE IF NOT EXISTS client_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider_note_id TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  authored_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_notes_contact ON client_notes(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider_task_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  due_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_tasks_contact ON client_tasks(contact_id, completed_at, due_at);
