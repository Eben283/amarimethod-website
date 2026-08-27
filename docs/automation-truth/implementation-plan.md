# Automation truth implementation plan

## Current program checkpoint — 2026-08-27

The original Phase A/B plan below is historical sequencing, not a claim that
the program is still at its first source PR. The compiler/provenance contracts,
exact promoted-v2 schema authority, inert reconciliation and execution-linkage
planners, and bounded current-inventory adapter are built. PRs #510, #517,
#519 and #521 are merged. A separately approved primary production read
verified the unchanged adapter against the exact required 69-object v2
closure (`8c7245ae…`) with zero writes. This proves current-inventory read
compatibility, not production evidence ingestion or completed reminders.

The next source candidate is now built and locally reviewed: an unimported
transactional effect-evidence store and explicitly unregistered/unapplied
additive SQL. It binds an existing obligation to its exact prospective attempt,
preserves observations and receipts append-only, and reads late evidence by
database-assigned ingestion sequence. All 2,361 repository tests pass, including
69 real-SQLite/D1-shaped candidate cases. It does not create a parallel execution
engine, infer historical attempts, resend, close obligations, or lift Staff
health. It has not been published, installed or adopted by a runtime.

The remaining completion path is:

1. Publish the reviewed source candidate only after explicit approval and verify
   exact-head public CI/build. Local atomicity, replay, frozen-high-water paging,
   retention failure and lineage tests are complete; production compatibility,
   durable consumer checkpoints and inventory/carry/journal composition are not.
2. Review the exact schema delta and compatibility/readback/recovery plan before
   any separately approved production installation. This candidate does not
   register a migration or alter the current schema-authority allowlist.
3. Adopt authenticated acceptance and executor provenance, exact ingress-to-step
   bindings, lease fencing, and prepared-before-effect behavior in the existing
   sender through one separately approved behavior release. Preserve existing
   customer queues; do not retrofit guessed identities onto historical sends.
4. Prove independent source/provider coverage and late-receipt reconciliation,
   then an ordinary authorized lifecycle and an operator resolution that proves
   its underlying obligation outcome. An in-memory mechanics drill is not this
   acceptance proof.
5. Only a separately versioned, adopted and independently verified contract may
   lift health authority. Reconciliation v1 remains permanently simulated,
   non-authoritative, and never Known. Broader family migration follows its own
   ownership and cutover gates.

The detailed current contract and limitations are in
[Follow-Up reconciliation](phase-e-follow-up-reconciliation.md). Source-only
completion is not runtime activation, and a passing test is not a provider
receipt. Production writes, publication, deployment, sender changes and
customer actions retain their explicit approval boundaries.

## Original Phase A — contract groundwork

Documentation, JSON schemas, pure validators, tests, and a conspicuously fictional static spike.
No production import, migration, flag, deployment, provider call, Staff endpoint, runtime behavior,
or release configuration changes.

## Phase B gate — shadow provenance and compiler proof

Before implementation begins, reviewers must accept ADRs 0002/0003, the envelope/status/effect
schemas, named privacy/SLO owners, and a source-backed inventory for one family. The first code
slice must be read-only/shadow and prove:

1. a closed WorkflowSpec compiles deterministically to the existing behavior for one family;
2. plan/spec/compiler/handler digests, release manifest, invocation identity, and D1 schema head
   can be recorded without replacing the reliability spine;
3. lifecycle/obligation/attempt evidence can carry a pinned plan/node ID additively;
4. a fake/controlled test proves duplicate, stale, timeout, lease, ambiguous-provider, and
   Broken-precedence handling without a customer/provider action; and
5. Staff returns `Unknown` when the shadow authority is absent rather than reconstructing truth.

No effectful owner changes, sender changes, GHL configuration, database migration, or deployment
may be bundled with Phase B. Those need an independent impact preview and approval.

## Staged rollout after Phase B

1. Shadow one already-owned family; compare compiled plan and ledger evidence with current
   behavior, no commands.
2. Add attested deployment provenance and node-addressed ledger fields, preserving historical
   limitations.
3. Add read-only Staff projections and operator exception drill.
4. Enable one responsibility only after provider idempotency/reconciliation, SLO, rollback,
   privacy, and ordinary-run gates are proven.
5. Migrate families one at a time. Retain external owners until a separately approved cutover
   proves no overlapping effectful owner.

## Required review evidence

- exact source base and candidate head;
- compiler-parity fixture and canonical digest;
- release/deployment/schema provenance fixture;
- effect ownership review;
- data-retention/role decision;
- failure/recovery and rollback drill; and
- independent diff review that no entrypoint imports the contract before adoption.
