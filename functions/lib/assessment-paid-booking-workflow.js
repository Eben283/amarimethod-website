// The canonical, executable definition for a paid public Assessment.
//
// This is deliberately shared by Pages and the reminder Worker.  The Staff
// canvas publishes versions of this document into the Worker-owned D1 store;
// Pages asks that Worker for the published document before it creates an
// Assessment checkout or fulfills a paid order.  There is no second Settings
// object that somebody has to remember to keep in sync with the map.

export const ASSESSMENT_PAID_BOOKING_WORKFLOW_ID = "assessment-paid-booking";
export const ASSESSMENT_PRODUCT_ID = "6a66cf0103821ea09ea13f1b";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

export function defineAssessmentPaidBookingWorkflow(document) {
  if (document?.kind !== "paid_booking") throw new Error("paid booking workflow kind is required");
  if (document.id !== ASSESSMENT_PAID_BOOKING_WORKFLOW_ID) throw new Error("unsupported paid booking workflow");
  requireText(document.name, "workflow name");
  positiveInteger(document.version, "workflow version");
  if (document.executionMode !== "active") throw new Error("paid booking workflow must remain active");
  requireText(document?.trigger?.provider, "paid booking trigger provider");
  requireText(document?.trigger?.workflow, "paid booking trigger workflow");
  requireText(document?.trigger?.webhookPath, "paid booking trigger path");
  if (document?.booking?.productId !== ASSESSMENT_PRODUCT_ID) throw new Error("Assessment product ID does not match the live checkout product");
  if (!Array.isArray(document?.booking?.allowedCalendarIds) || !document.booking.allowedCalendarIds.length) {
    throw new Error("paid booking needs at least one allowed calendar");
  }
  if (!document.booking.allowedCalendarIds.every((calendarId) => typeof calendarId === "string" && calendarId.trim())) {
    throw new Error("paid booking calendar IDs must be non-empty strings");
  }
  if (!document.booking.allowedCalendarIds.includes(document.booking.defaultCalendarId)) {
    throw new Error("paid booking default calendar must be allowed");
  }
  requireText(document.booking.sessionTitle, "paid booking session title");
  positiveInteger(document.booking.durationMinutes, "paid booking duration");
  positiveInteger(document?.recovery?.minimumAgeSeconds, "recovery minimum age");
  positiveInteger(document?.recovery?.maximumAgeMinutes, "recovery maximum age");
  positiveInteger(document?.recovery?.retryIntervalSeconds, "recovery retry interval");
  positiveInteger(document?.recovery?.maxPerCycle, "recovery max per cycle");
  if (!Array.isArray(document.nodes) || !document.nodes.length) throw new Error("paid booking workflow needs nodes");
  const ids = new Set();
  for (const node of document.nodes) {
    requireText(node?.id, "paid booking node id");
    requireText(node?.label, `paid booking node ${node.id} label`);
    requireText(node?.operator, `paid booking node ${node.id} operator`);
    requireText(node?.kind, `paid booking node ${node.id} kind`);
    if (ids.has(node.id)) throw new Error(`duplicate paid booking node ${node.id}`);
    ids.add(node.id);
  }
  return deepFreeze(document);
}

export const ASSESSMENT_PAID_BOOKING_WORKFLOW = defineAssessmentPaidBookingWorkflow({
  kind: "paid_booking",
  id: ASSESSMENT_PAID_BOOKING_WORKFLOW_ID,
  name: "Assessment paid booking",
  version: 1,
  executionMode: "active",
  trigger: {
    provider: "GHL",
    workflow: "Order Submission Webhook",
    webhookPath: "/api/ghl-purchase-webhook",
  },
  booking: {
    productId: ASSESSMENT_PRODUCT_ID,
    defaultCalendarId: "EM6vB2mq7EAdGCbUb3j1",
    allowedCalendarIds: ["EM6vB2mq7EAdGCbUb3j1", "fFdlRts2KpUf2LYvPf2n"],
    durationMinutes: 50,
    sessionTitle: "Amari Assessment — In Person",
  },
  recovery: {
    minimumAgeSeconds: 90,
    maximumAgeMinutes: 30,
    retryIntervalSeconds: 45,
    maxPerCycle: 12,
  },
  exits: [
    { id: "manual-review", label: "Stop and open Staff review", condition: "A different active Assessment appointment already exists" },
    { id: "paid-booked", label: "Finish", condition: "Exact selected appointment was created and checkpointed" },
  ],
  nodes: [
    { id: "ghl-order-submitted", operator: "GHL", kind: "trigger", label: "Paid order submitted", timing: "Immediately after GHL payment" },
    { id: "resolve-paid-order", operator: "Amari", kind: "action", label: "Verify the paid Assessment order", timing: "Webhook request" },
    { id: "bind-checkout-intent", operator: "Amari", kind: "action", label: "Bind payment to the exact selected slot", timing: "Before any appointment is created" },
    { id: "claim-booking-lease", operator: "Amari", kind: "action", label: "Claim the one booking operation", timing: "Before any appointment is created" },
    { id: "create-appointment", operator: "Amari", kind: "action", label: "Create the selected GHL appointment", timing: "After the order and intent agree" },
    { id: "checkpoint-booking", operator: "Amari", kind: "action", label: "Checkpoint the booked appointment", timing: "Immediately after appointment creation" },
    { id: "minute-recovery", operator: "Amari", kind: "recovery", label: "Recover a missed handoff every minute", timing: "90 seconds–30 minutes after checkout" },
    { id: "manual-review", operator: "Staff", kind: "exit", label: "Stop for manual review", timing: "When a different active Assessment exists" },
  ],
});

export function assessmentBookingFromWorkflow(document) {
  const workflow = defineAssessmentPaidBookingWorkflow(document);
  return Object.freeze({
    isNativePaidBooking: true,
    isNonCreditBooking: true,
    name: "Amari Assessment",
    calendarId: workflow.booking.defaultCalendarId,
    duplicateCalendarIds: [...workflow.booking.allowedCalendarIds],
    allowRequestedCalendar: true,
    durationMinutes: workflow.booking.durationMinutes,
    sessionTitle: workflow.booking.sessionTitle,
    sessionTag: null,
  });
}
