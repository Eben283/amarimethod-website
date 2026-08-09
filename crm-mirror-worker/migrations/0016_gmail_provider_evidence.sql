-- Append-only Gmail provider evidence. This migration creates storage and
-- projections only: no OAuth grant, Gmail read/send call, watch registration,
-- webhook, dispatcher, composer, GHL fallback, or delivery path.

CREATE TABLE IF NOT EXISTS gmail_history_observations (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  mailbox_address TEXT NOT NULL CHECK (mailbox_address = grant_owner),
  history_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, mailbox_address, history_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_history_mailbox_latest
  ON gmail_history_observations(grant_owner, mailbox_address, observed_at DESC);

-- This table is intentionally not written by this migration's repository.
-- A future, separately reviewed dispatcher may append a row only after Gmail
-- has actually accepted a submission. Provider outcomes may project into
-- Communication only when they match this stronger proof; the current 0015
-- not-sent command ledger is never treated as submission evidence.
CREATE TABLE IF NOT EXISTS gmail_provider_submissions (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  submission_ref TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  provider_message_id TEXT NOT NULL,
  gmail_thread_id TEXT,
  rfc_message_id TEXT,
  subject_clean TEXT,
  body_clean TEXT,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, submission_ref),
  UNIQUE (grant_owner, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_submissions_contact
  ON gmail_provider_submissions(contact_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS gmail_provider_events (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  provider_event_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'failed', 'bounced')),
  provider_message_id TEXT,
  gmail_thread_id TEXT,
  rfc_message_id TEXT,
  submission_ref TEXT,
  submission_id TEXT REFERENCES gmail_provider_submissions(id) ON DELETE RESTRICT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE RESTRICT,
  history_id TEXT,
  failure_code TEXT,
  failure_detail_clean TEXT,
  payload_sha256 TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_provider_message
  ON gmail_provider_events(grant_owner, provider_message_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_gmail_provider_thread
  ON gmail_provider_events(grant_owner, gmail_thread_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_gmail_provider_rfc_message
  ON gmail_provider_events(grant_owner, rfc_message_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_gmail_provider_contact
  ON gmail_provider_events(contact_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS gmail_provider_events_no_attribution_without_submission
BEFORE INSERT ON gmail_provider_events
WHEN NEW.contact_id IS NOT NULL AND NEW.submission_id IS NULL
BEGIN SELECT RAISE(ABORT, 'gmail provider attribution requires submission proof'); END;

CREATE TRIGGER IF NOT EXISTS gmail_provider_events_submission_consistency
BEFORE INSERT ON gmail_provider_events
WHEN NEW.submission_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
    FROM gmail_provider_submissions submission
   WHERE submission.id = NEW.submission_id
     AND submission.mailbox_actor = NEW.mailbox_actor
     AND submission.grant_owner = NEW.grant_owner
     AND submission.submission_ref = NEW.submission_ref
     AND submission.contact_id = NEW.contact_id
     AND (NEW.provider_message_id IS NULL OR submission.provider_message_id = NEW.provider_message_id)
     AND (NEW.gmail_thread_id IS NULL OR submission.gmail_thread_id IS NULL OR submission.gmail_thread_id = NEW.gmail_thread_id)
     AND (NEW.rfc_message_id IS NULL OR submission.rfc_message_id IS NULL OR submission.rfc_message_id = NEW.rfc_message_id)
)
BEGIN SELECT RAISE(ABORT, 'gmail provider outcome does not match submission proof'); END;

CREATE TABLE IF NOT EXISTS gmail_inbound_messages (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  provider_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  references_json TEXT NOT NULL,
  mailbox_address TEXT NOT NULL CHECK (mailbox_address = grant_owner),
  from_address TEXT NOT NULL,
  to_addresses_json TEXT NOT NULL,
  subject_clean TEXT,
  body_clean TEXT,
  history_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE RESTRICT,
  attribution_basis TEXT NOT NULL CHECK (
    attribution_basis IN ('rfc_reply', 'gmail_thread', 'unique_sender', 'review')
  ),
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_inbound_thread
  ON gmail_inbound_messages(grant_owner, mailbox_address, gmail_thread_id, received_at);
CREATE INDEX IF NOT EXISTS idx_gmail_inbound_rfc_message
  ON gmail_inbound_messages(rfc_message_id, received_at);
CREATE INDEX IF NOT EXISTS idx_gmail_inbound_contact
  ON gmail_inbound_messages(contact_id, received_at DESC);

CREATE TABLE IF NOT EXISTS gmail_evidence_reviews (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('provider_outcome', 'inbound_message')),
  source_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('unmatched_provider_submission_ref', 'conflicting_submission_evidence', 'no_exact_contact', 'ambiguous_contact', 'conflicting_thread_evidence')
  ),
  candidate_contact_ids_json TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_evidence_reviews_recent
  ON gmail_evidence_reviews(created_at DESC);

CREATE TRIGGER IF NOT EXISTS gmail_history_observations_no_update
BEFORE UPDATE ON gmail_history_observations
BEGIN SELECT RAISE(ABORT, 'gmail history observations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_history_observations_no_delete
BEFORE DELETE ON gmail_history_observations
BEGIN SELECT RAISE(ABORT, 'gmail history observations are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_provider_events_no_update
BEFORE UPDATE ON gmail_provider_events
BEGIN SELECT RAISE(ABORT, 'gmail provider events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_provider_events_no_delete
BEFORE DELETE ON gmail_provider_events
BEGIN SELECT RAISE(ABORT, 'gmail provider events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_provider_submissions_no_update
BEFORE UPDATE ON gmail_provider_submissions
BEGIN SELECT RAISE(ABORT, 'gmail provider submissions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_provider_submissions_no_delete
BEFORE DELETE ON gmail_provider_submissions
BEGIN SELECT RAISE(ABORT, 'gmail provider submissions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_inbound_messages_no_update
BEFORE UPDATE ON gmail_inbound_messages
BEGIN SELECT RAISE(ABORT, 'gmail inbound messages are append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_inbound_messages_no_delete
BEFORE DELETE ON gmail_inbound_messages
BEGIN SELECT RAISE(ABORT, 'gmail inbound messages are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_evidence_reviews_no_update
BEFORE UPDATE ON gmail_evidence_reviews
BEGIN SELECT RAISE(ABORT, 'gmail evidence reviews are append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_evidence_reviews_no_delete
BEFORE DELETE ON gmail_evidence_reviews
BEGIN SELECT RAISE(ABORT, 'gmail evidence reviews are append-only'); END;

-- Only Gmail evidence created through this foundation is immutable. Existing
-- provider mirrors retain their current correction semantics.
CREATE TRIGGER IF NOT EXISTS gmail_communication_no_update
BEFORE UPDATE ON communication_events
WHEN OLD.provider = 'gmail'
BEGIN SELECT RAISE(ABORT, 'gmail communication evidence is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gmail_communication_no_delete
BEFORE DELETE ON communication_events
WHEN OLD.provider = 'gmail'
BEGIN SELECT RAISE(ABORT, 'gmail communication evidence is append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_communication_thread_projection
AFTER INSERT ON communication_events
WHEN NEW.provider = 'gmail' AND NEW.thread_id IS NOT NULL
BEGIN
  UPDATE communication_threads
     SET last_preview = CASE
           WHEN last_event_at IS NULL OR datetime(NEW.occurred_at) >= datetime(last_event_at)
           THEN COALESCE(NEW.body_clean, NEW.subject) ELSE last_preview END,
         last_direction = CASE
           WHEN last_event_at IS NULL OR datetime(NEW.occurred_at) >= datetime(last_event_at)
           THEN COALESCE(NEW.direction, 'unknown') ELSE last_direction END,
         last_event_at = CASE
           WHEN last_event_at IS NULL OR datetime(NEW.occurred_at) >= datetime(last_event_at)
           THEN NEW.occurred_at ELSE last_event_at END,
         unread_inbound_count = unread_inbound_count + CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END,
         updated_at = CASE
           WHEN datetime(NEW.created_at) >= datetime(updated_at) THEN NEW.created_at ELSE updated_at END
   WHERE id = NEW.thread_id;
END;
