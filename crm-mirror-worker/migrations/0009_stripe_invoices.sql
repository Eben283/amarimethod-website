-- Stripe invoices are source observations for the Client Desk money rail. They
-- do not create payments, ledger entries, subscriptions, or customer actions.
CREATE TABLE IF NOT EXISTS stripe_invoices (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  provider_invoice_id TEXT NOT NULL UNIQUE,
  provider_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  invoice_number TEXT,
  description TEXT,
  provider_status TEXT NOT NULL,
  collection_method TEXT,
  amount_due_cents INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  amount_remaining_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_invoices_contact ON stripe_invoices(contact_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_invoices_customer ON stripe_invoices(provider_customer_id, issued_at DESC);
