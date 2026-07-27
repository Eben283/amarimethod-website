ALTER TABLE ledger_cutover_candidates ADD COLUMN ledger_activated_at TEXT;

PRAGMA foreign_keys = OFF;

CREATE TABLE session_ledger_entries_new (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('cutover_opening_balance', 'purchase_credit', 'attendance_debit', 'manual_adjustment', 'refund_reversal')),
  credits INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

INSERT INTO session_ledger_entries_new
  (id, contact_id, purchase_id, appointment_id, entry_type, credits, reason, created_by, source_key, created_at)
SELECT id, contact_id, purchase_id, appointment_id, entry_type, credits, reason, created_by, source_key, created_at
FROM session_ledger_entries;

DROP TABLE session_ledger_entries;
ALTER TABLE session_ledger_entries_new RENAME TO session_ledger_entries;
CREATE INDEX idx_ledger_contact ON session_ledger_entries(contact_id, created_at);

PRAGMA foreign_keys = ON;
