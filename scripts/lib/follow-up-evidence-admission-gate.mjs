import { createHash, KeyObject, randomBytes, verify } from "node:crypto";
import { createFollowUpEvidenceCaptureIntegration, followUpEvidenceIntentSigningBytes } from "./follow-up-evidence-capture-integration.mjs";

/**
 * Inert source contract: no client, resource binding, credential, installer,
 * bootstrap/reset, purge, retry or transferable execution permit is provided.
 *
 * Trusted ports (not request-supplied capabilities):
 * registry.read(businessKey) -> {control, entry}; its eventual adapter MUST enforce
 * PRESENT caller/scope/subject read authorization and deletion/suppression on
 * every read. A historical signed admission is NOT a lasting read grant. This
 * source wrapper has no caller identity/authentication transport of its own.
 * registry.transact(businessKey, synchronousUpdater) -> {transactionId,snapshot}.
 * The port MUST serialize the WHOLE scope, including control/head/pending, and
 * atomically persist the updater's {control,entry}. It may retry the pure updater.
 * registry.confirm(transactionId) -> the same receipt, only after its durable
 * storage barrier. transactionId = SHA256(domain + canonical(snapshot)). Neither
 * a self-reported boolean nor a post-read substitutes for the atomic transaction.
 * witness.readHead(scopeDigest), readTransition(digest), putTransition(event),
 * compareAndSwapHead(previousHead,nextHead): immutable conditional event create,
 * exact {digest} acknowledgement (or null if present), and exact {head} CAS ack.
 * The eventual witness adapter must authenticate its signed envelopes; this
 * module hashes/compares typed events, but does not implement a witness signer.
 * event.retentionUntil is the immutable shortest original deadline, not at+90d;
 * the adapter must enforce it for events and linkable head/read access. Purge
 * and control-floor retirement are not implemented by this module.
 * currentFloor.read(challenge) returns an Ed25519-signed fresh certificate. Its
 * issuer must independently verify immutable source/original approval, all still
 * needed suppression aliases and the CURRENT non-regressing administrative floor.
 * A signature proves configured-key bytes, NOT any of those operational facts.
 *
 * Seeded positive control + independent head are required; absence is never an
 * invitation to initialize. Surviving consumed rows or independent witness detect
 * one-sided rollback. Coherent unannounced same-epoch registry+witness rollback
 * can be indistinguishable, even with a fresh issuer. Controlled retirement/drain,
 * deletion/suppression/key governance and actual private adapters remain gates.
 *
 * Only the original acknowledged consume invocation can enter the frozen capture
 * adapter. Its fixed action wrapper performs a NEW floor/registry/witness check
 * after the capture claim, with a separate inner callback deadline. The action
 * barrier remains after capture (capture != proven effect outcome); this module
 * has no maintenance unlock. Read APIs never mutate or resume an invocation.
 */
export const FOLLOW_UP_ADMISSION_GATE_VERSION = "follow-up-evidence-admission-gate.v1";
export const FOLLOW_UP_ADMISSION_DOMAIN = "amari/follow-up-admission/v1\n";
export const FOLLOW_UP_FLOOR_DOMAIN = "amari/follow-up-current-floor/v1\n";
const CHALLENGE_DOMAIN = "amari/follow-up-floor-challenge/v1\n", TX_DOMAIN = "amari/follow-up-registry-transaction/v1\n";
const DAY = 86400000, MAX_CONTROL = 8192, MAX_IO_BYTES = 262144;
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, authority: false, productionAllowed: false, executionAllowed: false, adoptionAllowed: false, dispatchAllowed: false, retryAllowed: false, restoreAllowed: false, providerOutcomeProven: false, providerAuthenticityProven: false, sinkDurabilityProven: false, registryDurabilityProven: false, liveAuthorizationProven: false, sourceAuthenticationProven: false, exactlyOnceProven: false, coherentRollbackDetectionProven: false });
const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const freeze = v => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const need = v => { if (!v) throw new TypeError("admission_gate_refused"); };
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => need(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max);
const digest = v => need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
const opaque = v => need(typeof v === "string" && /^id_[a-f0-9]{64}$/.test(v));
const equal = (a, b) => canonical(a) === canonical(b);
function exact(v, keys) { need(v && typeof v === "object" && !Array.isArray(v)); const actual = Object.keys(v).sort(), expected = [...keys].sort(); need(actual.length === expected.length && actual.every((k, i) => k === expected[i])); }
function copy(v, depth = 0, state = { nodes: 0, bytes: 0, active: new Set() }) {
  need(depth <= 12 && ++state.nodes <= 2000);
  const charge = n => { state.bytes += n; need(state.bytes <= 32768); };
  if (v === null || typeof v === "boolean") { charge(5); return v; }
  if (typeof v === "number") { need(Number.isFinite(v) && !Object.is(v, -0)); charge(32); return v; }
  if (typeof v === "string") { need(v.length <= MAX_CONTROL); charge(Buffer.byteLength(v)); return v; }
  need(v && typeof v === "object" && !state.active.has(v)); const array = Array.isArray(v);
  need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
  const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds), length = array ? ds.length?.value : null;
  need(keys.length <= 201); if (array) need(Number.isSafeInteger(length) && length >= 0 && length <= 200 && keys.length === length + 1);
  state.active.add(v); charge(2); const result = array ? [] : {};
  for (const key of keys) { if (array && key === "length") continue; const d = ds[key]; need(typeof key === "string" && key.length <= 128 && key !== "toJSON" && d.enumerable && Object.hasOwn(d, "value")); if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length); charge(key.length + 3); Object.defineProperty(result, key, { value: copy(d.value, depth + 1, state), enumerable: true, writable: true, configurable: true }); }
  state.active.delete(v); return result;
}
function controlValue(v) { const result = copy(v); need(Buffer.byteLength(canonical(result)) <= MAX_CONTROL); return result; }
const SCOPE_KEYS = ["accountId", "targetId", "actionScopeDigest", "environment", "sinkId", "registryId", "schemaDigest", "sourceRevision", "actionDigest", "handlerDigest", "epoch", "generation", "issuerReleaseDigest", "policyVersion"];
function scopeValue(v) {
  exact(v, SCOPE_KEYS); for (const k of ["accountId", "targetId", "sinkId", "registryId", "epoch"]) opaque(v[k]);
  for (const k of ["actionScopeDigest", "schemaDigest", "actionDigest", "handlerDigest", "issuerReleaseDigest"]) digest(v[k]);
  need(typeof v.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(v.sourceRevision)); need(["synthetic", "production"].includes(v.environment)); integer(v.generation, 1); need(v.policyVersion === "follow-up-retention-policy.v1"); return v;
}
function originValue(v) { exact(v, ["sourceId", "sequence", "originalAt", "approvedAt", "dispatchUntil"]); opaque(v.sourceId); integer(v.sequence, 1); for (const k of ["originalAt", "approvedAt", "dispatchUntil"]) integer(v[k]); need(v.originalAt <= v.approvedAt && v.approvedAt < v.dispatchUntil && v.dispatchUntil - v.approvedAt <= 300000); return v; }
function businessKey(a) { return "id_" + hash(canonical({ accountId: a.scope.accountId, targetId: a.scope.targetId, actionScopeDigest: a.scope.actionScopeDigest, environment: a.scope.environment, sourceId: a.origin.sourceId, sequence: a.origin.sequence })); }
function admissionValue(input) {
  const a = controlValue(input); exact(a, ["version", "scope", "origin", "businessKey", "captureIntentDigest", "aliasSetDigest", "replayHorizonUntil", "retentionUntil", "parentDeadline", "deletionDeadline", "issuedAt", "issuerSequence", "quotas"]);
  need(a.version === "follow-up-admission.v1"); scopeValue(a.scope); originValue(a.origin); opaque(a.businessKey); need(a.businessKey === businessKey(a)); digest(a.captureIntentDigest); digest(a.aliasSetDigest);
  for (const k of ["replayHorizonUntil", "retentionUntil", "issuedAt"]) integer(a[k]); integer(a.issuerSequence, 1);
  for (const k of ["parentDeadline", "deletionDeadline"]) if (a[k] !== null) integer(a[k]);
  need(a.origin.approvedAt <= a.issuedAt && a.issuedAt < a.origin.dispatchUntil && a.origin.dispatchUntil < a.retentionUntil);
  need(a.retentionUntil <= a.origin.originalAt + 90 * DAY && [a.parentDeadline, a.deletionDeadline].every(t => t === null || a.retentionUntil <= t));
  need(a.replayHorizonUntil >= a.origin.dispatchUntil + 7 * DAY);
  exact(a.quotas, ["metadataBytes", "chunks", "rpcs"]); need(a.quotas.metadataBytes === 24000 && a.quotas.chunks === 16 && a.quotas.rpcs === 64); return freeze(a);
}
export function followUpAdmissionSigningBytes(admission) { return Buffer.from(FOLLOW_UP_ADMISSION_DOMAIN + canonical(admissionValue(admission))); }
function floorValue(input) {
  const f = controlValue(input); exact(f, ["version", "challengeDigest", "scopeDigest", "epoch", "generation", "issuerReleaseDigest", "minimumOriginSequence", "originDigest", "aliasSetDigest", "replayHorizonUntil", "eligibility", "issuedAt", "expiresAt"]);
  need(f.version === "follow-up-current-floor.v1"); for (const k of ["challengeDigest", "scopeDigest", "issuerReleaseDigest", "originDigest", "aliasSetDigest"]) digest(f[k]); opaque(f.epoch);
  for (const k of ["generation", "minimumOriginSequence"]) integer(f[k], 1); for (const k of ["replayHorizonUntil", "issuedAt", "expiresAt"]) integer(f[k]);
  need(["clear", "suppressed", "unavailable", "closed"].includes(f.eligibility)); need(f.issuedAt < f.expiresAt && f.expiresAt - f.issuedAt <= 30000); return freeze(f);
}
export function followUpCurrentFloorSigningBytes(floor) { return Buffer.from(FOLLOW_UP_FLOOR_DOMAIN + canonical(floorValue(floor))); }
function keysValue(entries) {
  need(Array.isArray(entries) && entries.length > 0 && entries.length <= 16); const keys = new Map();
  for (const entry of entries) { exact(entry, ["keyId", "publicKey"]); need(Object.values(Object.getOwnPropertyDescriptors(entry)).every(d => Object.hasOwn(d, "value"))); opaque(entry.keyId); need(entry.publicKey instanceof KeyObject && entry.publicKey.type === "public" && entry.publicKey.asymmetricKeyType === "ed25519" && !keys.has(entry.keyId)); keys.set(entry.keyId, entry.publicKey); } return keys;
}
function signature(value, bytes, keys) {
  opaque(value.keyId); need(keys.has(value.keyId) && typeof value.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(value.signature)); const sig = Buffer.from(value.signature, "base64"); need(sig.length === 64 && sig.toString("base64") === value.signature && verify(null, bytes, keys.get(value.keyId), sig));
}
const headOf = c => ({ scopeDigest: c.scopeDigest, epoch: c.epoch, generation: c.generation, sequence: c.sequence, digest: c.headDigest });
const txId = snapshot => hash(TX_DOMAIN + canonical(snapshot));
const rowDigest = entry => { const { transitionDigest: omitted, ...rest } = entry; return hash(canonical(rest)); };
function headValue(input) { const h = controlValue(input); exact(h, ["scopeDigest", "epoch", "generation", "sequence", "digest"]); digest(h.scopeDigest); digest(h.digest); opaque(h.epoch); integer(h.generation, 1); integer(h.sequence); return h; }
function eventValue(input) {
  const e = controlValue(input); exact(e, ["version", "scopeDigest", "epoch", "generation", "sequence", "previousDigest", "kind", "businessKey", "admissionDigest", "originDigest", "at", "retentionUntil", "previousEntryDigest", "entryDigest"]);
  need(e.version === "follow-up-admission-transition.v1" && ["admit", "consume"].includes(e.kind)); for (const k of ["scopeDigest", "previousDigest", "admissionDigest", "originDigest", "entryDigest"]) digest(e[k]); if (e.previousEntryDigest !== null) digest(e.previousEntryDigest); opaque(e.epoch); opaque(e.businessKey); integer(e.generation, 1); integer(e.sequence, 1); integer(e.at); integer(e.retentionUntil); need(e.at < e.retentionUntil && (e.kind === "admit") === (e.previousEntryDigest === null)); return e;
}

export function createFollowUpEvidenceAdmissionGate(config) {
  exact(config, ["scope", "admissionKeys", "floorKeys", "registry", "currentFloor", "witness", "capture", "executeAction", "clock", "waitMs", "operationMs"]);
  need(Object.values(Object.getOwnPropertyDescriptors(config)).every(d => Object.hasOwn(d, "value")));
  const scope = freeze(scopeValue(controlValue(config.scope))), scopeDigest = hash(canonical(scope));
  const admissionKeys = keysValue(config.admissionKeys), floorKeys = keysValue(config.floorKeys), registry = config.registry, floor = config.currentFloor, witness = config.witness;
  for (const [port, methods] of [[registry, ["read", "transact", "confirm"]], [floor, ["read"]], [witness, ["readHead", "readTransition", "putTransition", "compareAndSwapHead"]]]) need(port && methods.every(k => typeof port[k] === "function"));
  const action = config.executeAction, clock = config.clock, waitMs = config.waitMs, operationMs = config.operationMs;
  need(typeof action === "function" && typeof clock === "function"); integer(waitMs, 1, 20000); integer(operationMs, waitMs, 60000);
  const capture = config.capture; exact(capture, ["bucket", "intentKeys", "receiptKeys", "receiptSigner"]); need(Object.values(Object.getOwnPropertyDescriptors(capture)).every(d => Object.hasOwn(d, "value")));
  const captureKeys = keysValue(capture.intentKeys), captureOptions = { bucket: capture.bucket, intentKeys: [...captureKeys].map(([keyId, publicKey]) => ({ keyId, publicKey })), receiptKeys: [...keysValue(capture.receiptKeys)].map(([keyId, publicKey]) => ({ keyId, publicKey })), receiptSigner: { ...capture.receiptSigner } };
  need(captureOptions.bucket && typeof captureOptions.bucket.get === "function" && typeof captureOptions.bucket.put === "function");
  const now = () => { const t = clock(); integer(t); return t; };
  const live = (ctx, dispatch = false) => { need(ctx.active && performance.now() < ctx.ends); if (dispatch) need(ctx.permit && performance.now() < ctx.callbackEnds); };
  const fresh = r => { const t = now(); need(r.admission.issuedAt <= t && t < r.admission.origin.dispatchUntil && t < r.admission.retentionUntil); return t; };
  function request(input, historical) {
    const r = controlValue(input); exact(r, ["admission", "capture", "keyId", "signature"]); const a = admissionValue(r.admission); need(equal(a.scope, scope)); signature(r, followUpAdmissionSigningBytes(a), admissionKeys);
    exact(r.capture, ["intent", "keyId", "signature"]); const i = r.capture.intent, bytes = followUpEvidenceIntentSigningBytes(i); signature(r.capture, bytes, captureKeys);
    need(hash(bytes) === a.captureIntentDigest && i.operationId === a.businessKey && i.originalAt === a.origin.originalAt && i.issuedAt === a.issuedAt && i.expiresAt === a.origin.dispatchUntil && i.retentionUntil === a.retentionUntil);
    need(["actionDigest", "sourceRevision", "sinkId", "environment"].every(k => i[k] === scope[k]));
    const deadlines = [a.parentDeadline, a.deletionDeadline].filter(t => t !== null); need(i.parentDeadline === (deadlines.length ? Math.min(...deadlines) : null));
    const result = freeze({ admission: a, capture: r.capture, admissionDigest: hash(followUpAdmissionSigningBytes(a)), originDigest: hash(canonical(a.origin)), operationId: a.businessKey });
    need(a.issuedAt <= now()); if (!historical) fresh(result); return result;
  }
  function snapshotValue(input, r) {
    const s = controlValue(input); exact(s, ["control", "entry"]); const c = s.control;
    exact(c, ["version", "scopeDigest", "epoch", "generation", "mode", "sequence", "headDigest", "pending"]);
    need(c.version === "follow-up-admission-control.v1" && c.scopeDigest === scopeDigest && c.epoch === scope.epoch && c.generation === scope.generation && ["active", "closed"].includes(c.mode)); integer(c.sequence); digest(c.headDigest);
    if (c.pending !== null) { exact(c.pending, ["transitionDigest", "operationId", "phase"]); digest(c.pending.transitionDigest); opaque(c.pending.operationId); need(["witness", "action"].includes(c.pending.phase) && c.pending.transitionDigest === c.headDigest); }
    const e = s.entry;
    if (e !== null) {
      exact(e, ["version", "scopeDigest", "businessKey", "operationId", "admissionDigest", "originDigest", "originalAt", "dispatchUntil", "retentionUntil", "epoch", "generation", "status", "admittedSequence", "sequence", "transitionDigest", "consumeNonce"]);
      need(e.version === "follow-up-admission-entry.v1" && e.scopeDigest === scopeDigest && e.businessKey === r.operationId && e.operationId === r.operationId && e.epoch === scope.epoch && e.generation === scope.generation);
      for (const k of ["admissionDigest", "originDigest", "transitionDigest"]) digest(e[k]); for (const k of ["originalAt", "dispatchUntil", "retentionUntil"]) integer(e[k]); integer(e.admittedSequence, 1); integer(e.sequence, e.admittedSequence, c.sequence);
      need(["ADMITTED", "CONSUMED"].includes(e.status) && e.originalAt <= e.dispatchUntil && e.dispatchUntil < e.retentionUntil);
      if (e.status === "ADMITTED") need(e.consumeNonce === null && e.sequence === e.admittedSequence); else { digest(e.consumeNonce); need(e.sequence > e.admittedSequence); }
    }
    return freeze(s);
  }
  const boundEntry = (s, r) => { const e = s.entry; need(e && e.admissionDigest === r.admissionDigest && e.originDigest === r.originDigest && e.originalAt === r.admission.origin.originalAt && e.dispatchUntil === r.admission.origin.dispatchUntil && e.retentionUntil === r.admission.retentionUntil); return e; };
  function io(ctx, work, rpc = true) {
    live(ctx); if (rpc) need(++ctx.rpcs <= 64);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ctx.active = false; ctx.permit = false; reject(new Error("admission_io_unknown")); }, Math.max(1, Math.min(waitMs, ctx.ends - performance.now())));
      Promise.resolve().then(() => { live(ctx); return work(); }).then(v => { clearTimeout(timer); try { live(ctx); resolve(v); } catch (e) { reject(e); } }, () => { clearTimeout(timer); reject(new Error("admission_io_unknown")); });
    });
  }
  const charge = (ctx, n) => { integer(n, 0, MAX_IO_BYTES); ctx.bytes += n; need(ctx.bytes <= MAX_IO_BYTES); };
  async function controlCall(ctx, input, work) {
    charge(ctx, Buffer.byteLength(canonical(controlValue(input))));
    const value = controlValue(await io(ctx, work)); charge(ctx, Buffer.byteLength(canonical(value))); return value;
  }
  const read = async (ctx, r) => snapshotValue(await controlCall(ctx, { businessKey: r.operationId }, () => registry.read(r.operationId)), r);
  async function current(ctx, r, s, dispatch = false) {
    live(ctx, dispatch); fresh(r); const started = now();
    const challenge = freeze({ version: "follow-up-floor-challenge.v1", nonce: randomBytes(32).toString("hex"), scopeDigest, businessKey: r.operationId, admissionDigest: r.admissionDigest, originDigest: r.originDigest, expectedSequence: s.control.sequence, expectedHeadDigest: s.control.headDigest });
    const value = await controlCall(ctx, challenge, () => floor.read(challenge)); exact(value, ["floor", "keyId", "signature"]); const f = floorValue(value.floor); signature(value, followUpCurrentFloorSigningBytes(f), floorKeys);
    live(ctx, dispatch); fresh(r); const time = now(); need(f.challengeDigest === hash(CHALLENGE_DOMAIN + canonical(challenge)) && f.scopeDigest === scopeDigest && f.epoch === scope.epoch && f.generation === scope.generation && f.issuerReleaseDigest === scope.issuerReleaseDigest);
    need(f.originDigest === r.originDigest && f.aliasSetDigest === r.admission.aliasSetDigest && f.replayHorizonUntil === r.admission.replayHorizonUntil && f.eligibility === "clear" && r.admission.origin.sequence >= f.minimumOriginSequence);
    need(f.issuedAt >= started && f.issuedAt <= time && time < f.expiresAt); return f;
  }
  async function witnessCheck(ctx, r, s) {
    need(equal(headValue(await controlCall(ctx, { scopeDigest }, () => witness.readHead(scopeDigest))), headOf(s.control)));
    if (s.entry !== null) {
      const e = eventValue(await controlCall(ctx, { transitionDigest: s.entry.transitionDigest }, () => witness.readTransition(s.entry.transitionDigest))); need(hash(canonical(e)) === s.entry.transitionDigest && e.entryDigest === rowDigest(s.entry));
      need(e.scopeDigest === scopeDigest && e.epoch === scope.epoch && e.generation === scope.generation && e.businessKey === r.operationId && e.admissionDigest === s.entry.admissionDigest && e.originDigest === s.entry.originDigest && e.retentionUntil === s.entry.retentionUntil && e.sequence === s.entry.sequence && e.kind === (s.entry.status === "ADMITTED" ? "admit" : "consume"));
    }
  }
  async function transaction(ctx, r, expected, next, certificate) {
    live(ctx); need(++ctx.transactions <= 4); let calls = 0;
    // Once a transaction is offered, its failure may be a lost acknowledgement.
    // Invalidate cached negative state; only a fresh exact confirmation restores
    // observed fields. Preserve a previously confirmed consumption separately.
    ctx.mutationAttempted = true; ctx.registryState = "unavailable"; ctx.pendingBarrier = null;
    const receipt = await controlCall(ctx, { businessKey: r.operationId, expected, next }, () => registry.transact(r.operationId, actual => { need(++calls <= 8); live(ctx); fresh(r); need(now() < certificate.expiresAt && equal(snapshotValue(actual, r), expected)); return freeze(copy(next)); }));
    exact(receipt, ["transactionId", "snapshot"]); digest(receipt.transactionId); need(calls > 0 && equal(snapshotValue(receipt.snapshot, r), next) && receipt.transactionId === txId(next));
    const confirmed = await controlCall(ctx, { transactionId: receipt.transactionId }, () => registry.confirm(receipt.transactionId)); exact(confirmed, ["transactionId", "snapshot"]); need(equal(confirmed, receipt));
    const observed = snapshotValue(confirmed.snapshot, r); ctx.registryState = observed.entry?.status ?? "absent"; ctx.pendingBarrier = observed.control.pending !== null;
    if (observed.entry?.status === "CONSUMED") ctx.consumed = true; return observed;
  }
  async function transition(ctx, r, before, kind, certificate) {
    need(before.control.mode === "active" && before.control.pending === null); const at = fresh(r), sequence = before.control.sequence + 1; integer(sequence, 1);
    const prior = before.entry, entry = kind === "admit" ? { version: "follow-up-admission-entry.v1", scopeDigest, businessKey: r.operationId, operationId: r.operationId, admissionDigest: r.admissionDigest, originDigest: r.originDigest, originalAt: r.admission.origin.originalAt, dispatchUntil: r.admission.origin.dispatchUntil, retentionUntil: r.admission.retentionUntil, epoch: scope.epoch, generation: scope.generation, status: "ADMITTED", admittedSequence: sequence, sequence, transitionDigest: "0".repeat(64), consumeNonce: null } : { ...boundEntry(before, r), status: "CONSUMED", sequence, consumeNonce: randomBytes(32).toString("hex") };
    need(kind === "admit" ? prior === null : prior.status === "ADMITTED");
    const event = freeze({ version: "follow-up-admission-transition.v1", scopeDigest, epoch: scope.epoch, generation: scope.generation, sequence, previousDigest: before.control.headDigest, kind, businessKey: r.operationId, admissionDigest: r.admissionDigest, originDigest: r.originDigest, at, retentionUntil: r.admission.retentionUntil, previousEntryDigest: prior === null ? null : rowDigest(prior), entryDigest: rowDigest(entry) });
    entry.transitionDigest = hash(canonical(event)); const pending = { transitionDigest: entry.transitionDigest, operationId: r.operationId, phase: "witness" };
    const next = freeze({ control: { ...before.control, sequence, headDigest: entry.transitionDigest, pending }, entry });
    if (kind === "consume") ctx.consumeAttempted = true;
    const persisted = await transaction(ctx, r, before, next, certificate); if (kind === "consume") ctx.consumed = true;
    fresh(r); const ack = await controlCall(ctx, event, () => witness.putTransition(event)); if (ack !== null) { exact(ack, ["digest"]); need(ack.digest === entry.transitionDigest); }
    need(equal(eventValue(await controlCall(ctx, { transitionDigest: entry.transitionDigest }, () => witness.readTransition(entry.transitionDigest))), event));
    const headAck = await controlCall(ctx, { previous: headOf(before.control), next: headOf(next.control) }, () => witness.compareAndSwapHead(headOf(before.control), headOf(next.control))); exact(headAck, ["head"]); need(equal(headValue(headAck.head), headOf(next.control)));
    need(equal(headValue(await controlCall(ctx, { scopeDigest }, () => witness.readHead(scopeDigest))), headOf(next.control))); fresh(r);
    const final = { control: { ...persisted.control, pending: kind === "admit" ? null : { ...pending, phase: "action" } }, entry: persisted.entry };
    return transaction(ctx, r, persisted, final, certificate);
  }
  function bucketFor(ctx) {
    const bucket = captureOptions.bucket, cancel = target => { try { void Promise.resolve(target?.cancel()).catch(() => {}); } catch {} };
    const keyCheck = key => { need(typeof key === "string" && key.startsWith(`follow-up-evidence-capture/v1/${ctx.r.operationId}/`)); const suffix = key.split("/").at(-1); need(suffix === "claim" || suffix === "manifest" || /^chunk-(?:[0-9]|1[0-5])$/.test(suffix)); return suffix; };
    return {
      put: (key, text, options) => { live(ctx); need(!ctx.readOnly); const suffix = keyCheck(key); need(typeof text === "string" && Buffer.byteLength(text) <= (suffix.startsWith("chunk-") ? 4096 : MAX_CONTROL)); charge(ctx, Buffer.byteLength(text)); need(equal(options, { onlyIf: { etagDoesNotMatch: "*" } })); return io(ctx, () => bucket.put(key, text, options)); },
      get: key => { const suffix = keyCheck(key); return io(ctx, async () => {
        const value = await bucket.get(key); if (!ctx.active || performance.now() >= ctx.ends) { cancel(value?.body); need(false); } if (value === null) return null;
        integer(value.size, 1, suffix.startsWith("chunk-") ? 4096 : MAX_CONTROL); need(typeof value.etag === "string" && value.etag.length > 0 && value.etag.length <= 200);
        const body = value.body; need(body && typeof body.getReader === "function"); return { size: value.size, etag: value.etag, body: { cancel: () => cancel(body), getReader() { live(ctx); const reader = body.getReader(); let parts = 0; return { async read() { try { need(++parts <= 8193); const p = await io(ctx, () => reader.read(), false); live(ctx); if (!p.done) { need(p.value instanceof Uint8Array); charge(ctx, p.value.byteLength); } return p; } catch (e) { cancel(reader); throw e; } }, cancel: () => cancel(reader), releaseLock: () => reader.releaseLock() }; } } };
      }); }
    };
  }
  function integration(ctx, admitted) {
    return createFollowUpEvidenceCaptureIntegration({ ...captureOptions, bucket: bucketFor(ctx), scope: { actionDigest: scope.actionDigest, sourceRevision: scope.sourceRevision, sinkId: scope.sinkId, environment: scope.environment }, clock, timeoutMs: waitMs, chunkBytes: 4096, executeAction: async intent => {
      // Set BEFORE capture.execute (including its claim), never after the frozen
      // adapter starts its callback timer. Claim latency conservatively reduces
      // this budget; a delayed callback cannot acquire a fresh timeout window.
      ctx.callbackEnds = ctx.captureActionEnds; ctx.permit = true;
      const timer = setTimeout(() => { ctx.permit = false; }, Math.max(0, ctx.callbackEnds - performance.now()));
      try {
        live(ctx, true); fresh(ctx.r); need(!ctx.readOnly && ctx.consumed && !ctx.effectInvoked);
        const s = await read(ctx, ctx.r); live(ctx, true); need(equal(s, admitted));
        const certificate = await current(ctx, ctx.r, s, true); live(ctx, true);
        await witnessCheck(ctx, ctx.r, s); live(ctx, true); fresh(ctx.r); need(now() < certificate.expiresAt);
        need(equal(await read(ctx, ctx.r), admitted)); live(ctx, true);
        // No await or scheduled gap between these final checks and the effect.
        return await Promise.resolve().then(() => { live(ctx, true); fresh(ctx.r); need(now() < certificate.expiresAt && !ctx.effectInvoked); ctx.effectInvoked = true; return action(intent); });
      } finally { ctx.permit = false; clearTimeout(timer); }
    } });
  }
  function result(ctx, status, reasonCode, extra = {}) {
    const value = { contract: FOLLOW_UP_ADMISSION_GATE_VERSION, status, reasonCode, operationId: ctx.r?.operationId ?? null, admissionDigest: ctx.r?.admissionDigest ?? null, actionAttempted: ctx.effectInvoked, consumption: ctx.consumed ? "confirmed" : ctx.consumeAttempted ? "unknown" : "not_attempted", registryState: ctx.registryState ?? "unavailable", pendingBarrier: ctx.pendingBarrier ?? null, metadataCaptured: false, actionReport: "unknown", captureReceipt: null, requiresReadOnlyReconciliation: true, rpcCount: ctx.rpcs, ioBytes: ctx.bytes, ...extra, ...FLAGS };
    need(Buffer.byteLength(canonical(value)) <= MAX_CONTROL); return freeze(value);
  }
  async function run(input, mode) {
    const ctx = { active: true, permit: false, ends: performance.now() + operationMs, callbackEnds: 0, rpcs: 0, bytes: 0, transactions: 0, effectInvoked: false, consumed: false, consumeAttempted: false, mutationAttempted: false, readOnly: mode === "status" || mode === "capture" };
    let timer;
    try {
      try { ctx.r = request(input, ctx.readOnly); } catch { return result(ctx, "refused", "invalid_admission", { requiresReadOnlyReconciliation: false }); }
      const work = async () => {
        const r = ctx.r; let s = await read(ctx, r); ctx.registryState = s.entry?.status ?? "absent"; ctx.pendingBarrier = s.control.pending !== null;
        need(s.control.mode === "active");
        if (ctx.readOnly) {
          boundEntry(s, r); need(now() < r.admission.retentionUntil); await witnessCheck(ctx, r, s);
          if (mode === "status") { live(ctx); need(now() < r.admission.retentionUntil); return result(ctx, "observed", "registry_witness_observed"); }
          const c = await integration(ctx, null).reconcile(r.capture); live(ctx); need(now() < r.admission.retentionUntil);
          return result(ctx, c.metadataCaptured ? "captured" : "indeterminate", "read_only_capture", { metadataCaptured: c.metadataCaptured, actionReport: c.actionReport, captureReceipt: c.receipt });
        }
        fresh(r); const certificate = await current(ctx, r, s); await witnessCheck(ctx, r, s); fresh(r);
        if (mode === "admit" && s.entry !== null) { boundEntry(s, r); return result(ctx, "observed", "admission_already_recorded"); }
        if (mode === "execute") { const e = boundEntry(s, r); if (e.status === "CONSUMED") return result(ctx, "consumed_not_attempted", "already_consumed"); }
        need(s.control.pending === null);
        s = await transition(ctx, r, s, mode === "admit" ? "admit" : "consume", certificate); ctx.registryState = s.entry.status; ctx.pendingBarrier = s.control.pending !== null;
        if (mode === "admit") return result(ctx, "admitted", "admission_witness_acknowledged");
        const adapter = integration(ctx, s); ctx.captureActionEnds = performance.now() + waitMs;
        const c = await adapter.execute(r.capture); live(ctx);
        return result(ctx, ctx.effectInvoked ? (c.metadataCaptured ? "captured" : "indeterminate") : "consumed_not_attempted", ctx.effectInvoked ? "capture_is_not_effect_proof" : "dispatch_guard_or_capture_claim_refused", { metadataCaptured: c.metadataCaptured, actionReport: ctx.effectInvoked ? c.actionReport : "unknown", captureReceipt: c.receipt });
      };
      return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { ctx.active = false; ctx.permit = false; reject(new Error("operation_closed")); }, operationMs); })]);
    } catch { return result(ctx, ctx.mutationAttempted || ctx.consumeAttempted || ctx.readOnly ? "indeterminate" : "refused", "state_or_acknowledgement_unavailable"); }
    finally { ctx.active = false; ctx.permit = false; clearTimeout(timer); }
  }
  return Object.freeze({ admit: input => run(input, "admit"), executeAdmitted: input => run(input, "execute"), readStatus: input => run(input, "status"), readCapture: input => run(input, "capture") });
}
