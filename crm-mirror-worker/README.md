# Amari CRM mirror worker

This Worker is the read-only import foundation for the internal Amari CRM. It has no cron trigger, no provider write path, and no email/SMS sender. Its only writes are inserts/updates to its own D1 database.

## What it mirrors

- GHL contacts, tags, custom-field values, and contact appointments.
- Stripe settled charges and refund metadata.
- Existing service and package definitions seeded by the first D1 migration.

Stripe charges that cannot be linked to a mirrored GHL contact are retained as unlinked purchase candidates. Package balance is deliberately **not** written to `session_ledger_entries` yet: a full ledger backfill must reconcile purchases against explicit attendance and refunds, rather than guessing from a mutable GHL field.

## Before a conscious deployment

1. Create a dedicated D1 database: `npx wrangler d1 create amari-crm-mirror`.
2. Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID.
3. Set Worker secrets, never values in source: `WORKER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `GHL_CLIENT_ID`, and `GHL_CLIENT_SECRET`.
4. Confirm the `PORTAL_KV` binding is the shared read-only GHL token cache.
5. Apply `migrations/0001_initial_schema.sql` to a disposable/local database first, then the dedicated remote database.
6. Deploy only when explicitly authorized. There is no scheduler; every import requires an authenticated `POST /sync`.

## Authenticated endpoints

- `GET /status` — counts and last sync result; no client data.
- `POST /sync` with optional `{ "sources": ["ghl", "stripe"], "limit": 25 }` — bounded manual import. Both provider integrations use `GET` only.

The normal first run is repeated bounded imports until both providers report `status: "succeeded"`, followed by reconciliation of unlinked purchases and the session ledger in a separate, reviewed change.
