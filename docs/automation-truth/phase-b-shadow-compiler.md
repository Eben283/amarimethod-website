# Phase B — deterministic compiler and shadow provenance proof

## Boundary

This is a pure source/test/docs increment.  It does not import into a Worker or
Staff app; it does not write D1; it does not alter a flag, binding, migration,
sender, GHL workflow, provider, or deployment.  The only live Follow-Up sender
remains **Follow up session Confirmation email / reminder flow**.

## What is now mechanically proven

1. One Phase-A-validated closed `WorkflowSpec` compiles to a normalized
   immutable `CompiledPlan`. Its nodes carry the strictly validated actual
   `at`, `skipIfPast`, and `reminderPreference` predicate structure for each
   scheduled effect. The canonical `specDigest` changes when any of those
   rules change. Object, map, irrelevant graph-array order, and unordered
   `oneOf` value order do not alter the canonical digests.
2. The plan binds its spec, compiler artifact, handler artifacts, and
   source-extracted message content into an **unattested fixture manifest**.
   It is not a release attestation. A non-deployed fixture then binds that
   manifest, runtime version, and declared D1 schema head to an invocation
   identity. The fixture explicitly says `kind: fixture`, `attestation:
   unattested`, and `deployed: false`.
3. Proposed append-only node provenance can be attached to the existing
   reliability spine's lifecycle instance, obligation, command attempt,
   provider receipt, and exception records.  It introduces no duplicate run
   ledger and has no D1 writer.
4. The Follow-Up fixture is source-backed by exact repository/ref/path/digests
   and explicitly records its GHL/external limits.
5. A pure Staff projection fails closed: absent or mismatched manifest,
   deployment, invocation, schema, or evidence authority becomes `Unknown`.
   Even complete fixture inputs remain top-level `Unknown`; a separately
   labeled non-authoritative fixture evaluation may show `Degraded` or
   `Broken` policy precedence but can never assert live health.
6. The Follow-Up graph represents independently scheduled obligations: the
   day-before email and the three one-hour actions are parallel
   appointment-relative branches, not a serial email → SMS → internal chain.
   It also records the cancellation handoff, while the published GHL
   cancellation-removal workflows remain external owners.

The graph edges only express topology. They do not carry invented labels as a
substitute for executable conditions. The source-backed schedule contract is
the sole location of exact Follow-Up timing, past-time behavior, and branch
predicate semantics in this Phase B fixture.

## Deliberately not claimed

- The fixture is not a live GHL builder readback or evidence of a live worker
  deployment.
- Source revision, deployed Worker bundle identity, and live binding identity
  are deliberately deferred to Phase C. Calling this manifest release-attested
  would be false.
- It does not establish that an event, enrollment, send, receipt, or delivery
  occurred.
- The existing schema's `reliability-spine-v1` head is referenced by digest;
  there is no migration for node provenance in this phase.
- The `follow-up-workflow.js` source itself is in `shadow` mode.  Its content
  is not an assertion that GHL's currently published workflow and every
  historical calendar count are perfectly identical.

## Required future gates

Phase C must produce an authenticated control-plane deployment attestation
including source revision, deployed Worker bundle, and binding identities, plus
data-plane invocation binding without weakening the Phase-A status policy.
Phase D may add an additive, forward-only node-transition schema only after
empty/populated/interrupted migration tests.  A Staff UI is later and must read
those authorities; it must not reconstruct a plan from presentation state.
Any sender/effect-owner change remains a separate behavior release with the
existing GHL cutover gates and an ordinary authorized lifecycle run.
