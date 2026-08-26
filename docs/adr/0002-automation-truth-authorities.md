# 0002: Automation truth authorities

Status: Proposed — Phase A contract only. This ADR changes no runtime, database, flag, deployment, provider, or Staff behavior.

## Decision

Every operational assertion has exactly one named authority. A projection may join records from
several authorities, but it must identify the authority for each constituent assertion and preserve
its proof, freshness, coverage, and limitation. A human or AI may annotate an investigation; it
cannot be the authority for a `Live` or `Healthy` assertion.

| Claim | Sole authority | Required identity |
| --- | --- | --- |
| Intended behavior | immutable `WorkflowSpec` | workflow ID, spec version, canonical digest |
| Executable behavior | immutable `CompiledPlan` | compiler ID/version, plan digest, handler registry digest |
| Release eligibility | immutable `ReleaseManifest` | source revision, artifact digest, schema head, plan digest |
| What is deployed | `DeploymentRecord` produced by deployment attestation | deployment ID, invocation identity, release-manifest digest |
| What executed | existing reliability-spine `ExecutionLedger` | source/lifecycle/obligation/attempt/exception IDs, pinned plan/version |
| External/provider observation | `ExternalObservation` | provider, query/ref, evidence reference, coverage and watermark |
| Derived mode/health | deterministic status policy over the preceding records | policy version, inputs, result, as-of |

`WorkflowSpec` contains only intended behavior: closed nodes, edges, handler references, message
references, entry/exit semantics, and expected evidence. It must not contain provider facts,
deployment state, rollback approval, mutable health, or an operational status. `ExternalObservation`
contains those provider facts. `ReleaseManifest` names intended rollback candidates; an actual
rollback is a new `DeploymentRecord`, not a field changed in a spec.

## Non-negotiable invariants

1. No assertion is `Known`, `Live`, `Healthy`, or a zero business metric without its stated
   authority, complete coverage, and an in-window watermark.
2. Empty, timeout, permission failure, stale data, sampled data, or incomplete pagination is
   `Unknown` or `Degraded`; it is never a truthful zero, absence, or `Healthy`.
3. A known safety violation is `Broken` even when another input is `Unknown`.
4. An owned side effect has one live, effectful owner. Observers are allowed only when explicitly
   marked non-effectful.
5. The existing reliability spine remains the only planned execution evidence model: source
   receipts, lifecycle instances, obligations, command attempts, provider reconciliation, and
   exceptions. Phase A does not add `workflow_runs`, `step_runs`, a replacement ledger, or a
   second exception queue.
6. A staff view is a read-only projection. It cannot reconstruct a missing authority or translate
   human/AI prose into an operational claim.

## Current proven gaps (baseline `6016fa538ca30f0e5a28d84c93fbde69fc33e5b6`)

- Staff reconstruction is still present: `functions/lib/automation-families.js` and Staff renderers
  assemble some topology and source snapshots outside an executable graph.
- There is no deployment-attestation record tying a release manifest, built artifact, invocation
  identity, and D1 schema head together.
- `functions/lib/reliability-store.js` has the accepted lifecycle transaction, but the currently
  staged reliability scaffold is not yet the complete command path; therefore the effect-path
  atomicity boundary is not yet proven end to end.
- Historical version pinning is inconsistent: `lifecycle_instances` pins a definition version in
  the reliability spine, while older execution evidence can still rely on step indexes or
  reconstructed workflow associations.

These are documented gaps, not claims that production is unsafe or inactive.

## Consequences

Phase B must first implement provenance and compiler parity in a shadow/read-only form. No caller
may import the Phase A JavaScript contract into a production entrypoint until a separately reviewed
release makes it authoritative.
