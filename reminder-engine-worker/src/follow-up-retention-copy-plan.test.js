import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import { FOLLOW_UP_RETENTION_BASIS as BASIS } from "../../functions/lib/follow-up-retention-policy-plan.js";
import {
  FOLLOW_UP_RETENTION_COPY_INVENTORY_CONTRACT as INVENTORY,
  FOLLOW_UP_RETENTION_COPY_PLAN_CONTRACT as CONTRACT,
  FOLLOW_UP_RETENTION_COPY_RECEIPT_CONTRACT as RECEIPT,
  FOLLOW_UP_RETENTION_COPY_STORE_KINDS as STORE_KINDS,
  planFollowUpRetentionCopies as planCopies,
  reconcileFollowUpRetentionCopies as reconcileCopies,
} from "../../functions/lib/follow-up-retention-copy-plan.js";

// Synthetic opaque commitments only. No fixture is a production inventory,
// provider receipt, executable locator, approval, or erasure witness.
const NOW = Date.UTC(2026, 7, 28, 18), sha = (v) => createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");
const id = (v) => `id_${sha(String(v))}`, clone = structuredClone;
const locatorKinds = { d1: "d1_primary_key", r2: "r2_object_version", kv: "kv_key_version", worker_config: "worker_binding_version",
  backup: "backup_member_version", provider: "provider_record_version" };
const operations = { d1: "delete_exact_d1_row", r2: "delete_exact_r2_object_version", kv: "delete_exact_kv_key_version",
  worker_config: "delete_exact_worker_binding_version", backup: "expire_exact_backup_member_version", provider: "delete_exact_provider_record_version" };
function store(kind) {
  const body = { storeId: id(`store:${kind}`), kind, ownerAccountId: id("account"), jurisdiction: ["backup", "provider"].includes(kind) ? "provider_managed" : "us",
    complete: true, deletionOperation: operations[kind], readbackOperation: "read_exact_locator_absence",
    replayThroughAt: ["backup", "provider"].includes(kind) ? NOW - 1000 : null, verifiedAt: NOW };
  return { ...body, commitmentSha256: sha({ contract: "follow-up-retention-copy-store.v1", ...body }) };
}
function copyRow(name, record, kind, role, parents = [], patch = {}) {
  return { copyId: id(`copy:${name}`), recordId: id(`record:${record}`), storeId: id(`store:${kind}`), role,
    locator: { kind: locatorKinds[kind], namespaceCommitmentSha256: sha(`namespace:${kind}`), keyCommitmentSha256: sha(`key:${name}`), version: "v1" },
    contentCommitmentSha256: sha(`content:${name}`), createdAt: NOW - 10000, parentCopyIds: parents.map((x) => id(`copy:${x}`)), holdIds: [],
    replayUntil: ["backup", "provider"].includes(kind) ? NOW - 1 : null, state: "present", ...patch };
}
function logicalPlan() {
  return { planDigestSha256: sha("logical plan"), inventoryDigestSha256: sha("logical inventory"),
    purgeOrder: [{ index: 0, recordId: id("record:child") }, { index: 1, recordId: id("record:parent") }],
    preservedRecordIds: [id("record:kept")], blockedRecordIds: [] };
}
function fixture() {
  const stores = STORE_KINDS.map(store), logical = logicalPlan();
  const copies = [
    copyRow("parent-primary", "parent", "d1", "primary"),
    copyRow("parent-backup", "parent", "backup", "backup", ["parent-primary"]),
    copyRow("parent-provider", "parent", "provider", "provider_mirror", ["parent-primary"]),
    copyRow("child-primary", "child", "d1", "primary", ["parent-primary"]),
    copyRow("child-payload", "child", "r2", "payload", ["child-primary"]),
    copyRow("child-index", "child", "kv", "index", ["child-primary"]),
    copyRow("child-config", "child", "worker_config", "configuration", ["child-primary"]),
    copyRow("kept-primary", "kept", "d1", "primary"),
    copyRow("kept-payload", "kept", "r2", "payload", ["kept-primary"]),
  ];
  const inventory = { contract: INVENTORY, scopeId: id("scope"), capturedAt: NOW, complete: true,
    sections: STORE_KINDS.map((kind) => ({ kind, complete: true, storeIds: stores.filter((s) => s.kind === kind).map((s) => s.storeId) })).sort((a, b) => a.kind < b.kind ? -1 : 1),
    stores, copies, digestSha256: sha("pending") };
  const x = { basis: clone(BASIS), asOf: NOW, logicalPlan: logical, inventory };
  return sealInventory(x);
}
function normalizedInventory(inv) {
  return { contract: inv.contract, scopeId: inv.scopeId, capturedAt: inv.capturedAt, complete: inv.complete,
    sections: inv.sections.map((s) => ({ ...s, storeIds: [...s.storeIds].sort() })).sort((a, b) => a.kind < b.kind ? -1 : 1),
    stores: [...inv.stores].sort((a, b) => a.storeId < b.storeId ? -1 : 1),
    copies: inv.copies.map((c) => ({ ...c, parentCopyIds: [...c.parentCopyIds].sort(), holdIds: [...c.holdIds].sort() })).sort((a, b) => a.copyId < b.copyId ? -1 : 1) };
}
function sealInventory(x) {
  x.inventory.digestSha256 = sha({ basis: x.basis, logicalPlanDigestSha256: x.logicalPlan.planDigestSha256, inventory: normalizedInventory(x.inventory) }); return x;
}
function nonAuthority(r) {
  expect(r).toMatchObject({ contract: CONTRACT, sourceOnly: true, simulation: true, structuralOnly: true, authenticated: false,
    productionReadAuthorized: false, executionAuthorized: false, installationAuthorized: false, adoptionAllowed: false, authority: false,
    authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false, outcomeProven: false, physicalErasureProven: false,
    externalErasureAuthenticated: false, replacementAllowed: false, automaticRetryAllowed: false });
  expect(Object.isFrozen(r)).toBe(true);
}
function sealReceipt(plan, action, patch = {}, reconciliationAt = NOW + 3000) {
  const readback = { operation: action.requiredReadback, observedAt: NOW + 2000, state: "absent", locatorDigestSha256: action.locatorDigestSha256,
    evidenceCommitmentSha256: sha(`absence:${action.copyId}`), ...(patch.readback ?? {}) };
  const body = { contract: RECEIPT, actionId: action.actionId, copyId: action.copyId, storeId: action.storeId, operation: action.operation,
    attemptedAt: NOW + 1000, outcome: "accepted", readback, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "readback")) };
  return { ...body, commitmentSha256: sha({ contract: RECEIPT, basis: BASIS, planDigestSha256: plan.planDigestSha256, ...body }), reconciliationAt };
}
afterEach(() => vi.restoreAllMocks());

describe("complete physical-copy inventory and child-first planning", () => {
  it("covers a primary plus every configured dependent store without touching the preserved record", async () => {
    const x = fixture(), before = clone(x), r = await planCopies(x); expect(r.status).toBe("planned"); nonAuthority(r); expect(x).toEqual(before);
    expect(r).toMatchObject({ originalRecordsCovered: true, dependentCopiesCovered: true, allConfiguredStoreKindsInventoried: true, evidenceGap: true });
    expect(r.actions).toHaveLength(7); expect(r.preservedCopyIds).toEqual([id("copy:kept-payload"), id("copy:kept-primary")].sort());
    const positions = new Map(r.actions.map((a, index) => [a.copyId, index]));
    for (const c of x.inventory.copies) for (const p of c.parentCopyIds) if (positions.has(c.copyId) && positions.has(p)) expect(positions.get(c.copyId)).toBeLessThan(positions.get(p));
    expect(positions.get(id("copy:child-primary"))).toBeLessThan(positions.get(id("copy:parent-primary")));
  });
  it("pins held and replayable copies plus their parents instead of widening or pretending deletion", async () => {
    const x = fixture(); x.inventory.copies.find((c) => c.copyId === id("copy:child-payload")).holdIds = [id("hold")];
    x.inventory.copies.find((c) => c.copyId === id("copy:parent-backup")).replayUntil = NOW + 10000; sealInventory(x);
    const r = await planCopies(x); expect(r.status).toBe("partial"); nonAuthority(r);
    expect(r.blocked).toContainEqual({ copyId: id("copy:child-payload"), recordId: id("record:child"), reasonCode: "hold_blocks_copy_deletion" });
    expect(r.blocked).toContainEqual({ copyId: id("copy:parent-backup"), recordId: id("record:parent"), reasonCode: "replay_horizon_pins_copy" });
    expect(r.blocked).toContainEqual({ copyId: id("copy:child-primary"), recordId: id("record:child"), reasonCode: "hold_blocks_copy_deletion" });
    expect(r.actions.map((a) => a.recordId)).not.toContain(id("record:child"));
    expect(r.actions.map((a) => a.copyId)).not.toContain(id("copy:parent-primary"));
  });
  it.each(["missing_section", "incomplete_section", "missing_store", "missing_copy", "missing_primary", "primary_not_d1", "wrong_locator", "wrong_operation", "unknown_record", "digest"])("refuses an incomplete or unsupported census: %s", async (change) => {
    const x = fixture();
    if (change === "missing_section") x.inventory.sections.pop();
    if (change === "incomplete_section") x.inventory.sections[0].complete = false;
    if (change === "missing_store") x.inventory.stores.pop();
    if (change === "missing_copy") x.inventory.copies = x.inventory.copies.filter((c) => c.recordId !== id("record:kept"));
    if (change === "missing_primary") x.inventory.copies.find((c) => c.copyId === id("copy:child-primary")).role = "projection";
    if (change === "primary_not_d1") { x.inventory.copies.find((c) => c.copyId === id("copy:child-primary")).role = "projection"; x.inventory.copies.find((c) => c.copyId === id("copy:child-payload")).role = "primary"; }
    if (change === "wrong_locator") x.inventory.copies[0].locator.kind = "r2_object_version";
    if (change === "wrong_operation") x.inventory.stores[0].deletionOperation = "generic_delete";
    if (change === "unknown_record") x.inventory.copies[0].recordId = id("record:unknown");
    if (change !== "digest") sealInventory(x); else x.inventory.digestSha256 = sha("wrong");
    const r = await planCopies(x); expect(r.status).toBe("refused"); nonAuthority(r); expect(r).not.toHaveProperty("actions");
  });
  it.each(["missing_parent", "cycle", "wrong_logical_order", "preserved_depends_on_purge", "secondary_not_linked_to_primary"])("refuses unsafe copy dependency structure: %s", async (change) => {
    const x = fixture();
    if (change === "missing_parent") x.inventory.copies[4].parentCopyIds = [id("copy:absent")];
    if (change === "cycle") x.inventory.copies[0].parentCopyIds = [id("copy:parent-backup")];
    if (change === "wrong_logical_order") x.logicalPlan.purgeOrder.reverse().forEach((r, i) => { r.index = i; });
    if (change === "preserved_depends_on_purge") x.inventory.copies.find((c) => c.copyId === id("copy:kept-primary")).parentCopyIds = [id("copy:parent-primary")];
    if (change === "secondary_not_linked_to_primary") x.inventory.copies.find((c) => c.copyId === id("copy:child-payload")).parentCopyIds = [id("copy:parent-primary")];
    sealInventory(x); expect((await planCopies(x)).status).toBe("refused");
  });
  it("requires a physical copy for every logical purge, preserve, and blocked record", async () => {
    const x = fixture(); x.logicalPlan.preservedRecordIds.push(id("record:missing")); sealInventory(x);
    expect((await planCopies(x)).reasonCodes).toEqual(["inventory_incomplete"]);
  });
});

describe("exact-action receipts and read-only absence reconciliation", () => {
  it("classifies every exact locator read back absent while still denying physical/provider erasure proof", async () => {
    const plan = await planCopies(fixture()), sealed = plan.actions.map((a) => sealReceipt(plan, a)), receipts = sealed.map(({ reconciliationAt: _, ...r }) => r);
    const result = await reconcileCopies({ basis: clone(BASIS), asOf: NOW + 3000, plan, receipts });
    expect(result).toMatchObject({ status: "reconciled", classification: "all_planned_copies_read_back_absent", structuralReadbackComplete: true,
      unresolvedOutcomePreserved: true, physicalErasureProven: false, externalErasureAuthenticated: false, automaticRetryAllowed: false }); nonAuthority(result);
    expect(result.results.every((r) => r.status === "read_back_absent")).toBe(true);
  });
  it.each(["missing", "present", "failed", "unknown"])("keeps reconciliation pending for %s action evidence", async (change) => {
    const plan = await planCopies(fixture()), receipts = plan.actions.map((a) => { const { reconciliationAt: _, ...r } = sealReceipt(plan, a); return r; });
    if (change === "missing") receipts.pop(); else { const old = receipts[0]; const patch = change === "present" ? { readback: { state: "present" } }
      : { outcome: change }; const { reconciliationAt: _, ...next } = sealReceipt(plan, plan.actions[0], patch); receipts[0] = next; expect(next.actionId).toBe(old.actionId); }
    const result = await reconcileCopies({ basis: clone(BASIS), asOf: NOW + 3000, plan, receipts }); expect(result.status).toBe("pending"); nonAuthority(result);
    expect(result.classification).toBe("copy_erasure_incomplete"); expect(result.structuralReadbackComplete).toBe(false);
  });
  it.each(["wrong_action", "wrong_copy", "wrong_locator", "tampered", "stale", "before_attempt"])("refuses mismatched receipt/readback evidence: %s", async (change) => {
    const plan = await planCopies(fixture()); let { reconciliationAt: _, ...receipt } = sealReceipt(plan, plan.actions[0]);
    if (change === "wrong_action") receipt.actionId = id("other action");
    if (change === "wrong_copy") receipt.copyId = id("other copy");
    if (change === "wrong_locator") receipt.readback.locatorDigestSha256 = sha("other locator");
    if (change === "stale") receipt.readback.observedAt = NOW - 600001;
    if (change === "before_attempt") receipt.readback.observedAt = receipt.attemptedAt - 1;
    if (change !== "tampered") { const { commitmentSha256: __, ...body } = receipt; receipt.commitmentSha256 = sha({ contract: RECEIPT, basis: BASIS, planDigestSha256: plan.planDigestSha256, ...body }); }
    else receipt.outcome = "failed";
    const result = await reconcileCopies({ basis: clone(BASIS), asOf: NOW + 3000, plan, receipts: [receipt] }); expect(result.status).toBe("refused"); nonAuthority(result);
  });
  it("refuses a modified or caller-invented plan digest", async () => {
    const plan = clone(await planCopies(fixture())); plan.actions[0].operation = "generic_delete";
    expect((await reconcileCopies({ basis: clone(BASIS), asOf: NOW + 3000, plan, receipts: [] })).reasonCodes).toEqual(["plan_mismatch"]);
  });
});

describe("bounded hostile input and source isolation", () => {
  it.each([undefined, null, [], new Date(), NaN, Infinity, -1, 1.5])("refuses malformed input without authority: %s", async (input) => {
    for (const fn of [planCopies, reconcileCopies]) { const r = await fn(input); expect(r.status).toBe("refused"); nonAuthority(r); }
  });
  it("rejects getters without invoking them and snapshots before the first await", async () => {
    const get = vi.fn(() => { throw new Error("private value"); }), bad = fixture(); Object.defineProperty(bad.inventory, "capturedAt", { enumerable: true, get });
    expect((await planCopies(bad)).status).toBe("refused"); expect(get).not.toHaveBeenCalled();
    const x = fixture(), expected = await planCopies(clone(x)), pending = planCopies(x); x.inventory.copies.splice(0); x.asOf += 10000; expect(await pending).toEqual(expected);
  });
  it("never acquires clock, network, credentials, database, or executable storage access", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock forbidden"); });
    nonAuthority(await planCopies(fixture())); expect(network).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../../functions/lib/follow-up-retention-copy-plan.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bprocess\.(?:env|argv)|\b(?:INSERT|DELETE|UPDATE|DROP|ALTER)\s+(?:INTO|FROM|TABLE)\b|\bdb\.(?:prepare|batch|exec)\s*\(/);
  });
});
