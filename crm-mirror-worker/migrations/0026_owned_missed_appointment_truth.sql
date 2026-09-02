-- Provider-neutral missed-appointment truth.
--
-- GHL's legacy automation increments a mutable contact field. The owned CRM
-- instead retains one immutable status fact for each canonical appointment
-- revision and derives the current missed count at read time. A later status
-- correction appends a new revision; it never subtracts from or rewrites old
-- evidence. Existing rows are honest migration baselines, not invented event
-- history.

CREATE TABLE IF NOT EXISTS appointment_status_facts (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  appointment_revision INTEGER NOT NULL CHECK (appointment_revision >= 1),
  normalized_status TEXT NOT NULL CHECK (
    normalized_status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'attended', 'unknown')
  ),
  authority TEXT NOT NULL CHECK (authority IN ('owned', 'provider_mirror')),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('migration_baseline', 'owned_authority', 'provider_mirror')
  ),
  history_complete INTEGER NOT NULL CHECK (history_complete IN (0, 1)),
  effective_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  UNIQUE (appointment_id, appointment_revision)
);

CREATE INDEX IF NOT EXISTS idx_appointment_status_facts_contact
  ON appointment_status_facts(contact_id, normalized_status, appointment_revision DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_status_facts_appointment
  ON appointment_status_facts(appointment_id, appointment_revision DESC);

INSERT OR IGNORE INTO appointment_status_facts (
  id, appointment_id, contact_id, appointment_revision, normalized_status,
  authority, source_kind, history_complete, effective_at, recorded_at, source_key
)
SELECT
  'status_' || id || '_r' || revision,
  id,
  contact_id,
  revision,
  status,
  authority,
  'migration_baseline',
  0,
  COALESCE(attendance_marked_at, cancelled_at, updated_at),
  updated_at,
  'migration:0026:' || id || ':revision:' || revision
FROM appointments;

CREATE TRIGGER IF NOT EXISTS appointment_status_facts_after_insert
AFTER INSERT ON appointments
BEGIN
  INSERT OR IGNORE INTO appointment_status_facts (
    id, appointment_id, contact_id, appointment_revision, normalized_status,
    authority, source_kind, history_complete, effective_at, recorded_at, source_key
  ) VALUES (
    'status_' || NEW.id || '_r' || NEW.revision,
    NEW.id,
    NEW.contact_id,
    NEW.revision,
    NEW.status,
    NEW.authority,
    CASE WHEN NEW.authority = 'owned' THEN 'owned_authority' ELSE 'provider_mirror' END,
    CASE WHEN NEW.authority = 'owned' THEN 1 ELSE 0 END,
    COALESCE(NEW.attendance_marked_at, NEW.cancelled_at, NEW.updated_at),
    NEW.updated_at,
    'appointment:' || NEW.id || ':revision:' || NEW.revision
  );
END;

CREATE TRIGGER IF NOT EXISTS appointment_status_facts_after_revision
AFTER UPDATE OF status, revision, authority ON appointments
WHEN NEW.status <> OLD.status
  OR NEW.revision <> OLD.revision
  OR NEW.authority <> OLD.authority
BEGIN
  INSERT OR IGNORE INTO appointment_status_facts (
    id, appointment_id, contact_id, appointment_revision, normalized_status,
    authority, source_kind, history_complete, effective_at, recorded_at, source_key
  ) VALUES (
    'status_' || NEW.id || '_r' || NEW.revision,
    NEW.id,
    NEW.contact_id,
    NEW.revision,
    NEW.status,
    NEW.authority,
    CASE WHEN NEW.authority = 'owned' THEN 'owned_authority' ELSE 'provider_mirror' END,
    CASE WHEN NEW.authority = 'owned' THEN 1 ELSE 0 END,
    COALESCE(NEW.attendance_marked_at, NEW.cancelled_at, NEW.updated_at),
    NEW.updated_at,
    'appointment:' || NEW.id || ':revision:' || NEW.revision
  );
END;

CREATE TRIGGER IF NOT EXISTS appointment_status_facts_no_update
BEFORE UPDATE ON appointment_status_facts
BEGIN SELECT RAISE(ABORT, 'appointment status facts are append-only'); END;

CREATE TRIGGER IF NOT EXISTS appointment_status_facts_no_delete
BEFORE DELETE ON appointment_status_facts
BEGIN SELECT RAISE(ABORT, 'appointment status facts are append-only'); END;
