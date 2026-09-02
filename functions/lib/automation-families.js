// Provider-neutral operational map over Amari's current external workflow inventory.
//
// The interface is intentionally family-first: 82 historical/provider records are source
// evidence, not 82 future engines. The July porting architecture stays intact — four reusable
// implementation units plus shared substrate and small standalone ports. Only definitions that
// exist in Amari-owned engine config are joined as `ownedDefinitions`; no external execution
// history or canvas content is synthesized here.

import { automationDefinitions } from "./automation-registry.js";

export const AUTOMATION_INVENTORY_AS_OF = "2026-08-07";
export const AUTOMATION_INVENTORY_SOURCE = "GHL-WORKFLOWS-MASTER.md";

const record = (name, status) => Object.freeze({
  name,
  status,
  sourceSystem: "external_workflow_inventory",
  evidenceKind: "documented_record_metadata",
});

const p = (name) => record(name, "published");
const d = (name) => record(name, "draft");

// This is the focused, in-person ownership map shown in Staff. It deliberately distinguishes
// the calendar/provider from the reminder operator and the retained GHL rollback. A green
// Amari node never means that Amari owns the whole customer lifecycle.
const ASSESSMENT_CUTOVER_TREE = Object.freeze({
  status: "live_workflow",
  title: "Initial / Assessment — in-person appointment path",
  summary: "GHL operates the calendar and appointment status. Amari operates its own reminder run after a confirmed appointment. The old GHL reminder flow remains rollback, so this is a shared lifecycle—not a full Amari cutover.",
  nodes: Object.freeze([
    Object.freeze({ id: "assessment-event", parentId: null, label: "Calendar, availability, and appointment status", state: "verified_ghl", evidence: "Initial Session — In Person + Amari Assessment — In Person calendars", detail: "GHL creates the appointment and provides confirmed, cancelled, and no-show status changes." }),
    Object.freeze({ id: "confirmed", parentId: "assessment-event", label: "Confirmed appointment", state: "verified_ghl", evidence: "Appointment Events Webhook", detail: "GHL sends the confirmed appointment event to the Amari reminder engine." }),
    Object.freeze({ id: "confirmed-owned", parentId: "confirmed", label: "Amari reminder run", state: "owned_live", evidence: "initial-in-person definition v3 + Appointment Events Webhook", detail: "Amari sends the booking, day-before, and one-hour reminders for these in-person appointments." }),
    Object.freeze({ id: "owned-internal-email", parentId: "confirmed-owned", label: "Garrett booking email", state: "owned_live", evidence: "initial-in-person booked-internal step", detail: "Owned delivery is live." }),
    Object.freeze({ id: "owned-confirmation", parentId: "confirmed-owned", label: "Client confirmation email", state: "proven_owned", evidence: "D1 receipt 19fe8b341af3ea40", detail: "Proven once through the native GHL booking bridge to Eben’s controlled inbox." }),
    Object.freeze({ id: "owned-day-before", parentId: "confirmed-owned", label: "Client day-before email", state: "owned_live", evidence: "initial-in-person day-before step", detail: "Owned delivery is live." }),
    Object.freeze({ id: "owned-client-sms", parentId: "confirmed-owned", label: "Client one-hour SMS", state: "owned_live", evidence: "initial-in-person one-hour-sms step + recipient proof", detail: "Owned timing with the existing GHL SMS delivery pipe is live." }),
    Object.freeze({ id: "owned-starting-soon", parentId: "confirmed-owned", label: "Client one-hour email", state: "owned_live", evidence: "initial-in-person starting-soon step", detail: "Owned delivery is live." }),
    Object.freeze({ id: "owned-internal-sms", parentId: "confirmed-owned", label: "Garrett one-hour SMS", state: "owned_live", evidence: "initial-in-person one-hour-internal step + recipient proof", detail: "Owned timing with the existing GHL SMS delivery pipe is live." }),
    Object.freeze({ id: "confirmed-rollback", parentId: "confirmed", label: "Old GHL reminder workflow", state: "legacy_ghl", evidence: "Initial in-person Session Welcome / reminder email flow (Draft)", detail: "Draft rollback only. It is retained as evidence and is not the live reminder sender." }),
    Object.freeze({ id: "cancelled", parentId: "assessment-event", label: "Cancelled appointment", state: "verified_ghl", evidence: "Appointment Events Webhook", detail: "GHL is the source of the cancellation event." }),
    Object.freeze({ id: "cancelled-owned", parentId: "cancelled", label: "Amari cancels its pending reminders", state: "proven_owned", evidence: "D1 cancellation proof for UQshXptaKUlun990N6pj", detail: "The Amari reminder engine cancels remaining future reminder steps for that appointment." }),
    Object.freeze({ id: "cancelled-rollback", parentId: "cancelled", label: "GHL legacy cleanup", state: "legacy_ghl", evidence: "remove from workflow in person booking", detail: "Published cleanup removes any old GHL reminder enrollment. It does not send the current reminders." }),
    Object.freeze({ id: "noshow", parentId: "assessment-event", label: "No-show", state: "gap", evidence: "No Show Email SMS series trigger inventory", detail: "GHL has no Assessment no-show trigger. This is an observed gap, not an assumed path." }),
    Object.freeze({ id: "noshow-shadow", parentId: "noshow", label: "Owned no-show recovery shadow", state: "owned_shadow", evidence: "assessment-no-show definition v1", detail: "Local code models the three existing recovery messages without sending them." }),
    Object.freeze({ id: "rebooked-shadow", parentId: "noshow-shadow", label: "Confirmed rebooking exits recovery", state: "owned_shadow", evidence: "assessment-no-show exitOn: confirmed", detail: "A confirmed Assessment booking closes remaining owned recovery steps for that person." }),
  ]),
});

const ASSESSMENT_PAID_BOOKING_CUTOVER_TREE = Object.freeze({
  status: "live_workflow",
  title: "Assessment paid booking",
  summary: "GHL takes the payment and posts the order event. Amari owns the selected-slot intent, one booking operation, appointment creation, and the one-minute recovery guard.",
  nodes: Object.freeze([
    Object.freeze({ id: "assessment-payment", parentId: null, label: "Paid Assessment order", state: "verified_ghl", evidence: "Order Submission Webhook", detail: "GHL accepts the $29 payment and sends the order event to the owned booking endpoint." }),
    Object.freeze({ id: "assessment-order-verify", parentId: "assessment-payment", label: "Verify paid order", state: "owned_live", evidence: "assessment-paid-booking definition", detail: "Amari verifies that the event belongs to the public Assessment product before continuing." }),
    Object.freeze({ id: "assessment-intent", parentId: "assessment-order-verify", label: "Bind exact selected slot", state: "owned_live", evidence: "paid_booking_intents D1", detail: "Amari binds the paid order to the immutable checkout slot rather than mutable contact fields." }),
    Object.freeze({ id: "assessment-book", parentId: "assessment-intent", label: "Create one GHL appointment", state: "owned_live", evidence: "booking_operations D1 lease", detail: "Amari owns the idempotent booking command and uses GHL only as the calendar provider." }),
    Object.freeze({ id: "assessment-checkpoint", parentId: "assessment-book", label: "Checkpoint booked appointment", state: "owned_live", evidence: "paid_booking_intents appointment checkpoint", detail: "The appointment ID is retained before the request is considered complete." }),
    Object.freeze({ id: "assessment-recovery", parentId: "assessment-intent", label: "One-minute recovery guard", state: "owned_live", evidence: "reminder-engine scheduled cycle", detail: "Amari reads recent unbound paid intents and resumes the same booking handler; it never implements a second booking path." }),
    Object.freeze({ id: "assessment-review", parentId: "assessment-intent", label: "Staff manual review", state: "proven_owned", evidence: "manual_review durable intent state", detail: "A different active Assessment appointment stops automatic booking and opens an owned exception instead of a double-booking." }),
  ]),
});

const RAW_FAMILIES = [
  {
    key: "appointment-event-ingest",
    name: "Appointment event ingest",
    lifecycle: "platform",
    kind: "operational",
    purpose: "Receive typed appointment lifecycle events once and fan them out to owned automation consumers.",
    implementationUnits: ["shared-substrate"],
    definitionIds: [],
    sourceRecords: [p("Appointment Events Webhook")],
  },
  {
    key: "commerce-ledger-event-ingest",
    name: "Assessment paid booking",
    lifecycle: "platform",
    kind: "operational",
    purpose: "Turn a paid public Assessment order into exactly one selected GHL appointment, with a durable one-minute recovery guard.",
    implementationUnits: ["shared-substrate", "purchase-cluster"],
    definitionIds: ["booking:assessment-paid-booking"],
    runtimeFlowKeys: ["assessment-paid-booking"],
    cutoverTree: ASSESSMENT_PAID_BOOKING_CUTOVER_TREE,
    sourceRecords: [
      p("Invoice Paid Webhook Notification"),
      p("Order Submission Webhook"),
      p("Purchase — Backup Webhook"),
      p("Sessions Completed Webhook"),
      p("Sessions Remaining Webhook"),
    ],
  },
  {
    key: "nurture-event-ingest",
    name: "Nurture event ingest",
    lifecycle: "platform",
    kind: "operational",
    purpose: "Turn quiz and transition-tag signals into typed entry and exit events for nurture sequences.",
    implementationUnits: ["shared-substrate", "nurture-sequence"],
    definitionIds: [],
    sourceRecords: [p("Nurture Tag Events Webhook"), p("Quiz Submitted — Create Contact (Webhook)")],
  },
  {
    key: "access-link-delivery",
    name: "Access link delivery",
    lifecycle: "platform",
    kind: "operational",
    purpose: "Deliver signed portal access links from the owned authentication boundaries.",
    implementationUnits: ["standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [p("Portal Magic Link Email"), p("Partner Login - Send Magic Link")],
  },
  {
    key: "discovery-call-lifecycle",
    name: "Discovery call lifecycle",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Coordinate discovery-call booking, reminders, cancellation, attendance, and operational state.",
    implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    definitionIds: ["reminder:discovery-call"],
    sourceRecords: [
      p("Discovery Call — Confirmation & Reminder Flow"),
      p("Discovery Call Attended — Pipeline Update"),
      p("Discovery Call Booked — Pipeline Update"),
      p("Discovery Call Cancelled — Remove from Workflows"),
      d("Discovery Call Booking"),
      d("Garrett Texted 15 minutes before Discovery call"),
    ],
  },
  {
    key: "lead-capture-triage",
    name: "Lead capture and triage",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Record a new lead, notify staff of usable intake evidence, and expose engagement evidence.",
    implementationUnits: ["pipeline-helper", "standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [p("New Lead Acquisition"), p("Text Garret with New Quiz Results"), d("Lead Engagement Tracking")],
  },
  {
    key: "quiz-nurture",
    name: "Quiz nurture",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Move a quiz lead toward a discovery conversation with timed, conditional follow-up.",
    implementationUnits: ["nurture-sequence"],
    definitionIds: ["nurture:flow-1-quiz"],
    sourceRecords: [p("Flow 1 Quiz to Pain Consultation email flow")],
  },
  {
    key: "post-discovery-nurture",
    name: "Post-discovery nurture",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Follow a completed discovery call until a first session is booked or the sequence exits.",
    implementationUnits: ["nurture-sequence"],
    definitionIds: ["nurture:flow-2-post-discovery"],
    sourceRecords: [d("Flow 2 Pain Consutation to first booking email flow")],
  },
  {
    key: "post-session-nurture",
    name: "Post-first-session nurture",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Follow a completed first session until a next session or eligible purchase ends the sequence.",
    implementationUnits: ["nurture-sequence"],
    definitionIds: ["nurture:flow-3-post-initial"],
    sourceRecords: [p("Flow 3 First session to follow up session email flow")],
  },
  {
    key: "nurture-exit-containment",
    name: "Nurture exit containment",
    lifecycle: "acquisition",
    kind: "operational",
    purpose: "Stop later nurture steps when a person advances, books, purchases, or enters another sequence.",
    implementationUnits: ["nurture-sequence"],
    definitionIds: [],
    sourceRecords: [
      p("Remove from First session to followup session email flow"),
      p("Remove from Pain consultation to first booking email flow"),
      p("Remove from quiz submitted workflow- new client form submitted"),
      p("remove from workflow 1 &2 if tagged w/3"),
      p("Remove from Workflow 1 if tagged workflow 2 or 3"),
    ],
  },
  {
    key: "attendance-confirmation",
    name: "Attendance confirmation",
    lifecycle: "sessions",
    kind: "operational",
    purpose: "Capture staff-confirmed attendance as an owned session and downstream operational event.",
    implementationUnits: ["pipeline-helper", "standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [p("Attendance Confirmed — Update Contact & Pipeline"), d("Appointment — Attendance Check SMS")],
  },
  {
    key: "morning-staff-sms",
    name: "Morning SMS",
    lifecycle: "sessions",
    kind: "operational",
    operatingState: "active",
    purpose: "Send Eben and Garrett the day's appointment agenda, including a last-package-session note only when owned ledger evidence proves it.",
    implementationUnits: ["standalone-owned-port"],
    definitionIds: ["morning-sms:daily-staff-brief"],
    sourceRecords: [],
  },
  {
    key: "initial-session-reminders",
    name: "Initial-session reminders",
    lifecycle: "sessions",
    kind: "operational",
    operatingState: "active",
    purpose: "Confirm and remind initial in-person and virtual appointments, with cancellation containment.",
    implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    definitionIds: ["reminder:initial-in-person", "reminder:initial-virtual"],
    runtimeFlowKeys: ["initial-in-person", "initial-virtual"],
    cutoverTree: ASSESSMENT_CUTOVER_TREE,
    sourceRecords: [
      p("Initial in-person Session Welcome / reminder email flow"),
      p("Initial Session In-Person — Pipeline Update"),
      p("remove from workflow in person booking"),
      p("Initial -Virtual Session Welcome / reminder email flow"),
      p("Initial Session Virtual — Pipeline Update"),
      p("cancelled appointment remove from virtual reminder email flow"),
    ],
  },
  {
    key: "follow-up-session-reminders",
    name: "Follow-up session reminders",
    lifecycle: "sessions",
    kind: "operational",
    operatingState: "active",
    purpose: "Confirm and remind follow-up appointments while cancelling every pending step after cancellation.",
    implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    definitionIds: [],
    runtimeFlowKeys: ["follow-up-session-reminders"],
    sourceRecords: [
      p("Follow up session Confirmation email / reminder flow"),
      p("Follow-up Session — Pipeline Update"),
      p("Cancelled Amari method Followup session removed from workflow"),
      p("Follow-Up Session Cancellation Removal"),
      p("Follow-up Session Cancelled Cleanup"),
    ],
  },
  {
    key: "entrainment-reminders",
    name: "Entrainment reminders",
    lifecycle: "sessions",
    kind: "operational",
    purpose: "Own entrainment-specific confirmation and cancellation behavior without overlapping follow-up reminders.",
    implementationUnits: ["reminder-confirmation"],
    definitionIds: [],
    sourceRecords: [
      p("Entrainment Appointment Cancel Cleanup"),
      d("Entrainment Appointment Confirmation"),
      d("Entrainment Appointment Confirmation Reminder"),
    ],
  },
  {
    key: "no-show-recovery",
    name: "No-show recovery",
    lifecycle: "sessions",
    kind: "operational",
    purpose: "Record a missed appointment and follow up only while live booking evidence still warrants recovery.",
    implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    definitionIds: ["reminder:assessment-no-show", "reminder:no-show-recovery"],
    runtimeFlowKeys: ["assessment-no-show", "no-show-recovery"],
    sourceRecords: [p("No Show — Increment Missed Count"), p("No Show Email SMS series")],
  },
  {
    key: "review-request",
    name: "Review request",
    lifecycle: "sessions",
    kind: "operational",
    purpose: "Prepare a post-session review request from explicit, recent attendance evidence.",
    implementationUnits: ["reminder-confirmation", "standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [p("Post-Session Review Request")],
  },
  {
    key: "founder-package-fulfillment",
    name: "Founder package fulfillment",
    lifecycle: "commerce",
    kind: "operational",
    purpose: "Preserve protected legacy package receipts and entitlements without exposing founder pricing in nurture.",
    implementationUnits: ["purchase-cluster"],
    definitionIds: [],
    sourceRecords: [
      p("4-Session Series Purchased"),
      p("8-Session Series Purchased"),
      p("Invoice Series Purchase Notification"),
      p("Purchase — Upgrade to 4-Session"),
      p("Purchase — Upgrade to 8-Session"),
    ],
  },
  {
    key: "living-practice-fulfillment",
    name: "Living Practice fulfillment",
    lifecycle: "commerce",
    kind: "operational",
    purpose: "Apply and explain Living Practice access from verified purchase and eligibility evidence.",
    implementationUnits: ["purchase-cluster"],
    definitionIds: [],
    sourceRecords: [p("Living Practice Onboarding"), p("Living Practice Standalone Purchased")],
  },
  {
    key: "continuation-nurture",
    name: "Continuation nurture",
    lifecycle: "commerce",
    kind: "operational",
    purpose: "Represent intentionally inactive continuation and completion sequences separately from current purchase authority.",
    implementationUnits: ["nurture-sequence", "purchase-cluster"],
    definitionIds: [],
    sourceRecords: [d("Mid-Series Check-In"), d("Post-Initial Upgrade Offer"), d("Series Completion Email Flow")],
  },
  {
    key: "single-session-analytics",
    name: "Single-session and analytics evidence",
    lifecycle: "commerce",
    kind: "operational",
    purpose: "Keep retired single-session fulfillment and conversion measurement visible without treating them as active current offers.",
    implementationUnits: ["purchase-cluster", "standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [d("Analytics — Initial Session Purchase"), d("Single Follow-up Session Purchased")],
  },
  {
    key: "partner-onboarding-outreach",
    name: "Partner onboarding and outreach",
    lifecycle: "partners",
    kind: "operational",
    purpose: "Move a prospective partner through qualification, onboarding, and deliberate outreach.",
    implementationUnits: ["nurture-sequence", "pipeline-helper", "standalone-owned-port"],
    definitionIds: [],
    sourceRecords: [
      p("Ambassador — Promote to Partner"),
      p("Ambassador Discovery Call Booked"),
      p("Ambassador Prospect → Pipeline"),
      p("Partner — Post-Discovery Call Notification"),
      p("Partner — Post-Session Notification"),
      p("Trainer Outreach — Solo Cold"),
      p("WORKFLOW 2: New Partner Onboarding"),
      d("Post-Discovery Call — Garrett Approval"),
    ],
  },
  {
    key: "partner-session-lifecycle",
    name: "Partner session lifecycle",
    lifecycle: "partners",
    kind: "operational",
    purpose: "Confirm partner sessions, retain partner eligibility context, and cancel pending reminders safely.",
    implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    definitionIds: ["reminder:partner-initial-in-person"],
    sourceRecords: [
      p("In-Person Partner Session: Confirmation & Reminder Flow"),
      p("Virtual - Partner Session: Confirmation & Reminder Flow"),
      p("Partner Session Booked — Add Tag"),
      p("Cancel Partner sessions Removal from confirmation workflow"),
    ],
  },
  {
    key: "referral-tracking-rewards",
    name: "Referral tracking and rewards",
    lifecycle: "partners",
    kind: "operational",
    purpose: "Attribute a referral, notify staff, and expose reward evidence without assuming booking equals attendance.",
    implementationUnits: ["standalone-owned-port", "purchase-cluster"],
    definitionIds: [],
    sourceRecords: [
      p("Notify Garrett — New Partner Referral"),
      p("Send Referral Toolkit — SMS or Email"),
      p("WORKFLOW 1: Affiliate Referral Submitted"),
      d("Partner Referral Booked — Pay $50"),
      d("Referral Credit — Initial Session Booked"),
    ],
  },
  {
    key: "study-program",
    name: "Study program",
    lifecycle: "studies",
    kind: "operational",
    purpose: "Keep the specialist study signup, reminders, cancellation, and no-show path visibly isolated from the core CRM lifecycle.",
    implementationUnits: ["study-resident"],
    definitionIds: [],
    sourceRecords: [
      p("Study Session Cancellation Cleanup"),
      p("Study Session Confirmation Flow"),
      p("Study Session No-Show Nudge"),
      p("Study Signup Welcome Flow"),
      d("Study Session Rebooking Nudge"),
    ],
  },
  {
    key: "archive-evidence",
    name: "Archive and test evidence",
    lifecycle: "archive",
    kind: "evidence_only",
    purpose: "Preserve isolated test workflow records as source evidence without presenting them as operational automations.",
    implementationUnits: ["evidence-only"],
    definitionIds: [],
    sourceRecords: [
      d("TEST — Amari Calendar Handoff Proof — 2026-08-04"),
      d("TEST — Manual Enrollment Appointment Context — 2026-08-04"),
    ],
  },
];

const OWNED_DEFINITIONS = new Map(automationDefinitions().map((definition) => [definition.id, definition]));

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function familyEvidence(family, ownedDefinitions) {
  const gaps = family.sourceRecords.length ? [
    {
      code: "external_canvas_history_not_imported",
      label: "The source records preserve the documented external workflow inventory; external canvas revisions and execution history are not imported.",
    },
    {
      code: "source_record_metadata_only",
      label: "Publication status and exact record names come from the dated inventory; a source record is not proof of its complete trigger or step canvas.",
    },
  ] : [];
  if (!ownedDefinitions.length && family.kind === "operational") {
    gaps.push({
      code: "owned_definition_not_available",
      label: "No provider-neutral owned definition is registered for this family yet.",
    });
  }
  if (ownedDefinitions.some((definition) => definition.steps.some((step) => step.template) && !definition.messagePreview)) {
    gaps.push({
      code: "owned_template_bodies_not_loaded",
      label: "Owned definitions expose exact template keys, timing, type, and branches; rendered template bodies are not present in the owned engine config yet.",
    });
  }
  if (ownedDefinitions.some((definition) => definition.messagePreview?.status === "source_verified_read_only")) {
    gaps.push({
      code: "owned_delivery_templates_not_loaded",
      label: "Source-verified read-only copy is shown for this definition, but no active owned delivery template or sender adapter is loaded.",
    });
  }
  if (ownedDefinitions.some((definition) => definition.messagePreview?.status === "owned_delivery_contract_hard_shadow")) {
    gaps.push({
      code: "owned_delivery_contract_hard_shadow",
      label: "Exact owned copy and a provider-neutral delivery contract are present, but the definition remains hard-shadow until its named cutover blockers close.",
    });
  }
  if (family.kind === "evidence_only") {
    gaps.push({
      code: "evidence_only_not_operational",
      label: "These records are retained for inventory completeness and are not presented as runnable automation.",
    });
  }
  return {
    definitionSource: ownedDefinitions.length ? "owned_code" : "not_owned",
    sourceInventory: {
      system: "external_workflow_inventory",
      path: AUTOMATION_INVENTORY_SOURCE,
      asOf: AUTOMATION_INVENTORY_AS_OF,
    },
    executionHistoryImported: false,
    gaps,
  };
}

const FAMILIES = Object.freeze(RAW_FAMILIES.map((raw) => {
  const ownedDefinitions = raw.definitionIds.map((id) => OWNED_DEFINITIONS.get(id)).filter(Boolean);
  return Object.freeze({
    key: raw.key,
    name: raw.name,
    lifecycle: raw.lifecycle,
    kind: raw.kind,
    operatingState: raw.operatingState || "not_live",
    purpose: raw.purpose,
    implementationUnits: raw.implementationUnits,
    runtimeFlowKeys: raw.runtimeFlowKeys || [],
    ...(raw.cutoverTree ? { cutoverTree: raw.cutoverTree } : {}),
    mapAuthority: ownedDefinitions.some((definition) => definition.authority === "executable_definition") || (raw.runtimeFlowKeys || []).length || (raw.cutoverTree && ownedDefinitions.length)
      ? "executable_definition"
      : raw.cutoverTree
        ? "verified_operating_diagram"
        : "not_mapped",
    ownedDefinitionIds: raw.definitionIds,
    ownedDefinitions,
    sourceRecords: raw.sourceRecords,
    counts: {
      ownedDefinitions: ownedDefinitions.length,
      sourceRecords: raw.sourceRecords.length,
      publishedSourceRecords: raw.sourceRecords.filter((item) => item.status === "published").length,
      draftSourceRecords: raw.sourceRecords.filter((item) => item.status === "draft").length,
    },
    evidence: familyEvidence(raw, ownedDefinitions),
  });
}));

export function automationFamilies() {
  return clone(FAMILIES);
}

export function automationFamily(key) {
  const family = FAMILIES.find((item) => item.key === key);
  return family ? clone(family) : null;
}

export function familyForDefinition(engine, key) {
  const id = `${engine}:${key}`;
  const family = FAMILIES.find((item) => item.ownedDefinitionIds.includes(id));
  return family ? clone(family) : null;
}

export function automationInventorySummary() {
  const records = FAMILIES.flatMap((family) => family.sourceRecords);
  return {
    asOf: AUTOMATION_INVENTORY_AS_OF,
    sourcePath: AUTOMATION_INVENTORY_SOURCE,
    sourceRecords: records.length,
    publishedSourceRecords: records.filter((item) => item.status === "published").length,
    draftSourceRecords: records.filter((item) => item.status === "draft").length,
    operationalFamilies: FAMILIES.filter((family) => family.kind === "operational").length,
    evidenceOnlyGroups: FAMILIES.filter((family) => family.kind === "evidence_only").length,
    ownedDefinitions: FAMILIES.reduce((sum, family) => sum + family.ownedDefinitions.length, 0),
  };
}

export function familyRegistryEvidence() {
  return {
    source: "dated_documented_inventory_plus_owned_code",
    gaps: [
      {
        code: "external_canvas_history_not_imported",
        label: "The complete dated source-record inventory is preserved, but external workflow canvas revisions and execution history are not imported.",
      },
      {
        code: "family_map_is_operational_condensation",
        label: "Families are an operator-facing lifecycle map, not a claim that every source record became a separate owned engine.",
      },
    ],
  };
}
