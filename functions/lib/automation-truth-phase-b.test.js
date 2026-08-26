import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateWorkflowSpec } from "./automation-truth-contract.js";
import { FOLLOW_UP_WORKFLOW } from "../../reminder-engine-worker/src/follow-up-workflow.js";
import {
  canonicalJson,
  classifyCommandOutcome,
  classifyReplay,
  compileWorkflowSpec,
  createDeploymentRecordFixture,
  createInvocationIdentityFixture,
  createNodeProvenancePayload,
  createReleaseManifest,
  projectStaffShadow,
  sha256,
} from "./automation-truth-phase-b.js";

const fixture = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/follow-up-shadow-parity.v1.json", import.meta.url)));
const ownership = fixture.effectOwnership;
const allowedResponsibilities = new Set(ownership.map((entry) => entry.responsibility));
const exactEvidence = Object.freeze({
  assertionId: "fixture-runtime-evidence", claim: "Shadow evidence available", authority: "ExecutionLedger", authorityKind: "system", authorityPresent: true,
  proofLevel: "exact", valueKind: "known", value: true, sourceRefs: [{ kind: "fixture", id: "phase-b", digest: "a".repeat(64) }],
  window: { start: "2026-08-26T00:00:00.000Z", end: "2026-08-26T01:00:00.000Z", timezone: "America/Los_Angeles" }, asOf: "2026-08-26T01:00:00.000Z", watermark: "2026-08-26T01:00:00.000Z",
  coverage: { expected: 1, observed: 1, missing: 0, paginationComplete: true, sampleRate: 1 }, freshness: { checkedAt: "2026-08-26T01:00:00.000Z", maxAgeMs: 60000, state: "fresh" }, ambiguity: "none", status: "Healthy", safetyViolation: false,
  onMissing: "Unknown", onStale: "Degraded", reasonCodes: [], limitations: ["fixture only"],
});

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
}

async function artifacts() {
  const plan = await compileWorkflowSpec(fixture.workflowSpec, { allowedResponsibilities });
  const manifest = await createReleaseManifest({
    compiledPlan: plan, compilerArtifactDigest: fixture.artifacts.compilerArtifactDigest,
    handlerArtifactDigests: fixture.artifacts.handlerArtifactDigests,
    messageArtifacts: fixture.artifacts.messageArtifacts,
    effectOwnership: ownership,
  });
  const deployment = await createDeploymentRecordFixture({ releaseManifest: manifest, deploymentId: "fixture-follow-up-v2", runtimeVersion: fixture.source.runtimeVersion, d1SchemaHead: fixture.d1SchemaHead });
  const invocation = await createInvocationIdentityFixture({ deploymentRecord: deployment, invocationId: "fixture-invocation-1", sourceEventId: "src_fixture_followup_1" });
  return { plan, manifest, deployment, invocation };
}

describe("automation truth Phase B pure compiler and shadow provenance", () => {
  it("pins historical fixture metadata while checking the current bundled seed semantics", () => {
    expect(fileDigest("./automation-truth-phase-b.js")).toBe(fixture.artifacts.compilerArtifactDigest);
    expect(fixture.source).toMatchObject({
      commit: "f68b995da92e6a1be5f9da123f0d2889788291d8",
      workflowPath: "reminder-engine-worker/src/follow-up-workflow.js",
      workflowSha256: "4d4a3aea7ca907fcbcc23eaa93eca38eefed706ebcd2f8206883426b2db483de",
    });
    expect(FOLLOW_UP_WORKFLOW.version).toBe(2);
    expect(fileDigest("../../reminder-engine-worker/src/workflow-definition.js")).toBe(fixture.source.definitionSha256);
    expect(fileDigest("../../reminder-engine-worker/schema.sql")).toBe(fixture.d1SchemaHead.sourceSha256);
    const sourceMessages = Object.fromEntries(FOLLOW_UP_WORKFLOW.nodes
      .filter((node) => node.message && Object.hasOwn(fixture.artifacts.messageArtifacts, `message.${node.id}`))
      .map((node) => [`message.${node.id}`, node.message]));
    expect(fixture.artifacts.messageArtifacts).toEqual(sourceMessages);
    const sourceSchedule = Object.fromEntries(FOLLOW_UP_WORKFLOW.nodes
      .map((node) => [node.id, {
        at: node.at,
        skipIfPast: node.skipIfPast,
        ...(node.when ? { predicate: node.when.equals
          ? { field: node.when.field, operator: "equals", values: [node.when.equals] }
          : { field: node.when.field, operator: "oneOf", values: node.when.oneOf } } : {}),
      }]));
    const fixtureSchedule = Object.fromEntries(fixture.workflowSpec.nodes
      .filter((node) => !["entry", "exit"].includes(node.kind) && node.id !== "cancel-pending-reminders")
      .map((node) => [node.id, {
        at: node.at,
        skipIfPast: node.skipIfPast,
        ...(node.predicate ? { predicate: node.predicate } : {}),
      }]));
    expect(fixtureSchedule).toEqual(sourceSchedule);
    expect(fixture.workflowSpec.nodes.find((node) => node.id === "cancel-pending-reminders")).toMatchObject({ at: "cancelled", skipIfPast: false });
    expect(FOLLOW_UP_WORKFLOW.exits).toContainEqual({ event: "cancelled", effect: "cancel_pending", label: "Cancel every pending reminder" });
  });

  it("compiles the closed, source-backed Follow-Up fixture deterministically despite object and map insertion ordering", async () => {
    validateWorkflowSpec(fixture.workflowSpec, { allowedResponsibilities });
    const reordered = {
      edges: [...fixture.workflowSpec.edges].reverse(), nodes: [...fixture.workflowSpec.nodes].reverse(), exitNodeIds: [...fixture.workflowSpec.exitNodeIds].reverse(),
      entryNodeIds: [...fixture.workflowSpec.entryNodeIds].reverse(), handlers: [...fixture.workflowSpec.handlers].reverse(), version: fixture.workflowSpec.version, workflowId: fixture.workflowSpec.workflowId,
    };
    const [first, second] = await Promise.all([
      compileWorkflowSpec(fixture.workflowSpec, { allowedResponsibilities }),
      compileWorkflowSpec(reordered, { allowedResponsibilities }),
    ]);
    expect(first.compiledPlanDigest).toBe(second.compiledPlanDigest);
    expect(first.specDigest).toBe(second.specDigest);
    expect(canonicalJson(new Map([["b", 2], ["a", 1]]))).toBe(canonicalJson(new Map([["a", 1], ["b", 2]])));
    const withNode = (nodeId, patch) => ({
      ...fixture.workflowSpec,
      nodes: fixture.workflowSpec.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    });
    const timingTamper = withNode("one-hour-sms", { at: "start-30m" });
    const predicateTamper = withNode("one-hour-sms", { predicate: { field: "reminderPreference", operator: "oneOf", values: ["full"] } });
    const skipTamper = withNode("one-hour-sms", { skipIfPast: false });
    const reorderedPredicate = withNode("one-hour-sms", { predicate: { field: "reminderPreference", operator: "oneOf", values: ["full", "some"] } });
    expect((await compileWorkflowSpec(reorderedPredicate, { allowedResponsibilities })).compiledPlanDigest).toBe(first.compiledPlanDigest);
    for (const tamper of [timingTamper, predicateTamper, skipTamper]) {
      const changed = await compileWorkflowSpec(tamper, { allowedResponsibilities });
      expect(changed.specDigest).not.toBe(first.specDigest);
      expect(changed.compiledPlanDigest).not.toBe(first.compiledPlanDigest);
    }
  });

  it("detects compiled-plan and manifest tampering", async () => {
    const { plan, manifest } = await artifacts();
    await expect(createReleaseManifest({
      compiledPlan: { ...plan, nodes: [...plan.nodes, { id: "tampered" }] }, compilerArtifactDigest: fixture.artifacts.compilerArtifactDigest,
      handlerArtifactDigests: fixture.artifacts.handlerArtifactDigests, messageArtifacts: fixture.artifacts.messageArtifacts, effectOwnership: ownership,
    })).rejects.toThrow(/digest/);
    const { releaseManifestDigest, ...unsignedManifest } = manifest;
    const changedManifest = { ...unsignedManifest, workflowVersion: "changed" };
    expect(await sha256(unsignedManifest)).toBe(releaseManifestDigest);
    expect(await sha256(changedManifest)).not.toBe(releaseManifestDigest);
  });

  it("binds plan, compiler, handler, message, schema, deployment, and invocation fixtures without claiming a deployment", async () => {
    const { plan, manifest, deployment, invocation } = await artifacts();
    expect(manifest.compiledPlanDigest).toBe(plan.compiledPlanDigest);
    expect(deployment).toMatchObject({ kind: "fixture", deployed: false, releaseManifestDigest: manifest.releaseManifestDigest, d1SchemaHead: fixture.d1SchemaHead });
    expect(invocation).toMatchObject({ kind: "fixture", deploymentRecordDigest: deployment.deploymentRecordDigest, releaseManifestDigest: manifest.releaseManifestDigest });
    expect(manifest).toMatchObject({ kind: "fixture", attestation: "unattested" });
    expect(Object.isFrozen(plan.nodes)).toBe(true);
    expect(Object.isFrozen(plan.nodes[0])).toBe(true);
    expect(Object.isFrozen(manifest.handlerArtifactDigests)).toBe(true);
    expect(Object.isFrozen(deployment.d1SchemaHead)).toBe(true);
    expect(Object.isFrozen(invocation.d1SchemaHead)).toBe(true);
    expect(() => { plan.nodes[0].id = "mutated"; }).toThrow();
    expect(() => { manifest.handlerArtifactDigests["observe-followup-node"] = "b".repeat(64); }).toThrow();
  });

  it("makes node provenance additive and names every existing-spine extension without writing a ledger", async () => {
    const { plan } = await artifacts();
    const payload = createNodeProvenancePayload({ compiledPlan: plan, lifecycleInstanceId: "life_1", obligationId: "obl_1", commandAttemptId: "cmd_1", providerReceiptId: "receipt_1", exceptionId: "exc_1", nodeId: "confirmation", occurredAt: 1 });
    expect(payload.lifecycle_node_transition).toMatchObject({ lifecycle_instance_id: "life_1", node_id: "confirmation", append_only: true });
    expect(payload.obligation_extension.obligation_id).toBe("obl_1");
    expect(payload.command_attempt_extension.command_attempt_id).toBe("cmd_1");
    expect(payload.provider_receipt_extension.provider_receipt_id).toBe("receipt_1");
    expect(payload.exception_extension.exception_id).toBe("exc_1");
  });

  it("turns duplicate/replay into no-op and mismatched replay provenance into Broken", async () => {
    const { invocation } = await artifacts();
    expect(classifyReplay({ existingInvocation: invocation, candidateInvocation: invocation })).toMatchObject({ state: "duplicate", sideEffectAllowed: false });
    expect(classifyReplay({ existingInvocation: invocation, candidateInvocation: { ...invocation, releaseManifestDigest: "b".repeat(64) } })).toMatchObject({ state: "broken", safetyViolation: true, sideEffectAllowed: false });
  });

  it("preserves ambiguity for timeout/ambiguous providers and blocks a lease-fence mismatch", () => {
    expect(classifyCommandOutcome({ providerOutcome: "timeout", leaseFence: "lease-1", expectedFence: "lease-1" })).toMatchObject({ state: "ambiguous", requiresReconciliation: true, sideEffectAllowed: false });
    expect(classifyCommandOutcome({ providerOutcome: "ambiguous", leaseFence: "lease-1", expectedFence: "lease-1" })).toMatchObject({ state: "ambiguous", requiresReconciliation: true });
    expect(classifyCommandOutcome({ providerOutcome: "accepted", leaseFence: "wrong", expectedFence: "lease-1" })).toMatchObject({ state: "blocked", reason: "lease_fence_mismatch", sideEffectAllowed: false });
  });

  it("makes Staff shadow Unknown for missing or mismatched authorities, Degraded for stale evidence, and Broken by precedence", async () => {
    const { manifest, deployment, invocation } = await artifacts();
    await expect(projectStaffShadow({})).resolves.toMatchObject({ mode: "shadow", status: "Unknown" });
    await expect(projectStaffShadow({ releaseManifest: manifest, deploymentRecord: deployment, invocationIdentity: { ...invocation, deploymentRecordDigest: "c".repeat(64) }, evidenceEnvelopes: [exactEvidence] })).resolves.toMatchObject({ status: "Unknown" });
    const stale = await projectStaffShadow({ releaseManifest: manifest, deploymentRecord: deployment, invocationIdentity: invocation, evidenceEnvelopes: [{ ...exactEvidence, freshness: { ...exactEvidence.freshness, state: "stale" } }] });
    expect(stale).toMatchObject({ status: "Unknown", fixtureEvaluation: { nonAuthoritative: true, status: "Degraded" } });
    const broken = await projectStaffShadow({ releaseManifest: manifest, deploymentRecord: deployment, invocationIdentity: invocation, evidenceEnvelopes: [
      { ...exactEvidence, freshness: { ...exactEvidence.freshness, state: "stale" } },
      { ...exactEvidence, safetyViolation: true, status: "Broken" },
    ] });
    expect(broken).toMatchObject({ status: "Unknown", fixtureEvaluation: { nonAuthoritative: true, status: "Broken" } });
    await expect(projectStaffShadow({ releaseManifest: manifest, deploymentRecord: deployment, invocationIdentity: { ...invocation, d1SchemaHead: { ...invocation.d1SchemaHead, version: 99 } }, evidenceEnvelopes: [exactEvidence] })).resolves.toMatchObject({ status: "Unknown", reasonCodes: expect.arrayContaining(["invocation_identity_digest_mismatch", "invocation_schema_mismatch"]) });
  });

  it("enforces Phase A effect ownership while compiling the parity fixture", async () => {
    const plan = await compileWorkflowSpec(fixture.workflowSpec, { allowedResponsibilities });
    await expect(createReleaseManifest({
      compiledPlan: plan, compilerArtifactDigest: fixture.artifacts.compilerArtifactDigest,
      handlerArtifactDigests: fixture.artifacts.handlerArtifactDigests, messageArtifacts: fixture.artifacts.messageArtifacts,
      effectOwnership: [...ownership, { ...ownership[0], owner: "Amari", mode: "live", effectful: true, observer: false }],
    })).rejects.toThrow(/overlapping/);
  });

  it("rejects missing or tampered source-backed message artifacts and preserves parallel Follow-Up scheduling", async () => {
    const plan = await compileWorkflowSpec(fixture.workflowSpec, { allowedResponsibilities });
    const { manifest } = await artifacts();
    const tampered = await createReleaseManifest({ compiledPlan: plan, compilerArtifactDigest: fixture.artifacts.compilerArtifactDigest, handlerArtifactDigests: fixture.artifacts.handlerArtifactDigests, messageArtifacts: { ...fixture.artifacts.messageArtifacts, "message.confirmation": { ...fixture.artifacts.messageArtifacts["message.confirmation"], body: "tampered" } }, effectOwnership: ownership });
    expect(tampered.releaseManifestDigest).not.toBe(manifest.releaseManifestDigest);
    await expect(createReleaseManifest({ compiledPlan: plan, compilerArtifactDigest: fixture.artifacts.compilerArtifactDigest, handlerArtifactDigests: fixture.artifacts.handlerArtifactDigests, messageArtifacts: { ...fixture.artifacts.messageArtifacts, "message.confirmation": undefined }, effectOwnership: ownership })).rejects.toThrow(/JSON-compatible/);
    const confirmation = plan.nodes.find((node) => node.id === "confirmation");
    expect(confirmation.next.map((edge) => edge.to)).toEqual(expect.arrayContaining(["day-before", "one-hour-email", "one-hour-sms", "one-hour-internal"]));
    expect(plan.nodes.find((node) => node.id === "one-hour-sms")).toMatchObject({ at: "start-60m", skipIfPast: true, predicate: { field: "reminderPreference", operator: "oneOf", values: ["full", "some"] } });
    expect(plan.nodes.find((node) => node.id === "appointment-cancelled").next[0].to).toBe("cancel-pending-reminders");
  });
});
