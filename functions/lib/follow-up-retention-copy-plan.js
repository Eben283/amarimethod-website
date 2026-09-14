// Pure, source-only physical-copy planning and receipt reconciliation. This
// module never reads a store, executes a delete, authenticates inventory, or
// proves erasure. Future private adapters must resolve opaque locator
// commitments and independently authenticate every inventory and readback.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_RETENTION_BASIS } from "./follow-up-retention-policy-plan.js";

export const FOLLOW_UP_RETENTION_COPY_PLAN_CONTRACT = "follow-up-retention-copy-plan.v1";
export const FOLLOW_UP_RETENTION_COPY_INVENTORY_CONTRACT = "follow-up-retention-copy-inventory.v1";
export const FOLLOW_UP_RETENTION_COPY_RECEIPT_CONTRACT = "follow-up-retention-copy-receipt.v1";
export const FOLLOW_UP_RETENTION_COPY_STORE_KINDS = Object.freeze(["d1", "r2", "kv", "worker_config", "backup", "provider"]);

const CONTRACT = FOLLOW_UP_RETENTION_COPY_PLAN_CONTRACT;
const INVENTORY = FOLLOW_UP_RETENTION_COPY_INVENTORY_CONTRACT;
const RECEIPT = FOLLOW_UP_RETENTION_COPY_RECEIPT_CONTRACT;
const MAX_TIME = 8640000000000000 - 800 * 86400000, FRESH = 10 * 60000;
const ID = /^id_[a-f0-9]{64}$/, HEX = /^[a-f0-9]{64}$/;
const ROLES = new Set(["primary", "projection", "index", "payload", "configuration", "backup", "provider_mirror"]);
const LOCATORS = Object.freeze({ d1: "d1_primary_key", r2: "r2_object_version", kv: "kv_key_version",
  worker_config: "worker_binding_version", backup: "backup_member_version", provider: "provider_record_version" });
const OPERATIONS = Object.freeze({ d1: "delete_exact_d1_row", r2: "delete_exact_r2_object_version", kv: "delete_exact_kv_key_version",
  worker_config: "delete_exact_worker_binding_version", backup: "expire_exact_backup_member_version", provider: "delete_exact_provider_record_version" });
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, structuralOnly: true, authenticated: false,
  productionReadAuthorized: false, executionAuthorized: false, installationAuthorized: false, adoptionAllowed: false,
  authority: false, authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false, outcomeProven: false,
  physicalErasureProven: false, externalErasureAuthenticated: false, replacementAllowed: false, automaticRetryAllowed: false });
const LIMITATIONS = Object.freeze(["caller_supplied_copy_inventory_only", "opaque_locators_require_private_adapter",
  "readback_receipts_not_provider_authenticated", "coherent_inventory_rollback_not_detectable"]);
const SAFE = new Set(["invalid_input", "wrong_basis", "inventory_incomplete", "inventory_not_fresh", "inventory_digest_mismatch",
  "logical_plan_mismatch", "unknown_store_kind", "unsupported_store_capability", "locator_mismatch", "copy_identity_conflict",
  "copy_dependency_missing", "copy_dependency_cycle", "copy_dependency_mismatch", "primary_copy_mismatch", "limit_exceeded",
  "plan_mismatch", "receipt_mismatch", "receipt_not_fresh", "reconciliation_unavailable", "planning_unavailable"]);

function stop(code) { throw new Error(code); }
function need(v, code = "invalid_input") { if (!v) stop(code); }
function plain(v) { return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function exact(v, keys, code = "invalid_input") { need(plain(v) && Object.keys(v).sort().join() === [...keys].sort().join(), code); }
function integer(v, code = "invalid_input") { need(Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME, code); }
function id(v, code = "invalid_input") { need(typeof v === "string" && ID.test(v), code); }
function hash(v, code = "invalid_input") { need(typeof v === "string" && HEX.test(v), code); }
function bool(v, code = "invalid_input") { need(typeof v === "boolean", code); }
function list(v, max, code = "limit_exceeded") { need(Array.isArray(v), "invalid_input"); need(v.length <= max, code); }
function ids(v, max, code = "invalid_input") { list(v, max); for (const x of v) id(x, code); need(new Set(v).size === v.length, "copy_identity_conflict"); }
function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function copy(v, depth = 0, budget = { n: 0 }) {
  need(++budget.n <= 50000 && depth <= 14);
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") { integer(v); return v; }
  if (typeof v === "string") { need(v.length <= 256); return v; }
  need(v && typeof v === "object"); const array = Array.isArray(v); need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
  const ds = Object.getOwnPropertyDescriptors(v), entries = [], length = array ? ds.length.value : null;
  need(!array || length <= 1200, "limit_exceeded"); need(array || Reflect.ownKeys(ds).length <= 64);
  for (const key of Reflect.ownKeys(ds)) {
    if (array && key === "length") continue; const d = ds[key];
    need(typeof key === "string" && key.length <= 80 && d.enumerable && Object.hasOwn(d, "value")
      && (!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length)));
    entries.push([key, copy(d.value, depth + 1, budget)]);
  }
  if (!array) return Object.fromEntries(entries); need(entries.length === length); const out = new Array(length);
  for (const [key, value] of entries) out[Number(key)] = value; return out;
}
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const sorted = (v) => [...v].sort();
function envelope(status, values = {}) { return freeze({ contract: CONTRACT, ...FLAGS, status, limitations: [...LIMITATIONS], reasonCodes: [], ...values }); }
function refusal(error, fallback) { const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
  return envelope("refused", { planDigestSha256: null, reasonCodes: [SAFE.has(code) ? code : fallback] }); }
function basis(v) { exact(v, Object.keys(FOLLOW_UP_RETENTION_BASIS)); need(equal(v, FOLLOW_UP_RETENTION_BASIS), "wrong_basis"); }
function fresh(at, asOf, code = "inventory_not_fresh") { integer(at, code); need(at <= asOf && asOf - at <= FRESH, code); }

function logicalPlan(value) {
  exact(value, ["planDigestSha256", "inventoryDigestSha256", "purgeOrder", "preservedRecordIds", "blockedRecordIds"], "logical_plan_mismatch");
  hash(value.planDigestSha256, "logical_plan_mismatch"); hash(value.inventoryDigestSha256, "logical_plan_mismatch");
  list(value.purgeOrder, 200); ids(value.preservedRecordIds, 200, "logical_plan_mismatch"); ids(value.blockedRecordIds, 200, "logical_plan_mismatch");
  const purge = new Map();
  for (let index = 0; index < value.purgeOrder.length; index++) { const row = value.purgeOrder[index];
    exact(row, ["index", "recordId"], "logical_plan_mismatch"); integer(row.index, "logical_plan_mismatch"); id(row.recordId, "logical_plan_mismatch");
    need(row.index === index && !purge.has(row.recordId), "logical_plan_mismatch"); purge.set(row.recordId, index); }
  const preserved = new Set(value.preservedRecordIds); need([...purge.keys()].every((x) => !preserved.has(x)), "logical_plan_mismatch");
  need(value.blockedRecordIds.every((x) => preserved.has(x)), "logical_plan_mismatch");
  return { normalized: { ...value, preservedRecordIds: sorted(value.preservedRecordIds), blockedRecordIds: sorted(value.blockedRecordIds) }, purge, preserved };
}
async function store(raw, asOf) {
  exact(raw, ["storeId", "kind", "ownerAccountId", "jurisdiction", "complete", "deletionOperation", "readbackOperation",
    "replayThroughAt", "verifiedAt", "commitmentSha256"], "inventory_incomplete");
  id(raw.storeId, "inventory_incomplete"); id(raw.ownerAccountId, "inventory_incomplete");
  need(FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(raw.kind), "unknown_store_kind");
  need(["us", "eu", "provider_managed"].includes(raw.jurisdiction), "inventory_incomplete"); bool(raw.complete, "inventory_incomplete"); need(raw.complete, "inventory_incomplete");
  need(raw.deletionOperation === OPERATIONS[raw.kind] && raw.readbackOperation === "read_exact_locator_absence", "unsupported_store_capability");
  if (raw.replayThroughAt !== null) integer(raw.replayThroughAt, "inventory_incomplete");
  need(raw.kind === "backup" || raw.kind === "provider" ? raw.replayThroughAt !== null : raw.replayThroughAt === null, "inventory_incomplete");
  fresh(raw.verifiedAt, asOf); hash(raw.commitmentSha256, "inventory_incomplete");
  const { commitmentSha256, ...body } = raw; need(await sha256({ contract: "follow-up-retention-copy-store.v1", ...body }) === commitmentSha256, "inventory_digest_mismatch");
  return raw;
}
async function locator(value, kind) {
  exact(value, ["kind", "namespaceCommitmentSha256", "keyCommitmentSha256", "version"], "locator_mismatch");
  need(value.kind === LOCATORS[kind], "locator_mismatch"); hash(value.namespaceCommitmentSha256, "locator_mismatch"); hash(value.keyCommitmentSha256, "locator_mismatch");
  need(typeof value.version === "string" && /^[A-Za-z0-9:_.-]{1,128}$/.test(value.version), "locator_mismatch");
  return { value, digest: await sha256({ contract: "follow-up-retention-copy-locator.v1", ...value }) };
}
async function inventory(value, lp, inputBasis, asOf) {
  exact(value, ["contract", "scopeId", "capturedAt", "complete", "sections", "stores", "copies", "digestSha256"], "inventory_incomplete");
  need(value.contract === INVENTORY, "inventory_incomplete"); id(value.scopeId, "inventory_incomplete"); bool(value.complete, "inventory_incomplete"); need(value.complete, "inventory_incomplete");
  fresh(value.capturedAt, asOf); list(value.sections, FOLLOW_UP_RETENTION_COPY_STORE_KINDS.length); list(value.stores, 64); list(value.copies, 600);
  hash(value.digestSha256, "inventory_incomplete"); const stores = new Map();
  for (const raw of value.stores) { const s = await store(raw, asOf); need(!stores.has(s.storeId), "copy_identity_conflict"); stores.set(s.storeId, s); }
  const sections = new Map();
  for (const section of value.sections) { exact(section, ["kind", "complete", "storeIds"], "inventory_incomplete");
    need(FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(section.kind) && !sections.has(section.kind), "inventory_incomplete"); bool(section.complete, "inventory_incomplete"); need(section.complete, "inventory_incomplete");
    ids(section.storeIds, 64, "inventory_incomplete"); sections.set(section.kind, sorted(section.storeIds)); }
  need(sections.size === FOLLOW_UP_RETENTION_COPY_STORE_KINDS.length, "inventory_incomplete");
  for (const kind of FOLLOW_UP_RETENTION_COPY_STORE_KINDS) need(equal(sections.get(kind), sorted([...stores.values()].filter((s) => s.kind === kind).map((s) => s.storeId))), "inventory_incomplete");
  const knownRecords = new Set([...lp.purge.keys(), ...lp.preserved]), copies = new Map();
  for (const raw of value.copies) {
    exact(raw, ["copyId", "recordId", "storeId", "role", "locator", "contentCommitmentSha256", "createdAt", "parentCopyIds", "holdIds", "replayUntil", "state"], "inventory_incomplete");
    id(raw.copyId, "inventory_incomplete"); id(raw.recordId, "inventory_incomplete"); id(raw.storeId, "inventory_incomplete");
    need(!copies.has(raw.copyId), "copy_identity_conflict"); need(knownRecords.has(raw.recordId), "logical_plan_mismatch");
    const s = stores.get(raw.storeId); need(s, "inventory_incomplete"); need(ROLES.has(raw.role), "inventory_incomplete");
    const loc = await locator(raw.locator, s.kind); hash(raw.contentCommitmentSha256, "inventory_incomplete"); integer(raw.createdAt, "inventory_incomplete"); need(raw.createdAt <= value.capturedAt, "inventory_incomplete");
    ids(raw.parentCopyIds, 32, "inventory_incomplete"); ids(raw.holdIds, 32, "inventory_incomplete"); if (raw.replayUntil !== null) integer(raw.replayUntil, "inventory_incomplete");
    need(raw.state === "present", "inventory_incomplete");
    const replayFloor = s.replayThroughAt; need(replayFloor === null || (raw.replayUntil !== null && raw.replayUntil >= replayFloor), "inventory_incomplete");
    copies.set(raw.copyId, { ...raw, parentCopyIds: sorted(raw.parentCopyIds), holdIds: sorted(raw.holdIds), locatorDigestSha256: loc.digest });
  }
  for (const recordId of knownRecords) { const owned = [...copies.values()].filter((c) => c.recordId === recordId); need(owned.length > 0, "inventory_incomplete");
    const primary = owned.filter((c) => c.role === "primary");
    need(primary.length === 1 && stores.get(primary[0].storeId).kind === "d1", "primary_copy_mismatch"); }
  for (const c of copies.values()) for (const parentId of c.parentCopyIds) {
    const p = copies.get(parentId); need(p && p.copyId !== c.copyId, "copy_dependency_missing");
    if (lp.purge.has(c.recordId) && lp.purge.has(p.recordId)) need(lp.purge.get(c.recordId) <= lp.purge.get(p.recordId), "copy_dependency_mismatch");
    if (lp.preserved.has(c.recordId)) need(lp.preserved.has(p.recordId), "copy_dependency_mismatch");
  }
  const visiting = new Set(), done = new Set();
  function visit(key) { need(!visiting.has(key), "copy_dependency_cycle"); if (done.has(key)) return; visiting.add(key);
    for (const p of copies.get(key).parentCopyIds) visit(p); visiting.delete(key); done.add(key); }
  for (const key of copies.keys()) visit(key);
  for (const recordId of knownRecords) { const owned = [...copies.values()].filter((c) => c.recordId === recordId), primary = owned.find((c) => c.role === "primary").copyId;
    const reaches = (key, seen = new Set()) => key === primary || (!seen.has(key) && (seen.add(key), copies.get(key).parentCopyIds.some((p) => reaches(p, seen))));
    need(owned.every((c) => reaches(c.copyId)), "primary_copy_mismatch"); }
  const normalized = { contract: INVENTORY, scopeId: value.scopeId, capturedAt: value.capturedAt, complete: true,
    sections: [...sections].sort(([a], [b]) => a < b ? -1 : 1).map(([kind, storeIds]) => ({ kind, complete: true, storeIds })),
    stores: [...stores.values()].sort((a, b) => a.storeId < b.storeId ? -1 : 1),
    copies: [...copies.values()].sort((a, b) => a.copyId < b.copyId ? -1 : 1).map(({ locatorDigestSha256: _, ...c }) => c) };
  need(new TextEncoder().encode(canonicalJson(normalized)).length <= 1500000, "limit_exceeded");
  need(await sha256({ basis: inputBasis, logicalPlanDigestSha256: lp.normalized.planDigestSha256, inventory: normalized }) === value.digestSha256, "inventory_digest_mismatch");
  return { stores, copies, normalized, digest: value.digestSha256 };
}
function childFirst(copies, selected, priority) {
  const incoming = new Map([...selected].map((key) => [key, 0]));
  for (const key of selected) for (const parent of copies.get(key).parentCopyIds) if (selected.has(parent)) incoming.set(parent, incoming.get(parent) + 1);
  const compare = (a, b) => priority.get(copies.get(a).recordId) - priority.get(copies.get(b).recordId) || (a < b ? -1 : a > b ? 1 : 0);
  const ready = [...selected].filter((key) => incoming.get(key) === 0).sort(compare), order = [];
  while (ready.length) { const key = ready.shift(); order.push(key);
    for (const parent of copies.get(key).parentCopyIds) if (selected.has(parent)) { incoming.set(parent, incoming.get(parent) - 1);
      if (incoming.get(parent) === 0) { ready.push(parent); ready.sort(compare); } } }
  need(order.length === selected.size, "copy_dependency_cycle"); return order;
}

/** Plans exact-copy actions only. It cannot execute them or elevate a logical
 * retention plan into authenticated inventory or deletion authority. */
export async function planFollowUpRetentionCopies(options) {
  try {
    const input = freeze(copy(options)); exact(input, ["basis", "asOf", "logicalPlan", "inventory"]); basis(input.basis); integer(input.asOf);
    const lp = logicalPlan(input.logicalPlan), inv = await inventory(input.inventory, lp, input.basis, input.asOf);
    const remove = new Set([...inv.copies.values()].filter((c) => lp.purge.has(c.recordId)).map((c) => c.copyId)), blocked = new Map();
    // A hold is a record-level preservation constraint even when a future
    // authenticated adapter discovers it while enumerating only one copy.
    const heldRecords = new Set([...inv.copies.values()].filter((c) => c.holdIds.length).map((c) => c.recordId));
    for (const key of [...remove]) { const c = inv.copies.get(key);
      if (heldRecords.has(c.recordId)) { remove.delete(key); blocked.set(key, "hold_blocks_copy_deletion"); }
      else if (c.replayUntil !== null && input.asOf < c.replayUntil) { remove.delete(key); blocked.set(key, "replay_horizon_pins_copy"); }
    }
    let changed = true;
    while (changed) { changed = false; for (const c of inv.copies.values()) if (!remove.has(c.copyId)) for (const p of c.parentCopyIds) if (remove.has(p)) {
      remove.delete(p); blocked.set(p, "retained_dependent_pins_copy"); changed = true; } }
    const order = childFirst(inv.copies, remove, lp.purge), actions = [];
    for (let index = 0; index < order.length; index++) { const c = inv.copies.get(order[index]), s = inv.stores.get(c.storeId);
      const body = { index, copyId: c.copyId, recordId: c.recordId, storeId: c.storeId, storeKind: s.kind, role: c.role,
        parentCopyIds: c.parentCopyIds.filter((p) => remove.has(p)), locatorDigestSha256: c.locatorDigestSha256,
        contentCommitmentSha256: c.contentCommitmentSha256, operation: s.deletionOperation,
        requiredReadback: s.readbackOperation, logicalPlanDigestSha256: lp.normalized.planDigestSha256, inventoryDigestSha256: inv.digest };
      actions.push({ actionId: `id_${await sha256({ contract: "follow-up-retention-copy-action.v1", basis: input.basis, ...body })}`, ...body }); }
    const values = { basis: input.basis, asOf: input.asOf, logicalPlan: lp.normalized, inventoryDigestSha256: inv.digest, actions,
      blocked: [...blocked].sort(([a], [b]) => a < b ? -1 : 1).map(([copyId, reasonCode]) => ({ copyId, recordId: inv.copies.get(copyId).recordId, reasonCode })),
      preservedCopyIds: sorted([...inv.copies.keys()].filter((key) => !remove.has(key))), evidenceGap: actions.length > 0 || blocked.size > 0,
      originalRecordsCovered: true, dependentCopiesCovered: true, allConfiguredStoreKindsInventoried: true };
    return envelope(blocked.size ? "partial" : "planned", { ...values, planDigestSha256: await sha256({ contract: CONTRACT, ...values }) });
  } catch (error) { return refusal(error, "planning_unavailable"); }
}

async function checkedPlan(value, inputBasis) {
  exact(value, ["contract", ...Object.keys(FLAGS), "status", "limitations", "reasonCodes", "basis", "asOf", "logicalPlan", "inventoryDigestSha256", "actions",
    "blocked", "preservedCopyIds", "evidenceGap", "originalRecordsCovered", "dependentCopiesCovered", "allConfiguredStoreKindsInventoried", "planDigestSha256"], "plan_mismatch");
  need(value.contract === CONTRACT && ["planned", "partial"].includes(value.status), "plan_mismatch");
  for (const [key, expected] of Object.entries(FLAGS)) need(value[key] === expected, "plan_mismatch"); need(equal(value.basis, inputBasis), "wrong_basis"); integer(value.asOf, "plan_mismatch");
  hash(value.inventoryDigestSha256, "plan_mismatch"); hash(value.planDigestSha256, "plan_mismatch"); list(value.actions, 600); list(value.blocked, 600); ids(value.preservedCopyIds, 600, "plan_mismatch");
  need(equal(value.limitations, LIMITATIONS) && Array.isArray(value.reasonCodes) && value.reasonCodes.length === 0, "plan_mismatch");
  for (const key of ["evidenceGap", "originalRecordsCovered", "dependentCopiesCovered", "allConfiguredStoreKindsInventoried"]) bool(value[key], "plan_mismatch");
  const lp = logicalPlan(value.logicalPlan); need(value.inventoryDigestSha256.length === 64, "plan_mismatch");
  const actionIds = new Set(), copyIds = new Set();
  for (let index = 0; index < value.actions.length; index++) { const a = value.actions[index];
    exact(a, ["actionId", "index", "copyId", "recordId", "storeId", "storeKind", "role", "parentCopyIds", "locatorDigestSha256", "contentCommitmentSha256",
      "operation", "requiredReadback", "logicalPlanDigestSha256", "inventoryDigestSha256"], "plan_mismatch");
    id(a.actionId, "plan_mismatch"); id(a.copyId, "plan_mismatch"); id(a.recordId, "plan_mismatch"); id(a.storeId, "plan_mismatch"); integer(a.index, "plan_mismatch");
    need(a.index === index && !actionIds.has(a.actionId) && !copyIds.has(a.copyId), "plan_mismatch"); actionIds.add(a.actionId); copyIds.add(a.copyId);
    need(FOLLOW_UP_RETENTION_COPY_STORE_KINDS.includes(a.storeKind) && ROLES.has(a.role) && a.operation === OPERATIONS[a.storeKind]
      && a.requiredReadback === "read_exact_locator_absence", "plan_mismatch");
    ids(a.parentCopyIds, 32, "plan_mismatch");
    for (const h of ["locatorDigestSha256", "contentCommitmentSha256", "logicalPlanDigestSha256", "inventoryDigestSha256"]) hash(a[h], "plan_mismatch");
    need(lp.purge.has(a.recordId) && a.logicalPlanDigestSha256 === lp.normalized.planDigestSha256 && a.inventoryDigestSha256 === value.inventoryDigestSha256, "plan_mismatch");
    const { actionId, ...body } = a;
    need(actionId === `id_${await sha256({ contract: "follow-up-retention-copy-action.v1", basis: inputBasis, ...body })}`, "plan_mismatch");
  }
  const positions = new Map(value.actions.map((a) => [a.copyId, a.index]));
  for (let index = 0; index < value.actions.length; index++) { const a = value.actions[index];
    if (index > 0) need(lp.purge.get(value.actions[index - 1].recordId) <= lp.purge.get(a.recordId), "plan_mismatch");
    need(a.parentCopyIds.every((p) => positions.has(p) && positions.get(p) > index), "plan_mismatch"); }
  const blockedCopies = new Set();
  for (const b of value.blocked) { exact(b, ["copyId", "recordId", "reasonCode"], "plan_mismatch"); id(b.copyId, "plan_mismatch"); id(b.recordId, "plan_mismatch");
    need(lp.purge.has(b.recordId) && !blockedCopies.has(b.copyId) && ["hold_blocks_copy_deletion", "replay_horizon_pins_copy", "retained_dependent_pins_copy"].includes(b.reasonCode), "plan_mismatch");
    blockedCopies.add(b.copyId); }
  need(value.status === (value.blocked.length ? "partial" : "planned") && value.evidenceGap === (value.actions.length > 0 || value.blocked.length > 0)
    && value.originalRecordsCovered && value.dependentCopiesCovered && value.allConfiguredStoreKindsInventoried, "plan_mismatch");
  need(value.preservedCopyIds.every((x) => !copyIds.has(x)) && [...blockedCopies].every((x) => value.preservedCopyIds.includes(x)), "plan_mismatch");
  return value;
}

/** Reconciles committed receipt envelopes and exact-locator absence readbacks.
 * Even a complete result is structural evidence, not authenticated provider
 * erasure, retry permission, or closure of unresolved CRM work. */
export async function reconcileFollowUpRetentionCopies(options) {
  try {
    const input = freeze(copy(options)); exact(input, ["basis", "asOf", "plan", "receipts"]); basis(input.basis); integer(input.asOf);
    const plan = await checkedPlan(input.plan, input.basis);
    const digestValues = { basis: plan.basis, asOf: plan.asOf, logicalPlan: plan.logicalPlan, inventoryDigestSha256: plan.inventoryDigestSha256,
      actions: plan.actions, blocked: plan.blocked, preservedCopyIds: plan.preservedCopyIds, evidenceGap: plan.evidenceGap,
      originalRecordsCovered: plan.originalRecordsCovered, dependentCopiesCovered: plan.dependentCopiesCovered,
      allConfiguredStoreKindsInventoried: plan.allConfiguredStoreKindsInventoried };
    need(await sha256({ contract: CONTRACT, ...digestValues }) === plan.planDigestSha256, "plan_mismatch");
    list(input.receipts, 600); const actions = new Map(plan.actions.map((a) => [a.actionId, a])), receipts = new Map();
    for (const r of input.receipts) {
      exact(r, ["contract", "actionId", "copyId", "storeId", "operation", "attemptedAt", "outcome", "readback", "commitmentSha256"], "receipt_mismatch");
      need(r.contract === RECEIPT && !receipts.has(r.actionId), "receipt_mismatch"); const a = actions.get(r.actionId); need(a, "receipt_mismatch");
      need(r.copyId === a.copyId && r.storeId === a.storeId && r.operation === a.operation && ["accepted", "not_found", "failed", "unknown"].includes(r.outcome), "receipt_mismatch");
      integer(r.attemptedAt, "receipt_mismatch"); need(r.attemptedAt >= plan.asOf && r.attemptedAt <= input.asOf, "receipt_mismatch");
      exact(r.readback, ["operation", "observedAt", "state", "locatorDigestSha256", "evidenceCommitmentSha256"], "receipt_mismatch");
      need(r.readback.operation === a.requiredReadback && ["absent", "present", "unknown"].includes(r.readback.state)
        && r.readback.locatorDigestSha256 === a.locatorDigestSha256, "receipt_mismatch");
      fresh(r.readback.observedAt, input.asOf, "receipt_not_fresh"); need(r.readback.observedAt >= r.attemptedAt, "receipt_mismatch"); hash(r.readback.evidenceCommitmentSha256, "receipt_mismatch"); hash(r.commitmentSha256, "receipt_mismatch");
      const { commitmentSha256, ...body } = r; need(await sha256({ contract: RECEIPT, basis: input.basis, planDigestSha256: plan.planDigestSha256, ...body }) === commitmentSha256, "receipt_mismatch");
      receipts.set(r.actionId, r);
    }
    const results = plan.actions.map((a) => { const r = receipts.get(a.actionId), absent = !!r && ["accepted", "not_found"].includes(r.outcome) && r.readback.state === "absent";
      return { actionId: a.actionId, copyId: a.copyId, status: absent ? "read_back_absent" : !r ? "receipt_missing" : "not_proven_absent" }; });
    const complete = plan.blocked.length === 0 && results.every((r) => r.status === "read_back_absent");
    const values = { basis: input.basis, asOf: input.asOf, planDigestSha256: plan.planDigestSha256, classification: complete ? "all_planned_copies_read_back_absent" : "copy_erasure_incomplete",
      results, blocked: plan.blocked, structuralReadbackComplete: complete, unresolvedOutcomePreserved: true, automaticRetryAllowed: false,
      physicalErasureProven: false, externalErasureAuthenticated: false };
    return envelope(complete ? "reconciled" : "pending", { ...values, reconciliationDigestSha256: await sha256({ contract: "follow-up-retention-copy-reconciliation.v1", ...values }) });
  } catch (error) { return refusal(error, "reconciliation_unavailable"); }
}
