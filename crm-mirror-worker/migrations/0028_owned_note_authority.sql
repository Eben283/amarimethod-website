-- Provider-neutral Staff note authority.
--
-- Each row is one immutable note version and its idempotent command evidence. There is no
-- provider identifier, propagation queue, customer notification, destructive delete path, or
-- authority promotion. The source write route remains hard-shadow in the reviewed revision.

CREATE TABLE IF NOT EXISTS owned_note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'revise', 'archive', 'restore')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  prior_revision INTEGER NOT NULL CHECK (prior_revision >= 0),
  body_clean TEXT NOT NULL CHECK (length(body_clean) BETWEEN 1 AND 5000),
  body_sha256 TEXT NOT NULL CHECK (
    length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  command_sha256 TEXT NOT NULL CHECK (
    length(command_sha256) = 64 AND command_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
  CHECK (
    (action = 'create' AND revision = 1 AND prior_revision = 0 AND state = 'active')
    OR
    (action <> 'create' AND revision = prior_revision + 1)
  ),
  UNIQUE (actor, idempotency_key),
  UNIQUE (note_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_owned_note_versions_contact
  ON owned_note_versions(contact_id, recorded_at DESC, note_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_owned_note_versions_note
  ON owned_note_versions(note_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS owned_note_versions_no_update
BEFORE UPDATE ON owned_note_versions
BEGIN SELECT RAISE(ABORT, 'owned note versions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_versions_no_delete
BEFORE DELETE ON owned_note_versions
BEGIN SELECT RAISE(ABORT, 'owned note versions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_rejects_archived_contact
BEFORE INSERT ON owned_note_versions
WHEN NOT EXISTS (
  SELECT 1 FROM contacts
   WHERE id = NEW.contact_id AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'owned note contact unavailable'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_requires_appointment_identity
BEFORE INSERT ON owned_note_versions
WHEN NEW.appointment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id AND contact_id = NEW.contact_id
)
BEGIN SELECT RAISE(ABORT, 'owned note appointment mismatch'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_create_requires_new_identity
BEFORE INSERT ON owned_note_versions
WHEN NEW.action = 'create' AND EXISTS (
  SELECT 1 FROM owned_note_versions WHERE note_id = NEW.note_id
)
BEGIN SELECT RAISE(ABORT, 'owned note identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_change_requires_current_identity
BEFORE INSERT ON owned_note_versions
WHEN NEW.action <> 'create' AND NOT EXISTS (
  SELECT 1
    FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_note_versions latest
        WHERE latest.note_id = NEW.note_id
     )
)
BEGIN SELECT RAISE(ABORT, 'owned note revision conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_revise_requires_active
BEFORE INSERT ON owned_note_versions
WHEN NEW.action = 'revise'
 AND EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_note_versions latest
        WHERE latest.note_id = NEW.note_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'active'
     AND NEW.state = 'active'
)
BEGIN SELECT RAISE(ABORT, 'owned note is not active'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_archive_requires_active_copy
BEFORE INSERT ON owned_note_versions
WHEN NEW.action = 'archive'
 AND EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_note_versions latest
        WHERE latest.note_id = NEW.note_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'active'
     AND NEW.state = 'archived'
     AND current.body_clean = NEW.body_clean
     AND current.body_sha256 = NEW.body_sha256
)
BEGIN SELECT RAISE(ABORT, 'owned note archive conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_note_version_restore_requires_archived_copy
BEFORE INSERT ON owned_note_versions
WHEN NEW.action = 'restore'
 AND EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_note_versions latest
        WHERE latest.note_id = NEW.note_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_note_versions current
   WHERE current.note_id = NEW.note_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'archived'
     AND NEW.state = 'active'
     AND current.body_clean = NEW.body_clean
     AND current.body_sha256 = NEW.body_sha256
)
BEGIN SELECT RAISE(ABORT, 'owned note restore conflict'); END;
