import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createFollowUpEvidenceAdmissionGate as create, followUpAdmissionSigningBytes, followUpCurrentFloorSigningBytes, FOLLOW_UP_ADMISSION_DOMAIN, FOLLOW_UP_FLOOR_DOMAIN } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";
import { followUpEvidenceIntentSigningBytes, FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN } from "../../scripts/lib/follow-up-evidence-capture-integration.mjs";
import { chunkFollowUpEvidenceCapture, reassembleFollowUpEvidenceCapture } from "../../scripts/lib/follow-up-evidence-capture.mjs";

// Synthetic keys, SQL, source coordinates and storage only. The SQLite port
// exercises real scope-wide atomic transactions and persistence. Its confirm
// read is NOT a certification of a deployed provider's durability/authentication.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const hash = x => createHash("sha256").update(x).digest("hex"), id = x => "id_" + hash(x), clone = x => JSON.parse(JSON.stringify(x));
const TIME = 1800000000000, DAY = 86400000, pairs = { admission: generateKeyPairSync("ed25519"), capture: generateKeyPairSync("ed25519"), floor: generateKeyPairSync("ed25519"), receipt: generateKeyPairSync("ed25519") };
const scope = { accountId: id("test account"), targetId: id("test target"), actionScopeDigest: hash("stable synthetic action"), environment: "synthetic", sinkId: id("test sink"), registryId: id("test registry"), schemaDigest: hash("synthetic schema"), sourceRevision: "a".repeat(40), actionDigest: hash("synthetic action revision"), handlerDigest: hash("synthetic handler"), epoch: id("test epoch"), generation: 1, issuerReleaseDigest: hash("synthetic issuer release"), policyVersion: "follow-up-retention-policy.v1" };
const operation = a => id(canonical({ accountId: a.scope.accountId, targetId: a.scope.targetId, actionScopeDigest: a.scope.actionScopeDigest, environment: a.scope.environment, sourceId: a.origin.sourceId, sequence: a.origin.sequence }));
function authorize(changes = {}, keyPairs = pairs) {
  const a = { version: "follow-up-admission.v1", scope: clone(scope), origin: { sourceId: id("immutable synthetic source"), sequence: 10, originalAt: TIME - 1000, approvedAt: TIME, dispatchUntil: TIME + 60000 }, aliasSetDigest: hash("all synthetic alias versions"), replayHorizonUntil: TIME + 100 * DAY, retentionUntil: TIME + DAY, parentDeadline: TIME + DAY, deletionDeadline: null, issuedAt: TIME, issuerSequence: 10, quotas: { metadataBytes: 24000, chunks: 16, rpcs: 64 }, ...clone(changes) };
  a.businessKey ??= operation(a);
  const i = { version: "follow-up-capture-intent.v1", operationId: a.businessKey, actionDigest: a.scope.actionDigest, sourceRevision: a.scope.sourceRevision, sinkId: a.scope.sinkId, environment: a.scope.environment, originalAt: a.origin.originalAt, issuedAt: a.issuedAt, expiresAt: a.origin.dispatchUntil, retentionUntil: a.retentionUntil, parentDeadline: Math.min(...[a.parentDeadline, a.deletionDeadline].filter(t => t !== null)) };
  if (!Number.isFinite(i.parentDeadline)) i.parentDeadline = null;
  const capture = { intent: i, keyId: id("capture key"), signature: sign(null, followUpEvidenceIntentSigningBytes(i), keyPairs.capture.privateKey).toString("base64") };
  a.captureIntentDigest = hash(followUpEvidenceIntentSigningBytes(i));
  return { admission: a, capture, keyId: id("admission key"), signature: sign(null, followUpAdmissionSigningBytes(a), keyPairs.admission.privateKey).toString("base64") };
}
const head = c => ({ scopeDigest: c.scopeDigest, epoch: c.epoch, generation: c.generation, sequence: c.sequence, digest: c.headDigest });
const initial = s => ({ version: "follow-up-admission-control.v1", scopeDigest: hash(canonical(s)), epoch: s.epoch, generation: s.generation, mode: "active", sequence: 0, headDigest: hash("synthetic provisioned genesis"), pending: null });
const databases = [], directories = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); vi.restoreAllMocks(); });

class SQLiteRegistry {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, data TEXT NOT NULL)"); this.log = [];
  }
  seed(control) { this.db.prepare("INSERT INTO control(id,data) VALUES(1,?)").run(canonical(control)); }
  snapshot(key) { const c = this.db.prepare("SELECT data FROM control WHERE id=1").get(), e = this.db.prepare("SELECT data FROM entries WHERE id=?").get(key); return { control: c ? JSON.parse(c.data) : null, entry: e ? JSON.parse(e.data) : null }; }
  async read(key) { this.log.push("read"); await this.beforeRead?.(key); return this.snapshot(key); }
  async transact(key, update) {
    this.log.push("transact"); await this.beforeTransaction?.(key);
    this.db.exec("BEGIN IMMEDIATE"); let receipt;
    try {
      const next = update(this.snapshot(key)); if (next?.then) throw Error("synchronous updater required");
      this.db.prepare("UPDATE control SET data=? WHERE id=1").run(canonical(next.control));
      if (next.entry !== null) this.db.prepare("INSERT INTO entries VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(key, canonical(next.entry));
      receipt = { transactionId: hash("amari/follow-up-registry-transaction/v1\n" + canonical(next)), snapshot: clone(next) };
      this.db.prepare("INSERT INTO receipts VALUES(?,?)").run(receipt.transactionId, canonical(receipt));
      this.insideTransaction?.(next); this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    await this.afterTransaction?.(receipt); return this.mapTransaction ? this.mapTransaction(receipt) : receipt;
  }
  async confirm(transactionId) { this.log.push("confirm"); await this.beforeConfirm?.(transactionId); const row = this.db.prepare("SELECT data FROM receipts WHERE id=?").get(transactionId); const r = row ? JSON.parse(row.data) : null; return this.mapConfirm ? this.mapConfirm(r) : r; }
  overwriteControl(fn) { const s = this.snapshot(""); fn(s.control); this.db.prepare("UPDATE control SET data=? WHERE id=1").run(canonical(s.control)); }
}
class MemoryWitness {
  constructor(initialHead) { this.head = clone(initialHead); this.events = new Map(); this.log = []; }
  async readHead() { this.log.push("head"); await this.beforeHead?.(); return clone(this.head); }
  async readTransition(key) { this.log.push("event"); await this.beforeEvent?.(key); return this.events.has(key) ? clone(this.events.get(key)) : null; }
  async putTransition(event) { this.log.push("put"); await this.beforePut?.(event); const key = hash(canonical(event)); if (this.events.has(key)) return null; this.events.set(key, clone(event)); await this.afterPut?.(event); return { digest: key }; }
  async compareAndSwapHead(previous, next) { this.log.push("cas"); await this.beforeCas?.(previous, next); if (canonical(previous) !== canonical(this.head)) return null; this.head = clone(next); await this.afterCas?.(); return { head: clone(this.head) }; }
}
class MemoryBucket {
  constructor() { this.data = new Map(); this.log = []; }
  async put(key, text, options) { this.log.push("put:" + key.split("/").at(-1)); await this.beforePut?.(key); if (options.onlyIf.etagDoesNotMatch !== "*") throw Error("condition required"); if (this.data.has(key)) return null; this.data.set(key, text); await this.afterPut?.(key); return { etag: hash(text) }; }
  async get(key) { this.log.push("get:" + key.split("/").at(-1)); await this.beforeGet?.(key); if (!this.data.has(key)) return null; const b = Buffer.from(this.data.get(key)); return { etag: hash(b), size: b.length, body: new ReadableStream({ start(c) { c.enqueue(b); c.close(); } }) }; }
}
const report = (i, at = TIME, changes = {}) => ({ version: "follow-up-capture-metadata.v1", operationId: i.operationId, actionDigest: i.actionDigest, observedAt: at, outcome: "acknowledged", readback: "matches", statementCount: 1, rowsRead: 0, rowsWritten: 1, evidenceDigests: [], reasonCodes: [], ...changes });
function fixture(overrides = {}) {
  const request = overrides.request ?? authorize(), sc = request.admission.scope, state = { time: TIME, calls: 0, floorCalls: 0, eligibility: "clear", minimumOriginSequence: 1, overrides: {} };
  const registry = overrides.registry ?? new SQLiteRegistry(), bucket = overrides.bucket ?? new MemoryBucket();
  if (!overrides.registry) { databases.push(registry.db); registry.seed(initial(sc)); }
  const witness = overrides.witness ?? new MemoryWitness(head(registry.snapshot("").control));
  const origins = new Map([[request.admission.businessKey, clone(request.admission)]]);
  const currentFloor = { async read(challenge) {
    state.floorCalls++; await state.beforeFloor?.(challenge); const a = origins.get(challenge.businessKey); if (!a) throw Error("no authenticated synthetic origin");
    let value = { version: "follow-up-current-floor.v1", challengeDigest: hash("amari/follow-up-floor-challenge/v1\n" + canonical(challenge)), scopeDigest: hash(canonical(sc)), epoch: sc.epoch, generation: sc.generation, issuerReleaseDigest: sc.issuerReleaseDigest, minimumOriginSequence: state.minimumOriginSequence, originDigest: hash(canonical(a.origin)), aliasSetDigest: a.aliasSetDigest, replayHorizonUntil: a.replayHorizonUntil, eligibility: state.eligibility, issuedAt: state.time, expiresAt: state.time + 30000, ...state.overrides };
    value = state.mapFloor ? state.mapFloor(value, challenge) : value;
    return { floor: value, keyId: id("floor key"), signature: sign(null, followUpCurrentFloorSigningBytes(value), pairs.floor.privateKey).toString("base64") };
  } };
  const config = { scope: clone(sc), admissionKeys: [{ keyId: id("admission key"), publicKey: pairs.admission.publicKey }], floorKeys: [{ keyId: id("floor key"), publicKey: pairs.floor.publicKey }], registry, currentFloor, witness, capture: { bucket, intentKeys: [{ keyId: id("capture key"), publicKey: pairs.capture.publicKey }], receiptKeys: [{ keyId: id("receipt key"), publicKey: pairs.receipt.publicKey }], receiptSigner: { keyId: id("receipt key"), privateKey: pairs.receipt.privateKey } }, executeAction: i => { state.calls++; return report(i, state.time); }, clock: () => state.time, waitMs: 500, operationMs: 5000, ...overrides.config };
  const gate = create(config); return { request, state, registry, witness, bucket, origins, config, gate };
}
function noGrants(r) { expect(r).toMatchObject({ sourceOnly: true, simulation: true, authority: false, productionAllowed: false, executionAllowed: false, adoptionAllowed: false, dispatchAllowed: false, retryAllowed: false, restoreAllowed: false, providerOutcomeProven: false, providerAuthenticityProven: false, sinkDurabilityProven: false, registryDurabilityProven: false, liveAuthorizationProven: false, sourceAuthenticationProven: false, exactlyOnceProven: false, coherentRollbackDetectionProven: false }); expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(8192); expect(Object.isFrozen(r)).toBe(true); }
async function admitted(f) { expect(await f.gate.admit(f.request)).toMatchObject({ status: "admitted", actionAttempted: false, pendingBarrier: false }); }
function captureRecord(f) { const root = `follow-up-evidence-capture/v1/${f.request.admission.businessKey}/`, capsule = JSON.parse(f.bucket.data.get(root + "manifest")).body.capture; return reassembleFollowUpEvidenceCapture({ ...capsule, chunks: Array.from({ length: capsule.manifest.count }, (_, i) => JSON.parse(f.bucket.data.get(root + `chunk-${i}`))) }).record; }

describe("source-only admission/consumption gate", () => {
  it("requires a positive admission and a separately seeded control/head; never bootstraps", async () => {
    const f = fixture(); expect((await f.gate.executeAdmitted(f.request)).status).toBe("refused"); expect(f.registry.log).not.toContain("transact"); expect(f.state.calls).toBe(0);
    f.registry.db.exec("DELETE FROM control"); expect((await f.gate.admit(f.request)).status).toBe("refused"); expect(f.registry.snapshot("").control).toBeNull();
  });
  it("durably consumes, verifies independent witness, then invokes and captures minimized metadata", async () => {
    const f = fixture(); await admitted(f); f.config.executeAction = i => { expect(f.registry.snapshot(i.operationId).entry.status).toBe("CONSUMED"); expect(f.registry.snapshot(i.operationId).control.pending.phase).toBe("action"); expect(f.witness.head.sequence).toBe(2); f.state.calls++; return report(i); };
    const r = await create(f.config).executeAdmitted(f.request); expect(r).toMatchObject({ status: "captured", actionAttempted: true, consumption: "confirmed", pendingBarrier: true, metadataCaptured: true }); expect(f.state.calls).toBe(1); expect(captureRecord(f).rowsWritten).toBe(1); noGrants(r);
    const again = await create(f.config).executeAdmitted(f.request); expect(again).toMatchObject({ actionAttempted: false, reasonCode: "already_consumed" }); expect(f.state.calls).toBe(1); noGrants(again);
  });
  it("read status/capture never transact, put, resume, clear the barrier or repeat the effect", async () => {
    const f = fixture(); await admitted(f); await f.gate.executeAdmitted(f.request); const writes = f.registry.log.filter(x => x === "transact").length, puts = f.bucket.log.filter(x => x.startsWith("put")).length, witnessWrites = f.witness.log.filter(x => x === "put" || x === "cas").length;
    expect((await f.gate.readStatus(f.request)).status).toBe("observed"); expect((await f.gate.readCapture(f.request)).metadataCaptured).toBe(true); expect(f.registry.log.filter(x => x === "transact")).toHaveLength(writes); expect(f.bucket.log.filter(x => x.startsWith("put"))).toHaveLength(puts); expect(f.witness.log.filter(x => x === "put" || x === "cas")).toHaveLength(witnessWrites); expect(f.state.calls).toBe(1);
  });
  it("two new instances race across the scope-wide transaction to one consumed invocation", async () => {
    const f = fixture(); await admitted(f); const outcomes = await Promise.all([create(f.config).executeAdmitted(f.request), create(f.config).executeAdmitted(f.request)]); expect(outcomes.filter(r => r.actionAttempted)).toHaveLength(1); expect(f.state.calls).toBe(1); expect(f.registry.snapshot(f.request.admission.businessKey).entry.status).toBe("CONSUMED");
  });
  it("same-scope competing business actions cannot bypass the pending action barrier", async () => {
    const f = fixture(); await admitted(f); const r2 = authorize({ origin: { ...f.request.admission.origin, sequence: 11 } }); f.origins.set(r2.admission.businessKey, r2.admission); expect((await f.gate.admit(r2)).status).toBe("admitted");
    await f.gate.executeAdmitted(f.request); const second = await f.gate.executeAdmitted(r2); expect(second.actionAttempted).toBe(false); expect(f.registry.snapshot(r2.admission.businessKey).entry.status).toBe("ADMITTED"); expect(f.state.calls).toBe(1);
  });
  it.each(["before", "after", "confirm"])("unknown consume %s acknowledgement never dispatches or auto-resumes", async where => {
    const f = fixture(); await admitted(f); const boom = () => { throw Error("SECRET backend result"); };
    if (where === "before") f.registry.beforeTransaction = boom; if (where === "after") f.registry.afterTransaction = boom; if (where === "confirm") f.registry.beforeConfirm = boom;
    const r = await f.gate.executeAdmitted(f.request); expect(r).toMatchObject({ status: "indeterminate", actionAttempted: false, registryState: "unavailable", pendingBarrier: null, consumption: "unknown" }); expect(f.state.calls).toBe(0); expect(f.witness.log.filter(x => x === "put")).toHaveLength(1); expect(JSON.stringify(r)).not.toContain("SECRET"); noGrants(r);
    delete f.registry.beforeTransaction; delete f.registry.afterTransaction; delete f.registry.beforeConfirm;
    const read = await create(f.config).readStatus(f.request); expect(read.actionAttempted).toBe(false); expect(f.state.calls).toBe(0);
    if (where !== "before") { expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false); expect(f.registry.snapshot(f.request.admission.businessKey).entry.status).toBe("CONSUMED"); }
  });
  it.each(["put_before", "put_after", "cas_before", "cas_after"])("lost witness %s acknowledgement leaves consumed+pending and zero effects", async where => {
    const f = fixture(); await admitted(f); f.witness[{ put_before: "beforePut", put_after: "afterPut", cas_before: "beforeCas", cas_after: "afterCas" }[where]] = () => { throw Error("lost witness response"); };
    const r = await f.gate.executeAdmitted(f.request); expect(r).toMatchObject({ actionAttempted: false, consumption: "confirmed", registryState: "CONSUMED", pendingBarrier: true }); expect(f.registry.snapshot(f.request.admission.businessKey).entry.status).toBe("CONSUMED"); expect(f.registry.snapshot("").control.pending.phase).toBe("witness"); expect(f.state.calls).toBe(0); expect((await create(f.config).readStatus(f.request)).actionAttempted).toBe(false);
  });
  it.each(["transaction_id", "snapshot", "confirm_id", "confirm_snapshot"])("rejects forged or stale %s before witness/action", async kind => {
    const f = fixture(); await admitted(f); const saved = f.registry.snapshot(f.request.admission.businessKey);
    if (kind.startsWith("transaction")) f.registry.mapTransaction = r => ({ ...r, transactionId: hash("forged") });
    if (kind === "snapshot") f.registry.mapTransaction = r => ({ ...r, snapshot: saved });
    if (kind === "confirm_id") f.registry.mapConfirm = r => ({ ...r, transactionId: hash("wrong") });
    if (kind === "confirm_snapshot") f.registry.mapConfirm = r => ({ ...r, snapshot: saved });
    expect((await f.gate.executeAdmitted(f.request)).actionAttempted).toBe(false); expect(f.state.calls).toBe(0); expect(f.witness.head.sequence).toBe(1);
  });
  it("transaction exception rolls back both entry and shared control", async () => { const f = fixture(); await admitted(f); const before = f.registry.snapshot(f.request.admission.businessKey); f.registry.insideTransaction = () => { throw Error("synthetic disk failure"); }; await f.gate.executeAdmitted(f.request); expect(f.registry.snapshot(f.request.admission.businessKey)).toEqual(before); expect(f.state.calls).toBe(0); });
  it.each(["original_deadline", "floor_expiry"])("rechecks %s inside the actual synchronous transaction", async kind => {
    const f = fixture(); f.registry.beforeTransaction = () => { f.state.time = kind === "original_deadline" ? f.request.admission.origin.dispatchUntil : TIME + 30000; };
    expect((await f.gate.admit(f.request)).status).toBe("indeterminate"); expect(f.registry.snapshot(f.request.admission.businessKey).entry).toBeNull(); expect(f.witness.events.size).toBe(0);
  });
  it("final witness await cannot hide a registry closure at the effect boundary", async () => {
    const f = fixture(); await admitted(f); f.witness.beforeEvent = () => { if (f.bucket.data.size) f.registry.overwriteControl(c => { c.mode = "closed"; }); };
    const r = await f.gate.executeAdmitted(f.request); expect(r).toMatchObject({ actionAttempted: false, consumption: "confirmed" }); expect(f.state.calls).toBe(0); expect(r.actionReport).toBe("unknown");
  });
  it.each(["expiry", "suppression", "epoch", "alias_rotation"])("rechecks %s after the asynchronous capture claim", async kind => {
    const f = fixture(); await admitted(f); f.bucket.beforeGet = key => { if (key.endsWith("claim")) { if (kind === "expiry") f.state.time = f.request.admission.origin.dispatchUntil; if (kind === "suppression") f.state.eligibility = "suppressed"; if (kind === "epoch") f.state.overrides.epoch = id("retired epoch"); if (kind === "alias_rotation") f.state.overrides.aliasSetDigest = hash("forgot old lookup alias"); } };
    const r = await f.gate.executeAdmitted(f.request); expect(r.actionAttempted).toBe(false); expect(f.state.calls).toBe(0); expect(f.registry.snapshot(f.request.admission.businessKey).entry.status).toBe("CONSUMED"); noGrants(r);
  });
  it("readStatus rechecks retention after its last witness read", async () => { const f = fixture(); await admitted(f); f.witness.beforeEvent = () => { f.state.time = f.request.admission.retentionUntil; }; expect((await f.gate.readStatus(f.request)).status).toBe("indeterminate"); });
  it("effect then lost response remains consumed with null unknown counts, never a retry", async () => {
    const f = fixture(); await admitted(f); f.config.executeAction = () => { f.state.calls++; throw Error("SECRET provider content"); }; const r = await create(f.config).executeAdmitted(f.request); expect(r).toMatchObject({ actionAttempted: true, actionReport: "unknown", consumption: "confirmed" }); expect(captureRecord(f)).toMatchObject({ rowsWritten: null, rowsRead: null, statementCount: null }); expect(JSON.stringify(r)).not.toContain("SECRET"); await create(f.config).executeAdmitted(f.request); expect(f.state.calls).toBe(1);
  });
  it("hostile or oversize post-effect metadata never reverses consumption", async () => {
    const f = fixture(); await admitted(f); const getter = vi.fn(); f.config.executeAction = i => { f.state.calls++; const value = report(i); Object.defineProperty(value, "body", { enumerable: true, get: getter }); return value; };
    expect((await create(f.config).executeAdmitted(f.request)).actionReport).toBe("unknown"); expect(getter).not.toHaveBeenCalled(); expect(f.state.calls).toBe(1); expect(captureRecord(f).rowsWritten).toBeNull(); expect(f.registry.snapshot("").control.pending.phase).toBe("action");
  });
  it("maximum typed evidence remains within 16 chunks, 64 RPCs and compact output", async () => {
    const f = fixture(); await admitted(f); f.config.executeAction = i => { f.state.calls++; return report(i, TIME, { evidenceDigests: Array.from({ length: 200 }, (_, n) => hash(String(n))) }); };
    const r = await create(f.config).executeAdmitted(f.request); expect(r.status).toBe("captured"); expect(r.rpcCount).toBeLessThanOrEqual(64); expect(r.captureReceipt.body.capture.manifest.count).toBeLessThanOrEqual(16); expect(captureRecord(f).evidenceDigests).toHaveLength(200); noGrants(r);
  });
  it.each(["parent", "deletion"])("witness receives the immutable shortest %s deadline, not event-time plus90days", async kind => {
    const deadline = TIME + 120000, changes = { retentionUntil: deadline, parentDeadline: kind === "parent" ? deadline : TIME + DAY, deletionDeadline: kind === "deletion" ? deadline : null };
    const f = fixture({ request: authorize(changes) }); await admitted(f); f.state.time += 1000; expect((await f.gate.executeAdmitted(f.request)).actionAttempted).toBe(true);
    expect([...f.witness.events.values()].map(e => e.retentionUntil)).toEqual([deadline, deadline]); expect([...f.witness.events.values()].every(e => e.at < e.retentionUntil)).toBe(true);
    const entry = f.registry.snapshot(f.request.admission.businessKey).entry; f.witness.events.get(entry.transitionDigest).retentionUntil++; expect((await f.gate.readStatus(f.request)).status).toBe("indeterminate");
  });
});

describe("closed invocation and total operation limits", () => {
  it("claim latency cannot grant a later inner timeout window to the action wrapper", async () => {
    const f = fixture(); await admitted(f); const config = { ...f.config, waitMs: 80 };
    f.bucket.beforeGet = async key => { if (key.endsWith("claim")) await new Promise(resolve => setTimeout(resolve, 55)); };
    f.state.beforeFloor = async () => { if (f.bucket.data.size) await new Promise(resolve => setTimeout(resolve, 40)); };
    // Dispatch guard completes ~95ms after capture.execute. This is before an
    // incorrectly renewed 80ms timer starting after the 55ms claim, but after
    // the gate's conservatively anchored original 80ms eligibility budget.
    const r = await create(config).executeAdmitted(f.request); expect(r).toMatchObject({ actionAttempted: false, consumption: "confirmed" }); expect(f.state.calls).toBe(0);
  });
  it("a late floor response cannot invoke after the frozen callback has timed out", async () => {
    const f = fixture(); await admitted(f); let release; f.state.beforeFloor = () => f.bucket.data.size ? new Promise(resolve => { release = resolve; }) : undefined;
    const r = await create({ ...f.config, waitMs: 20 }).executeAdmitted(f.request); expect(r.actionAttempted).toBe(false); expect(typeof release).toBe("function"); release(); await new Promise(resolve => setTimeout(resolve, 25)); expect(f.state.calls).toBe(0); noGrants(r);
  });
  it("late committed transaction acknowledgement cannot resume its closed invocation", async () => {
    const f = fixture(); await admitted(f); let release; f.registry.afterTransaction = () => new Promise(resolve => { release = resolve; });
    const r = await create({ ...f.config, waitMs: 20 }).executeAdmitted(f.request); expect(r).toMatchObject({ consumption: "unknown", actionAttempted: false, registryState: "unavailable" }); expect(f.registry.snapshot(f.request.admission.businessKey).entry.status).toBe("CONSUMED");
    release(); delete f.registry.afterTransaction; await new Promise(resolve => setTimeout(resolve, 25)); expect(f.witness.head.sequence).toBe(1); expect(f.state.calls).toBe(0); expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false);
  });
  it("whole-operation timeout closes eligibility even when every individual RPC is timely", async () => {
    const f = fixture(); await admitted(f); f.registry.beforeRead = () => new Promise(resolve => setTimeout(resolve, 15)); f.state.beforeFloor = () => new Promise(resolve => setTimeout(resolve, 15)); f.witness.beforeHead = () => new Promise(resolve => setTimeout(resolve, 15)); f.witness.beforeEvent = () => new Promise(resolve => setTimeout(resolve, 15));
    const r = await create({ ...f.config, waitMs: 50, operationMs: 60 }).executeAdmitted(f.request); expect(r.actionAttempted).toBe(false); await new Promise(resolve => setTimeout(resolve, 55)); expect(f.state.calls).toBe(0);
  });
  it("trusted clock microtask expiry before the actual action gives zero effects", async () => {
    const f = fixture(); await admitted(f);
    f.registry.beforeRead = () => { if (f.bucket.data.size && f.state.floorCalls >= 3) queueMicrotask(() => { f.state.time = f.request.admission.origin.dispatchUntil; }); };
    const r = await create(f.config).executeAdmitted(f.request); expect(r.actionAttempted).toBe(false); expect(f.state.calls).toBe(0);
  });
  it("post-effect 201-digest overflow becomes unknown metadata, without reopening consumption", async () => {
    const f = fixture(); await admitted(f); f.config.executeAction = i => { f.state.calls++; return report(i, TIME, { evidenceDigests: Array.from({ length: 201 }, (_, n) => hash(String(n))) }); };
    const r = await create(f.config).executeAdmitted(f.request); expect(r).toMatchObject({ actionAttempted: true, actionReport: "unknown", pendingBarrier: true }); expect(captureRecord(f).rowsWritten).toBeNull(); expect(f.state.calls).toBe(1);
  });
  it("lost final capture acknowledgement never repeats the fixed effect", async () => {
    const f = fixture(); await admitted(f); f.bucket.afterPut = key => { if (key.endsWith("manifest")) throw Error("unknown final ack"); };
    const r = await f.gate.executeAdmitted(f.request); expect(r).toMatchObject({ status: "indeterminate", actionAttempted: true, metadataCaptured: false, consumption: "confirmed" }); delete f.bucket.afterPut;
    expect((await f.gate.readCapture(f.request)).metadataCaptured).toBe(true); expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false); expect(f.state.calls).toBe(1);
  });
  it("advertised oversized claim refuses before body acquisition and cannot expose raw bytes", async () => {
    const f = fixture(); await admitted(f); const get = vi.fn(() => { throw Error("raw private body accessed"); }); f.bucket.get = async () => ({ etag: "bounded", size: 8193, get body() { return get(); } });
    const r = await f.gate.executeAdmitted(f.request); expect(r.actionAttempted).toBe(false); expect(get).not.toHaveBeenCalled(); expect(JSON.stringify(r)).not.toContain("raw private"); expect(f.state.calls).toBe(0);
  });
  it("a signed foreign capsule with more than16 chunks cannot cause unbounded readback", async () => {
    const f = fixture(); await admitted(f); await f.gate.executeAdmitted(f.request); const base = `follow-up-evidence-capture/v1/${f.request.admission.businessKey}/`, envelope = JSON.parse(f.bucket.data.get(base + "manifest"));
    const capsule = chunkFollowUpEvidenceCapture(report(f.request.capture.intent, TIME, { evidenceDigests: Array.from({ length: 200 }, (_, n) => hash(String(n))) }), { operationId: f.request.admission.businessKey, chunkBytes: 512 }); expect(capsule.chunks.length).toBeGreaterThan(16);
    const { chunks, ...capture } = capsule; envelope.body.capture = capture; envelope.signature = sign(null, Buffer.from(FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN + canonical(envelope.body)), pairs.receipt.privateKey).toString("base64");
    f.bucket.data.set(base + "manifest", canonical(envelope)); for (const c of chunks) f.bucket.data.set(base + `chunk-${c.ordinal}`, canonical(c));
    const before = f.bucket.log.length, r = await f.gate.readCapture(f.request); expect(r.status).toBe("indeterminate"); expect(r.rpcCount).toBeLessThanOrEqual(64); expect(f.bucket.log.slice(before)).not.toContain("get:chunk-16"); expect(f.state.calls).toBe(1);
  });
  it("rejects unbounded control results without evaluating getters or invoking action", async () => {
    const f = fixture(), getter = vi.fn(); f.config.registry.read = async () => { const s = f.registry.snapshot(f.request.admission.businessKey); Object.defineProperty(s.control, "mode", { enumerable: true, get: getter }); return s; };
    expect((await create(f.config).admit(f.request)).status).toBe("refused"); expect(getter).not.toHaveBeenCalled(); expect(f.state.calls).toBe(0);
  });
  it.each([{ waitMs: 0 }, { waitMs: 20001 }, { operationMs: 60001 }, { operationMs: 1 }])("rejects oversized/unusable factory timing %j", changes => { const f = fixture(); expect(() => create({ ...f.config, ...changes })).toThrow(); });
  it("provides no network, installer, auth transport, deletion or runtime defaults and preserves frozen hashes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw Error("network forbidden"); }); const f = fixture(); await admitted(f); await f.gate.executeAdmitted(f.request); await f.gate.readCapture(f.request); expect(spy).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../../scripts/lib/follow-up-evidence-admission-gate.mjs", import.meta.url), "utf8"); expect(/node:(?:fs|http|https|net|child_process)|\bfetch\s*\(|process\.|(?:bucket|registry|witness)\.delete\s*\(|withExactBitwarden|wrangler|BEGIN IMMEDIATE/.test(source)).toBe(false);
    for (const [name, expected] of [["follow-up-evidence-capture.mjs", "db7bae45b8364e5cdca541678f3949877e131db9a8a5ff9cf84e5af1628644f9"], ["follow-up-evidence-capture-integration.mjs", "80eb6ea3d916f5bdc5b934d87ba13ac46ace2013399bd628548e80841d557804"]]) expect(hash(readFileSync(new URL(`../../scripts/lib/${name}`, import.meta.url)))).toBe(expected);
  });
});

describe("independent-process registry persistence (synthetic only)", () => {
  it("two processes compete through actual SQLite transactions, then restart cannot resume", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amari-admission-synthetic-")); directories.push(directory); const path = join(directory, "registry.sqlite"), registry = new SQLiteRegistry(path); databases.push(registry.db); registry.seed(initial(scope));
    const f = fixture({ registry }); await admitted(f); const witnessDb = new DatabaseSync(join(directory, "witness.sqlite")); databases.push(witnessDb); witnessDb.exec("CREATE TABLE head(id INTEGER PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE events(id TEXT PRIMARY KEY,data TEXT NOT NULL)"); witnessDb.prepare("INSERT INTO head VALUES(1,?)").run(canonical(f.witness.head)); for (const [key, event] of f.witness.events) witnessDb.prepare("INSERT INTO events VALUES(?,?)").run(key, canonical(event));
    const modulePath = fileURLToPath(new URL("../../scripts/lib/follow-up-evidence-admission-gate.mjs", import.meta.url));
    // Use this synthetic fixture's literal class, not Vite's transformed function
    // string (which contains module-runner-only import aliases).
    const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8"), registrySource = testSource.slice(testSource.indexOf("class SQLiteRegistry {"), testSource.indexOf("\nclass MemoryWitness {"));
    const program = `
      import { DatabaseSync } from 'node:sqlite';
      import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
      import { join, dirname } from 'node:path';
      import { createHash, createPublicKey, createPrivateKey, sign } from 'node:crypto';
      import { createFollowUpEvidenceAdmissionGate as create, followUpCurrentFloorSigningBytes } from ${JSON.stringify(modulePath)};
      const canonical=${canonical.toString()}, clone=${clone.toString()}, hash=x=>createHash('sha256').update(x).digest('hex'), id=x=>'id_'+hash(x);
      ${registrySource}
      const input=JSON.parse(readFileSync(0,'utf8')), directory=process.argv[1];
      const registry=new SQLiteRegistry(join(directory,'registry.sqlite')), w=new DatabaseSync(join(directory,'witness.sqlite'));
      w.exec('PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL');
      const witness={async readHead(){return JSON.parse(w.prepare('SELECT data FROM head WHERE id=1').get().data)},async readTransition(k){const r=w.prepare('SELECT data FROM events WHERE id=?').get(k);return r?JSON.parse(r.data):null},async putTransition(e){const d=hash(canonical(e)),r=w.prepare('INSERT INTO events VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(d,canonical(e));return r.changes?{digest:d}:null},async compareAndSwapHead(p,n){const r=w.prepare('UPDATE head SET data=? WHERE id=1 AND data=?').run(canonical(n),canonical(p));return r.changes?{head:n}:null}};
      const pub=s=>createPublicKey({key:Buffer.from(s,'base64'),type:'spki',format:'der'}),priv=s=>createPrivateKey({key:Buffer.from(s,'base64'),type:'pkcs8',format:'der'});
      const bucket={async put(k,t,o){if(o.onlyIf.etagDoesNotMatch!=='*')throw Error('condition');const p=join(directory,'capture',k);mkdirSync(dirname(p),{recursive:true});try{writeFileSync(p,t,{flag:'wx'})}catch(e){if(e.code==='EEXIST')return null;throw e}return {etag:hash(t)}},async get(k){let b;try{b=readFileSync(join(directory,'capture',k))}catch(e){if(e.code==='ENOENT')return null;throw e}return {etag:hash(b),size:b.length,body:new ReadableStream({start(c){c.enqueue(b);c.close()}})}}};
      const a=input.request.admission,s=a.scope,currentFloor={async read(c){const f={version:'follow-up-current-floor.v1',challengeDigest:hash('amari/follow-up-floor-challenge/v1\\n'+canonical(c)),scopeDigest:hash(canonical(s)),epoch:s.epoch,generation:s.generation,issuerReleaseDigest:s.issuerReleaseDigest,minimumOriginSequence:1,originDigest:hash(canonical(a.origin)),aliasSetDigest:a.aliasSetDigest,replayHorizonUntil:a.replayHorizonUntil,eligibility:'clear',issuedAt:input.time,expiresAt:input.time+30000};return {floor:f,keyId:id('floor key'),signature:sign(null,followUpCurrentFloorSigningBytes(f),priv(input.keys.floor.private)).toString('base64')}}};
      const gate=create({scope:s,registry,witness,currentFloor,admissionKeys:[{keyId:id('admission key'),publicKey:pub(input.keys.admission.public)}],floorKeys:[{keyId:id('floor key'),publicKey:pub(input.keys.floor.public)}],capture:{bucket,intentKeys:[{keyId:id('capture key'),publicKey:pub(input.keys.capture.public)}],receiptKeys:[{keyId:id('receipt key'),publicKey:pub(input.keys.receipt.public)}],receiptSigner:{keyId:id('receipt key'),privateKey:priv(input.keys.receipt.private)}},executeAction:i=>{appendFileSync(join(directory,'effects'),'effect\\n');return {...input.report,operationId:i.operationId}},clock:()=>input.time,waitMs:1000,operationMs:5000});
      const r=await gate.executeAdmitted(input.request);process.stdout.write(JSON.stringify({status:r.status,actionAttempted:r.actionAttempted,exactlyOnceProven:r.exactlyOnceProven}));registry.db.close();w.close();
    `;
    const input = JSON.stringify({ request: f.request, time: TIME, report: report(f.request.capture.intent), keys: Object.fromEntries(Object.entries(pairs).map(([name, pair]) => [name, { public: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), private: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") }])) });
    const child = () => new Promise((resolve, reject) => { const p = spawn(process.execPath, ["--input-type=module", "-e", program, directory], { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = ""; p.stdout.on("data", b => { stdout += b; }); p.stderr.on("data", b => { stderr += b; }); p.on("error", reject); p.on("close", code => { if (code) reject(Error(`synthetic child ${code}: ${stderr}`)); else { try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); } } }); p.stdin.end(input); });
    const results = await Promise.all([child(), child()]); expect(results.filter(r => r.actionAttempted)).toHaveLength(1); expect((await child()).actionAttempted).toBe(false); expect(readFileSync(join(directory, "effects"), "utf8")).toBe("effect\n"); expect(results.every(r => r.exactlyOnceProven === false)).toBe(true);
  });
});

describe("strict admission, origin, floor and replay boundaries", () => {
  it.each(["signature", "key", "domain", "capture_signature", "extra", "scope", "business_key"])("refuses %s before any port IO", async kind => {
    const f = fixture(), r = clone(f.request);
    if (kind === "signature") r.signature = Buffer.alloc(64).toString("base64");
    if (kind === "key") r.keyId = id("not trusted");
    if (kind === "domain") r.signature = sign(null, Buffer.from(FOLLOW_UP_FLOOR_DOMAIN + canonical(r.admission)), pairs.admission.privateKey).toString("base64");
    if (kind === "capture_signature") r.capture.signature = Buffer.alloc(64).toString("base64");
    if (kind === "extra") r.approved = true;
    if (kind === "scope") r.admission.scope.environment = "production";
    if (kind === "business_key") r.admission.businessKey = id("new caller nonce");
    expect((await f.gate.admit(r)).status).toBe("refused"); expect(f.registry.log).toHaveLength(0); expect(f.state.floorCalls).toBe(0); expect(f.bucket.log).toHaveLength(0);
  });
  it.each(["sourceRevision", "actionDigest", "handlerDigest", "registryId", "sinkId", "schemaDigest", "epoch", "generation", "issuerReleaseDigest", "accountId", "targetId"])("exact signed/factory scope binds %s", async field => {
    const f = fixture(), changed = clone(scope); changed[field] = field === "generation" ? 2 : field === "sourceRevision" ? "b".repeat(40) : field.endsWith("Id") || field === "epoch" ? id("other") : hash("other");
    const r = authorize({ scope: changed });
    expect((await f.gate.admit(r)).status).toBe("refused"); expect(f.registry.log).toHaveLength(0);
  });
  it.each(["getter", "symbol", "hidden", "prototype", "toJSON", "long_key", "huge", "cycle", "negative_zero"])("refuses hostile %s without calling accessors", async kind => {
    const f = fixture(), r = clone(f.request), spy = vi.fn(() => "private person content");
    if (kind === "getter") Object.defineProperty(r, "signature", { enumerable: true, get: spy });
    if (kind === "symbol") r[Symbol("private")] = 1;
    if (kind === "hidden") Object.defineProperty(r, "hidden", { value: 1 });
    if (kind === "prototype") Object.setPrototypeOf(r, { inherited: true });
    if (kind === "toJSON") r.toJSON = spy;
    if (kind === "long_key") r["k".repeat(129)] = null;
    if (kind === "huge") r.admission.aliasSetDigest = "x".repeat(32769);
    if (kind === "cycle") r.admission.origin = r;
    if (kind === "negative_zero") r.admission.origin.originalAt = -0;
    expect((await f.gate.admit(r)).status).toBe("refused"); expect(spy).not.toHaveBeenCalled(); expect(f.registry.log).toHaveLength(0);
  });
  it("snapshots the request before awaits and freezes factory scope, callback intent and outputs", async () => {
    const f = fixture(), r = clone(f.request), original = clone(r);
    f.registry.beforeRead = () => { r.admission.origin.dispatchUntil = TIME + 999999; r.capture.intent.operationId = id("mutated"); f.config.scope.sourceRevision = "b".repeat(40); };
    const result = await f.gate.admit(r); expect(result.status).toBe("admitted"); expect(result.operationId).toBe(original.admission.businessKey); delete f.registry.beforeRead;
    f.config.scope = clone(scope); f.config.executeAction = i => { expect(Object.isFrozen(i)).toBe(true); return report(i); }; expect((await create(f.config).executeAdmitted(original)).actionAttempted).toBe(true); noGrants(result);
  });
  it.each(["renewal", "origin", "unknown_horizon", "parent", "deletion", "ninety_days", "budget"])("immutable retention/origin law rejects %s", async kind => {
    const f = fixture(), a = clone(f.request.admission);
    if (kind === "renewal") a.origin.dispatchUntil = a.origin.approvedAt + 300001;
    if (kind === "origin") a.origin.originalAt = a.origin.approvedAt + 1;
    if (kind === "unknown_horizon") a.replayHorizonUntil = null;
    if (kind === "parent") a.parentDeadline = a.retentionUntil - 1;
    if (kind === "deletion") a.deletionDeadline = a.retentionUntil - 1;
    if (kind === "ninety_days") { a.parentDeadline = null; a.retentionUntil = a.origin.originalAt + 90 * DAY + 1; }
    if (kind === "budget") a.quotas.rpcs = 65;
    expect(() => followUpAdmissionSigningBytes(a)).toThrow("admission_gate_refused");
  });
  it("new signed nonce/key/source cannot renew a stable authenticated business action", async () => {
    const f = fixture(); await admitted(f); const renewed = authorize({ issuedAt: TIME + 1, issuerSequence: 11, origin: { ...f.request.admission.origin, dispatchUntil: TIME + 60001 } }); f.state.time++;
    expect(renewed.admission.businessKey).toBe(f.request.admission.businessKey); expect((await f.gate.admit(renewed)).status).toBe("refused");
    const pair = generateKeyPairSync("ed25519"), rotated = clone(f.request); rotated.signature = sign(null, followUpAdmissionSigningBytes(rotated.admission), pair.privateKey).toString("base64");
    const gate = create({ ...f.config, admissionKeys: [{ keyId: rotated.keyId, publicKey: pair.publicKey }] }); expect((await gate.admit(rotated)).reasonCode).toBe("admission_already_recorded");
    await gate.executeAdmitted(rotated); expect((await gate.executeAdmitted(rotated)).actionAttempted).toBe(false); expect(f.state.calls).toBe(1);
  });
  it("even after mapping loss, forged-new original approval is rejected by independent origin proof", async () => {
    const f = fixture(), replacement = authorize({ origin: { ...f.request.admission.origin, approvedAt: TIME + 1, dispatchUntil: TIME + 60001 }, issuedAt: TIME + 1 }); f.state.time++;
    expect((await f.gate.admit(replacement)).status).toBe("refused"); expect(f.registry.snapshot(replacement.admission.businessKey).entry).toBeNull();
  });
  it.each(["challenge", "scope", "origin", "old_release", "old_epoch", "ingress_floor", "aliases", "horizon", "suppressed", "closed", "stale", "future"])("refuses signed but wrong/current-floor %s", async kind => {
    const f = fixture();
    const changes = { challenge: { challengeDigest: hash("old nonce") }, scope: { scopeDigest: hash("different scope") }, origin: { originDigest: hash("different origin") }, old_release: { issuerReleaseDigest: hash("old serving release") }, old_epoch: { epoch: id("old epoch") }, ingress_floor: { minimumOriginSequence: 11 }, aliases: { aliasSetDigest: hash("missing historical alias") }, horizon: { replayHorizonUntil: TIME + 101 * DAY }, suppressed: { eligibility: "suppressed" }, closed: { eligibility: "closed" }, stale: { issuedAt: TIME - 1, expiresAt: TIME + 100 }, future: { issuedAt: TIME + 1, expiresAt: TIME + 100 } };
    f.state.overrides = changes[kind]; expect((await f.gate.admit(f.request)).status).toBe("refused"); expect(f.registry.log).not.toContain("transact"); expect(f.state.calls).toBe(0);
  });
  it("floor signature is domain-separated and the issuer key must be factory trusted", async () => {
    const f = fixture(), original = f.config.currentFloor.read;
    for (const kind of ["domain", "key"]) {
      f.config.currentFloor = { async read(c) { const r = await original(c); if (kind === "key") r.keyId = id("caller selected"); else r.signature = sign(null, Buffer.from(FOLLOW_UP_ADMISSION_DOMAIN + canonical(r.floor)), pairs.floor.privateKey).toString("base64"); return r; } };
      expect((await create(f.config).admit(f.request)).status).toBe("refused");
    }
  });
  it.each(["before", "after", "confirm"])("unknown admission %s acknowledgement is indeterminate, not no-write refusal", async where => {
    const f = fixture(), fail = () => { throw Error("lost admission acknowledgement"); };
    if (where === "before") f.registry.beforeTransaction = fail; if (where === "after") f.registry.afterTransaction = fail; if (where === "confirm") f.registry.beforeConfirm = fail;
    const r = await f.gate.admit(f.request); expect(r).toMatchObject({ status: "indeterminate", registryState: "unavailable", pendingBarrier: null, actionAttempted: false }); expect(f.state.calls).toBe(0); expect(f.bucket.log).toHaveLength(0);
  });
  it("current read authorization/suppression belongs to trusted read port, not historical ticket", async () => {
    const f = fixture(); await admitted(f); await f.gate.executeAdmitted(f.request); f.state.time += 60001;
    expect((await f.gate.readCapture(f.request)).metadataCaptured).toBe(true); // legitimate retained history beyond dispatch window
    const gets = f.bucket.log.length; f.registry.beforeRead = () => { throw Error("present read access withdrawn / subject suppressed"); };
    for (const method of ["readStatus", "readCapture"]) expect((await f.gate[method](f.request)).status).toBe("indeterminate"); expect(f.bucket.log).toHaveLength(gets); expect(f.state.calls).toBe(1);
  });
  it("deleting capture objects does not reopen intact registry consumption", async () => { const f = fixture(); await admitted(f); await f.gate.executeAdmitted(f.request); f.bucket.data.clear(); expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false); expect((await f.gate.readCapture(f.request)).metadataCaptured).toBe(false); expect(f.state.calls).toBe(1); });
  it("independent witness detects a restored ADMITTED registry row/control", async () => {
    const f = fixture(); await admitted(f); const before = f.registry.snapshot(f.request.admission.businessKey); await f.gate.executeAdmitted(f.request);
    f.registry.db.prepare("UPDATE control SET data=? WHERE id=1").run(canonical(before.control)); f.registry.db.prepare("UPDATE entries SET data=? WHERE id=?").run(canonical(before.entry), f.request.admission.businessKey);
    expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false); expect((await f.gate.readStatus(f.request)).status).toBe("indeterminate"); expect(f.state.calls).toBe(1);
  });
  it.each(["head", "event", "event_payload", "registry_row"])("missing/corrupt %s is a gap, never an empty fresh permission", async kind => {
    const f = fixture(); await admitted(f); const s = f.registry.snapshot(f.request.admission.businessKey);
    if (kind === "head") f.witness.head = null;
    if (kind === "event") f.witness.events.delete(s.entry.transitionDigest);
    if (kind === "event_payload") f.witness.events.get(s.entry.transitionDigest).at++;
    if (kind === "registry_row") f.registry.db.prepare("DELETE FROM entries WHERE id=?").run(f.request.admission.businessKey);
    expect((await f.gate.executeAdmitted(f.request)).actionAttempted).toBe(false); expect((await f.gate.readStatus(f.request)).status).toBe("indeterminate"); expect(f.state.calls).toBe(0);
  });
  it("explicitly demonstrates undetectable coherent same-epoch dual rollback, not exactly-once", async () => {
    const f = fixture(); await admitted(f); const before = f.registry.snapshot(f.request.admission.businessKey), events = new Map(f.witness.events), oldHead = clone(f.witness.head);
    expect((await f.gate.executeAdmitted(f.request)).actionAttempted).toBe(true);
    // Synthetic administrative restoration of BOTH independent stores and their
    // acknowledgements, with unchanged current issuer epoch. No gate operation
    // performs this. A fresh floor is not a per-action high-water oracle.
    f.registry.db.prepare("UPDATE control SET data=? WHERE id=1").run(canonical(before.control)); f.registry.db.prepare("UPDATE entries SET data=? WHERE id=?").run(canonical(before.entry), f.request.admission.businessKey);
    f.registry.db.exec("DELETE FROM receipts"); f.witness.events = events; f.witness.head = oldHead; f.bucket.data.clear();
    const r = await create(f.config).executeAdmitted(f.request); expect(r.actionAttempted).toBe(true); expect(f.state.calls).toBe(2); noGrants(r); expect(r.coherentRollbackDetectionProven).toBe(false);
  });
  it("controlled prior floor retirement rejects the same restored old ticket", async () => {
    const f = fixture(); await admitted(f); f.state.overrides.epoch = id("new active epoch"); expect((await create(f.config).executeAdmitted(f.request)).actionAttempted).toBe(false); expect(f.state.calls).toBe(0);
  });
});
