/**
 * Phase A pure contract helpers. They intentionally have no runtime imports and no I/O.
 * Adoption requires a separately reviewed release.
 */
export const TRUTH_AUTHORITIES = Object.freeze([
  "WorkflowSpec", "CompiledPlan", "ReleaseManifest", "DeploymentRecord",
  "ExecutionLedger", "ExternalObservation", "DerivedStatusPolicy",
]);
export const TRUTH_STATES = Object.freeze(["Broken", "Unknown", "Degraded", "Healthy"]);

const AUTHORITY_KINDS = new Set(["system", "provider", "human", "ai"]);
const PROOF_LEVELS = new Set(["exact", "estimated", "unknown"]);
const VALUE_KINDS = new Set(["known", "unknown"]);
const FRESHNESS = new Set(["fresh", "stale", "unavailable"]);
const AMBIGUITY = new Set(["none", "present", "unknown"]);
const NON_OPTIMISTIC = new Set(["Unknown", "Degraded", "Broken"]);
const HEALTH = new Set(TRUTH_STATES);
const EFFECT_MODES = new Set(["draft", "shadow", "live", "retired", "read"]);
const NODE_KINDS = new Set(["entry", "decision", "wait", "effect", "exit", "transform"]);

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}
function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}
function requiredNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}
function oneOf(value, choices, label) {
  if (!choices.has(value)) throw new TypeError(`invalid ${label}: ${value}`);
  return value;
}
function requiredDate(value, label) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.exec(requiredString(value, label));
  if (!match) throw new TypeError(`${label} must be RFC3339 date-time`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 60) throw new TypeError(`${label} must be RFC3339 date-time`);
  if (!value.endsWith("Z")) {
    const [offsetHour, offsetMinute] = value.slice(-5).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) throw new TypeError(`${label} must be RFC3339 date-time`);
  }
  return value;
}
function strictKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
}
function validateCoverage(coverage) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) throw new TypeError("coverage is required");
  strictKeys(coverage, new Set(["expected", "observed", "missing", "paginationComplete", "sampleRate"]), "coverage");
  for (const key of ["expected", "observed", "missing"]) requiredNonnegativeInteger(coverage[key], `coverage.${key}`);
  requiredBoolean(coverage.paginationComplete, "coverage.paginationComplete");
  if (typeof coverage.sampleRate !== "number" || !Number.isFinite(coverage.sampleRate) || coverage.sampleRate < 0 || coverage.sampleRate > 1) throw new TypeError("coverage.sampleRate must be between zero and one");
  return coverage;
}
function validateFreshness(freshness) {
  if (!freshness || typeof freshness !== "object" || Array.isArray(freshness)) throw new TypeError("freshness is required");
  strictKeys(freshness, new Set(["checkedAt", "maxAgeMs", "state"]), "freshness");
  requiredDate(freshness.checkedAt, "freshness.checkedAt");
  requiredNonnegativeInteger(freshness.maxAgeMs, "freshness.maxAgeMs");
  oneOf(freshness.state, FRESHNESS, "freshness.state");
  return freshness;
}

/** Validates the canonical TruthEnvelope v1 structure. */
export function validateTruthEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new TypeError("TruthEnvelope is required");
  strictKeys(envelope, new Set(["assertionId", "claim", "authority", "authorityKind", "authorityPresent", "proofLevel", "valueKind", "value", "sourceRefs", "window", "asOf", "watermark", "coverage", "freshness", "ambiguity", "status", "safetyViolation", "onMissing", "onStale", "reasonCodes", "limitations"]), "TruthEnvelope");
  requiredString(envelope.assertionId, "assertionId"); requiredString(envelope.claim, "claim");
  if (!TRUTH_AUTHORITIES.includes(envelope.authority)) throw new TypeError("authority must name exactly one authority");
  oneOf(envelope.authorityKind, AUTHORITY_KINDS, "authorityKind"); requiredBoolean(envelope.authorityPresent, "authorityPresent");
  oneOf(envelope.proofLevel, PROOF_LEVELS, "proofLevel"); oneOf(envelope.valueKind, VALUE_KINDS, "valueKind");
  if (!Array.isArray(envelope.sourceRefs) || envelope.sourceRefs.length === 0) throw new TypeError("sourceRefs are required");
  for (const ref of envelope.sourceRefs) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new TypeError("sourceRef must be an object");
    strictKeys(ref, new Set(["kind", "id", "digest"]), "sourceRef"); requiredString(ref.kind, "sourceRef.kind"); requiredString(ref.id, "sourceRef.id");
    if (ref.digest !== undefined) requiredString(ref.digest, "sourceRef.digest");
  }
  if (!envelope.window || typeof envelope.window !== "object" || Array.isArray(envelope.window)) throw new TypeError("window is required");
  strictKeys(envelope.window, new Set(["start", "end", "timezone"]), "window");
  const start = requiredDate(envelope.window.start, "window.start"); const end = requiredDate(envelope.window.end, "window.end");
  if (start > end) throw new TypeError("window.start must not be after window.end"); requiredString(envelope.window.timezone, "window.timezone");
  requiredDate(envelope.asOf, "asOf"); requiredDate(envelope.watermark, "watermark"); validateCoverage(envelope.coverage); validateFreshness(envelope.freshness);
  oneOf(envelope.ambiguity, AMBIGUITY, "ambiguity"); oneOf(envelope.status, HEALTH, "status"); requiredBoolean(envelope.safetyViolation, "safetyViolation");
  oneOf(envelope.onMissing, NON_OPTIMISTIC, "onMissing"); oneOf(envelope.onStale, NON_OPTIMISTIC, "onStale");
  if (!Array.isArray(envelope.reasonCodes) || !envelope.reasonCodes.every((code) => typeof code === "string" && code.trim())) throw new TypeError("reasonCodes must be strings");
  if (!Array.isArray(envelope.limitations) || !envelope.limitations.every((item) => typeof item === "string" && item.trim())) throw new TypeError("limitations must be strings");
  if (["human", "ai"].includes(envelope.authorityKind) && ["Live", "Healthy"].includes(envelope.claim)) throw new TypeError("human or AI cannot authorize Live or Healthy");
  if (envelope.valueKind === "unknown") {
    if (envelope.proofLevel !== "unknown" || envelope.value !== null || envelope.status !== "Unknown") throw new TypeError("unknown value requires unknown proof, null value, and Unknown status");
  } else if (envelope.value === null || envelope.value === undefined) throw new TypeError("known value is required");
  if (envelope.proofLevel === "exact" && (!envelope.coverage.paginationComplete || envelope.coverage.sampleRate !== 1)) throw new TypeError("exact proof requires complete unsampled coverage");
  return Object.freeze({ ...envelope });
}

// Phase A compatibility name; this accepts only the canonical envelope, never a shortcut.
export const validateAssertion = validateTruthEnvelope;

function evidenceOutcome(envelope) {
  if (envelope.safetyViolation || envelope.status === "Broken") return "Broken";
  if (!envelope.authorityPresent || envelope.valueKind !== "known" || envelope.proofLevel !== "exact" || envelope.ambiguity !== "none" || envelope.freshness.state === "unavailable") return envelope.onMissing;
  if (envelope.freshness.state === "stale") return envelope.onStale;
  if (!envelope.coverage.paginationComplete || envelope.coverage.sampleRate !== 1 || envelope.coverage.missing !== 0 || envelope.coverage.observed !== envelope.coverage.expected) return "Degraded";
  return envelope.status === "Degraded" ? "Degraded" : envelope.status === "Unknown" ? "Unknown" : "Healthy";
}
export function deriveHealth(envelopes) {
  if (!Array.isArray(envelopes) || envelopes.length === 0) throw new TypeError("health requires TruthEnvelopes");
  const outcomes = envelopes.map((envelope) => {
    if (envelope?.safetyViolation === true || envelope?.status === "Broken") return "Broken";
    try { return evidenceOutcome(validateTruthEnvelope(envelope)); } catch { return "Unknown"; }
  });
  if (outcomes.includes("Broken")) return "Broken";
  if (outcomes.includes("Unknown")) return "Unknown";
  if (outcomes.includes("Degraded")) return "Degraded";
  return "Healthy";
}
export function calculateBusinessMetric(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("metric input is required");
  if (!Number.isFinite(input.numerator) || !Number.isFinite(input.denominator)) throw new TypeError("metric values must be finite");
  if (input.denominator <= 0) throw new TypeError("business metric denominator must be positive");
  const envelope = validateTruthEnvelope(input.envelope);
  if (evidenceOutcome(envelope) !== "Healthy") throw new TypeError("business metric requires exact, fresh, complete, unambiguous authoritative evidence");
  return input.numerator / input.denominator;
}
export function validateEffectOwnership(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("effect ownership entries are required");
  const liveOwners = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("effect ownership entry must be an object");
    strictKeys(entry, new Set(["responsibility", "owner", "mode", "effectful", "observer"]), "effect ownership");
    const responsibility = requiredString(entry.responsibility, "responsibility"); requiredString(entry.owner, "effect owner"); oneOf(entry.mode, EFFECT_MODES, "effect mode"); requiredBoolean(entry.effectful, "effectful"); requiredBoolean(entry.observer, "observer");
    if (entry.observer && entry.effectful) throw new TypeError("observer must be explicitly non-effectful");
    if (entry.mode === "live" && entry.effectful) {
      if (liveOwners.has(responsibility)) throw new TypeError(`overlapping live effect owners are forbidden for ${responsibility}`);
      liveOwners.set(responsibility, entry.owner);
    }
  }
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}
export function validateWorkflowSpec(spec, { allowedResponsibilities } = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new TypeError("WorkflowSpec is required");
  strictKeys(spec, new Set(["workflowId", "version", "handlers", "entryNodeIds", "exitNodeIds", "nodes", "edges"]), "WorkflowSpec");
  requiredString(spec.workflowId, "WorkflowSpec.workflowId"); requiredString(spec.version, "WorkflowSpec.version");
  if (!Array.isArray(spec.handlers) || !spec.handlers.every((handler) => typeof handler === "string" && handler.trim())) throw new TypeError("WorkflowSpec.handlers must be strings");
  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges) || !Array.isArray(spec.entryNodeIds) || !Array.isArray(spec.exitNodeIds)) throw new TypeError("WorkflowSpec graph arrays are required");
  if (!(allowedResponsibilities instanceof Set) || ![...allowedResponsibilities].every((item) => typeof item === "string" && item.trim())) throw new TypeError("allowedResponsibilities registry is required");
  const handlers = new Set(spec.handlers); const nodes = new Map();
  for (const node of spec.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new TypeError("WorkflowSpec node must be an object");
    strictKeys(node, new Set(["id", "kind", "handler", "responsibility", "branchCoverage", "messageRef", "expectedEvidence"]), "WorkflowSpec.node");
    const id = requiredString(node.id, "node.id"); if (nodes.has(id)) throw new TypeError(`duplicate node id: ${id}`); oneOf(node.kind, NODE_KINDS, "node.kind");
    if (["effect", "transform"].includes(node.kind)) { requiredString(node.handler, "node.handler"); if (!handlers.has(node.handler)) throw new TypeError(`unregistered handler: ${node.handler}`); } else if (node.handler !== undefined) throw new TypeError("only effect or transform nodes may declare handlers");
    if (node.kind === "effect") {
      requiredString(node.responsibility, "effect responsibility");
      if (!allowedResponsibilities.has(node.responsibility)) throw new TypeError(`unregistered effect responsibility: ${node.responsibility}`);
      if (!Array.isArray(node.expectedEvidence) || node.expectedEvidence.length === 0) throw new TypeError("effect expectedEvidence is required");
    } else if (node.responsibility !== undefined) throw new TypeError("only effect nodes may declare responsibility");
    if (node.messageRef !== undefined) { if (node.kind !== "effect") throw new TypeError("only effect nodes may declare messageRef"); requiredString(node.messageRef, "node.messageRef"); }
    if (node.expectedEvidence !== undefined) {
      if (!Array.isArray(node.expectedEvidence) || !node.expectedEvidence.length) throw new TypeError("expectedEvidence must be a non-empty array");
      for (const evidence of node.expectedEvidence) {
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new TypeError("expectedEvidence item must be an object");
        strictKeys(evidence, new Set(["id", "authority"]), "expectedEvidence"); requiredString(evidence.id, "expectedEvidence.id");
        if (!TRUTH_AUTHORITIES.includes(evidence.authority)) throw new TypeError("expectedEvidence.authority must name exactly one authority");
      }
    }
    if (node.kind === "decision") { if (node.branchCoverage !== "complete") throw new TypeError("decision branchCoverage must be complete"); } else if (node.branchCoverage !== undefined) throw new TypeError("only decision nodes may declare branchCoverage");
    nodes.set(id, node);
  }
  const edgeIds = new Set(); const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of spec.edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) throw new TypeError("WorkflowSpec edge must be an object");
    strictKeys(edge, new Set(["id", "from", "to", "condition", "priority"]), "WorkflowSpec.edge");
    const id = requiredString(edge.id, "edge.id"); if (edgeIds.has(id)) throw new TypeError(`duplicate edge id: ${id}`); edgeIds.add(id);
    requiredString(edge.from, "edge.from"); requiredString(edge.to, "edge.to"); requiredString(edge.condition, "edge.condition");
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw new TypeError(`dangling edge: ${id}`);
    if (!Number.isInteger(edge.priority) || edge.priority < 0) throw new TypeError("edge.priority must be a non-negative integer"); outgoing.get(edge.from).push(edge);
  }
  const entries = new Set(spec.entryNodeIds.map((id) => requiredString(id, "entryNodeId"))); const exits = new Set(spec.exitNodeIds.map((id) => requiredString(id, "exitNodeId")));
  if (entries.size === 0 || exits.size === 0) throw new TypeError("WorkflowSpec requires entries and exits");
  for (const id of entries) if (!nodes.has(id) || nodes.get(id).kind !== "entry") throw new TypeError(`invalid entry node: ${id}`);
  for (const id of exits) if (!nodes.has(id) || nodes.get(id).kind !== "exit") throw new TypeError(`invalid exit node: ${id}`);
  for (const [id, node] of nodes) {
    const edges = outgoing.get(id); if (node.kind === "exit" && edges.length) throw new TypeError(`exit node has outgoing edge: ${id}`); if (node.kind !== "exit" && !edges.length) throw new TypeError(`non-exit node has no outgoing edge: ${id}`);
    const priorities = new Set(edges.map((edge) => edge.priority)); if (priorities.size !== edges.length) throw new TypeError(`duplicate edge priority from: ${id}`);
    if (node.kind === "decision") { const conditions = new Set(edges.map((edge) => edge.condition)); if (!conditions.has("else") || conditions.size !== edges.length) throw new TypeError(`decision branch coverage is incomplete: ${id}`); }
  }
  const reached = new Set(entries); const queue = [...entries];
  while (queue.length) for (const edge of outgoing.get(queue.shift())) if (!reached.has(edge.to)) { reached.add(edge.to); queue.push(edge.to); }
  for (const id of nodes.keys()) if (!reached.has(id)) throw new TypeError(`unreachable node: ${id}`);
  for (const id of exits) if (!reached.has(id)) throw new TypeError(`unreachable exit: ${id}`);
  return Object.freeze({ ...spec });
}
