// SOURCE ONLY. No CLI, key generation, record creation, persistence or provider
// action. Public inspection never opens the bootstrap or retrieves a secret.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { runExactBwsRecord, hostApprovalSigningBytes, validateHostApprovalPolicy, validateHostApproval } from './follow-up-rehearsal-host.mjs';
import { validateCallerConfiguration } from '../follow-up-rehearsal-worker/src/caller-authorization.mjs';
import { ROLES, SERVICES, canonical, encode, parse, exact, need, hash, opaque, digest, manifestSigningBytes, requestSigningBytes, authenticate } from '../follow-up-rehearsal-worker/src/protocol.mjs';

export const SIGNING_RECORD_KEYS = Object.freeze({
  root: 'AMARI_FOLLOWUP_REHEARSAL_MANIFEST_ROOT_SIGNING_KEY',
  owner: 'AMARI_FOLLOWUP_REHEARSAL_OWNER_SIGNING_KEY',
  operator: 'AMARI_FOLLOWUP_REHEARSAL_OPERATOR_SIGNING_KEY',
  reader: 'AMARI_FOLLOWUP_REHEARSAL_READER_SIGNING_KEY',
  hostApproval: 'AMARI_FOLLOWUP_REHEARSAL_HOST_APPROVAL_SIGNING_KEY'
});
export const SIGNING_LIMITS = Object.freeze({ inputBytes: 65536, privateKeyBytes: 4096, bwsGets: 1, operationMs: 15000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const META = ['id', 'key', 'projectId', 'organizationId', 'revisionDate', 'sha256'];
const fingerprint = key => hash(key.export({ type: 'spki', format: 'der' }));
function publicKey(value) {
  need(typeof value === 'string' && value.length <= 1024 && /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(value));
  const key = createPublicKey(value); need(key.type === 'public' && key.asymmetricKeyType === 'ed25519'); return key;
}
// Detach trusted-host arguments without invoking getters, toJSON or arbitrary
// prototypes. All accepted fields below are public; unknown fields fail closed.
function snapshot(value) {
  let nodes = 0;
  function walk(v, depth) {
    need(++nodes <= 2400 && depth <= 16);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { need(Buffer.byteLength(v) <= SIGNING_LIMITS.inputBytes); return v; }
    if (typeof v === 'number') { need(Number.isSafeInteger(v) && !Object.is(v, -0)); return v; }
    need(v && typeof v === 'object' && (Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v))));
    const keys = Reflect.ownKeys(v).filter(k => !(Array.isArray(v) && k === 'length')); need(keys.length <= 64);
    const out = Array.isArray(v) ? [] : {};
    for (const key of keys) { need(typeof key === 'string' && key.length <= 128 && !['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)); const d = Object.getOwnPropertyDescriptor(v, key); need(d.enumerable && Object.hasOwn(d, 'value')); out[key] = walk(d.value, depth + 1); }
    if (Array.isArray(v)) need(Object.keys(out).length === v.length && Object.keys(out).every((k, i) => k === String(i)));
    return out;
  }
  const result = walk(value, 0); need(Buffer.byteLength(canonical(result)) <= SIGNING_LIMITS.inputBytes); return result;
}
function recordIntent(custody, record, role) {
  exact(custody, ['executable', 'executableSha256']); digest(custody.executableSha256);
  need(typeof custody.executable === 'string' && /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(custody.executable) && !custody.executable.split('/').includes('..'));
  exact(record, META); need(UUID.test(record.id) && UUID.test(record.projectId) && UUID.test(record.organizationId));
  need(record.key === SIGNING_RECORD_KEYS[role]); digest(record.sha256);
  need(typeof record.revisionDate === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(record.revisionDate) && Number.isFinite(Date.parse(record.revisionDate)) && Date.parse(record.revisionDate) <= Date.now());
}
function prepare(value) {
  const input = snapshot(value); exact(input, ['kind', 'body', 'context', 'custody', 'record']);
  const { kind, body, context } = input; let role, keyId, key, bytes, expiresAt, fresh, post;
  if (kind === 'manifest') {
    exact(context, ['root', 'principals', 'services']); exact(context.root, ['keyId', 'publicKey']); exact(context.principals, ROLES); exact(context.services, SERVICES); opaque(context.root.keyId);
    bytes = manifestSigningBytes(body); key = publicKey(context.root.publicKey); keyId = context.root.keyId; role = 'root';
    const rootFingerprint = fingerprint(key), prints = new Set([rootFingerprint]);
    for (const name of [...ROLES, ...SERVICES]) {
      const declaration = ROLES.includes(name) ? body.principals.find(p => p.role === name) : body.signers[name], value = publicKey((ROLES.includes(name) ? context.principals : context.services)[name]), print = fingerprint(value);
      need(declaration.publicKeySha256 === print && declaration.keyId !== keyId && declaration.callerId !== keyId && !prints.has(print)); prints.add(print);
    }
    expiresAt = Math.min(body.expiresAt, body.retentionUntil, body.origin.dispatchUntil);
    fresh = () => { const now = Date.now(); need(body.issuedAt <= now && now < expiresAt); };
    post = signature => {
      const artifact = { body, keyId, signature }, text = encode(artifact);
      validateCallerConfiguration({ REHEARSAL_MANIFEST: text, REHEARSAL_CALLER_KEYS: encode({ root: context.root, principals: context.principals }) }); return { artifact, text };
    };
  } else if (kind === 'request') {
    exact(context, ['REHEARSAL_MANIFEST', 'REHEARSAL_CALLER_KEYS']); const config = validateCallerConfiguration(context);
    bytes = requestSigningBytes(body); const p = config.m.principals.find(p => p.callerId === body.callerId && p.role === body.role); need(p);
    need(body.manifestDigest === config.manifestDigest && body.scopeDigest === config.scopeDigest);
    need(['status', 'result'].includes(body.action) || body.role === (['bootstrap', 'revoke'].includes(body.action) ? 'owner' : 'operator'));
    if (body.action === 'revoke') need(config.m.principals.some(principal => principal.keyId === body.body.keyId));
    need(body.issuedAt >= config.m.issuedAt && body.issuedAt >= p.notBefore && body.expiresAt <= config.m.expiresAt && body.expiresAt <= p.expiresAt);
    role = body.role; keyId = p.keyId; key = config.publicKeys[role][0].publicKey; expiresAt = Math.min(body.expiresAt, p.expiresAt, config.m.expiresAt, config.m.retentionUntil);
    fresh = () => { const now = Date.now(); need(config.m.issuedAt <= now && p.notBefore <= now && body.issuedAt <= now && now < expiresAt); };
    post = signature => { const artifact = { body, keyId, signature }, text = encode(artifact); authenticate(config, text).fresh(); return { artifact, text }; };
  } else if (kind === 'host-approval') {
    exact(context, ['trustedRoot', 'requestText']); validateHostApprovalPolicy(body, context.trustedRoot);
    key = publicKey(context.trustedRoot.publicKey); keyId = context.trustedRoot.keyId; role = 'hostApproval'; bytes = hostApprovalSigningBytes(body); expiresAt = body.expiresAt;
    let auth;
    if (body.mode === 'invoke') {
      need(typeof context.requestText === 'string' && hash(context.requestText) === body.operation.envelopeDigest);
      const config = validateCallerConfiguration({ REHEARSAL_MANIFEST: body.operation.publicConfig.REHEARSAL_MANIFEST, REHEARSAL_CALLER_KEYS: body.operation.publicConfig.REHEARSAL_CALLER_KEYS });
      auth = authenticate(config, context.requestText); need(['callerId', 'role'].every(k => auth.r[k] === body.operation.principal[k]) && auth.p.keyId === body.operation.principal.keyId);
      const root = publicKey(parse(body.operation.publicConfig.REHEARSAL_CALLER_KEYS).root.publicKey), print = fingerprint(key);
      need(print !== fingerprint(root) && [...config.m.principals, ...Object.values(config.m.signers)].every(p => p.publicKeySha256 !== print));
      expiresAt = Math.min(expiresAt, auth.r.expiresAt, auth.p.expiresAt, config.m.expiresAt);
    } else need(context.requestText === null);
    fresh = () => { const now = Date.now(); need(body.issuedAt <= now && now < expiresAt); auth?.fresh(); };
    post = signature => { const artifact = { policy: body, signature }; validateHostApproval(artifact, context.trustedRoot); return { artifact, text: canonical(artifact) }; };
  } else need(false);
  recordIntent(input.custody, input.record, role); fresh();
  const inspection = { version: 'follow-up-rehearsal-signing-intent.v1', kind, role, keyId, publicKeySha256: fingerprint(key), signingBytesSha256: hash(bytes), signingBytes: bytes.length, expiresAt, inputDigest: hash(canonical(input)), custody: input.custody, record: input.record, credentialRead: false, executionAuthorized: false, keyCreationAvailable: false, recordCreationAvailable: false };
  return { input, role, key, bytes, expiresAt, fresh, post, inspection, approvedDigest: hash(canonical(inspection)) };
}

export function inspectRehearsalSigning(intent) {
  try { const p = prepare(intent); return { ...p.inspection, approvedDigest: p.approvedDigest }; }
  catch { throw new Error('rehearsal_signing_refused'); }
}

// approvedDigest binds a caller-reviewed intent, not independent proof of human
// consent or durable execution authorization. The existing host's one-shot
// ledger and separately signed finite policies still guard every live action.
export async function signRehearsalArtifact(options, dependencies = {}) {
  let timer, closed = false; const controller = new AbortController();
  try {
    options = snapshot(options); exact(options, ['execute', 'approvedDigest', 'intent']); need(options.execute === true); digest(options.approvedDigest);
    const prepared = prepare(options.intent); need(options.approvedDigest === prepared.approvedDigest);
    const runBws = dependencies.runBws ?? runExactBwsRecord, until = Math.min(prepared.expiresAt, Date.now() + SIGNING_LIMITS.operationMs);
    const fresh = () => { need(!closed && !controller.signal.aborted && Date.now() < until); prepared.fresh(); };
    const work = async () => {
      let record, privateBytes;
      try {
        fresh(); record = await runBws({ custody: snapshot(prepared.input.custody), record: snapshot(prepared.input.record), signal: controller.signal }); fresh();
        // Metadata is checked before the value is read, hashed or parsed. No
        // listing, fallback key, revised record or private-key aggregate exists.
        need(record && META.filter(k => k !== 'sha256').every(k => record[k] === prepared.input.record[k]));
        need(typeof record.value === 'string' && Buffer.byteLength(record.value) <= SIGNING_LIMITS.privateKeyBytes && hash(record.value) === prepared.input.record.sha256);
        need(/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PRIVATE KEY-----\n?$/.test(record.value));
        privateBytes = Buffer.from(record.value); const key = createPrivateKey(privateBytes); need(key.type === 'private' && key.asymmetricKeyType === 'ed25519' && fingerprint(createPublicKey(key)) === fingerprint(prepared.key));
        fresh(); const signature = sign(null, prepared.bytes, key).toString(prepared.input.kind === 'host-approval' ? 'base64url' : 'base64');
        fresh(); const output = prepared.post(signature); fresh();
        return { version: 'follow-up-rehearsal-signing-result.v1', kind: prepared.input.kind, role: prepared.role, approvedDigest: prepared.approvedDigest, ...output, artifactDigest: hash(output.text), credentialGets: 1, persisted: false, deployed: false, invoked: false };
      } finally { privateBytes?.fill(0); if (record && Object.hasOwn(record, 'value')) { try { record.value = undefined; } catch {} } }
    };
    fresh();
    return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { closed = true; controller.abort(); reject(new Error('rehearsal_signing_refused')); }, Math.max(1, until - Date.now())); })]);
  } catch { throw new Error('rehearsal_signing_refused'); }
  finally { closed = true; controller.abort(); clearTimeout(timer); }
}
