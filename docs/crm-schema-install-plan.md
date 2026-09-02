# CRM schema-migration install plan

`scripts/crm-schema-install-plan.mjs` v3 is an offline, fail-closed generator and
readback verifier for the exact CRM Mirror migration boundary from production
v22 through local v30. It does not import a Cloudflare client, read a secret,
open a remote database, deploy a Worker, call a provider, send a message, mutate
a customer, promote authority, or expose rollback.

The source contract pins all eight migration SHA-256 digests. The generated SQL
is exactly the reviewed bytes for migrations 0023 through 0030 plus one standard
`d1_migrations` insert after each file. Its current identity is:

- 46,181 bytes
- SHA-256 `5be18c203f2fbf6051ad454d0fc84e0335f55a6261ef5b91e0eccc215135fb8e`
- eight migration-ledger inserts
- 117 additive catalog objects, SHA-256
  `506daf9eb086b8462f5d4a8e37132244812d9b5495a4936150e90720d1e2214f`

This is not literally DDL-only: migration 0026 deterministically adds one
immutable `migration_baseline` status fact per existing appointment. It does not
change the appointment row, contact row, provider row, message state, payment
state, or authority selector. Any production approval must name this bounded
derived-evidence backfill rather than describing the request as data-free.

Reviewers can render the manifest or exact SQL without network access:

```sh
node scripts/crm-schema-install-plan.mjs artifact-manifest
node scripts/crm-schema-install-plan.mjs artifact-sql
node scripts/crm-schema-install-plan.mjs artifact-batch-manifest
node scripts/crm-schema-install-plan.mjs artifact-batch-json
node scripts/crm-schema-install-plan.mjs artifact-import-manifest
```

Both [D1 Query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
projections are now rejection evidence only. Production rejected both the
complete trigger-bearing artifact in one `sql` field and the exact 101-entry
`batch` body before results with `incomplete input`; immediate primary readback
proved that neither installed anything. They must not be retried. The source
artifact above is unchanged, and the rejected batch remains pinned for audit:

- body kind `d1_rest_query_batch_v1`
- 101 complete statements
- 48,039 canonical JSON bytes
- SHA-256 `2e4015ee122171177fadec4475beaa74f58b42d263b61324af275a98454bf150`

The locally valid statements and transaction proof remain useful SQLite
evidence, but production showed that Query API acceptance cannot be inferred
from it. The reviewed production transport is now Cloudflare's dedicated
[SQL-file import API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/),
which generates a temporary upload URL, validates the file with its MD5 ETag,
then ingests and polls that exact uploaded file. Wrangler uses this path for
`d1 execute --remote --file`; Cloudflare documents that imports block D1 for
their duration. The pinned source-only protocol is:

- body kind `d1_remote_sql_file_import_v1`
- canonical import-manifest identity: 1,801 bytes, SHA-256
  `654045f8a269f8fb6bac565a14c636a9bb3cd041d01fd20908943326dd53fbb7`
- artifact MD5 ETag `f059063a3c391dbe41d6f46f196c95ca`
- exact 46,181-byte artifact SHA-256 `5be18c203f2fbf6051ad454d0fc84e0335f55a6261ef5b91e0eccc215135fb8e`
- one logical import operation beginning with exactly one `init`
- if `init` requires upload: one exact-byte upload with response-ETag verification, then one `ingest`
- if the file is already cached: `init` may begin ingestion directly, so no upload or separate `ingest` is sent
- bounded status polling only; no second `init` or `ingest` after any uncertain phase
- immediate primary readback classification remains mandatory

The generated import manifest pins every fixed method/body/limit and identifies
the provider-returned upload URL, filename and polling bookmark as the only
variable custody values. It grants no execution or retry authority.

The production planner recognizes only the pinned production CRM database,
primary-served readback with replication disabled, the exact 239-object v22
catalog digest, 24 migration rows ending at 0022, enabled foreign keys, empty
`foreign_key_check`, and `quick_check=ok`. It also requires a fresh Time Travel
recovery record. Even then, its result explicitly remains unauthorized and
requires separate exact execution approval. The plan pins both the unchanged
SQL artifact and exact file-import manifest. Recovery metadata must name the
exact CRM database, an exact Cloudflare Time Travel bookmark, a fresh capture,
an external custody record, and its owner; the offline verifier still cannot
authenticate that bookmark or authorize restoration.

The established v22 production digest is `normalized_sql_whitespace_v1`: it
collapses formatting-only whitespace in each `sqlite_schema.sql` value before
hashing, exactly matching the preflight that recorded `6c290183…`. Object type,
name, table ownership, SQL tokens and the complete object set remain pinned.
Exact before/after transition proof still compares the captured catalog bytes,
so this normalization cannot conceal an application-schema change.

Post-install proof removes the 117 pinned additions and requires the remaining
catalog to equal the entire pre-install catalog byte-for-byte. It requires the
eight ledger rows in order, preserves every pre-existing application-table
count, requires all new command/evidence tables to be empty, and expects exactly
one `migration_baseline` status fact for every pre-existing appointment. A
partial catalog, changed object SQL, changed base row count, ledger gap, foreign
key violation, failed quick check, replay, wrong database, replica read, or stale
snapshot is a refusal.

If the installation response is lost, the outcome classifier never retries. A
fresh exact v22 readback is classified `not_installed`; an exact v30 catalog,
ledger, integrity result and complete count-preservation match is classified
`installed_schema_migrations_only`; anything else remains indeterminate and
stopped. The offline plan requires the provider file-import protocol and exact
readback; it does not make a provider response trustworthy by assertion.

The local tests apply migrations 0001–0022, exercise both empty and populated
fixtures, preserve provider-origin contact classifications and existing notes,
prove exact status-fact backfill, prove the second execution is rejected by the
ledger without changing readback, and test partial-installation refusal. These
are local proofs only. They do not establish current production state or grant
installation, release, provider, customer, or cutover authority.
