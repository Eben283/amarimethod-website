# State and failure matrix

The entity names below map to the existing reliability spine: source receipts, lifecycle instances,
obligations, command attempts, provider observations, and exceptions. They are not new tables.

| Situation | Durable state / deterministic result | Operator signal | Unsafe result prohibited |
| --- | --- | --- | --- |
| Duplicate provider event | Existing receipt/lifecycle returned; append dedupe evidence | informational trace | second lifecycle or effect |
| Out-of-order cancel before confirmation | record source evidence; choose the pinned exit only when event identity/order rule is satisfied | exception if ordering cannot be proved | send then cancel by guess |
| Ambiguous identity/status/timezone | no enrollment or effect; exception with redacted source ref | `Unknown` / investigate | timestamp-only identity or local-time assumption |
| D1 unavailable or transaction partial | no dispatch/effect; source health unknown/degraded | page/alert by SLO | KV/direct-send fallback as authority |
| Lease expiry/concurrent worker | expired lease only may be taken over with a new fence token and event | takeover audit | two workers closing/submitting |
| Provider timeout | command attempt becomes `ambiguous`; reconcile by stable key/reference | receipt-health exception | automatic resend or success |
| Provider rate limit/backpressure | durable due obligation remains pending; schedule bounded retry only under provider policy | queue/SLO alert | drop/mark satisfied |
| Missing/incomplete paginated observation | metric/status is `Unknown` or `Degraded` | coverage exception | empty = zero; healthy |
| Stale observation/attestation | status cannot be fresh/live | freshness alert | retain last healthy badge |
| Known unsafe effect violation | `Broken`, regardless of unknown observations | highest-severity incident | downgrade to unknown/healthy |
| Definition deployment during a run | existing instance retains its pin; new entry gets the new manifest | version trace | silent replan |
| Required replan | compatibility review, durable reason, old/new plan and cancellation set | approval/audit event | mutate history in place |
| D1 schema head mismatch | refuse activation/commands, open deployment exception | deployment alert | invoke against unknown schema |
| Runtime invocation unrecognized | deployment assertion is `Unknown` | provenance exception | infer from Git SHA alone |

## Privacy, access, and retention

Raw provider payloads and complete message bodies are restricted evidence, not Staff-list data.
Before Phase B stores any new payload, it must define field minimization, encryption/access boundary,
retention expiry, deletion/DSAR route, export policy, and audited roles. Staff receives redacted
identifiers and safe next actions by default. Operator state transitions, evidence reads, exports,
and suppressions require actor/time/reason audit events. This Phase A package stores no data.

## SLOs, alerts, and backpressure

Phase B must nominate per-family SLOs for receipt acceptance latency, due-obligation age,
unreconciled ambiguous attempts, reconciliation freshness, exception acknowledgement, queue depth,
and provider error rate. Each has a window, owner, severity, paging threshold, and runbook.
Backpressure retains durable obligations and exposes estimated delay only with complete coverage; it
may not silently discard, widen a send window, or change provider ownership.

## Migration states

`legacy_approximation`, `external_verified`, `shadow_compiled`, `attested_live`, and `unknown` are
explicitly distinct. Historical data lacking a node/plan pin is `legacy_approximation`; it is not
backfilled by UI inference. A family advances only after its stated gate is evidenced.
