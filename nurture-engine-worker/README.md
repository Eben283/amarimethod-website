# Owned nurture engine

This standalone Worker is the provider-neutral replacement foundation for Amari's acquisition
nurture sequences. It uses owned contacts, tags, attributes, exact immutable templates, D1
enrollment state, and first-class exits. Every reviewed sequence is still `shadow`; GHL remains
the live nurture owner.

Authenticated routes:

- `POST /event` accepts normalized entry/exit events, including the exact owned quiz event handed
  off by CRM Mirror's durable shadow outbox.
- `POST /import` accepts a reviewed batch of fresh provider-enrollment cursor evidence. It rejects
  time-only guesses, stale snapshots, schedule mismatches, and already-overdue next actions.
- `POST /run` performs a sweep.
- `GET /status` reports liveness.
- `GET /delivery-readiness` returns aggregate-only dispatch/submission evidence and exceptions.

Owned email submission is built but not enabled. It requires all of:

1. A reviewed sequence changed from `shadow` to `active` in source.
2. `NURTURE_EMAIL_DELIVERY_RELEASE=approved` in the Worker environment.
3. `NURTURE_EMAIL_SEQUENCE_ALLOWLIST` containing that exact known sequence ID as a JSON array.

The adapter uses Garrett's server-owned Google Workspace identity and never falls back to GHL.
It atomically claims a pending step before provider I/O. A crash leaves a visible `dispatching`
exception rather than an automatic duplicate. Gmail acceptance is recorded as `submitted`, never
as delivered; a provider acceptance without CRM evidence becomes `submission_unreconciled` and is
also never automatically retried.

No route changes a provider workflow, activates a sequence, or retires GHL. Production D1
installation, deployment, live cursor collection/import, and lifecycle authority cutover are
separate guarded operations.
