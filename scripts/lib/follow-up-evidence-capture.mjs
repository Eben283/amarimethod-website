import { createHash } from "node:crypto";

export const FOLLOW_UP_EVIDENCE_CAPTURE_VERSION = "follow-up-evidence-capture.v1";
const MAX_BYTES = 1_500_000, MAX_CHUNKS = 200, MAX_CHUNK_BYTES = 24_000;
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, authority: false, executionAllowed: false, retryAllowed: false, restoreAllowed: false });
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = () => { throw new TypeError("invalid_or_unbounded_capture"); };
const need = value => { if (!value) fail(); };
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Copy descriptors before reading values. Never serialize caller objects or invoke
// their accessors/toJSON. Limits apply to every input, not just payload roots.
// This generic structural capsule is NOT a PII scrubber. Raw customer/secret
// capture requires separately approved minimization and a private durable sink.
function copy(value, depth = 0, state = { nodes: 0, bytes: 0, active: new Set(), max: 2_500_000 }) {
  need(depth <= 16 && ++state.nodes <= 12000);
  const charge = n => { state.bytes += n; need(state.bytes <= state.max); };
  if (value === null || typeof value === "boolean") { charge(5); return value; }
  if (typeof value === "number") { need(Number.isFinite(value) && !Object.is(value, -0)); charge(32); return value; }
  if (typeof value === "string") { need(value.length <= MAX_BYTES); charge(Buffer.byteLength(JSON.stringify(value))); return value; }
  need(value && typeof value === "object" && !state.active.has(value));
  const array = Array.isArray(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype));
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  need(keys.length <= 12001); state.active.add(value); charge(2);
  const out = array ? [] : {};
  const length = array ? descriptors.length?.value : null;
  if (array) need(Number.isSafeInteger(length) && length >= 0 && length <= 12000 && keys.length === length + 1);
  for (const key of keys) {
    if (array && key === "length") continue;
    const d = descriptors[key];
    need(typeof key === "string" && key.length <= 4096 && d.enumerable && Object.hasOwn(d, "value") && key !== "toJSON");
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
    charge(Buffer.byteLength(JSON.stringify(key)) + 2);
    Object.defineProperty(out, key, { value: copy(d.value, depth + 1, state), enumerable: true, writable: true, configurable: true });
  }
  state.active.delete(value); return out;
}
function exact(value, keys) { need(value && !Array.isArray(value) && typeof value === "object"); const actual = Object.keys(value).sort(), expected = [...keys].sort(); need(actual.length === expected.length && actual.every((key, i) => key === expected[i])); }
const id = value => need(typeof value === "string" && /^[A-Za-z0-9:_.-]{1,200}$/.test(value));
const integer = (value, min, max) => need(Number.isSafeInteger(value) && value >= min && value <= max);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const asciiJson = value => canonical(value).replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
const chunkKeys = ["version", "operationId", "ordinal", "count", "byteLength", "sha256", "data"];
const envelopeKeys = ["version", "operationId", "chunkBytes", "manifest", "chunks", ...Object.keys(FLAGS)];
const version = FOLLOW_UP_EVIDENCE_CAPTURE_VERSION;

export function chunkFollowUpEvidenceCapture(record, options) {
  const o = copy(options); exact(o, Object.hasOwn(o ?? {}, "chunkBytes") ? ["operationId", "chunkBytes"] : ["operationId"]); id(o.operationId);
  const chunkBytes = Object.hasOwn(o, "chunkBytes") ? o.chunkBytes : MAX_CHUNK_BYTES; integer(chunkBytes, 512, MAX_CHUNK_BYTES);
  const payload = Buffer.from(canonical(copy(record)), "utf8"); need(payload.length <= MAX_BYTES);
  const sha256 = hash(payload);
  // Reserve the largest allowed ordinal/count spellings before splitting; count
  // digit growth can never push the final serialized ASCII envelope over budget.
  const overhead = Buffer.byteLength(asciiJson({ version, operationId: o.operationId, ordinal: MAX_CHUNKS, count: MAX_CHUNKS, byteLength: MAX_CHUNK_BYTES, sha256, data: "" }));
  const capacity = Math.floor((chunkBytes - overhead) / 4) * 3; need(capacity > 0);
  const count = Math.ceil(payload.length / capacity); integer(count, 1, MAX_CHUNKS);
  const chunks = Array.from({ length: count }, (_, ordinal) => {
    const part = payload.subarray(ordinal * capacity, (ordinal + 1) * capacity);
    const chunk = { version, operationId: o.operationId, ordinal, count, byteLength: part.length, sha256, data: part.toString("base64") };
    need(Buffer.byteLength(asciiJson(chunk)) <= chunkBytes); return chunk;
  });
  return freeze({ version, operationId: o.operationId, chunkBytes, manifest: { byteLength: payload.length, sha256, count }, chunks, ...FLAGS });
}

export function reassembleFollowUpEvidenceCapture(input) {
  const e = copy(input); exact(e, envelopeKeys); need(e.version === version); id(e.operationId); integer(e.chunkBytes, 512, MAX_CHUNK_BYTES);
  for (const [key, value] of Object.entries(FLAGS)) need(e[key] === value);
  exact(e.manifest, ["byteLength", "sha256", "count"]);
  const m = e.manifest; integer(m.byteLength, 1, MAX_BYTES); integer(m.count, 1, MAX_CHUNKS); need(typeof m.sha256 === "string" && /^[a-f0-9]{64}$/.test(m.sha256));
  need(Array.isArray(e.chunks) && e.chunks.length === m.count);
  let total = 0;
  const parts = e.chunks.map((chunk, ordinal) => {
    exact(chunk, chunkKeys); need(chunk.version === version && chunk.operationId === e.operationId && chunk.ordinal === ordinal && chunk.count === m.count && chunk.sha256 === m.sha256);
    integer(chunk.byteLength, 1, MAX_CHUNK_BYTES); need(typeof chunk.data === "string" && chunk.data.length <= MAX_CHUNK_BYTES && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data));
    need(Buffer.byteLength(asciiJson(chunk)) <= e.chunkBytes);
    total += chunk.byteLength; need(total <= m.byteLength && total <= MAX_BYTES);
    const part = Buffer.from(chunk.data, "base64"); need(part.length === chunk.byteLength && part.toString("base64") === chunk.data); return part;
  });
  need(total === m.byteLength); const payload = Buffer.concat(parts, total); need(hash(payload) === m.sha256);
  let text, record; try { text = new TextDecoder("utf-8", { fatal: true }).decode(payload); record = copy(JSON.parse(text)); } catch { fail(); }
  need(canonical(record) === text);
  return freeze({ status: "structurally_complete", operationId: e.operationId, sha256: m.sha256, record, evidenceAuthenticated: false, sinkDurabilityProven: false, ...FLAGS });
}

// Intent is explicit but self-reported: this pure function cannot consume a
// cross-process dispatch token or prove that a private sink acknowledged bytes.
export function classifyOneShotCaptureState(input) {
  const s = copy(input); exact(s, ["intent", "dispatchConsumed", "capture"]);
  exact(s.intent, ["operationId", "intentId"]); id(s.intent.operationId); id(s.intent.intentId); need(typeof s.dispatchConsumed === "boolean");
  if (!s.dispatchConsumed) { need(s.capture === null); return freeze({ status: "not_dispatched", requiresReadOnlyReconciliation: false, dispatchConsumed: false, evidenceAuthenticated: false, sinkDurabilityProven: false, ...FLAGS }); }
  let complete = false;
  if (s.capture !== null) { try { complete = reassembleFollowUpEvidenceCapture(s.capture).operationId === s.intent.operationId; } catch { /* consumed remains consumed, including malformed capture */ } }
  return freeze({ status: complete ? "captured" : "requires_read_only_reconciliation", requiresReadOnlyReconciliation: !complete, dispatchConsumed: true, evidenceAuthenticated: false, sinkDurabilityProven: false, ...FLAGS });
}
