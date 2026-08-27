# Phase D — reliability schema v2 migration readiness

## Result and authority boundary

The exact live-lineage v2 source candidate was designed from website `main`
commit `664affba975bbb5f8c9cc5d638abb240460fc744`. It adds no production-v2
authority. Exact production v1 remains the only schema that Staff may prove.
The source helper can distinguish an exact staged candidate from partial
drift, but both remain fail-closed and unauthorized.

The Phase-A install and rollback files remain **DO NOT APPLY**, unregistered,
unimported, and unapplied. Phase B is deliberately a syntactically
non-executable generator contract, not runnable SQL. The deployment-attestation
recorder remains unimported and `Unknown/runtime_recorder_not_adopted`.
Sending, recording, lifecycle enrollment, GHL, providers, Worker deployment,
and the production database are unchanged.

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
| `production-live-lineage-v2-8c7245a` | `8c7245ae…` | predicted 49+20 source candidate; `authority:false`, `remoteObserved:false` |

Staff may be eligible for `Known` only for the exact production-v1 variant
plus existing complete, fresh reconciliation coverage. Wrong marker bytes,
wrong DDL, the clean-bootstrap shape, partial v2 objects, any v2 marker, or any
unknown future version fail closed as `Degraded/schema_unproven`. Database
read failure remains `Unknown/authority_read_failed`. Empty reconciliation
evidence remains `Degraded/coverage_missing`.

There is deliberately no accepted production-v2 contract in this increment.
The clean-bootstrap b289 variant and the live-lineage 8c candidate have
different candidate migration identities; neither may be used as a final
production migration identity. Exact staged 8c returns
`schema_v2_physical_install_awaiting_promotion`; any v2 marker still returns
`schema_v2_authority_not_defined`.

## Exact live-lineage source candidate

Adding the candidate's 20 v2-only objects to the exact live-v1 projection
produces a 69-object digest of
`8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62`,
not the local candidate target
`b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6`.

The pinned source candidate at
`fixtures/reliability-v2-production-lineage-candidate.v1.json` contains all 69
literal projected rows and records the exact v1 fixture file hash, the 20
additions, candidate checker/toolchain, and explicit `authority:false` and
`remoteObserved:false`. It hashes to `8c7245ae…` and cannot be confused with
clean-bootstrap b289.

`reliability-spine-v2-production-lineage-install.local.sql` repeats the full
49-row historical `(type,name,tbl_name,sql)` projection using JSON/EXCEPT
inside the surrounding officially transactional application, requires the sole exact v1 marker including its trusted
apply time, rejects partial/conflicting v2 objects, and installs the reviewed
20 rows byte-for-byte. Its final gate proves the predicted 69-row closure,
leaves the exact v1 marker and an empty contract table, and requires all four
new physical tables to be empty. It never inserts schema authority.

Candidate compatibility and authorization are separate. Exact f7af input can
be source-compatible while the production migration preflight remains
`ready:false/schema_v2_source_only_not_authorized`. Likewise, exact predicted
8c plus numeric zero-count evidence can be structurally compatible with a
future promotion while remaining `authorized:false` and blocked on a primary
readback.

The rollback candidate accepts only exact staged 8c with the sole exact v1
marker, zero contracts, and all new tables empty, then removes exactly the 20
objects and proves literal f7af again. Emptiness alone is not rollback
authorization: operators must also prove Phase A was never adopted by any
runtime and preserve a before/after evidence bundle.

The Phase-B template cannot parse as SQL. It requires a separately checked-in
primary-D1 Phase-A readback with all 69 literal rows, its file hash and observed
digest, numeric table counts, and a new final migration identity assigned only
after readback. A future generator must place the contract before the marker,
reuse one trusted D1 timestamp, and make the marker the final SQL statement.

Every artifact contains no remote command and is absent from Wrangler,
`schema.sql`, package scripts, migrations, and runtime imports.

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

The local `BEGIN IMMEDIATE` test helper only simulates an officially
transactional application mechanism. The candidate files contain no
`BEGIN`/`COMMIT`; Cloudflare file-import tooling manages its own transaction,
and Worker `exec()` documentation must not be treated as a whole-file rollback
guarantee.

Wrangler 4.125.0 also parsed and executed both candidates against an isolated
local D1. The local database was seeded directly with the exact fixture bytes:
Wrangler's generic SQL-file bootstrap strips inline SQL comments and therefore
cannot recreate the historical f7af sqlite_master text. Against the exact
seed, Phase A executed 29 commands and produced literal 69/8c, rollback
executed 30 commands and restored literal 49/f7af, and an intentionally broken
Phase A returned an error while leaving f7af with no gate or additive object.
This is local compatibility evidence only, not a remote-D1 prediction or
authorization.

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
- [x] Install compatibility proves only exact live f7af while production
  authorization remains explicitly blocked.
- [x] Exact live v1 plus the 20 local candidate objects hashes to `8c7245ae…`,
  proving it cannot satisfy `b289c402…`.
- [x] Candidate interruption, conflict, idempotency, source exclusion, and
  import/deployment guards are tested locally.
- [x] The exact predicted 69-row source fixture, candidate checker, Phase-A
  install candidate, and empty-only rollback candidate reproduce 8c then f7af.
- [x] Phase B is non-executable until an observed primary-D1 readback exists.
- [ ] Independent source review and CI approve the draft candidate PR.
- [ ] A separate authorization permits primary-D1 preflight and Phase A; this
  PR provides no such authorization.
- [ ] The exact Phase-A primary readback is checked in and independently
  verified before any Phase-B SQL is generated.
- [ ] An ordinary authorized lifecycle and operator exception-resolution drill
  later prove the full reliability contract; a schema is never completion.

## Future release and recovery drill

The smallest safe next action is independent review of this draft PR only.
After that, a future separately authorized release must:

1. take a D1 bookmark/backup and record the exact database, primary readback,
   source SHA, candidate file hash, owner, and rollback decision window;
2. prove literal f7af, the exact v1 marker, zero v2 objects/contracts, and the
   required table counts immediately before Phase A;
3. use one officially transactional D1 application mechanism for Phase A;
4. stop, read the primary catalog and counts with `rowsWritten=0`, check in the
   full observed 69-row fixture, and independently recompute its digest;
5. if anything differs, keep Staff Degraded and open a named exception. Use
   the Phase-A rollback only if the exact staged shape is empty, no runtime ever
   adopted it, and the rollback preflight/drill is separately approved;
6. generate Phase B from the observed fixture—not the 8c prediction—then
   independently review and authorize it as a separate release;
7. after promotion, read back the exact marker, contract, catalog, table counts,
   and provider-independent evidence before proposing runtime reader adoption;
8. treat Time Travel restore as destructive emergency recovery only, with an
   operator drill that accounts for in-flight cancellation and overwritten DB
   state.

Until all gates pass, keep every candidate unregistered and unapplied, recorder
adoption off, and Staff fail-closed for every non-v1 shape.
