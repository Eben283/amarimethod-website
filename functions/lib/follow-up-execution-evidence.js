// Source-only structural planner. It does not authenticate provenance, send,
// persist, close an obligation, or turn historical logs into a command attempt.
import { FOLLOW_UP_FAMILY, sha256Hex } from "./reliability-contract.js";
import { defineWorkflow, executableFlow } from "../../reminder-engine-worker/src/workflow-definition.js";
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";

export const FOLLOW_UP_EXECUTION_EVIDENCE_CONTRACT = "follow-up-execution-evidence.v1";

const HEX = /^[a-f0-9]{64}$/;
const RUNTIME = /^[a-f0-9]{40}@follow-up-reminder-engine\.v[1-9][0-9]*$/;
const SOURCE_VERSION = /^ghl:appointment-events-webhook:v[1-9][0-9]*$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TEXT = /^[A-Za-z0-9:_@.\-/]{1,200}$/;
const HISTORY = new Set(["sent", "provider_accepted", "delivered", "failed", "timeout"]);

function fail(reason) {
  return Object.freeze({
    contract: FOLLOW_UP_EXECUTION_EVIDENCE_CONTRACT,
    status: "unknown", reasonCodes: Object.freeze([reason]),
    sourceOnly: true, simulation: true, authority: false,
    dispatchAllowed: false, outcomeProven: false,
  });
}

function strictObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") throw new TypeError(`${label} cannot contain accessors`);
  }
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label}.${key} is unsupported`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
  return value;
}

function boundedJson(value, label, depth = 0, seen = new WeakSet(), budget = { nodes: 0 }) {
  if (depth > 12) throw new TypeError(`${label} is too deep`);
  budget.nodes += 1;
  if (budget.nodes > 1_024) throw new TypeError(`${label} is too large`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} has a non-finite number`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 10_000) throw new TypeError(`${label} has an oversized string`);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) throw new TypeError(`${label} must be plain JSON data`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") throw new TypeError(`${label} cannot contain accessors`);
  }
  if (seen.has(value)) throw new TypeError(`${label} cannot contain cycles`);
  seen.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value);
  if (entries.length > 128) throw new TypeError(`${label} is too large`);
  for (const item of entries) boundedJson(item, label, depth + 1, seen, budget);
  seen.delete(value);
}

function text(value, label) {
  if (typeof value !== "string" || !TEXT.test(value)) throw new TypeError(`${label} must be bounded canonical text`);
  return value;
}

function time(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function runtime(value, label) {
  if (typeof value !== "string" || value.length > 100 || !RUNTIME.test(value)) throw new TypeError(`${label} must be a canonical runtime identity`);
  return value;
}

function same(left, right, reason) {
  if (left !== right) throw new TypeError(reason);
}

function historicalKey(item) {
  return JSON.stringify([item.kind, item.attemptId, item.provider, item.providerReference, item.observedAt]);
}

function validateHistory(history, preparedAt, executor, nowMs, expectedProvider) {
  if (!Array.isArray(history) || history.length > 32) throw new TypeError("history must be a bounded array");
  const unique = new Set();
  const byAttempt = new Map();
  const terminalByAttempt = new Map();
  const receiptAttempts = new Map();
  for (const item of history) {
    strictObject(item, new Set(["kind", "attemptId", "provider", "providerReference", "observedAt", "sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "workflowDocumentSha256", "nodeId"]), "history item");
    if (!HISTORY.has(item.kind)) throw new TypeError("history kind is unsupported");
    text(item.attemptId, "history attemptId");
    text(item.provider, "history provider");
    same(item.provider, expectedProvider, "history provider does not match workflow node");
    if (item.providerReference === null) throw new TypeError("history provider reference is missing");
    text(item.providerReference, "history providerReference");
    const observedAt = time(item.observedAt, "history observedAt");
    if (observedAt > nowMs) throw new TypeError("history is after planner clock");
    if (preparedAt !== null && observedAt < preparedAt) throw new TypeError("history precedes prepared attempt");
    for (const key of ["sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "nodeId", "workflowDocumentSha256"]) {
      same(item[key], executor[key], `history ${key} mismatch`);
    }
    if (item.kind === "timeout") throw new TypeError("provider timeout remains unknown");
    if (item.kind === "provider_accepted" && item.provider !== "gmail") throw new TypeError("provider acceptance is Gmail-only evidence");
    if (item.kind === "delivered" && item.provider !== "ghl") throw new TypeError("delivery evidence is GHL-only in v1");
    const key = historicalKey(item);
    if (unique.has(key)) continue; // exact duplicate receipt is idempotent.
    unique.add(key);
    const attemptReference = `${item.provider}\u0000${item.providerReference}`;
    const priorReference = byAttempt.get(item.attemptId);
    if (priorReference && priorReference !== attemptReference) throw new TypeError("conflicting receipt reference evidence");
    byAttempt.set(item.attemptId, attemptReference);
    if (item.kind !== "sent") {
      const prior = terminalByAttempt.get(item.attemptId);
      const fingerprint = `${item.provider}\u0000${item.providerReference || ""}\u0000${item.kind}`;
      if (prior && prior !== fingerprint) throw new TypeError("conflicting receipt evidence");
      terminalByAttempt.set(item.attemptId, fingerprint);
    }
    if (item.providerReference !== null) {
      const receiptKey = `${item.provider}\u0000${item.providerReference}`;
      const receiptAttempt = receiptAttempts.get(receiptKey);
      if (receiptAttempt && receiptAttempt !== item.attemptId) throw new TypeError("receipt reference is reused across attempts");
      receiptAttempts.set(receiptKey, item.attemptId);
    }
  }
  return unique.size;
}

/**
 * Return only a structural, prospective linkage plan. Caller-supplied rows and
 * provenance are deliberately not authenticated by this pure function.
 */
export async function planFollowUpExecutionEvidence(input) {
  try {
    strictObject(input, new Set([
      "nowMs", "source", "lifecycle", "obligation", "workflow", "legacy", "acceptance", "executor", "prospectiveAttempt", "history",
    ]), "input");
    const nowMs = time(input.nowMs, "nowMs");
    const source = strictObject(input.source, new Set([
      "sourceEventId", "provider", "identityVersion", "identityKey", "family", "sourceVersion", "runtimeVersion", "receivedAt", "effectiveStart",
    ]), "source");
    const lifecycle = strictObject(input.lifecycle, new Set([
      "lifecycleInstanceId", "family", "scope", "personId", "appointmentId", "definitionVersion", "runtimeVersion", "createdAt",
    ]), "lifecycle");
    const obligation = strictObject(input.obligation, new Set([
      "obligationId", "lifecycleInstanceId", "obligationKey", "kind", "closer", "state", "deadlineAt",
    ]), "obligation");
    const workflow = strictObject(input.workflow, new Set(["document", "nodeId"]), "workflow");
    const legacy = strictObject(input.legacy, new Set(["flowKey", "definitionVersion", "appointmentId", "contactId", "sourceEventId", "effectiveStart", "stepIndex", "template", "status", "dueAt"]), "legacy");
    const acceptance = strictObject(input.acceptance, new Set([
      "sourceEventId", "lifecycleInstanceId", "workflowId", "workflowVersion", "workflowDocumentSha256", "runtimeVersion", "acceptedAt",
    ]), "acceptance");
    const executor = strictObject(input.executor, new Set([
      "sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "workflowDocumentSha256", "nodeId", "runtimeVersion", "observedAt",
    ]), "executor");
    const attempt = input.prospectiveAttempt;
    if (attempt !== null) strictObject(attempt, new Set([
      "attemptId", "sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "workflowDocumentSha256", "nodeId", "runtimeVersion", "preparedAt", "provider", "channel",
    ]), "prospectiveAttempt");

    const provider = text(source.provider, "source.provider");
    same(provider, "ghl", "source provider mismatch");
    const identityVersion = time(source.identityVersion, "source.identityVersion");
    same(identityVersion, 1, "source identity version mismatch");
    const identityKey = text(source.identityKey, "source.identityKey");
    same(source.family, FOLLOW_UP_FAMILY, "source family mismatch");
    if (typeof source.sourceVersion !== "string" || source.sourceVersion.length > 80 || !SOURCE_VERSION.test(source.sourceVersion)) throw new TypeError("sourceVersion is not a Follow-Up webhook version");
    runtime(source.runtimeVersion, "source.runtimeVersion");
    const receivedAt = time(source.receivedAt, "source.receivedAt");
    const effectiveStart = text(source.effectiveStart, "source.effectiveStart");
    if (!UTC_MILLIS.test(effectiveStart) || !Number.isFinite(Date.parse(effectiveStart)) || new Date(effectiveStart).toISOString() !== effectiveStart) throw new TypeError("source.effectiveStart must be canonical UTC milliseconds");
    const digest = await sha256Hex(`${provider}\u0000${identityVersion}\u0000${identityKey}`);
    same(source.sourceEventId, `src_${digest}`, "source identity digest mismatch");
    same(lifecycle.lifecycleInstanceId, `life_${digest}`, "lifecycle identity digest mismatch");
    same(lifecycle.family, FOLLOW_UP_FAMILY, "lifecycle family mismatch");
    same(lifecycle.scope, "confirmed-normal-follow-up", "lifecycle scope mismatch");
    text(lifecycle.personId, "lifecycle.personId");
    text(lifecycle.appointmentId, "lifecycle.appointmentId");
    runtime(lifecycle.runtimeVersion, "lifecycle.runtimeVersion");
    const createdAt = time(lifecycle.createdAt, "lifecycle.createdAt");
    if (!Number.isInteger(lifecycle.definitionVersion) || lifecycle.definitionVersion < 1) throw new TypeError("lifecycle definitionVersion is invalid");
    same(obligation.lifecycleInstanceId, lifecycle.lifecycleInstanceId, "obligation lifecycle mismatch");
    const expectedObligation = `obl_${await sha256Hex(`${lifecycle.lifecycleInstanceId}\u0000${text(obligation.obligationKey, "obligation.obligationKey")}`)}`;
    same(obligation.obligationId, expectedObligation, "obligation identity digest mismatch");
    time(obligation.deadlineAt, "obligation.deadlineAt");

    boundedJson(workflow.document, "workflow.document");
    // The existing validator freezes its argument; clone so a pure planner
    // cannot mutate/freeze the caller's evidence envelope.
    const document = defineWorkflow(structuredClone(workflow.document));
    const workflowDocumentSha256 = await sha256(canonicalJson(document));
    if (!HEX.test(workflowDocumentSha256)) throw new TypeError("workflow document digest is invalid");
    if (document.id !== FOLLOW_UP_FAMILY) throw new TypeError("workflow is not Follow-Up");
    same(lifecycle.definitionVersion, document.version, "lifecycle workflow version mismatch");
    same(source.runtimeVersion, lifecycle.runtimeVersion, "source lifecycle runtime mismatch");
    const node = document.nodes.find((item) => item.id === workflow.nodeId);
    if (!node) throw new TypeError("workflow node is absent");
    if (node.action.type === "exit_flow") throw new TypeError("exit-flow evidence is unsupported");
    const expectedKind = node.action.type === "exit_flow" ? "external_workflow_exit" : `${node.message.audience}_${node.message.channel}`;
    same(obligation.kind, expectedKind, "obligation kind does not match workflow node");
    same(obligation.obligationKey, node.id, "obligation key does not match workflow node");
    same(obligation.closer, "provider_receipt", "obligation closer mismatch");
    same(obligation.state, "pending", "obligation state is not prospective");
    const flow = executableFlow(document);
    const executableNodes = document.nodes.filter((item) => item.at !== "reschedule");
    const stepIndex = executableNodes.findIndex((item) => item.id === node.id);
    if (stepIndex < 0) throw new TypeError("workflow node has no executable step");
    same(flow.steps[stepIndex]?.template, node.action.template, "executable step template mismatch");
    same(legacy.flowKey, flow.flowKey, "legacy flow mismatch");
    same(legacy.definitionVersion, flow.definitionVersion, "legacy workflow version mismatch");
    same(legacy.appointmentId, lifecycle.appointmentId, "legacy appointment mismatch");
    same(legacy.contactId, lifecycle.personId, "legacy contact mismatch");
    same(legacy.sourceEventId, source.sourceEventId, "legacy source occurrence mismatch");
    same(legacy.effectiveStart, effectiveStart, "legacy effective start mismatch");
    same(legacy.stepIndex, stepIndex, "legacy step index mismatch");
    same(legacy.template, node.action.template, "legacy template mismatch");
    same(legacy.status, "pending", "legacy step is not prospective");
    same(legacy.dueAt, obligation.deadlineAt, "legacy due time mismatch");
    same(acceptance.sourceEventId, source.sourceEventId, "acceptance source mismatch");
    same(acceptance.lifecycleInstanceId, lifecycle.lifecycleInstanceId, "acceptance lifecycle mismatch");
    same(acceptance.workflowId, document.id, "acceptance workflow mismatch");
    same(acceptance.workflowVersion, document.version, "acceptance workflow version mismatch");
    same(acceptance.workflowDocumentSha256, workflowDocumentSha256, "acceptance workflow document mismatch");
    same(acceptance.runtimeVersion, lifecycle.runtimeVersion, "acceptance runtime mismatch");
    const acceptedAt = time(acceptance.acceptedAt, "acceptance.acceptedAt");
    same(executor.sourceEventId, source.sourceEventId, "executor source mismatch");
    same(executor.lifecycleInstanceId, lifecycle.lifecycleInstanceId, "executor lifecycle mismatch");
    same(executor.obligationId, obligation.obligationId, "executor obligation mismatch");
    same(executor.workflowId, document.id, "executor workflow mismatch");
    same(executor.workflowVersion, document.version, "executor workflow version mismatch");
    same(executor.workflowDocumentSha256, workflowDocumentSha256, "executor workflow document mismatch");
    same(executor.nodeId, node.id, "executor node mismatch");
    runtime(executor.runtimeVersion, "executor.runtimeVersion");
    const executorObservedAt = time(executor.observedAt, "executor.observedAt");
    if (!(receivedAt <= acceptedAt && acceptedAt <= createdAt && createdAt <= executorObservedAt && executorObservedAt <= nowMs)) {
      throw new TypeError("source, acceptance, lifecycle, and executor clocks are invalid");
    }

    let preparedAt = null;
    if (attempt !== null) {
      for (const key of ["sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "workflowDocumentSha256", "nodeId", "runtimeVersion"]) {
        same(attempt[key], executor[key], `prospective attempt ${key} mismatch`);
      }
      text(attempt.attemptId, "prospectiveAttempt.attemptId");
      text(attempt.provider, "prospectiveAttempt.provider");
      const expectedProvider = node.message.channel === "email" ? "gmail" : "ghl";
      same(attempt.provider, expectedProvider, "prospective attempt provider does not match node");
      same(attempt.channel, node.message.channel, "prospective attempt channel does not match node");
      preparedAt = time(attempt.preparedAt, "prospectiveAttempt.preparedAt");
      if (preparedAt < executorObservedAt || preparedAt > nowMs) throw new TypeError("prospective attempt clock is invalid");
    }
    const historyCount = validateHistory(input.history, preparedAt, executor, nowMs, node.message.channel === "email" ? "gmail" : "ghl");
    if (historyCount) {
      return Object.freeze({
        contract: FOLLOW_UP_EXECUTION_EVIDENCE_CONTRACT,
        status: "historical_unlinked", reasonCodes: Object.freeze(["historical_observation_does_not_create_pre_send_attempt"]),
        sourceOnly: true, simulation: true, authority: false,
        dispatchAllowed: false, outcomeProven: false,
      });
    }
    if (attempt === null) return fail("prospective_pre_send_attempt_missing");
    return Object.freeze({
      contract: FOLLOW_UP_EXECUTION_EVIDENCE_CONTRACT,
      status: "prospective_linkage", reasonCodes: Object.freeze([]),
      sourceOnly: true, simulation: true, authority: false,
      dispatchAllowed: false, outcomeProven: false,
      linkage: Object.freeze({
        sourceEventId: source.sourceEventId, lifecycleInstanceId: lifecycle.lifecycleInstanceId,
        obligationId: obligation.obligationId, workflowId: document.id, workflowVersion: document.version,
        nodeId: node.id, acceptanceRuntimeVersion: acceptance.runtimeVersion,
        executorRuntimeVersion: executor.runtimeVersion, attemptId: attempt.attemptId,
      }),
    });
  } catch (error) {
    return fail(`invalid_or_ambiguous:${String(error?.message || error).slice(0, 180)}`);
  }
}
