import { describe, it, expect, vi } from "vitest";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFollowUpEvidenceCaptureIntegration as create, followUpEvidenceIntentSigningBytes as signingBytes, normalizeFollowUpEvidenceMetadata as normalize, FOLLOW_UP_CAPTURE_INTENT_DOMAIN, FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN } from "../../scripts/lib/follow-up-evidence-capture-integration.mjs";
import { reassembleFollowUpEvidenceCapture } from "../../scripts/lib/follow-up-evidence-capture.mjs";

// All keys, operations, reports and storage in this file are synthetic. The
// filesystem fixture only models atomic conditional create across processes;
// it does not certify a real object service, access policy or deletion resistance.
const hash = x => createHash("sha256").update(x).digest("hex"), id = x => "id_" + hash(x), clone = x => JSON.parse(JSON.stringify(x));
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const TIME = 1800000000000, DAY = 86400000, intentPair = generateKeyPairSync("ed25519"), receiptPair = generateKeyPairSync("ed25519");
const scope = { actionDigest: hash("synthetic action"), sourceRevision: "a".repeat(40), sinkId: id("synthetic private sink"), environment: "synthetic" };
const intent = changes => ({ version: "follow-up-capture-intent.v1", operationId: id("stable synthetic operation"), ...scope, originalAt: TIME - 1000, issuedAt: TIME, expiresAt: TIME + 60000, retentionUntil: TIME + DAY, parentDeadline: TIME + 2 * DAY, ...changes });
const authorize = (i = intent(), pair = intentPair) => ({ intent: i, keyId: id("intent key"), signature: sign(null, signingBytes(i), pair.privateKey).toString("base64") });
const report = (i = intent(), changes = {}) => ({ version: "follow-up-capture-metadata.v1", operationId: i.operationId, actionDigest: i.actionDigest, observedAt: TIME, outcome: "acknowledged", readback: "matches", statementCount: 1, rowsRead: 4, rowsWritten: 1, evidenceDigests: [hash("synthetic metadata")], reasonCodes: [], ...changes });
const rootKey = i => `follow-up-evidence-capture/v1/${i.operationId}/`;
function object(text, overrides = {}) { const bytes = Buffer.from(text); return { etag: hash(bytes), size: bytes.length, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), ...overrides }; }
class MemoryBucket {
  constructor(data = new Map()) { this.data = data; this.puts = []; this.gets = []; }
  async put(key, text, options) {
    this.puts.push({ key, text, options: clone(options) }); await this.beforePut?.(key, text);
    expect(options).toEqual({ onlyIf: { etagDoesNotMatch: "*" } });
    if (this.data.has(key)) return null;
    this.data.set(key, text); await this.afterPut?.(key, text); return { etag: hash(text) };
  }
  async get(key) {
    this.gets.push(key); await this.beforeGet?.(key);
    if (this.overrideGet) return this.overrideGet(key);
    return this.data.has(key) ? object(this.data.get(key)) : null;
  }
}
function fixture(overrides = {}) {
  const bucket = overrides.bucket ?? new MemoryBucket(), state = { time: TIME, calls: 0 };
  const config = { bucket, scope: clone(scope), intentKeys: [{ keyId: id("intent key"), publicKey: intentPair.publicKey }], receiptKeys: [{ keyId: id("receipt key"), publicKey: receiptPair.publicKey }], receiptSigner: { keyId: id("receipt key"), privateKey: receiptPair.privateKey }, executeAction: async i => { state.calls++; return report(i); }, clock: () => state.time, timeoutMs: 500, chunkBytes: 512, ...overrides };
  return { bucket, state, config, adapter: create(config) };
}
function storedRecord(bucket, i = intent()) {
  const base = rootKey(i), capture = JSON.parse(bucket.data.get(base + "manifest")).body.capture;
  return reassembleFollowUpEvidenceCapture({ ...capture, chunks: Array.from({ length: capture.manifest.count }, (_, n) => JSON.parse(bucket.data.get(base + `chunk-${n}`))) }).record;
}
function noGrants(result) {
  expect(result).toMatchObject({ sourceOnly: true, simulation: true, authority: false, productionAllowed: false, executionAllowed: false, adoptionAllowed: false, dispatchAllowed: false, retryAllowed: false, restoreAllowed: false, providerOutcomeProven: false, providerAuthenticityProven: false, sinkDurabilityProven: false, liveAuthorizationProven: false, exactlyOnceProven: false, claimLossRecoveryProven: false });
}
function frozen(x) { if (x && typeof x === "object") { expect(Object.isFrozen(x)).toBe(true); Object.values(x).forEach(frozen); } }

describe("inert conditional-object capture integration", () => {
  it("captures only typed metadata, verifies every chunk, and signs the compact final receipt", async () => {
    const f = fixture(), result = await f.adapter.execute(authorize());
    expect(result).toMatchObject({ status: "captured", actionAttempted: true, actionReport: "acknowledged", metadataCaptured: true, requiresReadOnlyReconciliation: true });
    expect(f.state.calls).toBe(1); expect(storedRecord(f.bucket)).toEqual(normalize(report())); noGrants(result); frozen(result);
    const receipt = result.receipt; expect(verify(null, Buffer.from(FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN + canonical(receipt.body)), receiptPair.publicKey, Buffer.from(receipt.signature, "base64"))).toBe(true);
    expect(verify(null, Buffer.from(FOLLOW_UP_CAPTURE_INTENT_DOMAIN + canonical(receipt.body)), receiptPair.publicKey, Buffer.from(receipt.signature, "base64"))).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8192);
    expect(f.bucket.puts.at(-1).key).toBe(rootKey(intent()) + "manifest");
    for (const p of f.bucket.puts) { expect(f.bucket.gets).toContain(p.key); expect(Buffer.byteLength(p.text)).toBeLessThanOrEqual(p.key.includes("chunk-") ? 512 : 8192); }
  });
  it("read-only reconciliation invokes neither action nor put, even for complete captures", async () => {
    const f = fixture(); await f.adapter.execute(authorize()); const puts = f.bucket.puts.length;
    const reopened = fixture({ bucket: new MemoryBucket(f.bucket.data), executeAction: vi.fn(() => { throw Error("forbidden"); }) });
    expect((await reopened.adapter.reconcile(authorize())).status).toBe("captured"); expect(reopened.bucket.puts).toHaveLength(0); expect(reopened.config.executeAction).not.toHaveBeenCalled(); expect(f.bucket.puts).toHaveLength(puts);
  });
  it("two fresh instances race to one stable claim and one action", async () => {
    const bucket = new MemoryBucket(), a = fixture({ bucket }), b = fixture({ bucket });
    const outcomes = await Promise.all([a.adapter.execute(authorize()), b.adapter.execute(authorize())]);
    expect(a.state.calls + b.state.calls).toBe(1); expect(outcomes.filter(x => x.actionAttempted)).toHaveLength(1); expect(bucket.data.has(rootKey(intent()) + "claim")).toBe(true);
    expect((await b.adapter.execute(authorize())).actionAttempted).toBe(false); expect(a.state.calls + b.state.calls).toBe(1);
  });
  it.each(["renewal", "source", "action", "signing_key"])("stable operation claim survives %s changes", async kind => {
    const f = fixture(); await f.adapter.execute(authorize()); let i = intent(), config = { ...f.config, executeAction: vi.fn() }, pair = intentPair;
    if (kind === "renewal") { i.issuedAt += 1; i.expiresAt += 1; config.clock = () => TIME + 1; }
    if (kind === "source") { i.sourceRevision = "b".repeat(40); config.scope = { ...scope, sourceRevision: i.sourceRevision }; }
    if (kind === "action") { i.actionDigest = hash("other action"); config.scope = { ...scope, actionDigest: i.actionDigest }; }
    if (kind === "signing_key") { pair = generateKeyPairSync("ed25519"); config.intentKeys = [{ keyId: id("intent key"), publicKey: pair.publicKey }]; }
    const result = await create(config).execute(authorize(i, pair)); expect(result.actionAttempted).toBe(false); expect(config.executeAction).not.toHaveBeenCalled(); expect([...f.bucket.data.keys()].filter(k => k.endsWith("/claim"))).toHaveLength(1); noGrants(result);
  });
  it.each(["before_persist", "after_persist"])("unknown claim acknowledgement %s never invokes this action", async phase => {
    const bucket = new MemoryBucket(); bucket[phase === "before_persist" ? "beforePut" : "afterPut"] = key => { if (key.endsWith("/claim")) throw Error("SECRET provider response"); };
    const f = fixture({ bucket }), result = await f.adapter.execute(authorize()); expect(result).toMatchObject({ status: "indeterminate", actionAttempted: false, reasonCode: "claim_ack_or_readback_unknown" }); expect(f.state.calls).toBe(0); expect(JSON.stringify(result)).not.toContain("SECRET");
    delete bucket.beforePut; delete bucket.afterPut; const reconciled = await f.adapter.reconcile(authorize());
    expect(reconciled.reasonCode).toBe(phase === "before_persist" ? "claim_absent_unresolved" : "manifest_missing"); noGrants(reconciled);
    if (phase === "after_persist") { expect((await fixture({ bucket }).adapter.execute(authorize())).actionAttempted).toBe(false); }
  });
  it("explicitly cannot distinguish absent lost claims or administrative deletion across restart", async () => {
    const bucket = new MemoryBucket(); bucket.beforePut = () => { throw Error("lost acknowledgement without persistence"); };
    const first = fixture({ bucket }); expect((await first.adapter.execute(authorize())).actionAttempted).toBe(false); delete bucket.beforePut;
    const reopened = fixture({ bucket }); const next = await reopened.adapter.execute(authorize()); expect(next.actionAttempted).toBe(true); noGrants(next);
    // This deliberate test-only deletion is outside the adapter's capabilities.
    bucket.data.clear(); const restored = fixture({ bucket }); expect((await restored.adapter.reconcile(authorize())).reasonCode).toBe("claim_absent_unresolved");
    const rerun = await restored.adapter.execute(authorize()); expect(rerun.actionAttempted).toBe(true); expect(rerun.exactlyOnceProven).toBe(false); expect(rerun.claimLossRecoveryProven).toBe(false);
  });
  it("expired claim readback consumes without invoking action", async () => {
    const f = fixture(); f.bucket.beforeGet = key => { if (key.endsWith("/claim")) f.state.time = intent().expiresAt; };
    expect(await f.adapter.execute(authorize())).toMatchObject({ status: "consumed_not_attempted", actionAttempted: false, reasonCode: "expired_after_claim" }); expect(f.state.calls).toBe(0); expect(f.bucket.puts).toHaveLength(1);
  });
  it("rechecks expiry inside the actual action microtask, not merely before scheduling", async () => {
    let readingsAfterClaim = 0, time = TIME; const bucket = new MemoryBucket(), action = vi.fn();
    const f = fixture({ bucket, executeAction: action, clock: () => { if (bucket.gets.length && ++readingsAfterClaim === 1) queueMicrotask(() => { time = intent().expiresAt; }); return time; } });
    const result = await f.adapter.execute(authorize()); expect(result).toMatchObject({ status: "consumed_not_attempted", actionAttempted: false }); expect(action).not.toHaveBeenCalled();
  });
  it.each(["throw", "timeout"])("effect followed by %s captures unknown counts, never invented zeros", async failure => {
    let effects = 0; const f = fixture({ timeoutMs: 20, executeAction: () => { effects++; if (failure === "throw") throw Error("raw secret error"); return new Promise(() => {}); } });
    const result = await f.adapter.execute(authorize()); expect(effects).toBe(1); expect(result).toMatchObject({ status: "captured", actionAttempted: true, actionReport: "unknown", requiresReadOnlyReconciliation: true });
    expect(storedRecord(f.bucket)).toMatchObject({ outcome: "unknown", statementCount: null, rowsRead: null, rowsWritten: null }); expect(JSON.stringify(result)).not.toContain("secret");
    await f.adapter.reconcile(authorize()); await f.adapter.execute(authorize()); expect(effects).toBe(1); noGrants(result);
  });
  it("does not materialize an unbounded raw action report into capture", async () => {
    const get = vi.fn(() => { throw Error("customer body"); }), value = report(); Object.defineProperty(value, "rawBody", { enumerable: true, get });
    const f = fixture({ executeAction: () => value }); const result = await f.adapter.execute(authorize()); expect(result.actionReport).toBe("unknown"); expect(get).not.toHaveBeenCalled(); expect(storedRecord(f.bucket).rowsWritten).toBeNull(); expect([...f.bucket.data.values()].join("")).not.toContain("customer body");
  });
  it.each(["chunk_before", "chunk_after", "final_before", "final_after"])("lost acknowledgement %s retains consumed state and never repeats action", async where => {
    const f = fixture(), phase = where.endsWith("before") ? "beforePut" : "afterPut", target = where.startsWith("chunk") ? "chunk-0" : "manifest";
    f.bucket[phase] = key => { if (key.endsWith(target)) throw Error("unretained provider response"); };
    const result = await f.adapter.execute(authorize()); expect(result).toMatchObject({ status: "capture_incomplete", actionAttempted: true, metadataCaptured: false }); expect(f.state.calls).toBe(1);
    delete f.bucket[phase]; const read = await f.adapter.reconcile(authorize()); expect(read.status).toBe(where === "final_after" ? "captured" : "capture_incomplete"); await f.adapter.execute(authorize()); expect(f.state.calls).toBe(1);
    if (where.startsWith("chunk")) expect(f.bucket.data.has(rootKey(intent()) + "manifest")).toBe(false);
  });
  it("late final readback cannot report presently valid evidence after retention expiry", async () => {
    const f = fixture(); f.bucket.beforeGet = key => { if (key.endsWith("/manifest")) f.state.time = intent().retentionUntil; };
    const result = await f.adapter.execute(authorize()); expect(result).toMatchObject({ status: "capture_incomplete", metadataCaptured: false, actionAttempted: true }); expect(f.bucket.data.has(rootKey(intent()) + "manifest")).toBe(true); expect((await f.adapter.reconcile(authorize())).reasonCode).toBe("evidence_expired");
  });
  it("late action completion may be captured before retention, but never renews the deadline", async () => {
    const f = fixture(); f.config.executeAction = async i => { f.state.time = i.expiresAt + 100; return report(i, { observedAt: f.state.time }); };
    const result = await create(f.config).execute(authorize()); expect(result.status).toBe("captured"); expect(result.receipt.body.intent.retentionUntil).toBe(intent().retentionUntil);
  });
  it("retention expiry while action is pending refuses capture but preserves the claim", async () => {
    const f = fixture(); f.config.executeAction = i => { f.state.time = i.retentionUntil; return report(i, { observedAt: f.state.time }); };
    const result = await create(f.config).execute(authorize()); expect(result.status).toBe("capture_incomplete"); expect(result.actionAttempted).toBe(true); expect(f.bucket.puts).toHaveLength(1);
  });
  it("snapshots signed input and trusted scope before the first await", async () => {
    const f = fixture(), request = authorize(), original = clone(request); f.bucket.beforePut = () => { request.intent.operationId = id("mutated"); request.signature = "x"; f.config.scope.sourceRevision = "c".repeat(40); };
    const result = await f.adapter.execute(request); expect(result.status).toBe("captured"); expect(result.operationId).toBe(original.intent.operationId); expect(result.receipt.body.intent).toEqual(original.intent);
  });
  it("passes a frozen exact bound intent to the configured action", async () => {
    let seen; const f = fixture({ executeAction: i => { seen = i; frozen(i); return report(i); } }); await f.adapter.execute(authorize()); expect(seen).toEqual(intent());
  });
  it.each(["signature", "key", "scope", "domain", "caller_key", "approved", "future", "expired"])("rejects %s intent before all storage/action IO", async kind => {
    const f = fixture(); let r = authorize();
    if (kind === "signature") r.signature = Buffer.alloc(64).toString("base64");
    if (kind === "key") r.keyId = id("untrusted key");
    if (kind === "scope") r = authorize(intent({ sinkId: id("other sink") }));
    if (kind === "domain") r.signature = sign(null, Buffer.from(FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN + canonical(r.intent)), intentPair.privateKey).toString("base64");
    if (kind === "caller_key") r.publicKey = "caller-controlled";
    if (kind === "approved") r.approved = true;
    if (kind === "future") r = authorize(intent({ issuedAt: TIME + 1 }));
    if (kind === "expired") f.state.time = r.intent.expiresAt;
    expect((await f.adapter.execute(r)).status).toBe("refused"); expect(f.bucket.puts).toHaveLength(0); expect(f.bucket.gets).toHaveLength(0); expect(f.state.calls).toBe(0);
  });
  it("never accepts a request's different key merely because its signature is mathematically valid", async () => {
    const f = fixture(), r = authorize(intent(), generateKeyPairSync("ed25519")); expect((await f.adapter.execute(r)).status).toBe("refused"); expect(f.bucket.puts).toHaveLength(0);
  });
  it.each(["actionDigest", "sourceRevision", "sinkId", "environment", "operationId", "expiresAt"])("signed intent binds exact %s", async field => {
    const f = fixture(), r = authorize(); r.intent[field] = field === "expiresAt" ? r.intent.expiresAt + 1 : field === "environment" ? "production" : field === "sourceRevision" ? "b".repeat(40) : field === "actionDigest" ? hash("changed") : id("changed");
    expect((await f.adapter.execute(r)).status).toBe("refused"); expect(f.bucket.puts).toHaveLength(0);
  });
  it.each(["original_clock", "parent", "ninety_days", "window", "negative", "nan"])("refuses invalid immutable clock law %s", kind => {
    const i = intent(); if (kind === "original_clock") i.originalAt = i.issuedAt + 1; if (kind === "parent") i.parentDeadline = i.retentionUntil - 1; if (kind === "ninety_days") { i.retentionUntil = i.originalAt + 90 * DAY + 1; i.parentDeadline = null; } if (kind === "window") i.expiresAt = i.issuedAt + 300001; if (kind === "negative") i.originalAt = -1; if (kind === "nan") i.originalAt = NaN;
    expect(() => signingBytes(i)).toThrow("invalid_capture_integration_input");
  });
  it("accepts the exact shorter-parent/90-day boundary without renewal", () => { const i = intent({ parentDeadline: null }); i.retentionUntil = i.originalAt + 90 * DAY; expect(signingBytes(i).length).toBeGreaterThan(0); i.parentDeadline = i.retentionUntil; expect(signingBytes(i).length).toBeGreaterThan(0); });
  it.each(["body", "text", "url", "SQL", "extra", "wrong_outcome", "wrong_digest", "count", "duplicates", "too_many"])("strict metadata rejects %s", kind => {
    const m = report(); if (kind === "body") m.body = "customer"; if (kind === "text") m.reasonCodes = ["private provider error"]; if (kind === "url") m.operationId = "https://example.test"; if (kind === "SQL") m.actionDigest = "DELETE FROM anything"; if (kind === "extra") m.approved = true; if (kind === "wrong_outcome") m.outcome = "delivered"; if (kind === "wrong_digest") m.evidenceDigests = [{}]; if (kind === "count") m.rowsWritten = -1; if (kind === "duplicates") m.evidenceDigests.push(m.evidenceDigests[0]); if (kind === "too_many") m.evidenceDigests = Array.from({ length: 201 }, (_, i) => hash(String(i)));
    expect(() => normalize(m)).toThrow("invalid_capture_integration_input");
  });
  it("normalizes unordered identity sets, preserves null vs zero, and freezes without mutation", () => {
    const m = report(intent(), { evidenceDigests: [hash("z"), hash("a")], rowsWritten: null, reasonCodes: ["outcome_unknown", "action_unavailable"] }), before = clone(m), n = normalize(m); expect(m).toEqual(before); expect(n.evidenceDigests).toEqual([...m.evidenceDigests].sort()); expect(n.rowsWritten).toBeNull(); expect(normalize(report()).rowsWritten).toBe(1); frozen(n);
  });
  it.each(["getter", "hidden", "symbol", "prototype", "sparse", "array_extra", "cycle", "long_key", "huge", "toJSON"])("defends untrusted metadata/request %s", async kind => {
    const spy = vi.fn(() => { throw Error("getter invoked"); }); let m = report();
    if (kind === "getter") Object.defineProperty(m, "rowsRead", { enumerable: true, get: spy });
    if (kind === "hidden") Object.defineProperty(m, "extra", { value: 1 });
    if (kind === "symbol") m[Symbol("x")] = 1;
    if (kind === "prototype") Object.setPrototypeOf(m, { inherited: true });
    if (kind === "sparse") m.evidenceDigests = new Array(2);
    if (kind === "array_extra") m.evidenceDigests.extra = 1;
    if (kind === "cycle") m.evidenceDigests = [m];
    if (kind === "long_key") m["k".repeat(129)] = null;
    if (kind === "huge") m.evidenceDigests = Array(1001).fill(null);
    if (kind === "toJSON") m.toJSON = spy;
    expect(() => normalize(m)).toThrow(); const f = fixture(); expect((await f.adapter.execute(m)).status).toBe("refused"); expect(spy).not.toHaveBeenCalled(); expect(f.bucket.puts).toHaveLength(0);
  });
  it.each(["claim", "chunk", "manifest"])("detects corrupt %s readback without leaking raw storage", async target => {
    const f = fixture(); f.bucket.afterPut = key => { if (key.endsWith(target === "chunk" ? "chunk-0" : target)) f.bucket.data.set(key, '{"raw":"SECRET storage payload"}'); };
    const result = await f.adapter.execute(authorize()); expect(result.metadataCaptured).toBe(false); expect(result.actionAttempted).toBe(target !== "claim"); expect(JSON.stringify(result)).not.toContain("SECRET"); if (target === "chunk") expect(f.bucket.data.has(rootKey(intent()) + "manifest")).toBe(false);
  });
  it.each(["operationId", "actionDigest", "sourceRevision", "sinkId", "environment", "expiresAt"])("signed receipt refuses tampered %s on reconciliation", async field => {
    const f = fixture(); await f.adapter.execute(authorize()); const key = rootKey(intent()) + "manifest", value = JSON.parse(f.bucket.data.get(key));
    value.body.intent[field] = field === "expiresAt" ? TIME + 1 : "tampered"; f.bucket.data.set(key, canonical(value)); const before = f.bucket.puts.length;
    expect((await f.adapter.reconcile(authorize())).status).toBe("indeterminate"); expect(f.bucket.puts).toHaveLength(before); expect(f.state.calls).toBe(1);
  });
  it("rejects missing and mixed chunks without completing or writing during reconcile", async () => {
    const f = fixture(); await f.adapter.execute(authorize()); const key = rootKey(intent()) + "chunk-0", saved = f.bucket.data.get(key), puts = f.bucket.puts.length;
    f.bucket.data.delete(key); expect((await f.adapter.reconcile(authorize())).status).toBe("indeterminate");
    const chunk = JSON.parse(saved); chunk.operationId = id("other"); f.bucket.data.set(key, canonical(chunk)); expect((await f.adapter.reconcile(authorize())).status).toBe("indeterminate"); expect(f.bucket.puts).toHaveLength(puts);
  });
  it("bounds advertised size before materialization and streamed bytes despite a lying size", async () => {
    const f = fixture(), bodyRead = vi.fn(); f.bucket.overrideGet = () => ({ etag: "e", size: 8193, get body() { bodyRead(); return null; } });
    expect((await f.adapter.execute(authorize())).actionAttempted).toBe(false); expect(bodyRead).not.toHaveBeenCalled();
    const other = fixture(); let cancelled = false; other.bucket.overrideGet = () => ({ etag: "e", size: 1, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(100000)); }, cancel() { cancelled = true; } }) });
    expect((await other.adapter.execute(authorize())).actionAttempted).toBe(false); expect(cancelled).toBe(true);
  });
  it("bounds a stalled claim read and leaves zero action invocations", async () => {
    const f = fixture({ timeoutMs: 10 }); f.bucket.overrideGet = () => ({ etag: "e", size: 1, body: new ReadableStream({}) }); const result = await f.adapter.execute(authorize()); expect(result.status).toBe("indeterminate"); expect(f.state.calls).toBe(0);
  });
  it("cancels a late get body without acquiring its reader after timeout", async () => {
    const f = fixture({ timeoutMs: 10 }); let resolveGet; const getReader = vi.fn(), cancel = vi.fn(() => Promise.resolve());
    f.bucket.get = () => new Promise(resolve => { resolveGet = resolve; });
    const result = await f.adapter.reconcile(authorize()); expect(result.status).toBe("indeterminate");
    resolveGet({ etag: "e", size: 1, body: { getReader, cancel } }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(getReader).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(f.state.calls).toBe(0); expect(f.bucket.puts).toHaveLength(0);
  });
  it("does not consume or request another stream part after a late read resolves", async () => {
    const f = fixture({ timeoutMs: 10 }); let resolveRead;
    const read = vi.fn(() => new Promise(resolve => { resolveRead = resolve; })), cancel = vi.fn(() => Promise.resolve()), releaseLock = vi.fn();
    f.bucket.overrideGet = () => ({ etag: "e", size: 1, body: { getReader: () => ({ read, cancel, releaseLock }) } });
    expect((await f.adapter.reconcile(authorize())).status).toBe("indeterminate"); expect(read).toHaveBeenCalledOnce();
    resolveRead({ done: false, value: new Uint8Array(100000) }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(read).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalled(); expect(releaseLock).toHaveBeenCalled(); expect(f.bucket.puts).toHaveLength(0);
  });
  it("does not await an unresponsive cancellation after an otherwise complete read", async () => {
    const f = fixture({ timeoutMs: 50 }); let cancellations = 0;
    f.bucket.overrideGet = key => {
      const text = f.bucket.data.get(key); if (text === undefined) return null; const bytes = Buffer.from(text); let emitted = false;
      return { etag: hash(bytes), size: bytes.length, body: { getReader: () => ({ read: async () => emitted ? { done: true } : (emitted = true, { done: false, value: bytes }), cancel: () => { cancellations++; return new Promise(() => {}); }, releaseLock() {} }) } };
    };
    const result = await f.adapter.execute(authorize()); expect(result.status).toBe("captured"); expect(f.state.calls).toBe(1); expect(cancellations).toBe(f.bucket.gets.length);
  });
  it("rejects invalid UTF8, noncanonical JSON and BOM before accepting a claim", async () => {
    for (const transform of [text => " " + text, text => "\ufeff" + text, () => Buffer.from([255])]) {
      const f = fixture(); f.bucket.overrideGet = key => { const bytes = Buffer.from(transform(f.bucket.data.get(key))); return object(bytes, { etag: hash(f.bucket.data.get(key)) }); };
      expect((await f.adapter.execute(authorize())).actionAttempted).toBe(false);
    }
  });
  it("captures the maximum 200 typed evidence digests with bounded chunk/cardinality", async () => {
    const f = fixture({ executeAction: i => report(i, { evidenceDigests: Array.from({ length: 200 }, (_, n) => hash(String(n))) }) });
    const result = await f.adapter.execute(authorize()); expect(result.status).toBe("captured"); expect(result.receipt.body.capture.manifest.count).toBeLessThanOrEqual(200); expect(storedRecord(f.bucket).evidenceDigests).toHaveLength(200); expect(f.bucket.puts.length).toBeLessThanOrEqual(202); expect(f.bucket.gets.length).toBeLessThanOrEqual(202);
  });
  it("has no default network, credential, installer, runtime or deletion capability", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw Error("network forbidden"); });
    try { const f = fixture(); await f.adapter.execute(authorize()); await f.adapter.reconcile(authorize()); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
    const source = readFileSync(new URL("../../scripts/lib/follow-up-evidence-capture-integration.mjs", import.meta.url), "utf8"); expect(source).not.toMatch(/node:(?:fs|http|https|net|child_process)|\bfetch\s*\(|process\.|bucket\.delete|withExactBitwarden|wrangler/);
    expect(hash(readFileSync(new URL("../../scripts/lib/follow-up-evidence-capture.mjs", import.meta.url)))).toBe("db7bae45b8364e5cdca541678f3949877e131db9a8a5ff9cf84e5af1628644f9");
  });
});

describe("independent process persistence (synthetic fixture only)", () => {
  it("uses atomic conditional-create storage across simultaneous processes and a later restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amari-capture-synthetic-"));
    const modulePath = fileURLToPath(new URL("../../scripts/lib/follow-up-evidence-capture-integration.mjs", import.meta.url));
    const program = `
      import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
      import { dirname, join } from 'node:path';
      import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
      import { createFollowUpEvidenceCaptureIntegration as create } from ${JSON.stringify(modulePath)};
      const data = JSON.parse(readFileSync(0, 'utf8')), directory = process.argv[1];
      const hash = value => createHash('sha256').update(value).digest('hex');
      const bucket = {
        async put(key, text, options) { if (options.onlyIf.etagDoesNotMatch !== '*') throw Error('condition required'); const path = join(directory, key); mkdirSync(dirname(path), {recursive:true}); try { writeFileSync(path, text, {flag:'wx'}); } catch (e) { if (e.code === 'EEXIST') return null; throw e; } return {etag:hash(text)}; },
        async get(key) { let bytes; try { bytes = readFileSync(join(directory,key)); } catch(e) { if(e.code === 'ENOENT') return null; throw e; } return {etag:hash(bytes),size:bytes.length,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})}; }
      };
      const publicKey = value => createPublicKey({key:Buffer.from(value,'base64'),type:'spki',format:'der'});
      const adapter = create({ bucket, scope:data.scope, intentKeys:[{keyId:data.intentKeyId,publicKey:publicKey(data.intentPublic)}], receiptKeys:[{keyId:data.receiptKeyId,publicKey:publicKey(data.receiptPublic)}], receiptSigner:{keyId:data.receiptKeyId,privateKey:createPrivateKey({key:Buffer.from(data.receiptPrivate,'base64'),type:'pkcs8',format:'der'})}, clock:()=>data.time,timeoutMs:1000,chunkBytes:512,executeAction:async()=>{appendFileSync(join(directory,'synthetic-effects'),'effect\\n');return data.report;} });
      const result = await adapter.execute(data.request); process.stdout.write(JSON.stringify({status:result.status,actionAttempted:result.actionAttempted,exactlyOnceProven:result.exactlyOnceProven}));
    `;
    const input = JSON.stringify({ request: authorize(), scope, time: TIME, report: report(), intentKeyId: id("intent key"), receiptKeyId: id("receipt key"), intentPublic: intentPair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), receiptPublic: receiptPair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), receiptPrivate: receiptPair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") });
    const child = () => new Promise((resolve, reject) => { const p = spawn(process.execPath, ["--input-type=module", "-e", program, directory], { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = ""; p.stdout.on("data", b => { stdout += b; }); p.stderr.on("data", b => { stderr += b; }); p.on("error", reject); p.on("close", code => { if (code) reject(Error(`synthetic child failed ${code}: ${stderr}`)); else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } } }); p.stdin.end(input); });
    try {
      const results = await Promise.all([child(), child()]); expect(results.filter(r => r.actionAttempted)).toHaveLength(1);
      expect((await child()).actionAttempted).toBe(false); expect(readFileSync(join(directory, "synthetic-effects"), "utf8")).toBe("effect\n"); expect(results.every(r => r.exactlyOnceProven === false)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
