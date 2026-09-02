# Provider-neutral CRM migration foundation — completion audit

## Scope

This audit covers the local, reviewable migration foundation. It does not claim
that the source is public, installed, deployed, active, operator-accepted, or
ready to retire GHL. Those are deliberately separate external gates.

The foundation succeeds only if Amari-owned identity and evidence survive with
GHL present or absent, every new mutation is replay-safe and attributable,
Staff truth degrades instead of guessing, provider delivery stays behind an
adapter, and no source-only revision can silently activate itself.

## Requirement evidence

| Requirement | Authoritative local evidence | Result |
| --- | --- | --- |
| Stable owned contact and appointment identity | `contacts`, `appointments`, `external_records`, owned appointment commands, provider checkpoints and exact identity-resolution tests | Complete locally |
| Provider-neutral appointment execution | One command owner implements claim → owned write → provider checkpoint → readback/complete or recoverable failure; GHL and Google are adapters | Complete locally; production authority remains unchanged |
| Provider-independent calendar lifecycle | The native runtime integration schedules, enrolls, cancels and deduplicates with both GHL and Google checkpoints; the Google proof has no GHL identity or credentials | Complete locally |
| Partner Initial delivery contract | Six immutable rendered steps, signed manage/calendar links, recursive reschedule identity, exact workflow version and durable effect evidence | Complete locally; hard-shadow |
| No Show recovery and exit | Owned missed-status facts, exact-revision recovery intake, cross-provider rebooking exit, GHL-free CRM reads and provider-neutral SMS/Workspace edges | Complete locally; SMS vendor/cost and activation remain gated |
| Staff attendance truth | Exact-revision attended/no-show/correction commands, immutable facts/events and provider-free derived counters | Complete locally; hard-shadow |
| Staff notes and tasks | Append-only revisions, named actor, idempotency, archive/restore semantics, appointment/contact integrity and merged read models | Complete locally; hard-shadow |
| Contact roles and tags | Replay-safe owned commands alter only `owned:staff` classifications and preserve provider-origin rows | Complete locally; hard-shadow |
| Contact profile and consent | Name/email/phone have independent authority and revisions; email/SMS consent is bound to the exact normalized destination and digest | Complete locally; hard-shadow |
| Import coexistence | GHL and quiz imports refresh provider-mirror fields but cannot overwrite a field family once owned | Complete locally |
| Communication effect boundary | E.164/idempotency SMS service contract, Workspace email edge, prepared attempts and immutable accepted receipts; uncertain transport cannot authorize blind replay | Complete locally; no provider selected or message sent |
| Automation coexistence and dedupe | Owned/GHL dual ingress converges on one Discovery lifecycle; Partnership Discovery deliberately preserves its separate legacy lifecycle; native nurture uses owned CRM identity | Complete locally for the reviewed families |
| Honest Staff/runtime status | Registry and readiness contracts name hard-shadow blockers, missing schema/bindings and degraded reads; no unavailable owned read silently becomes authoritative | Complete locally |
| Schema safety | The v22→v30 additive installer and separate populated-core v30→v31 installer pin exact bytes, catalog transitions, ledger extensions, counts and integrity readback | Complete locally; production installation unauthorized |
| Recovery and lost-response safety | Fresh exact primary snapshots and external Time Travel metadata are required; indeterminate installation never grants replay or rollback | Complete locally |
| Retention coverage | Cross-store inventory includes original quiz evidence and every known dependent contact copy, including notes, tasks, classifications, profiles, attendance and recovery evidence | Complete as an aggregate dry-run inventory |
| Destructive privacy handling | No deletion executor is exposed from this source; immutable operational evidence is not silently erased | Correctly stopped at a separate privacy/policy gate |
| Release provenance | CRM, Reminder and Nurture release guards attest exact Git source closures, preserve durable bindings/secrets and reject stale or mismatched releases | Complete locally |
| Activation containment | Notes, tasks, attendance, classifications, profile writes, owned email delivery and reviewed workflows are source-pinned shadow rather than environment-activatable | Complete locally |

## Verification boundary

The affected local surfaces prove:

- Pages Functions: 172 files / 1,453 tests.
- Reminder Engine: 60 files / 1,743 tests.
- CRM Mirror: 47 files / 393 tests.
- Nurture Engine: 14 files / 128 tests.
- Series reconciliation: 6 files / 71 tests.
- Daily audit: 1 file / 35 tests.
- Morning SMS: 27 tests.
- Staff legibility: 3 files / 28 tests.
- CRM, Reminder and Nurture release guards: 24 tests.
- Portal release plus field-ID, owned-access, app-separation, build-contract
  and published-asset guards: 6 checks.

That is 3,908 passing tests/checks on the cumulative local source. The complete
locked application build reaches and successfully compiles quiz, Portal, Staff,
COS, Parking and Pages Functions. The default npm cache cannot write because of
pre-existing ownership, so the exact Wrangler 4.125.0 Pages compilation is
rerun with an isolated temporary cache. Generated build drift is not included
in this source-only review stack.

## Exact stopping boundary

No additional local feature is required to make the migration foundation
reviewable. The next sequence changes public or production state and must not be
collapsed into one approval:

1. Export the exact cumulative source to a public review branch and observe CI.
2. Merge the exact reviewed head through the guarded source-only lane.
3. Capture a fresh primary production D1 snapshot and recovery bookmark.
4. Install migrations 0023–0030 and stop for exact primary readback.
5. Separately install populated-core migration 0031 and stop for exact primary
   readback.
6. Release exact source-attested CRM and Reminder Workers in shadow mode.
7. Release the exact Pages/Staff source and perform authenticated read-only
   operator verification.
8. Activate one bounded Staff record-work capability at a time, with rollback
   and operator acceptance defined before activation.
9. Select and approve SMS vendor/cost before any owned SMS activation.
10. Approve a privacy/retention policy before any deletion executor exists.
11. Rehearse GHL-denied operation and retire each GHL ingress, sender,
    credential and identifier only after its owned replacement is proven.

Until those gates complete, Staff remains Degraded where production evidence is
missing and GHL remains the live compatibility system. This is intentional; it
is not evidence that the local foundation is incomplete.
