# Amari owned system catalog

**Read this before inventing UI, booking flows, payments, or CRM replacements.**  
Amari is replacing GoHighLevel surfaces with owned code. If something already lives here, **reuse it** — do not invent a parallel calendar, POS, or embed a GHL widget.

Companion docs:
- Marketing visual language → `DESIGN.md` + `css/site-v6.css`
- Native booking architecture → `amari-method-docs/ops/memory/project_native_booking.md`

Last updated: 2026-07-30.

---

## Hard rules for agents

1. **Calendar UI** → use `css/amari-calendar.css` + `shared/amari-calendar/` (`AmariMonthGrid`, `AmariTimeSlots`). Do **not** invent a new picker and do **not** embed a GHL calendar widget for new work.
2. **Portal follow-up booking** → `portal/src/components/BookingModal.tsx` (native). Do **not** embed a GHL calendar widget.
3. **Staff in-person sales** → `staff/src/pages/PosPage.tsx` + Stripe card-on-file helpers in `functions/lib/stripe-api.js`. Not GHL Payment Methods UI.
4. **Session balances** → `functions/lib/session-ledger.js`. Never trust a single GHL custom field as ground truth.
5. **Marketing pages** → site-v6 only (`DESIGN.md`). No new design system forks.

---

## Canonical calendar (codified)

| Piece | Path |
|--------|------|
| Shared CSS (public + SPAs) | `css/amari-calendar.css` |
| React month grid | `shared/amari-calendar/AmariMonthGrid.tsx` |
| React time slots | `shared/amari-calendar/AmariTimeSlots.tsx` |
| Barrel export | `shared/amari-calendar/index.ts` |

**Visual language (locked):**
- Circular day cells, ink fill when selected
- Today = bold + peach under-dot
- Optional peach availability dots on days with slots
- Circular 28px month nav buttons
- Time slots = paper tiles, 6px radius, ink when selected
- Class prefix: `am-cal-*` / `am-slot-*` (legacy public aliases `.cal-*` / `.slot-btn` still work)

**Layouts:**
- Public paid/discovery bookers: **two months** side-by-side (Tock pattern) — markup still in `book/*.html`, styles from `amari-calendar.css`
- Portal + staff modals: **one month** via `AmariMonthGrid`

**Do not use for new booking UI:**
- `js/main.js` `openCalendarModal` — unused GHL iframe helper; public pages use `/book/*`
- Ad-hoc square-day grids, bare `selected` class names, or new CSS dialects (`cp-cal-*`, `fs-cal-*` day grids are retired in favor of `am-cal-*`)

---

## Owned pieces inventory

### Booking & scheduling

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Public Tock bookers | Native | `book/initial-in-person.html`, `initial-virtual.html`, `discovery-call.html`, `assessment-booking.html` | Two-month; slots via `/api/book/public-slots` |
| Public study booker | Native | `book/study.html` | Single-month cousin; `/api/study-book` |
| Assessment modal chrome | Native shell | `js/site-v6.js`, `css/site-v6.css` (`.assessment-booking-modal`) | Iframes native `/assessment-booking` |
| Portal `BookingModal` | Native | `portal/src/components/BookingModal.tsx` | Prepaid → `portal-book`; no balance → Amari calendar then existing $190 payment link (`portal-pay-followup`) |
| Staff Field Studies calendar | Native | `staff/src/pages/FieldStudiesPage.tsx` (`CalendarModal`) | Uses shared calendar; study multi-session loop is page-specific |
| `EmbedCalendarModal` | **Removed** | was `portal/src/components/EmbedCalendarModal.tsx` | Retired — portal QuickActions + ProgressTracker use `BookingModal` |
| Marketing GHL iframe helper | **Legacy / unused** | `js/main.js` (`openCalendarModal`) | Dead helper; public pages use `/book/*` |

### Payments & POS

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Staff POS | Native | `staff/src/pages/PosPage.tsx`, `PosPage.css` | Dark terminal; Stripe Checkout + card-on-file |
| Stripe card-on-file | Native | `functions/api/staff-stripe-cards.js`, `functions/lib/stripe-api.js`, POS charge flow | Prefer proven GHL-linked customer with reusable `pm_` |
| PayLinkSheet | Amari UI | `staff/src/components/PayLinkSheet.tsx` | Sends payment links; keep UI |
| Native create-checkout | Native API | `functions/api/book/create-checkout.js` | Public paid path (may still redirect to GHL payment link) |
| POS webhook / fulfill | Native | `functions/api/stripe-pos-webhook.js`, `functions/lib/staff-pos-fulfill.js` | |

### Session ledger & balances

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Session ledger engine | Native | `functions/lib/session-ledger.js` | Derives balances; source of truth for ops |
| Staff Balances | Native UI | `staff/src/pages/BalancesPage.tsx`, `LedgerWarning.tsx` | |
| Portal progress / history | Native UI | `portal/src/components/ProgressTracker.tsx`, `SessionHistory.tsx`, `BillingDocuments.tsx` | |

### Auth & shells

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Portal magic link | Native | `portal/src/pages/LoginPage.tsx`, `VerifyPage.tsx`; `functions/api/portal-auth.js`, `portal-verify.js` | |
| Partner auth twin | Native | `functions/api/partner-auth.js`, `partner-verify.js` | |
| Portal chrome | Native | `PortalNav`, `portal/src/styles/portal.css` (`--cp-*`) | |
| Staff chrome | Native | `staff/src/**` | |
| site-v6 marketing system | Native | `css/site-v6.css`, `js/site-v6.js`, `DESIGN.md` | |

### Staff ops surfaces (owned — don't replace with GHL screens)

| Name | Paths |
|------|-------|
| Field Studies suite | `staff/src/pages/FieldStudiesPage.tsx` + `FieldStudies*.css`, study forms |
| Today / day-of | `TodayPage`, `GarrettDay`, `AppointmentCard` |
| Client detail CRM | `ClientDetailPage`, notes, message history |
| Session docs | `BodyMapCanvas`, `SessionDocSheet`, `SignaturePad`, CheckIn |

### Messaging exit smoke tests

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Morning SMS (Twilio) | Worker cron | `morning-sms-worker/` | Texts Eben + Garrett: prepare @ 08:00 PT (or 2h before first appt) + “Staff meeting” +90m. Sends via Twilio, not GHL. Needs upgraded Twilio + A2P/toll-free before US delivery works; default `MORNING_SMS_MODE=shadow`. |

---

## Where to put new owned pieces

1. **Shared visual/behavior used by 2+ surfaces** → `shared/<name>/` + document a row in this file.
2. **Public CSS** that static HTML needs → `css/` (and link with `?v=` bump).
3. **Portal-only / staff-only** → keep under that SPA, but **add a row here** the moment a second consumer appears or an agent might reinvent it.
4. **Architecture / CRM migration notes** → `amari-method-docs/ops/memory/` + link from the memory catalog.

When you ship a new owned piece: **update this file in the same PR.**

---

## Vite alias

Portal and staff resolve shared calendar code via:

```ts
"@amari/calendar": path.resolve(__dirname, "../shared/amari-calendar")
```

Import:

```ts
import { AmariMonthGrid, AmariTimeSlots } from "@amari/calendar";
import "../../css/amari-calendar.css"; // once per app entry or component tree
```
