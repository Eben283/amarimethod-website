-- Provider-neutral Staff task authority.
--
-- Each row is one immutable task version and its idempotent command evidence. There is no
-- provider identifier, propagation queue, customer notification, destructive delete path, or
-- authority promotion. The source write route remains hard-shadow in the reviewed revision.

CREATE TABLE IF NOT EXISTS owned_task_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'revise', 'complete', 'reopen', 'archive', 'restore')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  prior_revision INTEGER NOT NULL CHECK (prior_revision >= 0),
  title_clean TEXT NOT NULL CHECK (length(title_clean) BETWEEN 1 AND 300),
  title_sha256 TEXT NOT NULL CHECK (
    length(title_sha256) = 64 AND title_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  due_at TEXT CHECK (due_at IS NULL OR julianday(due_at) IS NOT NULL),
  state TEXT NOT NULL CHECK (state IN ('open', 'completed', 'archived')),
  archived_from_state TEXT CHECK (archived_from_state IN ('open', 'completed')),
  completed_at TEXT CHECK (completed_at IS NULL OR julianday(completed_at) IS NOT NULL),
  command_sha256 TEXT NOT NULL CHECK (
    length(command_sha256) = 64 AND command_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
  CHECK (
    (action = 'create' AND revision = 1 AND prior_revision = 0 AND state = 'open')
    OR
    (action <> 'create' AND revision = prior_revision + 1)
  ),
  CHECK (
    (state = 'open' AND archived_from_state IS NULL AND completed_at IS NULL)
    OR
    (state = 'completed' AND archived_from_state IS NULL AND completed_at IS NOT NULL)
    OR
    (
      state = 'archived'
      AND archived_from_state IN ('open', 'completed')
      AND (
        (archived_from_state = 'open' AND completed_at IS NULL)
        OR (archived_from_state = 'completed' AND completed_at IS NOT NULL)
      )
    )
  ),
  UNIQUE (actor, idempotency_key),
  UNIQUE (task_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_owned_task_versions_contact
  ON owned_task_versions(contact_id, state, due_at, recorded_at DESC, task_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_owned_task_versions_task
  ON owned_task_versions(task_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS owned_task_versions_no_update
BEFORE UPDATE ON owned_task_versions
BEGIN SELECT RAISE(ABORT, 'owned task versions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_versions_no_delete
BEFORE DELETE ON owned_task_versions
BEGIN SELECT RAISE(ABORT, 'owned task versions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_rejects_archived_contact
BEFORE INSERT ON owned_task_versions
WHEN NOT EXISTS (
  SELECT 1 FROM contacts
   WHERE id = NEW.contact_id AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'owned task contact unavailable'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_requires_appointment_identity
BEFORE INSERT ON owned_task_versions
WHEN NEW.appointment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM appointments
   WHERE id = NEW.appointment_id AND contact_id = NEW.contact_id
)
BEGIN SELECT RAISE(ABORT, 'owned task appointment mismatch'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_create_requires_new_identity
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'create' AND EXISTS (
  SELECT 1 FROM owned_task_versions WHERE task_id = NEW.task_id
)
BEGIN SELECT RAISE(ABORT, 'owned task identity already exists'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_change_requires_current_identity
BEFORE INSERT ON owned_task_versions
WHEN NEW.action <> 'create' AND NOT EXISTS (
  SELECT 1
    FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
)
BEGIN SELECT RAISE(ABORT, 'owned task revision conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_revise_requires_open
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'revise'
 AND EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'open'
     AND NEW.state = 'open'
)
BEGIN SELECT RAISE(ABORT, 'owned task is not open'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_complete_requires_open_copy
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'complete'
 AND EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'open'
     AND NEW.state = 'completed'
     AND NEW.completed_at = NEW.recorded_at
     AND current.title_clean = NEW.title_clean
     AND current.title_sha256 = NEW.title_sha256
     AND current.due_at IS NEW.due_at
)
BEGIN SELECT RAISE(ABORT, 'owned task completion conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_reopen_requires_completed_copy
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'reopen'
 AND EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'completed'
     AND NEW.state = 'open'
     AND NEW.completed_at IS NULL
     AND current.title_clean = NEW.title_clean
     AND current.title_sha256 = NEW.title_sha256
     AND current.due_at IS NEW.due_at
)
BEGIN SELECT RAISE(ABORT, 'owned task reopen conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_archive_requires_current_copy
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'archive'
 AND EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.state IN ('open', 'completed')
     AND NEW.state = 'archived'
     AND NEW.archived_from_state = current.state
     AND NEW.completed_at IS current.completed_at
     AND current.title_clean = NEW.title_clean
     AND current.title_sha256 = NEW.title_sha256
     AND current.due_at IS NEW.due_at
)
BEGIN SELECT RAISE(ABORT, 'owned task archive conflict'); END;

CREATE TRIGGER IF NOT EXISTS owned_task_version_restore_requires_archived_copy
BEFORE INSERT ON owned_task_versions
WHEN NEW.action = 'restore'
 AND EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.contact_id = NEW.contact_id
     AND current.appointment_id IS NEW.appointment_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1 FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.state = 'archived'
     AND NEW.state = current.archived_from_state
     AND NEW.archived_from_state IS NULL
     AND NEW.completed_at IS current.completed_at
     AND current.title_clean = NEW.title_clean
     AND current.title_sha256 = NEW.title_sha256
     AND current.due_at IS NEW.due_at
)
BEGIN SELECT RAISE(ABORT, 'owned task restore conflict'); END;
