# Amari CRM mirror worker

This Worker is the read-only GHL and Stripe import foundation for the internal Amari CRM. A bounded 15-minute cron sweep reads those providers into its own D1 database and never writes back to either. Separately, the authenticated Staff Client Desk can send an individual email through an already-authorized Google Workspace identity after a same-origin staff action, opt-out/DND check, and immutable audit record. It has no SMS sender.

## What it mirrors

- GHL contacts, tags, custom-field values, and contact appointments.
- Stripe settled charges and refund metadata.
- Review-only purchase-to-contact candidates when one Stripe billing email exactly matches one mirrored contact.
- Existing service and package definitions seeded by the first D1 migration.

Stripe charges that cannot be linked to a mirrored GHL contact are retained as unlinked purchase candidates. Package balance is deliberately **not** written to `session_ledger_entries` yet: a full ledger backfill must reconcile purchases against explicit attendance and refunds, rather than guessing from a mutable GHL field.

An email candidate is evidence for staff review, not a purchase link. The importer never turns it into `purchases.contact_id`, never posts a ledger entry, and never sends a message.

## Provisioning and deployment

The dedicated `amari-crm-mirror` D1 database is bound in `wrangler.jsonc`; its initial schema migration has been applied. The scheduled sweep advances each provider cursor with a bounded read. An authenticated `POST /sync` remains available for an operator-requested import.

`/status` reports separate GHL and Stripe health states, treating a paginated GHL pass as healthy while it advances through the cursor; a source is stale after 45 minutes.

Dashboard: open from Staff → Back office → CRM Mirror (Eben-only). That path calls `POST /api/staff-crm-mirror-access`, which mints a one-time `/dashboard-access/:code` handoff server-side. Direct worker URL visits without a session show a locked shell and never accept a pasted bearer secret in the browser. Full-pass completeness ignores GHL contacts confirmed deleted at the source so ghost `external_records` do not keep the mirror in review.

Worker secrets must always be configured outside source control: `WORKER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET`. `PORTAL_KV` holds the shared GHL token cache and the Google Workspace authorization state; the Staff browser never receives those credentials.

If this Worker is recreated, create a new dedicated D1 database and replace the binding ID before deploying. Never reuse the live automation database.

## Authenticated endpoints

- `GET /status` — counts and last sync result; no client data.
- `GET /readiness` — aggregate completeness, current source health, recovery evidence, and open exception counts; no client data and no sync trigger.
- `GET /reconciliation` — aggregate pending-review counts; no client data.
- `GET /reconciliation/queue?limit=25` — authenticated, bounded review candidates with their source evidence; read-only.
- `GET /reconciliation/review?limit=25` — authenticated read-only workspace data: candidates, unmatched purchases, and package-classification exceptions.

The root dashboard does **not** accept a pasted worker bearer secret in the browser. Operator access is minted by `POST /dashboard-access-link` (bearer, server-side only) into a one-time five-minute handoff URL backed by an opaque high-entropy code in KV; redeeming `/dashboard-access/:code` sets a signed eight-hour HttpOnly browser session and never exposes `WORKER_AUTH_SECRET` in the URL. Staff opens this via `POST /api/staff-crm-mirror-access` (Eben JWT). The root server-renders aggregate counts and source health once the session is present, so the health summary remains visible even in a browser that cannot run the dashboard JavaScript. That session can read only the dashboard's GET endpoints; `POST /sync` and `POST /dashboard-session` continue to require the bearer credential on every request (machine/operator tooling, not the staff UI).

Approval actions require a separate signed 15-minute review session, created only with the bearer credential. Candidate acceptance/rejection and package classification record an `operational_events` audit record; neither action creates a ledger entry.
- `POST /sync` with optional `{ "sources": ["ghl", "stripe"], "limit": 25 }` — bounded manual import. Both provider integrations use `GET` only.

The normal first run is repeated bounded imports until both providers report `status: "succeeded"`, followed by reconciliation of unlinked purchases and the session ledger in a separate, reviewed change.
