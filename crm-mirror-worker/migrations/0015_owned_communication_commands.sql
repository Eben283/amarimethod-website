-- Deepen the already-applied 0010 owned-sender foundation into an idempotent,
-- provider-neutral communication command ledger. This migration activates no
-- delivery adapter and creates no GHL, Gmail, or SMS write path.
ALTER TABLE outbound_delivery_attempts ADD COLUMN idempotency_key TEXT;
ALTER TABLE outbound_delivery_attempts ADD COLUMN message_ref TEXT;
ALTER TABLE outbound_delivery_attempts ADD COLUMN subject_clean TEXT;
ALTER TABLE outbound_delivery_attempts ADD COLUMN body_clean TEXT;
ALTER TABLE outbound_delivery_attempts ADD COLUMN dnd_state TEXT CHECK (dnd_state IN ('on', 'off'));
ALTER TABLE outbound_delivery_attempts ADD COLUMN destination_masked TEXT;
ALTER TABLE outbound_delivery_attempts ADD COLUMN delivery_state TEXT CHECK (delivery_state IN ('not_sent_policy_blocked', 'not_sent_delivery_unavailable'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_delivery_attempts_idempotency
  ON outbound_delivery_attempts(actor, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_delivery_attempts_message_ref
  ON outbound_delivery_attempts(message_ref)
  WHERE message_ref IS NOT NULL;

-- The command/outcome ledger is evidence, not mutable queue state. Enforce the
-- append-only contract in storage so later code cannot silently rewrite it.
CREATE TRIGGER IF NOT EXISTS outbound_delivery_attempts_no_update
BEFORE UPDATE ON outbound_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'outbound delivery attempts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS outbound_delivery_attempts_no_delete
BEFORE DELETE ON outbound_delivery_attempts
BEGIN
  SELECT RAISE(ABORT, 'outbound delivery attempts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS outbound_delivery_events_no_update
BEFORE UPDATE ON outbound_delivery_events
BEGIN
  SELECT RAISE(ABORT, 'outbound delivery events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS outbound_delivery_events_no_delete
BEFORE DELETE ON outbound_delivery_events
BEGIN
  SELECT RAISE(ABORT, 'outbound delivery events are append-only');
END;

-- The shared Communication projection remains mutable for provider mirror
-- corrections. Only provider-neutral outbox evidence is immutable here.
CREATE TRIGGER IF NOT EXISTS owned_outbox_communication_no_update
BEFORE UPDATE ON communication_events
WHEN OLD.provider = 'owned_outbox'
BEGIN
  SELECT RAISE(ABORT, 'owned outbox communication events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS owned_outbox_communication_no_delete
BEFORE DELETE ON communication_events
WHEN OLD.provider = 'owned_outbox'
BEGIN
  SELECT RAISE(ABORT, 'owned outbox communication events are append-only');
END;
