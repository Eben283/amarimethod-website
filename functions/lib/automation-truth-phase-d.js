/**
 * Phase D source contract for an authenticated Follow-Up deployment
 * attestation. This module is deliberately not imported by a Worker, Pages
 * Function, Staff, or any other runtime entrypoint.
 */
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";

export const FOLLOW_UP_RELEASE_MANIFEST_VERSION = "follow-up-release-manifest.v2";
export const FOLLOW_UP_DEPLOYMENT_ATTESTATION_VERSION = "follow-up-deployment-attestation.v1";
export const AUTHENTICATED_ATTESTATION_ENVELOPE_VERSION = "authenticated-attestation-envelope.v1";
export const AUTOMATION_TRUTH_CANONICALIZATION_VERSION = "amari-canonical-json.v1";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const RFC3339_MILLIS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FOLLOW_UP_WORKFLOW_ID = "follow-up-session-reminders";
const FOLLOW_UP_WORKFLOW_VERSION = 3;
const FOLLOW_UP_SCHEMA_MIGRATION = "reliability-spine-v2-deployment-attestation";
const FOLLOW_UP_SCHEMA_VERSION = 2;
const MAX_OBSERVATION_AGE_MS = 5 * 60 * 1000;
const MAX_ATTESTATION_TTL_MS = 15 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1000;
const APPROVED_DELIVERY_GUARDS = Object.freeze({
  followUpDeliveryRelease: "approved",
  followUpAssignedUserDelivery: "approved",
});

function strictObject(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

// ECMAScript's relational string comparison is locale-independent. Keep
// canonical array ordering here rather than relying on localeCompare, whose
// collation can vary between the attestor and a Worker runtime.
function canonicalTextCompare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function exact(value, expected, label) {
  const normalized = text(value, label);
  if (normalized !== expected) throw new TypeError(`${label} must be ${expected}`);
  return normalized;
}

function digest(value, label) {
  const normalized = text(value, label).replace(/^sha256:/, "").toLowerCase();
  if (!SHA256.test(normalized)) throw new TypeError(`${label} must be a SHA-256 digest`);
  return normalized;
}

function gitSha(value, label) {
  const normalized = text(value, label).toLowerCase();
  if (!GIT_SHA.test(normalized)) throw new TypeError(`${label} must be a full Git SHA`);
  return normalized;
}

function repoPath(value, label) {
  const normalized = text(value, label);
  if (normalized.startsWith("/") || normalized.includes("\\") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new TypeError(`${label} must be a normalized repository-relative POSIX path`);
  }
  return normalized;
}

function evidenceReference(value, label) {
  const normalized = text(value, label);
  if (normalized.length > 512
    || !/^(?:cloudflare|d1|github):\/\/[A-Za-z0-9._~:/=-]+$/.test(normalized)) {
    throw new TypeError(`${label} must be a bounded opaque cloudflare://, d1://, or github:// reference`);
  }
  return normalized;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function timestamp(value, label) {
  const normalized = text(value, label);
  if (!RFC3339_MILLIS_UTC.test(normalized) || Number.isNaN(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) {
    throw new TypeError(`${label} must be canonical RFC3339 UTC with millisecond precision`);
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeBinding(binding, label) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new TypeError(`${label} must be an object`);
  const kind = text(binding.kind, `${label}.kind`);
  const allowedByKind = {
    d1: new Set(["name", "kind", "resourceId"]),
    kv: new Set(["name", "kind", "resourceId"]),
    service: new Set(["name", "kind", "service", "environment"]),
    plain: new Set(["name", "kind", "valueSha256"]),
    secret: new Set(["name", "kind", "present"]),
    version_metadata: new Set(["name", "kind"]),
  };
  const allowed = allowedByKind[kind];
  if (!allowed) throw new TypeError(`${label}.kind is unsupported`);
  strictObject(binding, allowed, label);
  const normalized = { name: text(binding.name, `${label}.name`), kind };
  if (kind === "d1" || kind === "kv") normalized.resourceId = text(binding.resourceId, `${label}.resourceId`);
  if (kind === "service") {
    normalized.service = text(binding.service, `${label}.service`);
    normalized.environment = text(binding.environment, `${label}.environment`);
  }
  if (kind === "plain") normalized.valueSha256 = digest(binding.valueSha256, `${label}.valueSha256`);
  if (kind === "secret") {
    if (binding.present !== true) throw new TypeError(`${label}.present must be true`);
    normalized.present = true;
  }
  return normalized;
}

function normalizeBindings(bindings, label) {
  if (!Array.isArray(bindings) || !bindings.length) throw new TypeError(`${label} must be a non-empty list`);
  const normalized = bindings.map((binding, index) => normalizeBinding(binding, `${label}[${index}]`))
    .sort((left, right) => canonicalTextCompare(left.name, right.name));
  if (new Set(normalized.map((binding) => binding.name)).size !== normalized.length) throw new TypeError(`${label} contains duplicate names`);
  for (const required of [
    "REMINDER_DB", "FOLLOW_UP_DELIVERY_RELEASE", "FOLLOW_UP_ASSIGNED_USER_DELIVERY",
    "SOURCE_REVISION", "WORKER_VERSION", "CF_VERSION_METADATA",
  ]) {
    if (!normalized.some((binding) => binding.name === required)) throw new TypeError(`${label} must include ${required}`);
  }
  return normalized;
}

function normalizeWorkflow(workflow, label) {
  strictObject(workflow, new Set(["workflowId", "version", "state", "documentSha256"]), label);
  return {
    workflowId: exact(workflow.workflowId, FOLLOW_UP_WORKFLOW_ID, `${label}.workflowId`),
    version: workflow.version === FOLLOW_UP_WORKFLOW_VERSION
      ? workflow.version
      : (() => { throw new TypeError(`${label}.version must be ${FOLLOW_UP_WORKFLOW_VERSION}`); })(),
    state: exact(workflow.state, "published", `${label}.state`),
    documentSha256: digest(workflow.documentSha256, `${label}.documentSha256`),
  };
}

function normalizeSchema(schema, label) {
  strictObject(schema, new Set(["databaseId", "migrationId", "version", "sourceSha256", "structureSha256"]), label);
  return {
    databaseId: text(schema.databaseId, `${label}.databaseId`),
    migrationId: exact(schema.migrationId, FOLLOW_UP_SCHEMA_MIGRATION, `${label}.migrationId`),
    version: schema.version === FOLLOW_UP_SCHEMA_VERSION
      ? schema.version
      : (() => { throw new TypeError(`${label}.version must be ${FOLLOW_UP_SCHEMA_VERSION}`); })(),
    sourceSha256: digest(schema.sourceSha256, `${label}.sourceSha256`),
    structureSha256: digest(schema.structureSha256, `${label}.structureSha256`),
  };
}

function normalizeDeliveryGuards(guards, label) {
  strictObject(guards, new Set(["followUpDeliveryRelease", "followUpAssignedUserDelivery"]), label);
  return {
    followUpDeliveryRelease: exact(guards.followUpDeliveryRelease, APPROVED_DELIVERY_GUARDS.followUpDeliveryRelease, `${label}.followUpDeliveryRelease`),
    followUpAssignedUserDelivery: exact(guards.followUpAssignedUserDelivery, APPROVED_DELIVERY_GUARDS.followUpAssignedUserDelivery, `${label}.followUpAssignedUserDelivery`),
  };
}

function normalizeEffectOwner(owner, label) {
  strictObject(owner, new Set(["system", "mode", "effectful"]), label);
  if (owner.effectful !== true) throw new TypeError(`${label}.effectful must be true`);
  return {
    system: exact(owner.system, "Amari", `${label}.system`),
    mode: exact(owner.mode, "live", `${label}.mode`),
    effectful: true,
  };
}

function normalizeRuntimeIdentity(identity, sourceRevision, label) {
  strictObject(identity, new Set(["workerVersion", "runtimeVersion"]), label);
  const workerVersion = text(identity.workerVersion, `${label}.workerVersion`);
  return {
    workerVersion,
    runtimeVersion: exact(identity.runtimeVersion, `${sourceRevision}@${workerVersion}`, `${label}.runtimeVersion`),
  };
}

function normalizeLockfile(lockfile, label) {
  strictObject(lockfile, new Set(["path", "sha256"]), label);
  return {
    path: exact(repoPath(lockfile.path, `${label}.path`), "package-lock.json", `${label}.path`),
    sha256: digest(lockfile.sha256, `${label}.sha256`),
  };
}

function normalizeArtifacts(artifacts, label) {
  strictObject(artifacts, new Set(["bundle", "modules", "moduleCatalog"]), label);
  strictObject(artifacts.bundle, new Set(["format", "sha256"]), `${label}.bundle`);
  strictObject(artifacts.moduleCatalog, new Set(["algorithm", "complete"]), `${label}.moduleCatalog`);
  if (artifacts.moduleCatalog.complete !== true) throw new TypeError(`${label}.moduleCatalog.complete must be true`);
  if (!Array.isArray(artifacts.modules) || !artifacts.modules.length) throw new TypeError(`${label}.modules must be a non-empty list`);
  const modules = artifacts.modules.map((module, index) => {
    strictObject(module, new Set(["path", "sha256"]), `${label}.modules[${index}]`);
    return { path: repoPath(module.path, `${label}.modules[${index}].path`), sha256: digest(module.sha256, `${label}.modules[${index}].sha256`) };
  }).sort((left, right) => canonicalTextCompare(left.path, right.path));
  if (new Set(modules.map((module) => module.path)).size !== modules.length) throw new TypeError(`${label}.modules contains duplicate paths`);
  return {
    bundle: {
      format: exact(artifacts.bundle.format, "cloudflare-worker-modules", `${label}.bundle.format`),
      sha256: digest(artifacts.bundle.sha256, `${label}.bundle.sha256`),
    },
    modules,
    moduleCatalog: {
      algorithm: exact(artifacts.moduleCatalog.algorithm, "esbuild-metafile-inputs.v1", `${label}.moduleCatalog.algorithm`),
      complete: true,
    },
  };
}

function normalizeAuthorityEvidence(evidence, { authority, coverage }, label) {
  strictObject(evidence, new Set(["authority", "reference", "sha256", "coverage"]), label);
  if (!Array.isArray(evidence.coverage)) throw new TypeError(`${label}.coverage must be a list`);
  const normalizedCoverage = [...evidence.coverage].map((item) => text(item, `${label}.coverage`)).sort(canonicalTextCompare);
  if (canonicalJson(normalizedCoverage) !== canonicalJson([...coverage].sort(canonicalTextCompare))) throw new TypeError(`${label}.coverage is incomplete`);
  return {
    authority: exact(evidence.authority, authority, `${label}.authority`),
    reference: evidenceReference(evidence.reference, `${label}.reference`),
    sha256: digest(evidence.sha256, `${label}.sha256`),
    coverage: normalizedCoverage,
  };
}

function normalizeAuthorityEvidenceSet(evidence, label) {
  strictObject(evidence, new Set(["build", "cloudflare", "d1Schema", "d1Workflow"]), label);
  return {
    build: normalizeAuthorityEvidence(evidence.build, {
      authority: "github-actions-build-provenance",
      coverage: [
        "bundle", "compiled_plan", "compiler_artifact", "handler_registry", "lockfile", "message_catalog",
        "modules", "release_manifest", "repository", "runtime_identity", "schema_source", "source_revision", "source_tree", "spec",
      ],
    }, `${label}.build`),
    cloudflare: normalizeAuthorityEvidence(evidence.cloudflare, {
      authority: "cloudflare-control-plane-api", coverage: ["bindings", "deployment", "traffic", "version"],
    }, `${label}.cloudflare`),
    d1Schema: normalizeAuthorityEvidence(evidence.d1Schema, {
      authority: "remote-d1-schema-readback", coverage: ["migration", "schema_hash", "tables"],
    }, `${label}.d1Schema`),
    d1Workflow: normalizeAuthorityEvidence(evidence.d1Workflow, {
      authority: "remote-d1-workflow-readback", coverage: ["document", "published_state", "version"],
    }, `${label}.d1Workflow`),
  };
}

function unsignedReleaseManifest(input) {
  strictObject(input, new Set([
    "source", "workflow", "compiledPlan", "artifacts", "expectedBindings", "requiredSchema",
    "deliveryGuards", "effectOwner", "runtimeIdentity", "canonicalization", "createdAt",
  ]), "release manifest input");
  strictObject(input.source, new Set(["repository", "revision", "tree", "lockfile"]), "releaseManifest.source");
  strictObject(input.compiledPlan, new Set([
    "compilerId", "compilerArtifactSha256", "specDigest", "compiledPlanDigest",
    "handlerRegistryDigest", "messageCatalogDigest",
  ]), "releaseManifest.compiledPlan");
  const artifacts = normalizeArtifacts(input.artifacts, "releaseManifest.artifacts");
  const expectedBindings = normalizeBindings(input.expectedBindings, "releaseManifest.expectedBindings");
  const requiredSchema = normalizeSchema(input.requiredSchema, "releaseManifest.requiredSchema");
  const source = {
    repository: exact(input.source.repository, "Eben283/amarimethod-website", "releaseManifest.source.repository"),
    revision: gitSha(input.source.revision, "releaseManifest.source.revision"),
    tree: gitSha(input.source.tree, "releaseManifest.source.tree"),
    lockfile: normalizeLockfile(input.source.lockfile, "releaseManifest.source.lockfile"),
  };
  return {
    releaseManifestVersion: FOLLOW_UP_RELEASE_MANIFEST_VERSION,
    kind: "release-manifest",
    family: FOLLOW_UP_WORKFLOW_ID,
    canonicalization: exact(input.canonicalization, AUTOMATION_TRUTH_CANONICALIZATION_VERSION, "releaseManifest.canonicalization"),
    source,
    runtimeIdentity: normalizeRuntimeIdentity(input.runtimeIdentity, source.revision, "releaseManifest.runtimeIdentity"),
    workflow: normalizeWorkflow(input.workflow, "releaseManifest.workflow"),
    compiledPlan: {
      compilerId: text(input.compiledPlan.compilerId, "releaseManifest.compiledPlan.compilerId"),
      compilerArtifactSha256: digest(input.compiledPlan.compilerArtifactSha256, "releaseManifest.compiledPlan.compilerArtifactSha256"),
      specDigest: digest(input.compiledPlan.specDigest, "releaseManifest.compiledPlan.specDigest"),
      compiledPlanDigest: digest(input.compiledPlan.compiledPlanDigest, "releaseManifest.compiledPlan.compiledPlanDigest"),
      handlerRegistryDigest: digest(input.compiledPlan.handlerRegistryDigest, "releaseManifest.compiledPlan.handlerRegistryDigest"),
      messageCatalogDigest: digest(input.compiledPlan.messageCatalogDigest, "releaseManifest.compiledPlan.messageCatalogDigest"),
    },
    artifacts,
    modulesDigest: null,
    expectedBindings,
    expectedBindingsDigest: null,
    requiredSchema,
    deliveryGuards: normalizeDeliveryGuards(input.deliveryGuards, "releaseManifest.deliveryGuards"),
    effectOwner: normalizeEffectOwner(input.effectOwner, "releaseManifest.effectOwner"),
    createdAt: timestamp(input.createdAt, "releaseManifest.createdAt"),
  };
}

export async function createAttestedReleaseManifest(input) {
  const unsigned = unsignedReleaseManifest(input);
  const reminderDb = unsigned.expectedBindings.find((binding) => binding.name === "REMINDER_DB");
  if (reminderDb?.kind !== "d1" || reminderDb.resourceId !== unsigned.requiredSchema.databaseId) {
    throw new TypeError("releaseManifest REMINDER_DB binding must be the required schema database");
  }
  const approvedSha256 = await sha256("approved");
  for (const name of ["FOLLOW_UP_DELIVERY_RELEASE", "FOLLOW_UP_ASSIGNED_USER_DELIVERY"]) {
    const binding = unsigned.expectedBindings.find((item) => item.name === name);
    if (binding?.kind !== "plain" || binding.valueSha256 !== approvedSha256) {
      throw new TypeError(`releaseManifest ${name} binding must be plain sha256(approved)`);
    }
  }
  for (const [name, value] of [
    ["SOURCE_REVISION", unsigned.source.revision],
    ["WORKER_VERSION", unsigned.runtimeIdentity.workerVersion],
  ]) {
    const binding = unsigned.expectedBindings.find((item) => item.name === name);
    if (binding?.kind !== "plain" || binding.valueSha256 !== await sha256(value)) {
      throw new TypeError(`releaseManifest ${name} binding must be plain sha256(${name === "SOURCE_REVISION" ? "source revision" : "worker version"})`);
    }
  }
  const versionMetadata = unsigned.expectedBindings.find((binding) => binding.name === "CF_VERSION_METADATA");
  if (versionMetadata?.kind !== "version_metadata") throw new TypeError("releaseManifest CF_VERSION_METADATA binding must be version_metadata");
  unsigned.modulesDigest = await sha256(unsigned.artifacts.modules);
  unsigned.expectedBindingsDigest = await sha256(unsigned.expectedBindings);
  const releaseManifestDigest = await sha256(unsigned);
  return deepFreeze({
    ...unsigned,
    releaseManifestId: `relm_${releaseManifestDigest}`,
    releaseManifestDigest,
  });
}

function releaseInputFromManifest(manifest) {
  strictObject(manifest, new Set([
    "releaseManifestVersion", "kind", "family", "canonicalization", "source", "workflow", "compiledPlan", "artifacts", "modulesDigest",
    "expectedBindings", "expectedBindingsDigest", "requiredSchema", "deliveryGuards", "effectOwner",
    "runtimeIdentity", "createdAt", "releaseManifestId", "releaseManifestDigest",
  ]), "releaseManifest");
  if (manifest.releaseManifestVersion !== FOLLOW_UP_RELEASE_MANIFEST_VERSION || manifest.kind !== "release-manifest" || manifest.family !== FOLLOW_UP_WORKFLOW_ID) {
    throw new TypeError("releaseManifest identity is unsupported");
  }
  return {
    source: manifest.source,
    runtimeIdentity: manifest.runtimeIdentity,
    canonicalization: manifest.canonicalization,
    workflow: manifest.workflow,
    compiledPlan: manifest.compiledPlan,
    artifacts: manifest.artifacts,
    expectedBindings: manifest.expectedBindings,
    requiredSchema: manifest.requiredSchema,
    deliveryGuards: manifest.deliveryGuards,
    effectOwner: manifest.effectOwner,
    createdAt: manifest.createdAt,
  };
}

export async function validateAttestedReleaseManifest(manifest) {
  const rebuilt = await createAttestedReleaseManifest(releaseInputFromManifest(manifest));
  if (manifest.expectedBindingsDigest !== rebuilt.expectedBindingsDigest
    || manifest.releaseManifestDigest !== rebuilt.releaseManifestDigest
    || manifest.releaseManifestId !== rebuilt.releaseManifestId) {
    throw new TypeError("releaseManifest digest does not match its canonical content");
  }
  return rebuilt;
}

function normalizeObservedDeployment(observed) {
  strictObject(observed, new Set([
    "platform", "service", "environment", "deploymentId", "versionId", "trafficPercent", "source",
    "artifacts", "bindings", "schema", "workflow", "deliveryGuards", "versionMetadata", "authorityEvidence",
  ]), "deploymentAttestation.observed");
  strictObject(observed.source, new Set(["revision", "tree"]), "deploymentAttestation.observed.source");
  if (observed.trafficPercent !== 100) throw new TypeError("deploymentAttestation.observed.trafficPercent must be 100");
  return {
    platform: exact(observed.platform, "cloudflare", "deploymentAttestation.observed.platform"),
    service: exact(observed.service, "reminder-engine", "deploymentAttestation.observed.service"),
    environment: exact(observed.environment, "production", "deploymentAttestation.observed.environment"),
    deploymentId: text(observed.deploymentId, "deploymentAttestation.observed.deploymentId"),
    versionId: text(observed.versionId, "deploymentAttestation.observed.versionId"),
    trafficPercent: 100,
    source: {
      revision: gitSha(observed.source.revision, "deploymentAttestation.observed.source.revision"),
      tree: gitSha(observed.source.tree, "deploymentAttestation.observed.source.tree"),
    },
    artifacts: normalizeArtifacts(observed.artifacts, "deploymentAttestation.observed.artifacts"),
    bindings: normalizeBindings(observed.bindings, "deploymentAttestation.observed.bindings"),
    schema: normalizeSchema(observed.schema, "deploymentAttestation.observed.schema"),
    workflow: normalizeWorkflow(observed.workflow, "deploymentAttestation.observed.workflow"),
    deliveryGuards: normalizeDeliveryGuards(observed.deliveryGuards, "deploymentAttestation.observed.deliveryGuards"),
    versionMetadata: (() => {
      strictObject(observed.versionMetadata, new Set(["binding", "versionId"]), "deploymentAttestation.observed.versionMetadata");
      const versionMetadata = {
        binding: exact(observed.versionMetadata.binding, "CF_VERSION_METADATA", "deploymentAttestation.observed.versionMetadata.binding"),
        versionId: text(observed.versionMetadata.versionId, "deploymentAttestation.observed.versionMetadata.versionId"),
      };
      if (versionMetadata.versionId !== text(observed.versionId, "deploymentAttestation.observed.versionId")) {
        throw new TypeError("CF_VERSION_METADATA version id must match the observed Cloudflare version");
      }
      return versionMetadata;
    })(),
    authorityEvidence: normalizeAuthorityEvidenceSet(observed.authorityEvidence, "deploymentAttestation.observed.authorityEvidence"),
  };
}

function normalizeDeploymentAttestationPayload(payload) {
  strictObject(payload, new Set([
    "deploymentAttestationVersion", "kind", "releaseManifestId", "releaseManifestDigest", "observed",
    "observedAt", "attestedAt", "expiresAt",
  ]), "deploymentAttestationPayload");
  if (payload.deploymentAttestationVersion !== FOLLOW_UP_DEPLOYMENT_ATTESTATION_VERSION || payload.kind !== "deployment-attestation") {
    throw new TypeError("deploymentAttestationPayload identity is unsupported");
  }
  const observedAt = timestamp(payload.observedAt, "deploymentAttestation.observedAt");
  const attestedAt = timestamp(payload.attestedAt, "deploymentAttestation.attestedAt");
  const expiresAt = timestamp(payload.expiresAt, "deploymentAttestation.expiresAt");
  if (Date.parse(attestedAt) < Date.parse(observedAt) || Date.parse(attestedAt) - Date.parse(observedAt) > MAX_OBSERVATION_AGE_MS) {
    throw new TypeError("deploymentAttestation observation must precede attestation by no more than 5 minutes");
  }
  if (Date.parse(expiresAt) <= Date.parse(attestedAt)) throw new TypeError("deploymentAttestation.expiresAt must be after attestedAt");
  if (Date.parse(expiresAt) - Date.parse(attestedAt) > MAX_ATTESTATION_TTL_MS) throw new TypeError("deploymentAttestation TTL must not exceed 15 minutes");
  return {
    deploymentAttestationVersion: FOLLOW_UP_DEPLOYMENT_ATTESTATION_VERSION,
    kind: "deployment-attestation",
    releaseManifestId: text(payload.releaseManifestId, "deploymentAttestation.releaseManifestId"),
    releaseManifestDigest: digest(payload.releaseManifestDigest, "deploymentAttestation.releaseManifestDigest"),
    observed: normalizeObservedDeployment(payload.observed),
    observedAt,
    attestedAt,
    expiresAt,
  };
}

export async function createDeploymentAttestationPayload({ releaseManifest, observed, observedAt, attestedAt, expiresAt }) {
  const release = await validateAttestedReleaseManifest(releaseManifest);
  const payload = normalizeDeploymentAttestationPayload({
    deploymentAttestationVersion: FOLLOW_UP_DEPLOYMENT_ATTESTATION_VERSION,
    kind: "deployment-attestation",
    releaseManifestId: release.releaseManifestId,
    releaseManifestDigest: release.releaseManifestDigest,
    observed: normalizeObservedDeployment(observed),
    observedAt,
    attestedAt,
    expiresAt,
  });
  if (Date.parse(release.createdAt) > Date.parse(payload.observedAt)) throw new TypeError("release manifest must exist before deployment observation");
  return deepFreeze(payload);
}

export async function deploymentAttestationProblems(releaseManifest, payload) {
  const release = await validateAttestedReleaseManifest(releaseManifest);
  const normalized = normalizeDeploymentAttestationPayload(payload);
  const problems = [];
  if (payload.deploymentAttestationVersion !== normalized.deploymentAttestationVersion || payload.kind !== normalized.kind) problems.push("attestation_contract_mismatch");
  if (payload.releaseManifestId !== release.releaseManifestId || payload.releaseManifestDigest !== release.releaseManifestDigest) problems.push("release_manifest_identity_mismatch");
  if (Date.parse(release.createdAt) > Date.parse(normalized.observedAt)) problems.push("release_created_after_observation");
  if (normalized.observed.source.revision !== release.source.revision || normalized.observed.source.tree !== release.source.tree) problems.push("source_identity_mismatch");
  if (canonicalJson(normalized.observed.artifacts) !== canonicalJson(release.artifacts)) problems.push("artifact_identity_mismatch");
  if (await sha256(normalized.observed.artifacts.modules) !== release.modulesDigest) problems.push("modules_catalog_mismatch");
  if (await sha256(normalized.observed.bindings) !== release.expectedBindingsDigest
    || canonicalJson(normalized.observed.bindings) !== canonicalJson(release.expectedBindings)) problems.push("binding_manifest_mismatch");
  if (canonicalJson(normalized.observed.schema) !== canonicalJson(release.requiredSchema)) problems.push("schema_identity_mismatch");
  if (canonicalJson(normalized.observed.workflow) !== canonicalJson(release.workflow)) problems.push("workflow_document_identity_mismatch");
  if (canonicalJson(normalized.observed.deliveryGuards) !== canonicalJson(release.deliveryGuards)) problems.push("delivery_guard_mismatch");
  return [...new Set(problems)].sort(canonicalTextCompare);
}

function bytes(value) { return typeof value === "string" ? new TextEncoder().encode(value) : value; }
function hex(value) { return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function unhex(value, label) {
  const normalized = text(value, label).toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(normalized)) throw new TypeError(`${label} must be a 64-byte Ed25519 signature`);
  return Uint8Array.from(normalized.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}
function keyId(value, label) {
  const normalized = text(value, label);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new TypeError(`${label} must be an opaque rotation id`);
  return normalized;
}

function unsignedEnvelope({ payload, payloadDigest, keyId }) {
  return {
    envelopeVersion: AUTHENTICATED_ATTESTATION_ENVELOPE_VERSION,
    payloadDigest,
    payload,
    authentication: { method: "ed25519", keyId },
  };
}

/** External-attestor helper. The private key must never be bound to the reminder Worker. */
export async function signDeploymentAttestationEnvelope(payload, { keyId: signingKeyId, privateKey }) {
  const normalizedPayload = normalizeDeploymentAttestationPayload(payload);
  if (!(privateKey instanceof CryptoKey) || privateKey.type !== "private" || privateKey.algorithm?.name !== "Ed25519") {
    throw new TypeError("an Ed25519 private CryptoKey is required");
  }
  const payloadDigest = await sha256(normalizedPayload);
  const unsigned = unsignedEnvelope({ payload: normalizedPayload, payloadDigest, keyId: keyId(signingKeyId, "authentication.keyId") });
  const signature = hex(await crypto.subtle.sign("Ed25519", privateKey, bytes(canonicalJson(unsigned))));
  const deploymentAttestationId = `depatt_${payloadDigest}`;
  return deepFreeze({ ...unsigned, deploymentAttestationId, authentication: { ...unsigned.authentication, signature } });
}

function attestationFreshness(payload, now) {
  const normalizedNow = timestamp(now, "attestation verification now");
  const nowMs = Date.parse(normalizedNow);
  if (Date.parse(payload.observedAt) > nowMs + MAX_FUTURE_CLOCK_SKEW_MS || Date.parse(payload.attestedAt) > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return { status: "Unknown", reason: "attestation_future_clock_skew", checkedAt: normalizedNow };
  }
  if (nowMs >= Date.parse(payload.expiresAt)) return { status: "Unknown", reason: "attestation_expired", checkedAt: normalizedNow };
  return { status: "Fresh", reason: "authenticated_and_in_window", checkedAt: normalizedNow };
}

export async function verifyDeploymentAttestationEnvelope({ releaseManifest, envelope, keyring, now }) {
  strictObject(envelope, new Set(["envelopeVersion", "payloadDigest", "payload", "deploymentAttestationId", "authentication"]), "attestationEnvelope");
  strictObject(envelope.authentication, new Set(["method", "keyId", "signature"]), "attestationEnvelope.authentication");
  if (envelope.envelopeVersion !== AUTHENTICATED_ATTESTATION_ENVELOPE_VERSION || envelope.authentication.method !== "ed25519") {
    throw new TypeError("attestation envelope authentication contract is unsupported");
  }
  const normalizedPayload = normalizeDeploymentAttestationPayload(envelope.payload);
  const payloadDigest = await sha256(normalizedPayload);
  if (envelope.payloadDigest !== payloadDigest || envelope.deploymentAttestationId !== `depatt_${payloadDigest}`) {
    throw new TypeError("attestation envelope payload digest does not match its canonical content");
  }
  if (!Array.isArray(keyring) || !keyring.length) throw new TypeError("an allowlisted Ed25519 public-key ring is required");
  const requestedKeyId = keyId(envelope.authentication.keyId, "attestationEnvelope.authentication.keyId");
  const normalizedKeyring = keyring.map((candidate, index) => {
    strictObject(candidate, new Set(["keyId", "publicKey", "validFrom", "validUntil"]), `attestation keyring[${index}]`);
    const normalizedKeyId = keyId(candidate.keyId, `attestation keyring[${index}].keyId`);
    if (!(candidate.publicKey instanceof CryptoKey) || candidate.publicKey.type !== "public" || candidate.publicKey.algorithm?.name !== "Ed25519") {
      throw new TypeError("attestation keyring entry requires an Ed25519 public CryptoKey");
    }
    const validFrom = timestamp(candidate.validFrom, `attestation keyring[${index}].validFrom`);
    const validUntil = timestamp(candidate.validUntil, `attestation keyring[${index}].validUntil`);
    if (Date.parse(validUntil) <= Date.parse(validFrom)) throw new TypeError("attestation keyring validity window is invalid");
    return { keyId: normalizedKeyId, publicKey: candidate.publicKey, validFrom, validUntil };
  });
  if (new Set(normalizedKeyring.map((candidate) => candidate.keyId)).size !== normalizedKeyring.length) {
    throw new TypeError("attestation keyring contains duplicate key ids");
  }
  const entry = normalizedKeyring.find((candidate) => candidate.keyId === requestedKeyId);
  if (!entry) throw new TypeError("attestation envelope key is not allowlisted");
  if (Date.parse(normalizedPayload.attestedAt) < Date.parse(entry.validFrom) || Date.parse(normalizedPayload.attestedAt) >= Date.parse(entry.validUntil)) {
    throw new TypeError("attestation envelope key was not valid when signed");
  }
  const unsigned = unsignedEnvelope({ payload: normalizedPayload, payloadDigest, keyId: requestedKeyId });
  const verified = await crypto.subtle.verify("Ed25519", entry.publicKey, unhex(envelope.authentication.signature, "attestationEnvelope.authentication.signature"), bytes(canonicalJson(unsigned)));
  if (!verified) throw new TypeError("attestation envelope authentication failed");
  const problems = await deploymentAttestationProblems(releaseManifest, normalizedPayload);
  const authenticatedEnvelope = deepFreeze({
    ...unsigned,
    deploymentAttestationId: envelope.deploymentAttestationId,
    authentication: { ...unsigned.authentication, signature: envelope.authentication.signature.toLowerCase() },
  });
  return deepFreeze({
    releaseManifest: await validateAttestedReleaseManifest(releaseManifest),
    envelope: authenticatedEnvelope,
    authenticity: "verified",
    freshness: attestationFreshness(normalizedPayload, now),
    problems,
  });
}

/**
 * Source-only projection. Even a fresh authenticated match remains Unknown
 * until a separately approved runtime recorder binds an ordinary source event.
 */
export function projectAuthenticatedDeploymentTruth(verification) {
  if (!verification || verification.authenticity !== "verified") {
    return deepFreeze({ status: "Unknown", reasonCodes: ["authenticated_attestation_missing"] });
  }
  if (verification.problems?.length) {
    return deepFreeze({ status: "Broken", reasonCodes: [...verification.problems].sort(canonicalTextCompare), authority: "authenticated_external_attestor" });
  }
  if (verification.freshness?.status !== "Fresh") {
    return deepFreeze({ status: "Unknown", reasonCodes: [verification.freshness?.reason || "attestation_freshness_unknown"], authority: "authenticated_external_attestor" });
  }
  return deepFreeze({ status: "Unknown", reasonCodes: ["runtime_recorder_not_adopted"], authority: "authenticated_external_attestor" });
}
