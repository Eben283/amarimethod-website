import { defineAssessmentPaidBookingWorkflow } from "../../functions/lib/assessment-paid-booking-workflow.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

const MESSAGE_ACTIONS = new Set(["email", "internal_email", "sms", "internal_sms"]);
const CONTROL_ACTIONS = new Set(["exit_flow"]);
const ACTIONS = new Set([...MESSAGE_ACTIONS, ...CONTROL_ACTIONS]);
const CHANNELS = new Set(["email", "sms"]);
const AUDIENCES = new Set(["client", "internal"]);
const TIMING = /^(enroll|enroll\+[1-9][0-9]*m|reschedule|start-[1-9][0-9]*m)$/;

function optionalStringList(value, label) {
  if (value == null) return;
  if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${label} must be a non-empty string list`);
  }
}

/**
 * The one workflow interface shared by execution and presentation.
 * Validation lives here so callers cannot construct a half-runnable document.
 */
export function defineWorkflow(document) {
  if (document?.kind === "paid_booking") {
    // Imported lazily here rather than copied into the Staff renderer. This
    // keeps one validator for the map document read by both runtimes.
    return defineAssessmentPaidBookingWorkflow(document);
  }
  requireText(document?.id, "workflow id");
  requireText(document?.name, "workflow name");
  if (!Number.isInteger(document?.version) || document.version < 1) throw new Error("workflow version must be a positive integer");
  if (!Array.isArray(document?.trigger?.calendarIds) || !document.trigger.calendarIds.length) throw new Error("workflow trigger needs a calendar");
  optionalStringList(document.trigger.statuses, "workflow trigger statuses");
  optionalStringList(document.trigger.eventTypes, "workflow trigger event types");
  optionalStringList(document.sourceGaps, "workflow source gaps");
  if (document.executionMode === "active" && document.sourceGaps?.length) {
    throw new Error("workflow with unresolved source gaps cannot be active");
  }
  if (!Array.isArray(document?.nodes) || !document.nodes.length) throw new Error("workflow needs at least one node");
  const ids = new Set();
  for (const node of document.nodes) {
    requireText(node.id, "node id");
    requireText(node.label, `node ${node.id} label`);
    requireText(node.at, `node ${node.id} timing`);
    requireText(node.action?.type, `node ${node.id} action type`);
    requireText(node.action?.template, `node ${node.id} template`);
    if (!TIMING.test(node.at)) throw new Error(`node ${node.id} has unsupported timing`);
    if (!ACTIONS.has(node.action.type)) throw new Error(`node ${node.id} has unsupported action type`);
    if (node.when != null) {
      requireText(node.when.field, `node ${node.id} condition field`);
      const hasEquals = typeof node.when.equals === "string" && node.when.equals.trim();
      const hasOneOf = Array.isArray(node.when.oneOf) && node.when.oneOf.length > 0 && node.when.oneOf.every((value) => typeof value === "string" && value.trim());
      if (!hasEquals && !hasOneOf) throw new Error(`node ${node.id} condition value is required`);
    }
    if (CONTROL_ACTIONS.has(node.action.type)) {
      requireText(node.action.target, `node ${node.id} control target`);
      if (ids.has(node.id)) throw new Error(`duplicate workflow node ${node.id}`);
      ids.add(node.id);
      continue;
    }
    requireText(node.message?.channel, `node ${node.id} message channel`);
    requireText(node.message?.audience, `node ${node.id} message audience`);
    requireText(node.message?.body, `node ${node.id} message body`);
    if (!CHANNELS.has(node.message.channel)) throw new Error(`node ${node.id} has unsupported message channel`);
    if (!AUDIENCES.has(node.message.audience)) throw new Error(`node ${node.id} has unsupported message audience`);
    const expectedChannel = node.action.type.endsWith("email") ? "email" : "sms";
    const expectedAudience = node.action.type.startsWith("internal_") ? "internal" : "client";
    if (node.message.channel !== expectedChannel || node.message.audience !== expectedAudience) {
      throw new Error(`node ${node.id} action and message destination disagree`);
    }
    if (node.message.channel === "email") requireText(node.message.subject, `node ${node.id} email subject`);
    if (ids.has(node.id)) throw new Error(`duplicate workflow node ${node.id}`);
    ids.add(node.id);
  }
  return deepFreeze(document);
}

export function renderWorkflowText(template, values) {
  return String(template || "").replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
}

export function executableFlow(workflow) {
  return deepFreeze({
    name: workflow.name,
    definitionVersion: workflow.version,
    flowKey: workflow.id,
    calendarIds: workflow.trigger.calendarIds,
    enrollOn: {
      statuses: workflow.trigger.statuses,
      eventTypes: workflow.trigger.eventTypes,
      modifiedBy: workflow.trigger.modifiedBy,
      modifiedByByCalendar: workflow.trigger.modifiedByByCalendar,
      contactModeByCalendar: workflow.trigger.contactModeByCalendar,
    },
    cancelOn: workflow.exits.filter((exit) => exit.effect === "cancel_pending").map((exit) => exit.event),
    exitOn: workflow.exits.filter((exit) => exit.effect === "exit_contact_pending").map((exit) => exit.event),
    mode: workflow.executionMode,
    workflowDocument: workflow,
    steps: workflow.nodes.filter((node) => node.at !== "reschedule").map((node) => ({
      at: node.at,
      type: node.action.type,
      template: node.action.template,
      skipIfPast: node.skipIfPast,
      when: node.when,
      target: node.action.target,
    })),
  });
}
