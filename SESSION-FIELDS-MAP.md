# Session-Fields Ecosystem Map

*Generated 2026-06-03. Reference doc for anyone changing code that reads or writes the 5 GHL session-fields custom fields. Companion to `SESSION-FIELDS-AUDIT.md` (which has design decisions); this doc has the code map.*

## The 5 fields

| Field | ID | Type |
|---|---|---|
| `series_type` | `3i93lTkmuAV49s9nh0q8` | Dropdown: none / 4-session / 8-session |
| `sessions_remaining` | `wrQSkx6BhXwDGIn1d0V4` | Numerical (prepaid package balance) |
| `sessions_completed` | `TE0udwVH1Km5RsKaN5H0` | Numerical ("Sessions Lifetime") |
| `sessions_remaining_locked` | `oDyLqIeq3yTkyhgXhAmk` | Checkbox (lock against worker overwrite) |
| `session_prepaid` | `sgQ5EbJWhvTfGVhStaOO` | Yes/no (declared but unused in code) |

---

## 1. Writers (who mutates the fields)

### `series_type` + `sessions_remaining`
- **GHL workflows C1 / C2 / C1b / C2b / C2c** — primary writer on order submitted
- **`functions/api/ghl-purchase-webhook.js`** — backstop when workflow misfires (uses `PRODUCT_MAP`)
- **`functions/api/ghl-invoice-webhook.js`** — same backstop, invoice-side (`INVOICE_PURCHASE_PRODUCTS`)
- **`series-reconcile-worker/src/reconcile.js`** — hourly cron, catches orphan POS purchases (`PACKAGE_PRODUCTS`)
- **`series-reconcile-worker/src/sync.js`** — continuous sync to ledger-derived value; guards: only write on change, only when confidence=high, only if field untouched in last 5min, only if delta ≤ MAX_AUTO_DELTA(2)

### `sessions_remaining` decrement / `sessions_completed` increment
- **`functions/api/staff-mark-attended.js`** — when Garrett taps "attended" in the staff app. Excludes entrainments + partner sessions from package decrement (NON_PACKAGE_PATTERNS regex). Auto-flips paired entrainment within ±90 min of follow-up.

### `sessions_remaining_locked`
- No app-side writer. Only set via direct GHL UI edit.

### `session_prepaid`
- Not set by any code path found. Manual or workflow only.

---

## 2. Readers (who consumes the field values)

### Direct field readers (bypass the ledger)
- **`functions/api/staff-contacts.js:100-101`** — `/staff-contacts` search/autocomplete reads `sessions_remaining` and `series_type` from the field directly. Does NOT go through ledger. Correct because field is authoritative for autocomplete display.
- **`functions/api/staff-mark-attended.js:150`** — reads current `sessions_remaining` value to compute `-1`. Relies on field being accurate before write.
- **`daily-audit-worker/src/rules.js`** — six audit rules read raw field values for drift comparison.

### Ledger-derived readers (go through `deriveLedger`)
All 5 read endpoints now read `ledger.display.{seriesType, remaining}`:
- **`functions/api/staff-balances.js`** — /staff/balances list page
- **`functions/api/staff-contact.js`** — /staff/clients/{id} detail page
- **`functions/api/staff-data.js`** — /staff/today appointments
- **`functions/api/portal-data.js`** — client-facing portal
- **`functions/api/cos-chat.js`** — LLM context

### React components rendering session data
- `staff/src/components/SessionStats.tsx` — via staff-contact
- `staff/src/components/PaymentStatus.tsx` — via staff-contact
- `staff/src/components/ClientRow.tsx` — via staff-contacts (direct field read path)
- `staff/src/components/AppointmentCard.tsx` — via staff-data
- `staff/src/pages/BalancesPage.tsx` — via staff-balances
- `portal/src/components/ProgressTracker.tsx` — via portal-data; has dedicated low-confidence UI state
- `portal/src/components/QuickActions.tsx` — via portal-data
- `portal/src/components/SessionHistory.tsx` — counts appointments client-side, doesn't read fields

### GHL workflows reading the fields
- **E5 — Living Practice Onboarding** (PUBLISHED, HIGH RISK) — triggers on `series_type=8-session AND sessions_remaining=2`. Load-bearing for any code that changes `sessions_remaining` mid-series — a write of 2 (even momentarily) re-fires E5.
- **E4 — Mid-Series Check-In** (DRAFT) — `series_type=4-session AND sessions_remaining=2` OR `series_type=8-session AND sessions_remaining=4`
- **E6 — Series Completion** (DRAFT) — `sessions_remaining=0`

---

## 3. GHL-orders integration points

| File | Endpoint | Order-id access pattern |
|---|---|---|
| `functions/lib/session-ledger.js:382-394` | `GET /payments/orders?contactId=...` (LIST) | Hydrates via shared helper |
| `functions/lib/ghl-orders.js:65-67` | (caller-provided fetcher) | **`o._id` only** — does NOT fall back to `o.id` |
| `functions/api/staff-contact.js:74` | `GET /payments/orders?contactId=...` (LIST) | Passes to hydrateOrders |
| `functions/api/staff-data.js:159` | Same | Same |
| `functions/api/portal-data.js:122` | Same | Same |
| `functions/api/cos-chat.js:501` | Same | Same |
| `functions/api/ghl-purchase-webhook.js:332` | `GET /payments/orders?contactId=...` | **`order._id \|\| order.id \|\| order.orderId`** — defensive fallback chain |
| `series-reconcile-worker/src/sync.js:208, 213` | LIST → hydrateOrders | `o._id` (after consolidation 2026-06-03) |
| `series-reconcile-worker/src/ghl.js:119` | `GET /payments/orders/{id}` (DETAIL) | `_id` |
| `series-reconcile-worker/src/index.js` | `listRecentCompletedOrders` paginated | `o._id` |

**Inconsistency flagged:** `ghl-purchase-webhook.js` uses the defensive `_id || id || orderId` fallback. Every other site uses `_id` only. Either GHL has historically shipped at least one endpoint with `id` (and that's why the fallback was added), or it's over-engineered defense. Cheap to align — add the fallback to `ghl-orders.js`.

---

## 4. Hydration sites

Every place that calls `hydrateOrders` or its inline equivalents (all consolidated 2026-06-03):

| File | Caller | Concurrency |
|---|---|---|
| `functions/lib/session-ledger.js:21-31` | Pages-side wrapper, called by `computeSessionLedger` + 4 read endpoints | Default 5 |
| `series-reconcile-worker/src/sync.js:130, 213` | Worker — both `syncFieldsForContact` and `reconcileOrder` paths | Default 5 |
| `daily-audit-worker/src/index.js:447` | New drift watchdog | Default 5; chunked at 3 contacts |

Pre-consolidation there were 5 separate hydration implementations with different behaviors. Now one shared helper at `functions/lib/ghl-orders.js`.

---

## 5. Watchdogs / audits

| Worker | Function | Trigger | Action |
|---|---|---|---|
| `daily-audit-worker/src/rules.js` | `sessions_remaining_not_incremented` | After purchase, field < expected | Surface as warning |
| ` ↳ ` | `series_type_not_set` | After purchase, series_type mismatch | Surface as warning |
| ` ↳ ` | `series_active_but_zero_remaining` | `series_type != "none"` but `sessions_remaining=0` | Surface |
| ` ↳ ` | `series_type_dropped` | `sessions_completed > 0` but `series_type` null | Surface (skipped if orders unavailable) |
| ` ↳ ` | `message_series_type_mismatch` | Message body markers conflict with field | Surface |
| ` ↳ ` | `has_quiz_and_active_series` | "quiz submitted" tag + active package | Surface |
| `daily-audit-worker/src/index.js:checkSessionLedgerDrift` (2026-06-03) | Walks every contact with active series; runs deriveLedger; surfaces low-confidence + locked rollup | Warning + Info |
| `daily-audit-worker/src/index.js:checkSeriesReconcile` | Pings `ops:series-reconcile:lastRun` KV | Surface if stale > 6h |
| `series-reconcile-worker/src/index.js` `/needs-review` | When sync skips a contact due to delta > MAX_AUTO_DELTA(2) | Writes to `field-sync:needsReview:` KV prefix for surfacing |

**Overlap to watch:** The new `checkSessionLedgerDrift` and the existing `MAX_AUTO_DELTA` needs-review path can both flag the same contact. Worth deduping in the briefing output.

---

## 6. Webhook handlers (the field writers triggered by GHL events)

| Endpoint | Trigger | Idempotency | Mutations |
|---|---|---|---|
| `POST /api/ghl-purchase-webhook` | GHL "Order Submitted" | `processed:{orderId}` in PURCHASE_KV (30d TTL) | Sets `series_type`, `sessions_remaining`, conditionally `portal_access`, `living_practice_access`; tag cleanup |
| `POST /api/ghl-invoice-webhook` | GHL "Invoice Paid" | Per invoice ID in PURCHASE_KV | Same field set as purchase webhook |
| `POST /api/staff-mark-attended` | Staff app tap | Skips if appointment already `showed`/`completed` | Decrements `sessions_remaining`, increments `sessions_completed` |

---

## 7. Cross-worker imports

```
functions/lib/session-ledger.js  ← imported by ──┬── functions/api/* (5 read endpoints)
                                                  ├── series-reconcile-worker/src/sync.js
                                                  └── daily-audit-worker/src/index.js (2026-06-03)

functions/lib/ghl-orders.js      ← imported by ──┬── functions/lib/session-ledger.js
                                                  ├── series-reconcile-worker/src/sync.js
                                                  └── daily-audit-worker/src/index.js

functions/lib/ghl-products.js    ← imported by ──┬── functions/api/ghl-purchase-webhook.js
                                                  ├── functions/api/ghl-invoice-webhook.js
                                                  ├── functions/lib/session-ledger.js
                                                  └── series-reconcile-worker/src/reconcile.js
```

Wrangler bundles transitively across worker boundaries. **No CI build check** verifies the workers build green when a shared lib changes — a typo in `session-ledger.js` would break both workers and the failure surface is "next cron tick errors."

---

## 8. Test coverage matrix

| File | Test file | What's covered |
|---|---|---|
| `functions/lib/session-ledger.js` | `session-ledger.test.js` | 64 tests — classifyOrder, classifyInvoice, deriveLedger, hydration path, display block |
| `functions/lib/ghl-orders.js` | `ghl-orders.test.js` | 10 tests — concurrency, failures, position preservation |
| `functions/lib/ghl-products.js` | `ghl-products.test.js` | Map structure (currently has pre-existing failures — outdated product counts) |
| `functions/api/ghl-invoice-webhook.js` | `ghl-invoice-webhook.test.js` | Invoice selection, product classification |
| `functions/api/portal-data.js` | `portal-data.test.js` | Field extraction, ledger derivation |
| `portal/src/components/ProgressTracker.tsx` | `portal/tests/progress-tracker.spec.ts` | Dashboard state, dot rendering |

**Untested:**
- `staff-mark-attended.js` — critical attendance path, zero automated tests
- `series-reconcile-worker/` (reconcile + sync) — tested via `/run` endpoint manually
- `daily-audit-worker/src/rules.js` + new `checkSessionLedgerDrift` — tested via cron manually
- `ghl-purchase-webhook.js` — tested via webhook simulation only

---

## 9. Inconsistencies catalogued

1. **Order-id pattern.** `ghl-purchase-webhook.js` uses `_id || id || orderId`. Every other site uses `_id` only. Aligning everything to the fallback is cheap defensive insurance.

2. **Custom field read pattern.** Three styles in use: by raw ID (`staff-mark-attended.js`), by short key with fieldDefs map (`portal-data.js getCustomField`), by extracted shape (`daily-audit-worker/src/ghl.js extractFields`). Functionally equivalent; cosmetically inconsistent.

3. **RESOLVED 2026-06-03 — entrainment counting was actually consistent.** Initial map entry was wrong: I conflated `ledger.attended` (package-only, correctly excludes entrainments via `SERIES_CALENDAR_IDS`) with `sessions_completed` (lifetime, correctly includes entrainments via `NON_JOURNEY` regex). Both backend regexes (`NON_JOURNEY_PATTERNS`, `NON_PACKAGE_PATTERNS` in staff-mark-attended.js, computeLifetimeCount in sync.js) match Eben's rule: entrainments count toward lifetime but not against package; phone calls count toward neither. Portal-side filter was the actual gap — fixed in `a35f899` (functions/api/portal-data.js, portal/src/components/ProgressTracker.tsx, portal/src/pages/DashboardPage.tsx) to match the backend regex.

4. **Lock semantics divergence.** `sync.js` skips locked contacts entirely. `daily-audit-worker` surfaces them in a rollup but doesn't suppress its own checks for them. New `checkSessionLedgerDrift` (2026-06-03) generates a daily INFO line for every locked contact unconditionally — Eben's todo-discipline rule says don't.

5. **Hydration failure surfacing.** Pages-side flags `__hydration_failed` on the order and pushes ambiguity into deriveLedger (drops confidence). Worker side does the same after the 2026-06-03 consolidation — pre-consolidation it silently fell back. Audit-side surfaces via the new drift watchdog.

6. **`session_prepaid` field is dead.** Declared in `staff-mark-attended.js:16` but never read. Either remove or document intended use.

7. **Candidate contact filter for audits.** `staff-balances.js:128-134` filter includes `prepaidOverride` (=`session_prepaid==yes`). The new `checkSessionLedgerDrift` filter only checks `series_type != "none"` or `remaining > 0`. A contact whose only signal is `session_prepaid` (the case `deriveLedger` flags as an ambiguity) is invisible to the drift watchdog.

8. **`/contacts/search` pagination caps.** `staff-balances.js:15` and `daily-audit-worker/src/index.js:378` both cap at 10 pages × 100 = 1000 contacts. No warning when the cap is hit. Account is approaching this size.

9. **Cross-worker import has no CI guard.** A change to `session-ledger.js` could break both workers' bundle, with the failure surfacing on next cron tick.

---

## 10. Key decisions from SESSION-FIELDS-AUDIT.md

1. **Ledger is canonical on the read path.** All human-facing surfaces (portal, staff app, COS chat) go through `deriveLedger`. Custom fields are a cache, not the source of truth.

2. **`series-reconcile-worker` keeps the field in sync to the ledger.** Hourly cron. Catches orphan POS / invoice purchases the C-series workflows miss.

3. **`sessions_remaining_locked` blocks the worker, not user actions.** When set, the worker skips that contact. But `staff-mark-attended.js` still decrements on real attendance — the lock is for automated drift correction only, NOT user-initiated events. See `series-reconcile-worker/src/sync.js:217-221`.

4. **E5 workflow trigger is load-bearing.** Fires on `sessions_remaining=2`. Any continuous sync must guard against re-firing E5 by only writing on change + when confidence=high + after 5-min manual-edit debounce.

5. **Race between `staff-mark-attended` and `series-reconcile-worker`.** Worker reads `dateUpdated`; skips contacts touched in last 5 min.

6. **Two semantics in one field.** `sessions_remaining` tracks both billing balance AND workflow decision points. Can't change semantics without breaking E5. Solution: keep field, sync continuously, migrate readers to ledger.

7. **Entrainments count toward lifetime per Eben's call.** Staff-side regex doesn't match this yet — 1-line fix open.

8. **E4 and E6 are intentional drafts.** Don't "fix" them by publishing.

---

## Pre-change checklist (use this before touching any session-fields code)

1. Re-read this map. Look up every neighbor that touches the field you're about to change.
2. Check for order-id pattern, custom-field read pattern, candidate filter — does your new code match neighboring code?
3. Will your write trigger a GHL workflow (E5 especially)? Account for the cascade.
4. Does an existing watchdog already cover what you're about to add?
5. If you add a new audit / drift surface, will it generate daily noise? Compare against the todo-discipline rule.
6. Tests: which existing test files should change? Are there untested paths your change relies on?
7. Cross-worker imports: does your change need to be deployed to a worker too? `git push` doesn't deploy worker subdirs — they need `wrangler deploy`.
