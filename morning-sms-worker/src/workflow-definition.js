const REQUIRED_HANDLERS = Object.freeze([
  "scheduled_event",
  "read_todays_appointments",
  "identify_last_package_session",
  "calculate_due_times",
  "compose_agenda",
  "send_due_sms",
  "record_run_result",
]);
const EXECUTABLE_ORDER = Object.freeze([
  "scheduled_event",
  "read_todays_appointments",
  "identify_last_package_session",
  "calculate_due_times",
  "compose_agenda",
  "send_due_sms:prepare",
  "send_due_sms:meeting",
  "record_run_result",
]);

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

/**
 * Validate the data document that is both executed by the Worker and rendered
 * by Staff. A diagram cannot opt into executable authority without satisfying
 * this contract.
 */
export function defineMorningSmsWorkflow(input) {
  text(input?.id, "workflow id");
  if (!Number.isInteger(input?.definitionVersion) || input.definitionVersion < 1) {
    throw new Error("workflow definitionVersion must be a positive integer");
  }
  if (input?.authority !== "executable_definition") throw new Error("workflow authority must be executable_definition");
  text(input?.trigger?.cron, "workflow cron");
  text(input?.trigger?.timeZone, "workflow timezone");
  if (!Array.isArray(input?.steps) || !input.steps.length) throw new Error("workflow steps are required");
  const ids = new Set();
  const handlers = new Set();
  for (const step of input.steps) {
    text(step.id, "workflow step id");
    text(step.label, `workflow step ${step.id} label`);
    text(step.handler, `workflow step ${step.id} handler`);
    if (ids.has(step.id)) throw new Error(`duplicate workflow step ${step.id}`);
    ids.add(step.id);
    handlers.add(step.handler);
    if (step.parentId != null && !ids.has(step.parentId)) throw new Error(`workflow step ${step.id} has an unknown or forward parent`);
    if (step.handler === "send_due_sms") {
      if (!new Set(["prepare", "meeting"]).has(step.messageKind)) throw new Error(`workflow step ${step.id} needs a supported messageKind`);
      text(step.copy, `workflow step ${step.id} copy`);
      text(step.idempotency, `workflow step ${step.id} idempotency`);
    }
  }
  for (const handler of REQUIRED_HANDLERS) {
    if (!handlers.has(handler)) throw new Error(`workflow handler ${handler} is required`);
  }
  const executableOrder = input.steps.map((step) => step.handler === "send_due_sms" ? `${step.handler}:${step.messageKind}` : step.handler);
  if (JSON.stringify(executableOrder) !== JSON.stringify(EXECUTABLE_ORDER)) {
    throw new Error("workflow step order or branching is not supported by the Morning SMS executor");
  }
  return input;
}

export function stepForHandler(definition, handler, predicate = () => true) {
  const step = definition.steps.find((candidate) => candidate.handler === handler && predicate(candidate));
  if (!step) throw new Error(`published workflow is missing handler ${handler}`);
  return step;
}

export function renderWorkflowCopy(template, values) {
  return String(template).replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
}
