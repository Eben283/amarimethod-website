# 0001: Canonical executable workflows

Status: Accepted

## Context

Staff previously rendered workflow metadata and readiness labels from a separate registry while the reminder Worker executed code and recorded enrollments elsewhere. A production rollback exposed that those copies could disagree.

## Decision

Every owned automation will have one versioned Canonical Workflow document. The engine derives execution behavior from that document, and Staff reads the same document from the executing runtime. Published versions are immutable. Existing enrollments remain pinned to their recorded version; only new enrollments enter a newly published version.

Editing will create a Draft Version. Validation and publishing promote a complete draft; visual editing, backend editing, and agent-assisted editing must all use the same workflow interface.

## Consequences

- Staff cannot maintain separate triggers, steps, exits, messages, or live-state labels.
- Runtime unavailability is shown as unknown, never as zero or inactive.
- Message rendering must move into the Canonical Workflow before the visual editor can claim complete editability.
- The migration can proceed one workflow at a time, beginning with Initial-session reminders.
