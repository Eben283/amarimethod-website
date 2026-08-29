-- Make the existing appointment record capable of being Amari-owned while
-- preserving every current owned appointment id and every dependent foreign
-- key. Provider identifiers remain temporary crosswalk material; new native
-- appointments are no longer required to invent one.
--
-- D1 applies each migration transactionally. defer_foreign_keys keeps the
-- existing notes, session-ledger, and provider-observation references valid
-- while their parent table is replaced under the same name. The migration's
-- verification test proves the populated-table path and runs foreign_key_check
-- before commit.

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

-- Move the collision policy beside the owned service instead of deriving it
-- from a temporary provider calendar. Defaults preserve unknown services as
-- exact-duration blocks until they are deliberately reviewed.
ALTER TABLE services ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (buffer_minutes >= 0 AND buffer_minutes <= 180);
ALTER TABLE services ADD COLUMN start_interval_minutes INTEGER NOT NULL DEFAULT 15
  CHECK (start_interval_minutes >= 5 AND start_interval_minutes <= 180);
UPDATE services SET buffer_minutes = 20, start_interval_minutes = 60
 WHERE id IN ('initial-in-person', 'followup-in-person', 'followup-in-person-package',
              'followup-virtual-package', 'followup-virtual', 'partner-initial',
              'partner-initial-virtual');
UPDATE services SET buffer_minutes = 10, start_interval_minutes = 15
 WHERE id IN ('discovery-call', 'discovery-call-virtual');
UPDATE services SET buffer_minutes = 20, start_interval_minutes = 15
 WHERE id = 'entrainment';
UPDATE services SET buffer_minutes = 20, start_interval_minutes = 30
 WHERE id = 'study-session';

-- This provider-observation child predates the checked-in migration chain in
-- production. Adopt its exact live schema here so clean databases and the
-- existing populated database converge before the appointment parent rebuild.
CREATE TABLE IF NOT EXISTS appointment_source_observations (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source = 'ghl'),
  provider_calendar_id TEXT,
  status TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  observed_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_appointment_source_observations_appointment
  ON appointment_source_observations(appointment_id, observed_at DESC);

-- Keep child-table SQL pointed at `appointments` while the prior table moves
-- out of the way; the replacement parent is created before the legacy rows are
-- dropped.
ALTER TABLE appointments RENAME TO appointments_provider_legacy;

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  provider_appointment_id TEXT UNIQUE,
  provider_calendar_id TEXT,
  provider_status_raw TEXT,
  status TEXT NOT NULL CHECK (status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'attended', 'unknown')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT,
  meeting_location TEXT,
  provider_meeting_location TEXT,
  replaces_appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  attendance_marked_at TEXT,
  attendance_marked_by TEXT,
  authority TEXT NOT NULL DEFAULT 'provider_mirror'
    CHECK (authority IN ('owned', 'provider_mirror')),
  provider_sync_state TEXT NOT NULL DEFAULT 'synced'
    CHECK (provider_sync_state IN ('not_required', 'pending', 'synced', 'retryable', 'manual_review')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT,
  last_modified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (authority = 'owned' OR provider_appointment_id IS NOT NULL)
);

INSERT INTO appointments (
  id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
  provider_status_raw, status, starts_at, ends_at, timezone,
  meeting_location, provider_meeting_location,
  replaces_appointment_id, cancelled_at, cancellation_reason,
  attendance_marked_at, attendance_marked_by, authority,
  provider_sync_state, revision, created_by, last_modified_by,
  created_at, updated_at
)
SELECT
  id, contact_id, service_id, provider_appointment_id, provider_calendar_id,
  provider_status_raw, status, starts_at, ends_at, timezone,
  NULL, NULL,
  replaces_appointment_id, cancelled_at, cancellation_reason,
  attendance_marked_at, attendance_marked_by, 'provider_mirror',
  'synced', 1, NULL, NULL, created_at, updated_at
FROM appointments_provider_legacy;

-- SQLite correctly retargets child foreign keys when their parent is renamed.
-- Rebuild all three child tables so their constraints point to the replacement
-- `appointments` authority before the legacy parent is removed.
CREATE TABLE session_ledger_entries_owned_authority (
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
INSERT INTO session_ledger_entries_owned_authority
  (id, contact_id, purchase_id, appointment_id, entry_type, credits, reason, created_by, source_key, created_at)
SELECT id, contact_id, purchase_id, appointment_id, entry_type, credits, reason, created_by, source_key, created_at
FROM session_ledger_entries;
DROP TABLE session_ledger_entries;
ALTER TABLE session_ledger_entries_owned_authority RENAME TO session_ledger_entries;
CREATE INDEX idx_ledger_contact ON session_ledger_entries(contact_id, created_at);

CREATE TABLE notes_owned_authority (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  authored_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO notes_owned_authority
  (id, contact_id, appointment_id, body, authored_by, created_at, updated_at)
SELECT id, contact_id, appointment_id, body, authored_by, created_at, updated_at
FROM notes;
DROP TABLE notes;
ALTER TABLE notes_owned_authority RENAME TO notes;

CREATE TABLE appointment_source_observations_owned_authority (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source = 'ghl'),
  provider_calendar_id TEXT,
  status TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  observed_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE
);
INSERT INTO appointment_source_observations_owned_authority (
  id, appointment_id, contact_id, source, provider_calendar_id,
  status, starts_at, ends_at, observed_at, source_key
)
SELECT
  id, appointment_id, contact_id, source, provider_calendar_id,
  status, starts_at, ends_at, observed_at, source_key
FROM appointment_source_observations;
DROP TABLE appointment_source_observations;
ALTER TABLE appointment_source_observations_owned_authority
  RENAME TO appointment_source_observations;
CREATE INDEX idx_appointment_source_observations_appointment
  ON appointment_source_observations(appointment_id, observed_at DESC);

DROP TABLE appointments_provider_legacy;
PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_appointments_contact_start
  ON appointments(contact_id, starts_at DESC);
CREATE INDEX idx_appointments_status_start
  ON appointments(status, starts_at);
CREATE INDEX idx_appointments_authority_sync
  ON appointments(authority, provider_sync_state, starts_at);

-- Per-visit payment truth belongs beside the owned appointment identity. This
-- table starts empty: absence means unknown, never unpaid. Existing KV records
-- require an explicit, reviewed import before they can become D1 evidence.
CREATE TABLE appointment_payment_records (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'paid', 'comped', 'on-package', 'pay-next-visit', 'owed', 'unknown'
  )),
  method TEXT CHECK (method IS NULL OR method IN ('stripe', 'cash', 'venmo', 'check', 'other')),
  note TEXT,
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  source TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'paid' OR method IS NOT NULL OR source = 'stripe-auto')
);
CREATE INDEX idx_appointment_payment_contact
  ON appointment_payment_records(contact_id, recorded_at DESC);

CREATE TABLE appointment_payment_events (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'paid', 'comped', 'on-package', 'pay-next-visit', 'owed', 'unknown'
  )),
  method TEXT,
  note TEXT,
  amount_cents INTEGER,
  source TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_appointment_payment_events_appointment
  ON appointment_payment_events(appointment_id, occurred_at);
CREATE TRIGGER appointment_payment_events_reject_update
BEFORE UPDATE ON appointment_payment_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_payment_events is append-only');
END;
CREATE TRIGGER appointment_payment_events_reject_delete
BEFORE DELETE ON appointment_payment_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_payment_events is append-only');
END;

-- One provider-neutral, idempotent command ledger owns appointment mutations.
-- It is intentionally inert until a reviewed repository and route write it.
CREATE TABLE appointment_authority_commands (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('schedule', 'cancel', 'reschedule')),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  source_appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  requested_start_time TEXT,
  requested_end_time TEXT,
  requested_timezone TEXT,
  payload_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('accepted', 'executing', 'completed', 'retryable', 'manual_review', 'rejected')),
  provider TEXT,
  provider_record_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (actor, idempotency_key)
);
CREATE INDEX idx_appointment_authority_commands_state
  ON appointment_authority_commands(state, lease_until, updated_at);
CREATE INDEX idx_appointment_authority_commands_appointment
  ON appointment_authority_commands(appointment_id, created_at);

CREATE TABLE appointment_authority_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES appointment_authority_commands(id) ON DELETE RESTRICT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'accepted', 'execution_claimed', 'provider_linked', 'provider_unlinked', 'completed',
    'retryable', 'manual_review', 'rejected', 'cancelled', 'rescheduled'
  )),
  detail_json TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_appointment_authority_events_command
  ON appointment_authority_events(command_id, occurred_at);
CREATE INDEX idx_appointment_authority_events_appointment
  ON appointment_authority_events(appointment_id, occurred_at);

CREATE TRIGGER appointment_authority_events_reject_update
BEFORE UPDATE ON appointment_authority_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_authority_events is append-only');
END;

CREATE TRIGGER appointment_authority_events_reject_delete
BEFORE DELETE ON appointment_authority_events
BEGIN
  SELECT RAISE(ABORT, 'appointment_authority_events is append-only');
END;
