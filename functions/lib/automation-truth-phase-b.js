/**
 * Phase B is a pure compiler/provenance proof.  Nothing in this module is a
 * Worker entrypoint, a D1 adapter, or a Staff import.  A future, separately
 * approved release may consume these objects only after it proves the runtime
 * bindings that this module deliberately does not create.
 */
import {
  deriveHealth,
  validateEffectOwnership,
  validateTruthEnvelope,
  validateWorkflowSpec,
} from "./automation-truth-contract.js";

export const COMPILER_ID = "amari-automation-truth-compiler.v1";
export const COMPILED_PLAN_VERSION = "compiled-plan.v1";
export const RELEASE_MANIFEST_VERSION = "release-manifest.v1";
export const DEPLOYMENT_FIXTURE_VERSION = "deployment-record-fixture.v1";
export const NODE_PROVENANCE_VERSION = "node-provenance.v1";

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function digest(value, label) {
  const result = text(value, label).replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return result.toLowerCase();
}

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function strictKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function uniqueSorted(values, label) {
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string" && value.trim())) {
    throw new TypeError(`${label} must be a string list`);
  }
  const sorted = [...values].map((value) => value.trim()).sort();
  if (new Set(sorted).size !== sorted.length) throw new TypeError(`${label} must not contain duplicates`);
  return sorted;
}

/** A deterministic JSON value. Object and Map insertion order cannot affect it. */
export function canonicalize(value, stack = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical values cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError("canonical values must be JSON-compatible");
  }
  if (stack.has(value)) throw new TypeError("canonical values cannot contain cycles");
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, stack));
    if (value instanceof Map) {
      const entries = [...value.entries()].map(([key, item]) => [canonicalJson(key), canonicalize(item, stack)]);
      entries.sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(entries);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("canonical values must be plain objects, arrays, or Maps");
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], stack)]));
  } finally {
    stack.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedNode(node) {
  const result = { id: node.id, kind: node.kind };
  for (const key of ["handler", "responsibility", "branchCoverage", "messageRef", "at", "skipIfPast"]) {
    if (node[key] !== undefined) result[key] = node[key];
  }
  if (node.predicate !== undefined) result.predicate = {
    field: node.predicate.field,
    operator: node.predicate.operator,
    values: uniqueSorted(node.predicate.values, "WorkflowSpec.node.predicate.values"),
  };
  if (node.expectedEvidence !== undefined) {
    result.expectedEvidence = node.expectedEvidence
      .map((evidence) => ({ id: evidence.id, authority: evidence.authority }))
      .sort((left, right) => left.id.localeCompare(right.id) || left.authority.localeCompare(right.authority));
  }
  return result;
}

/**
 * Validate the Phase A WorkflowSpec, then normalize it into a stable immutable
 * plan. Array order that has graph meaning is made explicit by IDs/priorities;
 * arbitrary source ordering therefore cannot change the plan digest.
 */
export async function compileWorkflowSpec(spec, { allowedResponsibilities } = {}) {
  validateWorkflowSpec(spec, { allowedResponsibilities });
  const normalizedSpec = {
    workflowId: spec.workflowId,
    version: spec.version,
    handlers: uniqueSorted(spec.handlers, "WorkflowSpec.handlers"),
    entryNodeIds: uniqueSorted(spec.entryNodeIds, "WorkflowSpec.entryNodeIds"),
    exitNodeIds: uniqueSorted(spec.exitNodeIds, "WorkflowSpec.exitNodeIds"),
    nodes: spec.nodes.map(normalizedNode).sort((left, right) => left.id.localeCompare(right.id)),
    edges: spec.edges
      .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, condition: edge.condition, priority: edge.priority }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.priority - right.priority || left.id.localeCompare(right.id)),
  };
  // The Phase A WorkflowSpec itself is the closed authority. Its canonical
  // digest includes validated timing, past-time, and predicate fields.
  const specDigest = await sha256(normalizedSpec);
  const planNodes = normalizedSpec.nodes.map((node) => ({
    ...node,
    next: normalizedSpec.edges.filter((edge) => edge.from === node.id)
      .map(({ id, to, condition, priority }) => ({ id, to, condition, priority })),
  }));
  const unsignedPlan = {
    compiledPlanVersion: COMPILED_PLAN_VERSION,
    compilerId: COMPILER_ID,
    workflowId: normalizedSpec.workflowId,
    workflowVersion: normalizedSpec.version,
    specDigest,
    entryNodeIds: normalizedSpec.entryNodeIds,
    exitNodeIds: normalizedSpec.exitNodeIds,
    handlers: normalizedSpec.handlers,
    nodes: planNodes,
  };
  return deepFreeze({ ...unsignedPlan, compiledPlanDigest: await sha256(unsignedPlan) });
}

function digestCatalog(value, expectedKeys, label) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value || {});
  const supplied = new Map(entries.map(([key, item]) => [text(key, `${label} key`), digest(item, `${label}.${key}`)]));
  const expected = uniqueSorted(expectedKeys, `expected ${label}`);
  if (supplied.size !== expected.length || expected.some((key) => !supplied.has(key))) {
    throw new TypeError(`${label} must bind every required artifact and no others`);
  }
  return Object.fromEntries([...supplied.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function digestArtifactCatalog(value, expectedKeys, label) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value || {});
  const supplied = new Map(entries.map(([key, item]) => [text(key, `${label} key`), item]));
  const expected = uniqueSorted(expectedKeys, `expected ${label}`);
  if (supplied.size !== expected.length || expected.some((key) => !supplied.has(key))) {
    throw new TypeError(`${label} must bind every required artifact and no others`);
  }
  const output = {};
  for (const key of expected) output[key] = await sha256(supplied.get(key));
  return output;
}

function unsignedPlanFrom(plan) {
  strictKeys(plan, new Set(["compiledPlanVersion", "compilerId", "workflowId", "workflowVersion", "specDigest", "entryNodeIds", "exitNodeIds", "handlers", "nodes", "compiledPlanDigest"]), "compiledPlan");
  return {
    compiledPlanVersion: plan.compiledPlanVersion, compilerId: plan.compilerId,
    workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
    specDigest: plan.specDigest, entryNodeIds: plan.entryNodeIds,
    exitNodeIds: plan.exitNodeIds, handlers: plan.handlers, nodes: plan.nodes,
  };
}

/** Binds pure artifacts to a compiled plan. It does not claim deployment. */
export async function createReleaseManifest({ compiledPlan, compilerArtifactDigest, handlerArtifactDigests, messageArtifacts, effectOwnership }) {
  if (!compiledPlan || compiledPlan.compiledPlanVersion !== COMPILED_PLAN_VERSION) throw new TypeError("a compiled Phase B plan is required");
  if (compiledPlan.compiledPlanDigest !== await sha256(unsignedPlanFrom(compiledPlan))) throw new TypeError("compiled plan digest does not match its content");
  const ownership = validateEffectOwnership(effectOwnership);
  const owners = new Set(ownership.map((entry) => entry.responsibility));
  for (const node of compiledPlan.nodes.filter((node) => node.kind === "effect")) {
    if (!owners.has(node.responsibility)) throw new TypeError(`effect responsibility has no ownership record: ${node.responsibility}`);
  }
  const messageRefs = compiledPlan.nodes.filter((node) => node.messageRef).map((node) => node.messageRef);
  const unsignedManifest = {
    releaseManifestVersion: RELEASE_MANIFEST_VERSION,
    kind: "fixture",
    attestation: "unattested",
    compilerId: compiledPlan.compilerId,
    compilerArtifactDigest: digest(compilerArtifactDigest, "compilerArtifactDigest"),
    workflowId: compiledPlan.workflowId,
    workflowVersion: compiledPlan.workflowVersion,
    specDigest: digest(compiledPlan.specDigest, "compiledPlan.specDigest"),
    compiledPlanDigest: digest(compiledPlan.compiledPlanDigest, "compiledPlan.compiledPlanDigest"),
    handlerArtifactDigests: digestCatalog(handlerArtifactDigests, compiledPlan.handlers, "handlerArtifactDigests"),
    messageArtifactDigests: await digestArtifactCatalog(messageArtifacts, messageRefs, "messageArtifacts"),
    effectOwnership: ownership.map((entry) => ({ ...entry })).sort((left, right) => left.responsibility.localeCompare(right.responsibility) || left.owner.localeCompare(right.owner)),
  };
  return deepFreeze({ ...unsignedManifest, releaseManifestDigest: await sha256(unsignedManifest) });
}

/** A fixture identity only. `kind: fixture` prevents a caller from mistaking this for control-plane evidence. */
export async function createDeploymentRecordFixture({ releaseManifest, deploymentId, runtimeVersion, d1SchemaHead }) {
  if (!releaseManifest?.releaseManifestDigest) throw new TypeError("releaseManifest is required");
  if (!d1SchemaHead || typeof d1SchemaHead !== "object") throw new TypeError("d1SchemaHead is required");
  const schema = {
    migrationId: text(d1SchemaHead.migrationId, "d1SchemaHead.migrationId"),
    version: integer(d1SchemaHead.version, "d1SchemaHead.version"),
    sourceSha256: digest(d1SchemaHead.sourceSha256, "d1SchemaHead.sourceSha256"),
  };
  const unsignedRecord = {
    deploymentRecordVersion: DEPLOYMENT_FIXTURE_VERSION,
    kind: "fixture",
    deployed: false,
    deploymentId: text(deploymentId, "deploymentId"),
    runtimeVersion: text(runtimeVersion, "runtimeVersion"),
    releaseManifestDigest: digest(releaseManifest.releaseManifestDigest, "releaseManifest.releaseManifestDigest"),
    d1SchemaHead: schema,
  };
  return deepFreeze({ ...unsignedRecord, deploymentRecordDigest: await sha256(unsignedRecord) });
}

export async function createInvocationIdentityFixture({ deploymentRecord, invocationId, sourceEventId }) {
  if (!deploymentRecord?.deploymentRecordDigest || deploymentRecord.kind !== "fixture" || deploymentRecord.deployed !== false) {
    throw new TypeError("a non-deployed fixture deployment record is required");
  }
  const unsignedIdentity = {
    invocationIdentityVersion: "invocation-identity-fixture.v1",
    kind: "fixture",
    invocationId: text(invocationId, "invocationId"),
    sourceEventId: text(sourceEventId, "sourceEventId"),
    deploymentRecordDigest: digest(deploymentRecord.deploymentRecordDigest, "deploymentRecord.deploymentRecordDigest"),
    releaseManifestDigest: digest(deploymentRecord.releaseManifestDigest, "deploymentRecord.releaseManifestDigest"),
    runtimeVersion: deploymentRecord.runtimeVersion,
    d1SchemaHead: deploymentRecord.d1SchemaHead,
  };
  return deepFreeze({ ...unsignedIdentity, invocationIdentityDigest: await sha256(unsignedIdentity) });
}

/**
 * Proposed additive values for existing reliability-spine records. This is a
 * payload shape, not a write adapter or a schema migration.
 */
export function createNodeProvenancePayload({ compiledPlan, lifecycleInstanceId, obligationId, commandAttemptId, providerReceiptId, exceptionId, nodeId, occurredAt }) {
  if (!compiledPlan?.compiledPlanDigest) throw new TypeError("compiledPlan is required");
  const node = compiledPlan.nodes.find((item) => item.id === nodeId);
  if (!node) throw new TypeError("nodeId is not in compiledPlan");
  const lifecycleId = text(lifecycleInstanceId, "lifecycleInstanceId");
  const at = integer(occurredAt, "occurredAt");
  const provenance = deepFreeze({
    nodeProvenanceVersion: NODE_PROVENANCE_VERSION,
    compiled_plan_digest: digest(compiledPlan.compiledPlanDigest, "compiledPlan.compiledPlanDigest"),
    workflow_id: compiledPlan.workflowId,
    workflow_version: compiledPlan.workflowVersion,
    node_id: node.id,
    node_kind: node.kind,
  });
  return deepFreeze({
    lifecycle_instance_extension: { lifecycle_instance_id: lifecycleId, provenance },
    lifecycle_node_transition: { lifecycle_instance_id: lifecycleId, node_id: node.id, occurred_at: at, provenance, append_only: true },
    obligation_extension: obligationId ? { obligation_id: text(obligationId, "obligationId"), lifecycle_instance_id: lifecycleId, provenance } : null,
    command_attempt_extension: commandAttemptId ? { command_attempt_id: text(commandAttemptId, "commandAttemptId"), lifecycle_instance_id: lifecycleId, provenance } : null,
    provider_receipt_extension: providerReceiptId ? { provider_receipt_id: text(providerReceiptId, "providerReceiptId"), lifecycle_instance_id: lifecycleId, provenance } : null,
    exception_extension: exceptionId ? { exception_id: text(exceptionId, "exceptionId"), lifecycle_instance_id: lifecycleId, provenance } : null,
  });
}

/** An ambiguous timeout is never automatically reclassified as a provider failure or success. */
export function classifyCommandOutcome({ providerOutcome, leaseFence, expectedFence }) {
  if (leaseFence !== expectedFence) return deepFreeze({ state: "blocked", reason: "lease_fence_mismatch", sideEffectAllowed: false });
  if (!["accepted", "failed_retryable", "failed_terminal", "timeout", "ambiguous"].includes(providerOutcome)) {
    throw new TypeError("unknown provider outcome");
  }
  if (providerOutcome === "timeout" || providerOutcome === "ambiguous") {
    return deepFreeze({ state: "ambiguous", reason: "provider_outcome_unproven", sideEffectAllowed: false, requiresReconciliation: true });
  }
  return deepFreeze({ state: providerOutcome, reason: null, sideEffectAllowed: providerOutcome === "failed_retryable" });
}

/** Exact replays do not allocate a second command; mismatched provenance is a safety violation. */
export function classifyReplay({ existingInvocation, candidateInvocation }) {
  if (!existingInvocation) return deepFreeze({ state: "new", sideEffectAllowed: false });
  if (existingInvocation.sourceEventId !== candidateInvocation.sourceEventId) return deepFreeze({ state: "new", sideEffectAllowed: false });
  if (existingInvocation.releaseManifestDigest !== candidateInvocation.releaseManifestDigest || existingInvocation.deploymentRecordDigest !== candidateInvocation.deploymentRecordDigest) {
    return deepFreeze({ state: "broken", reason: "replay_provenance_mismatch", safetyViolation: true, sideEffectAllowed: false });
  }
  return deepFreeze({ state: "duplicate", reason: "exact_replay", sideEffectAllowed: false });
}

/**
 * Pure read-model proof. It has no Staff import and refuses an optimistic status
 * when any control- or data-plane authority cannot be proven from its inputs.
 */
function unsignedManifestFrom(manifest) {
  strictKeys(manifest, new Set(["releaseManifestVersion", "kind", "attestation", "compilerId", "compilerArtifactDigest", "workflowId", "workflowVersion", "specDigest", "compiledPlanDigest", "handlerArtifactDigests", "messageArtifactDigests", "effectOwnership", "releaseManifestDigest"]), "releaseManifest");
  return {
    releaseManifestVersion: manifest.releaseManifestVersion, kind: manifest.kind, attestation: manifest.attestation,
    compilerId: manifest.compilerId, compilerArtifactDigest: manifest.compilerArtifactDigest,
    workflowId: manifest.workflowId, workflowVersion: manifest.workflowVersion, specDigest: manifest.specDigest,
    compiledPlanDigest: manifest.compiledPlanDigest, handlerArtifactDigests: manifest.handlerArtifactDigests,
    messageArtifactDigests: manifest.messageArtifactDigests, effectOwnership: manifest.effectOwnership,
  };
}

function unsignedDeploymentFrom(record) {
  strictKeys(record, new Set(["deploymentRecordVersion", "kind", "deployed", "deploymentId", "runtimeVersion", "releaseManifestDigest", "d1SchemaHead", "deploymentRecordDigest"]), "deploymentRecord");
  return {
    deploymentRecordVersion: record.deploymentRecordVersion, kind: record.kind, deployed: record.deployed,
    deploymentId: record.deploymentId, runtimeVersion: record.runtimeVersion,
    releaseManifestDigest: record.releaseManifestDigest, d1SchemaHead: record.d1SchemaHead,
  };
}

function unsignedInvocationFrom(identity) {
  strictKeys(identity, new Set(["invocationIdentityVersion", "kind", "invocationId", "sourceEventId", "deploymentRecordDigest", "releaseManifestDigest", "runtimeVersion", "d1SchemaHead", "invocationIdentityDigest"]), "invocationIdentity");
  return {
    invocationIdentityVersion: identity.invocationIdentityVersion, kind: identity.kind,
    invocationId: identity.invocationId, sourceEventId: identity.sourceEventId,
    deploymentRecordDigest: identity.deploymentRecordDigest, releaseManifestDigest: identity.releaseManifestDigest,
    runtimeVersion: identity.runtimeVersion, d1SchemaHead: identity.d1SchemaHead,
  };
}

function assertSchemaHead(schema, label) {
  strictKeys(schema, new Set(["migrationId", "version", "sourceSha256"]), label);
  text(schema.migrationId, `${label}.migrationId`);
  integer(schema.version, `${label}.version`);
  digest(schema.sourceSha256, `${label}.sourceSha256`);
}

function assertDigestValues(record, label) {
  strictKeys(record, new Set(Object.keys(record)), label);
  for (const [key, value] of Object.entries(record)) digest(value, `${label}.${key}`);
}

function assertManifestShape(manifest) {
  const unsigned = unsignedManifestFrom(manifest);
  if (unsigned.releaseManifestVersion !== RELEASE_MANIFEST_VERSION || unsigned.kind !== "fixture" || unsigned.attestation !== "unattested") throw new TypeError("releaseManifest is not an unattested fixture");
  for (const key of ["compilerId", "workflowId", "workflowVersion"]) text(unsigned[key], `releaseManifest.${key}`);
  for (const key of ["compilerArtifactDigest", "specDigest", "compiledPlanDigest"]) digest(unsigned[key], `releaseManifest.${key}`);
  assertDigestValues(unsigned.handlerArtifactDigests, "releaseManifest.handlerArtifactDigests");
  assertDigestValues(unsigned.messageArtifactDigests, "releaseManifest.messageArtifactDigests");
  validateEffectOwnership(unsigned.effectOwnership);
  digest(manifest.releaseManifestDigest, "releaseManifest.releaseManifestDigest");
  return unsigned;
}

function assertDeploymentShape(record) {
  const unsigned = unsignedDeploymentFrom(record);
  if (unsigned.deploymentRecordVersion !== DEPLOYMENT_FIXTURE_VERSION || unsigned.kind !== "fixture" || unsigned.deployed !== false) throw new TypeError("deploymentRecord is not a non-deployed fixture");
  for (const key of ["deploymentId", "runtimeVersion"]) text(unsigned[key], `deploymentRecord.${key}`);
  digest(unsigned.releaseManifestDigest, "deploymentRecord.releaseManifestDigest");
  assertSchemaHead(unsigned.d1SchemaHead, "deploymentRecord.d1SchemaHead");
  digest(record.deploymentRecordDigest, "deploymentRecord.deploymentRecordDigest");
  return unsigned;
}

function assertInvocationShape(identity) {
  const unsigned = unsignedInvocationFrom(identity);
  if (unsigned.invocationIdentityVersion !== "invocation-identity-fixture.v1" || unsigned.kind !== "fixture") throw new TypeError("invocationIdentity is not a fixture");
  for (const key of ["invocationId", "sourceEventId", "runtimeVersion"]) text(unsigned[key], `invocationIdentity.${key}`);
  for (const key of ["deploymentRecordDigest", "releaseManifestDigest"]) digest(unsigned[key], `invocationIdentity.${key}`);
  assertSchemaHead(unsigned.d1SchemaHead, "invocationIdentity.d1SchemaHead");
  digest(identity.invocationIdentityDigest, "invocationIdentity.invocationIdentityDigest");
  return unsigned;
}

async function fixtureProblems({ releaseManifest, deploymentRecord, invocationIdentity }) {
  const missing = [];
  try {
    const unsigned = assertManifestShape(releaseManifest);
    if (releaseManifest.releaseManifestDigest !== await sha256(unsigned)) missing.push("release_manifest_digest_mismatch");
  } catch { missing.push("release_manifest_missing_or_invalid"); }
  try {
    const unsigned = assertDeploymentShape(deploymentRecord);
    if (deploymentRecord.deploymentRecordDigest !== await sha256(unsigned)) missing.push("deployment_record_digest_mismatch");
  } catch { missing.push("deployment_record_missing_or_invalid"); }
  try {
    const unsigned = assertInvocationShape(invocationIdentity);
    if (invocationIdentity.invocationIdentityDigest !== await sha256(unsigned)) missing.push("invocation_identity_digest_mismatch");
  } catch { missing.push("invocation_identity_missing_or_invalid"); }
  if (deploymentRecord?.releaseManifestDigest && releaseManifest?.releaseManifestDigest && deploymentRecord.releaseManifestDigest !== releaseManifest.releaseManifestDigest) missing.push("deployment_manifest_mismatch");
  if (invocationIdentity?.deploymentRecordDigest && deploymentRecord?.deploymentRecordDigest && invocationIdentity.deploymentRecordDigest !== deploymentRecord.deploymentRecordDigest) missing.push("invocation_deployment_mismatch");
  if (invocationIdentity?.releaseManifestDigest && releaseManifest?.releaseManifestDigest && invocationIdentity.releaseManifestDigest !== releaseManifest.releaseManifestDigest) missing.push("invocation_manifest_mismatch");
  if (!deploymentRecord?.d1SchemaHead?.migrationId || !deploymentRecord?.d1SchemaHead?.sourceSha256 || !Number.isInteger(deploymentRecord?.d1SchemaHead?.version)) missing.push("d1_schema_authority_missing");
  if (deploymentRecord?.d1SchemaHead && invocationIdentity?.d1SchemaHead && canonicalJson(deploymentRecord.d1SchemaHead) !== canonicalJson(invocationIdentity.d1SchemaHead)) missing.push("invocation_schema_mismatch");
  return missing;
}

export async function projectStaffShadow({ releaseManifest, deploymentRecord, invocationIdentity, evidenceEnvelopes }) {
  const problems = await fixtureProblems({ releaseManifest, deploymentRecord, invocationIdentity });
  if (!Array.isArray(evidenceEnvelopes) || evidenceEnvelopes.length === 0) problems.push("runtime_evidence_missing");
  if (problems.length) return deepFreeze({ mode: "shadow", status: "Unknown", reasonCodes: [...new Set(problems)].sort(), authority: "missing_or_mismatched" });
  let normalizedEvidence;
  try { normalizedEvidence = evidenceEnvelopes.map(validateTruthEnvelope); } catch { return deepFreeze({ mode: "shadow", status: "Unknown", reasonCodes: ["runtime_evidence_invalid"], authority: "missing_or_mismatched" }); }
  // A fixture can evaluate a policy but can never become a top-level live/healthy claim.
  return deepFreeze({
    mode: "shadow",
    status: "Unknown",
    reasonCodes: ["fixture_not_authoritative"],
    authority: "fixture_only_not_live",
    releaseManifestDigest: releaseManifest.releaseManifestDigest,
    deploymentRecordDigest: deploymentRecord.deploymentRecordDigest,
    invocationIdentityDigest: invocationIdentity.invocationIdentityDigest,
    fixtureEvaluation: { nonAuthoritative: true, status: deriveHealth(normalizedEvidence) },
  });
}
