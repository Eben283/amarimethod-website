# Follow-Up reconciliation v1 — source-only contract

Status: reconciliation merged as #510 at `282b9686554dfcf794d09861c0ebff87d78a76dd`, execution-evidence linkage as #517 at `d74308c62f0f38c58ec77f1e486a9fcfbc8a7d49`, and coverage selection as #519 at `d3fdf35368f85409776860fce51a40720528ea2f`. The current-inventory adapter below is the subsequent local, unpublished increment. All contracts remain non-authoritative and deliberately unable to make Staff healthy.

## Source provenance and boundary

- Repository: `https://github.com/Eben283/amarimethod-website.git`
- Historical initial inspected base: `61b0f57861355dc80bf0c22a500171ba495086b1`; the reviewed public source head is `9c1b9f1aec520fcfd546b97cf032228f6f8e5654` (previously rebased onto `origin/main` at `0cb98cfa55c844c80a24b345349a355eea0e939c`). The local refresh is the clean two-parent merge of that public head and exact current-main `43ddd635b2ea225481cd9f1a7793deee9e68905e`.
- Family: `follow-up-session-reminders`
- Source identity: `ghl:appointment-events-webhook:vN`
- Runtime identity: `<40-hex source revision>@follow-up-reminder-engine.vN`
- Contract: `follow-up-reconciliation.v1`
- Row authority label: `SOURCE_ONLY_SELF_REPORTED`. This identifies a non-authoritative source-only row; it is not evidence authority.
- Evidence scope: `self_reported_integrity_only`.

`functions/lib/follow-up-reconciliation.js` and the local drill are not imported by any production Worker, Pages function, scheduler, route, or package script. `FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE` is absent from Wrangler and production entrypoints. Its exact reviewed value exists only as a second source-code guard; it does not authorize deployment or scheduling. The already-live `reliability-store.js` Staff read path is deliberately hardened by this PR: legacy count-only rows cannot become Known, v1 is capped, and unsupported families fail closed. Deploying website/Pages bytes can therefore change Staff's read-only health wording, although the current empty reconciliation table remains Degraded with `coverage_missing`. This PR does not send, enroll, change GHL, call a provider, deploy the reminder Worker, or write production D1.

The production D1 read-only audit on 2026-08-26 observed exact schema v2 and 12 source events, 46 transitions, 5 lifecycle instances, 29 obligations, 7 open exceptions, and 7 exception events. It observed zero release manifests, deployment attestations, source-runtime provenance bindings, command attempts, provider receipts, and reconciliation runs. Those are observations, not proof of a completed lifecycle.

## Permanent v1 truth cap

Every valid v1 detail must say:

- `simulation: true`
- `authority: false`
- `producerAdopted: false`
- `state: degraded`
- `evidenceScope: self_reported_integrity_only`

No input or component count can lift v1 to Known. Component evaluations that are internally consistent remain Degraded with an explicit self-reported/unverified reason. Query, permission, or timeout failures remain Unknown. Staff recomputes schema authority, validates exact canonical bytes and row bindings, detects same-clock ambiguity and staleness, and never trusts narrative prose. The SHA-256 detail digest proves byte integrity and deterministic replay only; it is neither authentication nor provenance.

`reconciliation_runs` does not yet have database no-update/no-delete triggers. That is acceptable only because v1 is permanently non-authoritative and never Known. Append-only database enforcement is a required promotion gate.

## Exact local collection law

The owned cohort is `[expectedStart, expectedEnd)`, selected by `source_events.received_at`. The 14 cohort, owned-ledger, exception-audit, runtime-provenance, and local-receipt queries execute in one D1 batch/snapshot; schema authority is read separately and remains Degraded/self-reported in v1. Linked source, lifecycle, obligation, command, provenance, and receipt evidence is cutoff-bounded. Exception audit events are read through the current snapshot so the mutable exception state can be checked against its immutable route. Invalid, open, zero-width, future, or over-31-day windows fail before a database read.

The cutoff controls cohort and evidence inclusion, not historical reconstruction. Mutable obligation, command, exception, and workflow-version state is whatever the database holds when the collector reads it. V1 does not claim that those mutable fields are an as-of-`expectedEnd` snapshot.

The batch boundary uses Cloudflare's documented [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). A missing, falsy, sparse, failed, or malformed result slot fails the whole local snapshot closed.

The local collector verifies:

- exact source version/runtime bindings;
- contiguous, monotonic receipt routes, including the legal accepted replay interleaving around one durable `dispatched` transition;
- source receipt and acceptance clocks;
- one active accepted lifecycle, no rejected lifecycle, and exact family/scope/runtime links;
- the current published/retired workflow row, its document digest, and a `published_at` no later than lifecycle creation;
- deterministic obligation identity plus exact key, family, kind, owner, closer, due time, and skip direction, using the same `defineWorkflow`, `executableFlow`, and `enroll` functions as the runtime rather than a parallel schedule evaluator;
- pending or leased deadlines overdue before the cutoff, and expired leases;
- prohibited command effects on skipped/cancelled obligations;
- cohort-linked exception state backed by its immutable opened/transition route, including the exact rejected-source opening evidence;
- conservative global orphan guards, explicitly named `globalOrphan*` because an orphan cannot be family-attributed after its parent is missing.

The owned identity digest binds every assertion-driving selected source, transition, lifecycle, actual obligation, command, cohort exception, workflow identity, and global-orphan fact. The expected-obligation digest binds the executable definition-derived obligation set. Neither digest contains raw person, appointment, provider reference, or normalized payload text; sensitive inputs are omitted or hashed. Detail bytes, arrays, version identities, and opaque identifiers are bounded and grammar-checked.

Because `workflow_versions` has no `retired_at` history and is not immutable, a retired row plus `published_at` cannot prove that the definition was still active when a lifecycle was created. This remains an explicit v1 limitation and promotion gate; the current published Follow-Up v3 row can satisfy only the narrower current-row integrity check above.

Top-level `window.paginationComplete` means only that the single local D1 batch completed. It says nothing about GHL or provider pagination.

A failed batch records Unknown owned/runtime/provider components with null evidence, `paginationComplete:false`, and `coverageStart=coverageEnd=expectedStart`; it never records an empty successful cohort or full coverage. Staff validates this failed-snapshot contract before range checks and preserves Unknown plus objective stale/schema annotations.

V1 accepts only active lifecycle rows because no audited lifecycle-state transition writer exists yet. Completed, cancelled, superseded, and exception lifecycle states remain incomplete until an explicit terminal-state evidence law is implemented. Exception queue transitions are a separate, already audited state machine.

No recurrence, overlap, or late-evidence carry-forward law is authorized. Non-overlapping source-receipt windows could omit later receipts or far-future obligations belonging to older sources. Runtime adoption therefore requires a separately designed active-lifecycle and late-evidence window law; this source-only collector is not cadence-ready.

## Component evidence scopes

| Component | v1 evidence | Truth boundary |
|---|---|---|
| Schema | Current D1 schema authority read, then reader-side cross-check | Still Degraded/self-reported in v1; a read failure is Unknown |
| Owned ledger | One bounded D1 cohort snapshot and exact local invariants | Degraded even when internally consistent |
| Runtime provenance | Local release/attestation/binding rows only | Missing/incomplete unless exact durable records exist; never authenticates v1 overall |
| GHL appointment-event source coverage | No readback adapter in this increment | Missing; cursor false; proves neither sender ownership nor delivery |
| Provider receipts | Local D1 receipt ledger only | External cursor remains false; local counts cannot prove provider coverage |

Current ownership is not inferred from a GHL component: Amari persisted Follow-Up definition v3 is live, and GHL **Follow up session Confirmation email / reminder flow** v36 is rollback. Any future GHL evidence here is limited to the **Appointment Events Webhook source execution/readback**. It cannot establish who sent a reminder, whether a provider accepted it, or whether a client received it.

The GHL accountability vocabulary is fixed and bounded: owner `Eben`, documented cadence `weekly`, and limitation code `appointment_events_webhook_source_execution_only_no_sender_ownership`. These fields describe evidence governance only and do not authorize a schedule. Staff currently uses a 24-hour freshness limit, so a weekly producer would honestly show stale for most of the week unless a separately reviewed policy changes. Cadence remains a proposal, not authorization.

## Insert-only writer and rollback boundary

The source-only writer collects before one INSERT, uses `recon_<detail SHA-256>` as deterministic identity, performs exact post-insert readback, treats byte-identical races as replay, and fails a conflicting identity with a typed error. It has no UPDATE, DELETE, provider adapter, network call, or fallback/random identity.

The collector/writer and drill remain unimported, so this increment has no production sending, provider, GHL, or D1-write behavior to roll back. The Staff read-model truth change is live if Pages deploys and rolls back by reverting this PR. Enabling a collector runtime import, binding, cron, route, or production write is a separate behavior release and cutover decision.

## Local operator drill

`reminder-engine-worker/src/follow-up-reconciliation-drill.js` is an in-memory, zero-network transition-mechanics drill. It proves a simulated linked exception is visible as open, acknowledged, and investigating, disappears from the active queue only after resolved, and that stale/reused/mid-batch transitions do not append false audit evidence.

It is explicitly `mechanicsOnly: true`, `providerReceiptObserved: false`, and `obligationOutcomeProven: false`. The obligation remains pending and no receipt is invented. Therefore it does **not** satisfy the canonical ordinary lifecycle/operator-resolution acceptance gate and must never be described as a live operator drill.

## Execution-evidence linkage planner

`functions/lib/follow-up-execution-evidence.js` is an unimported, pure, source-only planner (`follow-up-execution-evidence.v1`). It recomputes the existing source/lifecycle/obligation identities, binds one exact Follow-Up workflow document digest, node, legacy enrollment occurrence, and prospective pre-send attempt, and returns only `prospective_linkage`, `historical_unlinked`, or `unknown`. It rejects reschedule reuse, incompatible versions/nodes/clocks, missing or conflicting receipt references, and caller-supplied authority fields. Acceptance-time and executor-time runtime identities are separate and can differ only when each is structurally bound to the same workflow document.

The `legacy.sourceEventId` and effective-start projection are proposed, independently verified bindings for a future adapter; they are **not** columns in current `reminder_enrollments` or `reminder_steps` and must never be synthesized from appointment ID plus step index. Likewise, acceptance and executor projections are caller-supplied structural inputs, not authenticated attestation rows. The document digest detects changed authored content under the same version but does not authenticate the document or provenance.

Every result is permanently `sourceOnly:true`, `simulation:true`, `authority:false`, `dispatchAllowed:false`, and `outcomeProven:false`. Caller-supplied rows and digests are not authenticated; the planner is not an attestor. Historical sent, Gmail-accepted, or GHL-delivered observations never manufacture a pre-send attempt or close an obligation. A future adapter must independently validate and durably write evidence; that is a separate behavior release.

## Coverage-selection planner

`functions/lib/follow-up-coverage-selection.js` is a pure candidate planner (`follow-up-coverage-selection.v1`), imported only by the inert current-inventory adapter and tests, not production entrypoints. Its explicit half-open received and ingestion windows select new source receipts and exactly linked late-ingested evidence separately; `plannedAt` is only an as-of check, so future-due unresolved obligations remain candidates. It unions unresolved active lifecycles, pending/leased/overdue obligations, every non-resolved exception (including temporary suppression), prior unresolved carry-forward, and named retention, parent, or terminal-state anomalies. Stable IDs are required at every join; appointment/step guesses and `updated_at` inference are forbidden.

The proposed adapter projection supplies one rooted cursor chain whose pages bind the same snapshot and exact windows, plus explicit family on exceptions, anomalies, and carry-forward. A complete structural chain is still not authenticated coverage. Missing, repeated, disconnected, empty, or bounded-overflow traversal remains incomplete; the planner never silently truncates unresolved candidates. Every result remains source-only/simulated with `authority:false`, `dispatchAllowed:false`, and `outcomeProven:false`; it has no database, provider, scheduling, or terminal-proof behavior.

This is selection over supplied projections, not a database reader or an authenticated change feed. An `ingestedAt` clock must eventually come from durable, independently verified ingestion evidence; an old provider event timestamp or mutable `updated_at` cannot stand in for it. A retained candidate's absence or a caller-supplied terminal state cannot prove resolution. Retention expiry is a gap, never permission to forget unfinished work or recreate lost evidence. Candidate limits are deliberate validation bounds, not a production-scale retention policy.

The interface is `planFollowUpCoverageSelection({ snapshotPages, previousCarryForward, cutoff })`:

- `cutoff` supplies nonnegative integer `receivedStart/receivedEnd`, `ingestedStart/ingestedEnd`, `plannedAt`, and bounded `maxPages/maxCandidates`. Both windows are half-open and end no later than `plannedAt`. Future obligation deadlines are allowed.
- Each page binds a `snapshotId`, both windows, `cursor/nextCursor`, and arrays of `sources`, `lifecycles`, `obligations`, `exceptions`, `evidence`, and `anomalies`. Hard limits are 20 pages, 200 rows per array and 200 candidate identities. A root cursor is null; a terminal next cursor is null. Supplied pages may be unordered but must form one connected chain. `traversalComplete` is only the caller's structural assertion, never external completeness proof.
- `previousCarryForward` supplies `candidates` in the returned retained-candidate shape and `cursor:null`. Only full-root replay is supported. A valid partial chain may return a snapshot/window-bound diagnostic continuation hint; the caller must obtain the remaining pages and replay the full set. A broken chain, invalid input or overflow returns no usable cursor. No cursor is a provider-read or persistence authorization.
- Exact duplicate records are idempotent; conflicting records under one identity fail closed. Reasons accumulate per identity, and a missing prior candidate stays retained with `candidate_missing`. The digest normalizes row order, exact duplicates, and reason order, while binding the page chain and cutoffs.
- `status:"selected"` and `inputPaginationComplete:true` mean only that supplied, structurally valid input was traversed. They do not mean coverage or resolution. Every outcome has `authoritativeCoverage:false`, `replacementAllowed:false`, and `retainPreviousCarryForward:true`; even empty failure arrays must never replace prior retained work. The planner itself supplies no database adapter or durable retention/watermark protocol.

## Current-inventory adapter

`functions/lib/follow-up-current-inventory.js` adds `observeFollowUpCurrentInventory(db, { readAt, limit, cutoff, previousCarryForward })`, contract `follow-up-current-inventory.v1`. It is unimported by production and has no network, writer, schedule or authority-adoption behavior. The caller supplies a D1-compatible database/session; this module does not acquire a binding or guarantee primary/fresh reads. Its local SQLite tests prove query and projection behavior, not production D1 access or deployment compatibility.

Exactly five SELECTs run in one batch: actual table-column/type capabilities, sources, lifecycles, obligations, and exceptions. All current family source rows are considered, including old and retained-expired rows; linked-family children also enter validation so a conflicting family cannot silently disappear. Each inventory kind reads `limit+1` (limit 1–200); overflow fails the entire observation without truncation or continuation. The separate selector candidate cap is also enforced. Missing tables/columns, malformed/failed/sparse batch results and incompatible rows fail closed. Column presence/type is a capability check, not exact schema authority. D1 transport metadata is distinct from assertion rows, including legitimate fractional duration values.

`readAt` is caller-supplied and must equal `cutoff.plannedAt`. All state is explicitly `current_at_read_not_historical`; no historical reconstruction from mutable state or `updated_at` is claimed. Received-window bounds affect new-source reasons, not inventory exclusion. Future source clocks fail; future obligation deadlines are valid. Exact source/lifecycle/obligation parents and family are checked before projection. Every supplied exception link is validated and mutually consistent; source-only exceptions and explicit family-level null links are allowed without inventing a parent. Expired source retention becomes a named source anomaly.

The snapshot digest binds the selected current rows, required-column catalog and readAt after stable sorting. It is a content identity, not an attestation or provider snapshot bookmark. Output hashes owned entity IDs as `id_<sha256>` and excludes contact IDs, appointment IDs, raw payloads, provider references and exception copy. The declared carry domain is `id_sha256_owned_identity.v1`; only selector-shaped carry using those hashed identities is accepted. Raw selector identities and unprojected evidence/anomaly kinds fail with preservation rather than being falsely declared missing. Carry remains unresolved even after a caller-observed terminal state; a missing prior projected identity is only missing from this current owned inventory, not proof of resolution.

`lateEvidenceProjection:"unavailable"` and its fixed reason are present in every result. No command/receipt data is queried or projected. Neither provider_receipts.created_at/observed_at, legacy automation_events.ts, mutable updated_at nor readAt is renamed into ingestedAt. An empty evidence array means unprojected, not no receipts. The ingestion window still belongs to the selector input contract, but it yields no ingestion-coverage claim here.

The envelope returns observed/incomplete, current-inventory completeness, capability status, digest and nested selector result; failures contain no replacement set. Every result remains simulation/sourceOnly, authority=false, dispatchAllowed=false, outcomeProven=false, replacementAllowed=false and retainPreviousCarryForward=true. Even a complete current inventory leaves historical deletion/retention gaps, external evidence, ingestion journals, immutable changes, trusted provenance and terminal/operator proof unresolved. No Staff health change, obligation closure, resend or production integration is included.

## Gates before any future authority lift

A separately versioned future contract may become Known only after all of these are proven:

1. append-only reconciliation schema enforcement and an adopted, attested producer identity;
2. an authorized runtime import/schedule with an explicit cadence and freshness law;
3. reader-side recomputation of local facts rather than trust in a self-authored envelope;
4. authenticated, exhaustive GHL Appointment Events Webhook execution readback;
5. independent provider reconciliation with exhaustive cursors and receipt/obligation identity binding;
6. exact release manifest, deployment attestation, source-runtime provenance, and freshness match;
7. an ordinary authorized Follow-Up lifecycle proving source event → durable receipt → lifecycle → obligations → provider evidence → terminal outcome;
8. a canonical exception-resolution drill that proves the underlying obligation outcome before resolution;
9. explicit behavior release, rollback, production readback, and Staff Unknown/Degraded verification.

Until then, missing authority, freshness, or coverage is visible as Unknown or Degraded. An empty queue never masquerades as health.

## Source verification checkpoint

- Historical checkpoint retained: prior-base verification at `45a2cac19ea9877bcc2fb815bd8b3f1112ee9837` passed 2,220/2,220 local tests on Node 24.13.1 with lockfile-matching Vitest 4.1.10. After the earlier rebase onto `0cb98cfa55c844c80a24b345349a355eea0e939c`, it recorded 2,206 passed and 15 failed (2,221 tests), all inherited ClientDesk test-harness `window is not defined` errors in files unchanged by this package; the Morning SMS and Staff suites and portal-release check were run separately and passed.
- Refresh checkpoint: on the local clean merge of public draft `9c1b9f1aec520fcfd546b97cf032228f6f8e5654` with exact current-main `43ddd635b2ea225481cd9f1a7793deee9e68905e`, Node 24.13.1 and Vitest 4.1.10 passed 2,221/2,221 tests. This is a local source checkpoint only; it makes no GitHub-CI, full-SPA-build, deployment, or merge-readiness claim.
- `check:field-ids`, `check:owned-access`, `check:build-contract`, `check:app-separation`, `check:dist-assets`, and `git diff --check` passed locally.
- Independent collector and Staff-store/API reviews passed after regression fixes for failed batch slots, malformed receipt digests, version bounds, missing authority, future clocks, and schema-safe Unknown responses.
- Collector SHA-256: `66714f4441c022964656b910d490af0281e58629577a8083b23098de9d3f9f1c`.
- Staff store SHA-256: `1638ab4f70f214272c17c8b2e5a8d701f1635542a38b824225aea6b5da186d24`.
- The checked-in Pages bundle was rebuilt using pinned Wrangler 4.125.0 and hashes to `4c45d1d5c23eef754c04f7a1186ddf1e22bc6f777e756539f8338dea58ca5064`. It matches the compiler output for the refreshed tree, contains no collector/drill import or release flag, and preserves the concurrent current-main sources in the generated Pages module.
- No production D1 write, Worker deployment, sender change, GHL/provider call, customer activity, or message occurred in this source increment.
