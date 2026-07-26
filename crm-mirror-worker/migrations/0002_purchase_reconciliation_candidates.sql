ALTER TABLE purchases ADD COLUMN billing_email_normalized TEXT;
CREATE INDEX IF NOT EXISTS idx_purchases_billing_email ON purchases(billing_email_normalized);

-- A candidate is evidence for a possible link, not a linked purchase. No row in
-- this table changes purchases.contact_id or creates a session-ledger entry.
CREATE TABLE IF NOT EXISTS purchase_reconciliation_candidates (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  match_basis TEXT NOT NULL CHECK (match_basis IN ('unique_billing_email')),
  state TEXT NOT NULL DEFAULT 'pending_review' CHECK (state IN ('pending_review', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  UNIQUE (purchase_id, contact_id, match_basis)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_candidates_state
  ON purchase_reconciliation_candidates(state, created_at DESC);
