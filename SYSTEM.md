# Amari owned system catalog

**Read this before inventing UI, booking flows, payments, or CRM replacements.**  
Amari is replacing GoHighLevel surfaces with owned code. If something already lives here, **reuse it** — do not invent a parallel calendar, POS, or embed a GHL widget.

Companion docs:
- Marketing visual language → `DESIGN.md` + `css/site-v6.css`
- Native booking architecture → `amari-method-docs/ops/memory/project_native_booking.md`

Last updated: 2026-08-27.

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
| Slot policy (duration/interval/buffer) | Native catalog | `functions/lib/booking-slot-policy.js` | Assessment + Follow-up both **50/10/60** on the hour. Partner Initial stays 60. `applyHourPackPreference` + look-busy on public/portal slots. Doc: `decision_booking_slot_model.md` |
| Public Tock bookers | Native | `book/initial-in-person.html`, `initial-virtual.html`, `discovery-call.html`, `assessment-booking.html` | Two-month; slots via `/api/book/public-slots` |
| Public study booker | Native | `book/study.html`, `js/study-book.js`, `functions/api/study-book-v2.js` | Single-month, five-study single-entry booking. `/api/study-book-v2` owns the versioned GET/POST contract; legacy `/api/study-book` POST is a non-mutating cached-page guard. |
| Assessment modal chrome | Native shell | `js/site-v6.js`, `css/site-v6.css` (`.assessment-booking-modal`) | Iframes native `/assessment-booking` |
| Portal `BookingModal` | Native | `portal/src/components/BookingModal.tsx` | Prepaid → `portal-book`; no balance → Amari calendar then existing $190 payment link (`portal-pay-followup`) |
| Staff Field Studies calendar | Native | `staff/src/pages/FieldStudiesPage.tsx` (`CalendarModal`) | Uses shared calendar; study multi-session loop is page-specific |
| Staff Calendar workspace | Native UI + governed provider command | `staff/src/pages/TodayPage.tsx`, `staff/src/components/CalendarRegistry.tsx`, `staff/src/components/ManageAppointmentSheet.tsx`, `functions/api/staff-calendars.js`, `functions/api/staff-appointments.js`, `functions/lib/staff-calendar-catalog.js`, `functions/lib/staff-appointment-manage.js`, `functions/lib/staff-owned-contact-identity.js`, `db/appointment-commands-migration.sql` | Primary `/staff/calendar` destination: operational day/week/month schedule, service timing/cutover registry, and one Appointment Manager for new scheduling, rescheduling, and cancellation. Internal availability is every collision-free 15-minute start inside Garrett’s governed workday; public slot thinning/clustering is deliberately not applied. Signed actor, owned person/appointment identity, server-owned service/calendar identity, calendar policy, conflicts, idempotency, creation/replacement checkpoints, compensation, and provider readback are enforced server-side. New appointment search submits the owned person ID. The temporary GHL crosswalk is resolved again at the server-side calendar-adapter boundary; older provider-backed Staff references are resolved back to the owned person before a command is claimed or recorded, so durable command evidence never adopts the provider contact ID as its owner. Existing confirmation, reminder, reschedule, and cancellation lifecycle owners remain unchanged. |
| `EmbedCalendarModal` | **Removed** | was `portal/src/components/EmbedCalendarModal.tsx` | Retired — portal QuickActions + ProgressTracker use `BookingModal` |
| Marketing GHL iframe helper | **Legacy / unused** | `js/main.js` (`openCalendarModal`) | Dead helper; public pages use `/book/*` |

### Payments & POS

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Staff POS | Native | `staff/src/pages/PosPage.tsx`, `PosPage.css` | Dark terminal; Stripe Checkout + card-on-file |
| Staff Products | Native | `staff/src/pages/ProductsPage.tsx`, `functions/api/staff-products.js`, `functions/lib/staff-products.js`, `db/staff-commerce-schema.sql` | Staff-visible catalog; Eben may create owned reusable simple products. Custom versions are immutable D1 records and always have `fulfillment_policy='none'`. Assessment and 20-minute Entrainment use the owned receipt-only path; Single Session and standalone Living Practice are exact, quantity-one Staff POS effects. |
| Staff Media Library | Native | `staff/src/pages/MediaPage.tsx`, `functions/api/staff-media*.js`, `functions/lib/staff-media.js`, `db/staff-media-schema.sql` | Staff-authenticated folders and asset metadata in `ATTEND_DB`; private file bytes in the `MEDIA_BUCKET` R2 binding. Approved image/video/PDF formats only; copied links remain Staff-authenticated; archive/restore preserves the stored object. |
| Owned simple-product receipts | Native | `functions/lib/staff-pos-receipts.js`, `db/staff-commerce-schema.sql` | Exact-sale, immutable D1 receipt snapshot. Applies no sessions, access, booking, automation, Stripe product, or GHL product/invoice effect. Mixed fulfillment-policy carts fail closed. |
| Stripe card-on-file | Native | `functions/api/staff-stripe-cards.js`, `functions/lib/stripe-api.js`, POS charge flow | Prefer proven GHL-linked customer with reusable `pm_` |
| PayLinkSheet | Amari UI | `staff/src/components/PayLinkSheet.tsx` | Sends payment links; keep UI |
| Native create-checkout | Native API | `functions/api/book/create-checkout.js` | Public paid path (may still redirect to GHL payment link). Virtual Assessment configuration is present but server-disabled; no public route can initiate it. |
| Assessment participant agreement | Native static agreement + clickwrap | `participant-agreement.html`, `assessment-booking.html`, `functions/api/book/create-checkout.js`, `db/booking-participant-agreement-migration.sql` | Assessment only; versioned acceptance is stored in the durable paid-booking intent and reflected in the existing pre-checkout audit note. No new GHL tag or custom field. |
| POS webhook / fulfill | Native with temporary provider bridge | `functions/api/stripe-pos-webhook.js`, `functions/lib/staff-pos-fulfill.js`, `functions/lib/staff-pos-invoice-bridge.js`, `functions/api/ghl-invoice-webhook.js` | No-effect carts issue one immutable owned receipt and never call GHL. Packages, Single Session (+1 credit while preserving series), and standalone Living Practice (portal + access only) currently use an exact Staff POS-marked GHL invoice plus contact-field readback. Single Session checkpoints its target balance before the provider write; duplicate events cannot calculate a new target. Staff POS suppresses the invoice-series email trigger tag. |

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
| Staff workspace shell | Native | `staff/src/components/StaffShell.tsx`, `staff/src/styles/staff-shell.css`, `staff/src/App.tsx` | Persistent task-oriented practice rail, global member search, read-only inbox/operations badges, and compact mobile dock/drawer. Field Studies remains under Specialist Tools rather than primary CRM navigation. |
| Staff Amari mail grant | Native OAuth foundation | `functions/api/staff-amari-mail-auth.js`, `functions/api/staff-amari-mail-callback.js`, `functions/lib/amari-mail-oauth.js`, `crm-mirror-worker/src/gmail.js` | Signed Eben/Garrett Staff identity can authorize only its own exact `@amarimethod.com` mailbox. OAuth state is signed and one-time; tokens and verified status are isolated per actor. Readiness is visible, but delivery, composer, inbound reply sync, and fallback sending remain disabled. |
| site-v6 marketing system | Native | `css/site-v6.css`, `js/site-v6.js`, `DESIGN.md` | |

### Staff ops surfaces (owned — don't replace with GHL screens)

| Name | Paths | Notes |
|------|-------|-------|
| Field Studies suite | `staff/src/pages/FieldStudiesPage.tsx` + `FieldStudies*.css`, study forms | Specialist study records, not a primary CRM surface. |
| Calendar / day-of | `TodayPage`, `CalendarRegistry`, `AppointmentCard`, `ManageAppointmentSheet`, `staff-appointments` | Staff schedule, service-definition visibility, and one governed schedule/reschedule/cancel command surface. New scheduling is reachable from Calendar and a seeded Member Record; existing appointments open the same control for rescheduling or cancellation. It never uses public free-slot presentation rules and never lets the browser author calendar, service, or status identity. |
| Client detail CRM | `ClientDetailPage`, notes, message history | In-session person workspace. |
| New-client Outreach | `staff/src/pages/FollowUpPage.tsx`, `functions/api/staff-partner-prospects.js` | Acquisition prospects only. Current/former clients, converted partners, and unanswered inbound messages are excluded; those remain in People or Communication. |
| Person workflow inspection | `crm-mirror-worker/src/client-desk.js`, `person-automation-inspection.js`, `family-automation-inspection.js`, `staff/src/pages/AutomationRegistryPage.tsx`, `functions/api/staff-automations.js` | Communication shows Amari-owned enrollments and run evidence on the person record. Exact family and message-reference evidence links into the internal workflow definition; it never infers attribution from timing and never links to GHL. CRM Mirror owns the `AUTOMATION_DB` read binding and provides Worker-authenticated fallback reads when Pages lacks that binding. |
| Lifecycle reliability spine | `functions/lib/reliability-contract.js`, `functions/lib/reliability-store.js`, `functions/lib/follow-up-reconciliation.js`, `functions/lib/follow-up-execution-evidence.js`, `functions/lib/follow-up-coverage-selection.js`, `functions/lib/follow-up-current-inventory.js`, `reminder-engine-worker/src/follow-up-reliability.js`, `reminder-engine-worker/src/follow-up-reconciliation-drill.js`, `functions/api/staff-automations.js`, `staff/src/pages/AutomationRegistryPage.tsx`, `docs/automation-truth/phase-e-follow-up-reconciliation.md` | Follow-Up-only source receipts, lifecycle instances, obligations, exceptions, and truthful Staff evidence. Stage 1 runtime evidence capture is live and fail-closed; new provenance authority and reconciliation adoption remain unproven. Capture does not replace the reminder sender or genericize workflow execution. The reconciliation v1 collector/writer and local mechanics drill are source-only, unimported, disabled, simulated, permanently non-authoritative, and structurally capped at Degraded pending a separate behavior release. The execution-evidence planner is also unimported: it only checks caller-supplied structural linkage for a prospective pre-send attempt and never authenticates evidence, dispatches, persists, or closes an obligation. The coverage-selection planner deterministically retains bounded candidate identities; it does not authenticate a snapshot, query a database, or prove coverage. Its new current-inventory adapter reads only bounded current rows through SELECTs, keeps late-evidence projection explicitly unavailable, and never grants authority or replacement permission. Neither is imported by production entrypoints. |
| Durable Follow-Up effect evidence (candidate) | `functions/lib/follow-up-effect-evidence-store.js`, `reminder-engine-worker/reliability-effect-evidence.candidate.sql`, `reminder-engine-worker/src/follow-up-effect-evidence-store.test.js` | Unimported D1-shaped store with additive, unregistered/unapplied SQL. Reuses canonical command attempts and provider receipts; adds immutable exact attempt bindings and database-sequenced evidence. Local transactions, replay, fencing and bounded journal reads do not authenticate provenance, authorize dispatch/retry, close obligations or establish coverage. No runtime adoption, schema-authority change, migration registration or production write is included. See the Phase E contract for the separate installation, producer and retention gates. |
| Follow-Up evidence composition (candidate) | `functions/lib/follow-up-evidence-composition.js`, `reminder-engine-worker/src/follow-up-evidence-composition.test.js` | Unimported read-only composition of current inventory, complete unresolved carry and fixed-boundary journal evidence. Invokes existing readers, validates per-attempt chains, preserves exact hashed parents and original clocks, and fails incomplete on overflow or required-evidence failure. Separate inventory and journal observations are not one historical snapshot. No durable checkpoint adoption, replacement permission, authenticated provenance, provider coverage, runtime activation or health promotion. |
| Follow-Up consumer retention (source candidate) | `functions/lib/follow-up-consumer-retention-store.js`, `reminder-engine-worker/reliability-consumer-retention.candidate.sql`, `reminder-engine-worker/src/follow-up-consumer-retention-store.test.js` | Unimported store and unregistered/unapplied additive SQL for append-only consumer checkpoints and paginated unresolved reasons. Keeps the frozen readers unchanged; no obligation-lease reuse, purge, resolution, automatic reset, production watermark or authority lift. Structural checkpoint consistency cannot detect a coherent rollback of both journal and checkpoints without an independent external witness. See Phase E for source verification and adoption gates. |
| Follow-Up evidence installation envelope (offline source candidate) | `scripts/follow-up-evidence-install-plan.mjs`, `reminder-engine-worker/src/follow-up-evidence-install-plan.test.js` | Offline planner for the two pinned additive SQL candidates: full-catalog comparison, atomic assertion gates and readback classification. No database transport, credential access, migration registration, execution command or runtime import. Supplied primary/recovery metadata is not authenticated approval. Publication, fresh production preflight, physical installation and runtime adoption remain separate gates; see Phase E. |
| Private Follow-Up admission and storage (inactive source) | `scripts/lib/follow-up-evidence-admission-gate.mjs`, `scripts/lib/follow-up-evidence-capture-integration.mjs`, `scripts/lib/follow-up-evidence-storage-adapters.mjs`, `reminder-engine-worker/src/follow-up-evidence-storage-adapters.test.js` | Reuses the merged source-only admission/capture contracts through injected DO SQLite transaction/sync, signed R2 witness ETag-CAS, exact-operation capture access, and fresh source-proof floor issuance. The local adapters require separately provisioned positive schema/control/head and trusted present authorization; no automatic bootstrap or existing Staff Media bucket reuse. Real local workerd tests do not prove production authentication/durability or rollback immunity. No runtime import/binding, installed D1 change, purge, unlock, retry, provisioning or deployment. See Phase E for remaining live access, finite-retention/recovery and measured-capacity gates. |
| Owned dated follow-ups | `staff/src/components/OwnedFollowupsPanel.tsx`, `functions/api/staff-followups.js`, `crm-mirror-worker/src/owned-followups.js` | Staff-authored reminders in CRM D1; create/complete/reopen never sends, books, charges, refunds, or writes to GHL. |
| Session docs | `BodyMapCanvas`, `SessionDocSheet`, `SignaturePad`, CheckIn | Staff session documentation and client handoff. |

### Private synthetic rehearsal release tooling (source candidate)

`follow-up-rehearsal-worker/` owns the private signed-envelope caller, control,
SQLite registry and separate issuer. `scripts/follow-up-rehearsal-release.mjs`
prepares read-only source evidence; `scripts/follow-up-rehearsal-deploy.mjs`
provides a separately gated, exact-byte first-install transport. Reuse these
instead of creating an unauthenticated test endpoint or deploying from an arbitrary checkout.
The caller holds no private signing keys and forwards once through its service
binding. The release transport requires explicit resource approval and an external
durable one-shot authorization, verifies public-URL lockdown before real uploads,
and stops on partial/unknown writes without retry or rollback.
`scripts/follow-up-rehearsal-host.mjs` adds exact-record Bitwarden custody,
protected create-only GitHub release consumption and separately authorized HTTPS
calling. The separate operator gateway validates Access identity and the signed
principal envelope before one private caller RPC. Its routes remain disabled;
no existing Staff authentication or production sender is reused or changed.
`scripts/follow-up-rehearsal-gateway-deploy.mjs` and the host's `deploy-gateway`
mode add a separate private-only first installation for that fourth Worker, with
exact caller deployment provenance and actual bundle/settings readback. They do
not attach a hostname, create Access configuration, or invoke the caller.
`scripts/follow-up-rehearsal-signing.mjs` signs only typed manifest, request and
host-policy artifacts using one pinned existing Bitwarden record. It creates no
keys or records and does not replace execution approval or one-shot authority.
`scripts/follow-up-rehearsal-gateway-attach.mjs` adds a separately authorized
first hostname attachment, using the Access readback validator in
`scripts/lib/follow-up-rehearsal-access-readback.mjs`. It verifies actual installed
versions and existing Access/DNS/routing evidence before one domain-attachment
write, including its provider-managed DNS/certificate effects. No Access setup,
Worker upload, runtime invocation, retry or cleanup is included.

This is not deployed, an approved live test, an operator console, or proof of
production identity, durability, deletion, or Staff coverage. Actual trusted host,
tag governance, credential/root custody, Access/hostname/gateway release and physical
cleanup remain separate gates. See the
[rehearsal contract](follow-up-rehearsal-worker/README.md).

### Messaging exit smoke tests

| Name | Kind | Paths | Notes |
|------|------|-------|-------|
| Morning SMS (GHL) | Worker cron | `morning-sms-worker/` | Texts Eben + Garrett via GHL SMS: prepare @ 08:00 PT (or 2h before first appt) + “Staff meeting” +90m. `MORNING_SMS_MODE=active`. Watched on `/ops` via `ops:morning-sms:lastRun`. |

### Amari Ops watchers (apps / auth / money deps)

Operator UI hub: Staff → **Operations** (`/staff/operations`) with tabs for Systems (`/ops`), CRM Mirror, and Automation Watch. Shared tab chrome also lives on each deep-linked surface (`functions/lib/ops-surface-nav.js`). SwiftBar stays separate.

Board rows beyond money paths — heartbeats in `PORTAL_KV`, judged by `functions/lib/ops-board.js`:

| Board id | Signal keys | Emit from |
|----------|-------------|-----------|
| `chief_of_staff` | `cos:status:ready`, `ops:cos-auth:lastRun`, `ops:cos-chat:lastRun` | `cos-auth`, `cos-chat` |
| `staff_auth` | `ops:staff-auth:lastRun` | `staff-auth` |
| `portal_auth` | `ops:portal-auth:lastRun`, `ops:portal-verify:lastRun` | `portal-auth`, `portal-verify` |
| `public_slots` | `ops:public-slots:lastRun` | `book/public-slots` |
| `stripe` | `stripe:status:ready`, `ops:stripe-pos-webhook:lastRun` | `staff-stripe-cards`, `stripe-pos-webhook` |
| `morning_sms` | `ops:morning-sms:lastRun` | `morning-sms-worker` |

### Amari Ops Fix layer

Bounded Cursor cloud agents for board attention — so code issues get a draft PR without babysitting.

| Piece | Path |
|-------|------|
| Launch + queue logic | `functions/lib/ops-fix.js` |
| API (`request` / `sweep` / `launch`) | `functions/api/ops/fix.js` |
| Cron worker (*/15) | `ops-fix-worker/` |
| Eligibility (`autoFix`) | `functions/lib/ops-board-meta.js` |

Modes (`OPS_FIX_MODE`): `off` · `shadow` (default, KV would-launch only) · `auto` (needs `CURSOR_API_KEY`). Public `/ops` can **queue** only; cron/worker auth launches. Secrets/config failures stay human — agent stops and reports.

**Fix button (manual):** on a fixable path, press **Fix**. If `CURSOR_API_KEY` is set on Pages, launches a Cursor agent immediately (even when cron is shadow). If not, returns a copy-paste prompt for [cursor.com/agents](https://cursor.com/agents). Nothing auto-launches until you press.

### Amari Ops flip alerts (SMS + email)

On **new money/booking incident open** only (not while red, not infra board rows). GHL Conversations → Eben.

| Piece | Notes |
|-------|-------|
| Deliver | `functions/lib/ops-notify.js` |
| Recipient | `OPS_ALERT_CONTACT_ID` (Pages + `series-reconcile`); defaults to Eben `3jsTC9Cb7hkDpC3FLuFd` |
| Shadow | `OPS_ALERT_MODE=shadow` logs would-send |
| Opens incidents today | Assessment / Intro / portal follow-up paid→book fail; Assessment law sweep on `series-reconcile` |

Board red alone (e.g. stale `field_id_check`) does **not** text — only incident flips.

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
