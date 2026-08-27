import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_FAMILY, buildAcceptedLifecycle } from "../../functions/lib/reliability-contract.js";
import { planFollowUpExecutionEvidence } from "../../functions/lib/follow-up-execution-evidence.js";
import { canonicalJson, sha256 } from "../../functions/lib/automation-truth-phase-b.js";
import { defineWorkflow, executableFlow } from "./workflow-definition.js";

const SOURCE_RUNTIME = `${"a".repeat(40)}@follow-up-reminder-engine.v3`;
const EXECUTOR_RUNTIME = `${"b".repeat(40)}@follow-up-reminder-engine.v4`;
const NOW = 1_000;

function document(channel = "email") {
  return {
    id: FOLLOW_UP_FAMILY, name: "Follow-Up evidence fixture", version: 3, executionMode: "shadow",
    trigger: { calendarIds: ["calendar-1"], statuses: ["confirmed"], eventTypes: ["normal"] }, exits: [],
    nodes: [{
      id: "confirmation", label: "Confirmation", at: "enroll", skipIfPast: false,
      action: { type: channel === "email" ? "email" : "sms", template: "confirmation" },
      message: channel === "email" ? { audience: "client", channel, subject: "subject", body: "body" } : { audience: "client", channel, body: "body" },
    }],
  };
}

async function fixture(channel = "email") {
  const workflow = document(channel);
  const workflowDocumentSha256 = await sha256(canonicalJson(workflow));
  const flow = executableFlow(defineWorkflow(structuredClone(workflow)));
  const record = await buildAcceptedLifecycle({
    provider: "ghl", identityVersion: 1, identityKey: "ghl:appointment-event:v1:appointment-1:normal:confirmed:2026-08-28T12:00:00Z:payload",
    payloadSha256: "c".repeat(64), occurredAt: 100, receivedAt: 100,
    authenticationResult: "authenticated", normalizationState: "normalized", sourceVersion: "ghl:appointment-events-webhook:v7", runtimeVersion: SOURCE_RUNTIME,
    lifecycle: { family: FOLLOW_UP_FAMILY, scope: "confirmed-normal-follow-up", personId: "person-1", appointmentId: "appointment-1", definitionVersion: 3, runtimeVersion: SOURCE_RUNTIME },
    obligations: [{ obligationKey: "confirmation", kind: `client_${channel}`, deadlineAt: 400, ownerRole: "system", closer: "provider_receipt" }],
  });
  const source = { sourceEventId: record.sourceEvent.sourceEventId, provider: record.sourceEvent.provider, identityVersion: record.sourceEvent.identityVersion, identityKey: record.sourceEvent.identityKey, family: record.sourceEvent.family, sourceVersion: record.sourceEvent.sourceVersion, runtimeVersion: record.sourceEvent.runtimeVersion, receivedAt: record.sourceEvent.receivedAt, effectiveStart: "2026-08-28T12:00:00.000Z" };
  const lifecycle = { lifecycleInstanceId: record.lifecycle.lifecycleInstanceId, family: record.lifecycle.family, scope: record.lifecycle.scope, personId: record.lifecycle.personId, appointmentId: record.lifecycle.appointmentId, definitionVersion: record.lifecycle.definitionVersion, runtimeVersion: record.lifecycle.runtimeVersion, createdAt: 200 };
  const obligation = { obligationId: record.obligations[0].obligationId, lifecycleInstanceId: record.obligations[0].lifecycleInstanceId || lifecycle.lifecycleInstanceId, obligationKey: record.obligations[0].obligationKey, kind: record.obligations[0].kind, closer: record.obligations[0].closer, state: "pending", deadlineAt: record.obligations[0].deadlineAt };
  const executor = {
    sourceEventId: source.sourceEventId, lifecycleInstanceId: lifecycle.lifecycleInstanceId, obligationId: obligation.obligationId,
    workflowId: workflow.id, workflowVersion: workflow.version, nodeId: "confirmation", runtimeVersion: EXECUTOR_RUNTIME, observedAt: 220,
  };
  return {
    nowMs: NOW, source, lifecycle, obligation, workflow: { document: workflow, nodeId: "confirmation" },
    legacy: { flowKey: flow.flowKey, definitionVersion: flow.definitionVersion, appointmentId: lifecycle.appointmentId, contactId: lifecycle.personId, sourceEventId: source.sourceEventId, effectiveStart: source.effectiveStart, stepIndex: 0, template: "confirmation", status: "pending", dueAt: obligation.deadlineAt },
    acceptance: { sourceEventId: source.sourceEventId, lifecycleInstanceId: lifecycle.lifecycleInstanceId, workflowId: workflow.id, workflowVersion: workflow.version, workflowDocumentSha256, runtimeVersion: SOURCE_RUNTIME, acceptedAt: 150 },
    executor: { ...executor, workflowDocumentSha256 }, prospectiveAttempt: { attemptId: "attempt-1", sourceEventId: executor.sourceEventId, lifecycleInstanceId: executor.lifecycleInstanceId, obligationId: executor.obligationId, workflowId: executor.workflowId, workflowVersion: executor.workflowVersion, workflowDocumentSha256, nodeId: executor.nodeId, runtimeVersion: executor.runtimeVersion, preparedAt: 250, provider: channel === "email" ? "gmail" : "ghl", channel }, history: [],
  };
}

function history(input, overrides = {}) {
  return {
    kind: "sent", attemptId: "attempt-1", provider: "gmail", providerReference: "message-1", observedAt: 300,
    sourceEventId: input.executor.sourceEventId, lifecycleInstanceId: input.executor.lifecycleInstanceId, obligationId: input.executor.obligationId,
    workflowId: input.executor.workflowId, workflowVersion: input.executor.workflowVersion, workflowDocumentSha256: input.executor.workflowDocumentSha256, nodeId: input.executor.nodeId, ...overrides,
  };
}

describe("Follow-Up execution-evidence source-only planner", () => {
  it("returns a bounded prospective structural linkage with permanently false authority guards", async () => {
    const input = await fixture();
    const result = await planFollowUpExecutionEvidence(input);
    expect(result).toMatchObject({ status: "prospective_linkage", sourceOnly: true, simulation: true, authority: false, dispatchAllowed: false, outcomeProven: false });
    expect(result.linkage).toMatchObject({ attemptId: "attempt-1", acceptanceRuntimeVersion: SOURCE_RUNTIME, executorRuntimeVersion: EXECUTOR_RUNTIME });
  });

  it("does not freeze or mutate the caller workflow envelope", async () => {
    const input = await fixture();
    await planFollowUpExecutionEvidence(input);
    expect(Object.isFrozen(input.workflow.document)).toBe(false);
    expect(input.workflow.document.nodes[0].id).toBe("confirmation");
  });

  it("treats sent and Gmail acceptance as historical-unlinked rather than attempts or completion", async () => {
    const input = await fixture();
    input.history = [history(input), history(input, { kind: "provider_accepted", observedAt: 500 })];
    const result = await planFollowUpExecutionEvidence(input);
    expect(result).toMatchObject({ status: "historical_unlinked", dispatchAllowed: false, outcomeProven: false });
  });

  it("fails closed on absent pre-send attempt, reschedule source reuse, clocks, missing provider reference, timeout, and conflicting receipts", async () => {
    const absent = await fixture(); absent.prospectiveAttempt = null;
    expect((await planFollowUpExecutionEvidence(absent)).status).toBe("unknown");
    const reused = await fixture(); reused.legacy.sourceEventId = "src_" + "0".repeat(64);
    expect((await planFollowUpExecutionEvidence(reused)).status).toBe("unknown");
    const clock = await fixture(); clock.prospectiveAttempt.preparedAt = 1_001;
    expect((await planFollowUpExecutionEvidence(clock)).status).toBe("unknown");
    const noRef = await fixture(); noRef.history = [history(noRef, { providerReference: null })];
    expect((await planFollowUpExecutionEvidence(noRef)).status).toBe("unknown");
    const timeout = await fixture(); timeout.history = [history(timeout, { kind: "timeout", providerReference: null })];
    expect((await planFollowUpExecutionEvidence(timeout)).status).toBe("unknown");
    const conflict = await fixture(); conflict.history = [history(conflict, { kind: "provider_accepted" }), history(conflict, { kind: "failed" })];
    expect((await planFollowUpExecutionEvidence(conflict)).status).toBe("unknown");
    const changedRef = await fixture(); changedRef.history = [history(changedRef), history(changedRef, { kind: "provider_accepted", providerReference: "message-2" })];
    expect((await planFollowUpExecutionEvidence(changedRef)).status).toBe("unknown");
    const future = await fixture(); future.history = [history(future, { observedAt: NOW + 1 })];
    expect((await planFollowUpExecutionEvidence(future)).status).toBe("unknown");
  });

  it("rejects workflow/node/legacy/identity mismatches and caller authority claims", async () => {
    for (const mutate of [
      (input) => { input.obligation.obligationKey = "other"; },
      (input) => { input.lifecycle.definitionVersion = 2; },
      (input) => { input.source.runtimeVersion = EXECUTOR_RUNTIME; },
      (input) => { input.legacy.effectiveStart = "2026-08-29T12:00:00Z"; },
      (input) => { input.legacy.contactId = "other-person"; },
      (input) => { input.prospectiveAttempt.provider = "ghl"; },
      (input) => { input.workflow.document.nodes[0].message.body = "changed under same version"; },
      (input) => { input.source.provider = "other"; },
      (input) => { input.source.effectiveStart = "not-a-clock"; },
      (input) => { input.source.effectiveStart = "2026-02-30T12:00:00.000Z"; },
      (input) => { input.source.sourceVersion = `ghl:appointment-events-webhook:v${"1".repeat(100)}`; },
      (input) => { input.verified = true; },
    ]) {
      const input = await fixture(); mutate(input);
      expect((await planFollowUpExecutionEvidence(input)).status).toBe("unknown");
    }
  });

  it("keeps exact duplicate receipts idempotent but rejects receipt reuse across attempts and production imports", async () => {
    const duplicate = await fixture(); duplicate.history = [history(duplicate), history(duplicate)];
    expect((await planFollowUpExecutionEvidence(duplicate)).status).toBe("historical_unlinked");
    const reused = await fixture(); reused.history = [history(reused), history(reused, { attemptId: "attempt-2" })];
    expect((await planFollowUpExecutionEvidence(reused)).status).toBe("unknown");
    const source = readFileSync(new URL("../../functions/lib/follow-up-execution-evidence.js", import.meta.url), "utf8");
    const roots = readFileSync(new URL("./index.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|prepare|batch|INSERT|UPDATE|DELETE)\b/);
    expect(roots).not.toContain("follow-up-execution-evidence");
  });

  it("keeps a late GHL SMS delivery historical and rejects bounded cycles/accessors without invoking getters", async () => {
    const sms = await fixture("sms"); sms.history = [history(sms, { kind: "delivered", provider: "ghl" })];
    expect((await planFollowUpExecutionEvidence(sms)).status).toBe("historical_unlinked");
    const cyclic = await fixture(); cyclic.workflow.document.self = cyclic.workflow.document;
    expect((await planFollowUpExecutionEvidence(cyclic)).status).toBe("unknown");
    const accessor = await fixture(); let getterCalls = 0; Object.defineProperty(accessor.source, "provider", { get() { getterCalls += 1; return "ghl"; }, enumerable: true });
    expect((await planFollowUpExecutionEvidence(accessor)).status).toBe("unknown");
    expect(getterCalls).toBe(0);
  });

  it("does not call fetch while planning", async () => {
    const prior = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls += 1; throw new Error("must not fetch"); };
    try {
      expect((await planFollowUpExecutionEvidence(await fixture())).status).toBe("prospective_linkage");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = prior;
    }
  });
});
