import { createHash, createPublicKey, createPrivateKey, sign, verify } from "node:crypto";
import { followUpAdmissionSigningBytes } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";
import { followUpEvidenceIntentSigningBytes } from "../../scripts/lib/follow-up-evidence-capture-integration.mjs";
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";

// This protocol is private service-binding transport, not CRM origin proof.
// Signed configuration is supplied as a secret at release, never caller input.
export const VERSION = "follow-up-private-rehearsal.v1";
export const ACTION_DIGEST = hash("amari/private-rehearsal/unique-synthetic-counter/v1");
export const MAX = 16384, WAIT_MS = 2000, OPERATION_MS = 15000;
export const ROLES = ["owner", "operator", "reader"];
export const SERVICES = ["admission", "capture", "floor", "receipt", "witness", "source"];
export const need = v => { if (!v) throw new TypeError("private_rehearsal_refused"); };
export function hash(v) { return createHash("sha256").update(v).digest("hex"); }
export const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
export const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => need(Number.isSafeInteger(n) && !Object.is(n, -0) && n >= min && n <= max);
export const digest = v => need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
export const opaque = v => need(typeof v === "string" && /^id_[a-f0-9]{64}$/.test(v));
export function exact(v, fields) { need(v && typeof v === "object" && !Array.isArray(v)); const keys = Object.keys(v); need(keys.length === fields.length && keys.every(k => fields.includes(k))); }
export function parse(text) {
  need(typeof text === "string" && Buffer.byteLength(text) <= MAX);
  const v = JSON.parse(text); let nodes = 0;
  function walk(x, depth) { need(++nodes <= 1200 && depth <= 12); if (x && typeof x === "object") { need(Object.keys(x).length <= 64); for (const [k, value] of Object.entries(x)) { need(k.length <= 128 && !["__proto__", "constructor", "prototype", "toJSON"].includes(k)); walk(value, depth + 1); } } else if (typeof x === "number") need(Number.isFinite(x) && !Object.is(x, -0)); }
  walk(v, 0); need(canonical(v) === text); return v;
}
export function encode(v) { const text = canonical(v); need(Buffer.byteLength(text) <= MAX); return text; }
const fingerprint = k => hash(k.export({ format: "der", type: "spki" }));
export function signed(body, bytes, key) { return { body, keyId: key.keyId, signature: sign(null, bytes, key.privateKey).toString("base64") }; }
function verifyEnvelope(e, bytes, keyId, publicKey) { exact(e, ["body", "keyId", "signature"]); need(e.keyId === keyId && typeof e.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(e.signature)); const sig = Buffer.from(e.signature, "base64"); need(sig.toString("base64") === e.signature && verify(null, bytes, publicKey, sig)); }
export function validateIssued(c, value) {
  exact(value, ["admission", "capture", "keyId", "signature"]); exact(value.capture, ["intent", "keyId", "signature"]);
  need(canonical(value.admission) === canonical(c.admission) && canonical(value.capture.intent) === canonical(c.intent));
  verifyEnvelope({ body: value.admission, keyId: value.keyId, signature: value.signature }, followUpAdmissionSigningBytes(value.admission), c.publicKeys.admission[0].keyId, c.publicKeys.admission[0].publicKey);
  verifyEnvelope({ body: value.capture.intent, keyId: value.capture.keyId, signature: value.capture.signature }, followUpEvidenceIntentSigningBytes(value.capture.intent), c.publicKeys.capture[0].keyId, c.publicKeys.capture[0].publicKey);
  return value;
}
export function manifestSigningBytes(m) {
  exact(m, ["version", "transport", "scope", "origin", "aliasSetDigest", "replayHorizonUntil", "retentionUntil", "parentDeadline", "deletionDeadline", "issuedAt", "expiresAt", "issuerSequence", "principals", "signers"]);
  need(m.version === VERSION && m.transport === "private_service_binding_rpc" && m.scope.environment === "synthetic" && m.scope.actionDigest === ACTION_DIGEST && m.scope.schemaDigest === FOLLOW_UP_REGISTRY_SCHEMA_DIGEST);
  integer(m.issuedAt); integer(m.expiresAt); integer(m.retentionUntil);
  need(m.issuedAt < m.expiresAt && m.expiresAt - m.issuedAt <= 3600000 && m.expiresAt <= m.retentionUntil && m.retentionUntil <= m.origin.originalAt + 86400000);
  need(Array.isArray(m.principals) && m.principals.length === 3); const ids = new Set(), prints = new Set();
  for (const role of ROLES) { const p = m.principals.find(p => p.role === role); exact(p, ["callerId", "keyId", "publicKeySha256", "role", "notBefore", "expiresAt"]); opaque(p.callerId); opaque(p.keyId); digest(p.publicKeySha256); need(!ids.has(p.keyId) && !ids.has(p.callerId) && !prints.has(p.publicKeySha256)); ids.add(p.keyId); ids.add(p.callerId); prints.add(p.publicKeySha256); integer(p.notBefore); integer(p.expiresAt); need(p.notBefore >= m.issuedAt && p.notBefore < p.expiresAt && p.expiresAt <= m.expiresAt); }
  exact(m.signers, SERVICES); for (const s of Object.values(m.signers)) { exact(s, ["keyId", "publicKeySha256"]); opaque(s.keyId); digest(s.publicKeySha256); need(!ids.has(s.keyId) && !prints.has(s.publicKeySha256)); ids.add(s.keyId); prints.add(s.publicKeySha256); }
  identity(m); // Frozen contracts also validate every scope, origin, deadline and quota field.
  return Buffer.from("amari/private-rehearsal-manifest/v1\n" + encode(m));
}
export function identity(m) {
  const scope = m.scope, scopeDigest = hash(canonical(scope));
  const operationId = "id_" + hash(canonical({ accountId: scope.accountId, targetId: scope.targetId, actionScopeDigest: scope.actionScopeDigest, environment: scope.environment, sourceId: m.origin.sourceId, sequence: m.origin.sequence }));
  const deadlines = [m.parentDeadline, m.deletionDeadline].filter(v => v !== null);
  const intent = { version: "follow-up-capture-intent.v1", operationId, actionDigest: scope.actionDigest, sourceRevision: scope.sourceRevision, sinkId: scope.sinkId, environment: scope.environment, originalAt: m.origin.originalAt, issuedAt: m.issuedAt, expiresAt: m.origin.dispatchUntil, retentionUntil: m.retentionUntil, parentDeadline: deadlines.length ? Math.min(...deadlines) : null };
  const admission = { version: "follow-up-admission.v1", scope, origin: m.origin, businessKey: operationId, captureIntentDigest: hash(followUpEvidenceIntentSigningBytes(intent)), aliasSetDigest: m.aliasSetDigest, replayHorizonUntil: m.replayHorizonUntil, retentionUntil: m.retentionUntil, parentDeadline: m.parentDeadline, deletionDeadline: m.deletionDeadline, issuedAt: m.issuedAt, issuerSequence: m.issuerSequence, quotas: { metadataBytes: 24000, chunks: 16, rpcs: 64 } };
  return { scope, scopeDigest, operationId, intent, admission, admissionDigest: hash(followUpAdmissionSigningBytes(admission)) };
}
export function requestSigningBytes(r) {
  exact(r, ["version", "manifestDigest", "scopeDigest", "callerId", "role", "action", "body", "nonce", "issuedAt", "expiresAt"]);
  need(r.version === VERSION && ROLES.includes(r.role) && ["bootstrap", "admit", "execute", "status", "result", "revoke"].includes(r.action));
  for (const k of ["manifestDigest", "scopeDigest", "nonce"]) digest(r[k]); need(r.nonce !== "0".repeat(64)); opaque(r.callerId);
  exact(r.body, r.action === "revoke" ? ["keyId"] : []); if (r.action === "revoke") opaque(r.body.keyId);
  integer(r.issuedAt); integer(r.expiresAt); need(r.issuedAt < r.expiresAt && r.expiresAt - r.issuedAt <= 30000);
  return Buffer.from("amari/private-rehearsal-request/v1\n" + encode(r));
}
export function configuration(env, location) {
  const manifest = parse(env.REHEARSAL_MANIFEST), m = manifest.body, keys = parse(env.REHEARSAL_KEYS);
  exact(keys, ["root", "publicKeys", "privateKeys"]); exact(keys.root, ["keyId", "publicKey"]); opaque(keys.root.keyId);
  const root = createPublicKey(keys.root.publicKey); need(root.asymmetricKeyType === "ed25519"); const bytes = manifestSigningBytes(m); verifyEnvelope(manifest, bytes, keys.root.keyId, root);
  exact(keys.publicKeys, [...ROLES, ...SERVICES]); exact(keys.privateKeys, location === "control" ? ["receipt", "witness"] : ["admission", "capture", "floor", "source"]);
  const publicKeys = {}, signers = {};
  for (const role of [...ROLES, ...SERVICES]) { const declaration = m.signers[role] ?? m.principals.find(p => p.role === role), publicKey = createPublicKey(keys.publicKeys[role]); need(publicKey.asymmetricKeyType === "ed25519" && fingerprint(publicKey) === declaration.publicKeySha256 && fingerprint(publicKey) !== fingerprint(root)); publicKeys[role] = [{ keyId: declaration.keyId, publicKey }]; }
  for (const [role, value] of Object.entries(keys.privateKeys)) { const privateKey = createPrivateKey(value); need(privateKey.asymmetricKeyType === "ed25519" && fingerprint(createPublicKey(privateKey)) === m.signers[role].publicKeySha256); signers[role] = { keyId: m.signers[role].keyId, privateKey }; }
  return { manifest, m, manifestDigest: hash(bytes), ...identity(m), publicKeys, signers };
}
export function authenticate(config, text) {
  const envelope = parse(text), r = envelope.body, bytes = requestSigningBytes(r), p = config.m.principals.find(p => p.callerId === r.callerId && p.role === r.role && p.keyId === envelope.keyId); need(p);
  verifyEnvelope(envelope, bytes, p.keyId, config.publicKeys[p.role][0].publicKey); need(r.manifestDigest === config.manifestDigest && r.scopeDigest === config.scopeDigest);
  need(["status", "result"].includes(r.action) || r.role === (["bootstrap", "revoke"].includes(r.action) ? "owner" : "operator"));
  if (r.action === "revoke") need(config.m.principals.some(p => p.keyId === r.body.keyId));
  const fresh = () => { const t = Date.now(); need(config.m.issuedAt <= t && t < config.m.expiresAt && t < config.m.retentionUntil && p.notBefore <= t && t < p.expiresAt && r.issuedAt <= t && t < r.expiresAt); return t; }; fresh();
  return { envelope, r, p, fresh };
}
