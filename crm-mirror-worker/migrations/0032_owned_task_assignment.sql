-- Add explicit Staff assignment to immutable owned task versions.
--
-- Existing task history remains unassigned. Assignment is copied across state-only
-- transitions and can change only through a new create/revise content version.

ALTER TABLE owned_task_versions
  ADD COLUMN assigned_to TEXT CHECK (assigned_to IS NULL OR assigned_to IN ('Eben', 'Garrett'));

CREATE INDEX IF NOT EXISTS idx_owned_task_versions_assignment
  ON owned_task_versions(assigned_to, state, due_at, recorded_at DESC, task_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS owned_task_version_state_change_preserves_assignment
BEFORE INSERT ON owned_task_versions
WHEN NEW.action IN ('complete', 'reopen', 'archive', 'restore')
 AND EXISTS (
  SELECT 1
    FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.revision = (
       SELECT MAX(latest.revision) FROM owned_task_versions latest
        WHERE latest.task_id = NEW.task_id
     )
 )
 AND NOT EXISTS (
  SELECT 1
    FROM owned_task_versions current
   WHERE current.task_id = NEW.task_id
     AND current.revision = NEW.prior_revision
     AND current.assigned_to IS NEW.assigned_to
 )
BEGIN SELECT RAISE(ABORT, 'owned task assignment conflict'); END;
