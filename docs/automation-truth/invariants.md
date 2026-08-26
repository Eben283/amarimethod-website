# Automation truth invariants

These are release gates, not UI copy.

1. **One authority per assertion.** A schema-valid TruthEnvelope names exactly one authority and
   explicit `onMissing` and `onStale` outcomes from `Unknown | Degraded | Broken`; missing proof
   metadata applies `onMissing`, while stale evidence applies `onStale`, never a default.
2. **Proof is explicit.** Every value records proof level (`exact`, `estimated`, or `unknown`),
   source references, timezone/window, as-of/watermark, freshness, coverage, and limitations.
   All envelope timestamps are canonical RFC3339 date-times; date-only and RFC2822 strings are invalid.
3. **No optimistic default.** Missing values have no implicit `0`, `false`, `Live`, or `Healthy`.
4. **Safety wins.** `Broken` outranks `Unknown`, `Degraded`, and `Healthy`.
5. **Closed executable graph.** Runtime effects are reachable only from the pinned compiled plan.
6. **Pinned history.** Every new lifecycle/effect/evidence event names its workflow and plan
   identity; historical rows without it remain visibly limited rather than guessed.
7. **Prepared before effect.** No side effect runs without a durable prepared attempt and stable
   idempotency key in the existing reliability spine.
8. **One live effect owner.** A responsibility has at most one live effectful owner; observers
   cannot send, mutate, charge, cancel, or resolve.
9. **External truth is observation.** Provider facts are separate, freshness-bound observations;
   they never enter a WorkflowSpec.
10. **Recovery preserves evidence.** Leases are fenced; replay is idempotent, bounded, and
    forward-only. Ambiguous provider outcomes cannot auto-repeat an effect.
11. **Least information.** Raw payloads, message bodies, and identity data have named roles,
    retention, redaction, audit, export, and deletion paths before they are stored/displayed.
12. **Operators receive exceptions, not fiction.** Backpressure, SLO breach, timeout, coverage
    failure, or privacy denial becomes a named exception/alert with a safe next action.
