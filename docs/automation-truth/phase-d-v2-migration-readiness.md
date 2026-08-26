# Phase D — reliability schema v2 migration readiness

## Result and authority boundary

This increment was designed from website `main` commit
`29b1cb3380ba3cfbac0e1904aac653532c1a5660`. It makes one intentional,
read-only Staff diagnostic change: reliability health proves the exact
production-v1 schema before it may expose authoritative counts. It does not
change sending, recording, lifecycle enrollment, GHL, providers, or the
production database.

Both v2 SQL files remain unregistered, unimported, unapplied local candidates.
The deployment-attestation recorder remains unimported and
`Unknown/runtime_recorder_not_adopted`. Follow-Up behavior and effect
ownership are unchanged.

## Proven production-v1 authority

An authorized read-only remote D1 readback on 2026-08-26 returned:

- database: `amari-automation`;
- exact marker: v1, `reliability-spine-v1`, expected description,
  `applied_at=1787631973000`;
- exact required closure: 49 objects;
- `sqlite-master-required-closure.v1` digest:
  `f7af1024be129a24cb8a68a0c70a4bd3a8820104f9a5e36a58df97bbe7bbdd4f`;
- `served_by=v3-prod`, `served_by_primary=true`;
- marker and structure queries reported `rows_written=0` and
  `changed_db=false`; the structure query reported `rows_read=202`.

The sanitized exact projection, marker, query provenance, full source SHAs, and
three-row diff are checked in at
`fixtures/reliability-v1-production-structure-readback.v1.json`. The fixture
contains schema DDL only—no customer rows or identifiers.

The clean-bootstrap `schema.sql` fixture has the same 49 object names but a
different digest:
`cd57730cfbf6a04cc3db670e0b299a27041191e880684eb86acd134ab734f5a2`.
The exact differences are:

1. `idx_evt_engine_flow`: historical line-break formatting;
2. `automation_events`: `definition_version` was historically
   `ALTER`-appended at the end; and
3. `reminder_enrollments`: `definition_version` was historically
   `ALTER`-appended, nullable, and without the clean-bootstrap default.

The commits that introduced the base schema and later definition-version
change are recorded as full 40-character SHAs in the fixture.

## Explicit schema variants

| Variant | Digest | Authority |
| --- | --- | --- |
| `production-live-v1-f7af1024` | `f7af1024…` | the only current production authority |
| `clean-bootstrap-v1-cd57730` | `cd57730…` | local candidate evidence only |
| `clean-bootstrap-v2-b289c40` | `b289c402…` | local candidate evidence only; not production authority |

Staff may be eligible for `Known` only for the exact production-v1 variant
plus existing complete, fresh reconciliation coverage. Wrong marker bytes,
wrong DDL, the clean-bootstrap shape, partial v2 objects, any v2 marker, or any
unknown future version fail closed as `Degraded/schema_unproven`. Database
read failure remains `Unknown/authority_read_failed`. Empty reconciliation
evidence remains `Degraded/coverage_missing`.

There is deliberately no accepted production-v2 contract in this increment.
Even a marker and physical catalog matching the local b289 candidate returns
`schema_v2_authority_not_defined`.

## Why Phase A is blocked

Adding the candidate's 20 v2-only objects to the exact live-v1 projection
produces a 69-object digest of
`8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62`,
not the local candidate target
`b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6`.

Therefore production preflight returns
`ready:false/schema_v2_target_not_reconciled_with_live_v1` for exact live v1.
It does not green-light a file that would immediately make Staff Degraded.
Both SQL headers say **DO NOT APPLY** and contain no copy-pastable remote
execution command. Neither file is registered in Wrangler, `schema.sql`,
package scripts, migrations, or runtime imports.

The local files remain useful evidence: their ordinary in-transaction guard
tables reject conflicting/partial state, Phase A leaves the v1 marker untouched,
and Phase B derives trusted apply time from D1 before placing the candidate v2
marker last. Those local properties do not make the candidate compatible with
the historical production lineage.

## D1 correctness boundary

Cloudflare documents these relevant semantics:

- Worker `D1Database.batch()` is transactional; one failed statement aborts
  and rolls back the sequence:
  <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>.
- A failing `wrangler d1 migrations apply` migration is rolled back:
  <https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply>.
- A failed remote SQL-file import returns the database to its original state:
  <https://developers.cloudflare.com/d1/get-started/#5-deploy-your-application>.
- Time Travel restore overwrites the database in place and cancels in-flight
  work. It is destructive emergency recovery, not the correctness mechanism:
  <https://developers.cloudflare.com/d1/reference/time-travel/#restore-a-database>.

D1 SQL has no SHA-256 primitive. A JavaScript digest readback after a successful
transaction can detect mismatch but cannot retroactively roll it back. A future
migration must preserve a real stop between physical installation and authority
promotion and must not claim atomicity across that stop.

## Acceptance evidence

- [x] Sanitized full 49-row live-v1 projection is checked in and hashes to
  `f7af1024…`.
- [x] The prior marker-only reader and the strict reader both accept the current
  live marker; the strict reader additionally proves the exact live structure.
- [x] Live fixture plus fresh coverage preserves the existing
  `Known/authoritative_and_fresh` Staff result.
- [x] Local clean-bootstrap v1 is distinctly labeled and fails production
  authority rather than becoming a second accepted shape.
- [x] Wrong v1 marker/DDL, partial v2, every v2 marker, and future versions fail
  closed.
- [x] Production preflight on exact live v1 is explicitly blocked.
- [x] Exact live v1 plus the 20 local candidate objects hashes to `8c7245ae…`,
  proving it cannot satisfy `b289c402…`.
- [x] Candidate interruption, conflict, idempotency, source exclusion, and
  import/deployment guards are tested locally.
- [ ] A production-v2 target based on the exact live lineage is designed and
  reviewed.
- [ ] Only after that review may a separately authorized remote migration,
  readback stop, and later authority-promotion proposal be prepared.
- [ ] An ordinary authorized lifecycle and operator exception-resolution drill
  later prove the full reliability contract; a schema is never completion.

## Smallest safe next action

Design a new additive v2 target from the checked-in exact live-v1 projection,
compute its exact expected remote closure/digest, and independently review the
migration and stop conditions. Until then, keep both candidate SQL files
unregistered and unapplied, keep recorder adoption off, and keep Staff
fail-closed for every non-v1 shape.
