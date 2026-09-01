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

-- Durable handoff into the separate shadow nurture engine. Capture and outbox creation share
-- one D1 transaction; dispatch is leased/idempotent and never changes sequence mode or delivery.
CREATE TABLE IF NOT EXISTS quiz_nurture_dispatches (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE
    REFERENCES quiz_intake_submissions(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL
    REFERENCES contacts(id) ON DELETE RESTRICT,
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'executing', 'retryable', 'dispatched', 'manual_review')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0,
  engine_result_json TEXT,
  last_error TEXT,
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_nurture_dispatch_due
  ON quiz_nurture_dispatches(state, lease_until, updated_at);
