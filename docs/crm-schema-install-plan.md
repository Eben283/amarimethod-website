# CRM schema-migration install plan

`scripts/crm-schema-install-plan.mjs` is an offline, fail-closed generator and
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
```

The production planner recognizes only the pinned production CRM database,
primary-served readback with replication disabled, the exact 239-object v22
catalog digest, 24 migration rows ending at 0022, enabled foreign keys, empty
`foreign_key_check`, and `quick_check=ok`. It also requires a fresh Time Travel
recovery record. Even then, its result explicitly remains unauthorized and
requires separate exact execution approval. Recovery metadata must name the
exact CRM database, an exact Cloudflare Time Travel bookmark, a fresh capture,
an external custody record, and its owner; the offline verifier still cannot
authenticate that bookmark or authorize restoration.

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
stopped. The offline plan does not prove D1 transport atomicity; that remains an
execution-time property to verify before any separately approved request.

The local tests apply migrations 0001–0022, exercise both empty and populated
fixtures, preserve provider-origin contact classifications and existing notes,
prove exact status-fact backfill, prove the second execution is rejected by the
ledger without changing readback, and test partial-installation refusal. These
are local proofs only. They do not establish current production state or grant
installation, release, provider, customer, or cutover authority.
