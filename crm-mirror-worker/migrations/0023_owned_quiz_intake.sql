-- Provider-neutral Pain Pattern Quiz intake (schema step 0023).
-- Normalized submissions are retained as source evidence for 400 days; current contact facts
-- are projected separately under source `owned:quiz` so GHL imports cannot overwrite them.

CREATE TABLE IF NOT EXISTS quiz_intake_submissions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'
  ),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  normalized_json TEXT NOT NULL CHECK (json_valid(normalized_json)),
  submitted_at TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (retention_until > submitted_at)
);

CREATE INDEX IF NOT EXISTS idx_quiz_intake_contact
  ON quiz_intake_submissions(contact_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_intake_retention
  ON quiz_intake_submissions(retention_until);

CREATE TRIGGER IF NOT EXISTS quiz_intake_submissions_no_update
BEFORE UPDATE ON quiz_intake_submissions
BEGIN SELECT RAISE(ABORT, 'quiz intake submissions are append-only'); END;
