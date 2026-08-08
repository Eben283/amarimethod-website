-- Staff acknowledgement is mirror-local. It intentionally does not mutate GHL
-- conversations or message state.
CREATE TABLE IF NOT EXISTS client_desk_seen (
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  staff_actor TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, staff_actor)
);

CREATE INDEX IF NOT EXISTS idx_client_desk_seen_actor ON client_desk_seen(staff_actor, seen_at DESC);
