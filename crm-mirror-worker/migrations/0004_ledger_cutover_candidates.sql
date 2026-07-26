CREATE TABLE IF NOT EXISTS ledger_cutover_candidates (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source = 'ghl_imported_sessions_remaining'),
  proposed_credits INTEGER NOT NULL CHECK (proposed_credits > 0),
  source_updated_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (state IN ('pending_review', 'approved', 'rejected')),
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_cutover_candidates_state
  ON ledger_cutover_candidates(state, updated_at DESC);
