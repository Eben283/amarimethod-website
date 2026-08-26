# 0003: Compiled workflow runtime contract

Status: Proposed — Phase A design contract; no runtime adoption.

## Closed graph

A `WorkflowSpec` is a closed, immutable directed graph. The Phase A pure validator now rejects
unknown schema fields (including external facts/status/rollback), duplicate IDs, dangling or
unreachable nodes, invalid entries/exits, missing decision `else` coverage, duplicate outgoing
priorities, unregistered handlers, and effect nodes without a responsibility registered in the
compiler-supplied effect-ownership registry. Effect and transform nodes must declare a validated
schedule anchor (`enroll`, `cancelled`, or a start-relative offset), `skipIfPast`, and, when
applicable, a structured predicate (`field`, `operator`, `values`). Effect nodes may name a
validated `messageRef` and must declare validated expected-evidence references (authority plus
stable ID), never an external observation value. Node IDs, edge IDs, handlers, message references,
entry nodes, exits, scheduling semantics, branch predicates, and expected evidence are validated before
compile. The compiler rejects duplicate IDs, dangling edges, unreachable effect/exit nodes,
unsupported handlers, ambiguous priority, missing branch coverage, and an effect node without a
declared ownership responsibility. Runtime executes only the `CompiledPlan`; Staff renders that
same plan or reports `Unknown`.

The compiler canonicalizes semantically unordered maps, serializes deterministically, and digests
the resulting bytes. The digest covers the spec, compiler identity, normalized plan, handler
registry digest, and message-reference digest. A mutable UI arrangement is never part of execution
identity.

## Run and release provenance

New lifecycles pin `workflow_id`, spec version/digest, plan digest, compiler version, and runtime
version before an obligation is prepared. Existing lifecycles never silently replan. A replan is an
explicit, audited transition that records the old/new plans, reason, compatibility decision, and
the obligations that were cancelled/replaced; it is prohibited while any prior effect is ambiguous.

`ReleaseManifest` binds source revision, lockfile/artifact digest, worker bundle digest, bindings
digest, handler registry digest, plan digests, and required D1 schema head. A `DeploymentRecord`
then records the immutable release-manifest digest, platform deployment/version ID, actual
invocation identity, attestation time, and observed schema head. “Deployed” is unknown without
that record; source control alone is not deployment evidence.

## Effects

Before an external side effect, an existing reliability-spine obligation produces one durable
`prepared` command attempt with a stable idempotency key, target identity, payload digest, pinned
plan/node ID, lease/fencing token, and provider strategy. A provider call occurs only after that
attempt is durable. A timeout becomes `ambiguous`, not success or automatic resend, until the
provider-specific reconciliation contract permits a next action.

Fencing protects a reclaimed lease: a worker may close an obligation or submit an attempt only
when its current fence token matches the durable lease. Recovery is forward-only, records a new
attempt/takeover, and never erases evidence. D1 migration mismatch, failed attestation, or missing
command preparation stops the command path and creates a named exception.

## Compatibility

Schema changes are forward-only and declare their minimum/maximum compatible runtime versions.
Rollback selects a previously attested compatible release and creates a new deployment record;
destructive schema reversal is not rollback. A deployment is rejected when its manifest’s schema
head does not match the attested D1 head.
