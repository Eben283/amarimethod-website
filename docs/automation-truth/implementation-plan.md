# Automation truth implementation plan

## Phase A — this PR

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
