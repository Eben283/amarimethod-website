// Read-only registry of automations owned by Amari's reminder and nurture engines.
//
// Definitions stay in the engine configs so the scheduler and staff registry cannot drift.
// `definitionVersion` is deliberately explicit: changing trigger/step/exit behavior requires a
// version bump, leaving git history as the immutable definition history until a D1 definition
// snapshot writer is deliberately introduced. This module never calls GHL and never writes D1.

import { FLOWS } from "../../reminder-engine-worker/src/config.js";
import { SEQUENCES } from "../../nurture-engine-worker/src/config.js";
import { flow3MessagePreview } from "../../nurture-engine-worker/src/templates.js";
import { MORNING_SMS_DEFINITION } from "../../morning-sms-worker/src/config.js";

export const REGISTRY_VERSION = 1;

const OWNED_ONLY_GAP = Object.freeze({
  code: "owned_definitions_only",
  label: "This registry covers the automations currently owned in Amari code; former external workflow definitions are not represented.",
});

const PRE_REGISTRY_HISTORY_GAP = Object.freeze({
  code: "pre_registry_history_not_imported",
  label: "Execution before the owned D1 event log is not represented unless it was explicitly imported.",
});

const DELIVERY_GAP = Object.freeze({
  code: "delivery_receipt_coverage_partial",
  label: "SMS delivery is reconciled from GHL by exact message reference. Gmail proves provider acceptance only; affirmative delivery and mailbox-bounce ingestion are not currently available.",
});

const DB_UNAVAILABLE_GAP = Object.freeze({
  code: "execution_store_unavailable",
  label: "The shared automation execution store is not bound, so enrollments and execution events cannot be read.",
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// Registry-only source-copy for the next bounded reminder subset. These constants are never
// imported by the engine or a sender; they let Staff compare the source copy with the shadow
// definition before a delivery adapter exists.
const INITIAL_IN_PERSON_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy. This reconciled shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "internal", channel: "email", subject: "{{contact.first_name}} booked a {{calendar.name}}", body: "Hi, Big Dog,\n\n{{contact.name}} booked a {{calendar.name}} for {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n\nStudio: 662 8th Ave, San Francisco, CA 94118" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked — here's what to expect", preheader: "Your session with Garrett is confirmed", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is confirmed:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nWear something comfortable you can move in. That's all you need.\n\nAdd to Calendar: Add to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nWe look forward to seeing you.\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session on {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}", preheader: "Quick reminder about your session tomorrow", body: "Hi {{contact.first_name}},\n\nJust a heads up about your upcoming session:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n662 8th Ave, San Francisco, CA 94118\n\nAdd to Calendar: Add to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nLooking forward to it.\nGarrett" }),
    Object.freeze({ stepIndex: 3, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, just a friendly reminder — your appointment with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}. 662 8th Ave, San Francisco, CA 94118" }),
    Object.freeze({ stepIndex: 4, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session at {{appointment.only_start_time}} {{appointment.timezone}}", body: "Hi {{contact.first_name}},\n\nYour Amari Method session is at {{appointment.only_start_time}} {{appointment.timezone}}.\n662 8th Ave, San Francisco, CA 94118\n\nSee you soon.\nGarrett" }),
    Object.freeze({ stepIndex: 5, audience: "internal", channel: "sms", body: "{{contact.name}}'s {{calendar.name}} appointment at {{appointment.only_start_time}} {{appointment.timezone}}. These were the specific issues this person wanted to address (if applicable): {{contact.additional_information}}" }),
  ]),
});

const INITIAL_VIRTUAL_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified copy rendered by the owned adapter. Delivery remains gated while the workflow is in shadow.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "internal", channel: "email", subject: "{{contact.name}} booked a {{calendar.name}}", body: "Hi {{user.first_name}},\n\n{{contact.name}} booked a {{calendar.name}} for {{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\n\nHow we'll connect: {{appointment.meeting_location}}" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Amari Method <eben@amarimethod.com>", subject: "You're booked, here's what to expect", preheader: "Your first Amari Method session is confirmed.", body: "Hi {{contact.first_name}},\n\nYou're confirmed for your first Amari Method session with Garrett. Here's everything you need.\n\nSession Details — Date: {{appointment.only_start_date}}\nTime: {{appointment.only_start_time}} {{appointment.timezone}}\nDuration: 60 minutes\n\nJoining Your Session — We use Google Meet. Your link: {{appointment.meeting_location}}. Please test your camera and mic beforehand. Find a quiet space with at least 6' x 6' of room to move.\n\nEquipment — It's most helpful to have everything below ready for your first session. We may not use it all today, that depends on what we focus on, but you'll use these as your practice continues.\nYoga block, required. We'll use it in the first session. → https://amzn.to/4kDykic\nHigh-density foam roller → https://amzn.to/4rjKlfk\nPull-up bar → https://amzn.to/3ZzXYel\nGymnastic rings → https://amzn.to/4aB3MsS\n\nWhat to Wear — Wear something comfortable you can move in.\n\nReschedule {{appointment.reschedule_link}} | Cancel {{appointment.cancellation_link}}\nAdd to Google Calendar {{appointment.add_to_google_calendar}} | Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nThe Amari Method Team" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "See you tomorrow, {{contact.first_name}}", preheader: "Quick reminder about your session tomorrow", body: "Hi {{contact.first_name}},\n\nJust a heads up about your upcoming session:\n{{calendar.name}}\n{{appointment.only_start_date}} at {{appointment.only_start_time}} {{appointment.timezone}}\nHow we'll connect: {{appointment.meeting_location}}\n\nAdd to Google Calendar {{appointment.add_to_google_calendar}} · Add to iCal/Outlook {{appointment.add_to_ical_outlook}}\n\nIf something came up: Reschedule {{appointment.reschedule_link}} · Cancel {{appointment.cancellation_link}}\n\nLooking forward to it.\nGarrett" }),
    Object.freeze({ stepIndex: 3, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", subject: "Your session is in 1 hour", preheader: "Your Google Meet link is below.", body: "Hi {{contact.first_name}},\n\nYour session with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}.\nGoogle Meet: {{appointment.meeting_location}}\n\nA few things before we start:\n- Join 5 minutes early to test your connection.\n- Have your equipment ready: foam roller, yoga block, pull-up bar, gymnastic rings.\n- Find a quiet space with room to move (at least 6' x 6').\n- Wear comfortable clothes you can move in.\n\nIf you have trouble connecting, call us at (628) 877-7673.\n\nSee you soon.\nGarrett" }),
    Object.freeze({ stepIndex: 4, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, just a friendly reminder. Your appointment with Garrett is at {{appointment.only_start_time}} {{appointment.timezone}}. Here is the link: {{appointment.meeting_location}}" }),
    Object.freeze({ stepIndex: 5, audience: "internal", channel: "sms", body: "{{contact.name}}'s {{calendar.name}} appointment at {{appointment.only_start_time}} {{appointment.timezone}}. These were the specific issues this person wanted to address (if applicable): {{contact.additional_information}} Here is the meeting link: {{appointment.meeting_location}}" }),
  ]),
});

const ASSESSMENT_NO_SHOW_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Source-verified read-only copy from No Show Email SMS series. This shadow definition does not send messages.",
  notices: Object.freeze([
    Object.freeze({ stepIndex: 0, audience: "client", channel: "sms", body: "Hi {{contact.first_name}}, we missed you today. Would you like to reschedule your session? {{appointment.reschedule_link}}" }),
    Object.freeze({ stepIndex: 1, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", body: "Hi {{contact.first_name}},\n\nLooks like we missed each other. Life happens. No judgment.\n\nQuick note on our policy: missed appointments are considered used sessions. We do review rescheduling requests case by case, and series participants receive one complimentary emergency reschedule per series. We ask for 24 hours notice for future changes.\n\nIf you'd like to reschedule:\n\nReschedule Your Session\n\nOr just reply here and I'll help find a time.\n\nGarrett" }),
    Object.freeze({ stepIndex: 2, audience: "client", channel: "email", from: "Garrett <garrett@amarimethod.com>", body: "Hi {{contact.first_name}},\n\nI know life gets busy. Scheduling is hard. But your body doesn't stop sending signals just because the calendar got in the way.\n\nIf something is still bothering you, it's worth looking into. Usually something is working too hard because something else isn't working enough. That pattern doesn't fix itself.\n\nWhenever you're ready:\n\nBook Your Session\n\nOr just reply here and I'll help find a time.\n\nGarrett" }),
  ]),
});

const FLOW_3_POST_INITIAL_MESSAGE_PREVIEW = Object.freeze({
  status: "source_verified_read_only",
  label: "Exact current two-email source copy from the owned fail-closed template catalog. The former Day-10 series pitch is deleted; delivery remains disabled.",
  notices: Object.freeze(flow3MessagePreview().map(Object.freeze)),
});

// Read-only activation map for the first cutover slice. This is deliberately outside the
// reminder-engine config: it records what still belongs to the provider rather than making the
// scheduler imply it can perform those actions.
const PARTNER_INITIAL_IN_PERSON_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Not eligible for active delivery",
  summary: "One canonical source document now drives scheduling, Staff preview, secure client management links, and the provider-neutral delivery contract. The owned No Show-series exit is built but its reviewed shadow document is not published; owned SMS also remains unselected.",
  requirements: Object.freeze([
    Object.freeze({
      code: "native_lifecycle_shadow_proven",
      status: "proven",
      label: "Native appointment lifecycle",
      detail: "Confirmed enrollment, immediate would-send evidence, and cancellation of all four future reminders were proven beside the live flow on Aug. 9. No message was sent.",
    }),
    Object.freeze({
      code: "no_show_series_exit_owned",
      status: "proven",
      label: "Exit No Show Email SMS series by owned person",
      detail: "Confirmed Partner Initial events close every active No Show recovery enrollment for the exact owned contact and its one verified legacy GHL alias. The operation preserves completed evidence, cancels only pending work, isolates other contacts, and fails closed on a missing or ambiguous crosswalk.",
    }),
    Object.freeze({
      code: "no_show_series_exit_shadow_publish_pending",
      status: "blocked",
      label: "Publish the reviewed No Show shadow document",
      detail: "The provider-neutral exit lives in v3 source but is not installed in the Reminder workflow registry. Publishing that shadow-only document is a separate D1/runtime gate and cannot send a message.",
    }),
    Object.freeze({
      code: "owned_delivery_contract_built",
      status: "proven",
      label: "Render exact messages from owned CRM truth",
      detail: "The six exact messages now live in the executable workflow document. The adapter resolves stable owned appointment/contact/service identity, follows reschedule lineage, applies DND/consent checks, uses E.164 destinations instead of provider contact IDs, and fails closed on missing inputs.",
    }),
    Object.freeze({
      code: "owned_client_manage_links_built",
      status: "proven",
      label: "Issue owned reschedule and cancellation links",
      detail: "HMAC-signed links bind one owned contact, appointment revision, expiry, and capability. GET is read-only; a same-origin POST confirms the action through the owned command journal, with exact provider readback and stale-revision refusal. Calendar export uses owned appointment truth.",
    }),
    Object.freeze({
      code: "owned_sms_provider_pending",
      status: "blocked",
      label: "Select and prove the owned SMS edge",
      detail: "The lifecycle passes an E.164 destination and idempotency key to a provider-neutral SMS contract, but no owned SMS service is selected or bound. GHL contact delivery is not used as a fallback.",
    }),
    Object.freeze({
      code: "durable_effect_receipts_built",
      status: "proven",
      label: "Close delivery effects durably",
      detail: "Every attempt is hashed, compare-and-set claimed once, append-only receipted on acceptance, and held ambiguous without automatic resend when transport outcome is uncertain. Exact accepted replays do not resend.",
    }),
    Object.freeze({
      code: "quiet_period_evidence_pending",
      status: "review",
      label: "Check the quiet period",
      detail: "Review the scoped appointment window for duplicate, late, or missing reminders before any owned message can become active.",
    }),
    Object.freeze({
      code: "ghl_retirement_not_approved",
      status: "blocked",
      label: "Keep the GHL confirmation flow live",
      detail: "Retirement needs separate approval after the blocked checks are closed and owned delivery evidence agrees with the live path.",
    }),
  ]),
});

const INITIAL_IN_PERSON_CUTOVER_READINESS = Object.freeze({
  status: "active",
  label: "Owned delivery is live",
  summary: "The owned Initial / Assessment in-person lifecycle is the live sender. The former GHL workflow is retained in Draft as rollback.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "The six current messages and both in-person calendars are represented in the owned lifecycle." }),
    Object.freeze({ code: "owned_delivery_proven", status: "proven", label: "Owned delivery proven", detail: "Owned Gmail confirmation, client SMS, and Garrett SMS were each proven in controlled delivery checks." }),
    Object.freeze({ code: "native_cancellation_proven", status: "proven", label: "Cancellation proven", detail: "A native Assessment cancellation cancelled the remaining owned future steps." }),
    Object.freeze({ code: "first_live_run_pending", status: "review", label: "Watch the first ordinary booking", detail: "The first normal booking and cancellation after cutover should be read back in the owned run ledger." }),
    Object.freeze({ code: "assessment_no_show_separate_gap", status: "review", label: "Assessment no-show remains separate", detail: "This reminder cutover is live; the separate Assessment no-show recovery family is still shadow-only." }),
    Object.freeze({ code: "ghl_draft_rollback", status: "proven", label: "GHL rollback retained", detail: "The former GHL workflow is intact in Draft and can be republished if needed." }),
  ]),
});

const INITIAL_VIRTUAL_CUTOVER_READINESS = Object.freeze({
  status: "proof_ready",
  label: "Ready for controlled proof",
  summary: "The exact six-message path, owned delivery adapter, cancellation, and one-time reschedule confirmation are built. GHL remains the sender until a controlled all-DND proof passes.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "Confirmed-only user/customer triggers and all six live message actions are represented in the shadow definition." }),
    Object.freeze({ code: "owned_delivery_built", status: "proven", label: "Owned delivery built", detail: "The owned Gmail and GHL conversations adapters render the exact virtual email, client SMS, and Garrett notification templates behind the Initial Virtual cutover gate." }),
    Object.freeze({ code: "reschedule_confirmation_built", status: "proven", label: "Reschedule behavior built", detail: "A real time change retimes pending reminders and queues one concise updated confirmation only after the original welcome was sent; it never replays the full welcome." }),
    Object.freeze({ code: "native_shadow_proof_pending", status: "review", label: "Prove a native shadow run", detail: "Use a dedicated all-DND appointment to verify enrollment, due timing, reschedule, and cancellation without sending a message." }),
    Object.freeze({ code: "external_pipeline_preserved", status: "proven", label: "Keep non-reminder GHL ownership", detail: "The separate Initial Session Virtual pipeline and no-show cleanup behavior remain in GHL; this package replaces only the confirmation/reminder sender." }),
    Object.freeze({ code: "ghl_retirement_not_approved", status: "review", label: "Keep the GHL reminder workflow live", detail: "Drafting the former sender needs separate approval only after the controlled proof and owned receipt readback pass." }),
  ]),
});

const ASSESSMENT_NO_SHOW_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Not eligible for active delivery",
  summary: "The former gap is modeled in owned shadow code only. The current GHL no-show workflow does not cover Assessment, so this requires a dedicated safe proof before it can replace anything.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_contract_reconciled", status: "proven", label: "Source contract reconciled", detail: "The three-message No Show Email SMS series and an Assessment-confirmed rebooking exit are represented in owned shadow code." }),
    Object.freeze({ code: "native_shadow_proof_pending", status: "review", label: "Prove the no-show lifecycle safely", detail: "Use a dedicated all-DND Assessment appointment to verify no-show enrollment, one-day timing, and confirmed rebooking exit without sending a client message." }),
    Object.freeze({ code: "delivery_templates_and_adapter_not_owned", status: "blocked", label: "Deliver the exact messages from Amari", detail: "The three messages are source-verified previews only. No owned template renderer or email/SMS sender adapter is active." }),
    Object.freeze({ code: "ghl_retirement_not_approved", status: "blocked", label: "Keep GHL live until activation", detail: "Activation and retirement need separate approval after shadow evidence proves the whole lifecycle." }),
  ]),
});

const NO_SHOW_RECOVERY_CUTOVER_READINESS = Object.freeze({
  status: "not_eligible",
  label: "Owned contract and review intake built; production gates remain",
  summary: "The exact source path, provider-neutral delivery contract, rebooking exits, durable effect receipts, and signed missed-session review intake are built. GHL remains the live sender while the new schema/runtime and owned SMS provider are unreleased.",
  requirements: Object.freeze([
    Object.freeze({ code: "source_structure_reconciled", status: "proven", label: "Source structure reconciled", detail: "The exact 11 Normal/no-show calendars, five contact-mode filters, affiliate branch, regular three-message branch, two one-day waits, and two appointmentRescheduled=false checks are represented." }),
    Object.freeze({ code: "source_copy_reconciled", status: "proven", label: "Source copy reconciled", detail: "Both SMS messages, email subjects, preheaders, bodies, and destinations are exact source values." }),
    Object.freeze({ code: "owned_rebooking_equivalence_proven", status: "proven", label: "Owned rebooking exit proven", detail: "The controlled all-DND proof demonstrated affiliate and regular enrollment plus confirmed-rebooking cancellation without client sends." }),
    Object.freeze({ code: "delivery_adapter_built", status: "proven", label: "Provider-neutral owned delivery built", detail: "The exact SMS and Garrett email templates read owned CRM identity, consent and E.164/email destinations, then use only the owned SMS service and verified Garrett Google Workspace adapters with durable idempotent effect receipts. No GHL read or sender fallback remains." }),
    Object.freeze({ code: "owned_recovery_intake_built", status: "proven", label: "Signed recovery review intake built", detail: "Reminder issues a recovery-only same-origin bearer for the exact missed appointment revision. Client confirmation appends one idempotent pending Staff review and cannot book, grant, charge, message, or decide anything." }),
    Object.freeze({ code: "owned_recovery_runtime_pending", status: "blocked", label: "Install and release the recovery runtime", detail: "Migrations 0025–0027 and the reviewed CRM, Reminder, and Pages source are not installed or deployed. Production remains unchanged until separately guarded releases and readback." }),
    Object.freeze({ code: "owned_sms_provider_pending", status: "blocked", label: "Select and prove the owned SMS edge", detail: "The contract requires an E.164 destination, authenticated service binding and idempotency key. No SMS provider or cost has been selected or configured, and GHL Conversations is not a fallback." }),
    Object.freeze({ code: "durable_effect_receipts_built", status: "proven", label: "Durable delivery effects built", detail: "Each email or SMS attempt binds the exact enrollment, definition, node, recipient hash and rendered request; uncertain transport is held for manual reconciliation rather than resent." }),
    Object.freeze({ code: "owned_missed_truth_built", status: "proven", label: "Derive missed appointments from owned status facts", detail: "Migration 0026 retains one immutable canonical status fact per appointment revision and derives the current missed count without a mutable contact field. Corrections append a new revision and naturally leave the count. The durable observer expects CRM reconciliation and preserves GHL's ingest-time number only as non-authoritative comparison evidence." }),
    Object.freeze({ code: "owned_attendance_command_built", status: "proven", label: "Own attendance and no-show corrections", detail: "Migration 0027 atomically binds one idempotent Staff command to an exact provider-free owned appointment revision, appends immutable evidence, and advances canonical status facts. It cannot write GHL, a provider mirror, sessions, entitlement, payment, messages, or recovery decisions; its production route remains source-pinned shadow." }),
    Object.freeze({ code: "missed_count_runtime_retained", status: "review", label: "Keep the live GHL counter until cutover", detail: "The Published No Show — Increment Missed Count workflow and contact field remain live until migration 0026, runtime reconciliation, history coverage, and a separately approved authority cutover are read back. Local source does not write either counter." }),
    Object.freeze({ code: "ghl_retirement_not_approved", status: "review", label: "Keep GHL live until activation", detail: "The Published No Show Email SMS series remains the rollback sender until a separately approved coordinated cutover." }),
  ]),
});

const NURTURE_CUTOVER_READINESS = Object.freeze({
  "flow-1-quiz": Object.freeze({
    status: "not_eligible",
    label: "Exact native copy and gated submission path built; delivery is not enabled",
    summary: "The six-step quiz nurture schedule, exact native copy, provider-neutral contact reads, guarded Google Workspace submission path, and exits are modeled in shadow. GHL remains the live owner until terminal receipt reconciliation and cutover evidence are proven.",
    requirements: Object.freeze([
      Object.freeze({ code: "source_contract_captured", status: "proven", label: "Current source contract captured", detail: "The live waits, pain-location branches, subjects, preheaders, bodies, and discovery exits are recorded in the canonical workflow register." }),
      Object.freeze({ code: "owned_quiz_intake_built", status: "proven", label: "Capture quiz leads in the owned CRM", detail: "A Worker-authenticated, idempotent owned intake stores normalized source evidence, stable lead identity, tags, and provider-neutral personalization fields without calling GHL." }),
      Object.freeze({ code: "owned_quiz_shadow_handoff_built", status: "proven", label: "Hand owned intake to native Flow 1", detail: "Quiz capture atomically creates a digest-bound outbox. The five-minute CRM sweep leases it through the authenticated NURTURE service binding and requires an exact Flow 1 acknowledgement; retries and manual review are durable, and every sequence remains shadow-only." }),
      Object.freeze({ code: "owned_quiz_retention_plan_built", status: "proven", label: "Inventory every retained quiz copy", detail: "A bounded cross-store dry run identifies expired source evidence, CRM projections, every current contact reference, and the Flow 1 enrollment, step, and immutable-event copies. Staff receives aggregate counts and a plan digest only." }),
      Object.freeze({ code: "retention_execution_policy_pending", status: "blocked", label: "Approve the privacy-safe deletion policy", detail: "No purge route or scheduler exists. The legal rule for immutable automation evidence, shared contact identity, and redaction versus deletion must be approved before any destructive execution path is built." }),
      Object.freeze({ code: "public_quiz_bridge_pending", status: "blocked", label: "Connect the public quiz to owned intake", detail: "The sensitive server-to-server Pages payload seam is not connected or deployed; GHL remains the live intake owner until that exact boundary is separately reviewed." }),
      Object.freeze({ code: "owned_contact_reads_built", status: "proven", label: "Read personalization from the owned CRM", detail: "Branches and copy use stable primaryPainLocation, painPatternSignature, and painDuration keys; the adapter maps transition provider attributes only at the boundary." }),
      Object.freeze({ code: "owned_template_renderer_built", status: "proven", label: "Render exact copy from Amari", detail: "All 13 current branch variants live in an immutable allowlisted catalog that rejects unknown templates and missing required merge values." }),
      Object.freeze({ code: "owned_delivery_built", status: "proven", label: "Owned submission boundary built", detail: "The server-owned Garrett Google Workspace adapter sits behind source-level shadow mode, an exact release flag, and a known-sequence JSON allowlist. An atomic pending-to-dispatching claim prevents concurrent duplicate submission and GHL is never a fallback." }),
      Object.freeze({ code: "delivery_exception_visibility_built", status: "proven", label: "Expose submission exceptions truthfully", detail: "The authenticated aggregate readiness projection reports stuck dispatch claims, provider-accepted submissions missing CRM proof, exact submission matches, missing outcomes, and terminal failures without exposing client identifiers or message content." }),
      Object.freeze({ code: "terminal_delivery_receipts_missing", status: "blocked", label: "Reconcile terminal delivery evidence", detail: "A Gmail message ID proves provider submission only. Activation remains blocked until the runtime has an evidence-backed terminal-success policy; accepted submissions are not mislabeled delivered." }),
      Object.freeze({ code: "enrollment_transfer_built", status: "proven", label: "Exact position-transfer planner built", detail: "The authenticated importer requires a fresh provider-history cursor, checks its next-step time against the original sequence schedule, marks only earlier steps imported, rejects stale/mismatched/overdue evidence, and remains shadow-only." }),
      Object.freeze({ code: "live_enrollment_snapshot_pending", status: "review", label: "Recount and capture the live queue at cutover", detail: "Immediately before activation, collect each active provider enrollment's original entry, exact next step, next-action time, and fresh capture time; the importer refuses to infer position from elapsed time alone." }),
      Object.freeze({ code: "ghl_retirement_not_approved", status: "blocked", label: "Keep Quiz to Pain Consultation email flow live", detail: "Retirement requires a coordinated cutover after native shadow evidence and delivery receipts agree." }),
    ]),
  }),
  "flow-2-post-discovery": Object.freeze({
    status: "not_eligible",
    label: "Draft native copy built; activation path is unresolved",
    summary: "The $29 Assessment nurture structure, exact native copy, and provider-neutral contact reads are modeled in shadow, but delivery and activation semantics remain incomplete because the source workflow is Draft.",
    requirements: Object.freeze([
      Object.freeze({ code: "source_contract_captured", status: "proven", label: "Current Draft source captured", detail: "The showed entry, partner exclusion, immediate email, Day-4 branch, and Initial/Assessment booking exits are represented." }),
      Object.freeze({ code: "activation_owner_unresolved", status: "review", label: "Choose the native activation moment", detail: "The provider workflow is intentionally Draft. Native activation must be tied to the owned Assessment journey, not inferred from an inactive provider flow." }),
      Object.freeze({ code: "owned_contact_reads_built", status: "proven", label: "Read branches and guards from the owned CRM", detail: "The personalized/chronic branch uses primaryPainLocation and the owned CRM adapter supplies tags and values fail-closed." }),
      Object.freeze({ code: "owned_template_renderer_built", status: "proven", label: "Render exact Assessment copy from Amari", detail: "All three current $29 / 50-minute Assessment variants live in the immutable fail-closed native catalog." }),
      Object.freeze({ code: "owned_delivery_built", status: "proven", label: "Owned submission boundary built", detail: "The exact Garrett Google Workspace adapter is guarded by shadow source, release, and sequence-allowlist gates with an atomic dispatch claim and no GHL fallback." }),
      Object.freeze({ code: "delivery_exception_visibility_built", status: "proven", label: "Expose submission exceptions truthfully", detail: "Aggregate readiness distinguishes exact CRM submission proof, missing proof, missing outcomes, failures, and stuck dispatch claims without exposing client data." }),
      Object.freeze({ code: "terminal_delivery_receipts_missing", status: "blocked", label: "Reconcile terminal delivery evidence", detail: "Provider submission is not delivery. An evidence-backed terminal-success policy remains required before activation." }),
    ]),
  }),
  "flow-3-post-initial": Object.freeze({
    status: "not_eligible",
    label: "Current two-email source and gated submission path built; delivery is not enabled",
    summary: "The published two-email source, all 11 provider removal triggers, explicit 6-/12-week native purchase exits, and guarded Google Workspace submission path are represented in shadow. GHL remains live while terminal receipt reconciliation and transfer evidence are completed.",
    requirements: Object.freeze([
      Object.freeze({ code: "source_structure_reconciled", status: "proven", label: "Current source structure reconciled", detail: "The former Day-10 pitch and empty wait are absent; the two emails, seven calendar exits, and four legacy purchase exits match the published source." }),
      Object.freeze({ code: "source_copy_reconciled", status: "proven", label: "Exact source copy captured", detail: "Both current emails are exposed below as read-only source evidence." }),
      Object.freeze({ code: "current_practice_purchase_exit_owned", status: "proven", label: "Own 6- and 12-week purchase exits", detail: "Both current Practice product IDs are explicit native exits and are already carried by the existing normalized purchase event path." }),
      Object.freeze({ code: "owned_template_renderer_built", status: "proven", label: "Render exact copy from Amari", detail: "Both current messages live in an immutable, fail-closed native catalog that rejects unknown templates and missing merge fields." }),
      Object.freeze({ code: "owned_delivery_built", status: "proven", label: "Owned submission boundary built", detail: "The exact Garrett Google Workspace adapter is guarded by shadow source, release, and sequence-allowlist gates with an atomic dispatch claim and no GHL fallback." }),
      Object.freeze({ code: "delivery_exception_visibility_built", status: "proven", label: "Expose submission exceptions truthfully", detail: "Aggregate readiness distinguishes exact CRM submission proof, missing proof, missing outcomes, failures, and stuck dispatch claims without exposing client data." }),
      Object.freeze({ code: "terminal_delivery_receipts_missing", status: "blocked", label: "Reconcile terminal delivery evidence", detail: "Provider submission is not delivery. An evidence-backed terminal-success policy remains required before activation." }),
      Object.freeze({ code: "enrollment_transfer_built", status: "proven", label: "Exact position-transfer planner built", detail: "The authenticated importer requires fresh provider-history cursor evidence and fails closed on stale, mismatched, or already-overdue next actions." }),
      Object.freeze({ code: "live_enrollment_snapshot_pending", status: "review", label: "Recount and capture the live queue at cutover", detail: "Any active provider enrollment must be imported from its observed original cursor immediately before retirement; no position is inferred from elapsed time." }),
      Object.freeze({ code: "ghl_retirement_not_approved", status: "blocked", label: "Keep First session to follow up session email flow live", detail: "Retirement requires coordinated native activation and receipt evidence." }),
    ]),
  }),
});

function reminderDefinition(flow) {
  const definition = {
    id: `reminder:${flow.flowKey}`,
    engine: "reminder",
    key: flow.flowKey,
    name: flow.name,
    definitionVersion: flow.definitionVersion,
    mode: flow.mode,
    trigger: clone({ calendarIds: flow.calendarIds, ...flow.enrollOn }),
    exits: clone([
      ...flow.cancelOn.map((status) => ({ kind: "appointment", statuses: [status] })),
      ...(flow.exitOn || []).map((status) => {
        const exit = (flow.workflowDocument?.exits || []).find((candidate) => (
          candidate.effect === "exit_contact_pending" && candidate.event === status
        ));
        return {
          kind: "rebooking", statuses: [status], scope: "contact",
          ...(exit?.serviceIds?.length ? { serviceIds: clone(exit.serviceIds) } : {}),
        };
      }),
    ]),
    steps: flow.steps.map((step, stepIndex) => ({ stepIndex, ...clone(step) })),
    source: {
      kind: "owned_code",
      path: "reminder-engine-worker/src/config.js",
    },
  };
  if (flow.flowKey === "partner-initial-in-person") {
    definition.messagePreview = {
      status: "owned_delivery_contract_hard_shadow",
      label: "Exact source copy rendered by the provider-neutral owned adapter. Delivery is source-level shadow.",
      notices: clone(flow.workflowDocument.nodes.map((node, stepIndex) => ({ stepIndex, ...node.message }))),
    };
    definition.cutoverReadiness = clone(PARTNER_INITIAL_IN_PERSON_CUTOVER_READINESS);
    definition.source.path = "reminder-engine-worker/src/partner-initial-in-person-workflow.js";
  }
  if (flow.flowKey === "initial-in-person") {
    definition.messagePreview = clone(INITIAL_IN_PERSON_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(INITIAL_IN_PERSON_CUTOVER_READINESS);
  }
  if (flow.flowKey === "initial-virtual") {
    definition.messagePreview = clone(INITIAL_VIRTUAL_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(INITIAL_VIRTUAL_CUTOVER_READINESS);
  }
  if (flow.flowKey === "assessment-no-show") {
    definition.messagePreview = clone(ASSESSMENT_NO_SHOW_MESSAGE_PREVIEW);
    definition.cutoverReadiness = clone(ASSESSMENT_NO_SHOW_CUTOVER_READINESS);
  }
  if (flow.flowKey === "no-show-recovery") {
    definition.messagePreview = {
      status: "delivery_built_release_gated",
      label: "Exact source copy, branch structure, owned delivery, and receipt reconciliation are built; live release remains gated.",
      notices: clone(flow.workflowDocument.nodes.map((node, stepIndex) => ({ stepIndex, ...node.message }))),
      sourceDecisionChecks: clone(flow.workflowDocument.sourceDecisionChecks),
    };
    definition.cutoverReadiness = clone(NO_SHOW_RECOVERY_CUTOVER_READINESS);
    definition.source.path = "reminder-engine-worker/src/no-show-recovery-workflow.js";
  }
  return definition;
}

function nurtureDefinition(sequence) {
  const definition = {
    id: `nurture:${sequence.sequenceId}`,
    engine: "nurture",
    key: sequence.sequenceId,
    name: sequence.name,
    definitionVersion: sequence.definitionVersion,
    mode: sequence.mode,
    trigger: clone(sequence.entry),
    exits: clone(sequence.exits),
    steps: sequence.steps.map((step, stepIndex) => ({ stepIndex, ...clone(step) })),
    source: {
      kind: "owned_code",
      path: "nurture-engine-worker/src/config.js",
    },
  };
  definition.cutoverReadiness = clone(NURTURE_CUTOVER_READINESS[sequence.sequenceId]);
  if (sequence.sequenceId === "flow-3-post-initial") {
    definition.messagePreview = clone(FLOW_3_POST_INITIAL_MESSAGE_PREVIEW);
  }
  return definition;
}

const DEFINITIONS = Object.freeze([
  ...FLOWS.map(reminderDefinition),
  ...SEQUENCES.map(nurtureDefinition),
  MORNING_SMS_DEFINITION,
].map(Object.freeze));

export function automationDefinitions() {
  return DEFINITIONS.map(clone);
}

export function findAutomationDefinition(engine, key) {
  const found = DEFINITIONS.find((definition) => definition.engine === engine && definition.key === key);
  return found ? clone(found) : null;
}

export function registryEvidence({ executionStoreConfigured }) {
  const gaps = [OWNED_ONLY_GAP, PRE_REGISTRY_HISTORY_GAP, DELIVERY_GAP];
  if (!executionStoreConfigured) gaps.push(DB_UNAVAILABLE_GAP);
  return {
    definitionSource: "owned_code",
    enrollmentSource: executionStoreConfigured ? "owned_d1" : "unavailable",
    executionSource: executionStoreConfigured ? "owned_d1_append_only_log" : "unavailable",
    gaps: gaps.map(clone),
  };
}

export function eventEvidence(event, { terminalOutcome = null } = {}) {
  const gaps = [];
  if (["reminder", "nurture"].includes(event.engine) && event.flow_key) {
    const current = DEFINITIONS.find((definition) => definition.engine === event.engine && definition.key === event.flow_key);
    if (event.definition_version == null) {
      gaps.push({
        code: "definition_version_not_recorded",
        label: "This event predates definition-version capture, so its exact definition revision is unknown.",
      });
    } else if (current && event.definition_version !== current.definitionVersion) {
      gaps.push({
        code: "historical_definition_snapshot_not_loaded",
        label: `This event used definition version ${event.definition_version}; the read API currently exposes version ${current.definitionVersion}.`,
      });
    }
  }
  if (event.channel && !event.message_ref) {
    gaps.push({
      code: "message_reference_missing",
      label: "No transport message reference was recorded for this event.",
    });
  }
  if (event.action === "send" && !["delivered", "bounced", "failed"].includes(event.outcome) && !terminalOutcome) {
    if (event.channel === "email") {
      gaps.push({
        code: "email_final_delivery_unavailable",
        label: "Gmail accepted this message. Gmail does not provide an affirmative recipient-delivery receipt, and this workflow does not currently ingest mailbox bounce evidence.",
      });
    } else {
      gaps.push({
        code: "delivery_outcome_pending",
        label: "The provider accepted this message, but its terminal delivery status has not been recorded yet.",
      });
    }
  }
  return { source: "owned_d1_append_only_log", gaps };
}
