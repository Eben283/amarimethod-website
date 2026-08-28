// Pure, identity-only structural planning. No SQL, database/provider adapter,
// credentials, clock acquisition, authentication, or executable purge is here.
// A reviewed storage/reader migration, authenticated exhaustive inventories,
// scoped authorization, independent private witness and suppression service,
// and synthetic execution/recovery rehearsal remain separate adoption gates.
// In particular, this contract cannot detect a coherent rollback of ALL supplied
// state, authenticate an origin clock, or consume an approval/hold/witness.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";

export const FOLLOW_UP_RETENTION_POLICY_CONTRACT = "follow-up-retention-policy-plan.v1";
export const FOLLOW_UP_RETENTION_INVENTORY_CONTRACT = "follow-up-retention-dependency-inventory.v1";
export const FOLLOW_UP_RETENTION_EPOCH_CONTRACT = "follow-up-retention-epoch-state.v1";
export const FOLLOW_UP_RETENTION_BASIS = Object.freeze({
  databaseId: "089d810a-9d2d-43a4-8f1d-dc3620835557", environment: "production", schemaVersion: 2,
  schemaStructureSha256: "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62",
  physicalCatalogSha256: "092f10ced495ac5da767b6013f52886bbfab3b8f8257e2eb140ef5ae275839ba",
  sourceRevision: "c4fab568150fa951ad5f9a15d5a6bd8721569c7f",
});
export const FOLLOW_UP_RETENTION_LIMITS = Object.freeze({ identities: 200, records: 200, parents: 16, proofs: 200, horizons: 32,
  holds: 32, replacements: 200, payloadBytes: 1500000, proposedRowsPerPage: 100, proposedPagesPerRun: 8, payloadWarningBytes: 750000 });
export const FOLLOW_UP_RETENTION_RECORD_KINDS = Object.freeze(["source", "lifecycle", "obligation", "command_attempt", "provider_receipt",
  "source_transition", "lease_event", "exception", "exception_event", "provenance", "release_manifest", "deployment_attestation",
  "effect_binding", "effect_event", "consumer_checkpoint", "retained_reason", "payload_reference", "cache", "diagnostic", "export",
  "recovery_manifest", "privacy_request", "suppression_key", "evidence_access"]);
const CONTRACT = FOLLOW_UP_RETENTION_POLICY_CONTRACT, INVENTORY = FOLLOW_UP_RETENTION_INVENTORY_CONTRACT, EPOCH = FOLLOW_UP_RETENTION_EPOCH_CONTRACT;
const DAY = 86400000, MAX_TIME = 8640000000000000 - 800 * DAY, PROOF_AGE = 10 * 60000;
const ID = /^id_[a-f0-9]{64}$/, HEX = /^[a-f0-9]{64}$/;
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, structuralOnly: true, authenticated: false,
  productionReadAuthorized: false, executionAuthorized: false, installationAuthorized: false, adoptionAllowed: false,
  authority: false, authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false, outcomeProven: false,
  replacementAllowed: false, watermarkAdvanceAllowed: false, automaticRetryAllowed: false, restoreAuthorized: false,
  coherentRollbackDetectable: false });
const LIMITATIONS = ["caller_supplied_structural_metadata_only", "new_storage_reader_and_purge_contract_required", "external_witness_not_authenticated"];
const SAFE = new Set(["invalid_input", "wrong_basis", "invalid_origin", "origin_commitment_mismatch", "future_clock", "identity_conflict",
  "inventory_incomplete", "inventory_digest_mismatch", "inventory_not_fresh", "missing_dependency", "dependency_cycle", "dependency_mismatch",
  "limit_exceeded", "invalid_deletion", "invalid_hold", "invalid_replacement", "epoch_state_mismatch", "epoch_commitment_mismatch",
  "stage_order_invalid", "old_cursor", "invalid_horizon", "planning_unavailable"]);
const ORIGIN_KINDS = { effect: "binding_created", inventory: "source_received", diagnostic: "diagnostic_created",
  recovery_manifest: "manifest_created", privacy_request: "request_closed", suppression: "deletion_recorded" };
const ORIGIN_RECORDS = { effect: ["effect_binding"], inventory: ["source"], diagnostic: ["diagnostic", "evidence_access"],
  recovery_manifest: ["recovery_manifest", "release_manifest", "deployment_attestation"], privacy_request: ["privacy_request"], suppression: ["suppression_key"] };
const REQUIRED_PARENTS = {
  lifecycle: { source: "source" }, obligation: { lifecycle: "lifecycle" }, command_attempt: { obligation: "obligation" },
  provider_receipt: { command: "command_attempt" }, source_transition: { source: "source" }, lease_event: { obligation: "obligation" },
  exception_event: { exception: "exception" }, provenance: { source: "source", lifecycle: "lifecycle", attestation: "deployment_attestation" },
  deployment_attestation: { manifest: "release_manifest" }, effect_event: { binding: "effect_binding" }, retained_reason: { checkpoint: "consumer_checkpoint" },
  effect_binding: { command: "command_attempt", source: "source", lifecycle: "lifecycle", obligation: "obligation", lease: "lease_event",
    acceptance_attestation: "deployment_attestation", acceptance_manifest: "release_manifest", executor_attestation: "deployment_attestation", executor_manifest: "release_manifest" },
};
const OPTIONAL_PARENTS = { exception: { source: "source", lifecycle: "lifecycle", obligation: "obligation" }, consumer_checkpoint: { previous: "consumer_checkpoint" } };
const SHARED_RELEASE_KINDS = new Set(["release_manifest", "deployment_attestation"]);

function stop(code) { throw new Error(code); }
function need(value, code = "invalid_input") { if (!value) stop(code); }
function plain(v) { return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function exact(v, keys, code = "invalid_input") { need(plain(v) && Object.keys(v).sort().join() === [...keys].sort().join(), code); }
function integer(v, code = "invalid_input") { need(Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME, code); }
function id(v, code = "invalid_input") { need(typeof v === "string" && ID.test(v), code); }
function hash(v, code = "invalid_input") { need(typeof v === "string" && HEX.test(v), code); }
function bool(v, code = "invalid_input") { need(typeof v === "boolean", code); }
function list(v, max, code = "limit_exceeded") { need(Array.isArray(v), "invalid_input"); need(v.length <= max, code); }
function ids(v, max) { list(v, max); for (const x of v) id(x); need(new Set(v).size === v.length, "identity_conflict"); }
function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function copy(v, depth = 0, budget = { n: 0 }) {
  need(++budget.n <= 100000 && depth <= 16);
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") { integer(v); return v; }
  if (typeof v === "string") { need(v.length <= 256); return v; }
  need(v && typeof v === "object"); const array = Array.isArray(v); need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
  const ds = Object.getOwnPropertyDescriptors(v), entries = [], length = array ? ds.length.value : null;
  need(!array || length <= 2800, "limit_exceeded"); need(array || Reflect.ownKeys(ds).length <= 64);
  for (const key of Reflect.ownKeys(ds)) {
    if (array && key === "length") continue; const d = ds[key];
    need(typeof key === "string" && key.length <= 80 && d.enumerable && Object.hasOwn(d, "value") && (!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length)));
    entries.push([key, copy(d.value, depth + 1, budget)]);
  }
  if (!array) return Object.fromEntries(entries); need(entries.length === length); const out = new Array(length); for (const [key, value] of entries) out[Number(key)] = value; return out;
}
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const sortIds = (xs) => [...xs].sort();
const minimum = (xs) => { const n = xs.filter((x) => x !== null); return n.length ? Math.min(...n) : null; };
function result(status, values = {}) { return freeze({ contract: CONTRACT, ...FLAGS, status, reasonCodes: [], limitations: [...LIMITATIONS], ...values }); }
function refusal(error) { const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
  return result("refused", { planDigestSha256: null, reasonCodes: [SAFE.has(code) ? code : "planning_unavailable"] }); }
function base(v, asOf) { exact(v, Object.keys(FOLLOW_UP_RETENTION_BASIS)); need(equal(v, FOLLOW_UP_RETENTION_BASIS), "wrong_basis"); integer(asOf); }
function notFuture(v, now, code = "future_clock") { integer(v, code); need(v <= now, code); }
function fresh(v, now) { notFuture(v, now); return now - v <= PROOF_AGE; }
async function finish(status, value) { return result(status, { ...value, planDigestSha256: await sha256({ contract: CONTRACT, ...value }) }); }

async function horizons(value, basis, asOf) {
  exact(value, ["complete", "routes"]); bool(value.complete); list(value.routes, 32); const seen = new Set(); let available = value.complete;
  for (const r of value.routes) {
    exact(r, ["id", "kind", "throughAt", "verifiedAt", "commitmentSha256"], "invalid_horizon"); id(r.id, "invalid_horizon"); hash(r.commitmentSha256, "invalid_horizon");
    need(!seen.has(r.id), "invalid_horizon"); seen.add(r.id); need(["backup", "ingress", "export", "provider_replay"].includes(r.kind), "invalid_horizon");
    notFuture(r.verifiedAt, asOf, "invalid_horizon"); if (r.throughAt !== null) integer(r.throughAt, "invalid_horizon");
    const body = { contract: "follow-up-retention-horizon.v1", basis, id: r.id, kind: r.kind, throughAt: r.throughAt, verifiedAt: r.verifiedAt };
    need(await sha256(body) === r.commitmentSha256, "invalid_horizon"); if (r.throughAt === null || !fresh(r.verifiedAt, asOf)) available = false;
  }
  const normalized = { complete: value.complete, routes: [...value.routes].sort((a, b) => a.id < b.id ? -1 : 1) };
  return { normalized, digest: await sha256(normalized), available };
}
function addMonths(time, months) {
  const date = new Date(time), day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(date.getTime()); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0); date.setUTCDate(Math.min(day, end.getUTCDate()));
  const value = date.getTime(); integer(value); return value;
}
async function identity(value, basis, asOf) {
  exact(value, ["id", "subjectId", "dataClass", "origin", "parentDeadlines", "inheritedDeadlineAt", "deletionDueAt"]);
  id(value.id); if (value.subjectId !== null) id(value.subjectId); need(Object.hasOwn(ORIGIN_KINDS, value.dataClass), "invalid_origin");
  exact(value.origin, ["id", "kind", "at", "commitmentSha256"], "invalid_origin"); id(value.origin.id, "invalid_origin");
  need(value.origin.kind === ORIGIN_KINDS[value.dataClass], "invalid_origin"); notFuture(value.origin.at, asOf); hash(value.origin.commitmentSha256, "invalid_origin");
  need(await sha256({ contract: "follow-up-retention-origin.v1", basis, originId: value.origin.id, kind: value.origin.kind, originalAt: value.origin.at }) === value.origin.commitmentSha256, "origin_commitment_mismatch");
  list(value.parentDeadlines, 32); const parents = new Set();
  for (const p of value.parentDeadlines) { exact(p, ["id", "deadlineAt"]); id(p.id); integer(p.deadlineAt); need(p.id !== value.id && !parents.has(p.id), "identity_conflict"); parents.add(p.id); }
  for (const key of ["inheritedDeadlineAt", "deletionDueAt"]) if (value[key] !== null) integer(value[key]);
  return { ...value, parentDeadlines: [...value.parentDeadlines].sort((a, b) => a.id < b.id ? -1 : 1) };
}
function deadline(i, asOf, horizon, deletionDueAt = null) {
  let cap;
  if (i.dataClass === "suppression") {
    // An unknown/stale replay route never becomes a synthetic expiry date.
    if (!horizon.available) return { identity: i.id, originalAt: i.origin.at, deadlineAt: null, validity: "unresolved_horizon", expiryEligible: false, reviewRequired: true };
    cap = Math.max(i.origin.at, ...horizon.normalized.routes.map((r) => r.throughAt)) + 7 * DAY;
    // Suppression is a separate exception, not shortened into resurrection by a
    // person-deletion deadline or an ordinary evidence/inherited 90-day cap.
    need(i.parentDeadlines.length === 0 && i.inheritedDeadlineAt === null && i.deletionDueAt === null, "invalid_horizon");
  } else if (i.dataClass === "privacy_request") {
    // The approved minimal request-audit class is separate from the person's
    // profile deletion. This is a policy exception, not a legal determination;
    // a separately authorized audit override is not implemented here.
    need(i.parentDeadlines.length === 0 && i.inheritedDeadlineAt === null && i.deletionDueAt === null, "invalid_origin");
    cap = addMonths(i.origin.at, 24);
  }
  else cap = i.origin.at + (i.dataClass === "diagnostic" ? 7 : 90) * DAY;
  integer(cap);
  const until = ["suppression", "privacy_request"].includes(i.dataClass) ? cap : minimum([cap, i.inheritedDeadlineAt, i.deletionDueAt, deletionDueAt, ...i.parentDeadlines.map((p) => p.deadlineAt)]);
  return { identity: i.id, originalAt: i.origin.at, deadlineAt: until, validity: until <= i.origin.at ? "unusable_at_origin" : asOf >= until ? "expired" : "within_horizon", expiryEligible: asOf >= until, reviewRequired: false };
}

/** Observation time never supplies/replaces an immutable origin clock. */
export async function planFollowUpRetentionDeadline(options) {
  try { const input = freeze(copy(options)); exact(input, ["basis", "asOf", "identity", "horizons"]); base(input.basis, input.asOf);
    const i = await identity(input.identity, input.basis, input.asOf), h = await horizons(input.horizons, input.basis, input.asOf), d = deadline(i, input.asOf, h);
    return await finish(d.reviewRequired ? "pending" : "planned", { basis: input.basis, asOf: input.asOf, deadline: d,
      identityCommitmentSha256: await sha256(i), horizonsDigestSha256: h.digest,
      reasonCodes: d.reviewRequired ? ["replay_horizon_unresolved_no_suppression_expiry"] : d.validity === "within_horizon" ? [] : ["evidence_expired_not_resolved"] });
  } catch (error) { return refusal(error); }
}

const dependencies = (r) => [...new Set([...r.parents.map((p) => p.id), ...r.proofIds])];
function topological(records, selected = new Set(records.keys())) {
  const visiting = new Set(), done = new Set(), parentFirst = [];
  function visit(key) { need(!visiting.has(key), "dependency_cycle"); if (done.has(key)) return; visiting.add(key);
    for (const p of sortIds(dependencies(records.get(key)))) if (selected.has(p)) visit(p); visiting.delete(key); done.add(key); parentFirst.push(key); }
  for (const key of sortIds(selected)) visit(key); return parentFirst.reverse();
}
async function inventory(value, basis, asOf) {
  exact(value, ["contract", "scopeId", "capturedAt", "complete", "sections", "identities", "records", "digestSha256"]);
  need(value.contract === INVENTORY, "inventory_incomplete"); id(value.scopeId); bool(value.complete); need(value.complete, "inventory_incomplete");
  need(fresh(value.capturedAt, asOf), "inventory_not_fresh"); hash(value.digestSha256); list(value.identities, 200); list(value.records, 200); list(value.sections, FOLLOW_UP_RETENTION_RECORD_KINDS.length);
  const identities = new Map(); for (const raw of value.identities) { const i = await identity(raw, basis, asOf); need(!identities.has(i.id), "identity_conflict"); identities.set(i.id, i); }
  for (const i of identities.values()) for (const p of i.parentDeadlines) need(identities.has(p.id), "missing_dependency");
  const records = new Map();
  for (const r of value.records) {
    exact(r, ["id", "kind", "identityIds", "parents", "proofIds", "eventKind", "unresolved"]); id(r.id); need(FOLLOW_UP_RETENTION_RECORD_KINDS.includes(r.kind));
    need(!records.has(r.id), "identity_conflict"); ids(r.identityIds, 200); need(r.identityIds.length > 0, "dependency_mismatch"); ids(r.proofIds, 200); list(r.parents, 16); bool(r.unresolved);
    for (const x of r.identityIds) need(identities.has(x), "missing_dependency");
    const required = REQUIRED_PARENTS[r.kind] ?? {}, allowed = { ...required, ...(OPTIONAL_PARENTS[r.kind] ?? {}) }, roles = new Set();
    for (const p of r.parents) { exact(p, ["role", "id"]); id(p.id); need(Object.hasOwn(allowed, p.role) && !roles.has(p.role), "dependency_mismatch"); roles.add(p.role); }
    need(Object.keys(required).every((role) => roles.has(role)), "missing_dependency");
    need(r.kind === "effect_event" ? ["prepared", "observation", "receipt"].includes(r.eventKind) : r.eventKind === null, "dependency_mismatch");
    const subjectCount = new Set(r.identityIds.map((x) => identities.get(x).subjectId).filter((x) => x !== null)).size;
    need(r.kind === "consumer_checkpoint" || SHARED_RELEASE_KINDS.has(r.kind) || subjectCount <= 1, "dependency_mismatch");
    need(r.kind !== "retained_reason" || r.identityIds.length === 1, "dependency_mismatch");
    records.set(r.id, { ...r, identityIds: sortIds(r.identityIds), proofIds: sortIds(r.proofIds), parents: [...r.parents].sort((a, b) => a.role < b.role ? -1 : 1) });
  }
  const parent = (r, role) => records.get(r.parents.find((p) => p.role === role)?.id);
  const subjects = (r) => sortIds(new Set(r.identityIds.map((x) => identities.get(x).subjectId).filter((x) => x !== null)));
  for (const r of records.values()) {
    for (const dep of dependencies(r)) need(dep !== r.id && records.has(dep), "missing_dependency");
    for (const p of r.parents) need(records.get(p.id).kind === ({ ...(REQUIRED_PARENTS[r.kind] ?? {}), ...(OPTIONAL_PARENTS[r.kind] ?? {}) })[p.role], "dependency_mismatch");
    // Release/attestation rows are shared provenance, not person ownership.
    // Checkpoint succession can change membership, while member identity is
    // checked separately below. Every ordinary parent edge keeps its subject.
    for (const p of r.parents) if (!["consumer_checkpoint", "retained_reason"].includes(r.kind)
      && !SHARED_RELEASE_KINDS.has(r.kind) && !SHARED_RELEASE_KINDS.has(records.get(p.id).kind))
      need(equal(subjects(r), subjects(records.get(p.id))), "dependency_mismatch");
    if (r.kind === "provenance") need(parent(parent(r, "lifecycle"), "source")?.id === parent(r, "source").id, "dependency_mismatch");
    if (r.kind === "exception") {
      const obligation = parent(r, "obligation"), lifecycle = parent(r, "lifecycle"), source = parent(r, "source"),
        linkedLifecycle = obligation ? parent(obligation, "lifecycle") : lifecycle;
      if (obligation && lifecycle) need(linkedLifecycle?.id === lifecycle.id, "dependency_mismatch");
      if (source && linkedLifecycle) need(parent(linkedLifecycle, "source")?.id === source.id, "dependency_mismatch");
    }
    if (r.kind === "effect_binding") {
      need(parent(parent(r, "command"), "obligation")?.id === parent(r, "obligation").id && parent(parent(r, "obligation"), "lifecycle")?.id === parent(r, "lifecycle").id
        && parent(parent(r, "lifecycle"), "source")?.id === parent(r, "source").id && parent(parent(r, "lease"), "obligation")?.id === parent(r, "obligation").id, "dependency_mismatch");
      for (const which of ["acceptance", "executor"]) need(parent(parent(r, which + "_attestation"), "manifest")?.id === parent(r, which + "_manifest").id, "dependency_mismatch");
    }
    if (r.kind === "effect_event" && r.eventKind === "receipt") {
      const receipts = r.proofIds.map((x) => records.get(x)).filter((x) => x.kind === "provider_receipt");
      need(receipts.length === 1 && parent(receipts[0], "command")?.id === parent(parent(r, "binding"), "command")?.id, "dependency_mismatch");
    }
    if (r.kind === "retained_reason") need(parent(r, "checkpoint").identityIds.includes(r.identityIds[0]), "dependency_mismatch");
    if (r.kind === "consumer_checkpoint") {
      const memberIds = new Set([...records.values()].filter((x) => x.kind === "retained_reason" && parent(x, "checkpoint")?.id === r.id).flatMap((x) => x.identityIds));
      need(equal(sortIds(memberIds), r.identityIds), "inventory_incomplete");
      need(r.identityIds.every((x) => r.proofIds.some((p) => records.get(p).identityIds.includes(x))), "missing_dependency");
    }
  }
  for (const i of identities.values()) { const origin = records.get(i.origin.id); need(origin && ORIGIN_RECORDS[i.dataClass].includes(origin.kind) && origin.identityIds.includes(i.id), "invalid_origin"); }
  topological(records);
  const sections = new Map(); for (const s of value.sections) { exact(s, ["kind", "complete", "recordIds"]); need(FOLLOW_UP_RETENTION_RECORD_KINDS.includes(s.kind) && !sections.has(s.kind), "inventory_incomplete"); bool(s.complete); need(s.complete, "inventory_incomplete"); ids(s.recordIds, 200); sections.set(s.kind, sortIds(s.recordIds)); }
  need(sections.size === FOLLOW_UP_RETENTION_RECORD_KINDS.length, "inventory_incomplete");
  for (const kind of FOLLOW_UP_RETENTION_RECORD_KINDS) need(equal(sections.get(kind), sortIds([...records.values()].filter((r) => r.kind === kind).map((r) => r.id))), "inventory_incomplete");
  const normalized = { contract: INVENTORY, scopeId: value.scopeId, capturedAt: value.capturedAt, complete: true,
    sections: [...sections].sort(([a], [b]) => a < b ? -1 : 1).map(([kind, recordIds]) => ({ kind, complete: true, recordIds })),
    identities: [...identities.values()].sort((a, b) => a.id < b.id ? -1 : 1), records: [...records.values()].sort((a, b) => a.id < b.id ? -1 : 1) };
  need(new TextEncoder().encode(canonicalJson(normalized)).length <= 1500000, "limit_exceeded");
  need(await sha256({ basis, inventory: normalized }) === value.digestSha256, "inventory_digest_mismatch");
  return { identities, records, normalized, digest: value.digestSha256 };
}
function deletion(value, asOf) {
  if (value === null) return null; exact(value, ["ticketId", "subjectIds", "receivedAt", "verifiedAt", "approvedAt", "dueAt", "approvedBy", "commitmentSha256"], "invalid_deletion");
  id(value.ticketId, "invalid_deletion"); ids(value.subjectIds, 200); need(value.subjectIds.length > 0 && value.approvedBy === "Eben", "invalid_deletion"); hash(value.commitmentSha256, "invalid_deletion");
  for (const k of ["receivedAt", "verifiedAt", "approvedAt"]) notFuture(value[k], asOf, "invalid_deletion"); integer(value.dueAt, "invalid_deletion");
  need(value.receivedAt <= value.verifiedAt && value.verifiedAt <= value.approvedAt && value.dueAt >= value.receivedAt && value.dueAt <= value.receivedAt + 30 * DAY, "invalid_deletion"); return value;
}
function holds(values, identities, asOf) {
  list(values, 32); const held = new Set(), review = [], seen = new Set();
  for (const h of values) {
    exact(h, ["id", "identityIds", "basisCode", "approvedBy", "approvedAt", "nextReviewAt", "releasedAt", "signatureCommitmentSha256"], "invalid_hold");
    id(h.id, "invalid_hold"); need(!seen.has(h.id), "invalid_hold"); seen.add(h.id); ids(h.identityIds, 200); need(h.identityIds.length > 0 && h.identityIds.every((x) => identities.has(x)), "invalid_hold");
    need(h.approvedBy === "Eben" && ["legal_hold", "regulatory_hold"].includes(h.basisCode), "invalid_hold"); hash(h.signatureCommitmentSha256, "invalid_hold");
    notFuture(h.approvedAt, asOf, "invalid_hold"); integer(h.nextReviewAt, "invalid_hold"); need(h.nextReviewAt > h.approvedAt && h.nextReviewAt <= h.approvedAt + 30 * DAY, "invalid_hold");
    if (h.releasedAt !== null) { notFuture(h.releasedAt, asOf, "invalid_hold"); need(h.releasedAt >= h.approvedAt, "invalid_hold"); }
    else { h.identityIds.forEach((x) => held.add(x)); if (asOf >= h.nextReviewAt) review.push(h.id); }
  }
  return { held, review: sortIds(review) };
}

/** Returns conditional identity-only actions, NEVER SQL or executable authority.
 * The fixed-kind section inventory closes only the supplied synthetic graph;
 * it is not an authenticated production census or proof of external erasure. */
export async function planFollowUpRetentionMaintenance(options) {
  try {
    const input = freeze(copy(options)); exact(input, ["basis", "asOf", "inventory", "deletion", "holds", "replacements", "horizons"]); base(input.basis, input.asOf);
    const inv = await inventory(input.inventory, input.basis, input.asOf), h = await horizons(input.horizons, input.basis, input.asOf), request = deletion(input.deletion, input.asOf), hold = holds(input.holds, inv.identities, input.asOf);
    const requestedSubjects = new Set(request?.subjectIds ?? []), ds = new Map(), visiting = new Set();
    if (request) need([...requestedSubjects].every((s) => [...inv.identities.values()].some((i) => i.subjectId === s)), "inventory_incomplete");
    const originParents = (i) => { const found = new Set(), visited = new Set();
      const walk = (key) => { if (visited.has(key)) return; visited.add(key); const r = inv.records.get(key);
        for (const x of r.identityIds) if (x !== i.id) found.add(x); for (const p of dependencies(r)) walk(p); };
      for (const p of dependencies(inv.records.get(i.origin.id))) walk(p); return found; };
    function identityDeadline(key) { need(!visiting.has(key), "dependency_cycle"); if (ds.has(key)) return ds.get(key); visiting.add(key); const i = inv.identities.get(key);
      const d = deadline(i, input.asOf, h, requestedSubjects.has(i.subjectId) ? request.dueAt : null);
      if (d.deadlineAt !== null && !["suppression", "privacy_request"].includes(i.dataClass)) {
        const parentIds = new Set([...i.parentDeadlines.map((p) => p.id), ...originParents(i)]), parentDates = [...parentIds].map((p) => identityDeadline(p).deadlineAt);
        need(parentDates.every((x) => x !== null), "invalid_horizon"); d.deadlineAt = minimum([d.deadlineAt, ...parentDates]);
        d.expiryEligible = input.asOf >= d.deadlineAt; if (d.expiryEligible) d.validity = "expired";
      }
      visiting.delete(key); ds.set(key, d); return d; }
    for (const key of inv.identities.keys()) identityDeadline(key);
    const target = new Set([...inv.identities.values()].filter((i) => i.dataClass !== "suppression"
      && ((i.dataClass !== "privacy_request" && requestedSubjects.has(i.subjectId)) || ds.get(i.id).expiryEligible)).map((i) => i.id));
    // Suppression keys expire only after known complete replay horizons +7d.
    for (const i of inv.identities.values()) if (i.dataClass === "suppression" && ds.get(i.id).expiryEligible) target.add(i.id);
    const records = inv.records, replacementByOld = new Map(); list(input.replacements, 200);
    const reaches = (from, to, seen = new Set()) => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); return dependencies(records.get(from)).some((p) => reaches(p, to, seen)); };
    for (const r of input.replacements) {
      exact(r, ["recordId", "replacementId", "verifiedAt", "commitmentSha256"], "invalid_replacement"); id(r.recordId); id(r.replacementId); hash(r.commitmentSha256); notFuture(r.verifiedAt, input.asOf, "invalid_replacement");
      const old = records.get(r.recordId), next = records.get(r.replacementId); need(old?.kind === "consumer_checkpoint" && next?.kind === "consumer_checkpoint" && !replacementByOld.has(r.recordId) && !reaches(r.replacementId, r.recordId), "invalid_replacement");
      const keep = old.identityIds.filter((x) => !target.has(x)); need(keep.every((x) => next.identityIds.includes(x)) && next.identityIds.every((x) => !target.has(x)), "invalid_replacement");
      need(await sha256({ contract: "follow-up-retention-replacement.v1", basis: input.basis, recordId: r.recordId, replacementId: r.replacementId, retainedIdentityIds: next.identityIds, verifiedAt: r.verifiedAt }) === r.commitmentSha256, "invalid_replacement");
      replacementByOld.set(r.recordId, r);
    }
    const remove = new Set(), blocked = new Map(), rebase = new Map();
    for (const r of records.values()) if (r.identityIds.some((x) => target.has(x)) || (replacementByOld.has(r.id) && input.asOf >= replacementByOld.get(r.id).verifiedAt + DAY)) remove.add(r.id);
    // Carry dependent checkpoint/member copies into a new proposed epoch. This
    // is replacement planning, not an in-place mutation of frozen v1 rows.
    let changed = true;
    while (changed) { changed = false; for (const r of records.values()) if (!remove.has(r.id) && dependencies(r).some((p) => remove.has(p)) && ["consumer_checkpoint", "retained_reason"].includes(r.kind)) { remove.add(r.id); changed = true; } }
    for (const key of sortIds(remove)) {
      const r = records.get(key), kept = r.identityIds.filter((x) => !target.has(x));
      if (r.identityIds.some((x) => hold.held.has(x))) { blocked.set(key, "hold_blocks_physical_deletion_not_validity"); remove.delete(key); continue; }
      if (kept.length && !["consumer_checkpoint", "retained_reason"].includes(r.kind)) { blocked.set(key, "unrelated_identity_must_be_preserved"); remove.delete(key); continue; }
      if (kept.length && !replacementByOld.has(key)) rebase.set(key, { recordId: key, kind: r.kind, retainedIdentityIds: kept,
        originalDeadlines: kept.map((x) => ds.get(x)), retainedProofIds: r.proofIds.filter((p) => records.get(p).identityIds.some((x) => kept.includes(x))),
        requiredStage: "reader_verified_new_epoch_before_old_proof_purge" });
    }
    // A retained child pins its parents. Never widen a scoped deletion into an
    // unrelated parent/child, silently break an FK, or bypass a hold.
    changed = true;
    while (changed) { changed = false; for (const r of records.values()) if (!remove.has(r.id)) for (const p of dependencies(r)) if (remove.has(p)) {
      remove.delete(p); rebase.delete(p); blocked.set(p, "retained_dependent_pins_record"); changed = true;
    } }
    for (const [key, r] of rebase) { r.proposedReplacementCommitmentSha256 = await sha256({ contract: CONTRACT, basis: input.basis, inventoryDigestSha256: inv.digest, ...r }); r.proposedReplacementId = `id_${r.proposedReplacementCommitmentSha256}`; }
    const purgeOrder = topological(records, remove).map((recordId, index) => ({ index, recordId, kind: records.get(recordId).kind,
      condition: "new_storage_contract_scoped_authorization_suppression_and_verified_rebase", closesObligation: false }));
    const gaps = [...remove].filter((key) => records.get(key).unresolved), unknownHorizons = [...ds.values()].some((d) => d.reviewRequired);
    return await finish(blocked.size || unknownHorizons ? "partial" : "planned", { basis: input.basis, asOf: input.asOf, inventoryDigestSha256: inv.digest,
      deletion: request ? { ...request, subjectIds: sortIds(request.subjectIds) } : null,
      holds: [...input.holds].map((x) => ({ ...x, identityIds: sortIds(x.identityIds) })).sort((a, b) => a.id < b.id ? -1 : 1),
      horizonsDigestSha256: h.digest, separatelyRetainedAuditIdentityIds: sortIds([...inv.identities.values()].filter((i) => i.dataClass === "privacy_request" && !target.has(i.id)).map((i) => i.id)),
      deadlines: [...ds.values()].sort((a, b) => a.identity < b.identity ? -1 : 1), purgeOrder, rebase: [...rebase.values()],
      verifiedReplacements: [...replacementByOld.values()].sort((a, b) => a.recordId < b.recordId ? -1 : 1),
      preservedRecordIds: sortIds([...records.keys()].filter((key) => !remove.has(key))), blocked: [...blocked].sort(([a], [b]) => a < b ? -1 : 1).map(([recordId, reasonCode]) => ({ recordId, reasonCode })),
      overdueHoldReviewIds: hold.review, evidenceGap: remove.size > 0 || blocked.size > 0 || unknownHorizons,
      unresolvedGapCount: gaps.length, unresolvedOutcomePreserved: true, originalClocksRenewed: false,
      reasonCodes: [...new Set([...(remove.size ? ["retirement_is_not_resolution"] : []), ...(blocked.size ? ["partial_deletion_requires_review"] : []), ...(unknownHorizons ? ["replay_horizon_unresolved_no_suppression_expiry"] : []), ...(hold.review.length ? ["hold_review_overdue"] : [])])].sort() });
  } catch (error) { return refusal(error); }
}

const STATE_FIELDS = ["epochId", "predecessorEpochId", "predecessorCommitmentSha256", "journalAfterSequence", "journalThroughSequence",
  "journalBoundaryCommitmentSha256", "checkpointCommitmentSha256", "maintenanceCommitmentSha256", "horizonsDigestSha256", "createdAt", "expiresAt", "evidenceGap", "stateCommitmentSha256"];
async function epochState(s, basis, asOf) {
  exact(s, STATE_FIELDS, "epoch_state_mismatch"); id(s.epochId); if (s.predecessorEpochId !== null) id(s.predecessorEpochId);
  need((s.predecessorEpochId === null) === (s.predecessorCommitmentSha256 === null), "epoch_state_mismatch");
  for (const key of ["journalBoundaryCommitmentSha256", "checkpointCommitmentSha256", "maintenanceCommitmentSha256", "horizonsDigestSha256", "stateCommitmentSha256"]) hash(s[key]);
  if (s.predecessorCommitmentSha256 !== null) hash(s.predecessorCommitmentSha256); integer(s.journalAfterSequence); integer(s.journalThroughSequence);
  need(s.journalAfterSequence <= s.journalThroughSequence && s.epochId !== s.predecessorEpochId, "epoch_state_mismatch"); bool(s.evidenceGap);
  notFuture(s.createdAt, asOf); integer(s.expiresAt); need(s.expiresAt > s.createdAt && s.expiresAt <= s.createdAt + 90 * DAY, "epoch_state_mismatch");
  const { stateCommitmentSha256, ...body } = s; need(await sha256({ contract: EPOCH, basis, ...body }) === stateCommitmentSha256, "epoch_commitment_mismatch"); return s;
}
async function predecessor(p, replacement, s, basis, asOf, horizon) {
  if (s.predecessorEpochId === null) { need(p === null && replacement === null, "epoch_state_mismatch"); return null; }
  need(p !== null, "missing_dependency"); exact(p, ["epochId", "stateCommitmentSha256", "createdAt", "expiresAt"], "epoch_state_mismatch");
  need(p.epochId === s.predecessorEpochId && p.stateCommitmentSha256 === s.predecessorCommitmentSha256, "epoch_state_mismatch"); notFuture(p.createdAt, asOf); integer(p.expiresAt);
  need(p.expiresAt > p.createdAt && p.expiresAt <= p.createdAt + 90 * DAY && s.createdAt >= p.createdAt, "epoch_state_mismatch");
  if (replacement === null) return asOf >= p.expiresAt ? "expired_predecessor_requires_horizon_replacement" : null;
  const r = replacement; exact(r, ["anchorId", "predecessorEpochId", "predecessorCommitmentSha256", "createdAt", "verifiedAt", "expiresAt", "coverage", "acknowledgementId", "commitmentSha256"], "invalid_replacement");
  id(r.anchorId); id(r.acknowledgementId); hash(r.commitmentSha256); need(r.predecessorEpochId === p.epochId && r.predecessorCommitmentSha256 === p.stateCommitmentSha256, "invalid_replacement");
  notFuture(r.createdAt, asOf); notFuture(r.verifiedAt, asOf); integer(r.expiresAt); need(r.createdAt >= p.createdAt && r.createdAt <= r.verifiedAt && r.verifiedAt < p.expiresAt && r.expiresAt > r.verifiedAt && r.expiresAt <= r.createdAt + 90 * DAY, "invalid_replacement");
  list(r.coverage, 32); const coverage = new Map(); for (const c of r.coverage) { exact(c, ["routeId", "throughAt"]); id(c.routeId); integer(c.throughAt); need(!coverage.has(c.routeId), "invalid_replacement"); coverage.set(c.routeId, c.throughAt); }
  const { commitmentSha256, ...body } = r; need(await sha256({ contract: "follow-up-retention-replacement-anchor.v1", basis, ...body }) === commitmentSha256, "invalid_replacement");
  if (!horizon.available || asOf >= r.expiresAt || coverage.size !== horizon.normalized.routes.length || horizon.normalized.routes.some((route) => !coverage.has(route.id) || coverage.get(route.id) < route.throughAt || r.expiresAt < route.throughAt)) return "replacement_does_not_cover_all_replay_horizons";
  return null;
}

/** Distinct structural stages. Even reader_verified is not authentication,
 * authority, or permission to execute/restore/retry. An independent trusted
 * latest witness must be acquired by a future authorized adapter; mutually
 * consistent old caller inputs alone cannot reveal a coherent rollback. */
export async function classifyFollowUpRetentionEpoch(options) {
  try {
    const input = freeze(copy(options)); exact(input, ["basis", "asOf", "state", "intent", "d1Commit", "externalAck", "readerVerification", "cursor", "predecessor", "replacementAnchor", "horizons"]); base(input.basis, input.asOf);
    const horizon = await horizons(input.horizons, input.basis, input.asOf), s = await epochState(input.state, input.basis, input.asOf);
    need(s.horizonsDigestSha256 === horizon.digest, "epoch_state_mismatch");
    if (input.cursor !== null) { exact(input.cursor, ["epochId", "stateCommitmentSha256", "afterSequence"], "old_cursor");
      need(input.cursor.epochId === s.epochId && input.cursor.stateCommitmentSha256 === s.stateCommitmentSha256, "old_cursor"); integer(input.cursor.afterSequence, "old_cursor");
      need(input.cursor.afterSequence >= s.journalAfterSequence && input.cursor.afterSequence <= s.journalThroughSequence, "old_cursor"); }
    const stages = [["intent", "external_private"], ["d1Commit", "target_d1"], ["externalAck", "external_private"], ["readerVerification", "reader"]];
    let priorAt = s.createdAt, completed = 0, absent = false;
    for (const [name, storage] of stages) {
      const r = input[name]; if (r === null) { absent = true; continue; }
      need(!absent, "stage_order_invalid"); exact(r, ["stage", "basis", "state", "at", "storage", "acknowledgementId"], "epoch_state_mismatch");
      need(r.stage === name && r.storage === storage && equal(r.basis, input.basis) && equal(r.state, s), "epoch_state_mismatch");
      notFuture(r.at, input.asOf); need(r.at >= priorAt && r.at < s.expiresAt, "stage_order_invalid"); priorAt = r.at;
      if (name === "externalAck") id(r.acknowledgementId); else need(r.acknowledgementId === null, "epoch_state_mismatch"); completed++;
    }
    const predecessorGap = await predecessor(input.predecessor, input.replacementAnchor, s, input.basis, input.asOf, horizon);
    const gap = !horizon.available ? "replay_horizon_unresolved" : input.asOf >= s.expiresAt ? "epoch_expired" : predecessorGap
      ?? ((input.externalAck && !fresh(input.externalAck.at, input.asOf)) || (input.readerVerification && !fresh(input.readerVerification.at, input.asOf)) ? "witness_or_reader_stale" : null);
    const classification = gap ? "unavailable_gap" : ["awaiting_intent", "intent_recorded", "d1_commit_recorded", "external_ack_recorded", "reader_verified_structurally"][completed];
    return await finish(gap || completed < 4 ? "pending" : "classified", { basis: input.basis, asOf: input.asOf, classification, completedStages: completed,
      epochId: s.epochId, stateCommitmentSha256: s.stateCommitmentSha256, evidenceGap: !!gap || s.evidenceGap,
      requiresReadOnlyReconciliation: !!gap || (completed > 0 && completed < 4), reasonCodes: gap ? [gap] : completed < 4 ? ["transition_not_reader_verified"] : ["matching_structural_state_not_authenticated_provenance"] });
  } catch (error) { return refusal(error); }
}
