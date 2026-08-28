import { createPublicKey, verify } from "node:crypto";
import { ROLES, parse, exact, opaque, need, hash, canonical, manifestSigningBytes } from "./protocol.mjs";

// Public verification material only. This is shared by the relay and release
// preparation; it never creates signatures, keys, nonces or request deadlines.
function publicKey(pem) {
  need(typeof pem === "string" && /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(pem));
  const key = createPublicKey(pem); need(key.type === "public" && key.asymmetricKeyType === "ed25519"); return key;
}
const fingerprint = key => hash(key.export({ type: "spki", format: "der" }));
export function validateCallerConfiguration(env) {
  need(env && env.REHEARSAL_KEYS === undefined);
  const envelope = parse(env.REHEARSAL_MANIFEST), keys = parse(env.REHEARSAL_CALLER_KEYS);
  exact(envelope, ["body", "keyId", "signature"]); exact(keys, ["root", "principals"]); exact(keys.root, ["keyId", "publicKey"]); exact(keys.principals, ROLES); opaque(keys.root.keyId);
  const m = envelope.body, bytes = manifestSigningBytes(m), root = publicKey(keys.root.publicKey), rootFingerprint = fingerprint(root);
  need(envelope.keyId === keys.root.keyId && typeof envelope.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature));
  const signature = Buffer.from(envelope.signature, "base64"); need(signature.toString("base64") === envelope.signature && verify(null, bytes, root, signature));
  need([...m.principals, ...Object.values(m.signers)].every(p => p.publicKeySha256 !== rootFingerprint && p.keyId !== keys.root.keyId));
  const publicKeys = {};
  for (const role of ROLES) {
    const declaration = m.principals.find(p => p.role === role), key = publicKey(keys.principals[role]);
    need(fingerprint(key) === declaration.publicKeySha256);
    publicKeys[role] = [{ keyId: declaration.keyId, publicKey: key }];
  }
  return { m, manifestDigest: hash(bytes), scopeDigest: hash(canonical(m.scope)), publicKeys };
}
