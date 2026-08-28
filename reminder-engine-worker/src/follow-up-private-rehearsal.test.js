import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { VERSION, ACTION_DIGEST, canonical, encode, manifestSigningBytes, requestSigningBytes, configuration, parse } from "../../follow-up-rehearsal-worker/src/protocol.mjs";
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), DAY = 86400000;
const hash = x => createHash("sha256").update(x).digest("hex"), id = x => "id_" + hash(x);
const roles = ["root", "owner", "operator", "reader", "admission", "capture", "floor", "receipt", "witness", "source"];
const keys = Object.fromEntries(roles.map(r => [r, generateKeyPairSync("ed25519")]));
const fingerprint = k => hash(k.export({ type: "spki", format: "der" }));
let sequence = 0, nonce = 0, scripts, egress = 0;
const instances = new Set(), directories = [];
function fixture() {
  const now = Date.now() - 100, name = "private-native-" + ++sequence;
  const scope = { accountId: id(name), targetId: id("synthetic target"), actionScopeDigest: hash("fixed counter"), environment: "synthetic", sinkId: id("sink/" + name), registryId: id("registry/" + name), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: "a".repeat(40), actionDigest: ACTION_DIGEST, handlerDigest: hash("control source"), epoch: id("epoch/" + name), generation: 1, issuerReleaseDigest: hash("issuer source"), policyVersion: "follow-up-retention-policy.v1" };
  const body = { version: VERSION, transport: "private_service_binding_rpc", scope, origin: { sourceId: id("synthetic immutable origin"), sequence: 10, originalAt: now - 1000, approvedAt: now, dispatchUntil: now + 240000 }, aliasSetDigest: hash("synthetic aliases"), replayHorizonUntil: now + 10 * DAY, retentionUntil: now + DAY - 2000, parentDeadline: now + DAY, deletionDeadline: null, issuedAt: now, expiresAt: now + 3600000, issuerSequence: 10, principals: ["owner", "operator", "reader"].map(role => ({ callerId: id("caller/" + role), keyId: id(role), publicKeySha256: fingerprint(keys[role].publicKey), role, notBefore: now, expiresAt: now + 3600000 })), signers: Object.fromEntries(roles.slice(4).map(role => [role, { keyId: id(role), publicKeySha256: fingerprint(keys[role].publicKey) }])) };
  const manifest = { body, keyId: id("root"), signature: sign(null, manifestSigningBytes(body), keys.root.privateKey).toString("base64") };
  const bindings = location => ({ REHEARSAL_MANIFEST: encode(manifest), REHEARSAL_KEYS: encode({ root: { keyId: id("root"), publicKey: keys.root.publicKey.export({ type: "spki", format: "pem" }) }, publicKeys: Object.fromEntries(roles.slice(1).map(role => [role, keys[role].publicKey.export({ type: "spki", format: "pem" })])), privateKeys: Object.fromEntries((location === "control" ? ["receipt", "witness"] : ["admission", "capture", "floor", "source"]).map(role => [role, keys[role].privateKey.export({ type: "pkcs8", format: "pem" })])) }) });
  return { manifest, bindings, scopeDigest: hash(canonical(scope)) };
}
function request(f, action, role = ["bootstrap", "revoke"].includes(action) ? "owner" : ["status", "result"].includes(action) ? "reader" : "operator", change = {}) {
  const now = Date.now(), body = { version: VERSION, manifestDigest: hash(manifestSigningBytes(f.manifest.body)), scopeDigest: f.scopeDigest, callerId: id("caller/" + role), role, action, body: action === "revoke" ? { keyId: id("operator") } : {}, nonce: hash("request/" + ++nonce), issuedAt: now - 1, expiresAt: now + 29999, ...change };
  return { body, keyId: id(role), signature: sign(null, requestSigningBytes(body), keys[role].privateKey).toString("base64") };
}
// Test-only diagnostic and fault capabilities never ship in the actual sources.
const CONTROL_TEST = `
import {FollowUpRehearsalRegistryV1 as Registry,FollowUpRehearsalControl as Control} from './follow-up-rehearsal-worker/src/control.mjs';
import {encode} from './follow-up-rehearsal-worker/src/protocol.mjs';
let lookups=0,transportFault=false;
export class FollowUpRehearsalControl extends Control {
 constructor(ctx,env){super(ctx,{...env,REGISTRY:{idFromName(name){lookups++;return env.REGISTRY.idFromName(name);},get(id){const stub=env.REGISTRY.get(id);return {async invoke(text){const result=await stub.invoke(text);if(transportFault)throw Error('synthetic lost transport ACK');return result;}};}}});}
 inspectLookups(){return lookups;}
 transportFault(value){transportFault=value;return true;}
}
export class FollowUpRehearsalRegistryV1 extends Registry {
 constructor(ctx,env){const faults={kind:null,revocation:null};let self;const native=env.CAPTURE_BUCKET,issuer=env.ISSUER;super(ctx,{...env,CAPTURE_BUCKET:{list:o=>native.list(o),async get(k){const object=await native.get(k);if(faults.kind==='revoke_on_claim'&&k.endsWith('/claim')){faults.kind=null;await self.invoke(faults.revocation);}if(faults.kind==='corrupt_head'&&k.endsWith('/head')&&object)return {size:object.size,etag:object.etag,body:new Response('corrupt').body};return object;},async put(k,v,o){const out=await native.put(k,v,o);if(faults.kind==='lost_put')throw Error('synthetic lost ACK');return out;}},ISSUER:{async issue(...args){if(faults.kind==='issuer_down')throw Error('synthetic unavailable');if(faults.kind==='late_issuer')await new Promise(r=>setTimeout(r,2200));if(faults.kind==='invalid_issued'){const value=JSON.parse(await issuer.issue(...args));value.signature='A'.repeat(86)+'==';return encode(value);}return issuer.issue(...args);}}});self=this;this.faults=faults;}
 fault(kind){this.faults.kind=kind;return true;}
 revocation(text){this.faults.revocation=text;this.faults.kind='revoke_on_claim';return true;}
 inspect(){const catalog=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name NOT IN ('_cf_KV') ORDER BY name").toArray().map(r=>r.name);const rows=t=>catalog.includes(t)?this.ctx.storage.sql.exec('SELECT * FROM '+t+' LIMIT 64').toArray():[];return {catalog,session:rows('fur_session'),nonces:rows('fur_nonces'),effects:rows('fur_effects'),entries:rows('fue_registry_entries')};}
 occupy(){this.ctx.storage.sql.exec('CREATE TABLE unrelated (id INTEGER)');return true;}
}
export {default} from './follow-up-rehearsal-worker/src/control.mjs';
`;
const BRIDGE = `export default {async fetch(req,env){const p=new URL(req.url).pathname;if(p==='/control-public')return env.PUBLIC.fetch(req);if(p==='/issuer-public')return env.ISSUER_PUBLIC.fetch(req);const text=await req.text();if(p==='/issuer')return new Response(await env.ISSUER.issue(text));if(p==='/lookups')return Response.json(await env.CONTROL.inspectLookups());if(p==='/transport-fault')return Response.json(await env.CONTROL.transportFault(text==='true'));if(p!=='/'){const stub=env.REGISTRY.get(env.REGISTRY.idFromName(env.SCOPE));if(p==='/do-public')return stub.fetch(new Request(req.url));if(p==='/inspect')return Response.json(await stub.inspect());if(p==='/fault')return Response.json(await stub.fault(text));if(p==='/revoke-on-claim')return Response.json(await stub.revocation(text));if(p==='/occupy')return Response.json(await stub.occupy());}return new Response(await env.CONTROL.invoke(text));}};`;
beforeAll(async () => {
  async function bundle(contents, sourcefile) { return (await build({ stdin: { contents, resolveDir: ROOT, sourcefile }, bundle: true, write: false, format: "esm", platform: "node", target: "es2022", external: ["node:crypto", "cloudflare:workers"] })).outputFiles[0].text; }
  scripts = { control: await bundle(CONTROL_TEST, "synthetic-private-control.mjs"), issuer: await bundle("export * from './follow-up-rehearsal-worker/src/issuer.mjs';export {default} from './follow-up-rehearsal-worker/src/issuer.mjs';", "synthetic-private-issuer.mjs") };
  // Same real entrypoints and build options as the release preparation guard.
  for (const role of ["control", "issuer"]) {
    const result = await build({ absWorkingDir: ROOT, entryPoints: [`follow-up-rehearsal-worker/src/${role}.mjs`], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", target: "es2022", external: ["node:crypto", "cloudflare:workers"], logLevel: "silent", sourcemap: false, minify: false });
    expect(result.warnings).toEqual([]); expect(result.outputFiles).toHaveLength(1); scripts[role + "Release"] = result.outputFiles[0].text;
  }
});
afterEach(async () => { for (const mf of instances) await mf.dispose(); instances.clear(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); expect(egress).toBe(0); });
async function start(f = fixture(), persist, overrides = {}) {
  const base = { modules: true, compatibilityDate: "2026-08-27", compatibilityFlags: ["nodejs_compat"], outboundService: () => { egress++; return new Response("forbidden", { status: 403 }); } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
    { ...base, name: "bridge", script: BRIDGE, bindings: { SCOPE: f.scopeDigest }, serviceBindings: { CONTROL: { name: "control", entrypoint: "FollowUpRehearsalControl" }, PUBLIC: "control", ISSUER: { name: "issuer", entrypoint: "FollowUpRehearsalIssuer" }, ISSUER_PUBLIC: "issuer" }, durableObjects: { REGISTRY: { className: "FollowUpRehearsalRegistryV1", scriptName: "control", useSQLite: true } } },
    { ...base, name: "control", script: overrides.raw ? scripts.controlRelease : scripts.control, bindings: { ...f.bindings("control"), ...overrides.control }, durableObjects: { REGISTRY: { className: "FollowUpRehearsalRegistryV1", useSQLite: true } }, r2Buckets: ["CAPTURE_BUCKET"], serviceBindings: { ISSUER: { name: "issuer", entrypoint: "FollowUpRehearsalIssuer" } } },
    { ...base, name: "issuer", script: overrides.raw ? scripts.issuerRelease : scripts.issuer, bindings: { ...f.bindings("issuer"), ...overrides.issuer } }
  ] }), ...(persist ? { resourcePersistencePath: persist } : {}) }); instances.add(mf); await mf.ready;
  const post = (path, body = "") => mf.dispatchFetch("http://localhost" + path, { method: "POST", body });
  return { f, mf, call: async r => (await post("/", typeof r === "string" ? r : encode(r))).json(), inspect: async () => (await post("/inspect")).json(), fault: async kind => (await post("/fault", kind)).json(), post, async dispose() { await mf.dispose(); instances.delete(mf); } };
}
async function boot(f, persist) { const s = await start(f, persist); expect(await s.call(request(s.f, "bootstrap"))).toMatchObject({ status: "initialized", counter: 0 }); return s; }

describe("private synthetic Worker service-binding transport", () => {
  it("runs unwrapped exact release entrypoint bundles through native service bindings", async () => {
    const s = await start(fixture(), undefined, { raw: true });
    expect(await s.call(request(s.f, "bootstrap"))).toMatchObject({ status: "initialized", counter: 0 });
    expect(await s.call(request(s.f, "admit"))).toMatchObject({ status: "admitted", counter: 0 });
    expect(await s.call(request(s.f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: true } });
    expect(await s.call(request(s.f, "result"))).toMatchObject({ counter: 1, metrics: { put: 0, transactions: 0 }, productionAuthority: false });
    expect(await s.call(request(s.f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: false, reasonCode: "already_consumed" } });
  });
  it("uses real control→DO→issuer RPC and native SQLite/R2 for one fixed effect", async () => {
    const s = await boot(); expect(await s.call(request(s.f, "admit"))).toMatchObject({ status: "admitted", counter: 0 });
    const run = await s.call(request(s.f, "execute")); expect(run).toMatchObject({ counter: 1, gate: { actionAttempted: true } }); expect(run.metrics.issuer).toBeGreaterThan(0); expect(run.metrics.nativeCalls).toBeLessThanOrEqual(63); expect(run.metrics.nativeCalls + 1).toBeLessThanOrEqual(64); expect(run.metrics.sql).toBeLessThanOrEqual(256);
    expect(run.metrics).toMatchObject({ get: 13, issuer: 2, kv: 0, list: 0, nativeCalls: 50, put: 5, sql: 104, streamReads: 26, sync: 4, transactions: 4 }); expect(run.metrics.bytes).toBeLessThanOrEqual(524288);
    const before = await s.inspect(), result = await s.call(request(s.f, "result")); expect(result.counter).toBe(1); expect(result.metrics.put).toBe(0); expect(result.metrics.transactions).toBe(0); expect(await s.inspect()).toEqual(before);
    expect(await s.call(request(s.f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: false, reasonCode: "already_consumed" } });
  });
  it("two independently signed requests race to one durable effect", async () => { const s = await boot(); await s.call(request(s.f, "admit")); const results = await Promise.all([s.call(request(s.f, "execute")), s.call(request(s.f, "execute"))]); expect(results.filter(r => r.gate?.actionAttempted)).toHaveLength(1); expect((await s.inspect()).effects).toHaveLength(1); });
  it("retains CONSUMED and mutation nonces across actual disposal/reopen", async () => { const dir = mkdtempSync(join(tmpdir(), "private-rehearsal-native-")); directories.push(dir); const f = fixture(), s = await boot(f, dir); const admission = request(f, "admit"); await s.call(admission); await s.call(request(f, "execute")); await s.dispose(); const reopened = await start(f, dir); expect(await reopened.call(request(f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: false } }); expect((await reopened.call(admission)).status).toBe("indeterminate"); expect((await reopened.inspect()).effects).toHaveLength(1); });
  it("denies public fetch on both actual Worker exports and DO", async () => { const s = await start(); expect((await s.post("/control-public")).status).toBe(404); expect((await s.post("/issuer-public")).status).toBe(404); expect((await s.post("/do-public")).status).toBe(404); expect((await s.inspect()).catalog).toEqual([]); });
  it.each([["execute", "reader"], ["bootstrap", "operator"], ["admit", "owner"], ["revoke", "reader"]])("rejects %s/%s before any schema installation", async (action, role) => { const s = await start(); expect((await s.call(request(s.f, action, role))).status).toBe("refused"); expect((await s.inspect()).catalog).toEqual([]); });
  it.each(["signature", "scope", "manifest", "caller", "expired", "future", "extra", "oversize", "json_duplicate", "object"])("rejects hostile %s input", async kind => {
    const s = await start(), r = request(s.f, "bootstrap"); let raw;
    if (kind === "signature") r.signature = "A".repeat(86) + "==";
    if (kind === "scope") r.body.scopeDigest = hash("other"); if (kind === "manifest") r.body.manifestDigest = hash("other"); if (kind === "caller") r.body.callerId = id("other");
    if (kind === "expired") { r.body.issuedAt = Date.now() - 30000; r.body.expiresAt = Date.now() - 1; } if (kind === "future") { r.body.issuedAt = Date.now() + 10000; r.body.expiresAt = Date.now() + 20000; }
    if (kind === "extra") r.body.body = { sql: "SELECT *" }; if (kind === "oversize") raw = "x".repeat(17000); if (kind === "json_duplicate") raw = '{"body":1,"body":2}'; if (kind === "object") raw = "null";
    if (!["signature", "oversize", "json_duplicate", "object"].includes(kind)) r.signature = sign(null, Buffer.from("amari/private-rehearsal-request/v1\n" + canonical(r.body)), keys.owner.privateKey).toString("base64");
    expect((await s.call(raw ?? encode(r))).status).toBe("refused"); expect(await (await s.post("/lookups")).json()).toBe(0); expect((await s.inspect()).catalog).toEqual([]);
  });
  it("revokes a concrete principal before effect and future reads", async () => { const s = await boot(); await s.call(request(s.f, "admit")); expect((await s.call(request(s.f, "revoke"))).status).toBe("revoked"); const before = await s.inspect(); for (const action of ["execute", "status", "result"]) expect((await s.call(request(s.f, action, "operator"))).status).toBe("refused"); expect(await s.inspect()).toEqual(before); });
  it("issuer outage cannot admit or act and read-only status remains available", async () => { const s = await boot(); await s.fault("issuer_down"); const result = await s.call(request(s.f, "admit")); expect(result.gate?.actionAttempted ?? false).toBe(false); expect((await s.inspect()).effects).toEqual([]); expect((await s.call(request(s.f, "status"))).status).toBe("initialized"); });
  it("issuer outage after admission cannot execute", async () => { const s = await boot(); expect((await s.call(request(s.f, "admit"))).status).toBe("admitted"); await s.fault("issuer_down"); const result = await s.call(request(s.f, "execute")); expect(result.gate?.actionAttempted ?? false).toBe(false); expect((await s.inspect()).effects).toEqual([]); });
  it("revocation during native claim await denies the actual effect", async () => { const s = await boot(); await s.call(request(s.f, "admit")); await s.post("/revoke-on-claim", encode(request(s.f, "revoke"))); const result = await s.call(request(s.f, "execute")); expect(result.gate?.actionAttempted ?? false).toBe(false); expect((await s.inspect()).effects).toEqual([]); expect((await s.inspect()).nonces.some(n => n.action === "revoke")).toBe(true); });
  it("lost DO transport reply classifies unknown and never repeats the effect", async () => { const s = await boot(); await s.call(request(s.f, "admit")); await s.post("/transport-fault", "true"); expect(await s.call(request(s.f, "execute"))).toMatchObject({ status: "indeterminate", requiresReadOnlyReconciliation: true }); expect((await s.inspect()).effects).toHaveLength(1); await s.post("/transport-fault", "false"); expect(await s.call(request(s.f, "execute"))).toMatchObject({ counter: 1, gate: { actionAttempted: false } }); });
  it("corrupt genesis readback cannot activate bootstrap", async () => { const s = await start(); await s.fault("corrupt_head"); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("indeterminate"); expect((await s.inspect()).session[0].phase).toBe("pending"); });
  it("mismatched issuer manifest denies bootstrap before schema allocation", async () => { const f = fixture(), other = fixture(), s = await start(f, undefined, { issuer: other.bindings("issuer") }); expect((await s.call(request(f, "bootstrap"))).status).toBe("refused"); expect((await s.inspect()).catalog).toEqual([]); });
  it("well-formed but invalid issuer signature cannot initialize storage", async () => { const s = await start(); await s.fault("invalid_issued"); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("refused"); expect((await s.inspect()).catalog).toEqual([]); });
  it("late remote issuer cannot initialize after timeout", async () => { const s = await start(); await s.fault("late_issuer"); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("refused"); await new Promise(r => setTimeout(r, 300)); expect((await s.inspect()).catalog).toEqual([]); }, 10000);
  it("lost R2 acknowledgement leaves pending and cannot resume", async () => { const s = await start(); await s.fault("lost_put"); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("indeterminate"); await s.fault(null); expect(await s.call(request(s.f, "status"))).toMatchObject({ status: "indeterminate", bootstrap: "pending", requiresReadOnlyReconciliation: true }); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("refused"); expect((await s.inspect()).effects).toEqual([]); });
  it("never overwrites a nonempty SQLite namespace", async () => { const s = await start(); await s.post("/occupy"); const before = await s.inspect(); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("refused"); expect(await s.inspect()).toEqual(before); });
  it.each(["REHEARSAL_MANIFEST", "REHEARSAL_KEYS"])("missing %s fails closed", async field => { const s = await start(fixture(), undefined, { control: { [field]: "" } }); expect((await s.call(request(s.f, "bootstrap"))).status).toBe("refused"); expect((await s.inspect()).catalog).toEqual([]); });
  it("issuer refuses invalid signatures independently of control", async () => { const s = await start(), r = request(s.f, "admit"); r.signature = "A".repeat(86) + "=="; expect(await (await s.post("/issuer", encode(r))).json()).toEqual({ status: "refused" }); });
});

describe("private protocol static boundaries", () => {
  it("separates signing keys and rejects extra/mismatched key authority", () => { const f = fixture(), env = f.bindings("control"), k = parse(env.REHEARSAL_KEYS); expect(() => configuration(env, "control")).not.toThrow(); k.privateKeys.admission = keys.admission.privateKey.export({ type: "pkcs8", format: "pem" }); expect(() => configuration({ ...env, REHEARSAL_KEYS: encode(k) }, "control")).toThrow(); });
  it("rejects production, unbounded sessions and reused roles", () => { const f = fixture(); for (const mutate of [m => { m.scope.environment = "production"; }, m => { m.expiresAt += 1; }, m => { m.signers.floor = m.signers.source; }]) { const m = JSON.parse(JSON.stringify(f.manifest.body)); mutate(m); expect(() => manifestSigningBytes(m)).toThrow(); } });
  it("ships no generic effect, offline facade, secret material or public triggers", () => { for (const file of ["control", "issuer", "protocol"]) { const source = readFileSync(join(ROOT, `follow-up-rehearsal-worker/src/${file}.mjs`), "utf8"); expect(source).not.toMatch(/follow-up-evidence-rehearsal-runtime|console\.|https?:\/\/|node:(fs|child_process)|executeAction\s*:\s*config/); } for (const file of ["control", "issuer"]) { const c = JSON.parse(readFileSync(join(ROOT, `follow-up-rehearsal-worker/wrangler.${file}.jsonc`), "utf8")); expect(c).toMatchObject({ workers_dev: false, preview_urls: false, routes: [], observability: { enabled: false } }); expect(c.triggers).toBeUndefined(); expect(c.vars).toBeUndefined(); expect(c.d1_databases).toBeUndefined(); expect(c.kv_namespaces).toBeUndefined(); } });
});
