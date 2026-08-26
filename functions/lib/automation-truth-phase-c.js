/**
 * Phase C turns a control-plane/runtime/D1 readback into a canonical evidence
 * object. It is pure: callers supply observations; this module does not fetch
 * Cloudflare, D1, GHL, or Staff, and it never writes a record.
 */
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";

export const DEPLOYMENT_READBACK_VERSION = "deployment-readback.v1";

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}
function digest(value, label) {
  const result = text(value, label).replace(/^sha256:/, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError(`${label} must be a SHA-256 digest`);
  return result;
}
function shaOrNull(value, label) {
  return value === null ? null : digest(value, label);
}
function gitRevision(value, label) {
  const result = text(value, label).toLowerCase();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result)) throw new TypeError(`${label} must be a Git SHA`);
  return result;
}
function timestamp(value, label) {
  const result = text(value, label);
  if (Number.isNaN(Date.parse(result))) throw new TypeError(`${label} must be RFC3339`);
  return result;
}
function strictKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
}
function requiredKeys(value, keys, label) {
  strictKeys(value, keys, label);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizeBinding(binding, label) {
  strictKeys(binding, new Set(["name", "kind", "resourceId", "service", "environment", "valueSha256", "present"]), label);
  const name = text(binding.name, `${label}.name`);
  const kind = text(binding.kind, `${label}.kind`);
  if (!new Set(["d1", "kv", "service", "plain", "secret"]).has(kind)) throw new TypeError(`${label}.kind is unsupported`);
  const allowed = new Set(["name", "kind"]);
  if (kind === "d1" || kind === "kv") allowed.add("resourceId");
  if (kind === "service") { allowed.add("service"); allowed.add("environment"); }
  if (kind === "plain") allowed.add("valueSha256");
  if (kind === "secret") allowed.add("present");
  strictKeys(binding, allowed, label);
  const result = { name, kind };
  if (kind === "d1" || kind === "kv") result.resourceId = text(binding.resourceId, `${label}.resourceId`);
  if (kind === "service") {
    result.service = text(binding.service, `${label}.service`);
    result.environment = text(binding.environment, `${label}.environment`);
  }
  if (kind === "plain") result.valueSha256 = digest(binding.valueSha256, `${label}.valueSha256`);
  if (kind === "secret") {
    if (typeof binding.present !== "boolean") throw new TypeError(`${label}.present must be boolean`);
    result.present = binding.present;
  }
  return result;
}

function normalizeBindings(entries, label) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError(`${label} must be a non-empty list`);
  const normalized = entries.map((entry, index) => normalizeBinding(entry, `${label}[${index}]`));
  normalized.sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length) throw new TypeError(`${label} has duplicate names`);
  return normalized;
}

function normalizeSchema(schema) {
  requiredKeys(schema, new Set(["databaseId", "expectedHead", "remoteHead", "expectedTables", "observedTables"]), "schema");
  const head = (value, label, sourceRequired) => {
    requiredKeys(value, new Set(["migrationId", "version", "sourceSha256"]), label);
    if (!Number.isInteger(value.version) || value.version < 1) throw new TypeError(`${label}.version must be positive integer`);
    return {
      migrationId: text(value.migrationId, `${label}.migrationId`), version: value.version,
      sourceSha256: sourceRequired ? digest(value.sourceSha256, `${label}.sourceSha256`) : shaOrNull(value.sourceSha256, `${label}.sourceSha256`),
    };
  };
  const names = (value, label) => {
    if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string" && item.trim())) throw new TypeError(`${label} must be a non-empty string list`);
    const result = [...value].map((item) => item.trim()).sort();
    if (new Set(result).size !== result.length) throw new TypeError(`${label} has duplicates`);
    return result;
  };
  return {
    databaseId: text(schema.databaseId, "schema.databaseId"),
    expectedHead: head(schema.expectedHead, "schema.expectedHead", true),
    remoteHead: head(schema.remoteHead, "schema.remoteHead", false),
    expectedTables: names(schema.expectedTables, "schema.expectedTables"),
    observedTables: names(schema.observedTables, "schema.observedTables"),
  };
}

function normalizeInput(input) {
  requiredKeys(input, new Set(["observedAt", "expiresAt", "controlPlane", "runtime", "build", "bindings", "schema", "phaseB"]), "deployment readback");
  requiredKeys(input.controlPlane, new Set(["service", "deploymentId", "versionId", "trafficPercent", "scriptEtag", "source"]), "controlPlane");
  requiredKeys(input.runtime, new Set(["sourceRevision", "bundleSha256", "workerVersion", "phaseBImported"]), "runtime");
  requiredKeys(input.build, new Set(["cleanBuildSha256", "lockfileSha256", "compilerArtifactSha256", "compiledPlanDigest", "handlerArtifactSha256", "messageArtifactSha256", "bundleSha256"]), "build");
  requiredKeys(input.bindings, new Set(["expected", "observed"]), "bindings");
  requiredKeys(input.phaseB, new Set(["compilerArtifactSha256", "compiledPlanDigest", "releaseManifestDigest", "runtimeReference"]), "phaseB");
  if (!Number.isInteger(input.controlPlane.trafficPercent) || input.controlPlane.trafficPercent < 0 || input.controlPlane.trafficPercent > 100) throw new TypeError("controlPlane.trafficPercent must be 0..100");
  const source = text(input.controlPlane.source, "controlPlane.source");
  if (!new Set(["git", "version_upload"]).has(source)) throw new TypeError("controlPlane.source is unsupported");
  if (typeof input.runtime.phaseBImported !== "boolean" || typeof input.phaseB.runtimeReference !== "boolean") throw new TypeError("runtime phase B fields must be boolean");
  const result = {
    deploymentReadbackVersion: DEPLOYMENT_READBACK_VERSION,
    kind: "observed",
    observedAt: timestamp(input.observedAt, "observedAt"),
    expiresAt: timestamp(input.expiresAt, "expiresAt"),
    controlPlane: {
      service: text(input.controlPlane.service, "controlPlane.service"),
      deploymentId: text(input.controlPlane.deploymentId, "controlPlane.deploymentId"),
      versionId: text(input.controlPlane.versionId, "controlPlane.versionId"),
      trafficPercent: input.controlPlane.trafficPercent,
      scriptEtag: digest(input.controlPlane.scriptEtag, "controlPlane.scriptEtag"), source,
    },
    runtime: {
      sourceRevision: gitRevision(input.runtime.sourceRevision, "runtime.sourceRevision"),
      bundleSha256: digest(input.runtime.bundleSha256, "runtime.bundleSha256"),
      workerVersion: digest(input.runtime.workerVersion, "runtime.workerVersion"),
      phaseBImported: input.runtime.phaseBImported,
    },
    build: Object.fromEntries(Object.entries(input.build).map(([key, value]) => [key, shaOrNull(value, `build.${key}`)])),
    bindings: { expected: normalizeBindings(input.bindings.expected, "bindings.expected"), observed: normalizeBindings(input.bindings.observed, "bindings.observed") },
    schema: normalizeSchema(input.schema),
    phaseB: {
      compilerArtifactSha256: digest(input.phaseB.compilerArtifactSha256, "phaseB.compilerArtifactSha256"),
      compiledPlanDigest: digest(input.phaseB.compiledPlanDigest, "phaseB.compiledPlanDigest"),
      releaseManifestDigest: digest(input.phaseB.releaseManifestDigest, "phaseB.releaseManifestDigest"),
      runtimeReference: input.phaseB.runtimeReference,
    },
  };
  if (Date.parse(result.expiresAt) <= Date.parse(result.observedAt)) throw new TypeError("expiresAt must be after observedAt");
  return result;
}

export async function createObservedDeploymentReadback(input) {
  const unsigned = normalizeInput(input);
  return deepFreeze({ ...unsigned, deploymentReadbackDigest: await sha256(unsigned) });
}

function unsignedFrom(readback) {
  requiredKeys(readback, new Set(["deploymentReadbackVersion", "kind", "observedAt", "expiresAt", "controlPlane", "runtime", "build", "bindings", "schema", "phaseB", "deploymentReadbackDigest"]), "deploymentReadback");
  const { deploymentReadbackVersion, kind, deploymentReadbackDigest, ...input } = readback;
  return { deploymentReadbackVersion, kind, deploymentReadbackDigest, input };
}

/**
 * Fail-closed projection for a future Staff reader. It intentionally returns
 * only Unknown or Broken in Phase C: a fixture/readback is never a live claim.
 */
export async function projectDeploymentTruth({ readback, now = new Date().toISOString() }) {
  let tagged;
  let unsigned;
  try { tagged = unsignedFrom(readback); } catch {
    return deepFreeze({ status: "Unknown", reasonCodes: ["deployment_readback_missing_or_invalid"] });
  }
  if (tagged.deploymentReadbackVersion !== DEPLOYMENT_READBACK_VERSION || tagged.kind !== "observed") return deepFreeze({ status: "Unknown", reasonCodes: ["deployment_readback_not_observed"] });
  try { unsigned = normalizeInput(tagged.input); } catch {
    return deepFreeze({ status: "Broken", reasonCodes: ["deployment_readback_shape_mismatch"] });
  }
  if (typeof tagged.deploymentReadbackDigest !== "string" || tagged.deploymentReadbackDigest !== await sha256(unsigned)) return deepFreeze({ status: "Broken", reasonCodes: ["deployment_readback_digest_mismatch"] });
  const broken = [];
  const unknown = [];
  if (unsigned.runtime.workerVersion !== unsigned.runtime.bundleSha256 || (unsigned.build.bundleSha256 !== null && unsigned.build.bundleSha256 !== unsigned.runtime.bundleSha256)) broken.push("runtime_bundle_identity_mismatch");
  if (canonicalJson(unsigned.bindings.expected) !== canonicalJson(unsigned.bindings.observed)) broken.push("binding_parity_mismatch");
  const reminderDb = unsigned.bindings.observed.find((binding) => binding.name === "REMINDER_DB");
  if (!reminderDb || reminderDb.kind !== "d1" || reminderDb.resourceId !== unsigned.schema.databaseId) broken.push("schema_binding_mismatch");
  if (unsigned.schema.remoteHead.migrationId !== unsigned.schema.expectedHead.migrationId || unsigned.schema.remoteHead.version !== unsigned.schema.expectedHead.version) broken.push("remote_schema_head_mismatch");
  if (unsigned.schema.remoteHead.sourceSha256 && unsigned.schema.remoteHead.sourceSha256 !== unsigned.schema.expectedHead.sourceSha256) broken.push("remote_schema_hash_mismatch");
  if (Date.parse(now) > Date.parse(unsigned.expiresAt)) unknown.push("deployment_readback_expired");
  if (unsigned.controlPlane.source !== "git") unknown.push("control_plane_source_revision_unattested");
  if (unsigned.schema.remoteHead.sourceSha256 === null) unknown.push("remote_schema_hash_unobserved");
  if (canonicalJson(unsigned.schema.expectedTables) !== canonicalJson(unsigned.schema.observedTables)) unknown.push("remote_schema_coverage_incomplete");
  for (const [key, value] of Object.entries(unsigned.build)) if (value === null) unknown.push(`build_${key}_unattested`);
  if (!unsigned.runtime.phaseBImported || !unsigned.phaseB.runtimeReference) unknown.push("phase_b_runtime_reference_missing");
  if (broken.length) return deepFreeze({ status: "Broken", reasonCodes: broken.sort(), observedAt: unsigned.observedAt, expiresAt: unsigned.expiresAt });
  return deepFreeze({
    status: "Unknown", reasonCodes: [...new Set([...unknown, "observed_readback_not_runtime_attestation"])].sort(),
    observedAt: unsigned.observedAt, expiresAt: unsigned.expiresAt,
    identity: { service: unsigned.controlPlane.service, versionId: unsigned.controlPlane.versionId, deploymentId: unsigned.controlPlane.deploymentId, runtimeSourceRevision: unsigned.runtime.sourceRevision },
  });
}
