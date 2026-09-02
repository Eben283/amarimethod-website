-- Provider-neutral Staff-owned contact roles and tags.
--
-- The immutable command is the audit evidence. contact_roles/contact_tags hold only the current
-- materialized `owned:staff` projection, so a remove command can reverse current state without
-- deleting prior evidence. No provider row or provider adapter is touched.

CREATE TABLE IF NOT EXISTS owned_contact_classification_commands (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add_tag', 'remove_tag', 'grant_role', 'revoke_role')),
  value_clean TEXT NOT NULL,
  command_sha256 TEXT NOT NULL CHECK (
    length(command_sha256) = 64 AND command_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  capture_nonce TEXT NOT NULL CHECK (
    length(capture_nonce) = 32 AND capture_nonce NOT GLOB '*[^0-9a-f]*'
  ),
  result_state TEXT NOT NULL CHECK (result_state IN ('applied', 'already_effective', 'already_absent')),
  recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
  CHECK (
    (
      action IN ('add_tag', 'remove_tag')
      AND length(value_clean) BETWEEN 1 AND 80
      AND value_clean = lower(value_clean)
      AND value_clean NOT GLOB '*[^a-z0-9:_-]*'
    )
    OR
    (
      action IN ('grant_role', 'revoke_role')
      AND value_clean IN ('lead', 'client', 'affiliate_partner', 'referral_source')
    )
  ),
  UNIQUE (actor, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_owned_contact_classification_contact
  ON owned_contact_classification_commands(contact_id, recorded_at DESC, id);

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_commands_no_update
BEFORE UPDATE ON owned_contact_classification_commands
BEGIN SELECT RAISE(ABORT, 'owned contact classification commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_commands_no_delete
BEFORE DELETE ON owned_contact_classification_commands
BEGIN SELECT RAISE(ABORT, 'owned contact classification commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_rejects_archived_contact
BEFORE INSERT ON owned_contact_classification_commands
WHEN NOT EXISTS (
  SELECT 1 FROM contacts
   WHERE id = NEW.contact_id AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'owned contact classification contact unavailable'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_result_guard
BEFORE INSERT ON owned_contact_classification_commands
WHEN NEW.result_state <> CASE
  WHEN NEW.action = 'add_tag' AND EXISTS (
    SELECT 1 FROM contact_tags
     WHERE contact_id = NEW.contact_id AND tag = NEW.value_clean AND source = 'owned:staff'
  ) THEN 'already_effective'
  WHEN NEW.action = 'grant_role' AND EXISTS (
    SELECT 1 FROM contact_roles
     WHERE contact_id = NEW.contact_id AND role = NEW.value_clean AND source = 'owned:staff'
  ) THEN 'already_effective'
  WHEN NEW.action = 'remove_tag' AND NOT EXISTS (
    SELECT 1 FROM contact_tags
     WHERE contact_id = NEW.contact_id AND tag = NEW.value_clean AND source = 'owned:staff'
  ) THEN 'already_absent'
  WHEN NEW.action = 'revoke_role' AND NOT EXISTS (
    SELECT 1 FROM contact_roles
     WHERE contact_id = NEW.contact_id AND role = NEW.value_clean AND source = 'owned:staff'
  ) THEN 'already_absent'
  ELSE 'applied'
END
BEGIN SELECT RAISE(ABORT, 'owned contact classification result mismatch'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_apply
AFTER INSERT ON owned_contact_classification_commands
BEGIN
  INSERT OR IGNORE INTO contact_tags (contact_id, tag, source, created_at)
    SELECT NEW.contact_id, NEW.value_clean, 'owned:staff', NEW.recorded_at
     WHERE NEW.action = 'add_tag';
  DELETE FROM contact_tags
   WHERE NEW.action = 'remove_tag'
     AND contact_id = NEW.contact_id
     AND tag = NEW.value_clean
     AND source = 'owned:staff';
  INSERT OR IGNORE INTO contact_roles (contact_id, role, source, created_at)
    SELECT NEW.contact_id, NEW.value_clean, 'owned:staff', NEW.recorded_at
     WHERE NEW.action = 'grant_role';
  DELETE FROM contact_roles
   WHERE NEW.action = 'revoke_role'
     AND contact_id = NEW.contact_id
     AND role = NEW.value_clean
     AND source = 'owned:staff';
END;

CREATE VIEW IF NOT EXISTS owned_contact_classification_intake AS
SELECT id, contact_id, actor, idempotency_key, action, value_clean,
       command_sha256, capture_nonce, recorded_at
  FROM owned_contact_classification_commands
 WHERE 0;

CREATE TRIGGER IF NOT EXISTS owned_contact_classification_intake_insert
INSTEAD OF INSERT ON owned_contact_classification_intake
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM owned_contact_classification_commands
     WHERE actor = NEW.actor
       AND idempotency_key = NEW.idempotency_key
       AND command_sha256 <> NEW.command_sha256
  ) THEN RAISE(ABORT, 'owned contact classification idempotency conflict') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM owned_contact_classification_commands
     WHERE actor = NEW.actor AND idempotency_key = NEW.idempotency_key
  ) AND NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = NEW.contact_id AND archived_at IS NULL
  ) THEN RAISE(ABORT, 'owned contact classification contact unavailable') END;

  INSERT OR IGNORE INTO owned_contact_classification_commands (
    id, contact_id, actor, idempotency_key, action, value_clean,
    command_sha256, capture_nonce, result_state, recorded_at
  ) VALUES (
    NEW.id, NEW.contact_id, NEW.actor, NEW.idempotency_key, NEW.action, NEW.value_clean,
    NEW.command_sha256, NEW.capture_nonce,
    CASE
      WHEN NEW.action = 'add_tag' AND EXISTS (
        SELECT 1 FROM contact_tags
         WHERE contact_id = NEW.contact_id AND tag = NEW.value_clean AND source = 'owned:staff'
      ) THEN 'already_effective'
      WHEN NEW.action = 'grant_role' AND EXISTS (
        SELECT 1 FROM contact_roles
         WHERE contact_id = NEW.contact_id AND role = NEW.value_clean AND source = 'owned:staff'
      ) THEN 'already_effective'
      WHEN NEW.action = 'remove_tag' AND NOT EXISTS (
        SELECT 1 FROM contact_tags
         WHERE contact_id = NEW.contact_id AND tag = NEW.value_clean AND source = 'owned:staff'
      ) THEN 'already_absent'
      WHEN NEW.action = 'revoke_role' AND NOT EXISTS (
        SELECT 1 FROM contact_roles
         WHERE contact_id = NEW.contact_id AND role = NEW.value_clean AND source = 'owned:staff'
      ) THEN 'already_absent'
      ELSE 'applied'
    END,
    NEW.recorded_at
  );
END;
