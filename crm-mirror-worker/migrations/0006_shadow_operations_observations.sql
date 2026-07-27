-- These tables are an append-only record of what the existing source systems
-- reported. They are deliberately separate from session_ledger_entries: an
-- observed GHL balance, Stripe charge, refund, or appointment state never
-- creates a client credit/debit by itself.

CREATE TABLE IF NOT EXISTS balance_source_observations (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source = 'ghl'),
  sessions_remaining INTEGER NOT NULL CHECK (sessions_remaining >= 0),
  observed_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_balance_source_observations_contact
  ON balance_source_observations(contact_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS payment_source_events (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source = 'stripe'),
  event_type TEXT NOT NULL CHECK (event_type IN ('charge', 'refund_delta')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  occurred_at TEXT,
  observed_at TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_payment_source_events_purchase
  ON payment_source_events(purchase_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_source_events_contact
  ON payment_source_events(contact_id, observed_at DESC);

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

-- Establish the first comparison point from data already safely imported into
-- this mirror. Future importer passes append only when a source value changes.
INSERT OR IGNORE INTO balance_source_observations
  (id, contact_id, source, sessions_remaining, observed_at, source_key)
SELECT lower(hex(randomblob(16))), attribute.contact_id, 'ghl', CAST(TRIM(attribute.attribute_value) AS INTEGER),
       datetime('now'), 'baseline-ghl-balance:' || attribute.contact_id
FROM contact_attributes attribute
WHERE attribute.source = 'ghl'
  AND attribute.attribute_key = 'wrQSkx6BhXwDGIn1d0V4'
  AND TRIM(attribute.attribute_value) <> ''
  AND TRIM(attribute.attribute_value) NOT GLOB '*[^0-9]*';

INSERT OR IGNORE INTO payment_source_events
  (id, purchase_id, contact_id, source, event_type, amount_cents, currency, occurred_at, observed_at, source_key)
SELECT lower(hex(randomblob(16))), purchase.id, purchase.contact_id, 'stripe', 'charge', purchase.amount_cents,
       purchase.currency, purchase.purchased_at, datetime('now'), 'stripe-charge:' || purchase.provider_charge_id
FROM purchases purchase;

INSERT OR IGNORE INTO payment_source_events
  (id, purchase_id, contact_id, source, event_type, amount_cents, currency, occurred_at, observed_at, source_key)
SELECT lower(hex(randomblob(16))), purchase.id, purchase.contact_id, 'stripe', 'refund_delta', -purchase.amount_refunded_cents,
       purchase.currency, purchase.purchased_at, datetime('now'), 'stripe-refund:' || purchase.provider_charge_id || ':' || purchase.amount_refunded_cents
FROM purchases purchase
WHERE purchase.amount_refunded_cents > 0;

INSERT OR IGNORE INTO appointment_source_observations
  (id, appointment_id, contact_id, source, provider_calendar_id, status, starts_at, ends_at, observed_at, source_key)
SELECT lower(hex(randomblob(16))), appointment.id, appointment.contact_id, 'ghl', appointment.provider_calendar_id,
       appointment.status, appointment.starts_at, appointment.ends_at, datetime('now'), 'baseline-ghl-appointment:' || appointment.id
FROM appointments appointment;
