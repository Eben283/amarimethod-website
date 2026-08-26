import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileWorkflowSpec, createReleaseManifest } from "./automation-truth-phase-b.js";
import { validateWorkflowSpec } from "./automation-truth-contract.js";
import { FOLLOW_UP_WORKFLOW } from "../../reminder-engine-worker/src/follow-up-workflow.js";
import { createObservedDeploymentReadback, projectDeploymentTruth } from "./automation-truth-phase-c.js";

const fixtureDocument = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/follow-up-phase-c-observed-readback.v1.json", import.meta.url)));
const { fixtureVersion, purpose, ...fixture } = fixtureDocument;
const phaseBFixture = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/follow-up-shadow-parity.v1.json", import.meta.url)));

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
async function observed(patch = {}) {
  return createObservedDeploymentReadback({ ...clone(fixture), ...patch });
}

describe("automation truth Phase C observed deployment readback", () => {
  it("pins its Follow-Up inputs to the committed Phase B compiler, plan, manifest, workflow, and schema", async () => {
    expect(fixtureVersion).toBe("follow-up-phase-c-observed-readback.v1");
    expect(purpose).toMatch(/not a runtime deployment attestation/i);
    expect(fileDigest("./automation-truth-phase-b.js")).toBe(fixture.phaseB.compilerArtifactSha256);
    expect(fileDigest("../../reminder-engine-worker/schema.sql")).toBe(fixture.schema.expectedHead.sourceSha256);
    expect(FOLLOW_UP_WORKFLOW.id).toBe(phaseBFixture.workflowSpec.workflowId);
    const ownership = phaseBFixture.effectOwnership;
    validateWorkflowSpec(phaseBFixture.workflowSpec, { allowedResponsibilities: new Set(ownership.map((entry) => entry.responsibility)) });
    const plan = await compileWorkflowSpec(phaseBFixture.workflowSpec, { allowedResponsibilities: new Set(ownership.map((entry) => entry.responsibility)) });
    const manifest = await createReleaseManifest({
      compiledPlan: plan,
      compilerArtifactDigest: phaseBFixture.artifacts.compilerArtifactDigest,
      handlerArtifactDigests: phaseBFixture.artifacts.handlerArtifactDigests,
      messageArtifacts: phaseBFixture.artifacts.messageArtifacts,
      effectOwnership: ownership,
    });
    expect(plan.compiledPlanDigest).toBe(fixture.phaseB.compiledPlanDigest);
    expect(manifest.releaseManifestDigest).toBe(fixture.phaseB.releaseManifestDigest);
  });

  it("normalizes binding order, preserves secret-presence metadata only, and deeply freezes the artifact", async () => {
    const first = await observed();
    const reordered = await observed({ bindings: { expected: [...fixture.bindings.expected].reverse(), observed: [...fixture.bindings.observed].reverse() } });
    expect(first.deploymentReadbackDigest).toBe(reordered.deploymentReadbackDigest);
    expect(first.bindings.observed.find((binding) => binding.kind === "secret")).toEqual(expect.objectContaining({ present: true }));
    expect(first.bindings.observed.find((binding) => binding.kind === "secret")).not.toHaveProperty("valueSha256");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bindings.observed)).toBe(true);
    expect(Object.isFrozen(first.bindings.observed[0])).toBe(true);
    expect(() => { first.bindings.observed[0].name = "tampered"; }).toThrow();
  });

  it("returns Unknown for observed-only, stale, and incomplete authority; it never claims live or healthy", async () => {
    const current = await projectDeploymentTruth({ readback: await observed(), now: "2026-08-26T20:10:00.000Z" });
    expect(current).toMatchObject({ status: "Unknown", identity: { service: "reminder-engine", runtimeSourceRevision: fixture.runtime.sourceRevision } });
    expect(current.reasonCodes).toEqual(expect.arrayContaining([
      "control_plane_source_revision_unattested",
      "remote_schema_hash_unobserved",
      "phase_b_runtime_reference_missing",
      "observed_readback_not_runtime_attestation",
    ]));
    const expired = await projectDeploymentTruth({ readback: await observed(), now: "2026-08-26T20:21:00.000Z" });
    expect(expired).toMatchObject({ status: "Unknown", reasonCodes: expect.arrayContaining(["deployment_readback_expired"]) });
  });

  it("gives Broken precedence for bad canonical evidence and Unknown for absent authority", async () => {
    const valid = await observed();
    const tampered = clone(valid);
    tampered.bindings.observed.find((binding) => binding.kind === "d1").resourceId = "different-d1";
    await expect(projectDeploymentTruth({ readback: tampered, now: "2026-08-26T20:10:00.000Z" })).resolves.toMatchObject({ status: "Broken", reasonCodes: ["deployment_readback_digest_mismatch"] });

    const bindingMismatchInput = clone(fixture);
    bindingMismatchInput.bindings.observed[0].resourceId = "different-d1";
    await expect(projectDeploymentTruth({ readback: await createObservedDeploymentReadback(bindingMismatchInput), now: "2026-08-26T20:10:00.000Z" })).resolves.toMatchObject({ status: "Broken", reasonCodes: expect.arrayContaining(["binding_parity_mismatch", "schema_binding_mismatch"]) });

    const schemaMismatchInput = clone(fixture);
    schemaMismatchInput.schema.remoteHead.sourceSha256 = "a".repeat(64);
    await expect(projectDeploymentTruth({ readback: await createObservedDeploymentReadback(schemaMismatchInput), now: "2026-08-26T20:10:00.000Z" })).resolves.toMatchObject({ status: "Broken", reasonCodes: ["remote_schema_hash_mismatch"] });

    await expect(projectDeploymentTruth({ readback: {}, now: "2026-08-26T20:10:00.000Z" })).resolves.toEqual({ status: "Unknown", reasonCodes: ["deployment_readback_missing_or_invalid"] });
  });

  it("rejects malformed shapes and identifies a missing source-attested build rather than inventing it", async () => {
    const bad = clone(fixture);
    bad.runtime.sourceRevision = "not-a-git-sha";
    await expect(createObservedDeploymentReadback(bad)).rejects.toThrow(/Git SHA/);
    const missing = clone(fixture);
    delete missing.build.handlerArtifactSha256;
    await expect(createObservedDeploymentReadback(missing)).rejects.toThrow(/build.handlerArtifactSha256/);
    const projection = await projectDeploymentTruth({ readback: await observed(), now: "2026-08-26T20:10:00.000Z" });
    expect(projection.reasonCodes).toEqual(expect.arrayContaining(["build_cleanBuildSha256_unattested", "build_handlerArtifactSha256_unattested", "build_messageArtifactSha256_unattested"]));
  });

  it("treats an absent bundle attestation as Unknown but a known conflict as Broken", async () => {
    const absentBundle = clone(fixture);
    absentBundle.build.bundleSha256 = null;
    await expect(projectDeploymentTruth({ readback: await createObservedDeploymentReadback(absentBundle), now: "2026-08-26T20:10:00.000Z" })).resolves.toMatchObject({
      status: "Unknown", reasonCodes: expect.arrayContaining(["build_bundleSha256_unattested"]),
    });
    const conflictingBundle = clone(fixture);
    conflictingBundle.build.bundleSha256 = "a".repeat(64);
    await expect(projectDeploymentTruth({ readback: await createObservedDeploymentReadback(conflictingBundle), now: "2026-08-26T20:10:00.000Z" })).resolves.toMatchObject({
      status: "Broken", reasonCodes: ["runtime_bundle_identity_mismatch"],
    });
  });
});
