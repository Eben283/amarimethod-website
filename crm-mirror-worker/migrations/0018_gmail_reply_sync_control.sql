-- Dormant, per-mailbox operational control for Gmail reply synchronization.
-- This migration does not activate a route, schedule, watch, provider call,
-- delivery path, or GHL fallback.

CREATE TABLE IF NOT EXISTS gmail_reply_sync_controls (
  mailbox_actor TEXT PRIMARY KEY CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL UNIQUE CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  state TEXT NOT NULL CHECK (
    state IN ('baseline_required', 'baselined', 'enabled', 'recovery_required')
  ),
  kill_switch_engaged INTEGER NOT NULL DEFAULT 1 CHECK (kill_switch_engaged IN (0, 1)),
  baseline_history_id TEXT,
  lease_run_id TEXT,
  lease_cursor_before TEXT,
  lease_started_at TEXT,
  lease_expires_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  CHECK (
    (state = 'baseline_required' AND baseline_history_id IS NULL) OR
    (state <> 'baseline_required' AND baseline_history_id IS NOT NULL)
  ),
  CHECK (
    (state = 'enabled' AND kill_switch_engaged = 0) OR
    (state <> 'enabled' AND kill_switch_engaged = 1)
  ),
  CHECK (
    (lease_run_id IS NULL AND lease_cursor_before IS NULL AND lease_started_at IS NULL AND lease_expires_at IS NULL) OR
    (lease_run_id IS NOT NULL AND lease_cursor_before IS NOT NULL AND lease_started_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CHECK (lease_run_id IS NULL OR (state = 'enabled' AND kill_switch_engaged = 0))
);

CREATE TABLE IF NOT EXISTS gmail_reply_sync_control_events (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('baseline_recorded', 'enabled', 'disabled')
  ),
  control_revision INTEGER CHECK (control_revision IS NULL OR control_revision >= 0),
  history_id TEXT,
  reason_code TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, operation_id),
  CHECK (
    (event_type = 'baseline_recorded' AND control_revision IS NULL AND history_id IS NOT NULL AND reason_code IS NULL) OR
    (event_type = 'enabled' AND control_revision IS NOT NULL AND history_id IS NULL AND reason_code IS NULL) OR
    (event_type = 'disabled' AND control_revision IS NULL AND history_id IS NULL AND reason_code IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS gmail_reply_sync_runs (
  id TEXT PRIMARY KEY,
  mailbox_actor TEXT NOT NULL CHECK (mailbox_actor IN ('Eben', 'Garrett')),
  grant_owner TEXT NOT NULL CHECK (
    (mailbox_actor = 'Eben' AND grant_owner = 'eben@amarimethod.com') OR
    (mailbox_actor = 'Garrett' AND grant_owner = 'garrett@amarimethod.com')
  ),
  run_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'partial', 'failed', 'recovery_required')),
  cursor_before TEXT NOT NULL,
  cursor_after TEXT,
  history_records INTEGER NOT NULL DEFAULT 0 CHECK (history_records >= 0),
  messages INTEGER NOT NULL DEFAULT 0 CHECK (messages >= 0),
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed >= 0),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  ignored INTEGER NOT NULL DEFAULT 0 CHECK (ignored >= 0),
  deduped INTEGER NOT NULL DEFAULT 0 CHECK (deduped >= 0),
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (grant_owner, run_id),
  CHECK (started_at <= finished_at),
  CHECK (
    (outcome IN ('succeeded', 'partial') AND cursor_after IS NOT NULL AND error_code IS NULL) OR
    (outcome IN ('failed', 'recovery_required') AND error_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_gmail_reply_sync_runs_recent
  ON gmail_reply_sync_runs(grant_owner, finished_at DESC);

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_control_event_transition_guard
BEFORE INSERT ON gmail_reply_sync_control_events
WHEN (NEW.event_type = 'baseline_recorded' AND EXISTS (
        SELECT 1 FROM gmail_reply_sync_controls control
         WHERE control.mailbox_actor = NEW.mailbox_actor
           AND (control.grant_owner <> NEW.grant_owner
             OR control.state NOT IN ('baseline_required', 'recovery_required'))
      ))
   OR (NEW.event_type = 'enabled' AND NOT EXISTS (
        SELECT 1 FROM gmail_reply_sync_controls control
         WHERE control.mailbox_actor = NEW.mailbox_actor
           AND control.grant_owner = NEW.grant_owner
           AND control.state = 'baselined'
           AND control.kill_switch_engaged = 1
           AND control.lease_run_id IS NULL
           AND control.revision = NEW.control_revision
      ))
BEGIN SELECT RAISE(ABORT, 'invalid gmail reply sync control transition'); END;

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_run_requires_live_lease
BEFORE INSERT ON gmail_reply_sync_runs
WHEN NOT EXISTS (
  SELECT 1 FROM gmail_reply_sync_controls control
   WHERE control.mailbox_actor = NEW.mailbox_actor
     AND control.grant_owner = NEW.grant_owner
     AND control.state = 'enabled'
     AND control.kill_switch_engaged = 0
     AND control.lease_run_id = NEW.run_id
     AND control.lease_cursor_before = NEW.cursor_before
     AND control.lease_started_at = NEW.started_at
     AND control.lease_expires_at >= NEW.finished_at
     AND (
       (NEW.cursor_after IS NULL AND NEW.outcome IN ('failed', 'recovery_required')
        AND control.lease_cursor_before = (
          SELECT observation.history_id FROM gmail_history_observations observation
           WHERE observation.mailbox_actor = NEW.mailbox_actor
             AND observation.grant_owner = NEW.grant_owner
             AND observation.mailbox_address = NEW.grant_owner
           ORDER BY length(observation.history_id) DESC, observation.history_id DESC LIMIT 1
        ))
       OR NEW.cursor_after = (
          SELECT observation.history_id FROM gmail_history_observations observation
           WHERE observation.mailbox_actor = NEW.mailbox_actor
             AND observation.grant_owner = NEW.grant_owner
             AND observation.mailbox_address = NEW.grant_owner
           ORDER BY length(observation.history_id) DESC, observation.history_id DESC LIMIT 1
       )
     )
)
BEGIN SELECT RAISE(ABORT, 'gmail reply sync run requires a live actor lease'); END;

-- Recovery is a fail-closed state. A fresh, append-only baseline event is the
-- only evidence that may move it back to baselined; disable/rollback and direct
-- control-table writes cannot bless the stale cursor.
CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_recovery_requires_new_baseline
BEFORE UPDATE OF state ON gmail_reply_sync_controls
WHEN OLD.state = 'recovery_required'
 AND NEW.state <> 'recovery_required'
 AND NOT (
   NEW.state = 'baselined' AND EXISTS (
     SELECT 1 FROM gmail_reply_sync_control_events event
      WHERE event.mailbox_actor = NEW.mailbox_actor
        AND event.grant_owner = NEW.grant_owner
        AND event.event_type = 'baseline_recorded'
        AND event.history_id = NEW.baseline_history_id
        AND event.occurred_at = NEW.updated_at
   )
 )
BEGIN SELECT RAISE(ABORT, 'gmail reply sync recovery requires a fresh baseline'); END;

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_control_events_no_update
BEFORE UPDATE ON gmail_reply_sync_control_events
BEGIN SELECT RAISE(ABORT, 'gmail reply sync control events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_control_events_no_delete
BEFORE DELETE ON gmail_reply_sync_control_events
BEGIN SELECT RAISE(ABORT, 'gmail reply sync control events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_runs_no_update
BEFORE UPDATE ON gmail_reply_sync_runs
BEGIN SELECT RAISE(ABORT, 'gmail reply sync runs are append-only'); END;

CREATE TRIGGER IF NOT EXISTS gmail_reply_sync_runs_no_delete
BEFORE DELETE ON gmail_reply_sync_runs
BEGIN SELECT RAISE(ABORT, 'gmail reply sync runs are append-only'); END;
