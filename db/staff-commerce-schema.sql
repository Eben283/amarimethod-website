-- Staff-owned commerce catalog and immutable paid-sale receipts.
-- Apply once to the ATTEND_DB / amari-attendance D1 database before publishing
-- Staff Products. Product versions and receipts are append-only evidence.

CREATE TABLE IF NOT EXISTS staff_products (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  create_request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_product_versions (
  product_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  category TEXT NOT NULL CHECK (category IN ('service', 'practice-support', 'retail')),
  internal_reason TEXT NOT NULL CHECK (length(internal_reason) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 2000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  product_kind TEXT NOT NULL DEFAULT 'simple' CHECK (product_kind = 'simple'),
  fulfillment_policy TEXT NOT NULL DEFAULT 'none' CHECK (fulfillment_policy = 'none'),
  available_in_pos INTEGER NOT NULL DEFAULT 1 CHECK (available_in_pos IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (product_id, version),
  FOREIGN KEY (product_id) REFERENCES staff_products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_product_exact_version
  ON staff_product_versions(lower(name), amount_cents);

CREATE TABLE IF NOT EXISTS staff_product_events (
  event_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'versioned', 'archived')),
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (product_id, product_version)
    REFERENCES staff_product_versions(product_id, version)
);

CREATE TABLE IF NOT EXISTS staff_pos_receipts (
  receipt_id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE,
  contact_id TEXT,
  customer_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  paid_at TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  issued_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_pos_receipt_lines (
  receipt_id TEXT NOT NULL,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  product_id TEXT,
  product_version INTEGER,
  label TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_amount_cents INTEGER NOT NULL CHECK (unit_amount_cents > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents > 0),
  fulfillment_policy TEXT NOT NULL CHECK (fulfillment_policy = 'none'),
  PRIMARY KEY (receipt_id, line_index),
  FOREIGN KEY (receipt_id) REFERENCES staff_pos_receipts(receipt_id)
);

CREATE TRIGGER IF NOT EXISTS staff_product_versions_no_update
BEFORE UPDATE ON staff_product_versions BEGIN
  SELECT RAISE(ABORT, 'staff product versions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS staff_product_versions_no_delete
BEFORE DELETE ON staff_product_versions BEGIN
  SELECT RAISE(ABORT, 'staff product versions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS staff_product_events_no_update
BEFORE UPDATE ON staff_product_events BEGIN
  SELECT RAISE(ABORT, 'staff product events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS staff_product_events_no_delete
BEFORE DELETE ON staff_product_events BEGIN
  SELECT RAISE(ABORT, 'staff product events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS staff_pos_receipts_no_update
BEFORE UPDATE ON staff_pos_receipts BEGIN
  SELECT RAISE(ABORT, 'staff receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS staff_pos_receipts_no_delete
BEFORE DELETE ON staff_pos_receipts BEGIN
  SELECT RAISE(ABORT, 'staff receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS staff_pos_receipt_lines_no_update
BEFORE UPDATE ON staff_pos_receipt_lines BEGIN
  SELECT RAISE(ABORT, 'staff receipt lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS staff_pos_receipt_lines_no_delete
BEFORE DELETE ON staff_pos_receipt_lines BEGIN
  SELECT RAISE(ABORT, 'staff receipt lines are immutable');
END;
