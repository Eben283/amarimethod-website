import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import { FOLLOW_UP_RETENTION_BASIS as BASIS } from "../../functions/lib/follow-up-retention-policy-plan.js";
import { FOLLOW_UP_RETENTION_COPY_STORE_KINDS as KINDS } from "../../functions/lib/follow-up-retention-copy-plan.js";
import {
  FOLLOW_UP_RETENTION_COPY_ADAPTER_FLAGS as FLAGS,
  FOLLOW_UP_RETENTION_INVENTORY_PAGE_CONTRACT as PAGE,
  FOLLOW_UP_RETENTION_PURGE_CAPABILITY_CONTRACT as CAPABILITY,
  createFollowUpRetentionCopyAdapters,
  followUpRetentionInventoryPageSigningBytes,
  followUpRetentionPurgeCapabilitySigningBytes,
} from "../../scripts/lib/follow-up-retention-copy-adapters.mjs";

// Synthetic commitments and keys only. No fixture names a production resource,
// provider locator, credential, executable endpoint or approved delete.
const NOW = Date.UTC(2026, 7, 28, 20), clone = structuredClone;
const sha = value => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const id = value => `id_${sha(String(value))}`;
const LOCATORS = { d1: "d1_primary_key", r2: "r2_object_version", kv: "kv_key_version", worker_config: "worker_binding_version",
  backup: "backup_member_version", provider: "provider_record_version" };
const OPERATIONS = { d1: "delete_exact_d1_row", r2: "delete_exact_r2_object_version", kv: "delete_exact_kv_key_version",
  worker_config: "delete_exact_worker_binding_version", backup: "expire_exact_backup_member_version", provider: "delete_exact_provider_record_version" };

function store(kind) {
  const body = { storeId: id(`store:${kind}`), kind, ownerAccountId: id("account"), jurisdiction: ["backup", "provider"].includes(kind) ? "provider_managed" : "us",
    complete: true, deletionOperation: OPERATIONS[kind], readbackOperation: "read_exact_locator_absence",
    replayThroughAt: ["backup", "provider"].includes(kind) ? NOW - 1000 : null, verifiedAt: NOW };
  return { ...body, commitmentSha256: sha({ contract: "follow-up-retention-copy-store.v1", ...body }) };
}
function row(name, record, kind, role, parents = []) {
  return { copyId: id(`copy:${name}`), recordId: id(`record:${record}`), storeId: id(`store:${kind}`), role,
    locator: { kind: LOCATORS[kind], namespaceCommitmentSha256: sha(`namespace:${kind}`), keyCommitmentSha256: sha(`key:${name}`), version: "v1" },
    contentCommitmentSha256: sha(`content:${name}`), createdAt: NOW - 1000, parentCopyIds: parents.map(value => id(`copy:${value}`)), holdIds: [],
    replayUntil: ["backup", "provider"].includes(kind) ? NOW - 1 : null, state: "present" };
}
function records() {
  return [
    row("parent-primary", "parent", "d1", "primary"),
    row("child-primary", "child", "d1", "primary", ["parent-primary"]),
    row("kept-primary", "kept", "d1", "primary"),
    row("child-payload", "child", "r2", "payload", ["child-primary"]),
    row("child-index", "child", "kv", "index", ["child-primary"]),
    row("child-config", "child", "worker_config", "configuration", ["child-primary"]),
    row("parent-backup", "parent", "backup", "backup", ["parent-primary"]),
    row("parent-provider", "parent", "provider", "provider_mirror", ["parent-primary"]),
  ];
}
function logicalPlan() {
  return { planDigestSha256: sha("logical-plan"), inventoryDigestSha256: sha("logical-inventory"),
    purgeOrder: [{ index: 0, recordId: id("record:child") }, { index: 1, recordId: id("record:parent") }],
    preservedRecordIds: [id("record:kept")], blockedRecordIds: [] };
}
function signed(body, keyId, privateKey, bytes) {
  return { body, keyId, signature: sign(null, bytes(body), privateKey).toString("base64") };
}
function fixture() {
  const state = { time: NOW, deny: false, pageFault: null, capabilityFault: null, pageCalls: [], inspectCalls: [] };
  const scope = { scopeId: id("scope"), accountId: id("account"), d1CatalogDigestSha256: sha("catalog"), sourceRevision: "a".repeat(40) };
  const allStores = KINDS.map(store), allRows = records(), collectorKeys = new Map(), inspectorKeys = new Map();
  const collectors = KINDS.map(kind => {
    const pair = generateKeyPairSync("ed25519"), partyId = id(`collector:${kind}`), keyId = id(`collector-key:${kind}`); let previousDigest = null; collectorKeys.set(kind, pair);
    const releaseDigestSha256 = sha(`collector-release:${kind}`);
    return { kind, partyId, keyId, publicKey: pair.publicKey, releaseDigestSha256, readPage: async request => {
      state.pageCalls.push(clone(request)); const body = { contract: PAGE, scopeId: scope.scopeId, accountId: scope.accountId, sourceRevision: scope.sourceRevision,
        kind, collectorId: partyId, collectorReleaseDigestSha256: releaseDigestSha256,
        sessionId: request.sessionId, requestDigestSha256: sha(request), snapshotId: request.sessionId,
        catalogDigestSha256: kind === "d1" ? scope.d1CatalogDigestSha256 : null, pageIndex: request.pageIndex, previousPageDigestSha256: previousDigest,
        capturedAt: request.asOf, expiresAt: request.asOf + 30_000, nextCursor: null, complete: true,
        stores: request.pageIndex === 0 ? allStores.filter(value => value.kind === kind) : [],
        copies: request.pageIndex === 0 ? allRows.filter(value => value.storeId === id(`store:${kind}`)) : [] };
      if (state.pageFault === "forged" && kind === "r2") return signed(body, keyId, generateKeyPairSync("ed25519").privateKey, followUpRetentionInventoryPageSigningBytes);
      if (state.pageFault === "catalog" && kind === "d1") body.catalogDigestSha256 = sha("wrong");
      if (state.pageFault === "release" && kind === "d1") body.collectorReleaseDigestSha256 = sha("wrong release");
      if (state.pageFault === "stale" && kind === "kv") body.expiresAt = request.asOf;
      if (state.pageFault === "request" && kind === "provider") body.requestDigestSha256 = sha("other request");
      if (state.pageFault === "cross_kind" && kind === "r2") body.copies[0].storeId = id("store:kv");
      if (state.pageFault === "cohort_expiry" && kind === "d1") body.expiresAt = state.time + 100;
      if (state.pageFault === "cohort_expiry" && kind === "provider") state.time += 200;
      if (state.pageFault === "two_page" && kind === "r2" && request.pageIndex === 0) { body.complete = false; body.nextCursor = id("cursor:r2:1"); }
      if (state.pageFault === "unterminated" && kind === "backup") { body.complete = false; body.nextCursor = id(`cursor:${request.pageIndex}`); }
      const envelope = signed(body, keyId, pair.privateKey, followUpRetentionInventoryPageSigningBytes); previousDigest = sha(body); return envelope;
    } };
  });
  const purgeInspectors = KINDS.map(kind => {
    const pair = generateKeyPairSync("ed25519"), partyId = id(`inspector:${kind}`), keyId = id(`inspector-key:${kind}`); inspectorKeys.set(kind, pair);
    const releaseDigestSha256 = sha(`executor:${kind}`);
    return { kind, partyId, keyId, publicKey: pair.publicKey, releaseDigestSha256, inspect: async request => {
      state.inspectCalls.push(clone(request)); const body = { contract: CAPABILITY, scopeId: scope.scopeId, accountId: scope.accountId,
        sourceRevision: scope.sourceRevision, kind, inspectorId: partyId,
        sessionId: request.sessionId, requestDigestSha256: sha(request), actionId: request.actionId, storeId: request.storeId, operation: request.operation,
        readbackOperation: request.readbackOperation, locatorDigestSha256: request.locatorDigestSha256, mode: "inspect_only", issuedAt: state.time,
        expiresAt: state.time + 30_000, executorReleaseDigestSha256: releaseDigestSha256 };
      if (state.capabilityFault === "action") body.actionId = id("other action");
      if (state.capabilityFault === "release") body.executorReleaseDigestSha256 = sha("wrong release");
      if (state.capabilityFault === "stale") body.expiresAt = state.time;
      if (state.capabilityFault === "cohort_expiry" && state.inspectCalls.length === 1) body.expiresAt = state.time + 100;
      if (state.capabilityFault === "cohort_expiry" && state.inspectCalls.length === 7) state.time += 200;
      const signer = state.capabilityFault === "forged" ? generateKeyPairSync("ed25519").privateKey : pair.privateKey;
      return signed(body, keyId, signer, followUpRetentionPurgeCapabilitySigningBytes);
    } };
  });
  const authorize = vi.fn(async request => ({ version: "follow-up-retention-copy-access.v1", scopeId: request.scopeId, accountId: request.accountId,
    resource: request.resource, purpose: request.purpose, sessionId: request.sessionId, nonce: request.nonce, issuedAt: state.time,
    expiresAt: state.deny ? state.time : state.time + 30_000 }));
  const config = { scope, collectors, purgeInspectors, authorize, clock: () => state.time, timeoutMs: 1000 };
  return { state, scope, config, allRows, allStores, collectorKeys, inspectorKeys };
}
function expectNonAuthority(value) {
  expect(value).toMatchObject({ ...FLAGS, authority: false, executionAllowed: false, deletionAllowed: false, retryAllowed: false,
    deletionMethodsExposed: [], unknownOutcomePolicy: "read_only_exact_locator_reconciliation_no_retry" }); expect(Object.isFrozen(value)).toBe(true);
}
afterEach(() => vi.restoreAllMocks());

describe("authenticated, cursor-closed copy inventory", () => {
  it("collects all six signed sections, validates through the existing planner and exposes no mutation", async () => {
    const f = fixture(), adapter = createFollowUpRetentionCopyAdapters(f.config), input = { basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW }, before = clone(input);
    expect(Object.keys(adapter).sort()).toEqual(["collectAndPlan", "inspectCapabilities"]); const result = await adapter.collectAndPlan(input);
    expect(input).toEqual(before); expect(result).toMatchObject({ status: "collected", cryptographicInventoryAuthentication: true, currentAccessChecked: true,
      collectorPageCount: 6, configuredStoreKindsComplete: true }); expect(result.inventory.sections).toHaveLength(6); expect(result.inventory.copies).toHaveLength(8);
    expect(result.plan.status).toBe("planned"); expect(result.plan.actions.length).toBe(7); expectNonAuthority(result);
    expect(f.config.authorize).toHaveBeenCalledTimes(6); expect(new Set(f.state.pageCalls.map(request => request.sessionId)).size).toBe(1);
  });
  it("requires request-bound signatures, exact D1 catalog, current page deadlines and same-kind stores", async () => {
    for (const fault of ["forged", "catalog", "release", "stale", "request", "cross_kind"]) {
      const f = fixture(); f.state.pageFault = fault; const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
      expect(result.status).toBe("refused"); expect(result.cryptographicInventoryAuthentication).toBe(false); expectNonAuthority(result);
    }
  });
  it("accepts a signed linked cursor chain only after its explicit terminal page", async () => {
    const f = fixture(); f.state.pageFault = "two_page"; const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    expect(result).toMatchObject({ status: "collected", collectorPageCount: 7, configuredStoreKindsComplete: true });
    const pages = f.state.pageCalls.filter(request => request.kind === "r2"); expect(pages).toHaveLength(2); expect(pages[1]).toMatchObject({ pageIndex: 1, cursor: id("cursor:r2:1") });
  });
  it("refuses a collector that never produces a terminal page", async () => {
    const f = fixture(); f.state.pageFault = "unterminated"; const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["page_chain_incomplete"] }); expect(f.state.pageCalls.filter(request => request.kind === "backup")).toHaveLength(32);
  });
  it("requires present access independently of a valid collector signature", async () => {
    const f = fixture(); f.state.deny = true; const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["access_denied"], currentAccessChecked: false }); expect(f.state.pageCalls).toHaveLength(0);
  });
  it("requires every authenticated page to remain fresh when the completed cohort is returned", async () => {
    const f = fixture(); f.state.pageFault = "cohort_expiry";
    const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["inventory_not_fresh"] }); expectNonAuthority(result);
  });
  it("snapshots inputs without invoking getters", async () => {
    const f = fixture(), input = { basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW }, getter = vi.fn(() => NOW);
    Object.defineProperty(input, "asOf", { enumerable: true, get: getter }); const result = await createFollowUpRetentionCopyAdapters(f.config).collectAndPlan(input);
    expect(result.status).toBe("refused"); expect(getter).not.toHaveBeenCalled(); expect(f.state.pageCalls).toHaveLength(0);
  });
});

describe("inspect-only purge capability boundary", () => {
  it("binds every planned action to a fresh signed declaration without exposing an executor", async () => {
    const f = fixture(), adapter = createFollowUpRetentionCopyAdapters(f.config), collected = await adapter.collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    f.state.time += 1000;
    const result = await adapter.inspectCapabilities({ plan: collected.plan, asOf: NOW }); expect(result).toMatchObject({ status: "inspected", currentAccessChecked: true,
      cryptographicCapabilityAuthentication: true, everyActionInspectOnly: true, executionBoundaryPresent: true, planDigestSha256: collected.plan.planDigestSha256 });
    expect(result.capabilities).toHaveLength(collected.plan.actions.length); expect(result.capabilities.every(value => value.mode === "inspect_only")).toBe(true);
    expect(f.state.inspectCalls).toHaveLength(collected.plan.actions.length); expectNonAuthority(result);
  });
  it.each(["forged", "action", "release", "stale"])("refuses a %s capability without attempting any deletion", async fault => {
    const f = fixture(), adapter = createFollowUpRetentionCopyAdapters(f.config), collected = await adapter.collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    f.state.capabilityFault = fault; const result = await adapter.inspectCapabilities({ plan: collected.plan, asOf: NOW }); expect(result.status).toBe("refused"); expectNonAuthority(result);
  });
  it("refuses a caller-modified plan before consulting any purge inspector", async () => {
    const f = fixture(), adapter = createFollowUpRetentionCopyAdapters(f.config), collected = await adapter.collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    const plan = clone(collected.plan); plan.actions[0].actionId = id("invented action"); const result = await adapter.inspectCapabilities({ plan, asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["plan_mismatch"] }); expect(f.state.inspectCalls).toHaveLength(0);
  });
  it("refuses a structurally valid plan that was not authenticated by this adapter instance", async () => {
    const f = fixture(), first = createFollowUpRetentionCopyAdapters(f.config), collected = await first.collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    const second = createFollowUpRetentionCopyAdapters(f.config), before = f.state.inspectCalls.length;
    const result = await second.inspectCapabilities({ plan: collected.plan, asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["plan_mismatch"] }); expect(f.state.inspectCalls).toHaveLength(before); expectNonAuthority(result);
  });
  it("requires every capability and access grant to remain fresh when the completed cohort is returned", async () => {
    const f = fixture(), adapter = createFollowUpRetentionCopyAdapters(f.config), collected = await adapter.collectAndPlan({ basis: clone(BASIS), logicalPlan: logicalPlan(), asOf: NOW });
    f.state.capabilityFault = "cohort_expiry"; const result = await adapter.inspectCapabilities({ plan: collected.plan, asOf: NOW });
    expect(result).toMatchObject({ status: "refused", reasonCodes: ["capability_not_fresh"] }); expectNonAuthority(result);
  });
  it("contains no ambient transport, credential, SQL mutation or storage deletion path", () => {
    const source = readFileSync(new URL("../../scripts/lib/follow-up-retention-copy-adapters.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(|\bprocess\.(?:env|argv)|withExactBitwarden|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s+(?:INTO|FROM|TABLE)\b|\b(?:bucket|storage|collector|inspector|adapter)\.(?:delete|list|exec|prepare)\s*\(/);
  });
});
