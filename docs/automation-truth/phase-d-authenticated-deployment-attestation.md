# Phase D — authenticated Follow-Up deployment attestation (source only)

## Current result

This phase defines, but does not adopt, a deployment-attestation recorder. The current live sender remains Amari's persisted Follow-Up definition v3. The exact GHL **Follow up session Confirmation email / reminder flow** is Draft v36 rollback.

The committed source is deliberately inert: no Worker/Pages entrypoint imports it; the SQL is not a Wrangler migration; no binding, remote D1 row, deployment, Staff surface, GHL workflow, provider setting, customer, or sender behavior changes. Its top-level truth therefore remains **Unknown** with `runtime_recorder_not_adopted`. It must never be presented as Live or Healthy.

## What is bound

The canonical release manifest binds the exact repository revision/tree, `package-lock.json`, complete esbuild module catalog and bundle, compiler/spec/plan/handler/message digests, persisted published Follow-Up v3 document digest, both literal `approved` delivery guards, D1 database identity, and schema v2 source plus structural digest. It also binds the `SOURCE_REVISION` and `WORKER_VERSION` plain-value hashes and their exact `SOURCE_REVISION@WORKER_VERSION` composite separately from Cloudflare's version ID. `amari-canonical-json.v1` sorts object keys and rejects non-JSON values; a pinned fixture and locale-independent array ordering make the digest portable across JavaScript runtimes.

The external attestor signs the strict canonical envelope with Ed25519. Its private key must remain outside the reminder Worker. A later recorder may receive only an allowlisted public-key ring with opaque rotation IDs and validity windows. The strict shape rejects unknown fields (including designated raw-payload/client-identifier/secret fields), and secret bindings retain presence only rather than a value. That shape does not prove every allowed opaque string is free of sensitive text. Malformed timestamps, stale evidence, and unknown/retired keys fail closed.

The observation has four separate authority references and digests:

1. GitHub build provenance: repository, source revision/tree, lockfile, bundle, complete module catalog, compiler/spec/compiled-plan/handler/message inputs, schema migration source, and release-manifest digest.
2. Cloudflare control plane: deployment, version, traffic, and non-secret binding projection.
3. remote D1 schema readback: migration, required table coverage, and structural hash.
4. remote D1 workflow readback: published state, exact v3 document, and version.

A signature authenticates the attestor's statement; it does not turn an unsupported caller assertion into evidence. Missing/permission-denied/incomplete/stale authority projects Unknown. An authenticated known mismatch projects Broken, even when the same envelope is stale.

## Local-only schema candidate

`reminder-engine-worker/reliability-spine-v2.local.sql` proposes three requested evidence tables plus one supporting authority table:

- `automation_release_manifests`
- `automation_deployment_attestations`
- `source_event_runtime_provenance`
- `reliability_schema_contracts`

The fourth table is intentional. The deployed v1 `reliability_schema_versions` row has no structural digest or object catalog, and altering that existing marker is neither safely idempotent nor enough to prove remote structure. The support table stores the immutable migration ID, named canonicalization, full required object catalog, and non-self-referential structure digest. Any future migration must separately approve this fourth table.

`sqlite-master-required-closure.v1` hashes exact `sqlite_master` SQL after normalizing only CRLF/CR line endings to LF; it does not rewrite whitespace inside SQL literals. Its required closure includes every named object used by the active reminder executor and reliability spine, plus all indexes/triggers attached to those tables. An unexpected trigger or index on a required table invalidates postflight.

Migration markers are last. A future runner must reject conflicting existing v2 markers before beginning, execute in one transaction, compare the exact object catalog and structural digest after execution, then commit. `INSERT OR IGNORE` is not itself conflict proof. The current health reader recognizes only v1 and reports v2 as Degraded/schema-unproven; its coordinated compatibility release is a hard prerequisite to any remote migration.

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

Until every gate passes in a separately authorized behavior release, this phase is a tested contract/schema/adapter preview only and production behavior is unchanged.
