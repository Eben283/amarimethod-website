# Phase D — reliability schema v2 migration readiness

## Result and authority boundary

The exact live-lineage v2 source candidate was reviewed and merged as website
`main` commit `6076a6feea38b1fc61638d84166ceff1d42202f8`. Under separate explicit
authorizations, the reviewed Phase-A physical install and the reviewed Phase-B
authority promotion were each applied exactly once to primary
`amari-automation` D1. Primary readback now proves the exact 69 literal rows and
digest `8c7245ae…`, the exact historical v1 marker, the exact final v2 marker,
and one byte-exact v2 contract whose trusted D1 `applied_at=1787803363000`
matches the v2 marker.

The install, rollback, and promotion source files remain **DO NOT APPLY** and
unregistered. Install and promotion have each exhausted their one
authorization and are not authorized for replay; rollback was not applied and
is no longer valid after authority promotion. The deployment-attestation
recorder remains unimported and `Unknown/runtime_recorder_not_adopted`.
Schema authority is now exact v2, but reconciliation coverage remains empty,
so Staff correctly reports `Degraded/coverage_missing` rather than Live or
Healthy. This observed-evidence source increment performs no database, Worker,
GHL, provider, sender, recorder, or lifecycle action.

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
| `production-live-v1-f7af1024` | `f7af1024…` | exact historical production-v1 authority preserved as the v2 base marker |
| `clean-bootstrap-v1-cd57730` | `cd57730…` | local candidate evidence only |
| `clean-bootstrap-v2-b289c40` | `b289c402…` | local candidate evidence only; not production authority |
| `production-live-lineage-v2-8c7245a` | `8c7245ae…` | immutable pre-promotion Phase-A physical-state evidence only |
| `production-live-lineage-v2-authority-8c7245a` | `8c7245ae…` | current primary production schema authority; exact final marker, contract, and catalog are present |

Staff may be eligible for `Known` only for exact production v1 or exact final
production v2 plus complete, fresh reconciliation coverage. Wrong marker
bytes, wrong DDL, the clean-bootstrap shape, partial v2 objects, unrecognized
or mismatched v2 states, and unknown future versions fail closed as
`Degraded/schema_unproven`. Database read failure remains
`Unknown/authority_read_failed`. Empty reconciliation evidence remains
`Degraded/coverage_missing`.

Primary D1 now has the exact production-v2 contract and marker. The final
migration identity is
`reliability-spine-v2-production-lineage-8c7245ae`, distinct from both
candidate identities. The source authority assessor now proves
`schema_v2_exact_authority` only because it reads exactly two markers (the
historical v1 plus final v2), one byte-exact final contract with the same
`applied_at`, and the exact 69-row 8c closure. Marker-only, contract-only,
candidate IDs, timestamp mismatch, wrong or extra required-table objects, and
future versions continue to fail closed.

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

The candidate fixture remains immutable prediction provenance. The separate
observed-primary fixture at
`fixtures/reliability-v2-production-lineage-observed-primary.v1.json` records
the exact matching primary bytes and uses `remoteObserved:true` while retaining
`authority:false`, `promotionAuthorized:false`, the non-final candidate
migration identity, and the sole exact v1 marker.

`reliability-spine-v2-production-lineage-install.local.sql` repeats the full
49-row historical `(type,name,tbl_name,sql)` projection using JSON/EXCEPT
inside the surrounding officially transactional application, requires the sole exact v1 marker including its trusted
apply time, rejects partial/conflicting v2 objects, and installs the reviewed
20 rows byte-for-byte. Its final gate proves the predicted 69-row closure,
leaves the exact v1 marker and an empty contract table, and requires all four
new physical tables to be empty. It never inserts schema authority.

Candidate compatibility and authorization were separate gates. Exact f7af was
source-compatible before the one Phase-A authorization, and exact staged 8c
plus numeric zero-count evidence was structurally compatible before the one
Phase-B authorization. Those authorizations are now consumed. The immutable
candidate and pre-promotion fixtures remain provenance; neither authorizes a
replay.

The rollback candidate accepts only exact staged 8c with the sole exact v1
marker, zero contracts, and all new tables empty, then removes exactly the 20
objects and proves literal f7af again. Emptiness alone is not rollback
authorization: operators must also prove Phase A was never adopted by any
runtime and preserve a before/after evidence bundle.

`generate-reliability-v2-production-lineage-promotion.mjs` accepts only the
immutable observed-primary fixture with exact SHA-256
`a51924927c49d9981e8fe77cebd66c079acbd4f18413f6a47242f52aee4fcaef`
and the exact production-v1 fixture. It rejects candidate-only or mutated
evidence and deterministically emits
`reliability-spine-v2-production-lineage-promote.local.sql`. The emitted file
has SHA-256
`8af94319d15c184085b79f22c0b3054546ae59528c51f66f8094909e9b9df55c`.
It repeats
the full 69-row catalog and exact 20-addition gates, requires the sole exact v1
marker, no existing contract, and numeric zero rows in all four additive
tables. It inserts and byte-revalidates the exact contract first, uses one D1
timestamp, then inserts the final v2 marker from the contract as the final SQL
statement. Exact replay and every conflict are deliberately rejected before a
committed write. Under the one explicit Phase-B authorization, this exact file
was imported once through pinned Wrangler 4.125.0. The process exited 0 but its
stdout was not parseable JSON; it was not retried. Success is proven only by
the independent exact primary postflight described below, not by a claimed
provider apply receipt.

The inert Phase-D release-manifest and attestation-store modules now consume
the final production-lineage schema constant instead of the incompatible
clean-bootstrap candidate ID. They remain absent from runtime entrypoints.
Schema promotion creates no reconciliation coverage: the existing zero-row
coverage state remains `Degraded/coverage_missing` until a separate complete,
fresh reconciliation run exists.

Every artifact contains no remote command and is absent from Wrangler,
`schema.sql`, package scripts, migrations, and runtime imports.

## Observed primary Phase-A evidence

The authorized Phase-A evidence is pinned as follows:

- source `main`: `6076a6feea38b1fc61638d84166ceff1d42202f8`;
- reviewed install SHA-256:
  `ba649a4ccb533583d111450c842f9ea5e5e4d223e401a9be7f691c3b306f43a1`;
- database ID: `089d810a-9d2d-43a4-8f1d-dc3620835557`;
- recovery bookmark:
  `000024cc-00000000-000050d4-2f6dbfafd655c4f7aa2d365265c99d80`;
- final bookmark:
  `000024cc-0000000e-000050d4-37d5ac8f2e9cfdadff33c21853674cc0`;
- primary readback time: `2026-08-27T02:39:38Z`;
- exact required closure: 69 rows, 20 additions, digest `8c7245ae…`;
- sole exact v1 marker unchanged, zero schema-contract rows, all four new
  tables empty, transient gate absent, and all prior table counts unchanged;
- every postflight query was served by primary `v3-prod` and reported
  `rows_written=0` and `changed_db=false`.

The checker independently rebuilds literal f7af, applies the reviewed Phase-A
source in an isolated transaction, compares all 69 projected rows byte for byte
with both prediction and observed fixtures, recomputes 8c, then proves the
candidate rollback returns literal f7af. This does not turn the observed shape
into authority or authorize rollback/promotion.

## Observed primary Phase-B authority evidence

The one authorized Phase-B import used exact website source
`06c4abe956415fe6c736edfcd9cf96365eef739c`, reviewed PR #503 merge
`54c1595fa39f7b4a924701519f92b4346543d3ef`, tree
`f7edcce5646b72235181a7a686863ae6aa2c32f6`, and promotion SQL SHA-256
`8af94319d15c184085b79f22c0b3054546ae59528c51f66f8094909e9b9df55c`.
It targeted D1 `089d810a-9d2d-43a4-8f1d-dc3620835557` in Cloudflare account
`fa2b6f2441129b259dd5dea74045721b` through pinned Wrangler 4.125.0.

The recovery boundary is pinned by pre-promotion bookmark
`000024cc-00000016-000050d4-f8c03021259ccaf75b391cd075661925` and
post-promotion bookmark
`000024cc-00000024-000050d4-e61b5dded0148fe961ef9ca82805c1f3`.
The trusted D1 marker time is `2026-08-27T04:02:43.000Z`; it is not presented
as the observation time. A fresh SELECT-only evidence capture ran from
`2026-08-27T04:25:51Z` through `2026-08-27T04:27:31Z`, including the Worker
deployment readback. Every D1 read in that capture was served by primary
`v3-prod` and reported
`rows_written=0` and `changed_db=false`. It proved:

- literal 69-row required closure and digest `8c7245ae…` unchanged;
- exact v1 and final v2 marker rows;
- exactly one contract with the full expected-object JSON, final identity,
  8c digest, and the same `applied_at=1787803363000` as the v2 marker;
- release-manifest, deployment-attestation, source-runtime-provenance, and
  reconciliation counts all zero;
- no transient promotion gate; and
- standalone reminder Worker deployment unchanged at deployment
  `fa1d09eb-a0af-47e9-bc6e-a44652d59dc9`, version
  `121f69d8-770f-4c58-adab-0574bece9f1d`.

The immutable source fixture
`fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json`
has SHA-256
`cc9783c2e4ac903ff33307dec3e707a603c194a1d8bfb24e8b02183d0dae9537` and
records the literal marker and contract rows, full source/apply/readback
provenance, evidence limitations, bookmarks, counts, authority-assessor
result, coverage state, and Worker non-deployment proof. It pins rather than
duplicates the existing immutable 69-row physical projection fixture. Its
checker also pins the exact postflight and authority-readback script hashes and
the exact 545-byte count query (SHA-256 `d910319d…`), and rejects any marker,
contract, catalog, timestamp, primary-read,
coverage, attempt-count, bookmark, or deployment drift.

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

The authorized Phase-B application used pinned Wrangler 4.125.0's remote D1
file-import path (`d1 execute` with its remote and file flags; no runnable
command is recorded here) after a fresh account/database, catalog, marker,
emptiness, and recovery-bookmark preflight. Cloudflare's failed-import rollback
statement and the disposable local atomicity test were supporting evidence;
the exact primary postflight is the authority result. The non-JSON stdout is
not treated as a provider receipt, and no retry occurred. Arbitrary Worker
`exec()` remains an unapproved substitute.

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
- [x] Wrong v1 marker/DDL, partial v2, every unrecognized or mismatched v2
  state, and future versions fail closed.
- [x] Install compatibility proves only exact live f7af while production
  authorization remains explicitly blocked.
- [x] Exact live v1 plus the 20 local candidate objects hashes to `8c7245ae…`,
  proving it cannot satisfy `b289c402…`.
- [x] Candidate interruption, conflict, idempotency, source exclusion, and
  import/deployment guards are tested locally.
- [x] The exact predicted 69-row source fixture, candidate checker, Phase-A
  install candidate, and empty-only rollback candidate reproduce 8c then f7af.
- [x] Phase B remained non-executable until an observed primary-D1 readback
  existed.
- [x] Independent review and CI approved source candidate PR #500; it merged as
  website `main` `6076a6fe…`.
- [x] Separate authorization permitted exact primary preflight and Phase A;
  bookmark, apply, and read-only postflight evidence are recorded above.
- [x] The exact Phase-A primary projection is pinned in a distinct observed
  fixture and independently recomputed by the source checker.
- [x] The observed-primary fixture merged through PR #501 at exact website
  `main` `cd78ea6f267c65fc31c6c6c85ce6b378bba3216a` after independent review
  and CI.
- [x] Independent review and CI approved generated Phase-B source PR #503 at
  reviewed head `4702fcf7…`; it merged as `54c1595f…` with reviewed tree
  `f7edcce5…` and remained unregistered.
- [x] Separate explicit authorization permitted one exact primary Phase-B
  import. No replay occurred; exact primary postflight, bookmarks, literal
  marker/contract rows, catalog, counts, coverage, and Worker non-deployment
  evidence are pinned in the observed-promotion fixture.
- [ ] An ordinary authorized lifecycle and operator exception-resolution drill
  later prove the full reliability contract; a schema is never completion.

## Future release and recovery drill

The smallest safe next action is independent review of the immutable observed
promotion evidence source only. The authority promotion is complete; it does
not authorize recorder adoption. After that evidence merges, the remaining
behavior gate is an ordinary authorized lifecycle plus provider receipts and
an operator exception-resolution drill. Any later behavior release must keep
schema authority and reconciliation coverage separate, prove fresh runtime
provenance at the effect boundary, and fail closed when either is missing.

After a contract and v2 marker exist, the Phase-A empty-only rollback is no
longer valid. Default recovery is a reviewed forward repair/new schema version;
Time Travel remains a separately authorized destructive emergency action.
Because exact replay is rejected, an ambiguous retry must first read the
marker, contract, catalog, and bookmark rather than rerunning the SQL.

Do not reapply Phase A or Phase B. Keep rollback unregistered and unapplied,
recorder adoption off, and Staff visibly `Degraded/coverage_missing` until a
separately reviewed reconciliation increment proves complete fresh coverage.
