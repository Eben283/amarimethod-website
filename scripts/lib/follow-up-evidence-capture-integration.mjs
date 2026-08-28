import { createHash, createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { chunkFollowUpEvidenceCapture, reassembleFollowUpEvidenceCapture } from "./follow-up-evidence-capture.mjs";

/**
 * Inert, injected-object-store integration. No bucket, credentials, action client,
 * CLI, installer, or production entrypoint is supplied here. A configured signing
 * key authenticates these bytes, not the provider, key owner's authority, or the
 * truth of a typed action report. Only minimized metadata is retained, NOT the
 * original action/provider response.
 *
 * An acknowledged conditional create plus exact direct readback consumes a stable
 * operation before the configured action is called. Surviving claims prevent a
 * second invocation across instances/restarts, including renewed intents. An
 * unknown create acknowledgement NEVER reaches the action in this invocation.
 * Absence after an unknown write, deletion, or coherent restore is indistinguish-
 * able from never-created state across processes. This is NOT exactly-once or
 * rollback-proof: independently governed suppression, retention/deletion, access,
 * signing-key governance and an authorized private destination remain adoption
 * prerequisites. This adapter neither deletes nor renews claims.
 */
export const FOLLOW_UP_CAPTURE_INTEGRATION_VERSION = "follow-up-evidence-capture-integration.v1";
export const FOLLOW_UP_CAPTURE_INTENT_DOMAIN = "amari/follow-up-capture/intent/v1\n";
export const FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN = "amari/follow-up-capture/receipt/v1\n";
const INTENT_VERSION = "follow-up-capture-intent.v1", METADATA_VERSION = "follow-up-capture-metadata.v1", RECEIPT_VERSION = "follow-up-capture-receipt.v1";
const MAX_CONTROL_BYTES = 8192, MAX_METADATA_BYTES = 24000, DAY = 86400000;
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, authority: false, productionAllowed: false, executionAllowed: false, adoptionAllowed: false, dispatchAllowed: false, retryAllowed: false, restoreAllowed: false, providerOutcomeProven: false, providerAuthenticityProven: false, sinkDurabilityProven: false, liveAuthorizationProven: false, exactlyOnceProven: false, claimLossRecoveryProven: false });
const CAPSULE_FLAGS = { sourceOnly: true, simulation: true, authority: false, executionAllowed: false, retryAllowed: false, restoreAllowed: false };
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = () => { throw new TypeError("invalid_capture_integration_input"); };
const need = value => { if (!value) fail(); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => need(Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max);
const digest = value => need(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const opaque = value => need(typeof value === "string" && /^id_[a-f0-9]{64}$/.test(value));
function exact(value, keys) { need(value && typeof value === "object" && !Array.isArray(value)); const actual = Object.keys(value).sort(), expected = [...keys].sort(); need(actual.length === expected.length && actual.every((key, i) => key === expected[i])); }

// Untrusted requests, metadata and parsed storage values are copied before awaits.
// Descriptor inspection avoids invoking accessors/toJSON; no arbitrary text field.
function copy(value, depth = 0, state = { nodes: 0, bytes: 0, active: new Set() }) {
  need(depth <= 12 && ++state.nodes <= 4000);
  const charge = n => { state.bytes += n; need(state.bytes <= 100000); };
  if (value === null || typeof value === "boolean") { charge(5); return value; }
  if (typeof value === "number") { need(Number.isFinite(value) && !Object.is(value, -0)); charge(32); return value; }
  if (typeof value === "string") { need(value.length <= 24000); charge(Buffer.byteLength(value)); return value; }
  need(value && typeof value === "object" && !state.active.has(value));
  const array = Array.isArray(value); need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), length = array ? descriptors.length?.value : null;
  need(keys.length <= 1001); if (array) need(Number.isSafeInteger(length) && length >= 0 && length <= 1000 && keys.length === length + 1);
  state.active.add(value); charge(2); const out = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const d = descriptors[key]; need(typeof key === "string" && key.length <= 128 && d.enumerable && Object.hasOwn(d, "value") && key !== "toJSON");
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
    charge(key.length + 3); Object.defineProperty(out, key, { value: copy(d.value, depth + 1, state), enumerable: true, writable: true, configurable: true });
  }
  state.active.delete(value); return out;
}
function intentValue(input) {
  const i = copy(input); exact(i, ["version", "operationId", "actionDigest", "sourceRevision", "sinkId", "environment", "originalAt", "issuedAt", "expiresAt", "retentionUntil", "parentDeadline"]);
  need(i.version === INTENT_VERSION); opaque(i.operationId); opaque(i.sinkId); digest(i.actionDigest);
  need(typeof i.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(i.sourceRevision)); need(["synthetic", "production"].includes(i.environment));
  for (const field of ["originalAt", "issuedAt", "expiresAt", "retentionUntil"]) integer(i[field]);
  if (i.parentDeadline !== null) integer(i.parentDeadline);
  need(i.originalAt <= i.issuedAt && i.issuedAt < i.expiresAt && i.expiresAt - i.issuedAt <= 300000 && i.expiresAt < i.retentionUntil);
  need(i.retentionUntil - i.originalAt <= 90 * DAY && (i.parentDeadline === null || i.retentionUntil <= i.parentDeadline)); return freeze(i);
}
export function followUpEvidenceIntentSigningBytes(intent) { return Buffer.from(FOLLOW_UP_CAPTURE_INTENT_DOMAIN + canonical(intentValue(intent))); }
export function normalizeFollowUpEvidenceMetadata(input) {
  const m = copy(input); exact(m, ["version", "operationId", "actionDigest", "observedAt", "outcome", "readback", "statementCount", "rowsRead", "rowsWritten", "evidenceDigests", "reasonCodes"]);
  need(m.version === METADATA_VERSION); opaque(m.operationId); digest(m.actionDigest); integer(m.observedAt);
  need(["acknowledged", "rejected", "unknown"].includes(m.outcome)); need(["matches", "mismatch", "unavailable", "not_performed"].includes(m.readback));
  if (m.statementCount !== null) integer(m.statementCount, 0, 50);
  if (m.rowsRead !== null) integer(m.rowsRead, 0, 1000000000);
  if (m.rowsWritten !== null) integer(m.rowsWritten, 0, 1000000000);
  need(Array.isArray(m.evidenceDigests) && m.evidenceDigests.length <= 200); m.evidenceDigests.forEach(digest); need(new Set(m.evidenceDigests).size === m.evidenceDigests.length); m.evidenceDigests.sort();
  need(Array.isArray(m.reasonCodes) && m.reasonCodes.length <= 8);
  const allowed = ["action_unavailable", "invalid_action_metadata", "outcome_unknown", "readback_unavailable", "readback_mismatch", "provider_rejected"];
  need(m.reasonCodes.every(code => allowed.includes(code)) && new Set(m.reasonCodes).size === m.reasonCodes.length); m.reasonCodes.sort();
  need(Buffer.byteLength(canonical(m)) <= MAX_METADATA_BYTES); return freeze(m);
}
const signatureBytes = signature => { need(typeof signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signature)); const bytes = Buffer.from(signature, "base64"); need(bytes.length === 64 && bytes.toString("base64") === signature); return bytes; };
const receiptBytes = body => Buffer.from(FOLLOW_UP_CAPTURE_RECEIPT_DOMAIN + canonical(body));

function keyring(entries) {
  need(Array.isArray(entries) && entries.length > 0 && entries.length <= 16); const map = new Map();
  for (const entry of entries) { exact(entry, ["keyId", "publicKey"]); opaque(entry.keyId); need(entry.publicKey instanceof KeyObject && entry.publicKey.type === "public" && entry.publicKey.asymmetricKeyType === "ed25519" && !map.has(entry.keyId)); map.set(entry.keyId, entry.publicKey); } return map;
}
function timed(work, timeoutMs, cancel = () => {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { cancel(); } catch {} reject(new Error("capture_io_unavailable")); }, timeoutMs);
    Promise.resolve().then(work).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(new Error("capture_io_unavailable")); });
  });
}

export function createFollowUpEvidenceCaptureIntegration(config) {
  // These capabilities are trusted factory dependencies, never request fields.
  exact(config, ["bucket", "scope", "intentKeys", "receiptKeys", "receiptSigner", "executeAction", "clock", "timeoutMs", "chunkBytes"]);
  const descriptors = Object.getOwnPropertyDescriptors(config); need(Object.values(descriptors).every(d => Object.hasOwn(d, "value")));
  const scope = copy(config.scope); exact(scope, ["actionDigest", "sourceRevision", "sinkId", "environment"]); digest(scope.actionDigest); opaque(scope.sinkId); need(/^[a-f0-9]{40}$/.test(scope.sourceRevision) && ["synthetic", "production"].includes(scope.environment)); freeze(scope);
  const intentKeys = keyring(config.intentKeys), receiptKeys = keyring(config.receiptKeys), signer = config.receiptSigner;
  exact(signer, ["keyId", "privateKey"]); opaque(signer.keyId); need(signer.privateKey instanceof KeyObject && signer.privateKey.type === "private" && signer.privateKey.asymmetricKeyType === "ed25519");
  const signingKey = signer.privateKey, signingKeyId = signer.keyId;
  need(receiptKeys.has(signingKeyId) && createPublicKey(signingKey).export({ type: "spki", format: "der" }).equals(receiptKeys.get(signingKeyId).export({ type: "spki", format: "der" })));
  const bucket = config.bucket, action = config.executeAction, clock = config.clock, timeoutMs = config.timeoutMs, chunkBytes = config.chunkBytes;
  need(bucket && typeof bucket.put === "function" && typeof bucket.get === "function" && typeof action === "function" && typeof clock === "function"); integer(timeoutMs, 1, 20000); integer(chunkBytes, 512, 24000);
  const now = () => { const time = clock(); integer(time); return time; };
  const assertScope = i => need(Object.entries(scope).every(([key, value]) => i[key] === value));
  const fresh = i => { const time = now(); need(i.issuedAt <= time && time < i.expiresAt && time < i.retentionUntil); return time; };
  function request(input, historical = false) {
    const r = copy(input); exact(r, ["intent", "keyId", "signature"]); const i = intentValue(r.intent); opaque(r.keyId); assertScope(i);
    need(intentKeys.has(r.keyId) && verify(null, followUpEvidenceIntentSigningBytes(i), intentKeys.get(r.keyId), signatureBytes(r.signature)));
    const time = now(); need(i.issuedAt <= time); if (!historical) fresh(i);
    return freeze({ intent: i, intentDigest: hash(followUpEvidenceIntentSigningBytes(i)) });
  }
  // Deliberately independent of source, intent time, action and key rotation.
  const prefix = operationId => `follow-up-evidence-capture/v1/${operationId}/`;
  const signed = body => freeze({ body, keyId: signingKeyId, signature: sign(null, receiptBytes(body), signingKey).toString("base64") });
  function verifyReceipt(value, r, kind) {
    const e = copy(value); exact(e, ["body", "keyId", "signature"]); opaque(e.keyId); need(receiptKeys.has(e.keyId));
    exact(e.body, ["version", "kind", "intent", "intentDigest", "claimedAt", "completedAt", "capture"]);
    need(verify(null, receiptBytes(e.body), receiptKeys.get(e.keyId), signatureBytes(e.signature)));
    const b = e.body; need(b.version === RECEIPT_VERSION && b.kind === kind && b.intentDigest === r.intentDigest && canonical(b.intent) === canonical(r.intent));
    integer(b.claimedAt); need(b.claimedAt >= r.intent.issuedAt && b.claimedAt < r.intent.expiresAt && b.claimedAt <= now());
    if (kind === "claim") need(b.completedAt === null && b.capture === null);
    else {
      integer(b.completedAt); need(b.completedAt >= b.claimedAt && b.completedAt < r.intent.retentionUntil && b.completedAt <= now());
      exact(b.capture, ["version", "operationId", "chunkBytes", "manifest", ...Object.keys(CAPSULE_FLAGS)]);
      need(b.capture.version === "follow-up-evidence-capture.v1" && b.capture.operationId === r.intent.operationId); integer(b.capture.chunkBytes, 512, 24000);
      for (const [key, value] of Object.entries(CAPSULE_FLAGS)) need(b.capture[key] === value);
      exact(b.capture.manifest, ["byteLength", "sha256", "count"]); integer(b.capture.manifest.byteLength, 1, MAX_METADATA_BYTES); integer(b.capture.manifest.count, 1, 200); digest(b.capture.manifest.sha256);
    }
    return freeze(e);
  }
  async function readObject(key, maxBytes) {
    let reader, expired = false;
    // Cancellation is best-effort and never awaited: an unresponsive transport
    // must not extend this operation, nor begin consuming a late response body.
    const cancel = target => { try { if (target) void Promise.resolve(target.cancel()).catch(() => {}); } catch {} };
    return timed(async () => {
      const object = await bucket.get(key);
      if (expired) { cancel(object?.body); fail(); }
      if (object === null) return null;
      need(object && typeof object.etag === "string" && object.etag.length > 0 && object.etag.length <= 200); integer(object.size, 1, maxBytes);
      need(object.body && typeof object.body.getReader === "function"); reader = object.body.getReader();
      const parts = []; let length = 0;
      try {
        for (;;) { const part = await reader.read(); need(!expired); if (part.done) break; need(part.value instanceof Uint8Array && part.value.byteLength > 0); length += part.value.byteLength; need(length <= maxBytes && length <= object.size); parts.push(Buffer.from(part.value)); }
        need(length === object.size); const bytes = Buffer.concat(parts, length), text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), value = copy(JSON.parse(text)); need(canonical(value) === text);
        return { value, text, etag: object.etag };
      } finally { cancel(reader); try { reader.releaseLock(); } catch {} }
    }, timeoutMs, () => { expired = true; cancel(reader); });
  }
  async function putExact(key, value, maxBytes, requireCreated) {
    const text = canonical(value); need(Buffer.byteLength(text) <= maxBytes);
    const ack = await timed(() => bucket.put(key, text, { onlyIf: { etagDoesNotMatch: "*" } }), timeoutMs);
    if (ack === null && requireCreated) return null;
    need(ack === null || (ack && typeof ack.etag === "string" && ack.etag.length > 0 && ack.etag.length <= 200));
    const read = await readObject(key, maxBytes); need(read && read.text === text && (ack === null || ack.etag === read.etag)); return read.value;
  }
  const output = (r, status, reasonCode, extra = {}) => freeze({ contract: FOLLOW_UP_CAPTURE_INTEGRATION_VERSION, status, reasonCode, operationId: r?.intent.operationId ?? null, intentDigest: r?.intentDigest ?? null, actionAttempted: false, actionReport: "unknown", metadataCaptured: false, claimState: "unknown", requiresReadOnlyReconciliation: true, receipt: null, ...extra, ...FLAGS });
  async function reconcileValue(r) {
    if (now() >= r.intent.retentionUntil) return output(r, "indeterminate", "evidence_expired");
    const base = prefix(r.intent.operationId), claimRead = await readObject(base + "claim", MAX_CONTROL_BYTES);
    if (claimRead === null) return output(r, "indeterminate", "claim_absent_unresolved", { claimState: "absent" });
    const claim = verifyReceipt(claimRead.value, r, "claim"), finalRead = await readObject(base + "manifest", MAX_CONTROL_BYTES);
    if (finalRead === null) return output(r, "capture_incomplete", "manifest_missing", { claimState: "present" });
    const receipt = verifyReceipt(finalRead.value, r, "manifest"); need(receipt.body.claimedAt === claim.body.claimedAt);
    const capsule = receipt.body.capture, chunks = [];
    for (let ordinal = 0; ordinal < capsule.manifest.count; ordinal++) { need(now() < r.intent.retentionUntil); const read = await readObject(base + `chunk-${ordinal}`, capsule.chunkBytes); need(read); chunks.push(read.value); }
    const joined = reassembleFollowUpEvidenceCapture({ ...capsule, chunks }), metadata = normalizeFollowUpEvidenceMetadata(joined.record);
    need(metadata.operationId === r.intent.operationId && metadata.actionDigest === r.intent.actionDigest && metadata.observedAt >= claim.body.claimedAt && metadata.observedAt <= receipt.body.completedAt && now() < r.intent.retentionUntil);
    return output(r, "captured", "metadata_only_readback", { claimState: "present", metadataCaptured: true, actionReport: metadata.outcome, receipt });
  }
  async function reconcile(input) {
    let r; try { r = request(input, true); } catch { return output(null, "refused", "invalid_intent", { requiresReadOnlyReconciliation: false }); }
    try { return await reconcileValue(r); } catch { return output(r, "indeterminate", "readback_unavailable_or_conflicting"); }
  }
  async function execute(input) {
    let r; try { r = request(input); } catch { return output(null, "refused", "invalid_intent", { requiresReadOnlyReconciliation: false }); }
    const i = r.intent, base = prefix(i.operationId); let claimedAt, claim;
    try { claimedAt = fresh(i); claim = signed({ version: RECEIPT_VERSION, kind: "claim", intent: i, intentDigest: r.intentDigest, claimedAt, completedAt: null, capture: null }); }
    catch { return output(r, "refused", "invalid_intent", { requiresReadOnlyReconciliation: false }); }
    try {
      const created = await putExact(base + "claim", claim, MAX_CONTROL_BYTES, true);
      if (created === null) { const previous = await reconcileValue(r); return freeze({ ...previous, reasonCode: "operation_already_claimed" }); }
    } catch { return output(r, "indeterminate", "claim_ack_or_readback_unknown"); }
    try { fresh(i); } catch { return output(r, "consumed_not_attempted", "expired_after_claim", { claimState: "present" }); }
    let metadata, actionAttempted = false;
    try {
      const value = await timed(() => { fresh(i); actionAttempted = true; return action(i); }, timeoutMs);
      metadata = normalizeFollowUpEvidenceMetadata(value); need(metadata.operationId === i.operationId && metadata.actionDigest === i.actionDigest && metadata.observedAt >= claimedAt && metadata.observedAt <= now());
    } catch {
      if (!actionAttempted) return output(r, "consumed_not_attempted", "expired_after_claim", { claimState: "present" });
      try { metadata = normalizeFollowUpEvidenceMetadata({ version: METADATA_VERSION, operationId: i.operationId, actionDigest: i.actionDigest, observedAt: now(), outcome: "unknown", readback: "unavailable", statementCount: null, rowsRead: null, rowsWritten: null, evidenceDigests: [], reasonCodes: ["action_unavailable", "outcome_unknown"] }); need(metadata.observedAt >= claimedAt); }
      catch { return output(r, "indeterminate", "action_outcome_unknown", { actionAttempted: true, claimState: "present" }); }
    }
    try {
      need(now() < i.retentionUntil); const capsule = chunkFollowUpEvidenceCapture(metadata, { operationId: i.operationId, chunkBytes }), chunks = [];
      for (const chunk of capsule.chunks) { need(now() < i.retentionUntil); chunks.push(await putExact(base + `chunk-${chunk.ordinal}`, chunk, chunkBytes, false)); }
      const joined = reassembleFollowUpEvidenceCapture({ ...capsule, chunks }); need(canonical(joined.record) === canonical(metadata));
      const completedAt = now(); need(completedAt >= metadata.observedAt && completedAt < i.retentionUntil);
      const { chunks: omitted, ...capture } = capsule;
      const receipt = signed({ version: RECEIPT_VERSION, kind: "manifest", intent: i, intentDigest: r.intentDigest, claimedAt, completedAt, capture });
      await putExact(base + "manifest", receipt, MAX_CONTROL_BYTES, false);
      need(now() < i.retentionUntil);
      return output(r, "captured", "metadata_only_captured", { actionAttempted: true, actionReport: metadata.outcome, metadataCaptured: true, claimState: "present", receipt });
    } catch { return output(r, "capture_incomplete", "capture_ack_or_readback_unknown", { actionAttempted: true, actionReport: metadata.outcome, claimState: "present" }); }
  }
  return Object.freeze({ execute, reconcile });
}
