-- Append-only review evidence for a Gmail history gap or bounded content
-- transformation. This closes cursor livelocks without silently treating a
-- missing or truncated message as complete Communication evidence.

CREATE TABLE IF NOT EXISTS gmail_sync_gap_reviews (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  mailbox_address TEXT NOT NULL CHECK (mailbox_address = grant_owner),
  provider_message_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('provider_message_missing', 'body_truncated', 'metadata_truncated', 'metadata_unusable')
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, provider_message_id, history_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_gmail_sync_gap_reviews_recent
  ON gmail_sync_gap_reviews(grant_owner, observed_at DESC);

CREATE TRIGGER IF NOT EXISTS gmail_sync_gap_reviews_no_update
BEFORE UPDATE ON gmail_sync_gap_reviews
BEGIN SELECT RAISE(ABORT, 'gmail sync gap reviews are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_sync_gap_reviews_no_delete
BEFORE DELETE ON gmail_sync_gap_reviews
BEGIN SELECT RAISE(ABORT, 'gmail sync gap reviews are append-only'); END;
