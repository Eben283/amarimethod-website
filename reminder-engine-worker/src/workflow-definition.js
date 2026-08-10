function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

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
    if (ids.has(node.id)) throw new Error(`duplicate workflow node ${node.id}`);
    ids.add(node.id);
  }
  return deepFreeze(document);
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
    steps: workflow.nodes.map((node) => ({
      at: node.at,
      type: node.action.type,
      template: node.action.template,
      skipIfPast: node.skipIfPast,
    })),
  });
}
