const TOKEN_VERSION = 1;
const MAX_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const FUTURE_IAT_SKEW_MS = 5 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const CAPABILITIES = new Set(["cancel", "reschedule", "calendar"]);
const EXPECTED_KEYS = Object.freeze([
  "appointmentId", "capabilities", "contactId", "exp", "iat", "revision", "v",
]);

const clean = (value) => String(value || "").trim();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("appointment manage token encoding is invalid");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret, usages) {
  const value = clean(secret);
  if (value.length < 32) throw new Error("appointment manage link secret is unavailable");
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(value), { name: "HMAC", hash: "SHA-256" }, false, usages,
  );
}

function canonicalClaims(input, nowMs) {
  const capabilities = [...new Set(Array.isArray(input?.capabilities) ? input.capabilities.map(clean) : [])].sort();
  const claims = {
    appointmentId: clean(input?.appointmentId),
    capabilities,
    contactId: clean(input?.contactId),
    exp: Number(input?.exp),
    iat: Number(input?.iat ?? nowMs),
    revision: Number(input?.revision),
    v: Number(input?.v ?? TOKEN_VERSION),
  };
  if (claims.v !== TOKEN_VERSION || !ID.test(claims.appointmentId) || !ID.test(claims.contactId)) {
    throw new Error("appointment manage token identity is invalid");
  }
  if (!Number.isInteger(claims.revision) || claims.revision < 1) {
    throw new Error("appointment manage token revision is invalid");
  }
  if (!capabilities.length || capabilities.some((capability) => !CAPABILITIES.has(capability))) {
    throw new Error("appointment manage token capability is invalid");
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > nowMs + FUTURE_IAT_SKEW_MS ||
      claims.exp <= nowMs || claims.exp <= claims.iat || claims.exp - claims.iat > MAX_TTL_MS) {
    throw new Error("appointment manage token lifetime is invalid");
  }
  return claims;
}

export async function issueAppointmentManageToken(secret, input, nowMs = Date.now()) {
  const claims = canonicalClaims(input, nowMs);
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(encoded));
  return `${encoded}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyAppointmentManageToken(secret, token, options = {}) {
  const raw = clean(token);
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra) throw new Error("appointment manage token is invalid");
  const verified = await crypto.subtle.verify(
    "HMAC", await hmacKey(secret, ["verify"]), fromBase64Url(signature), new TextEncoder().encode(encoded),
  );
  if (!verified) throw new Error("appointment manage token signature is invalid");
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))); }
  catch { throw new Error("appointment manage token payload is invalid"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
      Object.keys(parsed).sort().join("|") !== [...EXPECTED_KEYS].sort().join("|")) {
    throw new Error("appointment manage token claims are invalid");
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const claims = canonicalClaims(parsed, nowMs);
  const required = clean(options.capability);
  if (required && !claims.capabilities.includes(required)) throw new Error("appointment manage capability is not granted");
  return Object.freeze(claims);
}

export async function appointmentManageIdempotencyKey(token, action, startTime = "") {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${clean(token)}\n${clean(action)}\n${clean(startTime)}`),
  );
  return `client-manage:${base64Url(new Uint8Array(digest))}`;
}
