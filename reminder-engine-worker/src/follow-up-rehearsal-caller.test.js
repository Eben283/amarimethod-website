import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { VERSION, ACTION_DIGEST, canonical, encode, parse, manifestSigningBytes, requestSigningBytes } from "../../follow-up-rehearsal-worker/src/protocol.mjs";
import { validateCallerConfiguration } from "../../follow-up-rehearsal-worker/src/caller-authorization.mjs";
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, FOLLOW_UP_STORAGE_ADAPTER_FLAGS } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), DAY = 86400000;
const hash = s => createHash("sha256").update(s).digest("hex"), id = s => "id_" + hash(s);
const roles = ["root", "owner", "operator", "reader", "admission", "capture", "floor", "receipt", "witness", "source"];
const pairs = Object.fromEntries(roles.map(r => [r, generateKeyPairSync("ed25519")]));
const pem = r => pairs[r].publicKey.export({ type: "spki", format: "pem" }), fingerprint = r => hash(pairs[r].publicKey.export({ type: "spki", format: "der" }));
const instances = new Set(); let serial = 0, nonce = 0, bundles, egress = 0;
function fixture() {
  const at = Date.now() - 100, name = "caller-fixture-" + ++serial;
  const scope = { accountId: id(name), targetId: id("synthetic target"), actionScopeDigest: hash("fixed synthetic action"), environment: "synthetic", sinkId: id(name + "/sink"), registryId: id(name + "/registry"), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: "a".repeat(40), actionDigest: ACTION_DIGEST, handlerDigest: hash("unchanged control"), epoch: id(name + "/epoch"), generation: 1, issuerReleaseDigest: hash("unchanged issuer"), policyVersion: "follow-up-retention-policy.v1" };
  const body = { version: VERSION, transport: "private_service_binding_rpc", scope, origin: { sourceId: id("synthetic source"), sequence: 1, originalAt: at - 1000, approvedAt: at, dispatchUntil: at + 240000 }, aliasSetDigest: hash("synthetic aliases"), replayHorizonUntil: at + 10 * DAY, retentionUntil: at + DAY - 2000, parentDeadline: at + DAY, deletionDeadline: null, issuedAt: at, expiresAt: at + 3600000, issuerSequence: 1, principals: ["owner", "operator", "reader"].map(role => ({ callerId: id("caller/" + role), keyId: id(role), publicKeySha256: fingerprint(role), role, notBefore: at, expiresAt: at + 3600000 })), signers: Object.fromEntries(roles.slice(4).map(role => [role, { keyId: id(role), publicKeySha256: fingerprint(role) }])) };
  const manifest = { body, keyId: id("root"), signature: sign(null, manifestSigningBytes(body), pairs.root.privateKey).toString("base64") };
  const callerBindings = { REHEARSAL_MANIFEST: encode(manifest), REHEARSAL_CALLER_KEYS: encode({ root: { keyId: id("root"), publicKey: pem("root") }, principals: Object.fromEntries(["owner", "operator", "reader"].map(r => [r, pem(r)])) }) };
  const bindings = role => ({ REHEARSAL_MANIFEST: encode(manifest), REHEARSAL_KEYS: encode({ root: { keyId: id("root"), publicKey: pem("root") }, publicKeys: Object.fromEntries(roles.slice(1).map(r => [r, pem(r)])), privateKeys: Object.fromEntries((role === "control" ? ["receipt", "witness"] : ["admission", "capture", "floor", "source"]).map(r => [r, pairs[r].privateKey.export({ type: "pkcs8", format: "pem" })])) }) });
  return { manifest, callerBindings, bindings };
}
function request(f, action = "execute", role = ["bootstrap", "revoke"].includes(action) ? "owner" : ["status", "result"].includes(action) ? "reader" : "operator", changes = {}) {
  const now = Date.now(), body = { version: VERSION, manifestDigest: hash(manifestSigningBytes(f.manifest.body)), scopeDigest: hash(canonical(f.manifest.body.scope)), callerId: id("caller/" + role), role, action, body: action === "revoke" ? { keyId: id("operator") } : {}, nonce: hash("caller nonce " + ++nonce), issuedAt: now - 1, expiresAt: now + 29999, ...changes };
  return encode({ body, keyId: id(role), signature: sign(null, requestSigningBytes(body), pairs[role].privateKey).toString("base64") });
}
const BRIDGE = `export default {async fetch(req,env){const p=new URL(req.url).pathname;if(p==='/public')return env.PUBLIC.fetch(req);if(p==='/peek')return Response.json(await env.CONTROL.peek());if(p==='/mode')return Response.json(await env.CONTROL.mode(await req.text()));return new Response(await env.CALLER.invoke(await req.text()));}};`;
// Fault control is test-only; caller itself is always the exact unwrapped bundle.
const FAKE_CONTROL = `
import {WorkerEntrypoint} from 'cloudflare:workers';
let calls=0,last=null,mode='normal';
export class FollowUpRehearsalControl extends WorkerEntrypoint {
 mode(value){mode=value;return true;}
 peek(){return {calls,last};}
 async invoke(text){
  calls++;last=text;
  if(mode==='lost')throw Error('synthetic lost reply');
  if(mode==='late')await new Promise(r=>setTimeout(r,100));
  if(mode==='hang')await new Promise(()=>{});
  if(mode==='oversize')return 'x'.repeat(17000);
  if(mode==='badjson')return '{}';
  if(mode==='unknown')return '{"contract":"follow-up-private-rehearsal.v1","requiresReadOnlyReconciliation":false,"status":"unexpected"}';
  if(mode==='falseproof')return '{"contract":"follow-up-private-rehearsal.v1","requiresReadOnlyReconciliation":false,"status":"captured"}';
  if(mode.startsWith('reply:'))return mode.slice(6);
  return '{"contract":"follow-up-private-rehearsal.v1","requiresReadOnlyReconciliation":false,"status":"refused"}';
 }
}
export default {fetch(){return new Response('Not found',{status:404});}};
`;
beforeAll(async () => {
  bundles = {};
  for (const role of ["caller", "control", "issuer"]) {
    const built = await build({ absWorkingDir: ROOT, entryPoints: [`follow-up-rehearsal-worker/src/${role}.mjs`], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers", "node:crypto"], logLevel: "silent", sourcemap: false, minify: false });
    expect(built.warnings).toEqual([]); expect(built.outputFiles).toHaveLength(1); bundles[role] = built.outputFiles[0].text;
  }
});
afterEach(async () => { const active = [...instances]; instances.clear(); for (const mf of active) await mf.dispose(); expect(egress).toBe(0); });
async function start(f = fixture(), { real = false, callerBindings = {} } = {}) {
  const base = { modules: true, compatibilityDate: "2026-08-27", compatibilityFlags: ["nodejs_compat"], outboundService: () => { egress++; return new Response("forbidden", { status: 403 }); } };
  const workers = [
    { ...base, name: "bridge", script: BRIDGE, serviceBindings: { CALLER: { name: "caller", entrypoint: "FollowUpRehearsalCaller" }, PUBLIC: "caller", CONTROL: { name: "control", entrypoint: "FollowUpRehearsalControl" } } },
    { ...base, name: "caller", script: bundles.caller, bindings: { ...f.callerBindings, ...callerBindings }, serviceBindings: { CONTROL: { name: "control", entrypoint: "FollowUpRehearsalControl" } } },
    real ? { ...base, name: "control", script: bundles.control, bindings: f.bindings("control"), durableObjects: { REGISTRY: { className: "FollowUpRehearsalRegistryV1", useSQLite: true } }, r2Buckets: ["CAPTURE_BUCKET"], serviceBindings: { ISSUER: { name: "issuer", entrypoint: "FollowUpRehearsalIssuer" } } } : { ...base, name: "control", script: FAKE_CONTROL }
  ];
  if (real) workers.push({ ...base, name: "issuer", script: bundles.issuer, bindings: f.bindings("issuer") });
  const options = convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers });
  // V4 conversion drops limits. Pass the actual release settings explicitly to
  // the V5 worker config; accepting these is not Cloudflare billing enforcement.
  for (const worker of options.workers) if (["caller", "control", "issuer"].includes(worker.config.name)) {
    const config = JSON.parse(readFileSync(join(ROOT, `follow-up-rehearsal-worker/wrangler.${worker.config.name}.jsonc`), "utf8"));
    worker.config.limits = { cpuMs: config.limits.cpu_ms, subrequests: config.limits.subrequests };
    worker.config.workersDev = config.workers_dev; worker.config.previewUrls = config.preview_urls; worker.config.observability = config.observability;
  }
  const mf = new Miniflare(options); instances.add(mf);
  try { await mf.ready; } catch (error) { instances.delete(mf); try { await mf.dispose(); } catch {} throw error; }
  const post = (path, body = "") => mf.dispatchFetch("http://localhost" + path, { method: "POST", body });
  return { f, post, call: async text => (await post("/", text)).json(), peek: async () => (await post("/peek")).json(), mode: async mode => (await post("/mode", mode)).json() };
}

describe("public-only private rehearsal caller", () => {
  it("executes exact caller→control→DO→issuer release bundles on native SQLite/R2", async () => {
    const s = await start(fixture(), { real: true });
    expect(await s.call(request(s.f, "bootstrap"))).toMatchObject({ status: "initialized", counter: 0 });
    expect(await s.call(request(s.f, "admit"))).toMatchObject({ status: "admitted", counter: 0 });
    const result = await s.call(request(s.f, "execute")); expect(result).toMatchObject({ status: "captured", counter: 1, metrics: { nativeCalls: 50, issuer: 2 }, productionAuthority: false });
    expect(result.metrics.nativeCalls + 2).toBe(52); // DO work + control→DO + caller→control; external ingress excluded.
    expect(await s.call(request(s.f, "result"))).toMatchObject({ counter: 1, metrics: { transactions: 0, put: 0 } });
    expect(await s.call(request(s.f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: false, reasonCode: "already_consumed" } });
  });
  it("forwards original signed bytes exactly once without nonce or deadline changes", async () => { const s = await start(), text = request(s.f); expect((await s.call(text)).status).toBe("refused"); expect(await s.peek()).toEqual({ calls: 1, last: text }); });
  it("actual default HTTP entrypoint never forwards", async () => { const s = await start(); expect((await s.post("/public", request(s.f))).status).toBe(404); expect(await s.peek()).toEqual({ calls: 0, last: null }); });
  it.each([["execute", "reader"], ["bootstrap", "operator"], ["admit", "owner"], ["revoke", "reader"]])("rejects correctly signed wrong role %s/%s before forward", async (action, role) => { const s = await start(); expect((await s.call(request(s.f, action, role))).status).toBe("refused"); expect((await s.peek()).calls).toBe(0); });
  it.each(["signature", "scope", "manifest", "expiry", "future", "unknown", "oversize", "duplicate", "noncanonical"])("rejects %s without forwarding", async kind => {
    const s = await start(), value = parse(request(s.f)); let text;
    if (kind === "signature") value.signature = "A".repeat(86) + "==";
    if (kind === "scope") value.body.scopeDigest = hash("other"); if (kind === "manifest") value.body.manifestDigest = hash("other");
    if (kind === "expiry") { value.body.issuedAt = Date.now() - 30000; value.body.expiresAt = Date.now() - 1; }
    if (kind === "future") { value.body.issuedAt = Date.now() + 10000; value.body.expiresAt = Date.now() + 20000; }
    if (kind === "unknown") value.body.action = "retry";
    if (kind === "oversize") text = "x".repeat(17000); if (kind === "duplicate") text = '{"body":1,"body":2}'; if (kind === "noncanonical") text = JSON.stringify(value, null, 2);
    if (!["signature", "oversize", "duplicate", "noncanonical"].includes(kind)) value.signature = sign(null, Buffer.from("amari/private-rehearsal-request/v1\n" + canonical(value.body)), pairs.operator.privateKey).toString("base64");
    expect((await s.call(text ?? encode(value))).status).toBe("refused"); expect((await s.peek()).calls).toBe(0);
  });
  it.each(["lost", "oversize", "badjson", "unknown", "falseproof"])("%s control reply is indeterminate with no retry", async mode => { const s = await start(); await s.mode(mode); expect(await s.call(request(s.f))).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect((await s.peek()).calls).toBe(1); });
  it.each(["foundation", "gate", "nested_receipt"])("rejects contradictory %s authority claims", async kind => {
    const s = await start(), result = { contract: VERSION, schemaDigest: hash("synthetic schema"), status: "captured", requiresReadOnlyReconciliation: true, counter: 1, metrics: {}, productionAuthority: false, foundationClaims: { ...FOLLOW_UP_STORAGE_ADAPTER_FLAGS }, gate: { contract: "follow-up-evidence-admission-gate.v1", status: "captured", ...FOLLOW_UP_STORAGE_ADAPTER_FLAGS } };
    if (kind === "foundation") result.foundationClaims.authority = true;
    if (kind === "gate") result.gate.providerOutcomeProven = true;
    if (kind === "nested_receipt") result.gate.captureReceipt = { exactlyOnceProven: true };
    await s.mode("reply:" + encode(result)); expect(await s.call(request(s.f))).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect((await s.peek()).calls).toBe(1);
  });
  it("expiry during remote wait returns indeterminate without resetting deadline", async () => { const s = await start(); await s.mode("late"); const now = Date.now(), text = request(s.f, "execute", "operator", { issuedAt: now - 1, expiresAt: now + 50 }); expect(await s.call(text)).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect(await s.peek()).toEqual({ calls: 1, last: text }); });
  it("a hanging remote call is bounded by original signed expiry", async () => { const s = await start(); await s.mode("hang"); const now = Date.now(), text = request(s.f, "execute", "operator", { issuedAt: now - 1, expiresAt: now + 100 }); expect(await s.call(text)).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect((await s.peek()).calls).toBe(1); });
  it.each(["root", "principal", "private_pem", "extra", "missing", "legacy_private", "manifest_signature", "production", "schema"])("invalid %s configuration fails before forward", async kind => {
    const f = fixture(), env = { ...f.callerBindings }, keyset = parse(env.REHEARSAL_CALLER_KEYS), manifest = parse(env.REHEARSAL_MANIFEST);
    if (kind === "root") keyset.root.publicKey = pem("reader"); if (kind === "principal") keyset.principals.operator = pem("reader");
    if (kind === "private_pem") keyset.principals.operator = pairs.operator.privateKey.export({ type: "pkcs8", format: "pem" });
    if (kind === "extra") keyset.privateKeys = {}; if (kind === "missing") delete keyset.principals.reader;
    if (kind === "legacy_private") env.REHEARSAL_KEYS = "{}";
    if (kind === "manifest_signature") manifest.signature = "A".repeat(86) + "==";
    if (kind === "production") manifest.body.scope.environment = "production"; if (kind === "schema") manifest.body.scope.schemaDigest = hash("other");
    env.REHEARSAL_CALLER_KEYS = encode(keyset); env.REHEARSAL_MANIFEST = encode(manifest);
    expect(() => validateCallerConfiguration(env)).toThrow(); const s = await start(f, { callerBindings: env }); expect((await s.call(request(f))).status).toBe("refused"); expect((await s.peek()).calls).toBe(0);
  });
  it("rejects noncanonical configuration and unexpected key algorithms", () => { const f = fixture(), env = f.callerBindings; expect(() => validateCallerConfiguration({ ...env, REHEARSAL_CALLER_KEYS: JSON.stringify(parse(env.REHEARSAL_CALLER_KEYS), null, 2) })).toThrow(); const keys = parse(env.REHEARSAL_CALLER_KEYS); keys.root.publicKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }); expect(() => validateCallerConfiguration({ ...env, REHEARSAL_CALLER_KEYS: encode(keys) })).toThrow(); });
  it("has no signing capability, storage, public trigger, automatic invocation or runtime source edits", () => {
    // Frozen imports may retain unused crypto names; no signing/key-generation
    // call path survives bundling and no private PEM is accepted by the relay.
    expect(bundles.caller).not.toMatch(/\b(?:createPrivateKey|randomBytes|sign)\d*\s*\(/);
    const c = JSON.parse(readFileSync(join(ROOT, "follow-up-rehearsal-worker/wrangler.caller.jsonc"), "utf8")); expect(c).toMatchObject({ workers_dev: false, preview_urls: false, routes: [], limits: { subrequests: 1 } });
    expect(Object.keys(c).sort()).toEqual(["name", "main", "account_id", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "routes", "observability", "send_metrics", "keep_vars", "limits", "services"].sort());
    for (const [file, expected] of [["follow-up-rehearsal-worker/src/control.mjs", "4f1db560b89aa5a048fcb587d6a8512ff827b4917c3dbdd769ad87fe1834ffd8"], ["follow-up-rehearsal-worker/src/issuer.mjs", "6d79884633b491237cfc212b900eaeebbde44ddb1da0264c3ace4e6dd203e802"], ["follow-up-rehearsal-worker/src/protocol.mjs", "7930f63d7ba5f4b42c9471010cd09520a12186e6914cd8676b604c597f6d37da"]]) expect(hash(readFileSync(join(ROOT, file)))).toBe(expected);
  });
});
