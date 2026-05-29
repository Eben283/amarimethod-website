# Session-fields drift fix #4 — audit + action plan

**Date**: 2026-05-29
**Goal**: Fully resolve drift cause #4 ("fields doing two jobs") without breaking anything live.

## Headline

**The blast radius is smaller than expected.** Most consumers have already been migrated to the ledger (portal, staff app's Balances + data + contact endpoints). The remaining risk is concentrated in a small number of clearly-identifiable spots.

**The biggest single win is making `series-reconcile-worker` continuously sync `sessions_remaining` to the ledger-derived value** — that makes the field self-healing without renaming or restructuring anything.

---

## WRITERS (set/modify the fields)

### In code (we control these)
| File | What it writes | When | Risk |
|---|---|---|---|
| `functions/api/ghl-purchase-webhook.js` | SETs `sessions_remaining` to package size | On payment_link order | Low — works as designed |
| `functions/api/ghl-invoice-webhook.js` | SETs `sessions_remaining` to package size | On invoice paid | Low — works as designed |
| `series-reconcile-worker/src/reconcile.js` | SETs `sessions_remaining` to package size | Hourly cron for orphan POS sales (deployed today) | Low — idempotent |
| `functions/api/staff-mark-attended.js` | INCREMENTS `sessions_completed` (+1), DECREMENTS `sessions_remaining` (-1) | When Garrett taps "attended" in staff app. **EXCLUDES** entrainments + partner sessions via `NON_SESSION_PATTERNS` regex | Medium — this is the live attendance-counting path. Excludes entrainments, which conflicts with Eben's "entrainments count as sessions" statement from 5/29. |

### In GHL workflows (live)
| Workflow | What it writes | When | Status |
|---|---|---|---|
| 4-Session Series Purchased (C1) | SET `sessions_remaining = 4` | Order Submitted, product = 4-pack | Published, restored 2026-03-29 |
| 8-Session Series Purchased (C2) | SET `sessions_remaining = 8` | Order Submitted, product = 8-pack | Published |
| Purchase — Upgrade to 4-Session (C1b) | SET `sessions_remaining = 3` | Order Submitted, upgrade-to-4 | Published |
| Purchase — Upgrade to 8-Session (C2b) | SET `sessions_remaining = 7` | Order Submitted, upgrade-to-8 | Published |
| Initial booking workflows (Initial-IP / Initial-V) | ADD 1 to `sessions_remaining` | Customer Booked Appointment (initial calendars) | Published |
| **Attendance Confirmed — Update Contact & Pipeline (b87ccbc2)** | Would SUBTRACT `sessions_remaining` + INCREMENT `sessions_completed` on attendance | **PERMANENTLY DRAFT/DISABLED 2026-03-29.** Replaced by `staff-mark-attended.js`. | Not firing |

---

## READERS (depend on field values to make decisions)

### Already on the ledger (do NOT depend on raw field) ✓
| Consumer | Status |
|---|---|
| `functions/api/portal-data.js` | Migrated 2026-05-29 — uses `deriveLedger` |
| `portal/src/components/ProgressTracker.tsx` | New two-counter design, derives from ledger fields |
| `functions/api/staff-balances.js` | Uses `computeSessionLedger` |
| `functions/api/staff-data.js` | Uses ledger |
| `functions/api/staff-contact.js` | Uses ledger |
| `functions/lib/session-ledger.js` | Reads field only for ambiguity comparison, never as truth |

### Still reading the field as truth ⚠️
| Consumer | What it reads for | Risk |
|---|---|---|
| `functions/api/staff-mark-attended.js` | Reads `current` value to compute `+1` / `-1` | Medium — relies on field being accurate before write |
| `functions/api/staff-contacts.js` | Likely reads for list display (need re-check) | Low–Medium |
| `functions/api/cos-chat.js` + `functions/lib/cos-anthropic.js` | COS chatbot uses field values in conversational responses | Medium — bot could say wrong number when answering "how many sessions does X have left?" |
| `daily-audit-worker/src/rules.js` | Audit comparison logic (compares field to derived, flags drift) | Low — the drift surfacing IS the purpose |
| `~/.claude/ghl-mcp/qa-audit.js` | Daily QA audit invoked by `/day` skill | Low — same drift-surfacing purpose |
| `~/.claude/ghl-mcp/morning-check.js` | Morning briefing data feeder | Medium — surfaces "sessions_remaining is 0" warnings to /day briefing using raw field |
| `staff/src/components/SessionStats.tsx` | Staff app UI showing client session counts | Medium — if field drifts, staff sees wrong number |
| `staff/src/components/AppointmentCard.tsx` | Per-appointment context | Low |
| `staff/src/components/ClientRow.tsx` | Client list rows | Low–Medium |
| `staff/src/components/PaymentStatus.tsx` | Payment status display | Low |
| `staff/src/pages/ClientDetailPage.tsx` | Client detail view in staff app | Medium |
| `staff/src/data/checklists.ts` + `generateChecklist.ts` | Checklist logic | Low — needs re-read to confirm semantic |

### GHL workflow conditions filtering on the field
| Workflow | Condition | Currently fires? |
|---|---|---|
| **E5 Living Practice Onboarding** | `series_type=8-session AND sessions_remaining=2` → email | **YES (Published)** — high-risk if we change field semantics |
| E4 Mid-Series Check-In | `series_type=4-session AND sessions_remaining=2` OR `series_type=8-session AND sessions_remaining=4` → email | No (Draft per Eben's intentional rule) |
| E6 Series Completion | `sessions_remaining=0` → email branches by series_type | No (Draft) |

### Email merge tags (places client could see the raw field value in copy)
**Only one workflow uses `{{contact.sessions_completed}}` in copy: E4** — and it's a permanent draft. **Zero published workflows leak the raw field into client-facing email.** ✓

---

## RISK ASSESSMENT — what could break if we touch this

### High-risk
1. **E5 firing logic** — `sessions_remaining=2` is the trigger. If a continuous sync from the worker writes the field on every hourly run, and the value lands at exactly 2 from a ledger correction (not from attendance), E5 fires with stale-feeling timing. Mitigation: only write when value would CHANGE, and only when `ledger.confidence === 'high'`.
2. **staff-mark-attended.js race with worker** — staff app writes the field after Garrett taps "attended"; worker might immediately overwrite with stale ledger-derived value if it hasn't picked up the appointment yet. Mitigation: worker reads `updatedAt` on the field; skips contacts whose field was touched in the last 5 minutes.

### Medium-risk
3. **Staff-app UI components** — currently show field values directly. If field is stale, staff sees stale numbers. **Solution: migrate these reads to come from the ledger via staff-balances/staff-contact endpoints** (which already use the ledger). No GHL change needed; just rewire the frontend.
4. **COS chat answers** — when Eben asks "how many sessions does Justin have left," the bot looks up Justin's field. If field is drifted, answer is wrong. **Solution: migrate cos-anthropic.js to use the ledger** (same as portal-data.js did).
5. **/day briefing** — uses qa-audit.js + morning-check.js, which read raw fields and surface drift as issues. If we sync the field, the drift warnings go away. That's the goal, but it does mean we lose the daily "drift detected" signal — replace with ledger-based comparison.

### Low-risk
6. **Email merge tags** — none in production. Only E4 has one and it's intentionally draft.
7. **Test files / fixtures** — synthetic data, no production impact.

### Active conflict with Eben's intent
**Entrainments don't count toward `sessions_completed` in `staff-mark-attended.js`** (excluded by `NON_SESSION_PATTERNS` regex). But Eben said 5/29 "entrainments count as sessions, so they would show up." The portal redesign already counts entrainments in the lifetime counter (via status-based filter). So:
- Staff app's attended endpoint: entrainments NOT counted
- Portal display: entrainments ARE counted (status-based)

**This is its own drift bug.** Either the regex should be removed (let entrainments increment `sessions_completed`), or the portal should match the regex (excluding entrainments). My read of Eben's intent today: remove the regex exclusion for entrainments. Easy 1-line change.

---

## Action plan — incremental, low-risk

### Phase A — pure code migrations (no GHL changes, no behavior change for users)
**Goal: shrink the set of code that reads raw fields. Each migration is independently safe.**

1. **Fix the entrainment counting** in `staff-mark-attended.js` — remove `entrainment` from `NON_SESSION_PATTERNS`. Aligns with Eben's call. 5-minute change. (Optional: also remove `partner`.)

2. **Migrate `cos-anthropic.js` + `cos-chat.js` to ledger** — same pattern as portal-data.js. So the chat bot answers correctly. ~30 min.

3. **Migrate staff app components** (SessionStats, AppointmentCard, ClientRow, ClientDetailPage) to read counts from the staff-balances/staff-contact API instead of raw GHL field. Most of the staff app already does this; the holdouts are individual components. ~1-2 hr.

4. **Migrate `morning-check.js` + `qa-audit.js`** in `~/.claude/ghl-mcp/` to compute the ledger derivation rather than read the raw field. This changes what /day briefing reports — drift warnings are replaced by ledger-confidence warnings. ~1 hr.

**End of Phase A**: portal, staff app, /day briefing, and COS chat all show ledger-derived values. The GHL fields are no longer authoritative for any human-facing surface.

### Phase B — make the field self-healing (low risk if done with guards)
**Goal: GHL field stays in sync with the ledger so any remaining workflow-condition consumers (E5) fire on correct values.**

5. **Expand `series-reconcile-worker`** to also sync `sessions_remaining` continuously. New behavior on every hourly run: for every contact with `active package + ledger.confidence === 'high' + ledger.remaining !== sessions_remaining + contact_updatedAt > 5min ago`, write the ledger value to the field. Idempotent via KV (don't write if already in sync). ~1 hr code + 1 week of monitoring.

6. **Same for `sessions_completed`** — lifetime count derived from past appointments. Lower risk since no workflow currently triggers on this field directly. ~30 min.

**End of Phase B**: any workflow that reads `sessions_remaining` (only E5 today) fires on the correct value. Drift becomes a self-healing condition, not a permanent miscount.

### Phase C — formalize semantics
7. **Update `GHL-WORKFLOWS-MASTER.md`** with a clear "Session-fields contract" section: `sessions_completed = lifetime`, `sessions_remaining = package balance`, with the full rule of who writes when. Future workflow edits have to honor this contract.

8. **Annotate the GHL field descriptions** in the GHL UI custom-fields screen with the contract, so anyone editing a workflow sees the intent.

### What NOT to do
- Don't rename or delete the existing GHL fields. They keep their IDs.
- Don't auto-publish E4/E6. Eben's rule says they're intentional drafts.
- Don't migrate the C-series workflow SET actions. They work fine; the worker provides the safety net for the cases where they don't fire.
- Don't try to fix everything in one PR. Each phase ships independently.

---

## Recommended ordering

Lowest risk → highest:
- **Today (now if you want)**: Step 1 (entrainment regex), Step 7 (doc update)
- **Next session**: Step 5 (worker continuous sync) — gives biggest single win, makes field self-healing
- **Following session**: Steps 2–4 (migrate remaining readers to ledger) — eliminates drift sensitivity from every human-facing surface
- **Eventually**: Step 8 (GHL UI field annotations)

Step 5 is the biggest leverage point. It alone fully resolves #4 in practice, because once the field is self-healing, the "two jobs" ambiguity stops causing visible problems regardless of which consumer reads which.

Want me to do step 1 + step 7 now (10 min)? Or jump straight to step 5 (the worker sync)?
