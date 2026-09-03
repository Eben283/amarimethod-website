# Automation-exit contract recovery

Scope: the three existing reminder families only—Initial / Assessment in person,
Initial virtual, and Follow-Up. This change is source and test recovery only:
every workflow remains in `shadow` mode and no Cloudflare, GHL, calendar,
contact, message, payment, or sender behavior changes.

## What this establishes

- Each existing workflow node now has a contract record with an owner,
  transport, success evidence, idempotency key, failure owner, exit behavior,
  and downstream guarantee.
- Temporary GHL dependencies are named rather than assumed.
- Follow-Up requires a distinct `appointmentEventType` / Normal predicate.
- Source provenance is fail-closed: a release is only `bound` when the
  cloud release path supplies both the Git revision and Worker version.

## Current blocker deliberately left visible

Historical commits `81d6171b`, `9903fff9`, and `7a1b5fdf` are not
reachable in GitHub. Cloudflare exposes Worker version IDs but not their Git
revision. This PR therefore does not claim that any current runtime derives
from a particular source revision.

The next approved cloud-release change must inject `SOURCE_REVISION` and
`WORKER_VERSION` at deploy time, expose the resulting provenance through the
authenticated runtime status, and read it back. That change is intentionally
outside this PR because it requires a Cloudflare deployment.

## Before any controlled booking proof

Read back the existing GHL Appointment Events Webhook target, method, redacted
header shape, and payload. Confirm that it produces stable contact and
appointment identifiers, then prove a native all-DND booking reaches the
Follow-Up v2 enrollment. Do not activate owned delivery or retire GHL based on
this source-only recovery.
