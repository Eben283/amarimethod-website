# Follow-Up reconciliation v1 — source-only contract

Status: reconciliation (#510), execution-evidence linkage (#517), coverage selection (#519), current inventory (#521), effect-evidence storage (#522), bounded evidence composition (#526), and durable consumer retention (#528) are merged source increments. PR #530 supplies the reviewed CASE-compatible SQL. A separately authorized August 27 physical installation was verified installed-empty/inactive; no new producer or consumer is adopted. Retention/recovery planning below is a local source-only increment, not a runtime release. All existing v1 contracts remain non-authoritative and deliberately unable to make Staff healthy. Earlier unapplied/uninstalled statements below describe their historical source-release checkpoints, not permission to install again.

## Retention and recovery planning increment (offline only)

The approved design defaults now have a separate source-only planning increment:

- `functions/lib/follow-up-retention-policy-plan.js` models original-clock retention, scoped dependency/deletion planning and epoch/witness boundaries.
- `scripts/lib/follow-up-evidence-capture.mjs` models bounded evidence transfer and consumed-attempt readback classification.
- Their `reminder-engine-worker/src/follow-up-*.test.js` fixtures use synthetic identities and local data only.

These are new planning contracts, **not a new production schema or a promotion of
any existing v1 contract**. No runtime imports, database adapter, executable purge
SQL, provider client, schedule, release command, external witness destination or
credentials are added. A structurally valid plan is not authenticated source
evidence, permission to execute, actual deletion or trustworthy coverage.

The retention module exports `planFollowUpRetentionDeadline`,
`planFollowUpRetentionMaintenance` and `classifyFollowUpRetentionEpoch`. The capture
module exports `chunkFollowUpEvidenceCapture`, `reassembleFollowUpEvidenceCapture`
and `classifyOneShotCaptureState`. Inputs are snapshotted before asynchronous work;
outputs are frozen and always deny authority, execution, adoption and retry.
Independent focused review and tests pass: 107 retention/epoch cases and 68
capture cases. These synthetic tests establish local contract behavior, not
production privacy compliance, physical erasure or durable evidence capture.

### Approved implementation targets

Operational evidence has a 90-day maximum from its immutable original capture,
with shorter applicable parent/deletion deadlines winning. A later inventory
`readAt`, retry, restore or rebase cannot renew it. Missing original clock or
incomplete dependency inventory must refuse. Raw message bodies, clinical notes,
payment details, secrets and arbitrary provider errors are outside the planner's
metadata contract. Opaque/digested identities remain restricted, not anonymous.

Expiry, physical erasure and proof validity are different states. A removed
unresolved item must leave a visible evidence gap; it cannot become a completed
obligation. Multi-person checkpoint retirement must preserve permitted unrelated
work in a separately validated replacement before affected historical proof is
retired. A hold may restrict physical deletion but cannot extend evidence validity.
Privacy-request audit records have a separate 24-month design schedule; an
ordinary subject-deletion request must not silently shorten that audit record.
This is an operational separation, not a determination of legal applicability.

Witness intent, D1 commit, independent acknowledgement and reader verification
must remain distinct. An unknown write response is not an empty database or a
retry permission. A coherent rollback requires comparison with an independently
retained witness; a same-D1 record or a local temporary file does not supply it.
Pruning a predecessor witness requires a replacement anchor covering every still
supported restore/replay horizon, or an explicit recovery gap. Suppression cannot
expire while a reimport horizon is unknown.

The capture helper's byte bounds concern complete serialized ASCII envelopes,
including base64 and metadata. They do not prove a particular tool's token limit
or the durability/authentication of a future sink. A transport must hand off and
acknowledge each bounded unit without emitting the entire payload in one tool
result, then verify complete reassembly. A digest without all bytes is incomplete
evidence. No capture failure authorizes rerunning a consumed mutating attempt.
The generic JSON capture capsule is not a PII scrubber; the future executor must
apply the approved field-minimization policy before any private capture.

### Required physical changes remain unimplemented

This is the concrete boundary for the later schema/adapter review; the existing
SQL, schema-authority markers and installer hashes remain unchanged.

| Existing dependency | Required later invariant; not implemented by a pure plan |
| --- | --- |
| Effect attempt bindings and evidence events | Preserve append-only integrity within the allowed lifetime; add an exact authorized purge path, immutable retention origin and row/receipt scope binding. Permanent no-delete guards currently prevent expiry cleanup. |
| Consumer checkpoints and retained reasons | Explicit epoch boundaries, original per-identity deadlines, complete replacement/carry proof and old-cursor invalidation. Remove old payload copies only after dependency closure; do not relabel a new consumer key as continuity. |
| Canonical sources, lifecycle/obligation/command/receipt graph | Include person/appointment mappings, normalized JSON/payload references and logical receipt links. Existing parent clocks and protected-delete triggers cannot be bypassed just because the new journal uses a shorter policy. |
| Transitions, leases, exceptions, access and provenance evidence | Enumerate their exact incoming references and hold/deletion constraints, validate child-first order and preserve unrelated rows. Do not cascade into shared release/attestation history based solely on a subject request. |
| Independent witness and suppression records | Select an approved private resource outside the target rollback domain, define storage/access/expiry contracts, bind every acknowledgement to the exact epoch/operation and reapply suppressions before restored data is usable. |

Before adoption the actual inventory adapter must prove the complete dependency
set, identity ownership and origin clocks from authenticated primary reads. These
pure inputs are self-reported and do not provide that proof. Likewise, an abstract
deletion order is not executable against today's immutable SQL.

The existing 200-row per-family inventory and 200-candidate union caps remain
refusal limits, not verified capacity. The design starting point is 100 rows/page
and at most eight pages/run, with an explicit total query/byte/time budget still
required. Full history, repeated memberships, inventory and error readbacks must
be measured, not just the commit batch. Actual production load, purge lag and
recovery RPO/RTO remain unproven.

The installer evidence-truncation incident is **not operationally fixed** by an
offline helper. A separately reviewed executor/sink integration and lost-response
rehearsal are still required before another mutating executor. Do not rerun the
closed physical installation. Source publication/merge, schema migration,
external-storage provisioning, real-data deletion, runtime adoption, ordinary
lifecycle/operator proof and health promotion retain separate authorization gates.

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

## Durable effect-evidence candidate — source only

The merged source candidate is `functions/lib/follow-up-effect-evidence-store.js`
with `reminder-engine-worker/reliability-effect-evidence.candidate.sql` and a
real SQLite/D1-shaped test suite. The SQL is **unregistered and unapplied**: it
is not a migration, is absent from schema loaders and production imports, and
does not change the promoted-v2 authority definition. Applying it requires its
own exact-schema review, recovery plan, approval and primary readback.

The storage design adds an immutable binding from an existing canonical command
attempt to its exact source, lifecycle, obligation, workflow document/node,
acceptance provenance, executor provenance, provider account scope and lease
event. It reuses `command_attempts` and `provider_receipts`; it does not introduce
another execution engine or infer attempts from historical send logs. A separate
append-only event table receives database-assigned ingestion sequence and time.
Occurrence/observation time is distinct from ingestion order.

Preparation must atomically persist the canonical prepared attempt, exact
binding and prepared event before any future caller may attempt an effect.
Observation and receipt projection must be atomic with their journal evidence;
a post-commit JavaScript check alone is not a rollback mechanism. Exact replay
is idempotent, identity/content or ownership collisions refuse, and immutable
tables reject UPDATE, DELETE and duplicate-identity REPLACE. The candidate does
not send, authorize retry or mark an obligation satisfied. A lost database
response is an unknown write outcome, never permission to send or manufacture a
new attempt.

Late receipt evidence uses the retained original binding, not an assumption
that the execution lease must still be active. Missing linkage refuses without
claiming durable retention of that unlinked receipt. Provider reference reuse
under another attempt must not be hidden by the existing receipt uniqueness
constraint, which omits attempt/account scope. The reader may conservatively
refuse such an alias; it must not guess ownership. Accepted followed by delivered
is progression, while contradictory terminal receipt evidence remains unresolved.

Journal traversal freezes a committed high-water sequence and pages only through
that boundary. Sequence gaps are legal and occurrence time does not decide
inclusion. A continuation is diagnostic, not a durable consumer checkpoint or
an authenticated provider cursor. Missing/expired parents, invalid boundaries,
partial results or bounded overflow cannot clear prior unresolved work. There
is no adopted purge or retention-extension policy in this candidate.

The journal's
sequence must never be relabeled as the selector's timestamp `ingestedAt`, nor
may a time-window filter discard old-occurrence evidence selected by ingestion
sequence. The source-only composition described below unions current inventory,
unresolved carry and late evidence with exact parent identities. Durable
consumer checkpoints and an adopted retention law remain separate future work.

Stored provenance and caller-supplied digests are structural evidence only. The
store is not an attestation verifier or provider authenticator. In particular,
the legacy GHL transport's conversation-ID fallback is not an independently
verified message receipt and cannot be adopted as one. All results remain
source-only/simulated and non-authoritative; no producer adoption, external
coverage, dispatch permission, replacement permission or outcome proof follows
from a successful local write or journal traversal.

Local verification on the inspected main base
`12e361c6e48472f21438c26f866cda99795d5572` passes all 2,361 repository tests,
including 69 new real-SQLite/D1-shaped cases. The fixture installs the exact
production-lineage v2 schema in memory, then the candidate; its placeholder
attestation signatures prove structural constraints only, not authentication.
The suite exercises two-connection preparation races, transactional rollback,
projection races, replay/ownership collisions, terminal receipt contradictions,
late receipts, REPLACE with recursive triggers disabled, allocation gaps,
fixed-boundary pagination, expired anchors and malformed result privacy.

Independent local catalog comparison finds exactly 15 additive objects (two
tables, two indexes, eleven triggers), no changed existing object, unchanged
schema markers/contracts and no foreign-key violation. Source/release guards
and whitespace checks pass. Production imports and the committed Pages bundle
are unchanged. PR #522 subsequently passed exact-current-main integration and
merged as `2266caab0cb9de2b1840cf914eac28936c80fd6a`; post-merge Node22.23.2 CI
passed all 2,361 tests, guards and full production build, and automatic Pages
deployment passed. These are not proof of installation, deployed D1
compatibility, authenticated provenance or live customer outcomes.

## Inventory/carry/journal composition — source only

`functions/lib/follow-up-evidence-composition.js` provides
`observeFollowUpEvidenceComposition(db, options)`, contract
`follow-up-evidence-composition.v1`. It is an unimported read-orchestrator:
no schema, writer, network transport, binding acquisition, schedule, sender or
production entrypoint is changed. The existing journal, inventory adapter and
timestamp selector remain unchanged.

Options contain `inventoryOptions` (`readAt`, `limit`, the existing seven-field
`cutoff`), complete `previousCarryForward` (`candidates`, `cursor:null`),
`journalPageSize`, `maxJournalPages`, and `maxCandidates`. Limits are at most
200 rows per journal page, 20 journal pages and 200 distinct candidates. Inputs
are validated and snapshotted before asynchronous work. No caller-supplied
reader envelope, completeness flag, high-water boundary or arbitrary journal
cursor is accepted.

The orchestrator invokes the current-inventory reader itself. Only supported
source/lifecycle/obligation/exception carry enters that reader, with its existing
`carry_forward` vocabulary; original reason sets and evidence/anomaly carry are
retained separately. Inventory returns selected candidates, not a complete
entity map. Absence from that selection cannot establish a missing parent.

Journal reading starts at sequence zero and walks only returned continuations
under one fixed high-water boundary. Global allocation gaps are legal;
per-attempt predecessor chains and immutable source/lifecycle/obligation links
must remain consistent. Membership is decided by sequence, not timestamp.
Occurrence, observation and ingestion times remain distinct in sanitized
`journalEvidence`. Every journal event and its exact hashed parents join the
inventory/prior-carry union, deduplicated by stable kind/identity with sorted
reason sets. Additional composition reasons are `sequenced_evidence`,
`journal_linked_parent` and `conflicting_receipt_evidence`.

A provider/reference hash cannot belong to two attempts. A contradiction
already present in the traversed proof history cannot be marked nonconflicting;
accepted-to-delivered progression remains valid. A true conflict flag without
an earlier journal contradiction is conservatively retained because canonical
receipts outside this journal can explain it. A later nonconflicting receipt
does not clear an earlier conflict from the unresolved candidate union.

The envelope exposes `composed` or `incomplete`, inventory snapshot digest,
journal boundary/traversal/pages, candidates, sanitized journal evidence,
deterministic input digest and reason codes. Its observation scope is explicitly
`separate_inventory_read_and_fixed_journal_boundary`, never one historical
snapshot or an exhaustive provider observation. Valid prior carry is retained
as `retainedPriorCarryForward`; malformed carry is not reflected and requires
the caller to keep its existing store. Success proposes the same
`{candidates,cursor:null}` carry shape; failure returns `proposedCarryForward:null`.
Reader refusal, invalid chains/identity, required missing/expired evidence,
page/candidate overflow or invalid inputs cannot truncate work into success.

All results retain previous carry and remain simulated/source-only, with
`authority`, `authoritativeCoverage`, `producerAdopted`, `dispatchAllowed`,
`outcomeProven`, `replacementAllowed` and `watermarkAdvanceAllowed` false.
Successful composition is structural selection only, not evidence
authentication, an adopted checkpoint, a durable replacement set, obligation
closure, Staff health promotion or runtime activation.

Local verification on exact main
`102ed7dec6794253d9c28e6421fe7a9a3a0b27db` passes all 2,435 repository tests,
including 74 new real-SQLite/adversarial composition cases and 205 combined
composition/journal/inventory/selector cases. Independent final-artifact review
passed after fixing cross-attempt receipt aliases and hidden proof conflicts.
The genuine late-observation fixture records the observation after submission,
then ingests it after a later frozen cutoff; occurrence time is not fabricated
as a sequence or used to discard it. Bounds, empty journals, page/identity
tampering, missing schema/expired evidence, carry round trips, getter safety,
privacy, no writes and no network behavior are covered.

The existing isolation regression was narrowly updated to allow only the
store/composition source pair while forbidding either module or the candidate
SQL from every other non-test source/configuration/schema path. All source and
release guards pass; runtime implementations, candidate SQL, entrypoints and
the committed Pages bundle are unchanged. The subsequently approved six-file
package merged in PR #526 at `fff378e37d5ed4fe2dd306bd08c4832f8540bb6e`.
Pre- and post-merge CI passed all 2,435 tests, guards and the full production
build; automatic Pages deployment passed. This verifies the source release,
not production database compatibility, installation or runtime activation.

## Durable consumer retention — source-only candidate

The next contract, `follow-up-consumer-retention.v1`, separates bounded work
per operation from the size of the durable unresolved set. Its source artifact
is `functions/lib/follow-up-consumer-retention-store.js`; candidate SQL is
`reminder-engine-worker/reliability-consumer-retention.candidate.sql`. Neither
is adopted by a runtime or registered as a migration. The existing inventory,
selector, journal and composition implementations keep their frozen contracts
and limits. Verification below identifies the source-only test scope; no
production behavior is claimed.

The additive store uses `follow_up_consumer_checkpoints` and
`follow_up_consumer_retained_reasons`, with a read-only journal-validation view.
Checkpoints and reason memberships are append-only. A checkpoint records its
consumer, predecessor/generation, operation/page identity, fixed high-water
boundary and processed prefix, structural content/prefix digests, database
clock and evidence-valid-until boundary. Retained reasons reference their
checkpoint and origin. Customer/entity identities leave the source projection
only as hashes, alongside structural digests, clocks and bounded enums. Consumer
and operation keys are internal identifiers, not customer data. Raw proof fields are transient transaction
parameters, not a second customer-payload archive.

The three operations are:

- `retainFollowUpConsumerInputs(db, {consumerKey, operationId, inventoryOptions,
  previousCarryForward})`, where inventory options contain `readAt`, `limit`
  and `cutoff`; prior carry keeps the existing `{candidates, cursor:null}` shape.
- `advanceFollowUpConsumerPrefix(db, {consumerKey, operationId, pageSize,
  maxPages})`, using the separately versioned internal
  `follow-up-checkpoint-aware-journal-read.v1` protocol.
- `readRetainedFollowUpCandidates(db, {consumerKey, checkpointId, cursor,
  limit})`; start with null checkpoint/cursor, then retain both the returned
  checkpoint identity and continuation for stable keyset pages.

They retain current inventory plus validated prior carry, advance bounded
journal pages, and read retained candidates respectively. Callers supply
operation identities and bounds, not a trusted high-water mark, prefix or
coverage claim. Inputs are snapshotted before asynchronous work. Reads group
all retained reasons by candidate before applying keyset pagination and
`limit + 1`; a page cap never discards the rest of the durable unresolved set.
`recordedWindowComplete` describes only the checkpoint's fixed journal window,
not subsequent arrivals, inventory completeness or provider coverage. A retained
candidate read may still expose a continuity gap without deleting its results.

Journal progress must atomically bind exact predecessor, source/page membership,
parent/retention checks and retained reasons. JavaScript-computed digests do
not substitute for transaction-side comparison with actual database rows.
Competing writers use predecessor/generation compare-and-swap. A bounded
multi-page operation commits in one D1 batch, so failure rolls back the whole
operation; exact operation replay handles a lost response. A successful
budget-limited operation preserves its unfinished fixed boundary for the next
operation. Runtime code uses D1 batch transactions, not raw `BEGIN`/`COMMIT`.
Proof mismatch must abort inside that transaction, including on its final page;
a post-commit row-count check cannot provide rollback. Stored-state checks
compare ancestor links, each retained membership against its owning payload,
and the whole recorded journal prefix against actual event membership/digests
and structural validity, not just the last anchor or total counts.
Statement/parameter and payload bounds must remain within the documented
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
The candidate's JSON projection uses function calls with at most 32 arguments
and preserves explicit null fields; local SQLite's looser defaults do not
establish this platform compatibility.
These are bounds on materialized rows and statements, not a measured runtime
or total database-scan bound. Integrity counts and proof-history validation
can grow with retained data; production capacity and lag remain unproven.

Missing or expired required evidence blocks progress without removing retained
work. The candidate has no deletion, resolution, retention extension, automatic
reset/rebase or epoch-adoption API, and never borrows business-obligation leases.
Internal journal/checkpoint mismatch can be refused. A coherent database
rollback that restores both journal and checkpoints to the same earlier state
is **not detectable by this database alone**; recovery requires a separately
owned external witness and explicit epoch/rebase policy before production use.
Structural digest consistency is not authenticated provenance.

Every result remains simulated/source-only and denies coverage, producer
adoption, dispatch, outcome, replacement and production-watermark authority.
Durable journal progress does not solve exhaustive inventory discovery: the
frozen current-inventory reader still refuses oversized family inventories,
and separate current-row observation is not a historical snapshot. No result
closes obligations, lifts Staff health or proves provider coverage.

Production adoption still requires named retention/privacy and DSAR ownership,
alignment with the existing 400-day policy, measured capacity/lag limits,
recovery/epoch ownership and external-witness design, plus a separately reviewed
exact install/recovery/readback procedure. Installation, authority changes,
Worker deployment, producer activation and customer actions each remain
outside this source candidate's approval.

### Consumer source verification

On exact current main `802b903021518b26ae43120651edeca7b1c8e8c0`, local Node
24.13.1 / Vitest 4.1.10 passes all 2,500 repository tests, including 64 new
real-SQLite/D1-shaped consumer cases. The fixture constructs the exact v1
schema, applies promoted-v2 lineage and the effect-evidence candidate, then
the consumer candidate. Existing schema rows and markers stay unchanged; the
consumer adds 14 explicit objects (2 tables, 3 indexes, 8 triggers and 1 view)
plus 6 implicit unique indexes. Foreign-key validation passes.

Tests cover 303 retained candidates across stable grouped pages, 203 actual
journal events, bounded-window restarts, real two-connection competing writers,
lost committed responses, transaction-side final-page failure, whole-prefix
and ancestor/member inconsistency, expiry, post-boundary arrivals, retained
conflicts, malformed input/cursors, privacy and D1 statement/function limits.
A coherent journal-plus-checkpoint rollback is tested as an explicitly
undetectable case, not relabelled as successful restore detection.

Source/release and whitespace guards pass. The isolation regression permits
only the exact three inert evidence module paths and forbids their adoption
elsewhere. The inventory, selector, composition and journal implementations,
effect-evidence SQL, runtime entrypoints/configuration, schema authority and
committed Pages bundle are unchanged. Concurrent Media PR #527 is preserved.
The approved seven-file package subsequently merged in PR #528 as
`dfdcace0cc377421979fc38ffc73e1ce48f05cd2`, with exact reviewed tree
`67cd016c62e043ce843e86ef82e88ce3b23c8e53`. Pre-merge CI run `33129994131`
and post-merge run `33130159322` passed all 2,500 tests, guards and full
production builds on Node 22.23.2. Automatic Pages deployment
`b1546af5-e0e7-44e7-8882-a063336c6593` passed for the merged revision.
These tests and releases do not establish installed D1 compatibility,
authenticated provenance, production capacity, runtime adoption or completed
CRM coverage.

## Guarded physical-installation envelope — offline source candidate

`scripts/follow-up-evidence-install-plan.mjs` is an offline planning module,
not a database client or migration runner. It has no credential lookup, network
transport, execution command, runtime import or automatic retry. A returned
statement envelope is review material, never installation authorization. This
package is still local/unpublished; neither candidate SQL has been installed.

The module exports `planFollowUpEvidenceInstall({databaseId, sourceRevision,
snapshot, recovery})` and `classifyFollowUpEvidenceInstallOutcome({basis,
planDigest, snapshot})`. The first returns pending/refused, an already-installed
observation with no replay statements, or a 33-statement bound envelope. The
second recomputes the exact envelope identity from its saved basis and classifies
fresh caller-supplied readback. Both permanently deny execution, production-read,
restore, first-row and automatic-retry authority; even an installed-empty
classification has `installationProven:false` because metadata is unauthenticated.

The only candidate target is `amari-automation`, database
`089d810a-9d2d-43a4-8f1d-dc3620835557`, on the already promoted exact v2
lineage `8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62`.
The current source files are hash-pinned and applied in this order in local fixtures:

| Candidate SQL under `reminder-engine-worker/` | SHA-256 |
| --- | --- |
| `reliability-effect-evidence.candidate.sql` | `4a71cc0da24928677df2c26702600576df9ed80441a94c5f6e10b6c82aa36069` |
| `reliability-consumer-retention.candidate.sql` | `0fef0772950d429fc3dfb5ec4827089ea562523d3945917d114b22a99f2ebb88` |

Together they contain 29 explicit CREATE statements and add exactly 39 catalog
objects: 4 tables, 5 explicit indexes, 10 implicit unique indexes, 19 triggers
and 1 view. Existing objects, v1/v2 markers and the immutable v2 contract must
remain unchanged. All new triggers belong to the four new tables. No v3 marker,
authority promotion, historical backfill, sender change or customer row is
part of this empty physical installation. A whole-catalog count from an earlier
production observation must not become a hardcoded current baseline.

### Approval and evidence boundary

Before any future physical installation, separately authorize a fresh primary
schema read and recovery-bookmark acquisition for the exact database. Capture
the complete catalog, including views and implicit indexes, exact authority
rows, foreign-key checks and primary/zero-write metadata. A table/index/trigger
projection alone is insufficient. Existing additive names, altered lineage,
missing objects, unknown metadata or conflicting definitions must stop the
operation. Never execute caller-supplied catalog DDL to predict the new state;
only the pinned repository DDL may construct the local oracle.

The planner pins the promotion-observed fixture as well as both SQL files,
including the exact v2 marker/contract `applied_at=1787803363000`. It requires
foreign keys enabled, no violations, per-query successful primary/zero-write
metadata, null counts for absent candidate tables/view, and zero counts for an
empty installation. Snapshot and recovery times have a five-minute freshness
bound, checked again against database time inside both transaction assertions.
Readback may not predate either saved preflight or recovery metadata. These
checks constrain supplied evidence; they do not authenticate its source.

Record the provider-confirmed Time Travel recovery point outside the database,
bound to the database and the reviewed preflight. A formatted bookmark string,
caller boolean or digest does not authenticate recoverability or approval.
The offline planner cannot obtain or verify these facts. Missing evidence stays
pending/refused, not fabricated. An approved execution transport must independently
verify database routing, complete transactional-batch semantics and primary
service; a local SQLite test is not that proof.

### Atomicity and immediate readback

The proposed physical operation uses one transaction: create a temporary-purpose
assertion table, unconditionally check the exact precondition, execute all 29
complete CREATE statements, unconditionally check the exact postcondition, then
remove only the assertion table. A failing CHECK aborts the batch; a filtered
INSERT that silently inserts zero rows is not a guard. SQL triggers contain
internal semicolons and must remain single statements. The operation changes no
existing business rows and preserves ongoing customer work; it does not freeze
or claim to snapshot that work.

Cloudflare documents transactional rollback for failed `batch()` statements.
Do not substitute separate calls or assume `exec()` has identical guarantees.
Read replicas are possible after the first query in a `first-primary` session,
so primary readback must be established for the actual readback batch.
[D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
Check each statement against 100,000 SQL bytes, 100 bound parameters and 32
function arguments; a passing local test does not prove the 30-second production
execution budget. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Stop after installation and perform read-only primary readback. Require the
exact expected whole catalog, four empty new tables, a readable empty view,
unchanged authority rows, enabled/clean foreign keys and no assertion table.
Classify a lost response from this readback, never by blindly replaying SQL:

| Fresh readback relative to the approved preflight | Meaning / next action |
| --- | --- |
| Exact original catalog, no additions | Installation is not observed; stop, do not automatically retry. |
| Exact original catalog plus all 39 expected objects, new tables empty | Installed but inactive; stop, do not replay or activate. |
| Partial/different catalog, changed authority, nonempty new tables, invalid/missing proof | Investigate with new authority; no automatic repair, DROP, restore or retry. |

Time Travel restore overwrites the database and cancels in-flight work. A
bookmark is not a scoped rollback that preserves intervening customer actions;
restoration always needs a separate decision and recovery procedure.
[Time Travel recovery](https://developers.cloudflare.com/d1/reference/time-travel/).

### First-row adoption remains blocked

Before any producer/consumer writes real evidence, name retention/privacy and
DSAR ownership, capacity/lag bounds, external restore-witness and epoch/rebase
policy. Permanent no-delete triggers and foreign keys can prevent parent-data
deletion; the existing 400-day cap does not itself implement a purge policy.
Hashed identities are not anonymous. No policy, witness or authorized operator
is invented by this package. Physical installation, even if later verified,
does not resolve these gates, make Staff healthy or complete CRM coverage.

### Installation-envelope source verification (original artifact)

This paragraph records the original pre-parentheses artifact, not verification
or approval of the revised SQL below. Its historical digest and results remain
unchanged.

On merged base `dfdcace0cc377421979fc38ffc73e1ce48f05cd2`, local Node 24.13.1 /
Vitest 4.1.10 passes all 2,559 repository tests, including 59 new planner cases.
Independent review passes the 59 planner and 69 existing journal/isolation
cases together. Separate local SQLite oracles agree on the exact 39-object
delta: `canonicalJson` over the type/name-sorted `{type,name,tbl_name,sql}`
rows hashes to
`bd5151d6d3b8e3bb65c3a7099a12f86e2858316b6edbc66a0048569c70fb4600`.
This is the additive projection digest, not a predicted whole-production-catalog
digest or authenticated deployment identity.

Actual transaction tests cover rollback after effect DDL, at the final consumer
statement and at the unconditional postcondition; precondition schema races;
execution-time expiry and foreign-key disablement; duplicate application;
lost committed and uncommitted outcomes; old readback; changed markers/contracts;
partial/extra table or view objects; missing primary/view metadata; and hostile
catalog text remaining bound data. Existing catalog, seeded business data and
sequence rows remain unchanged, all four candidate tables and the view are
empty, and the exact 69-object current-v2 authority remains proven locally.

All source/release and whitespace guards pass. A narrow isolation-test exception
permits only this offline script; its basename remains forbidden in production
and schema routes. Both SQL files, all existing evidence stores/readers, schema
authority, package/configuration, runtime entrypoints and committed Pages bundle
are unchanged. This six-file source package has not been published or run through
public CI/full build. No production database read/write, installation, restore,
Worker deployment, activation, provider action or message occurred.

### Parentheses-only SQL compatibility revision

The inactive SQL now encloses every complete CASE expression in parentheses:
20 in the effect candidate and 16 in the consumer candidate, including nested
cases and the existing validation view. Removing exactly those 36 wrapper pairs
reconstructs the original source hashes byte-for-byte. No predicate, NULL
behavior, error code, guard order or other SQL text changes. The planner changes
only its two artifact pins; schema authority and runtime imports are untouched.
This follows the workaround reported in [Cloudflare issue #4727](https://github.com/cloudflare/workers-sdk/issues/4727),
not a claim about the current REST backend's implementation or guarantees.

The revised local oracle still produces 15 + 14 complete CREATE statements,
33 envelope statements and 39 additive catalog objects. Its current
`canonicalJson` additive-catalog digest is
`234679b57212ddc8665fed65b2601ef4282d30b4e9604239d05730f3eb7dfb62`;
the ordered SQL-text vector digest is
`1632b44b941dc687bb3344ae0f884c745e0faf0f18624af093ee594869bed100`.
Neither is a whole-production-catalog prediction or authenticated deployment
identity. A plan still binds its exact fresh basis and artifact hashes; a saved
old envelope or approval must not be silently relabeled as this revision.

Local regressions compare the old and revised compiled SQLite programs for
all four new tables' INSERT, REPLACE, UPDATE and DELETE paths and the validation
view, excluding only source-text trace spelling and connection-local virtual
table pointers. They also exercise true/false/NULL guard behavior, quoted and
nested lexical boundaries, original-hash reconstruction and refusal to accept
an old empty installation as the revised artifact. These are local semantic
and installation guards, not public REST transport proof. Revised isolated
retesting and cleanup must remain separately scoped; no production access,
installation, activation or authority lift is part of this source revision.

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
