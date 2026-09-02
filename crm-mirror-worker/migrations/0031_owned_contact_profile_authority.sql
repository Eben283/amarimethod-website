-- Provider-neutral Staff authority for contact names and communication destinations.
--
-- Each field family owns an independent revision so changing a name cannot silently promote
-- email or phone authority. Email/SMS consent created by this path is bound to the exact
-- normalized destination; legacy provider consent remains unbound evidence. Commands and their
-- before/after values are append-only. No provider, message, payment, appointment, deletion, or
-- contact-creation effect exists in this migration.

ALTER TABLE contacts ADD COLUMN name_authority TEXT NOT NULL DEFAULT 'provider_mirror'
  CHECK (name_authority IN ('provider_mirror', 'owned'));
ALTER TABLE contacts ADD COLUMN name_revision INTEGER NOT NULL DEFAULT 0
  CHECK (name_revision >= 0);
ALTER TABLE contacts ADD COLUMN email_authority TEXT NOT NULL DEFAULT 'provider_mirror'
  CHECK (email_authority IN ('provider_mirror', 'owned'));
ALTER TABLE contacts ADD COLUMN email_revision INTEGER NOT NULL DEFAULT 0
  CHECK (email_revision >= 0);
ALTER TABLE contacts ADD COLUMN phone_authority TEXT NOT NULL DEFAULT 'provider_mirror'
  CHECK (phone_authority IN ('provider_mirror', 'owned'));
ALTER TABLE contacts ADD COLUMN phone_revision INTEGER NOT NULL DEFAULT 0
  CHECK (phone_revision >= 0);

ALTER TABLE consents ADD COLUMN destination_normalized TEXT;
ALTER TABLE consents ADD COLUMN destination_sha256 TEXT CHECK (
  destination_sha256 IS NULL OR (
    length(destination_sha256) = 64 AND destination_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE INDEX IF NOT EXISTS idx_consents_destination_current
  ON consents(contact_id, channel, destination_normalized, effective_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS consent_destination_identity_guard_insert
BEFORE INSERT ON consents
WHEN (NEW.destination_normalized IS NULL) <> (NEW.destination_sha256 IS NULL)
  OR (
    NEW.destination_normalized IS NOT NULL
    AND (
      (NEW.channel = 'email' AND (
        NEW.destination_normalized <> lower(NEW.destination_normalized)
        OR NEW.destination_normalized NOT LIKE '%_@_%._%'
        OR length(NEW.destination_normalized) > 254
      ))
      OR
      (NEW.channel = 'sms' AND (
        substr(NEW.destination_normalized, 1, 1) <> '+'
        OR substr(NEW.destination_normalized, 2, 1) NOT GLOB '[1-9]'
        OR substr(NEW.destination_normalized, 2) GLOB '*[^0-9]*'
        OR length(NEW.destination_normalized) NOT BETWEEN 9 AND 16
      ))
    )
  )
BEGIN SELECT RAISE(ABORT, 'consent destination identity invalid'); END;

CREATE TRIGGER IF NOT EXISTS consent_destination_identity_guard_update
BEFORE UPDATE OF channel, destination_normalized, destination_sha256 ON consents
WHEN (NEW.destination_normalized IS NULL) <> (NEW.destination_sha256 IS NULL)
  OR (
    NEW.destination_normalized IS NOT NULL
    AND (
      (NEW.channel = 'email' AND (
        NEW.destination_normalized <> lower(NEW.destination_normalized)
        OR NEW.destination_normalized NOT LIKE '%_@_%._%'
        OR length(NEW.destination_normalized) > 254
      ))
      OR
      (NEW.channel = 'sms' AND (
        substr(NEW.destination_normalized, 1, 1) <> '+'
        OR substr(NEW.destination_normalized, 2, 1) NOT GLOB '[1-9]'
        OR substr(NEW.destination_normalized, 2) GLOB '*[^0-9]*'
        OR length(NEW.destination_normalized) NOT BETWEEN 9 AND 16
      ))
    )
  )
BEGIN SELECT RAISE(ABORT, 'consent destination identity invalid'); END;

CREATE TRIGGER IF NOT EXISTS owned_destination_consents_no_update
BEFORE UPDATE ON consents
WHEN OLD.source = 'owned:staff_destination'
BEGIN SELECT RAISE(ABORT, 'owned destination consent is append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_destination_consents_no_delete
BEFORE DELETE ON consents
WHEN OLD.source = 'owned:staff_destination'
BEGIN SELECT RAISE(ABORT, 'owned destination consent is append-only'); END;

CREATE TABLE IF NOT EXISTS owned_contact_profile_commands (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('Eben', 'Garrett')),
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('revise_name', 'set_email', 'set_phone')),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
  previous_authority TEXT NOT NULL CHECK (previous_authority IN ('provider_mirror', 'owned')),
  previous_first_name TEXT,
  previous_last_name TEXT,
  previous_display_name TEXT,
  previous_destination_normalized TEXT,
  next_first_name TEXT,
  next_last_name TEXT,
  next_display_name TEXT,
  next_destination_normalized TEXT,
  consent_state TEXT CHECK (consent_state IN ('granted', 'revoked', 'unknown')),
  consent_evidence_ref TEXT,
  destination_sha256 TEXT CHECK (
    destination_sha256 IS NULL OR (
      length(destination_sha256) = 64 AND destination_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  command_sha256 TEXT NOT NULL CHECK (
    length(command_sha256) = 64 AND command_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  capture_nonce TEXT NOT NULL CHECK (
    length(capture_nonce) = 32 AND capture_nonce NOT GLOB '*[^0-9a-f]*'
  ),
  result_state TEXT NOT NULL CHECK (result_state IN ('applied', 'already_current')),
  recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
  UNIQUE (actor, idempotency_key),
  CHECK (
    (
      action = 'revise_name'
      AND previous_display_name IS NOT NULL
      AND next_display_name IS NOT NULL
      AND length(next_display_name) BETWEEN 1 AND 201
      AND length(COALESCE(next_first_name, '')) <= 100
      AND length(COALESCE(next_last_name, '')) <= 100
      AND COALESCE(next_first_name, '') || COALESCE(next_last_name, '') <> ''
      AND previous_destination_normalized IS NULL
      AND next_destination_normalized IS NULL
      AND consent_state IS NULL
      AND consent_evidence_ref IS NULL
      AND destination_sha256 IS NULL
    )
    OR
    (
      action IN ('set_email', 'set_phone')
      AND previous_first_name IS NULL
      AND previous_last_name IS NULL
      AND previous_display_name IS NULL
      AND next_first_name IS NULL
      AND next_last_name IS NULL
      AND next_display_name IS NULL
      AND (
        (
          next_destination_normalized IS NULL
          AND consent_state IS NULL
          AND consent_evidence_ref IS NULL
          AND destination_sha256 IS NULL
        )
        OR
        (
          next_destination_normalized IS NOT NULL
          AND consent_state IS NOT NULL
          AND destination_sha256 IS NOT NULL
          AND (consent_state <> 'granted' OR length(consent_evidence_ref) BETWEEN 1 AND 240)
        )
      )
      AND (
        action <> 'set_email'
        OR next_destination_normalized IS NULL
        OR (
          next_destination_normalized = lower(next_destination_normalized)
          AND next_destination_normalized LIKE '%_@_%._%'
          AND length(next_destination_normalized) <= 254
        )
      )
      AND (
        action <> 'set_phone'
        OR next_destination_normalized IS NULL
        OR (
          substr(next_destination_normalized, 1, 1) = '+'
          AND substr(next_destination_normalized, 2, 1) GLOB '[1-9]'
          AND substr(next_destination_normalized, 2) NOT GLOB '*[^0-9]*'
          AND length(next_destination_normalized) BETWEEN 9 AND 16
        )
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_owned_contact_profile_contact
  ON owned_contact_profile_commands(contact_id, recorded_at DESC, id);

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_commands_no_update
BEFORE UPDATE ON owned_contact_profile_commands
BEGIN SELECT RAISE(ABORT, 'owned contact profile commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_commands_no_delete
BEFORE DELETE ON owned_contact_profile_commands
BEGIN SELECT RAISE(ABORT, 'owned contact profile commands are append-only'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_contact_guard
BEFORE INSERT ON owned_contact_profile_commands
WHEN NOT EXISTS (
  SELECT 1 FROM contacts WHERE id = NEW.contact_id AND archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'owned contact profile contact unavailable'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_previous_guard
BEFORE INSERT ON owned_contact_profile_commands
WHEN NOT EXISTS (
  SELECT 1 FROM contacts contact
   WHERE contact.id = NEW.contact_id
     AND contact.archived_at IS NULL
     AND (
       (
         NEW.action = 'revise_name'
         AND contact.name_revision = NEW.expected_revision
         AND contact.name_authority = NEW.previous_authority
         AND contact.first_name IS NEW.previous_first_name
         AND contact.last_name IS NEW.previous_last_name
         AND contact.display_name = NEW.previous_display_name
       )
       OR
       (
         NEW.action = 'set_email'
         AND contact.email_revision = NEW.expected_revision
         AND contact.email_authority = NEW.previous_authority
         AND contact.email_normalized IS NEW.previous_destination_normalized
       )
       OR
       (
         NEW.action = 'set_phone'
         AND contact.phone_revision = NEW.expected_revision
         AND contact.phone_authority = NEW.previous_authority
         AND contact.phone_e164 IS NEW.previous_destination_normalized
       )
     )
)
BEGIN SELECT RAISE(ABORT, 'owned contact profile stale revision'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_result_guard
BEFORE INSERT ON owned_contact_profile_commands
WHEN NEW.result_state <> CASE
  WHEN NEW.action = 'revise_name'
    AND NEW.previous_authority = 'owned'
    AND NEW.previous_first_name IS NEW.next_first_name
    AND NEW.previous_last_name IS NEW.next_last_name
    AND NEW.previous_display_name = NEW.next_display_name
    THEN 'already_current'
  WHEN NEW.action = 'set_email'
    AND NEW.previous_authority = 'owned'
    AND NEW.previous_destination_normalized IS NEW.next_destination_normalized
    AND (
      NEW.next_destination_normalized IS NULL
      OR COALESCE((
        SELECT consent.state FROM consents consent
         WHERE consent.contact_id = NEW.contact_id
           AND consent.channel = 'email'
           AND consent.destination_normalized = NEW.next_destination_normalized
           AND consent.destination_sha256 = NEW.destination_sha256
         ORDER BY datetime(consent.effective_at) DESC, consent.id DESC LIMIT 1
      ), 'missing') = NEW.consent_state
    )
    THEN 'already_current'
  WHEN NEW.action = 'set_phone'
    AND NEW.previous_authority = 'owned'
    AND NEW.previous_destination_normalized IS NEW.next_destination_normalized
    AND (
      NEW.next_destination_normalized IS NULL
      OR COALESCE((
        SELECT consent.state FROM consents consent
         WHERE consent.contact_id = NEW.contact_id
           AND consent.channel = 'sms'
           AND consent.destination_normalized = NEW.next_destination_normalized
           AND consent.destination_sha256 = NEW.destination_sha256
         ORDER BY datetime(consent.effective_at) DESC, consent.id DESC LIMIT 1
      ), 'missing') = NEW.consent_state
    )
    THEN 'already_current'
  ELSE 'applied'
END
BEGIN SELECT RAISE(ABORT, 'owned contact profile result mismatch'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_revision_guard
BEFORE INSERT ON owned_contact_profile_commands
WHEN NEW.result_revision <> CASE
  WHEN NEW.result_state = 'applied' THEN NEW.expected_revision + 1
  ELSE NEW.expected_revision
END
BEGIN SELECT RAISE(ABORT, 'owned contact profile result revision mismatch'); END;

CREATE TRIGGER IF NOT EXISTS owned_contact_profile_apply
AFTER INSERT ON owned_contact_profile_commands
WHEN NEW.result_state = 'applied'
BEGIN
  UPDATE contacts SET
    first_name = NEW.next_first_name,
    last_name = NEW.next_last_name,
    display_name = NEW.next_display_name,
    name_authority = 'owned',
    name_revision = NEW.result_revision,
    updated_at = NEW.recorded_at
  WHERE id = NEW.contact_id AND NEW.action = 'revise_name';

  UPDATE contacts SET
    email_normalized = NEW.next_destination_normalized,
    email_authority = 'owned',
    email_revision = NEW.result_revision,
    updated_at = NEW.recorded_at
  WHERE id = NEW.contact_id AND NEW.action = 'set_email';

  UPDATE contacts SET
    phone_e164 = NEW.next_destination_normalized,
    phone_authority = 'owned',
    phone_revision = NEW.result_revision,
    updated_at = NEW.recorded_at
  WHERE id = NEW.contact_id AND NEW.action = 'set_phone';

  INSERT INTO consents (
    id, contact_id, channel, state, effective_at, source, evidence_ref, recorded_by,
    destination_normalized, destination_sha256
  )
  SELECT NEW.id || ':consent', NEW.contact_id,
         CASE WHEN NEW.action = 'set_email' THEN 'email' ELSE 'sms' END,
         NEW.consent_state, NEW.recorded_at, 'owned:staff_destination',
         COALESCE(NEW.consent_evidence_ref, NEW.id), NEW.actor,
         NEW.next_destination_normalized, NEW.destination_sha256
   WHERE NEW.action IN ('set_email', 'set_phone')
     AND NEW.next_destination_normalized IS NOT NULL;
END;
