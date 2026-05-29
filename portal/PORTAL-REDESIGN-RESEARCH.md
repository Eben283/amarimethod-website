# Portal redesign research — what exists, what's broken, what to do

**Date**: 2026-05-29
**Context**: Conversation about killing "Step X of 8" + replacing with two-counter design

---

## Headline

**The hard work is already done.** `functions/lib/session-ledger.js` is a fully-built, unit-tested, pure-derivation engine that computes the correct prepaid balance from orders + invoices + appointments. It powers the staff app's Balances page perfectly. The portal just doesn't use it. **All it takes to make the portal stop lying is one import and one swap.**

---

## What the portal does today

### Architecture
- **`portal/src/pages/DashboardPage.tsx`** — orchestrates the page
- **`portal/src/components/ProgressTracker.tsx`** — owns the "Step X of 8" widget + the journey rail + the next-session card
- **`portal/src/hooks/useClientData.ts`** — wraps `fetch('/api/portal-data')`
- **`portal/src/types/portal.ts`** — `ClientData` shape includes `seriesType`, `sessionsCompleted`, `sessionsRemaining`, `hasLivingPractice`, `isPartner`, etc.
- **`functions/api/portal-data.js`** — Cloudflare Pages Function. Reads GHL contact custom fields + appointments. Returns `{client, appointments, upcomingAppointments}`.

### Where the "Step X of 8" math lives
`portal/src/components/ProgressTracker.tsx` lines 94–115:

```ts
const totalSessions = seriesType === '8-session' ? 8 : seriesType === '4-session' ? 4 : 0;
const currentSeriesCompleted = totalSessions - sessionsRemaining;  // ← DERIVED FROM REMAINING
const lifetimeCompleted = allAppointments.filter(a => completed/showed/confirmed).length;
const journeyStep = currentSeriesCompleted + (hasUpcoming ? 1 : 0);
const journeyPct = round(journeyStep / 8 * 100);
```

**Note**: the dots represent `totalSessions − sessionsRemaining` (i.e., derived from the balance field), NOT lifetime work done. So when `sessions_remaining` is wrong, the dots are wrong too.

### Where the data comes from
`functions/api/portal-data.js` (lines 140–157):

```js
const seriesType = getCustomField(contact, "series_type", fieldDefs) || "none";
const fieldSessionsCompleted = parseInt(getCustomField(contact, "sessions_completed", fieldDefs) ?? "0", 10);
const sessionsRemaining = parseInt(getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0", 10);
const sessionsCompleted = Math.max(fieldSessionsCompleted, completedAppointmentCount);
// Just reads the raw custom fields. No ledger. No real money tracking.
```

So both `sessionsCompleted` and `sessionsRemaining` come from GHL custom fields directly. Whatever drift exists in GHL (the bug class we spent yesterday on) propagates straight to the portal display.

---

## What the staff side does correctly

### `functions/lib/session-ledger.js` (435 lines, tested)

Exposes:
- `computeSessionLedger(context, contactId)` — I/O wrapper, fetches GHL data + derives
- `deriveLedger({contact, orders, invoices, appointments, fieldDefs})` — pure function, returns:

```ts
{
  seriesType: 'none' | '4-session' | '8-session' | 'Single',
  purchased: number,        // sum of session-credits from real orders + invoices
  attended: number,         // appointments in SERIES_CALENDAR_IDS, after package cutoff
  remaining: number,        // max(0, purchased - attended)
  lastSessionDate: string | null,
  prepaidOverride: boolean,
  source: 'orders+invoices+appointments' | 'empty',
  confidence: 'high' | 'low',
  ambiguities: string[],    // flags where derived disagrees with custom field
}
```

### Why it's correct
1. **Sources** = GHL orders (`/payments/orders`) + invoices (`/invoices/`) + appointments — money first, not field-state
2. **`purchased`** = `classifyOrder` + `classifyInvoice` against `LEDGER_PRODUCT_MAP` (real product IDs → session counts). Ignores `sourceType=calendar` placeholder orders that double-count. Ignores `status≠paid`.
3. **`attended`** filters appointments by `SERIES_CALENDAR_IDS`:
   - ✓ Initial Session — In Person, Initial Session — Virtual
   - ✓ Follow-up Session — In Person, Follow-up Session — In Person (Package)
   - ✓ Follow-up Session — Virtual, Follow-up Session — Virtual (Package)
   - ✗ Entrainment (billed separately, not against series)
   - ✗ Partner Initial Session (comp perk)
   - ✗ Discovery calls (free)
4. **Cutoff day** = earliest package purchase date. Pre-package appointments don't decrement. Handles re-ups + free initials + partner-initial-before-purchase correctly.
5. **Ambiguity flagging** — when derived disagrees with `sessions_remaining` custom field, surfaces it as a confidence signal. Never blindly trusts the field.

### Currently used by
- `functions/api/staff-balances.js` — global prepaid ledger view
- `functions/api/staff-data.js` — today's appointments enrichment
- `functions/api/staff-contact.js` — single contact detail

### NOT used by
- ❌ `functions/api/portal-data.js` — **the client-facing portal still reads raw custom fields**

---

## The redesign plan that already exists

`ops/open-todos.md` line 90 has an entry: **"🆕 Portal: kill 'Step 3 of 8'"** with these subtasks:

- [ ] Wire `functions/api/portal-data.js` to call `computeSessionLedger(contactId)`
- [ ] Replace "Step 3 of 8" copy with cumulative count, drop the 8-dot bar
- [ ] Handle pre-first-session state (no counter)
- [ ] Delete the old `Journey` component from DashboardPage
- [ ] Reframe `ProgressTracker.tsx` brand-new state copy
- [ ] Ship + verify in prod

**That plan is single-counter (lifetime).** Our conversation today proposes **two counters (balance + lifetime).** The ledger gives us both for free — `remaining` is the balance number, and we'd add a separate lifetime count from `appointments.filter(showed/completed/confirmed).length`.

---

## What needs to change

### 1. Backend: `portal-data.js` rewrite
Replace the custom-field reads with a `computeSessionLedger()` call. Then the API returns ledger-derived values + a separate lifetime count.

```js
import { computeSessionLedger } from "../lib/session-ledger.js";

const ledger = await computeSessionLedger(context, contactId, { fieldDefs });

return {
  client: {
    // existing fields
    seriesType: ledger.seriesType,
    sessionsRemaining: ledger.remaining,           // ← from ledger (money-tracker)
    sessionsAttendedInPackage: ledger.attended,    // ← new
    lifetimeSessionsCompleted: lifetimeCount,      // ← all-shown count for the journey counter
    packageSize: ledger.purchased,                 // ← e.g., 8 for 8-pack, 12 for 4+8
    confidenceLow: ledger.confidence === 'low',    // ← optional: don't show numbers if confidence low
  },
  appointments, upcomingAppointments
}
```

### 2. Type update: `portal/src/types/portal.ts`
Add the new fields to `ClientData`.

### 3. Frontend: `ProgressTracker.tsx` redesign
Two-counter layout per our conversation:
- **Hero card** = balance (`remaining` of `packageSize` left on your 8-pack)
- **Secondary line** = lifetime (`X sessions with the Amari Method since [date]`)

State variants the new component has to handle:
| State | Hero | Lifetime line |
|---|---|---|
| Brand new (0 attended) | "Welcome — book your first session" + CTA | hidden |
| Mid-package | "5 sessions left in your 8-pack" + book CTA | "3 sessions with the Amari Method" |
| Last in package | "1 session left — book it" + soft re-up upsell | "7 sessions…" |
| Zero left, active | "Time to re-up — [Buy 4-pack] [Buy 8-pack]" | "8 sessions…" |
| Mid re-up | "7 sessions left on your new 8-pack" | "9 sessions…" (lifetime, grows past pack) |
| Pay-as-you-go (no series) | Hide hero (or "Book a session" generic) | "X sessions…" |
| Low confidence (ambiguity) | "Contact Garrett to confirm your session count" | hidden until reconciled |

### 4. Component rename + cleanup
- `ProgressTracker.tsx` → `PortalDashboardCard.tsx` (or keep name, rewrite contents)
- The next-session card stays where it is — only the journey rail block is being replaced
- `JOURNEY_STEP_COUNT = 8` constant goes away (no longer hardcoded)

### 5. Copy changes
- "Your journey" → "Your 8-pack" (or whatever package they're on)
- "Step X of 8" → "5 sessions left"
- "38% complete" → "38% of your package used" or drop entirely
- "X sessions with the Amari Method" → stays, becomes the lifetime line

### 6. Optional: handle Living Practice display
`hasLivingPractice` boolean is already in `ClientData`. Could surface as a small badge near the dashboard card ("8-pack · Living Practice included").

---

## Implementation lift estimate

| Step | Lift | Risk | Notes |
|---|---|---|---|
| 1. Wire portal-data.js to ledger | ~30 min | Low | Pattern is copy-paste from staff-balances.js |
| 2. Update types | ~5 min | Low | |
| 3. Rewrite ProgressTracker (new component) | ~2-3 hr | Medium | Lots of states to test |
| 4. Update copy + CSS classes | ~1 hr | Low | Tailwind + existing portal.css tokens |
| 5. Brand-new + zero-state designs | ~1 hr | Low | Already mostly there in current code |
| 6. Visual QA across states | ~1 hr | Low | Preview mode in `lib/preview.ts` supports synthetic data |
| 7. Deploy + spot-check 3-4 real clients | ~15 min | Low | Cloudflare auto-deploys on push |
| **Total** | **~6-8 hr** | | Single focused session |

---

## What this fixes — automatically

The moment portal-data.js uses the ledger, **every drifted GHL field stops affecting client display**:

| Client | Today's portal (broken) | After ledger rewire (correct) |
|---|---|---|
| Jenn | "Step 3 of 8" (field-derived) | "5 sessions left · 4 sessions completed" |
| Justin | "Step 3 of 8" (field-derived) | "5 sessions left · 6 sessions completed" |
| Zach | "Step 10 of 8" (broken) | "3 sessions left · 11 sessions completed" |
| Danny | "Step 13 of 8" (way broken) | derived from his real orders + appointments |

**The GHL field cleanup we keep doing becomes purely a back-office concern.** Clients see the truth even when fields drift.

---

## What this does NOT fix

1. **Staff-facing GHL fields are still drift-prone** — workflows that decrement `sessions_remaining` on attendance still exist and still misfire (Justin's bug). Worth keeping the manual cleanup until series-reconcile-worker is deployed.

2. **The portal's "completed" lifetime number depends on `appointments` data quality** — if Garrett doesn't mark appointments as showed/completed in GHL, the count is wrong. The current code already handles this by counting "confirmed" past appointments too as a fallback.

3. **Entrainment count is invisible in the portal** — if a client wants to see "I've done 4 entrainments separately", that's a new UI element. Currently they don't appear anywhere.

4. **Re-up moment UX** — when a package finishes, the portal should prompt buy-more. Current code shows "Series complete — Ready to keep the momentum going?" but no CTA. New design should fix this with explicit pack-buy buttons.

---

## Recommended next steps

1. **Decision today**: confirm the two-counter direction (vs. the existing single-counter open-todos plan)
2. **Quick win this week**: ship step 1 (wire portal-data.js to ledger) — that ALONE fixes the worst of the lying, even before any UI redesign. The existing ProgressTracker would just get correct inputs.
3. **Schedule the UI redesign separately** — it's a 6-8 hour focused session, worth doing in one block. Probably next week.

**Want me to do step 1 now?** It's a 30-minute change. The portal would immediately stop lying about Jenn/Justin/Zach/Danny once it deploys — no further GHL field cleanup needed for the customer-facing display.
