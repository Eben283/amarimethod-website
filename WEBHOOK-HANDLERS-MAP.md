# Webhook Handlers & GHL Writers Map

*Generated 2026-06-03. Reference doc for anyone changing handler code that writes to GHL. Companion to `SESSION-FIELDS-MAP.md` (which catalogs the session-fields ecosystem); this doc catalogs every endpoint and worker that mutates GHL state.*

> **2026-06-03 corrections** — two adversarial reviewers ran against the first draft of this doc. Some 🔴 findings were verified and shipped as fixes; one was downgraded after closer reading; new findings were added. Section 6 reflects the final state.

## 1. Handlers by trigger source

### GHL webhooks (POST from GHL workflow)

**`POST /api/ghl-purchase-webhook`** — Order Submitted backstop
- Auth: `X-Webhook-Secret`
- Payload: contact_id, product_id, order_id (multiple key names tried)
- Idempotency: KV `order:{orderId}` 24h TTL
- Writes: `sessions_remaining` (SET or ADD), `series_type`, `portal_access`, `living_practice_access`; tags (`booked-initial-*`, `paid-via-native-checkout`); appointment (creates initial if requested_session_slot present); notes
- Partial-success risk: HIGH — appointment booking can fail after fields written; recorded as note but client unaware
- Workflow side effects: "Initial Session paid" via tag; appointment creation fires reminder workflows

**`POST /api/ghl-invoice-webhook`** — Invoice Paid backstop
- Auth: `X-Webhook-Secret`
- Payload: contact_id, invoice_id (multiple key names tried)
- Idempotency: KV `invoice:{invoiceId}` 30-day TTL
- Writes: `sessions_remaining` (SET), `series_type`, `portal_access`, `living_practice_access`; tags (remove discovery/quiz/ambassador, add `invoice-series-purchased`)
- Workflow side effects: `invoice-series-purchased` fires C-series confirmation + post-purchase cleanup
- Test file: `functions/api/ghl-invoice-webhook.test.js` (the only handler with any test coverage)

**`POST /api/referral-complete`** — referral milestone tracker
- Auth: `X-Webhook-Secret`
- Payload: contactId (referred contact who purchased)
- Idempotency: implicit via `referred_by_client_id` CLEAR (referrer can't be double-counted for same purchase)
- Writes: clears `referred_by_client_id` on referred; increments `client_referral_count` on referrer; on milestone (>=3) generates AMARI-{suffix} coupon, sets `referral_reward_code`, adds `client-referral-milestone` tag
- Partial-success: coupon API call may fail (no payments scope on token); code stored regardless, Garrett honors manually
- Workflow side effects: milestone tag triggers reward email

### Staff app POST (JWT bearer, role=staff)

**`POST /api/staff-mark-attended`** — attendance + decrement
- Idempotency: status pre-check (skips if appt already `showed`/`completed`)
- Writes: appt status → `showed`; `sessions_remaining` (DECREMENT if drawsFromPackage); `sessions_completed` (INCREMENT if countsTowardLifetime); `session_prepaid` (SET `no` if remaining→0); paired entrainment appt also flipped to showed
- **Partial-success: CRITICAL** — appt PUT succeeds, then field PUT fails → returns 422 with `appointmentUpdated:true, sessionCountUpdated:false`. Caller must retry field update or contact shows wrong state.
- **No tests** despite being the most-fired writer in the system.

**`POST /api/staff-toggle-prepaid`** — `session_prepaid` boolean
- Idempotency: none (client must avoid double-click)
- Writes: `session_prepaid` only

**`POST /api/staff-partner-outcome`** — outreach signal
- Idempotency: none (each call records a new touch)
- Writes: `partner_last_signal`, `partner_last_signal_at`, `partner_touch_count` (INCREMENT), `partner_stage` (via SIGNAL_TO_STAGE map; promotes no-outreach→working on first touch); `partner_followup_at` (if deferred); always adds a note prefixed `Outcome:` / `Touch:` / `Skip:`
- Workflow side effects: stage transitions fire stage-specific nurture campaigns

**`POST /api/staff-partner-update-field`** — generic partner field write
- Idempotency: compare current value, skip write if unchanged
- Writes: whitelisted partner fields only (phone/email/website/companyName/address1/city/state/postalCode/partnerInstagram/partnerLinkedinUrl/partnerFacility/partnerFacilityRole/partnerOtherUrls/partnerRundown)
- Audit note records before/after for trail

**`POST /api/staff-not-a-fit`** — mark partner not a fit
- Writes: Partnership Pipeline opportunity → `status=lost`, stage → Future Potential
- Workflow side effects: stage transition may pause nurture / trigger "revisit later" campaign

**`POST /api/staff-note`** — add note
- Writes: POST to `/contacts/{id}/notes`
- Idempotency: none (each call creates a new note)

**`POST /api/staff-checkin`** — signature capture
- Writes: KV `attestation:{contactId}:{ts}` (PURCHASE_KV); tag `policies-signed-{AGREEMENT_VERSION}` (idempotent via check); note with embedded signature image
- Partial-success: legal record is the KV entry; tag/note are best-effort

**`POST /api/staff-send-paylink`** — send payment link SMS
- Idempotency: none (each call sends an SMS)
- Writes: posts SMS message via `/conversations/messages`
- Workflow side effects: link click triggers order-received workflows (ghl-purchase-webhook + C-series)

**`POST /api/staff-send-toolkit`** — partner toolkit SMS
- Writes: add `affiliate-partner` tag (idempotent); move Partnership Pipeline opportunity to Partner/Won stage; POST toolkit SMS
- Workflow side effects: affiliate-partner tag + Partner/Won stage fire affiliate onboarding

### Portal POST (JWT bearer, client session token)

**`POST /api/portal-book`** — client books follow-up
- Idempotency: none (each call creates a new appointment)
- Writes: POST `/calendars/events/appointments`
- Workflow side effects: appointment confirmations / reminders

**`POST /api/portal-cancel`** — client cancels
- Idempotency: GHL-level (re-cancelling a cancelled appt is no-op)
- Writes: PUT appt → `appointmentStatus: cancelled`
- Ownership check blocks cancellation if the appt isn't the caller's contact

### Public POST (no auth)

**`POST /api/send-to-ghl`** — quiz submission
- Auth: none; IP rate limit (3/hr via KV)
- Writes: upsert contact; ~17 quiz custom fields; tags (`quiz submitted`, `pain-severity-*`, `pain-location-*`, `audience-{bay-area|remote}`, `referred-by-*`)
- Workflow side effects: `quiz submitted` tag fires B-series nurture + initial-session offer
- Partial-success: contact upsert may succeed but custom-field PUT fail → quiz results lost

### Scheduled writers (cron Workers)

**`series-reconcile-worker`** — hourly, dual purpose:
- `reconcile.js`: orphan-order detection. KV `processed:{orderId}` 90d TTL. Writes same field set as ghl-purchase-webhook if confidence guard passes.
- `sync.js`: continuous field-sync. 5-min manual-edit debounce + lock checkbox + MAX_AUTO_DELTA=2 guard. Writes `sessions_remaining` (SET) + `sessions_completed` (max, monotonic).

**`partner-activity-refresh-worker`** — multiple times daily:
- Writes `partner_last_activity_at` per partner contact
- No idempotency (timestamp write; latest wins)

**`daily-audit-worker`** — read-only (no writes)

**`ghl-token-worker`** — writes KV tokens, no GHL writes

**`ecosystem-scanner`** — read-only

## 2. Field-by-field writer matrix

| Field | Writers | Operation | Risk |
|---|---|---|---|
| `sessions_remaining` | ghl-purchase-webhook, ghl-invoice-webhook, staff-mark-attended, sync.js, reconcile.js | SET / ADD / DECREMENT | **🔴 5 writers, race-condition prone** |
| `sessions_completed` | staff-mark-attended, sync.js | INCREMENT / SET max (monotonic) | 🟡 Two writers, sync.js is monotonic so safer |
| `series_type` | ghl-purchase-webhook, ghl-invoice-webhook, reconcile.js | SET | 🟢 Never decremented |
| `portal_access` | ghl-purchase-webhook, ghl-invoice-webhook, reconcile.js | SET true | 🟢 Boolean, no conflict |
| `living_practice_access` | ghl-purchase-webhook, ghl-invoice-webhook, reconcile.js | SET true if 8-pack | 🟢 Boolean |
| `session_prepaid` | staff-mark-attended, staff-toggle-prepaid | SET | 🟡 Auto-clear vs manual toggle |
| `sessions_remaining_locked` | (GHL UI only, no code writer) | manual checkbox | 🟢 |
| `partner_stage` | staff-partner-outcome | SET per signal | 🟢 single writer |
| `partner_last_signal{,_at}` | staff-partner-outcome | SET | 🟢 |
| `partner_followup_at` | staff-partner-outcome | SET if deferred | 🟢 |
| `partner_touch_count` | staff-partner-outcome | INCREMENT | 🟢 single writer |
| `partner_last_activity_at` | partner-activity-refresh-worker | SET (re-writes hourly) | 🟢 |
| `referred_by_client_id` | referral-complete | CLEAR | 🟢 |
| `client_referral_count` | referral-complete | INCREMENT | 🟢 |
| `referral_reward_code` | referral-complete | SET at milestone | 🟢 |
| `partner_linkedin_url` + other partner profile fields | staff-partner-update-field | SET | 🟢 |
| Quiz fields (~17) | send-to-ghl | SET | 🟢 single writer |

## 3. Idempotency strategies catalogued

| Strategy | Used by | Failure mode |
|---|---|---|
| KV with TTL | ghl-purchase-webhook, ghl-invoice-webhook, reconcile.js | KV write fail proceeds silently → potential double-apply |
| Status pre-check | staff-mark-attended | Stale appt list → race possible if 2 staff act simultaneously |
| Field state match | reconcile.js | Doesn't catch partial workflow failures (tag didn't apply) |
| Manual-edit debounce | sync.js | Passive — doesn't prevent concurrent writes in same 5-min window |
| Manual override lock | sync.js, ledger.display | Requires admin intervention; can't auto-unlock |
| Compare-current-value | staff-partner-update-field | Race-safe for single user |
| **NONE** | staff-partner-outcome, staff-note, portal-book, portal-cancel, send-to-ghl, referral-complete, partner-activity-refresh-worker, staff-send-paylink, staff-send-toolkit, staff-checkin, staff-toggle-prepaid | Double-clicks create duplicates |

## 4. Tag-write side effects

| Written by | Tag | Triggers |
|---|---|---|
| ghl-purchase-webhook | `booked-initial-in-person`, `booked-initial-virtual`, `paid-via-native-checkout` | Initial Session confirmation + reminders |
| ghl-invoice-webhook | `invoice-series-purchased` | C-series confirmation + post-purchase cleanup |
| send-to-ghl | `quiz submitted`, `pain-severity-*`, `pain-location-*`, `audience-*`, `referred-by-*` | B-series quiz-result workflows, audience-segmented nurture |
| staff-checkin | `policies-signed-{version}` | Receipt/confirmation email |
| staff-send-toolkit | `affiliate-partner` | Affiliate onboarding |
| referral-complete | `client-referral-milestone` | Referral reward email |
| reconcile.js | (removes only: `discovery call attended`, `quiz submitted`, `ambassador-prospect`) | N/A |

## 5. Race condition risks

### 🔴 `sessions_remaining` 5-writer conflict
Most critical risk. Scenario: client buys 4-pack at 10:00. ghl-invoice-webhook fires at 10:00:05, writes `sessions_remaining=4`. sync.js was already running (started 09:58), reads `remaining=3` from earlier attended state, finishes at 10:00:30 with SET=3. Webhook's correct value overwritten.

Partial mitigation: sync.js debounces on `dateUpdated < 5min`. But debounce check runs at start of sync, not at write — if sync started before webhook fired, debounce wouldn't engage.

Real fix: KV-based write lock per contact across all writers. Or — bigger refactor — single writer (worker) that consumes a queue of mutation intents.

### 🔴 reconcile.js × staff-mark-attended
Reconcile reads contact at T0 (remaining=4, no orders applied yet), classifies as orphan, prepares SET=4. Staff marks attended at T0+10s (remaining → 3). Reconcile finishes at T0+20s with SET=4. Garrett's decrement lost.

Field-state-match guard (reconcile.js) catches the series_type case but not the remaining case.

### 🟡 partner-activity-refresh-worker timestamp drift
Worker re-writes `partner_last_activity_at` on every run. Field shows "fresh" timestamp even if no NEW activity since last check — just that the worker checked recently. Workflows triggering on "stale partner" can get fooled.

### 🟡 staff app concurrent edits
No client-side guard against two staff editing same contact. Last write wins. Garrett editing notes + Eben editing phone number → one loses.

## 6. Inconsistencies (ranked) — POST-REVIEW 2026-06-03

### 🟢 Order/invoice ID resolution variance — DOWNGRADED + partly FIXED
Original audit claim was overstated: it conflated webhook payload parsing (which SHOULD be defensive — GHL payloads genuinely vary by trigger type) with internal helper id extraction (which is fine because it consumes a known API shape). Real narrower risk: both `ghl-purchase-webhook.js:412` and the contactId extractor at `:401` included top-level `id` as a candidate. Could collide if a payload had top-level `id` — KV idempotency key became `order:<contactId>`. **Fixed 2026-06-03:** orderId extractor no longer uses top-level `id` blindly; falls back only if `id !== contactId`. Invoice webhook was already safe (contactId there doesn't try top-level `id`).

### 🔴 SET vs ADD semantics in ghl-purchase-webhook — UNFIXED
Same handler does SET for packages, ADD for single follow-ups based on product map. Misclassification = wrong operation, silently. Log + alert on unknown product still queued.

### 🔴 Custom-field value types inconsistent — UNFIXED
GHL returns string `"4"`, number `4`, array `["true"]` for different fields. PUT payloads also vary across writers (reconcile.js uses `{id, value}`, webhooks use `{id, field_value}`). Both accepted by GHL but cosmetic drift. Standardization deferred.

### 🟡 Invoice product silently skipped if unmapped — refined, still queued
Verified: both `ghl-invoice-webhook.js:233-241` and `ghl-purchase-webhook.js:438-444` `console.log` and return 200 OK with `skipped:true`. Not literally silent (logs exist) but silent to the operator. Improvement still queued: alert via daily-audit when amount ≥ $400 and product not in map (separates legitimate non-package no-ops from missed package products).

### 🟢 Error response codes vary — by design, one exception FIXED
Webhook handlers return 500 on upstream PUT failures because GHL retries on 5xx. Staff app returns 422 because UI handles it. Difference is justified by caller type. **Exception fixed 2026-06-03:** `staff-mark-attended.js:119` now returns 404 (was 422) when the underlying GHL contact fetch returns 404 — matches the webhook handler convention.

### 🟢 Partial-success states unstructured — REFRAMED
Original audit had this backwards: `staff-mark-attended` is the GOOD example with structured `{appointmentUpdated:true, sessionCountUpdated:false}`. Other handlers should adopt its shape. Tracked as a backlog refactor; not urgent.

### 🟡 RESOLVED 2026-06-03 — `sessions_remaining` 5-writer race scenario — DOWNGRADED
Original audit's specific scenario (sync.js running at 09:58, invoice-webhook firing at 10:00:05, sync.js overwriting at 10:00:30) does NOT trigger because `sync.js` fetches the contact fresh inside `syncFieldsForContact` (`sync.js:191-196`), not at cron start. So the 5-min `dateUpdated` debounce engages. `MAX_AUTO_DELTA=2` handles the rest. Real race window is narrower (~1s between mark-attended PUT and sync.js read). Existing guards cover it for now.

### 🟢 partner-activity-refresh-worker queue rebuild race
Concurrent requests could both trigger rebuild. KV CAS or rebuild lock would fix.

### 🟢 send-to-ghl geo-tagging accuracy
Relies on Cloudflare `cf-iplatitude/cf-iplongitude`. May be wrong. Tags drive workflow targeting — wrong geo = wrong campaign. Document caveat.

## 7. Test coverage matrix

**Coverage: ~5% of handlers.** Only `ghl-invoice-webhook.test.js` exists.

Untested (every one of these is a live writer to production GHL):
- ghl-purchase-webhook
- staff-mark-attended (the most-fired writer)
- staff-toggle-prepaid
- staff-partner-outcome
- staff-partner-update-field
- staff-not-a-fit
- staff-note
- staff-checkin
- staff-send-paylink
- staff-send-toolkit
- portal-book
- portal-cancel
- send-to-ghl
- referral-complete
- series-reconcile-worker (reconcile + sync)
- partner-activity-refresh-worker

## 8. Pre-write checklist

Before any handler change that mutates GHL:

1. **Idempotency** — does the handler have it? If not, why not? Are double-clicks user-recoverable or do they create duplicates?
2. **Field schema** — what fields are written? IDs match `TECHNICAL-REFERENCE.txt`?
3. **Conflict scan** — any other handler writes the same field? Check §2 matrix. Coordinate or lock.
4. **Tag side effects** — any tags added? Check §4 for what they trigger. Will the workflow fire correctly?
5. **Error code** — 400 (client) / 401-403 (auth) / 404 (not found) / 422 (upstream fail) / 500 (server). Consistent with neighbors.
6. **Partial success** — can mutation A succeed and mutation B fail? Return 422 with structured detail, not just an error string.
7. **Auth** — JWT vs X-Webhook-Secret vs public? Role/scope check correct?
8. **Test** — add a unit or integration test. If GHL-stateful, document the manual test plan.
9. **Doc** — does this change need an entry in `GHL-WORKFLOWS-MASTER.md` (if it triggers a workflow)? Update this file (`WEBHOOK-HANDLERS-MAP.md`) if the handler is new.
10. **Cross-worker imports** — if the change touches shared lib (`functions/lib/*.js`), check what each worker imports. Wrangler bundles transitively; a broken import breaks the worker silently until next cron tick.

## 9. Recommended fix priority

Based on this audit, ranked by impact-per-effort:

1. **🔴 Standardize order/invoice ID resolution** (1 hour) — single helper `resolveOrderId(payload)` used by all 3 callers. Same fix shape as the `_id`/`id` ghl-orders.js bug we just shipped.
2. **🔴 Alert on unmapped product** (30 min) — ghl-invoice-webhook + ghl-purchase-webhook log a warning when product ID isn't in the map. Daily-audit-worker drift watchdog could pick it up.
3. **🔴 Add tests for staff-mark-attended** (1-2 hours) — most-fired writer, zero coverage. At minimum: idempotency on already-showed, regex predicate boundaries (entrainment vs follow-up), partial-success response shape.
4. **🟡 KV-write-success guard in ghl-purchase-webhook** (15 min) — refuse 200 if KV idempotency write failed; current code silently proceeds.
5. **🟡 Standardize error codes** (1 hour) — sweep all handlers, normalize on the 400/401/403/404/422/500 split.
6. **🟡 Structured partial-success response** (1 hour) — convention for `{success: false, partial: {appointmentUpdated: true, sessionCountUpdated: false}, retry: [...]}`.
7. **🟡 sessions_remaining write coordination** (4+ hours, bigger refactor) — KV lock per contact OR collapse to single writer. Tradeoff: complexity vs eliminating the race-condition class.

Items 1-4 are concrete, scoped, high-impact. Item 7 is architecturally cleaner but bigger blast radius — worth a separate session.
