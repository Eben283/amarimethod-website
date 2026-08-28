import { createHash, KeyObject, randomBytes, sign, verify } from "node:crypto";
import { followUpCurrentFloorSigningBytes } from "./follow-up-evidence-admission-gate.mjs";

/**
 * Inactive, injected platform adapters, not a Worker or a resource installer.
 * No factory creates schema, a control row, an epoch, an R2 head, or permission.
 * `authorize` and `trustedSource.read` are mandatory trusted service boundaries:
 * their eventual transport must authenticate the PRESENT caller, immutable origin,
 * all suppression aliases and current non-regressing governance. Signed historical
 * admissions are not read grants. These adapters implement protocol/byte checks,
 * not that transport, provider truth, administrative rollback immunity or purge.
 *
 * Registry receipts are persisted in the SAME synchronous SQLite transaction as
 * the scope-wide control and entry. confirm() awaits storage.sync(), then reads
 * that persisted receipt; there is no in-memory acknowledgement/lock substitute.
 * Witness events are signed immutable objects; the signed head uses the actual
 * verified R2 object's ETag for CAS. Its deadline can only shorten. Captures use
 * a separate per-operation capability with current authorization on body reads.
 * No delete/list/reset/unlock/retry/export callback or default network is exposed.
 * Coherent same-epoch registry+witness loss remains undetectable without governed
 * recovery; an unannounced missing/rolled-back store is NOT safe initialization.
 */
export const FOLLOW_UP_STORAGE_ADAPTER_VERSION = "follow-up-evidence-storage-adapters.v1";
export const FOLLOW_UP_STORAGE_ADAPTER_FLAGS = Object.freeze({ sourceOnly: true, simulation: true, authority: false, productionAllowed: false, executionAllowed: false, adoptionAllowed: false, dispatchAllowed: false, retryAllowed: false, restoreAllowed: false, liveAuthorizationProven: false, sourceAuthenticationProven: false, providerOutcomeProven: false, providerAuthenticityProven: false, registryDurabilityProven: false, sinkDurabilityProven: false, exactlyOnceProven: false, coherentRollbackDetectionProven: false });
const MAX = 8192, DAY = 86400000;
const TX_DOMAIN = "amari/follow-up-registry-transaction/v1\n", WITNESS_DOMAIN = "amari/follow-up-storage-witness/v1\n", SOURCE_DOMAIN = "amari/follow-up-floor-source/v1\n", CHALLENGE_DOMAIN = "amari/follow-up-floor-challenge/v1\n";
const hash = s => createHash("sha256").update(s).digest("hex");
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const need = v => { if (!v) throw new TypeError("storage_adapter_unavailable"); };
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => need(Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max);
const digest = v => need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
const opaque = v => need(typeof v === "string" && /^id_[a-f0-9]{64}$/.test(v));
const equal = (a, b) => canonical(a) === canonical(b);
const frozen = v => { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; };
function exact(v, fields) { need(v && typeof v === "object" && !Array.isArray(v)); const keys = Reflect.ownKeys(v); need(keys.length === fields.length && keys.every(k => typeof k === "string" && fields.includes(k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"))); }
function copy(v, d = 0, state = { n: 0, bytes: 0, active: new Set() }) {
  need(d <= 12 && ++state.n <= 1000); const charge = n => { state.bytes += n; need(state.bytes <= 32768); };
  if (v === null || typeof v === "boolean") { charge(5); return v; }
  if (typeof v === "number") { need(Number.isFinite(v) && !Object.is(v, -0)); charge(24); return v; }
  if (typeof v === "string") { need(v.length <= MAX); charge(Buffer.byteLength(v)); return v; }
  need(v && typeof v === "object" && !state.active.has(v)); const array = Array.isArray(v); need(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype));
  const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds); need(keys.length <= 129); if (array) need(keys.length === ds.length.value + 1 && ds.length.value <= 128);
  state.active.add(v); const result = array ? [] : {}; charge(2);
  for (const key of keys) { if (array && key === "length") continue; need(typeof key === "string" && key.length <= 128 && key !== "toJSON" && ds[key].enumerable && Object.hasOwn(ds[key], "value")); if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < ds.length.value); charge(key.length + 3); Object.defineProperty(result, key, { value: copy(ds[key].value, d + 1, state), enumerable: true, writable: true, configurable: true }); }
  state.active.delete(v); return result;
}
function value(v) { const out = copy(v); need(Buffer.byteLength(canonical(out)) <= MAX); return out; }
function parsed(s) { need(typeof s === "string" && Buffer.byteLength(s) <= MAX); const v = value(JSON.parse(s)); need(canonical(v) === s); return v; }
function scopeValue(v) {
  const s = value(v); exact(s, ["accountId", "targetId", "actionScopeDigest", "environment", "sinkId", "registryId", "schemaDigest", "sourceRevision", "actionDigest", "handlerDigest", "epoch", "generation", "issuerReleaseDigest", "policyVersion"]);
  for (const k of ["accountId", "targetId", "sinkId", "registryId", "epoch"]) opaque(s[k]); for (const k of ["actionScopeDigest", "schemaDigest", "actionDigest", "handlerDigest", "issuerReleaseDigest"]) digest(s[k]);
  need(/^[a-f0-9]{40}$/.test(s.sourceRevision) && ["synthetic", "production"].includes(s.environment) && s.policyVersion === "follow-up-retention-policy.v1"); integer(s.generation, 1); return frozen(s);
}
function keysValue(entries) {
  need(Array.isArray(entries) && entries.length > 0 && entries.length <= 16); const out = new Map();
  for (const e of entries) { exact(e, ["keyId", "publicKey"]); opaque(e.keyId); need(!out.has(e.keyId) && e.publicKey instanceof KeyObject && e.publicKey.type === "public" && e.publicKey.asymmetricKeyType === "ed25519"); out.set(e.keyId, e.publicKey); } return out;
}
function signerValue(s) { exact(s, ["keyId", "privateKey"]); opaque(s.keyId); need(s.privateKey instanceof KeyObject && s.privateKey.type === "private" && s.privateKey.asymmetricKeyType === "ed25519"); return { keyId: s.keyId, privateKey: s.privateKey }; }
function signed(body, domain, signer) { return frozen({ body, keyId: signer.keyId, signature: sign(null, Buffer.from(domain + canonical(body)), signer.privateKey).toString("base64") }); }
function verified(input, domain, keys) { const e = value(input); exact(e, ["body", "keyId", "signature"]); opaque(e.keyId); need(keys.has(e.keyId) && typeof e.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(e.signature)); const b = Buffer.from(e.signature, "base64"); need(b.length === 64 && b.toString("base64") === e.signature && verify(null, Buffer.from(domain + canonical(e.body)), keys.get(e.keyId), b)); return e.body; }
function base(config) {
  const scope = scopeValue(config.scope), scopeDigest = hash(canonical(scope)), clock = config.clock, authorize = config.authorize, timeoutMs = config.timeoutMs;
  need(typeof clock === "function" && typeof authorize === "function"); integer(timeoutMs, 1, 20000);
  const now = () => { const t = clock(); integer(t); return t; };
  async function call(work) {
    const c = { active: true, end: performance.now() + timeoutMs, cleanups: new Set(), accesses: 0 }; c.live = () => need(c.active && performance.now() < c.end); c.onClose = fn => { c.cleanups.add(fn); return () => c.cleanups.delete(fn); };
    let timer; try { return await Promise.race([Promise.resolve().then(() => { c.live(); return work(c); }), new Promise((_, reject) => { timer = setTimeout(() => { c.active = false; reject(new TypeError("storage_adapter_unavailable")); }, timeoutMs); })]); } catch { throw new TypeError("storage_adapter_unavailable"); } finally { c.active = false; clearTimeout(timer); for (const cleanup of c.cleanups) { try { cleanup(); } catch {} } c.cleanups.clear(); }
  }
  async function access(c, resource, purpose) {
    c.live(); need(++c.accesses <= 64 && typeof resource === "string" && resource.length <= 180 && ["read", "write"].includes(purpose)); const started = now();
    const request = frozen({ version: "follow-up-storage-access-request.v1", scopeDigest, resource, purpose, nonce: randomBytes(32).toString("hex"), at: started });
    const a = value(await authorize(request)); c.live(); exact(a, ["version", "scopeDigest", "resource", "purpose", "nonce", "issuedAt", "expiresAt", "retentionUntil"]);
    need(a.version === "follow-up-storage-access.v1" && ["scopeDigest", "resource", "purpose", "nonce"].every(k => a[k] === request[k])); for (const k of ["issuedAt", "expiresAt", "retentionUntil"]) integer(a[k]);
    need(a.issuedAt >= started && a.issuedAt <= now() && a.expiresAt > now() && a.expiresAt - a.issuedAt <= 30000 && a.retentionUntil > now()); return frozen(a);
  }
  const valid = (c, grant, deadline) => { c.live(); integer(deadline); need(now() < grant.expiresAt && now() < deadline && deadline <= grant.retentionUntil); };
  return { scope, scopeDigest, now, call, access, valid };
}

// Declarative candidate only. Applying it and seeding a signed, current control
// requires a separate reviewed provisioning action; no code below executes DDL.
const TABLES = ["fue_registry_control", "fue_registry_entries", "fue_registry_receipts"];
const BODY_CHECK = "CHECK(length(CAST(data AS BLOB)) BETWEEN 2 AND 8192 AND json_valid(data))";
export const FOLLOW_UP_REGISTRY_SCHEMA = Object.freeze([
  `CREATE TABLE fue_registry_control (id INTEGER PRIMARY KEY CHECK(id=1), scope_digest TEXT NOT NULL CHECK(length(scope_digest)=64), retention_until INTEGER NOT NULL CHECK(retention_until>0), data TEXT NOT NULL ${BODY_CHECK})`,
  `CREATE TABLE fue_registry_entries (business_key TEXT PRIMARY KEY NOT NULL, scope_digest TEXT NOT NULL CHECK(length(scope_digest)=64), retention_until INTEGER NOT NULL CHECK(retention_until>0), data TEXT NOT NULL ${BODY_CHECK})`,
  `CREATE TABLE fue_registry_receipts (transaction_id TEXT PRIMARY KEY NOT NULL, business_key TEXT NOT NULL, scope_digest TEXT NOT NULL CHECK(length(scope_digest)=64), retention_until INTEGER NOT NULL CHECK(retention_until>0), data TEXT NOT NULL ${BODY_CHECK})`,
  "CREATE TRIGGER fue_control_no_replace BEFORE INSERT ON fue_registry_control WHEN EXISTS(SELECT 1 FROM fue_registry_control WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_entry_no_replace BEFORE INSERT ON fue_registry_entries WHEN EXISTS(SELECT 1 FROM fue_registry_entries WHERE business_key=NEW.business_key) BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_receipt_no_replace BEFORE INSERT ON fue_registry_receipts WHEN EXISTS(SELECT 1 FROM fue_registry_receipts WHERE transaction_id=NEW.transaction_id) BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_control_no_delete BEFORE DELETE ON fue_registry_control BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_entry_no_delete BEFORE DELETE ON fue_registry_entries BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_receipt_no_delete BEFORE DELETE ON fue_registry_receipts BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_receipt_no_update BEFORE UPDATE ON fue_registry_receipts BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_control_monotone BEFORE UPDATE ON fue_registry_control WHEN NEW.id<>OLD.id OR NEW.scope_digest<>OLD.scope_digest OR NEW.retention_until>OLD.retention_until OR json_extract(NEW.data,'$.sequence')<json_extract(OLD.data,'$.sequence') BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fue_entry_monotone BEFORE UPDATE ON fue_registry_entries WHEN NEW.business_key<>OLD.business_key OR NEW.scope_digest<>OLD.scope_digest OR NEW.retention_until<>OLD.retention_until OR json_extract(NEW.data,'$.admissionDigest') IS NOT json_extract(OLD.data,'$.admissionDigest') OR json_extract(NEW.data,'$.originDigest') IS NOT json_extract(OLD.data,'$.originDigest') OR json_extract(NEW.data,'$.originalAt') IS NOT json_extract(OLD.data,'$.originalAt') OR json_extract(NEW.data,'$.dispatchUntil') IS NOT json_extract(OLD.data,'$.dispatchUntil') OR json_extract(NEW.data,'$.sequence')<json_extract(OLD.data,'$.sequence') OR (json_extract(OLD.data,'$.status')='CONSUMED' AND json_extract(NEW.data,'$.status')<>'CONSUMED') BEGIN SELECT RAISE(ABORT,'immutable'); END"
]);
const CATALOG = frozen([...FOLLOW_UP_REGISTRY_SCHEMA.map(sql => { const m = /^CREATE (TABLE|TRIGGER) (\w+)/.exec(sql); return { type: m[1].toLowerCase(), name: m[2], tbl_name: m[1] === "TABLE" ? m[2] : / ON (\w+)/.exec(sql)[1], sql }; }), ...TABLES.slice(1).map(name => ({ type: "index", name: `sqlite_autoindex_${name}_1`, tbl_name: name, sql: null }))].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)));
export const FOLLOW_UP_REGISTRY_SCHEMA_DIGEST = hash(canonical(CATALOG));
const CATALOG_SQL = `SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN (${CATALOG.map(() => "?").join(",")}) OR tbl_name IN (?,?,?) ORDER BY type,name LIMIT 32`;
const READ_SQL = "SELECT c.scope_digest AS control_scope,c.retention_until AS control_retention,c.data AS control_data,e.business_key,e.scope_digest AS entry_scope,e.retention_until AS entry_retention,e.data AS entry_data FROM fue_registry_control c LEFT JOIN fue_registry_entries e ON e.business_key=? WHERE c.id=1 LIMIT 2";
function snapshotValue(input, b, key) {
  const s = value(input); exact(s, ["control", "entry"]); const c = s.control; exact(c, ["version", "scopeDigest", "epoch", "generation", "mode", "sequence", "headDigest", "pending"]);
  need(c.version === "follow-up-admission-control.v1" && c.scopeDigest === b.scopeDigest && c.epoch === b.scope.epoch && c.generation === b.scope.generation && ["active", "closed"].includes(c.mode)); integer(c.sequence); digest(c.headDigest);
  if (c.pending !== null) { exact(c.pending, ["transitionDigest", "operationId", "phase"]); opaque(c.pending.operationId); need(c.pending.transitionDigest === c.headDigest && ["witness", "action"].includes(c.pending.phase)); }
  if (s.entry !== null) { const e = s.entry; exact(e, ["version", "scopeDigest", "businessKey", "operationId", "admissionDigest", "originDigest", "originalAt", "dispatchUntil", "retentionUntil", "epoch", "generation", "status", "admittedSequence", "sequence", "transitionDigest", "consumeNonce"]);
    need(e.version === "follow-up-admission-entry.v1" && e.scopeDigest === b.scopeDigest && e.businessKey === key && e.operationId === key && e.epoch === b.scope.epoch && e.generation === b.scope.generation); for (const k of ["admissionDigest", "originDigest", "transitionDigest"]) digest(e[k]); for (const k of ["originalAt", "dispatchUntil", "retentionUntil"]) integer(e[k]); integer(e.admittedSequence, 1); integer(e.sequence, e.admittedSequence, c.sequence);
    need(e.originalAt < e.dispatchUntil && e.dispatchUntil < e.retentionUntil && e.retentionUntil <= e.originalAt + 90 * DAY); if (e.status === "ADMITTED") need(e.sequence === e.admittedSequence && e.consumeNonce === null); else { need(e.status === "CONSUMED" && e.sequence > e.admittedSequence); digest(e.consumeNonce); }
  } return frozen(s);
}
function transitionLaw(before, next, now) {
  const a = before.control, b = next.control, e = next.entry; need(a.mode === "active" && b.mode === a.mode && e !== null && now < e.dispatchUntil);
  if (a.pending === null) {
    need(b.sequence === a.sequence + 1 && b.pending?.phase === "witness" && b.pending.operationId === e.businessKey && b.headDigest === e.transitionDigest && e.sequence === b.sequence);
    if (before.entry === null) need(e.status === "ADMITTED" && e.admittedSequence === b.sequence);
    else { const { status: oldStatus, sequence: oldSequence, transitionDigest: oldDigest, consumeNonce: oldNonce, ...oldIdentity } = before.entry; const { status, sequence, transitionDigest, consumeNonce, ...identity } = e; need(oldStatus === "ADMITTED" && status === "CONSUMED" && equal(identity, oldIdentity) && sequence > oldSequence && transitionDigest !== oldDigest && consumeNonce !== oldNonce); }
  } else { need(a.pending.phase === "witness" && equal(before.entry, e)); const { pending: oldPending, ...oldControl } = a, { pending, ...newControl } = b; need(equal(oldControl, newControl)); need(e.status === "ADMITTED" ? pending === null : equal(pending, { ...oldPending, phase: "action" })); }
}
export function createFollowUpEvidenceRegistryAdapter(config) {
  exact(config, ["storage", "scope", "authorize", "clock", "timeoutMs"]); const b = base(config), storage = config.storage; need(b.scope.schemaDigest === FOLLOW_UP_REGISTRY_SCHEMA_DIGEST && storage && typeof storage.transactionSync === "function" && typeof storage.sync === "function" && typeof storage.sql?.exec === "function");
  const rows = (sql, ...params) => { need(params.length <= 100 && Buffer.byteLength(sql) <= 100000); const result = storage.sql.exec(sql, ...params).toArray(); need(Array.isArray(result) && result.length <= 32); return result; };
  const schema = () => need(equal(rows(CATALOG_SQL, ...CATALOG.map(r => r.name), ...TABLES), CATALOG));
  function load(key) { const rs = rows(READ_SQL, key); need(rs.length === 1); const r = rs[0]; need(r.control_scope === b.scopeDigest); integer(r.control_retention, b.now() + 1); const s = snapshotValue({ control: parsed(r.control_data), entry: r.entry_data === null ? null : parsed(r.entry_data) }, b, key);
    if (s.entry !== null) need(r.business_key === key && r.entry_scope === b.scopeDigest && r.entry_retention === s.entry.retentionUntil && b.now() < r.entry_retention); return { snapshot: s, retentionUntil: s.entry === null ? r.control_retention : Math.min(r.control_retention, r.entry_retention) }; }
  return Object.freeze({
    read(key) { opaque(key); return b.call(async c => { const grant = await b.access(c, `entry/${key}`, "read"); schema(); const r = load(key); b.valid(c, grant, r.retentionUntil); return r.snapshot; }); },
    transact(key, updater) { opaque(key); need(typeof updater === "function"); return b.call(async c => { const grant = await b.access(c, `entry/${key}`, "write"); c.live(); return storage.transactionSync(() => {
      c.live(); schema(); const before = load(key); b.valid(c, grant, before.retentionUntil); const next = snapshotValue(updater(before.snapshot), b, key); transitionLaw(before.snapshot, next, b.now()); const deadline = Math.min(before.retentionUntil, next.entry.retentionUntil); b.valid(c, grant, deadline);
      const transactionId = hash(TX_DOMAIN + canonical(next)), receipt = frozen({ transactionId, snapshot: next });
      rows("UPDATE fue_registry_control SET retention_until=?,data=? WHERE id=1", deadline, canonical(next.control));
      if (!equal(before.snapshot.entry, next.entry)) { if (before.snapshot.entry === null) rows("INSERT INTO fue_registry_entries(business_key,scope_digest,retention_until,data) VALUES(?,?,?,?)", key, b.scopeDigest, next.entry.retentionUntil, canonical(next.entry)); else rows("UPDATE fue_registry_entries SET data=? WHERE business_key=?", canonical(next.entry), key); }
      rows("INSERT INTO fue_registry_receipts(transaction_id,business_key,scope_digest,retention_until,data) VALUES(?,?,?,?,?)", transactionId, key, b.scopeDigest, deadline, canonical(receipt)); b.valid(c, grant, deadline); need(b.now() < next.entry.dispatchUntil); return receipt;
    }); }); },
    confirm(transactionId) { digest(transactionId); return b.call(async c => { await b.access(c, `receipt/${transactionId}`, "read"); await storage.sync(); c.live(); const grant = await b.access(c, `receipt/${transactionId}`, "read"); schema(); const rs = rows("SELECT r.transaction_id,r.business_key,r.scope_digest,r.retention_until,r.data,c.retention_until AS control_retention,e.retention_until AS entry_retention,e.data AS entry_data FROM fue_registry_receipts r JOIN fue_registry_control c ON c.id=1 AND c.scope_digest=r.scope_digest JOIN fue_registry_entries e ON e.business_key=r.business_key AND e.scope_digest=r.scope_digest WHERE r.transaction_id=? LIMIT 2", transactionId); need(rs.length === 1); const r = rs[0]; need(r.transaction_id === transactionId && r.scope_digest === b.scopeDigest); const receipt = parsed(r.data); exact(receipt, ["transactionId", "snapshot"]); opaque(r.business_key); snapshotValue(receipt.snapshot, b, r.business_key); need(receipt.transactionId === transactionId && hash(TX_DOMAIN + canonical(receipt.snapshot)) === transactionId); const entry = parsed(r.entry_data); need(entry.admissionDigest === receipt.snapshot.entry.admissionDigest && entry.retentionUntil === r.entry_retention); b.valid(c, grant, Math.min(r.retention_until, r.control_retention, r.entry_retention)); return frozen(receipt); }); }
  });
}

function headValue(v, b) { const h = value(v); exact(h, ["scopeDigest", "epoch", "generation", "sequence", "digest"]); need(h.scopeDigest === b.scopeDigest && h.epoch === b.scope.epoch && h.generation === b.scope.generation); integer(h.sequence); digest(h.digest); return h; }
function eventValue(v, b) { const e = value(v); exact(e, ["version", "scopeDigest", "epoch", "generation", "sequence", "previousDigest", "kind", "businessKey", "admissionDigest", "originDigest", "at", "retentionUntil", "previousEntryDigest", "entryDigest"]); need(e.version === "follow-up-admission-transition.v1" && e.scopeDigest === b.scopeDigest && e.epoch === b.scope.epoch && e.generation === b.scope.generation && ["admit", "consume"].includes(e.kind)); integer(e.sequence, 1); integer(e.at); integer(e.retentionUntil); need(e.at < e.retentionUntil && e.at <= b.now()); opaque(e.businessKey); for (const k of ["previousDigest", "admissionDigest", "originDigest", "entryDigest"]) digest(e[k]); if (e.previousEntryDigest !== null) digest(e.previousEntryDigest); need((e.kind === "admit") === (e.previousEntryDigest === null)); return e; }
function witnessBody(input) { const body = value(input); exact(body, ["version", "kind", "scopeDigest", "createdAt", "retentionUntil", "payload"]); need(body.version === "follow-up-storage-witness.v1" && ["transition", "head"].includes(body.kind)); digest(body.scopeDigest); integer(body.createdAt); integer(body.retentionUntil); need(body.createdAt < body.retentionUntil && body.retentionUntil <= body.createdAt + 90 * DAY); return body; }
export function followUpWitnessSigningBytes(body) { return Buffer.from(WITNESS_DOMAIN + canonical(witnessBody(body))); }
const cancel = reader => { try { void Promise.resolve(reader?.cancel()).catch(() => {}); } catch {} };
async function objectText(b, c, bucket, key, resource, max) {
  let reader, body, detach; try {
    await b.access(c, resource, "read"); const object = await bucket.get(key); body = object?.body; if (!c.active || performance.now() >= c.end) { cancel(body); need(false); } if (object === null) return null;
    integer(object.size, 1, max); need(typeof object.etag === "string" && object.etag.length > 0 && object.etag.length <= 200 && body && typeof body.getReader === "function"); reader = body.getReader(); detach = c.onClose(() => cancel(reader)); const pieces = []; let size = 0;
    for (let n = 0; n < 32; n++) { c.live(); const part = await reader.read(); c.live(); if (part.done) { need(size === object.size); const bytes = Buffer.concat(pieces), text = bytes.toString("utf8"); need(bytes.equals(Buffer.from(text))); return { text, etag: object.etag }; } need(part.value instanceof Uint8Array && part.value.byteLength > 0); size += part.value.byteLength; need(size <= max && size <= object.size); pieces.push(Buffer.from(part.value)); }
    need(false);
  } catch { cancel(reader ?? body); throw new TypeError("storage_adapter_unavailable"); } finally { detach?.(); try { reader?.releaseLock(); } catch {} }
}
export function createFollowUpEvidenceWitnessAdapter(config) {
  exact(config, ["bucket", "scope", "authorize", "clock", "timeoutMs", "signer", "verificationKeys"]); const b = base(config), bucket = config.bucket, signer = signerValue(config.signer), keys = keysValue(config.verificationKeys); need(bucket && typeof bucket.get === "function" && typeof bucket.put === "function" && keys.has(signer.keyId) && verify(null, Buffer.from(WITNESS_DOMAIN), keys.get(signer.keyId), sign(null, Buffer.from(WITNESS_DOMAIN), signer.privateKey))); const prefix = `follow-up-admission-witness/v1/${b.scopeDigest}/`;
  async function read(c, suffix, kind) { const object = await objectText(b, c, bucket, prefix + suffix, suffix, MAX); need(object !== null); const body = witnessBody(verified(parsed(object.text), WITNESS_DOMAIN, keys)); need(body.kind === kind && body.scopeDigest === b.scopeDigest && body.createdAt <= b.now()); const payload = kind === "head" ? headValue(body.payload, b) : eventValue(body.payload, b); if (kind === "transition") need(suffix === `transition/${hash(canonical(payload))}` && body.createdAt === payload.at && body.retentionUntil === payload.retentionUntil); const grant = await b.access(c, suffix, "read"); b.valid(c, grant, body.retentionUntil); return { body: frozen(body), payload: frozen(payload), etag: object.etag }; }
  async function write(c, suffix, body, onlyIf) { witnessBody(body); const grant = await b.access(c, suffix, "write"); b.valid(c, grant, body.retentionUntil); const text = canonical(signed(body, WITNESS_DOMAIN, signer)); need(Buffer.byteLength(text) <= MAX); const ack = await bucket.put(prefix + suffix, text, { onlyIf }); c.live(); b.valid(c, grant, body.retentionUntil); if (ack === null) return null; need(typeof ack.etag === "string" && ack.etag.length > 0); const got = await read(c, suffix, body.kind); need(got.etag === ack.etag && equal(got.body, body)); return got; }
  return Object.freeze({
    readHead(scopeDigest) { need(scopeDigest === b.scopeDigest); return b.call(async c => (await read(c, "head", "head")).payload); },
    readTransition(d) { digest(d); return b.call(async c => (await read(c, `transition/${d}`, "transition")).payload); },
    putTransition(input) { const e = frozen(eventValue(input, b)), d = hash(canonical(e)); return b.call(async c => { const body = { version: "follow-up-storage-witness.v1", kind: "transition", scopeDigest: b.scopeDigest, createdAt: e.at, retentionUntil: e.retentionUntil, payload: e }; const ack = await write(c, `transition/${d}`, body, { etagDoesNotMatch: "*" }); if (ack === null) need(equal((await read(c, `transition/${d}`, "transition")).payload, e)); return ack === null ? null : frozen({ digest: d }); }); },
    compareAndSwapHead(previous, next) { const p = frozen(headValue(previous, b)), n = frozen(headValue(next, b)); need(n.sequence === p.sequence + 1); return b.call(async c => { const old = await read(c, "head", "head"); need(equal(old.payload, p)); const event = await read(c, `transition/${n.digest}`, "transition"); need(event.payload.previousDigest === p.digest && event.payload.sequence === n.sequence); const body = { ...old.body, retentionUntil: Math.min(old.body.retentionUntil, event.body.retentionUntil), payload: n }; const ack = await write(c, "head", body, { etagMatches: old.etag }); return ack === null ? null : frozen({ head: n }); }); }
  });
}

/** Exact operation capability only; present authorization is repeated for every
 * body chunk and after asynchronous reads. It does not expose the native bucket.
 * In-flight conditional puts can still have unknown outcomes; never retry them.
 */
export function createFollowUpEvidenceCaptureBucket(config) {
  exact(config, ["bucket", "scope", "authorize", "clock", "timeoutMs", "operationId", "originalAt", "retentionUntil"]); const b = base(config), bucket = config.bucket, operationId = config.operationId, originalAt = config.originalAt, deadline = config.retentionUntil; opaque(operationId); integer(originalAt); integer(deadline); need(originalAt < deadline && deadline <= originalAt + 90 * DAY && bucket && typeof bucket.get === "function" && typeof bucket.put === "function"); const prefix = `follow-up-evidence-capture/v1/${operationId}/`;
  const suffix = key => { need(typeof key === "string" && key.startsWith(prefix)); const s = key.slice(prefix.length); need(s === "claim" || s === "manifest" || /^chunk-(?:[0-9]|1[0-5])$/.test(s)); return s; };
  return Object.freeze({
    put(key, text, options) { const s = suffix(key), o = value(options); need(equal(o, { onlyIf: { etagDoesNotMatch: "*" } }) && typeof text === "string" && Buffer.byteLength(text) <= (s.startsWith("chunk-") ? 4096 : MAX)); return b.call(async c => { const grant = await b.access(c, `capture/${operationId}/${s}`, "write"); b.valid(c, grant, deadline); const ack = await bucket.put(key, text, { onlyIf: { etagDoesNotMatch: "*" } }); b.valid(c, grant, deadline); if (ack === null) return null; need(typeof ack.etag === "string" && ack.etag.length > 0 && ack.etag.length <= 200); return frozen({ etag: ack.etag }); }); },
    get(key) { const s = suffix(key), resource = `capture/${operationId}/${s}`; return b.call(async c => { const grant = await b.access(c, resource, "read"); b.valid(c, grant, deadline); const object = await bucket.get(key); try { c.live(); const current = await b.access(c, resource, "read"); b.valid(c, current, deadline); if (object === null) return null; integer(object.size, 1, s.startsWith("chunk-") ? 4096 : MAX); need(typeof object.etag === "string" && object.etag.length > 0 && object.etag.length <= 200 && typeof object.body?.getReader === "function"); } catch { cancel(object?.body); need(false); }
      let acquired = false; return Object.freeze({ size: object.size, etag: object.etag, body: Object.freeze({ cancel: () => cancel(object.body), getReader() { need(!acquired && b.now() < deadline); acquired = true; const reader = object.body.getReader(); let size = 0, parts = 0, closed = false; return Object.freeze({ read() { return b.call(async step => { const detach = step.onClose(() => { closed = true; cancel(reader); }); try { need(!closed && ++parts <= 32); const before = await b.access(step, resource, "read"); b.valid(step, before, deadline); const p = await reader.read(); step.live(); const after = await b.access(step, resource, "read"); b.valid(step, after, deadline); if (p.done) { need(size === object.size); closed = true; return { done: true, value: undefined }; } need(p.value instanceof Uint8Array && p.value.byteLength > 0); size += p.value.byteLength; need(size <= object.size); return { done: false, value: p.value }; } catch { closed = true; cancel(reader); throw new TypeError("storage_adapter_unavailable"); } finally { detach(); } }); }, cancel() { closed = true; cancel(reader); }, releaseLock() { reader.releaseLock(); } }); } }) }); }); }
  });
}

function challengeValue(input) { const q = value(input); exact(q, ["version", "nonce", "scopeDigest", "businessKey", "admissionDigest", "originDigest", "expectedSequence", "expectedHeadDigest"]); need(q.version === "follow-up-floor-challenge.v1"); for (const k of ["nonce", "scopeDigest", "admissionDigest", "originDigest", "expectedHeadDigest"]) digest(q[k]); opaque(q.businessKey); integer(q.expectedSequence); return frozen(q); }
function sourceBody(input) {
  const s = value(input); exact(s, ["version", "challengeDigest", "scopeDigest", "businessKey", "admissionDigest", "origin", "governance", "suppression", "observedAt", "expiresAt"]); need(s.version === "follow-up-floor-source.v1"); for (const k of ["challengeDigest", "scopeDigest", "admissionDigest"]) digest(s[k]); opaque(s.businessKey);
  exact(s.origin, ["sourceId", "sequence", "originalAt", "approvedAt", "dispatchUntil"]); opaque(s.origin.sourceId); integer(s.origin.sequence, 1); for (const k of ["originalAt", "approvedAt", "dispatchUntil"]) integer(s.origin[k]); need(s.origin.originalAt <= s.origin.approvedAt && s.origin.approvedAt < s.origin.dispatchUntil && s.origin.dispatchUntil - s.origin.approvedAt <= 300000);
  exact(s.governance, ["epoch", "generation", "issuerReleaseDigest", "minimumOriginSequence", "state", "observedAt", "expiresAt"]); opaque(s.governance.epoch); digest(s.governance.issuerReleaseDigest); integer(s.governance.generation, 1); integer(s.governance.minimumOriginSequence, 1); need(["active", "closed"].includes(s.governance.state));
  exact(s.suppression, ["aliasSetDigest", "replayHorizonUntil", "disposition", "observedAt", "expiresAt"]); digest(s.suppression.aliasSetDigest); integer(s.suppression.replayHorizonUntil); need(["clear", "suppressed", "unavailable"].includes(s.suppression.disposition)); need(s.suppression.replayHorizonUntil >= s.origin.dispatchUntil + 7 * DAY);
  for (const part of [s, s.governance, s.suppression]) { integer(part.observedAt); integer(part.expiresAt); need(part.observedAt < part.expiresAt && part.expiresAt - part.observedAt <= 30000); } return frozen(s);
}
export function followUpFloorSourceSigningBytes(body) { return Buffer.from(SOURCE_DOMAIN + canonical(sourceBody(body))); }
export function createFollowUpCurrentFloorIssuer(config) {
  exact(config, ["scope", "trustedSource", "sourceKeys", "signer", "clock", "timeoutMs"]); const scope = scopeValue(config.scope), scopeDigest = hash(canonical(scope)), source = config.trustedSource, sourceKeys = keysValue(config.sourceKeys), signer = signerValue(config.signer), clock = config.clock, timeoutMs = config.timeoutMs; need(source && typeof source.read === "function" && typeof clock === "function"); integer(timeoutMs, 1, 20000);
  const now = () => { const t = clock(); integer(t); return t; };
  return Object.freeze({ async read(input) {
    const q = challengeValue(input); need(q.scopeDigest === scopeDigest); const start = now(), end = performance.now() + timeoutMs; let active = true, timer;
    try { return await Promise.race([Promise.resolve().then(async () => { const body = sourceBody(verified(await source.read(q), SOURCE_DOMAIN, sourceKeys)); need(active && performance.now() < end); const at = now(); need(body.challengeDigest === hash(CHALLENGE_DOMAIN + canonical(q)) && body.scopeDigest === scopeDigest && body.businessKey === q.businessKey && body.admissionDigest === q.admissionDigest && hash(canonical(body.origin)) === q.originDigest);
      need(q.businessKey === "id_" + hash(canonical({ accountId: scope.accountId, targetId: scope.targetId, actionScopeDigest: scope.actionScopeDigest, environment: scope.environment, sourceId: body.origin.sourceId, sequence: body.origin.sequence }))); const g = body.governance, p = body.suppression; need(g.epoch === scope.epoch && g.generation === scope.generation && g.issuerReleaseDigest === scope.issuerReleaseDigest && body.origin.sequence >= g.minimumOriginSequence && at < body.origin.dispatchUntil); for (const evidence of [body, g, p]) need(evidence.observedAt >= start && evidence.observedAt <= at && evidence.expiresAt > at);
      const floor = { version: "follow-up-current-floor.v1", challengeDigest: body.challengeDigest, scopeDigest, epoch: scope.epoch, generation: scope.generation, issuerReleaseDigest: scope.issuerReleaseDigest, minimumOriginSequence: g.minimumOriginSequence, originDigest: q.originDigest, aliasSetDigest: p.aliasSetDigest, replayHorizonUntil: p.replayHorizonUntil, eligibility: g.state === "closed" ? "closed" : p.disposition, issuedAt: at, expiresAt: Math.min(at + 30000, body.expiresAt, g.expiresAt, p.expiresAt, body.origin.dispatchUntil) };
      const bytes = followUpCurrentFloorSigningBytes(floor); need(active && performance.now() < end && now() < floor.expiresAt); return frozen({ floor, keyId: signer.keyId, signature: sign(null, bytes, signer.privateKey).toString("base64") }); }), new Promise((_, reject) => { timer = setTimeout(() => { active = false; reject(new TypeError("storage_adapter_unavailable")); }, timeoutMs); })]); } catch { throw new TypeError("storage_adapter_unavailable"); } finally { active = false; clearTimeout(timer); }
  } });
}
