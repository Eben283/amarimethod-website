import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAttestedReleaseManifest,
  createDeploymentAttestationPayload,
  deploymentAttestationProblems,
  projectAuthenticatedDeploymentTruth,
  signDeploymentAttestationEnvelope,
  verifyDeploymentAttestationEnvelope,
} from "./automation-truth-phase-d.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY } from "./reliability-schema-authority.js";

const D = (character) => character.repeat(64);
const G = (character) => character.repeat(40);
const ATTESTED_AT = "2026-08-26T21:00:00.000Z";
const EXPIRES_AT = "2026-08-26T21:15:00.000Z";
const APPROVED_SHA256 = "2687f86ed6784b8a5fca36e6c468e12aa44dc3c7e8137e3160d1a95079bdcd02";
const WORKER_VERSION = "follow-up-reminder-engine.v3";
const textSha256 = (value) => createHash("sha256").update(value).digest("hex");
const BUILD_COVERAGE = [
  "bundle", "compiled_plan", "compiler_artifact", "handler_registry", "lockfile", "message_catalog",
  "modules", "release_manifest", "repository", "runtime_identity", "schema_source", "source_revision", "source_tree", "spec",
];
let keys;
beforeAll(async () => { keys = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]); });

const bindingsFor = (sourceRevision = G("a"), workerVersion = WORKER_VERSION) => [
  { name: "REMINDER_DB", kind: "d1", resourceId: "reminder-db-fixture" },
  { name: "FOLLOW_UP_DELIVERY_RELEASE", kind: "plain", valueSha256: APPROVED_SHA256 },
  { name: "FOLLOW_UP_ASSIGNED_USER_DELIVERY", kind: "plain", valueSha256: APPROVED_SHA256 },
  { name: "SOURCE_REVISION", kind: "plain", valueSha256: textSha256(sourceRevision) },
  { name: "WORKER_VERSION", kind: "plain", valueSha256: textSha256(workerVersion) },
  { name: "CF_VERSION_METADATA", kind: "version_metadata" },
  { name: "GHL_WEBHOOK_SECRET", kind: "secret", present: true },
];
const bindings = bindingsFor();

const releaseInput = (patch = {}) => {
  const source = patch.source || { repository: "Eben283/amarimethod-website", revision: G("a"), tree: G("b"), lockfile: { path: "package-lock.json", sha256: D("c") } };
  const runtimeIdentity = patch.runtimeIdentity || { workerVersion: WORKER_VERSION, runtimeVersion: `${source.revision}@${WORKER_VERSION}` };
  return ({
  source,
  runtimeIdentity,
  workflow: { workflowId: "follow-up-session-reminders", version: 3, state: "published", documentSha256: D("d") },
  compiledPlan: {
    compilerId: "amari-automation-truth-compiler.v1", compilerArtifactSha256: D("e"), specDigest: D("f"),
    compiledPlanDigest: D("1"), handlerRegistryDigest: D("2"), messageCatalogDigest: D("3"),
  },
  artifacts: {
    bundle: { format: "cloudflare-worker-modules", sha256: D("4") },
    modules: [
      { path: "follow-up-workflow.js", sha256: D("5") },
      { path: "index.js", sha256: D("6") },
    ],
    moduleCatalog: { algorithm: "esbuild-metafile-inputs.v1", complete: true },
  },
  expectedBindings: patch.expectedBindings || bindingsFor(source.revision, runtimeIdentity.workerVersion),
  requiredSchema: {
    databaseId: "reminder-db-fixture",
    migrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId,
    version: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.version,
    sourceSha256: D("6"),
    structureSha256: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256,
  },
  deliveryGuards: { followUpDeliveryRelease: "approved", followUpAssignedUserDelivery: "approved" },
  effectOwner: { system: "Amari", mode: "live", effectful: true },
  canonicalization: "amari-canonical-json.v1",
  createdAt: "2026-08-26T20:55:00.000Z",
  ...patch,
  });
};

function observation(manifest, patch = {}) {
  return {
    platform: "cloudflare", service: "reminder-engine", environment: "production",
    deploymentId: "deployment-fixture", versionId: "version-fixture", trafficPercent: 100,
    source: { revision: manifest.source.revision, tree: manifest.source.tree },
    artifacts: { ...manifest.artifacts },
    bindings: manifest.expectedBindings.map((binding) => ({ ...binding })),
    schema: { ...manifest.requiredSchema },
    workflow: { ...manifest.workflow },
    deliveryGuards: { ...manifest.deliveryGuards },
    versionMetadata: { binding: "CF_VERSION_METADATA", versionId: "version-fixture" },
    authorityEvidence: {
      build: { authority: "github-actions-build-provenance", reference: "github://Eben283/amarimethod-website/actions/runs/fixture", sha256: D("6"), coverage: [...BUILD_COVERAGE].reverse() },
      cloudflare: { authority: "cloudflare-control-plane-api", reference: "cloudflare://workers/reminder-engine/deployments/deployment-fixture", sha256: D("7"), coverage: ["version", "bindings", "traffic", "deployment"] },
      d1Schema: { authority: "remote-d1-schema-readback", reference: "d1://reminder-db-fixture/schema/v2", sha256: D("8"), coverage: ["tables", "migration", "schema_hash"] },
      d1Workflow: { authority: "remote-d1-workflow-readback", reference: "d1://reminder-db-fixture/workflows/follow-up-session-reminders/v3", sha256: D("9"), coverage: ["version", "document", "published_state"] },
    },
    ...patch,
  };
}

describe("Phase D authenticated deployment attestation contract", () => {
  it("canonically binds the live persisted Follow-Up v3 document, both delivery guards, and no secret values", async () => {
    const first = await createAttestedReleaseManifest(releaseInput());
    const reordered = await createAttestedReleaseManifest(releaseInput({ expectedBindings: [...bindings].reverse() }));
    expect(first.releaseManifestDigest).toBe(reordered.releaseManifestDigest);
    expect(first).toMatchObject({
      family: "follow-up-session-reminders",
      workflow: { version: 3, state: "published" },
      runtimeIdentity: { workerVersion: WORKER_VERSION, runtimeVersion: `${G("a")}@${WORKER_VERSION}` },
      deliveryGuards: { followUpDeliveryRelease: "approved", followUpAssignedUserDelivery: "approved" },
      effectOwner: { system: "Amari", mode: "live", effectful: true },
    });
    const secretBinding = first.expectedBindings.find((binding) => binding.kind === "secret");
    expect(secretBinding).toEqual({ name: "GHL_WEBHOOK_SECRET", kind: "secret", present: true });
    expect(secretBinding).not.toHaveProperty("value");
    expect(Object.isFrozen(first.expectedBindings)).toBe(true);
  });

  it("signs and verifies an immutable authenticated envelope only when all deployment identities match", async () => {
    const manifest = await createAttestedReleaseManifest(releaseInput());
    const payload = await createDeploymentAttestationPayload({
      releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    });
    const envelope = await signDeploymentAttestationEnvelope(payload, { keyId: "attestor-2026-08", privateKey: keys.privateKey });
    const verified = await verifyDeploymentAttestationEnvelope({
      releaseManifest: manifest, envelope,
      keyring: [{ keyId: "attestor-2026-08", publicKey: keys.publicKey, validFrom: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z" }],
      now: "2026-08-26T21:05:00.000Z",
    });
    expect(verified.problems).toEqual([]);
    expect(verified).toMatchObject({ authenticity: "verified", freshness: { status: "Fresh" } });
    expect(envelope.deploymentAttestationId).toBe(`depatt_${envelope.payloadDigest}`);
    expect(Object.isFrozen(envelope.payload.observed.bindings)).toBe(true);
  });

  it("reports known source, artifact, binding, schema, and workflow mismatches instead of attesting them", async () => {
    const manifest = await createAttestedReleaseManifest(releaseInput());
    const payload = await createDeploymentAttestationPayload({
      releaseManifest: manifest,
      observed: observation(manifest, {
        source: { revision: G("c"), tree: manifest.source.tree },
        artifacts: { ...manifest.artifacts, bundle: { ...manifest.artifacts.bundle, sha256: D("7") } },
        bindings: manifest.expectedBindings.map((binding) => binding.name === "REMINDER_DB" ? { ...binding, resourceId: "wrong-db" } : { ...binding }),
        schema: { ...manifest.requiredSchema, sourceSha256: D("8") },
        workflow: { ...manifest.workflow, documentSha256: D("9") },
      }),
      observedAt: "2026-08-26T20:59:00.000Z",
      attestedAt: ATTESTED_AT,
      expiresAt: EXPIRES_AT,
    });
    expect(await deploymentAttestationProblems(manifest, payload)).toEqual([
      "artifact_identity_mismatch", "binding_manifest_mismatch", "schema_identity_mismatch",
      "source_identity_mismatch", "workflow_document_identity_mismatch",
    ]);
  });

  it("rejects envelope tampering, expiration, seed v2, and unapproved delivery guards", async () => {
    await expect(createAttestedReleaseManifest(releaseInput({ workflow: { ...releaseInput().workflow, version: 2 } }))).rejects.toThrow(/version must be 3/);
    await expect(createAttestedReleaseManifest(releaseInput({
      deliveryGuards: { followUpDeliveryRelease: "shadow", followUpAssignedUserDelivery: "approved" },
    }))).rejects.toThrow(/must be approved/);
    const manifest = await createAttestedReleaseManifest(releaseInput());
    const payload = await createDeploymentAttestationPayload({ releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT });
    const envelope = await signDeploymentAttestationEnvelope(payload, { keyId: "attestor-test", privateKey: keys.privateKey });
    const keyring = [{ keyId: "attestor-test", publicKey: keys.publicKey, validFrom: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z" }];
    await expect(verifyDeploymentAttestationEnvelope({
      releaseManifest: manifest,
      envelope: { ...envelope, authentication: { ...envelope.authentication, signature: "0".repeat(128) } },
      keyring,
      now: "2026-08-26T21:05:00.000Z",
    })).rejects.toThrow(/authentication failed/);
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope, keyring, now: "2026-08-26T21:16:00.000Z" }))
      .resolves.toMatchObject({ authenticity: "verified", freshness: { status: "Unknown", reason: "attestation_expired" } });
  });

  it("rejects extra data before signing and verification and enforces canonical RFC3339", async () => {
    const manifest = await createAttestedReleaseManifest(releaseInput());
    const payload = await createDeploymentAttestationPayload({ releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT });
    await expect(signDeploymentAttestationEnvelope({ ...payload, contactId: "not-allowed" }, { keyId: "attestor-test", privateKey: keys.privateKey })).rejects.toThrow(/contactId is not allowed/);
    await expect(createDeploymentAttestationPayload({ releaseManifest: manifest, observed: observation(manifest), observedAt: "August 26, 2026", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT })).rejects.toThrow(/canonical RFC3339/);
    const envelope = await signDeploymentAttestationEnvelope(payload, { keyId: "attestor-test", privateKey: keys.privateKey });
    await expect(verifyDeploymentAttestationEnvelope({
      releaseManifest: manifest, envelope: { ...envelope, payload: { ...envelope.payload, rawPayload: "forbidden" } },
      keyring: [{ keyId: "attestor-test", publicKey: keys.publicKey, validFrom: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z" }],
      now: "2026-08-26T21:05:00.000Z",
    })).rejects.toThrow(/rawPayload is not allowed/);
  });

  it("pins a cross-runtime canonicalization fixture and sorts complete module catalogs", async () => {
    const first = await createAttestedReleaseManifest(releaseInput());
    const reorderedModules = [...releaseInput().artifacts.modules].reverse();
    const reordered = await createAttestedReleaseManifest(releaseInput({
      artifacts: { ...releaseInput().artifacts, modules: reorderedModules },
    }));
    expect(first.releaseManifestDigest).toBe(reordered.releaseManifestDigest);
    expect(first.canonicalization).toBe("amari-canonical-json.v1");
    expect(first.releaseManifestDigest).toBe("78fcfe837d56f8cf3188c0755a7468b32fd69d75ba1c87ab557644cc4b0b00fa");
    await expect(createAttestedReleaseManifest(releaseInput({
      artifacts: { ...releaseInput().artifacts, modules: [...releaseInput().artifacts.modules, releaseInput().artifacts.modules[0]] },
    }))).rejects.toThrow(/duplicate paths/);
    await expect(createAttestedReleaseManifest(releaseInput({
      artifacts: { ...releaseInput().artifacts, modules: [{ path: "../secret.js", sha256: D("5") }] },
    }))).rejects.toThrow(/repository-relative POSIX path/);
    const unicode = await createAttestedReleaseManifest(releaseInput({
      artifacts: {
        ...releaseInput().artifacts,
        modules: [{ path: "z.js", sha256: D("5") }, { path: "é.js", sha256: D("6") }],
      },
    }));
    expect(unicode.artifacts.modules.map((module) => module.path)).toEqual(["z.js", "é.js"]);
  });

  it("changes the release identity when any deployable authority changes", async () => {
    const variants = [
      releaseInput(),
      releaseInput({ workflow: { ...releaseInput().workflow, documentSha256: D("8") } }),
      releaseInput({ compiledPlan: { ...releaseInput().compiledPlan, compiledPlanDigest: D("8") } }),
      releaseInput({ compiledPlan: { ...releaseInput().compiledPlan, handlerRegistryDigest: D("8") } }),
      releaseInput({ compiledPlan: { ...releaseInput().compiledPlan, messageCatalogDigest: D("8") } }),
      releaseInput({ requiredSchema: { ...releaseInput().requiredSchema, sourceSha256: D("8") } }),
      releaseInput({ artifacts: { ...releaseInput().artifacts, bundle: { ...releaseInput().artifacts.bundle, sha256: D("8") } } }),
    ];
    const digests = await Promise.all(variants.map((variant) => createAttestedReleaseManifest(variant).then((item) => item.releaseManifestDigest)));
    expect(new Set(digests).size).toBe(digests.length);
    await expect(createAttestedReleaseManifest(releaseInput({
      requiredSchema: { ...releaseInput().requiredSchema, structureSha256: D("8") },
    }))).rejects.toThrow(/structureSha256 must be/);
    await expect(createAttestedReleaseManifest(releaseInput({
      requiredSchema: {
        ...releaseInput().requiredSchema,
        migrationId: "reliability-spine-v2-deployment-attestation",
      },
    }))).rejects.toThrow(/migrationId must be/);
  });

  it("fails closed on malformed bindings, secret expansion, evidence references, and nested unknown keys", async () => {
    await expect(createAttestedReleaseManifest(releaseInput({
      expectedBindings: bindings.map((binding) => binding.name === "REMINDER_DB" ? { ...binding, kind: "kv" } : binding),
    }))).rejects.toThrow(/REMINDER_DB binding/);
    await expect(createAttestedReleaseManifest(releaseInput({
      expectedBindings: bindings.map((binding) => binding.name === "FOLLOW_UP_DELIVERY_RELEASE" ? { ...binding, kind: "secret", present: true } : binding),
    }))).rejects.toThrow(/valueSha256 is not allowed|plain sha256/);
    await expect(createAttestedReleaseManifest(releaseInput({
      expectedBindings: bindings.map((binding) => binding.name === "SOURCE_REVISION" ? { ...binding, valueSha256: D("a") } : binding),
    }))).rejects.toThrow(/SOURCE_REVISION binding/);
    await expect(createAttestedReleaseManifest(releaseInput({
      runtimeIdentity: { workerVersion: WORKER_VERSION, runtimeVersion: "wrong-composite" },
    }))).rejects.toThrow(/runtimeIdentity.runtimeVersion/);
    await expect(createAttestedReleaseManifest(releaseInput({ expectedBindings: bindings.slice(0, -1).concat(bindings[0]) })))
      .rejects.toThrow(/duplicate names/);
    await expect(createAttestedReleaseManifest(releaseInput({
      expectedBindings: bindings.map((binding) => binding.kind === "secret" ? { ...binding, value: "forbidden" } : binding),
    }))).rejects.toThrow(/value is not allowed/);
    const manifest = await createAttestedReleaseManifest(releaseInput());
    await expect(createDeploymentAttestationPayload({
      releaseManifest: manifest,
      observed: observation(manifest, {
        authorityEvidence: {
          ...observation(manifest).authorityEvidence,
          cloudflare: { ...observation(manifest).authorityEvidence.cloudflare, reference: "data:text/plain,secret" },
        },
      }),
      observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    })).rejects.toThrow(/bounded opaque/);
    await expect(createDeploymentAttestationPayload({
      releaseManifest: manifest,
      observed: observation(manifest, { source: { revision: manifest.source.revision, tree: manifest.source.tree, secret: "forbidden" } }),
      observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    })).rejects.toThrow(/secret is not allowed/);
    await expect(createDeploymentAttestationPayload({
      releaseManifest: manifest,
      observed: observation(manifest, {
        authorityEvidence: {
          ...observation(manifest).authorityEvidence,
          build: { ...observation(manifest).authorityEvidence.build, coverage: BUILD_COVERAGE.slice(1) },
        },
      }),
      observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    })).rejects.toThrow(/coverage is incomplete/);
  });

  it("enforces canonical time ordering, observation age, TTL, and release-before-observation", async () => {
    const manifest = await createAttestedReleaseManifest(releaseInput());
    for (const invalid of ["2026-08-26", "Wed, 26 Aug 2026 21:00:00 GMT", "2026-08-26T21:00:00Z", "2026-08-26T14:00:00.000-07:00"]) {
      await expect(createDeploymentAttestationPayload({
        releaseManifest: manifest, observed: observation(manifest), observedAt: invalid, attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
      })).rejects.toThrow(/canonical RFC3339/);
    }
    await expect(createDeploymentAttestationPayload({
      releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:54:59.999Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    })).rejects.toThrow(/no more than 5 minutes/);
    await expect(createDeploymentAttestationPayload({
      releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: "2026-08-26T21:15:00.001Z",
    })).rejects.toThrow(/TTL/);
    const lateRelease = await createAttestedReleaseManifest(releaseInput({ createdAt: "2026-08-26T20:59:30.000Z" }));
    await expect(createDeploymentAttestationPayload({
      releaseManifest: lateRelease, observed: observation(lateRelease), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT,
    })).rejects.toThrow(/must exist before/);
  });

  it("rejects unknown, duplicate, retired, and malformed attestor keys", async () => {
    const manifest = await createAttestedReleaseManifest(releaseInput());
    const payload = await createDeploymentAttestationPayload({ releaseManifest: manifest, observed: observation(manifest), observedAt: "2026-08-26T20:59:00.000Z", attestedAt: ATTESTED_AT, expiresAt: EXPIRES_AT });
    const envelope = await signDeploymentAttestationEnvelope(payload, { keyId: "attestor-test", privateKey: keys.privateKey });
    const entry = { keyId: "attestor-test", publicKey: keys.publicKey, validFrom: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z" };
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope, keyring: [{ ...entry, keyId: "other-key" }], now: "2026-08-26T21:05:00.000Z" }))
      .rejects.toThrow(/not allowlisted/);
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope, keyring: [entry, entry], now: "2026-08-26T21:05:00.000Z" }))
      .rejects.toThrow(/duplicate key ids/);
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope, keyring: [{ ...entry, validUntil: "2026-08-26T20:00:00.000Z" }], now: "2026-08-26T21:05:00.000Z" }))
      .rejects.toThrow(/not valid when signed/);
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope, keyring: [{ ...entry, validUntil: ATTESTED_AT }], now: "2026-08-26T21:05:00.000Z" }))
      .rejects.toThrow(/not valid when signed/);
    await expect(verifyDeploymentAttestationEnvelope({ releaseManifest: manifest, envelope: { ...envelope, authentication: { ...envelope.authentication, signature: "bad" } }, keyring: [entry], now: "2026-08-26T21:05:00.000Z" }))
      .rejects.toThrow(/64-byte Ed25519/);
  });

  it("projects authenticated mismatches as Broken even when evidence is stale, while missing authority stays Unknown", () => {
    expect(projectAuthenticatedDeploymentTruth(null)).toEqual({ status: "Unknown", reasonCodes: ["authenticated_attestation_missing"] });
    expect(projectAuthenticatedDeploymentTruth({
      authenticity: "verified", problems: ["workflow_document_identity_mismatch"],
      freshness: { status: "Unknown", reason: "attestation_expired" },
    })).toEqual({
      status: "Broken", reasonCodes: ["workflow_document_identity_mismatch"], authority: "authenticated_external_attestor",
    });
    expect(projectAuthenticatedDeploymentTruth({ authenticity: "verified", problems: [], freshness: { status: "Fresh" } }))
      .toEqual({ status: "Unknown", reasonCodes: ["runtime_recorder_not_adopted"], authority: "authenticated_external_attestor" });
  });
});
