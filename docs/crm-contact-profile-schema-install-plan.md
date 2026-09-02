# CRM contact-profile schema install plan

`scripts/crm-contact-profile-schema-install-plan.mjs` v2 is the separate offline,
fail-closed installer and readback verifier for migration 0031. It starts only
at an exact v30 CRM boundary. It does not connect to Cloudflare, read a secret,
write a remote database, deploy a Worker, call a provider, send a message,
promote authority, or expose rollback.

Migration 0031 is deliberately not folded into the additive v22-to-v30
installer. It alters the populated `contacts` and `consents` tables, adds the
owned contact-profile command table, and adds validation and revision triggers.
The exact artifact is the reviewed migration bytes followed by one standard
`d1_migrations` insert:

- 13,177 bytes
- SHA-256 `b3b8017ffbf9472ed8423edd40cf2aabcf1b0efe2acb12a8a3cebdc228430248`
- migration SHA-256 `b2d80fe9fb58528bf7adebbed6f1de45b3d3b7237a28725874f6cd3db8ab83f6`
- 16 added catalog objects, SHA-256
  `8089c9f7705ee92709cad0bfce7fdea77022127dfc88d61f4cd99a84c8ff97d7`
- two altered catalog definitions (`contacts` and `consents`), before SHA-256
  `d6c3ecc341a92c00172da576f650e4d34f5da60ce19bce19891c19dd90cac81d`
  and after SHA-256
  `983467ffadf7092cf83abd6768165a02225bdbf7d3fefc0fcc8964121650af20`

Reviewers can render the manifest or exact SQL without network access:

```sh
node scripts/crm-contact-profile-schema-install-plan.mjs artifact-manifest
node scripts/crm-contact-profile-schema-install-plan.mjs artifact-sql
node scripts/crm-contact-profile-schema-install-plan.mjs artifact-import-manifest
```

The reviewed production transport is Cloudflare's dedicated D1 SQL-file import
path already proven by the exact v22-to-v30 installation. Its source-only
manifest pins the artifact's MD5 ETag, one `init`, one exact-byte upload and
`ingest` only when requested, at most 60 polls over 300 seconds, and no reissued
`init` or `ingest` after uncertainty. The `init` request is correctly treated as
potentially mutating because a provider-cached artifact may begin processing
without a separate upload or `ingest`. Immediate primary readback remains the
only installation success basis. The transport manifest itself grants no
execution authority.

- artifact MD5 ETag `751480a9353460a2f9025eca0f6153ca`
- 23 local statement boundaries
- canonical import manifest: 1,533 bytes, SHA-256
  `0a3662ef7cadfc8816f36f9432874961da7dffb1150e75df87fd4cfa4ff15125`

The production planner accepts only a fresh primary readback of the pinned
production CRM database with replication disabled, exact v30 catalog and
migration-ledger identity, enabled foreign keys, empty `foreign_key_check`, and
`quick_check=ok`. It separately requires a fresh Time Travel recovery record.
Even a valid plan remains unauthorized and requires exact execution approval.

Post-install verification proves the entire catalog transition, the one-row
ledger extension, preservation of every existing application-table count, and
an empty new command table. Local populated-fixture tests additionally prove
that existing contact identity, contact tags and roles, and legacy consent rows
survive while the new authority defaults and revision counters are installed.
Replay fails before the database changes.

If an installation response is lost, the outcome classifier never grants retry
authority. It classifies only an unchanged exact v30 state or the complete exact
v31 postcondition from fresh primary readback. Any partial, stale, replica,
wrong-database, catalog, ledger, row-count, or integrity mismatch is refused.
This source does not authorize installation, deployment, rollback, provider
change, customer action, or authority promotion.
