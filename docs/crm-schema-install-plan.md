# CRM schema-migration install plan

`scripts/crm-schema-install-plan.mjs` v2 is an offline, fail-closed generator and
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
```

The production HTTP request must use the [D1 Query API's `batch`
body](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), not put
the complete trigger-bearing artifact into one `sql` field. The latter shape
was rejected before results by production D1 with `incomplete input` and exact
primary readback proved that nothing was installed. The source artifact above
is unchanged. The transport projection splits it only at complete top-level
SQLite statement boundaries and pins one transaction-shaped HTTP body:

- body kind `d1_rest_query_batch_v1`
- 101 complete statements
- 48,039 canonical JSON bytes
- SHA-256 `2e4015ee122171177fadec4475beaa74f58b42d263b61324af275a98454bf150`

Cloudflare's Query API explicitly accepts a `batch` array, and [Cloudflare's D1
batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) says the statements
execute sequentially as a transaction and the sequence aborts or rolls back if
one fails. The local regression applies
the exact 101 statements inside one SQLite transaction, proves the unchanged
v22→v30 catalog/data postcondition, and proves a replay failure rolls the whole
batch back. The offline generator still grants no execution or retry authority.

The production planner recognizes only the pinned production CRM database,
primary-served readback with replication disabled, the exact 239-object v22
catalog digest, 24 migration rows ending at 0022, enabled foreign keys, empty
`foreign_key_check`, and `quick_check=ok`. It also requires a fresh Time Travel
recovery record. Even then, its result explicitly remains unauthorized and
requires separate exact execution approval. The plan pins both the unchanged
SQL artifact and the exact batch-request digest. Recovery metadata must name the
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
stopped. The offline plan requires the provider batch transaction and exact
readback; it does not make a provider response trustworthy by assertion.

The local tests apply migrations 0001–0022, exercise both empty and populated
fixtures, preserve provider-origin contact classifications and existing notes,
prove exact status-fact backfill, prove the second execution is rejected by the
ledger without changing readback, and test partial-installation refusal. These
are local proofs only. They do not establish current production state or grant
installation, release, provider, customer, or cutover authority.
