function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

const ACTIONS = new Set(["email", "internal_email", "sms", "internal_sms"]);
const CHANNELS = new Set(["email", "sms"]);
const AUDIENCES = new Set(["client", "internal"]);
const TIMING = /^(enroll|start-[1-9][0-9]*m)$/;

/**
 * The one workflow interface shared by execution and presentation.
 * Validation lives here so callers cannot construct a half-runnable document.
 */
export function defineWorkflow(document) {
  requireText(document?.id, "workflow id");
  requireText(document?.name, "workflow name");
  if (!Number.isInteger(document?.version) || document.version < 1) throw new Error("workflow version must be a positive integer");
  if (!Array.isArray(document?.trigger?.calendarIds) || !document.trigger.calendarIds.length) throw new Error("workflow trigger needs a calendar");
  if (!Array.isArray(document?.nodes) || !document.nodes.length) throw new Error("workflow needs at least one node");
  const ids = new Set();
  for (const node of document.nodes) {
    requireText(node.id, "node id");
    requireText(node.label, `node ${node.id} label`);
    requireText(node.at, `node ${node.id} timing`);
    requireText(node.action?.type, `node ${node.id} action type`);
    requireText(node.action?.template, `node ${node.id} template`);
    requireText(node.message?.channel, `node ${node.id} message channel`);
    requireText(node.message?.audience, `node ${node.id} message audience`);
    requireText(node.message?.body, `node ${node.id} message body`);
    if (!TIMING.test(node.at)) throw new Error(`node ${node.id} has unsupported timing`);
    if (!ACTIONS.has(node.action.type)) throw new Error(`node ${node.id} has unsupported action type`);
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
      modifiedBy: workflow.trigger.modifiedBy,
      modifiedByByCalendar: workflow.trigger.modifiedByByCalendar,
    },
    cancelOn: workflow.exits.filter((exit) => exit.effect === "cancel_pending").map((exit) => exit.event),
    mode: workflow.executionMode,
    workflowDocument: workflow,
    steps: workflow.nodes.map((node) => ({
      at: node.at,
      type: node.action.type,
      template: node.action.template,
      skipIfPast: node.skipIfPast,
    })),
  });
}
