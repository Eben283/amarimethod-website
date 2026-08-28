import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { VERSION, ACTION_DIGEST, canonical, encode, parse, manifestSigningBytes, requestSigningBytes } from "../../follow-up-rehearsal-worker/src/protocol.mjs";
import { validateOperatorAccessConfig, authenticateOperatorAccess, validateOperatorResponse, OPERATOR_PATH } from "../../follow-up-rehearsal-worker/src/operator-access.mjs";
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";
import operatorIngress from "../../follow-up-rehearsal-worker/src/operator-ingress.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), DAY = 86400000;
const hash = s => createHash("sha256").update(s).digest("hex"), id = s => "id_" + hash(s);
const roles = ["root", "owner", "operator", "reader", "admission", "capture", "floor", "receipt", "witness", "source"];
const pairs = Object.fromEntries(roles.map(r => [r, generateKeyPairSync("ed25519")]));
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }), jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "fixture-access-key", alg: "RS256", use: "sig" };
const pem = r => pairs[r].publicKey.export({ type: "spki", format: "pem" }), fingerprint = r => hash(pairs[r].publicKey.export({ type: "spki", format: "der" }));
const commonName = role => hash("access/" + role).slice(0, 32) + ".access";
const instances = new Set(); let serial = 0, nonce = 0, bundles, egress = 0;
function fixture() {
  const at = Date.now() - 100, name = "operator-fixture-" + ++serial;
  const scope = { accountId: id(name), targetId: id("synthetic target"), actionScopeDigest: hash("fixed synthetic action"), environment: "synthetic", sinkId: id(name + "/sink"), registryId: id(name + "/registry"), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: "a".repeat(40), actionDigest: ACTION_DIGEST, handlerDigest: hash("unchanged control"), epoch: id(name + "/epoch"), generation: 1, issuerReleaseDigest: hash("unchanged issuer"), policyVersion: "follow-up-retention-policy.v1" };
  const body = { version: VERSION, transport: "private_service_binding_rpc", scope, origin: { sourceId: id("synthetic source"), sequence: 1, originalAt: at - 1000, approvedAt: at, dispatchUntil: at + 240000 }, aliasSetDigest: hash("synthetic aliases"), replayHorizonUntil: at + 10 * DAY, retentionUntil: at + DAY - 2000, parentDeadline: at + DAY, deletionDeadline: null, issuedAt: at, expiresAt: at + 3600000, issuerSequence: 1, principals: ["owner", "operator", "reader"].map(role => ({ callerId: id("caller/" + role), keyId: id(role), publicKeySha256: fingerprint(role), role, notBefore: at, expiresAt: at + 3600000 })), signers: Object.fromEntries(roles.slice(4).map(role => [role, { keyId: id(role), publicKeySha256: fingerprint(role) }])) };
  const manifest = { body, keyId: id("root"), signature: sign(null, manifestSigningBytes(body), pairs.root.privateKey).toString("base64") };
  const callerBindings = { REHEARSAL_MANIFEST: encode(manifest), REHEARSAL_CALLER_KEYS: encode({ root: { keyId: id("root"), publicKey: pem("root") }, principals: Object.fromEntries(["owner", "operator", "reader"].map(r => [r, pem(r)])) }) };
  const policy = { version: "follow-up-operator-access.v1", origin: "https://operator.example.com", issuer: "https://fixture.cloudflareaccess.com", audience: hash("fixture Access audience"), manifestDigest: hash(manifestSigningBytes(body)), scopeDigest: hash(canonical(scope)), issuedAt: at, expiresAt: body.expiresAt, jwks: [jwk], principals: body.principals.map(p => ({ commonName: commonName(p.role), callerId: p.callerId, keyId: p.keyId, role: p.role })) };
  const operatorBindings = { ...callerBindings, OPERATOR_ACCESS_CONFIG: encode(policy) };
  const bindings = role => ({ REHEARSAL_MANIFEST: encode(manifest), REHEARSAL_KEYS: encode({ root: { keyId: id("root"), publicKey: pem("root") }, publicKeys: Object.fromEntries(roles.slice(1).map(r => [r, pem(r)])), privateKeys: Object.fromEntries((role === "control" ? ["receipt", "witness"] : ["admission", "capture", "floor", "source"]).map(r => [r, pairs[r].privateKey.export({ type: "pkcs8", format: "pem" })])) }) });
  return { manifest, callerBindings, operatorBindings, policy, bindings };
}
function request(f, action = "execute", role = ["bootstrap", "revoke"].includes(action) ? "owner" : ["status", "result"].includes(action) ? "reader" : "operator", changes = {}) {
  const now = Date.now(), body = { version: VERSION, manifestDigest: hash(manifestSigningBytes(f.manifest.body)), scopeDigest: hash(canonical(f.manifest.body.scope)), callerId: id("caller/" + role), role, action, body: action === "revoke" ? { keyId: id("operator") } : {}, nonce: hash("operator nonce " + ++nonce), issuedAt: now - 1, expiresAt: now + 29999, ...changes };
  return encode({ body, keyId: id(role), signature: sign(null, requestSigningBytes(body), pairs[role].privateKey).toString("base64") });
}
function token(f, role = "operator", changes = {}, headerChanges = {}, rawPayload) {
  const now = Math.floor(Date.now() / 1000), header = { alg: "RS256", kid: jwk.kid, typ: "JWT", ...headerChanges }, payload = { type: "app", aud: [f.policy.audience], exp: now + 300, iss: f.policy.issuer, common_name: commonName(role), iat: now - 1, sub: "", ...changes };
  const input = Buffer.from(JSON.stringify(header)).toString("base64url") + "." + Buffer.from(rawPayload ?? JSON.stringify(payload)).toString("base64url"); return input + "." + sign("RSA-SHA256", Buffer.from(input), rsa.privateKey).toString("base64url");
}
const BRIDGE = `export default {async fetch(req,env){const p=new URL(req.url).pathname;if(p==='/peek')return Response.json(await env.CALLER.peek());if(p==='/mode')return Response.json(await env.CALLER.mode(await req.text()));if(p==='/stream'){const kind=req.headers.get('x-test-stream');const body=new ReadableStream({start(c){if(kind==='oversize'){c.enqueue(new Uint8Array(17000));c.close();}else if(kind==='chunks'){for(let i=0;i<34;i++)c.enqueue(new Uint8Array([32]));c.close();}else if(kind==='invalid-utf8'){c.enqueue(new Uint8Array([255]));c.close();}else{c.enqueue(new Uint8Array([123]));}}});return env.OPERATOR.fetch(new Request('https://operator.example.com/v1/rehearsal',{method:'POST',headers:{'content-type':'application/json','Cf-Access-Jwt-Assertion':req.headers.get('Cf-Access-Jwt-Assertion')||''},body}));}return env.OPERATOR.fetch(req);}};`;
const FAKE_CALLER = `import {WorkerEntrypoint} from 'cloudflare:workers';let calls=0,last=null,mode='normal';export class FollowUpRehearsalCaller extends WorkerEntrypoint{peek(){return{calls,last};}mode(v){mode=v;return true;}async invoke(text){calls++;last=text;if(mode==='lost')throw Error('synthetic lost reply');if(mode==='late')await new Promise(r=>setTimeout(r,100));if(mode==='hang')await new Promise(()=>{});if(mode==='badjson')return '{}';if(mode==='oversize')return 'x'.repeat(17000);if(mode==='authority')return '{"contract":"follow-up-private-rehearsal.v1","productionAuthority":true,"requiresReadOnlyReconciliation":false,"status":"refused"}';return '{"contract":"follow-up-private-rehearsal.v1","productionAuthority":false,"requiresReadOnlyReconciliation":false,"status":"refused"}';}}export default {fetch(){return new Response('Not found',{status:404});}};`;
beforeAll(async () => {
  bundles = {};
  for (const role of ["operator", "caller", "control", "issuer"]) {
    const built = await build({ absWorkingDir: ROOT, entryPoints: [`follow-up-rehearsal-worker/src/${role === "operator" ? "operator-ingress" : role}.mjs`], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers", "node:crypto"], logLevel: "silent", sourcemap: false, minify: false });
    expect(built.warnings).toEqual([]); expect(built.outputFiles).toHaveLength(1); bundles[role] = built.outputFiles[0].text;
  }
  bundles.probe = (await build({ absWorkingDir: ROOT, stdin: { contents: `import {validateOperatorAccessConfig,authenticateOperatorAccess} from './follow-up-rehearsal-worker/src/operator-access.mjs';export default {async fetch(req,env){let stage='configuration';try{const c=validateOperatorAccessConfig(env);stage='access';authenticateOperatorAccess(c,await req.text());return Response.json({stage:'authenticated'});}catch(e){return Response.json({stage,stack:e.stack});}}};`, resolveDir: ROOT }, bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["node:crypto", "cloudflare:workers"], logLevel: "silent" })).outputFiles[0].text;
});
afterEach(async () => { const active = [...instances]; instances.clear(); for (const mf of active) await mf.dispose(); expect(egress).toBe(0); });
async function start(f = fixture(), { real = false, operatorBindings = {} } = {}) {
  const base = { modules: true, compatibilityDate: "2026-08-27", compatibilityFlags: ["nodejs_compat"], outboundService: () => { egress++; return new Response("forbidden", { status: 403 }); } };
  const workers = [
    { ...base, name: "bridge", script: BRIDGE, serviceBindings: { OPERATOR: "operator", CALLER: { name: "caller", entrypoint: "FollowUpRehearsalCaller" } } },
    { ...base, name: "probe", script: bundles.probe, bindings: f.operatorBindings },
    { ...base, name: "operator", script: bundles.operator, bindings: { ...f.operatorBindings, ...operatorBindings }, serviceBindings: { CALLER: { name: "caller", entrypoint: "FollowUpRehearsalCaller" } } },
    real ? { ...base, name: "caller", script: bundles.caller, bindings: f.callerBindings, serviceBindings: { CONTROL: { name: "control", entrypoint: "FollowUpRehearsalControl" } } } : { ...base, name: "caller", script: FAKE_CALLER }
  ];
  if (real) workers.push({ ...base, name: "control", script: bundles.control, bindings: f.bindings("control"), durableObjects: { REGISTRY: { className: "FollowUpRehearsalRegistryV1", useSQLite: true } }, r2Buckets: ["CAPTURE_BUCKET"], serviceBindings: { ISSUER: { name: "issuer", entrypoint: "FollowUpRehearsalIssuer" } } }, { ...base, name: "issuer", script: bundles.issuer, bindings: f.bindings("issuer") });
  const options = convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers });
  for (const worker of options.workers) if (["operator", "caller", "control", "issuer"].includes(worker.config.name)) {
    const config = JSON.parse(readFileSync(join(ROOT, `follow-up-rehearsal-worker/wrangler.${worker.config.name}.jsonc`), "utf8"));
    worker.config.limits = { cpuMs: config.limits.cpu_ms, subrequests: config.limits.subrequests }; worker.config.workersDev = config.workers_dev; worker.config.previewUrls = config.preview_urls; worker.config.observability = config.observability;
  }
  const mf = new Miniflare(options); instances.add(mf);
  try { await mf.ready; } catch (error) { instances.delete(mf); try { await mf.dispose(); } catch {} throw error; }
  const post = (path, body = "", headers = {}, url = f.policy.origin) => mf.dispatchFetch(url + path, { method: "POST", body, headers });
  const send = (text, jwt = token(f), headers = {}) => post(OPERATOR_PATH, text, { "content-type": "application/json", ...(jwt === null ? {} : { "Cf-Access-Jwt-Assertion": jwt }), ...headers });
  return { f, mf, post, send, call: async (...args) => (await send(...args)).json(), peek: async () => (await post("/peek")).json(), mode: async mode => (await post("/mode", mode)).json() };
}

describe("Access-protected operator source gateway", () => {
  it("native public configuration and Access signature verification", async () => { const s = await start(), worker = await s.mf.getWorker("probe"); expect(await (await worker.fetch("https://probe.example.com", { method: "POST", body: token(s.f) })).json()).toEqual({ stage: "authenticated" }); });
  it("actual HTTP handler validates signed credentials in the Node host runtime", async () => { const f = fixture(), text = request(f), invoke = vi.fn(async () => encode({ contract: VERSION, status: "refused", requiresReadOnlyReconciliation: false, productionAuthority: false })); const response = await operatorIngress.fetch(new Request(f.policy.origin + OPERATOR_PATH, { method: "POST", headers: { "content-type": "application/json", "Cf-Access-Jwt-Assertion": token(f) }, body: text }), { ...f.operatorBindings, CALLER: { invoke } }); expect(response.status).toBe(200); expect(invoke).toHaveBeenCalledWith(text); });
  it.each(["body", "rpc"])("does not start an unobserved rejecting %s promise if the deadline expires at await-helper entry", async kind => {
    const f = fixture(), text = request(f), jwt = token(f), at = Date.now(), bytes = new TextEncoder().encode(text), expiryCall = kind === "body" ? 5 : 16;
    const read = vi.fn().mockResolvedValueOnce({ value: bytes, done: false }).mockResolvedValue({ done: true });
    if (kind === "body") read.mockImplementation(() => Promise.reject(Error("must not start")));
    const invoke = vi.fn(() => Promise.reject(Error("must not start"))), reader = { read, cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
    const req = { url: f.policy.origin + OPERATOR_PATH, method: "POST", headers: new Headers({ "content-type": "application/json", "Cf-Access-Jwt-Assertion": jwt }), body: { getReader: () => reader } };
    let calls = 0; const clock = vi.spyOn(Date, "now").mockImplementation(() => at + (++calls >= expiryCall ? 30001 : 0));
    try { const response = await operatorIngress.fetch(req, { ...f.operatorBindings, CALLER: { invoke } }); expect(response.status).toBe(403); expect(invoke).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(kind === "body" ? 0 : 2); expect(calls).toBe(expiryCall); } finally { clock.mockRestore(); }
  });
  it("runs actual unwrapped HTTPS→operator→caller→control→SQLite DO→issuer/R2 bundles", async () => {
    const s = await start(fixture(), { real: true });
    expect(await s.call(request(s.f, "bootstrap"), token(s.f, "owner"))).toMatchObject({ status: "initialized", counter: 0 });
    expect(await s.call(request(s.f, "admit"))).toMatchObject({ status: "admitted" });
    const result = await s.call(request(s.f)); expect(result).toMatchObject({ status: "captured", counter: 1, metrics: { nativeCalls: 50, issuer: 2 }, productionAuthority: false });
    expect(result.metrics.nativeCalls + 3).toBe(53); // Gateway, caller, control hops; HTTP ingress excluded. Frozen downstream cap64 remains unchanged.
    expect(await s.call(request(s.f, "result"), token(s.f, "reader"))).toMatchObject({ counter: 1, metrics: { transactions: 0, put: 0 } });
    expect(await s.call(request(s.f))).toMatchObject({ counter: 1, gate: { actionAttempted: false, reasonCode: "already_consumed" } });
  });
  it("preserves exact envelope bytes once and propagates read-only refusal", async () => { const s = await start(), text = request(s.f), response = await s.send(text); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toMatchObject({ status: "refused", requiresReadOnlyReconciliation: false }); expect(await s.peek()).toEqual({ calls: 1, last: text }); });
  it.each(["GET", "OPTIONS", "PUT"])("denies method %s without forwarding", async method => { const s = await start(); expect((await s.mf.dispatchFetch(s.f.policy.origin + OPERATOR_PATH, { method })).status).toBe(404); expect((await s.peek()).calls).toBe(0); });
  it.each(["/", "/v1/rehearsal?retry=1", "/v1/rehearsal/"])("denies path %s", async path => { const s = await start(); expect((await s.post(path)).status).toBe(404); expect((await s.peek()).calls).toBe(0); });
  it.each(["http://operator.example.com", "https://other.example.com"])("denies wrong origin %s", async origin => { const s = await start(); expect((await s.post(OPERATOR_PATH, request(s.f), { "content-type": "application/json", "Cf-Access-Jwt-Assertion": token(s.f) }, origin)).status).toBe(403); expect((await s.peek()).calls).toBe(0); });
  it.each(["missing", "cookie", "identity_header", "alg", "typ", "kid", "issuer", "audience", "multiaudience", "common_name", "expired", "future", "nbf", "long_lived", "user_sub", "signature", "unknown", "oversize", "duplicate"])("rejects Access %s before forwarding", async kind => {
    const s = await start(); let jwt = token(s.f), headers = {};
    if (["missing", "cookie", "identity_header"].includes(kind)) { jwt = null; if (kind === "cookie") headers.Cookie = "CF_Authorization=" + token(s.f); if (kind === "identity_header") headers["Cf-Access-Authenticated-User-Email"] = "operator@example.com"; }
    if (kind === "alg") jwt = token(s.f, "operator", {}, { alg: "HS256" }); if (kind === "typ") jwt = token(s.f, "operator", {}, { typ: "JOSE" }); if (kind === "kid") jwt = token(s.f, "operator", {}, { kid: "unknown" });
    if (kind === "issuer") jwt = token(s.f, "operator", { iss: "https://other.cloudflareaccess.com" }); if (kind === "audience") jwt = token(s.f, "operator", { aud: [hash("wrong")] }); if (kind === "multiaudience") jwt = token(s.f, "operator", { aud: [s.f.policy.audience, hash("wrong")] }); if (kind === "common_name") jwt = token(s.f, "operator", { common_name: commonName("unknown") });
    const now = Math.floor(Date.now() / 1000);
    if (kind === "expired") jwt = token(s.f, "operator", { iat: now - 60, exp: now - 1 }); if (kind === "future") jwt = token(s.f, "operator", { iat: now + 10 }); if (kind === "nbf") jwt = token(s.f, "operator", { nbf: now + 10 }); if (kind === "long_lived") jwt = token(s.f, "operator", { exp: now + 3601 }); if (kind === "user_sub") jwt = token(s.f, "operator", { sub: "user-id" });
    if (kind === "signature") jwt = jwt.slice(0, -6) + "AAAAAA"; if (kind === "unknown") jwt = token(s.f, "operator", { email: "not-service-auth" }); if (kind === "oversize") jwt = "x".repeat(8300);
    if (kind === "duplicate") { const payload = Buffer.from(jwt.split(".")[1], "base64url").toString(); jwt = token(s.f, "operator", {}, {}, payload.slice(0, -1) + ',"sub":""}'); }
    expect((await s.send(request(s.f), jwt, headers)).status).toBe(403); expect((await s.peek()).calls).toBe(0);
  });
  it.each(["signature", "malformed", "scope", "expired", "wrong_role", "different_principal"])("rejects signed request %s before forwarding", async kind => {
    const s = await start(); let text = request(s.f);
    if (kind === "signature") { const v = parse(text); v.signature = "A".repeat(86) + "=="; text = encode(v); } if (kind === "malformed") text = "{}";
    if (kind === "scope") text = request(s.f, "execute", "operator", { scopeDigest: hash("other") }); if (kind === "expired") text = request(s.f, "execute", "operator", { issuedAt: Date.now() - 29999, expiresAt: Date.now() - 1 });
    if (kind === "wrong_role") text = request(s.f, "bootstrap", "operator"); if (kind === "different_principal") text = request(s.f, "result", "reader");
    expect((await s.send(text)).status).toBe(403); expect((await s.peek()).calls).toBe(0);
  });
  it.each(["oversize", "invalid-utf8", "stall"])("bounds %s streamed body without CALLER forwarding", async kind => { const s = await start(), response = await s.post("/stream", "", { "x-test-stream": kind, "Cf-Access-Jwt-Assertion": token(s.f) }); expect(response.status).toBe(403); expect((await s.peek()).calls).toBe(0); });
  it("does not read a stalled body before Access authentication", async () => { const s = await start(), at = Date.now(); expect((await s.post("/stream", "", { "x-test-stream": "stall" })).status).toBe(403); expect(Date.now() - at).toBeLessThan(1000); expect((await s.peek()).calls).toBe(0); });
  it.each([{ "content-type": "text/plain" }, { "content-encoding": "gzip" }])("rejects unsafe body headers %j", async headers => { const s = await start(); expect((await s.send(request(s.f), token(s.f), headers)).status).toBe(403); expect((await s.peek()).calls).toBe(0); });
  it.each(["lost", "oversize", "badjson", "authority"])("%s remote reply is indeterminate and never retried", async mode => { const s = await start(); await s.mode(mode); const response = await s.send(request(s.f)); expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true, productionAuthority: false }); expect((await s.peek()).calls).toBe(1); });
  it.each(["late", "hang"])("bounds %s reply by original signed request expiry", async mode => { const s = await start(); await s.mode(mode); const now = Date.now(), text = request(s.f, "execute", "operator", { issuedAt: now - 1, expiresAt: now + 60 }); expect(await s.call(text)).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect(await s.peek()).toEqual({ calls: 1, last: text }); });
  it("expires Access while RPC is pending without extending JWT or signed request clocks", async () => { const s = await start(); await s.mode("hang"); const text = request(s.f), jwt = token(s.f, "operator", { exp: Math.floor(Date.now() / 1000) + 2 }); expect(await s.call(text, jwt)).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect(await s.peek()).toEqual({ calls: 1, last: text }); });
  it.each(["root", "principal", "private_keys"])("rejects invalid public %s material before gateway forwarding", async kind => {
    const f = fixture(), env = { ...f.operatorBindings }, keys = parse(env.REHEARSAL_CALLER_KEYS);
    if (kind === "root") keys.root.publicKey = pem("reader"); if (kind === "principal") keys.principals.operator = pem("owner"); if (kind === "private_keys") env.REHEARSAL_KEYS = "{}";
    env.REHEARSAL_CALLER_KEYS = encode(keys); const s = await start(f, { operatorBindings: env }); expect((await s.send(request(f))).status).toBe(403); expect((await s.peek()).calls).toBe(0);
  });
  it.each(["unknown", "noncanonical", "manifest", "scope", "origin", "issuer", "expired", "future", "duplicate_mapping", "wrong_mapping", "private_jwk", "small_rsa", "key_algorithm", "duplicate_key"])("rejects %s Access config before forwarding", async kind => {
    const f = fixture(), p = structuredClone(f.policy); let text;
    if (kind === "unknown") p.secret = "not permitted"; if (kind === "noncanonical") text = JSON.stringify(p, null, 2); if (kind === "manifest") p.manifestDigest = hash("wrong"); if (kind === "scope") p.scopeDigest = hash("wrong");
    if (kind === "origin") p.origin = "https://operator.example.com:443"; if (kind === "issuer") p.issuer = "https://cloudflareaccess.com.attacker.example.com"; if (kind === "expired") p.expiresAt = Date.now() - 1; if (kind === "future") p.issuedAt = Date.now() + 10000;
    if (kind === "duplicate_mapping") p.principals[1].commonName = p.principals[0].commonName; if (kind === "wrong_mapping") p.principals[1].role = "owner";
    if (kind === "private_jwk") p.jwks[0].d = "secret"; if (kind === "small_rsa") p.jwks[0].n = Buffer.alloc(128, 255).toString("base64url"); if (kind === "key_algorithm") p.jwks[0].alg = "HS256"; if (kind === "duplicate_key") p.jwks.push({ ...p.jwks[0], kid: "different-id" });
    const operatorBindings = { ...f.operatorBindings, OPERATOR_ACCESS_CONFIG: text ?? encode(p) }; expect(() => validateOperatorAccessConfig(operatorBindings)).toThrow(); const s = await start(f, { operatorBindings }); expect((await s.send(request(f))).status).toBe(403); expect((await s.peek()).calls).toBe(0);
  });
  it("accepts documented noncanonical JWT whitespace and optional nbf while rejecting escaped duplicate keys", () => {
    const f = fixture(), config = validateOperatorAccessConfig(f.operatorBindings), jwt = token(f, "operator", { nbf: Math.floor(Date.now() / 1000) - 1 }), payload = Buffer.from(jwt.split(".")[1], "base64url").toString();
    expect(authenticateOperatorAccess(config, token(f, "operator", {}, {}, JSON.stringify(JSON.parse(payload), null, 2))).mapping.role).toBe("operator");
    expect(() => authenticateOperatorAccess(config, token(f, "operator", {}, {}, payload.slice(0, -1) + ',"\\u0073ub":""}'))).toThrow();
  });
  it("shares fail-closed reply validation with actual host adapter", () => { expect(validateOperatorResponse(encode({ contract: VERSION, status: "refused", requiresReadOnlyReconciliation: false, productionAuthority: false })).status).toBe("refused"); expect(() => validateOperatorResponse(encode({ contract: VERSION, status: "indeterminate", requiresReadOnlyReconciliation: false }))).toThrow(); });
  it("ships disabled route topology with no private credentials, outbound fetch, signing, logs or baseline edits", () => {
    const text = readFileSync(join(ROOT, "follow-up-rehearsal-worker/wrangler.operator.jsonc"), "utf8"), c = JSON.parse(text); expect(text).toBe(JSON.stringify(c, null, 2) + "\n");
    expect(c).toMatchObject({ name: "amari-followup-operator-rehearsal", main: "src/operator-ingress.mjs", compatibility_date: "2026-08-27", workers_dev: false, preview_urls: false, routes: [], limits: { subrequests: 1 }, services: [{ binding: "CALLER", service: "amari-followup-capture-caller-rehearsal", entrypoint: "FollowUpRehearsalCaller" }] });
    expect(Object.keys(c).sort()).toEqual(["name", "main", "account_id", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "routes", "observability", "send_metrics", "keep_vars", "limits", "services"].sort());
    expect(bundles.operator).not.toMatch(/\b(?:createPrivateKey|randomBytes|sign)\d*\s*\(|\bconsole\.|\b(?:globalThis\.fetch|await fetch)\s*\(/);
    for (const [file, expected] of [["control", "4f1db560b89aa5a048fcb587d6a8512ff827b4917c3dbdd769ad87fe1834ffd8"], ["issuer", "6d79884633b491237cfc212b900eaeebbde44ddb1da0264c3ace4e6dd203e802"], ["protocol", "7930f63d7ba5f4b42c9471010cd09520a12186e6914cd8676b604c597f6d37da"], ["caller", "f7a650bb68255aef250d81d87e966494df197a1cd0d3040ecaa81fb0bc26f9cd"], ["caller-authorization", "656498d91ff01cd9433cf0bbf1d66911b6e95f14ead64c37de8e65b21690d527"]]) expect(hash(readFileSync(join(ROOT, `follow-up-rehearsal-worker/src/${file}.mjs`)))).toBe(expected);
  });
});
