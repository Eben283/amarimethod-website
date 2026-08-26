# Phase C — Follow-Up observed deployment readback (shadow only)

Phase C records a *read-only observation* in a canonical, immutable shape. It does not introduce an attested release, deployment, invocation, Staff endpoint, D1 write, Worker import, GHL call, sender, binding, or feature flag. The sole live Follow-Up sender remains **Follow up session Confirmation email / reminder flow** in GHL.

## Exact observed scope

The committed fixture captures the August 26, 2026 readback of the `reminder-engine` Worker:

- Cloudflare deployment `fa1d09eb-a0af-47e9-bc6e-a44652d59dc9`, version `121f69d8-770f-4c58-adab-0574bece9f1d`, 100% traffic, and script ETag;
- runtime-declared source revision and bundle identity;
- normalized non-secret binding identities/values (hashed) and secret *presence* metadata only;
- the bound `REMINDER_DB` identity, D1 `reliability-spine-v1` head, and the six required reliability-spine tables;
- Phase B compiler, compiled-plan, and release-manifest digests derived from the committed Follow-Up fixture.

It deliberately contains no secret values, customer data, provider receipt, enrollment, or synthetic invocation.

## What this can and cannot prove

The control-plane deployment reports `source: version_upload`. Cloudflare therefore does not attest a Git source revision for that deployment. Its runtime declares `SOURCE_REVISION=14e8f5b62ac77e94289757d2ddb088c74b7b2e6b`, which predates the merged Phase B source and does not import Phase B. Remote D1 reports its migration/version and table coverage but has no stored source hash.

Accordingly the pure projection is **Unknown**, never Live or Healthy. It stays Unknown for absent build/lock/compiler/handler/message artifact attestations, version-upload provenance, absent remote schema source hash, missing Phase B runtime reference, expired observations, and the fact that an observation is not durable runtime attestation. A valid mismatch is **Broken** and takes precedence: digest tampering, binding/D1 identity drift, schema head drift, or a conflicting observed source hash cannot be softened to Unknown.

The observation expires at its recorded `expiresAt`; readers must invalidate it after that TTL rather than retaining a reassuring label. The projection returns reason codes plus observed/freshness timestamps and identity references so a future Staff view can cite authority, observed values, coverage, and limitations without extrapolating.

## Deferred to a later, separately approved phase

No synthetic or backfilled customer activity is used. A future ordinary Follow-Up invocation may bind its durable receipt/lifecycle instance/obligations/command attempts/provider evidence to an actual source-attested deployment record only after the deployment attestation, remote schema hash/coverage, and runtime import gates are satisfied. That future work must use the existing reliability spine; it must not create a parallel execution ledger or call this observed fixture a cutover.
