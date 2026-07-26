# Amari CRM mirror worker

This Worker is the read-only import foundation for the internal Amari CRM. It has no cron trigger, no provider write path, and no email/SMS sender. Its only writes are inserts/updates to its own D1 database.

## What it mirrors

- GHL contacts, tags, custom-field values, and contact appointments.
- Stripe settled charges and refund metadata.
- Existing service and package definitions seeded by the first D1 migration.

Stripe charges that cannot be linked to a mirrored GHL contact are retained as unlinked purchase candidates. Package balance is deliberately **not** written to `session_ledger_entries` yet: a full ledger backfill must reconcile purchases against explicit attendance and refunds, rather than guessing from a mutable GHL field.

## Provisioning and deployment

The dedicated `amari-crm-mirror` D1 database is bound in `wrangler.jsonc`; its initial schema migration has been applied. The deployed Worker remains deliberately dormant: it has no scheduler, and every import requires an authenticated `POST /sync`.

Worker secrets must always be configured outside source control: `WORKER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `GHL_CLIENT_ID`, and `GHL_CLIENT_SECRET`. `PORTAL_KV` is the shared read-only GHL token cache.

If this Worker is recreated, create a new dedicated D1 database and replace the binding ID before deploying. Never reuse the live automation database.

## Authenticated endpoints

- `GET /status` — counts and last sync result; no client data.
- `POST /sync` with optional `{ "sources": ["ghl", "stripe"], "limit": 25 }` — bounded manual import. Both provider integrations use `GET` only.

The normal first run is repeated bounded imports until both providers report `status: "succeeded"`, followed by reconciliation of unlinked purchases and the session ledger in a separate, reviewed change.
