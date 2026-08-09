-- Append-only, shadow-only appointment lifecycle evidence.
--
-- This table cannot create or mutate provider appointments. The existing
-- `appointments` table remains the current mirrored snapshot and the live Staff
-- schedule continues to read GHL directly during cutover.

CREATE TABLE IF NOT EXISTS appointment_projection_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'ghl'),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('webhook', 'snapshot')),
  provider_event_id TEXT NOT NULL,
  provider_event_type TEXT NOT NULL,
  provider_appointment_id TEXT NOT NULL,
  provider_contact_id TEXT,
  provider_calendar_id TEXT,
  provider_status_raw TEXT,
  normalized_status TEXT NOT NULL CHECK (normalized_status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'attended', 'unknown')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT,
  transition_type TEXT NOT NULL CHECK (transition_type IN ('create', 'reschedule', 'cancel', 'status', 'observed')),
  provider_occurred_at TEXT,
  observed_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  UNIQUE (provider, provider_event_id, evidence_hash)
);

CREATE INDEX IF NOT EXISTS idx_appointment_projection_appointment_time
  ON appointment_projection_events(provider_appointment_id, provider_occurred_at, observed_at);

CREATE INDEX IF NOT EXISTS idx_appointment_projection_event
  ON appointment_projection_events(provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_appointment_projection_observed
  ON appointment_projection_events(observed_at DESC);
