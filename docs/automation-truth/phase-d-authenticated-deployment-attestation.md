# Phase D — authenticated Follow-Up deployment attestation

## Current result

This phase defines, but does not adopt, a deployment-attestation recorder. The current live sender remains Amari's persisted Follow-Up definition v3. The exact GHL **Follow up session Confirmation email / reminder flow** is Draft v36 rollback.

The recorder remains deliberately inert: no Worker/Pages entrypoint imports it.
Under separate explicit authorizations, Phase A installed the four empty
physical tables and Phase B then promoted the exact production-lineage v2
schema authority once. The promotion SQL is not a Wrangler migration, remains
**DO NOT APPLY**, and is not authorized for replay. Exact primary readback now
proves the final v2 marker, byte-exact contract, and 69-row 8c catalog together.
This observed-evidence source draft changes no binding, remote D1 row,
deployment, GHL workflow, provider setting, customer, or sender behavior. The
recorder's top-level truth remains **Unknown** with
`runtime_recorder_not_adopted`; zero reconciliation coverage keeps Staff
`Degraded/coverage_missing`. Neither may be presented as Live or Healthy.

## What is bound

The canonical release manifest binds the exact repository revision/tree, `package-lock.json`, complete esbuild module catalog and bundle, compiler/spec/plan/handler/message digests, persisted published Follow-Up v3 document digest, both literal `approved` delivery guards, D1 database identity, and schema v2 source plus structural digest. It also binds the `SOURCE_REVISION` and `WORKER_VERSION` plain-value hashes and their exact `SOURCE_REVISION@WORKER_VERSION` composite separately from Cloudflare's version ID. `amari-canonical-json.v1` sorts object keys and rejects non-JSON values; a pinned fixture and locale-independent array ordering make the digest portable across JavaScript runtimes.

The external attestor signs the strict canonical envelope with Ed25519. Its private key must remain outside the reminder Worker. A later recorder may receive only an allowlisted public-key ring with opaque rotation IDs and validity windows. The strict shape rejects unknown fields (including designated raw-payload/client-identifier/secret fields), and secret bindings retain presence only rather than a value. That shape does not prove every allowed opaque string is free of sensitive text. Malformed timestamps, stale evidence, and unknown/retired keys fail closed.

The observation has four separate authority references and digests:

1. GitHub build provenance: repository, source revision/tree, lockfile, bundle, complete module catalog, compiler/spec/compiled-plan/handler/message inputs, schema migration source, and release-manifest digest.
2. Cloudflare control plane: deployment, version, traffic, and non-secret binding projection.
3. remote D1 schema readback: migration, required table coverage, and structural hash.
4. remote D1 workflow readback: published state, exact v3 document, and version.

A signature authenticates the attestor's statement; it does not turn an unsupported caller assertion into evidence. Missing/permission-denied/incomplete/stale authority projects Unknown. An authenticated known mismatch projects Broken, even when the same envelope is stale.

## Production-lineage schema source

`reminder-engine-worker/reliability-spine-v2.local.sql` defines three requested evidence tables plus one supporting authority table:

- `automation_release_manifests`
- `automation_deployment_attestations`
- `source_event_runtime_provenance`
- `reliability_schema_contracts`

The fourth table is intentional. The historical v1
`reliability_schema_versions` row has no structural digest or object catalog,
and altering that existing marker is neither safely idempotent nor enough to
prove remote structure. The support table stores the immutable migration ID,
named canonicalization, full required object catalog, and non-self-referential
structure digest. The exact production-lineage Phase-B contract now provides
that separately reviewed authority without modifying the historical v1 row.

`sqlite-master-required-closure.v1` hashes exact `sqlite_master` SQL after normalizing only CRLF/CR line endings to LF; it does not rewrite whitespace inside SQL literals. Its required closure includes every named object used by the active reminder executor and reliability spine, plus all indexes/triggers attached to those tables. An unexpected trigger or index on a required table invalidates postflight.

The original clean-bootstrap source remains local evidence only. Historical
production v1 hashes to `f7af1024…`, while clean bootstrap hashes to
`cd57730…`; adding the same 20 objects produces exact production-lineage
`8c7245ae…`, not clean-bootstrap `b289c402…`. The separately authorized Phase A
and primary readback proved all 69 literal rows, the sole unchanged v1 marker,
zero contracts, empty additive tables, and no transient gate. The immutable
observed fixture file hashes to
`a51924927c49d9981e8fe77cebd66c079acbd4f18413f6a47242f52aee4fcaef`.

The deterministic generator accepts only that fixture and emits promotion SQL
with SHA-256
`8af94319d15c184085b79f22c0b3054546ae59528c51f66f8094909e9b9df55c`.
It binds final migration identity
`reliability-spine-v2-production-lineage-8c7245ae`, repeats the complete
catalog and additive-object gates, requires all four tables empty, inserts the
exact contract first with D1 time, revalidates every contract byte, and inserts
the v2 marker from the same timestamp as the final SQL statement. Re-run,
candidate IDs, existing evidence, partial/wrong/extra objects, and timestamp
mismatch fail closed. The source file remains unregistered. It was imported
exactly once under the consumed Phase-B authorization; it is now an immutable
audited source and must not be replayed.

The coordinated health reader proves exact v1 or exact final v2 only. Primary
D1 now returns `schema_v2_exact_authority`; all inconsistent states still fail
closed. Schema authority does not create reconciliation evidence: exact v2
with zero coverage is `Degraded/coverage_missing`, and only a separate complete
fresh coverage row can yield `Known`.

The inert release-manifest and attestation-store modules consume the same final
production-lineage schema constant, so future records cannot silently retain
the clean-bootstrap candidate ID. They remain runtime-unimported. Schema
promotion did not authorize recorder adoption or produce a release manifest,
deployment attestation, or runtime-provenance row.

The authorized promotion used a fresh primary preflight, recovery bookmark,
pinned Wrangler 4.125.0 remote D1 file import, and exact
marker/contract/catalog postflight. Its process exited 0 but emitted non-JSON
stdout, so no provider apply receipt is claimed and no retry occurred. Exact
primary state—not process output—is the success basis. Pre-promotion bookmark
`000024cc-00000016-000050d4-f8c03021259ccaf75b391cd075661925` and
post-promotion bookmark
`000024cc-00000024-000050d4-e61b5dded0148fe961ef9ca82805c1f3` pin the
recovery boundary. The literal rows and limitations are recorded in
`fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json`
(SHA-256
`cc9783c2e4ac903ff33307dec3e707a603c194a1d8bfb24e8b02183d0dae9537`).
That fixture keeps the trusted D1 marker time distinct from the later
SELECT-only observation window (`2026-08-27T04:25:51Z` through
`2026-08-27T04:27:31Z`), binds the Worker readback to that same window, and
pins the exact postflight scripts and count query by SHA-256.
After promotion the Phase-A empty-only rollback is invalid; default recovery is
a reviewed forward repair/new schema version, with Time Travel reserved for
separately authorized destructive emergency recovery.

## Staged recorder behavior

`functions/lib/reliability-deployment-attestation-store.js` is unimported. In tests it:

- verifies Ed25519 authenticity, exact identities, separate authorities, and exclusive freshness before any write;
- records a trusted `recorded_at` within the attestation window and rechecks the recorder clock immediately before the D1 batch;
- atomically/idempotently stores the canonical manifest and attestation;
- returns the immutable first rows on exact replay;
- permits a fresh renewal of the same unchanged deployment/version;
- refuses overlapping contradictory authority as Broken;
- prepares a provenance insert intended for a future composite source/lifecycle/obligation acceptance batch; the current bare statement cannot enforce that transaction boundary.

The provenance row pins CF version metadata, loaded workflow digest, schema-closure digest, and both literal delivery guards. Database triggers also require an accepted Follow-Up source, its matching Follow-Up lifecycle/runtime identity, at least one obligation, retention equal to the earliest parent retention deadline, and an unexpired attestation.

## Runtime-adoption blockers

The staged helper is not enough to cut over. All of these gates remain required:

1. The runtime must internally derive `CF_VERSION_METADATA.id`, the exact published v3 document it loaded, the current schema closure, and both literal guards. Caller-supplied values are not authority.
2. `workflow_versions` does not currently expose a digest that a trigger can compare. A future acceptance boundary must close the attestation-to-loaded-document TOCTOU gap (for example by comparing exact canonical document text inside the same transaction). `workflow_document_sha256_at_bind` alone does not prove the current D1 row.
3. `acceptLifecycle` does not yet include provenance. A separately reviewed `acceptLifecycleWithProvenance`-style plan must batch source, all plan-derived obligations, immutable first provenance, and acceptance transitions together. A detached helper call is insufficient.
4. The batch must prove the exact complete compiled obligation set/count/digest, not merely the existence of one obligation.
5. Replay must return and compare the original immutable provenance; it must never rebind an existing lifecycle to a later deployment.
6. Dispatch and provider effects must require that first provenance. Any mismatch/expiry/unknown authority must produce a deterministic existing-spine exception and no dispatch/effect.
7. `source.runtime_version` currently uses `SOURCE_REVISION@WORKER_VERSION`, which is distinct from a raw Cloudflare version ID. The adoption design must preserve that meaning while explicitly joining it to `CF_VERSION_METADATA.id`.
8. `effectOwner: Amari/live` is a declaration, not proof that GHL is non-effectful. Any sole-owner/Live projection requires fresh independent GHL ownership evidence; Draft v36 rollback is the reconciled current state, not something this envelope proves.
9. An ordinary authorized lifecycle plus provider receipts and an operator exception-resolution drill must prove source event → durable receipt → lifecycle → exact obligations → provider evidence → outcome/exception. No synthetic/backfill or HTTP 200 substitutes for that evidence.
10. Each digest domain must be pinned before adoption: canonical parsed executable workflow bytes rather than ambiguous raw JSON, the exact Cloudflare module-upload/bundle byte model, evidence-document schema versions, and schema-migration source bytes. Golden cross-runtime fixtures must prove each algorithm; a field named `sha256` is not enough.
11. The adoption review must set bounded manifest/envelope/module/binding sizes and preserve public-key, evidence, and authority rows for the full normalized 400-day audit-retention window. The attestor key owner, rotation/revocation procedure, deletion path, and exception owner must be named.
12. The external attestor must enforce typed allowlists and redaction for every opaque identifier/reference before signing; strict JSON shape alone is not a privacy or secret scanner.
13. Immutable acceptance provenance for version A cannot authorize a later provider command executed by version B. Command preparation/evidence must bind and verify the current executor/version at effect time under its own fresh authority without rewriting the original acceptance provenance; the original 15-minute attestation is historical evidence and is not expected to remain fresh forever.

Until every runtime-adoption gate passes in a separately authorized behavior
release, the recorder remains a tested contract/adapter preview only. The
production schema authority is exact v2, but sender behavior and runtime
recorder behavior are unchanged.
