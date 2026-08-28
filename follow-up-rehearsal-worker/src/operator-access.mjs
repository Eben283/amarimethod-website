import { createPublicKey, verify, constants } from "node:crypto";
import { validateCallerConfiguration } from "./caller-authorization.mjs";
import { VERSION, parse, exact, need, integer, digest, opaque, canonical } from "./protocol.mjs";
import { FOLLOW_UP_STORAGE_ADAPTER_FLAGS } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";
import { FOLLOW_UP_ADMISSION_GATE_VERSION } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";

export const OPERATOR_PATH = "/v1/rehearsal";
const HOUR = 3600000;
const base64url = (text, max) => {
  need(typeof text === "string" && text.length > 0 && text.length <= max && /^[A-Za-z0-9_-]+$/.test(text));
  const bytes = Buffer.from(text, "base64url"); need(bytes.toString("base64url") === text); return bytes;
};
function origin(value) {
  need(typeof value === "string" && value.length <= 253);
  const url = new URL(value);
  need(url.protocol === "https:" && value === url.origin && !url.username && !url.password && !url.port && !url.search && !url.hash);
  need(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)); return value;
}

// JSON JWTs need not be canonical JSON. This bounded parser accepts ordinary
// JSON whitespace/order but rejects duplicate keys at every level, including
// escaped duplicates. Original base64url segments, never reserialized JSON,
// are the bytes verified by RSA. No remote JWKS fetch or key fallback exists.
function jwtJson(bytes) {
  need(bytes.length <= 4096);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); let at = 0, nodes = 0;
  const white = () => { while (/[\x20\t\r\n]/.test(text[at] ?? "!") && at < text.length) at++; };
  const string = () => { const re = /"(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/y; re.lastIndex = at; const found = re.exec(text); need(found); at = re.lastIndex; return JSON.parse(found[0]); };
  const value = depth => {
    need(++nodes <= 256 && depth <= 6); white(); const c = text[at];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      at++; white(); const object = c === "{", out = object ? Object.create(null) : [], seen = new Set(), end = object ? "}" : "]";
      if (text[at] === end) { at++; return out; }
      for (;;) {
        white(); let key;
        if (object) { key = string(); need(key.length <= 128 && !seen.has(key) && !["__proto__", "prototype", "constructor", "toJSON"].includes(key)); seen.add(key); white(); need(text[at++] === ":"); }
        const item = value(depth + 1); if (object) out[key] = item; else out.push(item);
        need(Object.keys(out).length <= 32); white(); const next = text[at++]; if (next === end) break; need(next === ",");
      }
      return out;
    }
    const re = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y; re.lastIndex = at; const found = re.exec(text); need(found); at = re.lastIndex;
    const result = JSON.parse(found[0]); if (typeof result === "number") need(Number.isFinite(result) && !Object.is(result, -0)); return result;
  };
  const result = value(0); white(); need(at === text.length); return result;
}

// Public release configuration only: no issuer, owner, operator or Access
// private credentials. The reviewed release must pin this exact configuration.
export function validateOperatorAccessConfig(env) {
  const callerConfig = validateCallerConfiguration(env), policy = parse(env.OPERATOR_ACCESS_CONFIG);
  exact(policy, ["version", "origin", "issuer", "audience", "manifestDigest", "scopeDigest", "issuedAt", "expiresAt", "jwks", "principals"]);
  need(policy.version === "follow-up-operator-access.v1"); origin(policy.origin); origin(policy.issuer);
  need(/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(policy.issuer));
  digest(policy.audience); digest(policy.manifestDigest); digest(policy.scopeDigest);
  need(policy.manifestDigest === callerConfig.manifestDigest && policy.scopeDigest === callerConfig.scopeDigest);
  integer(policy.issuedAt); integer(policy.expiresAt);
  need(callerConfig.m.issuedAt <= policy.issuedAt && policy.issuedAt < policy.expiresAt && policy.expiresAt <= callerConfig.m.expiresAt && policy.expiresAt - policy.issuedAt <= HOUR);
  need(Array.isArray(policy.jwks) && policy.jwks.length >= 1 && policy.jwks.length <= 2);
  const keys = new Map(), materials = new Set();
  for (const jwk of policy.jwks) {
    exact(jwk, ["kid", "kty", "alg", "use", "n", "e"]);
    need(typeof jwk.kid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(jwk.kid) && !keys.has(jwk.kid));
    need(jwk.kty === "RSA" && jwk.alg === "RS256" && jwk.use === "sig" && jwk.e === "AQAB");
    const modulus = base64url(jwk.n, 684); need(modulus.length >= 256 && modulus.length <= 512 && modulus[0] >= 128 && !materials.has(jwk.n));
    const key = createPublicKey({ key: jwk, format: "jwk" });
    need(key.type === "public" && key.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails.modulusLength >= 2048 && key.asymmetricKeyDetails.modulusLength <= 4096);
    keys.set(jwk.kid, key); materials.add(jwk.n);
  }
  need(Array.isArray(policy.principals) && policy.principals.length >= 1 && policy.principals.length <= 3);
  const names = new Set(), identities = new Set();
  for (const mapping of policy.principals) {
    exact(mapping, ["commonName", "callerId", "keyId", "role"]); opaque(mapping.callerId); opaque(mapping.keyId);
    need(typeof mapping.commonName === "string" && /^[a-f0-9]{32}\.access$/.test(mapping.commonName) && !names.has(mapping.commonName) && !identities.has(mapping.callerId));
    need(callerConfig.m.principals.some(p => p.callerId === mapping.callerId && p.keyId === mapping.keyId && p.role === mapping.role));
    names.add(mapping.commonName); identities.add(mapping.callerId);
  }
  const fresh = () => { const now = Date.now(); need(policy.issuedAt <= now && now < policy.expiresAt); return now; }; fresh();
  return { policy, callerConfig, origin: policy.origin, path: OPERATOR_PATH, keys, fresh };
}

export function authenticateOperatorAccess(config, jwt) {
  need(typeof jwt === "string" && jwt.length <= 8192); const parts = jwt.split("."); need(parts.length === 3);
  const header = jwtJson(base64url(parts[0], 1024)), payload = jwtJson(base64url(parts[1], 5500));
  exact(header, ["alg", "kid", "typ"]);
  need(header.alg === "RS256" && header.typ === "JWT" && config.keys.has(header.kid));
  exact(payload, Object.hasOwn(payload, "nbf") ? ["type", "aud", "exp", "iss", "common_name", "iat", "sub", "nbf"] : ["type", "aud", "exp", "iss", "common_name", "iat", "sub"]);
  need(payload.type === "app" && payload.sub === "" && payload.iss === config.policy.issuer && Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === config.policy.audience);
  integer(payload.iat); integer(payload.exp); need(payload.iat < payload.exp && payload.exp - payload.iat <= HOUR / 1000);
  if (Object.hasOwn(payload, "nbf")) { integer(payload.nbf); need(payload.nbf < payload.exp); }
  const mapping = config.policy.principals.find(p => p.commonName === payload.common_name); need(mapping);
  const signature = base64url(parts[2], 684), key = config.keys.get(header.kid); need(signature.length === Math.ceil(key.asymmetricKeyDetails.modulusLength / 8));
  // workerd's pinned Node compatibility accepts PEM in the options form but
  // not a nested PublicKeyObject. Preserve explicit RS256/PKCS#1 padding.
  need(verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), { key: key.export({ type: "spki", format: "pem" }), padding: constants.RSA_PKCS1_PADDING }, signature));
  const fresh = () => { const now = config.fresh(); need(payload.iat * 1000 <= now && now < payload.exp * 1000 && (!Object.hasOwn(payload, "nbf") || payload.nbf * 1000 <= now)); return now; }; fresh();
  return { mapping, expiresAt: Math.min(payload.exp * 1000, config.policy.expiresAt), fresh };
}

// The relay returns the frozen caller's result without adding authority/proof.
// The host adapter shares this validator instead of trusting HTTP success alone.
export function validateOperatorResponse(text) {
  const value = parse(text), fields = ["contract", "schemaDigest", "status", "requiresReadOnlyReconciliation", "counter", "gate", "bootstrap", "metrics", "foundationClaims", "productionAuthority"];
  need(value && !Array.isArray(value) && Object.keys(value).every(k => fields.includes(k)) && value.contract === VERSION && ["refused", "indeterminate", "initialized", "uninitialized", "revoked", "observed", "captured", "admitted", "consumed_not_attempted"].includes(value.status) && typeof value.requiresReadOnlyReconciliation === "boolean");
  if (Object.keys(value).length <= 4) { need(["refused", "indeterminate"].includes(value.status)); need(Object.keys(value).every(k => ["contract", "status", "requiresReadOnlyReconciliation", "productionAuthority"].includes(k))); }
  else need(["schemaDigest", "metrics", "foundationClaims", "productionAuthority"].every(k => Object.hasOwn(value, k)));
  if (Object.hasOwn(value, "schemaDigest")) digest(value.schemaDigest);
  if (Object.hasOwn(value, "counter")) integer(value.counter, 0, 1);
  if (Object.hasOwn(value, "productionAuthority")) need(value.productionAuthority === false);
  if (Object.hasOwn(value, "foundationClaims")) need(canonical(value.foundationClaims) === canonical(FOLLOW_UP_STORAGE_ADAPTER_FLAGS));
  if (Object.hasOwn(value, "gate")) { need(value.gate && value.gate.contract === FOLLOW_UP_ADMISSION_GATE_VERSION && value.gate.status === value.status); for (const [key, expected] of Object.entries(FOLLOW_UP_STORAGE_ADAPTER_FLAGS)) need(value.gate[key] === expected); }
  const walk = item => { if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) { if (Object.hasOwn(FOLLOW_UP_STORAGE_ADAPTER_FLAGS, key)) need(child === FOLLOW_UP_STORAGE_ADAPTER_FLAGS[key]); walk(child); } }; walk(value);
  if (value.status === "indeterminate") need(value.requiresReadOnlyReconciliation === true); return value;
}
