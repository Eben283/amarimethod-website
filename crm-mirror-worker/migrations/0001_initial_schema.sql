PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  email_normalized TEXT,
  phone_e164 TEXT,
  referral_source_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_e164);

CREATE TABLE IF NOT EXISTS contact_roles (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('lead', 'client', 'affiliate_partner', 'referral_source')),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, role, source)
);

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag, source)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag);

CREATE TABLE IF NOT EXISTS contact_attributes (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  attribute_key TEXT NOT NULL,
  attribute_value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, source, attribute_key)
);

CREATE TABLE IF NOT EXISTS external_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('ghl', 'stripe', 'google_calendar', 'gmail', 'twilio')),
  object_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  record_type TEXT,
  record_id TEXT,
  last_seen_at TEXT NOT NULL,
  source_payload_hash TEXT,
  UNIQUE (provider, object_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_external_records_contact ON external_records(contact_id);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  service_family TEXT NOT NULL,
  duration_minutes INTEGER,
  package_eligible INTEGER NOT NULL DEFAULT 0 CHECK (package_eligible IN (0, 1)),
  provider_calendar_id TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  provider_appointment_id TEXT NOT NULL UNIQUE,
  provider_calendar_id TEXT,
  provider_status_raw TEXT,
  status TEXT NOT NULL CHECK (status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'attended', 'unknown')),
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT,
  replaces_appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  attendance_marked_at TEXT,
  attendance_marked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_contact_start ON appointments(contact_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_status_start ON appointments(status, starts_at);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  session_credits INTEGER NOT NULL CHECK (session_credits >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  package_id TEXT REFERENCES packages(id) ON DELETE SET NULL,
  provider_charge_id TEXT NOT NULL UNIQUE,
  provider_customer_id TEXT,
  provider_status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  amount_refunded_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  purchased_at TEXT,
  classification TEXT NOT NULL,
  ledger_import_state TEXT NOT NULL DEFAULT 'pending_reconciliation',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_contact ON purchases(contact_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_ledger_state ON purchases(ledger_import_state);

CREATE TABLE IF NOT EXISTS session_ledger_entries (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('purchase_credit', 'attendance_debit', 'manual_adjustment', 'refund_reversal')),
  credits INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_contact ON session_ledger_entries(contact_id, created_at);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  state TEXT NOT NULL CHECK (state IN ('granted', 'revoked', 'unknown')),
  effective_at TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence_ref TEXT,
  recorded_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consents_current ON consents(contact_id, channel, effective_at DESC);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider_record_id TEXT REFERENCES external_records(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_status TEXT,
  occurred_at TEXT NOT NULL,
  recorded_by TEXT,
  subject_or_preview TEXT
);
CREATE INDEX IF NOT EXISTS idx_communications_timeline ON communications(contact_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  authored_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  referred_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  referred_at TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (referrer_contact_id, referred_contact_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('ghl', 'stripe', 'calendar')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  cursor_before TEXT,
  cursor_after TEXT,
  records_read INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  failure_detail TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_provider ON sync_runs(provider, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_cursors (
  provider TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operational_events_recent ON operational_events(created_at DESC);

INSERT OR IGNORE INTO services (id, name, service_family, duration_minutes, package_eligible, provider_calendar_id)
VALUES
  ('initial-in-person', 'Initial Session — In Person', 'initial_session', 60, 1, 'G7OAnnJuFbMF6nQSlZVQ'),
  ('followup-in-person', 'Follow-up Session — In Person', 'follow_up', 50, 1, 'SKDVOL8wtUN6Ne0ppbC9'),
  ('followup-in-person-package', 'Follow-up Session — In Person (Package)', 'follow_up', 50, 1, 'ZO1jlGfy01rsxVqicoSB'),
  ('followup-virtual-package', 'Follow-up Session — Virtual (Package)', 'follow_up', 50, 1, 'bJFkhVP35Ecwh4tLnSmy'),
  ('followup-virtual', 'Follow-up Session — Virtual', 'follow_up', 50, 1, 'oVn77FcecFY16iS2pHyP'),
  ('discovery-call', 'Your Free Discovery Call', 'discovery', 15, 0, 'USgPsktqRcuomdUgpShL'),
  ('discovery-call-virtual', 'Discovery Call — Virtual', 'discovery', 15, 0, 'ZEIGFHBi17SpZ3Ezi5DR'),
  ('entrainment', 'Entrainment', 'entrainment', NULL, 0, 'B5aGXLoS4kzAjZAMMXxk'),
  ('partner-initial', 'Partner Initial Session', 'partner_session', 60, 0, 'lfsnaiGiLNL2z12pLKDP'),
  ('partner-initial-virtual', 'Partner Initial Session — Virtual', 'partner_session', 60, 0, 'P7T6M1w8wtuRfwAqzOVw'),
  ('study-session', 'Amari Study 15-Minute Session', 'study', 15, 0, 'J1N09B6bRYPOGNyVAfmX');

INSERT OR IGNORE INTO packages (id, name, session_credits)
VALUES
  ('four-session-series', '4-Session Series', 4),
  ('eight-session-series', '8-Session Series', 8),
  ('single-initial-session', 'Initial Session', 1),
  ('single-follow-up-session', 'Follow-up Session', 1),
  ('upgrade-initial-to-four', 'Upgrade Initial→4', 3),
  ('upgrade-initial-to-eight', 'Upgrade Initial→8', 7),
  ('upgrade-four-to-eight', 'Upgrade 4→8', 4),
  ('entrainment', 'Entrainment', 0),
  ('living-practice', 'Living Practice', 0);
