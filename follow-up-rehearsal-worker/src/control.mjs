import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createFollowUpEvidenceAdmissionGate } from "../../scripts/lib/follow-up-evidence-admission-gate.mjs";
import { createFollowUpEvidenceRegistryAdapter, createFollowUpEvidenceWitnessAdapter, createFollowUpEvidenceCaptureBucket, FOLLOW_UP_REGISTRY_SCHEMA, FOLLOW_UP_STORAGE_ADAPTER_FLAGS, followUpWitnessSigningBytes } from "../../scripts/lib/follow-up-evidence-storage-adapters.mjs";
import { VERSION, MAX, WAIT_MS, OPERATION_MS, configuration, authenticate, validateIssued, encode, parse, signed, need, integer, hash, canonical } from "./protocol.mjs";

// Neither HTTP entrypoint exposes the service. Authentication precedes DO
// selection and is repeated in the DO; a service binding alone is not authority.
export class FollowUpRehearsalControl extends WorkerEntrypoint {
  async invoke(text) {
    let forwarded = false, timer;
    try {
      const c = configuration(this.env, "control"), a = authenticate(c, text); a.fresh();
      const id = this.env.REGISTRY.idFromName(c.scopeDigest);
      const stub = this.env.REGISTRY.get(id); a.fresh(); forwarded = true;
      // Timeout abandons observation, not remote execution. Reconcile read-only.
      const response = await Promise.race([stub.invoke(text), new Promise((_, reject) => { timer = setTimeout(() => reject(new TypeError("private_rehearsal_refused")), OPERATION_MS + WAIT_MS); })]);
      return encode(parse(response));
    } catch { return encode({ contract: VERSION, status: forwarded ? "indeterminate" : "refused", requiresReadOnlyReconciliation: forwarded }); }
    finally { clearTimeout(timer); }
  }
}

const OWN = [
  "CREATE TABLE fur_session (id INTEGER PRIMARY KEY CHECK(id=1), manifest TEXT NOT NULL, request TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('pending','active')))",
  "CREATE TABLE fur_nonces (nonce TEXT PRIMARY KEY NOT NULL, digest TEXT NOT NULL, action TEXT NOT NULL, target TEXT)",
  "CREATE TABLE fur_effects (business_key TEXT PRIMARY KEY NOT NULL, manifest_digest TEXT NOT NULL, at INTEGER NOT NULL)",
  ...["fur_session", "fur_nonces", "fur_effects"].flatMap(t => [
    `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'immutable'); END`,
    `CREATE TRIGGER ${t}_no_replace BEFORE INSERT ON ${t} WHEN EXISTS(SELECT 1 FROM ${t} WHERE ${t === "fur_session" ? "id=NEW.id" : t === "fur_nonces" ? "nonce=NEW.nonce" : "business_key=NEW.business_key"}) BEGIN SELECT RAISE(ABORT,'immutable'); END`
  ]),
  "CREATE TRIGGER fur_session_activate BEFORE UPDATE ON fur_session WHEN OLD.phase<>'pending' OR NEW.phase<>'active' OR NEW.id<>OLD.id OR NEW.manifest<>OLD.manifest OR NEW.request<>OLD.request BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fur_nonces_no_update BEFORE UPDATE ON fur_nonces BEGIN SELECT RAISE(ABORT,'immutable'); END",
  "CREATE TRIGGER fur_effects_no_update BEFORE UPDATE ON fur_effects BEGIN SELECT RAISE(ABORT,'immutable'); END"
];
const DDL = [...FOLLOW_UP_REGISTRY_SCHEMA, ...OWN];
const CATALOG = [...DDL.map(sql => { const [, type, name] = /^CREATE (TABLE|TRIGGER) (\w+)/.exec(sql); return { type: type.toLowerCase(), name, tbl_name: type === "TABLE" ? name : / ON (\w+)/.exec(sql)[1], sql }; }), ...["fue_registry_entries", "fue_registry_receipts", "fur_nonces", "fur_effects"].map(t => ({ type: "index", name: `sqlite_autoindex_${t}_1`, tbl_name: t, sql: null }))].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
const PRIVATE_SCHEMA_DIGEST = hash(canonical(CATALOG));
const CATALOG_SQL = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT IN ('sqlite_sequence','_cf_KV') ORDER BY type,name LIMIT 65";
const cancel = reader => { try { void Promise.resolve(reader?.cancel()).catch(() => {}); } catch {} };

export class FollowUpRehearsalRegistryV1 extends DurableObject {
  async invoke(text) {
    let active = true, mutated = false, timer;
    const started = performance.now(), readers = new Set();
    const metrics = { sql: 0, transactions: 0, sync: 0, get: 0, put: 0, list: 0, kv: 0, issuer: 0, streamReads: 0, bytes: 0, nativeCalls: 0 };
    let config, a;
    const output = extra => encode({ contract: VERSION, schemaDigest: PRIVATE_SCHEMA_DIGEST, status: "refused", requiresReadOnlyReconciliation: mutated, ...extra, metrics, foundationClaims: FOLLOW_UP_STORAGE_ADAPTER_FLAGS, productionAuthority: false });
    try {
      config = configuration(this.env, "control"); a = authenticate(config, text);
      const { m, scope, scopeDigest, operationId, manifestDigest, admissionDigest, publicKeys, signers } = config;
      const fresh = () => { need(active && performance.now() - started < OPERATION_MS); return a.fresh(); };
      const sql = (q, ...p) => { fresh(); need(++metrics.sql <= 256 && p.length <= 100 && Buffer.byteLength(q) <= 100000); const rows = this.ctx.storage.sql.exec(q, ...p).toArray(); need(rows.length <= 65); return rows; };
      const catalog = () => sql(CATALOG_SQL);
      const schema = () => need(canonical(catalog()) === canonical(CATALOG));
      const transaction = fn => { fresh(); need(++metrics.transactions <= 12); return this.ctx.storage.transactionSync(() => { fresh(); const value = fn(); fresh(); return value; }); };
      const state = (phase = "active") => {
        const rows = sql("SELECT manifest,request,phase FROM fur_session WHERE id=1 AND NOT EXISTS(SELECT 1 FROM fur_nonces WHERE action='revoke' AND target=?) LIMIT 2", a.envelope.keyId);
        need(rows.length === 1 && rows[0].manifest === this.env.REHEARSAL_MANIFEST && (!phase || rows[0].phase === phase)); return rows[0];
      };
      const io = async (kind, fn) => {
        // Reserve the 64th downstream call for control→DO forwarding.
        fresh(); need(++metrics.nativeCalls <= 63); metrics[kind]++; let timeout;
        try { return await Promise.race([Promise.resolve().then(() => { fresh(); return fn(); }).then(v => { try { fresh(); return v; } catch { cancel(v?.body); throw new TypeError("private_rehearsal_refused"); } }), new Promise((_, reject) => { timeout = setTimeout(() => { active = false; reject(new TypeError("private_rehearsal_refused")); }, Math.min(WAIT_MS, OPERATION_MS - (performance.now() - started))); })]); }
        finally { clearTimeout(timeout); }
      };
      const sync = () => io("sync", () => this.ctx.storage.sync());
      const bucket = {
        get: async key => {
          const object = await io("get", () => this.env.CAPTURE_BUCKET.get(key)); if (object === null) return null;
          try { integer(object.size, 1, MAX); need(typeof object.etag === "string" && object.etag.length <= 200); } catch { cancel(object.body); throw new TypeError("private_rehearsal_refused"); }
          return { size: object.size, etag: object.etag, body: { cancel: () => cancel(object.body), getReader() {
            fresh(); const reader = object.body.getReader(); readers.add(reader);
            return { async read() { const part = await io("streamReads", () => reader.read()); if (!part.done) { need(part.value instanceof Uint8Array); metrics.bytes += part.value.byteLength; need(metrics.bytes <= 524288); } return part; }, cancel() { cancel(reader); readers.delete(reader); }, releaseLock() { reader.releaseLock(); readers.delete(reader); } };
          } } };
        },
        put: (key, value, options) => { need(typeof value === "string" && Buffer.byteLength(value) <= MAX); metrics.bytes += Buffer.byteLength(value); need(metrics.bytes <= 524288); return io("put", () => this.env.CAPTURE_BUCKET.put(key, value, options)); }
      };
      const emptyKv = async () => { const value = await io("kv", () => this.ctx.storage.list({ limit: 1 })); need(value instanceof Map && value.size === 0); };
      const list = async keys => { const result = await io("list", () => this.env.CAPTURE_BUCKET.list({ limit: 2 })); need(result.truncated === false && !result.delimitedPrefixes?.length && canonical(result.objects.map(o => o.key).sort()) === canonical(keys.sort())); };
      const nonce = () => { const revocation = a.r.action === "revoke"; need(sql(revocation ? "SELECT COUNT(*) AS n FROM fur_nonces WHERE action='revoke'" : "SELECT COUNT(*) AS n FROM fur_nonces WHERE action<>'revoke'")[0].n < (revocation ? 3 : 16)); sql("INSERT INTO fur_nonces VALUES(?,?,?,?)", a.r.nonce, hash(text), a.r.action, revocation ? a.r.body.keyId : null); };
      const genesis = { scopeDigest, epoch: scope.epoch, generation: scope.generation, sequence: 0, digest: hash("amari/private-rehearsal-genesis/v1\n" + manifestDigest) };
      const headKey = `follow-up-admission-witness/v1/${scopeDigest}/head`;
      const initial = { version: "follow-up-admission-control.v1", scopeDigest, epoch: scope.epoch, generation: scope.generation, mode: "active", sequence: 0, headDigest: genesis.digest, pending: null };
      const authorize = async q => {
        fresh(); state(); need(q.scopeDigest === scopeDigest && ["read", "write"].includes(q.purpose));
        if (q.purpose === "write") need(a.p.role === "operator" && ["admit", "execute"].includes(a.r.action));
        let owned = q.resource === "head" || q.resource === `entry/${operationId}` || new RegExp(`^capture/${operationId}/(?:claim|manifest|chunk-(?:[0-9]|1[0-5]))$`).test(q.resource);
        if (/^receipt\/[a-f0-9]{64}$/.test(q.resource)) { const rows = sql("SELECT business_key FROM fue_registry_receipts WHERE transaction_id=? LIMIT 2", q.resource.slice(8)); owned = rows.length === 1 && rows[0].business_key === operationId; }
        if (/^transition\/[a-f0-9]{64}$/.test(q.resource)) { const rows = sql("SELECT data FROM fue_registry_entries WHERE business_key=? LIMIT 2", operationId); owned = rows.length === 1 && parse(rows[0].data).transitionDigest === q.resource.slice(11); }
        need(owned); const at = fresh(); return { version: "follow-up-storage-access.v1", scopeDigest, resource: q.resource, purpose: q.purpose, nonce: q.nonce, issuedAt: at, expiresAt: Math.min(at + 30000, a.r.expiresAt, a.p.expiresAt, m.expiresAt), retentionUntil: m.retentionUntil };
      };
      const common = { scope, authorize, clock: Date.now, timeoutMs: WAIT_MS };
      const witness = createFollowUpEvidenceWitnessAdapter({ ...common, bucket, signer: signers.witness, verificationKeys: publicKeys.witness });
      const initialReadback = async () => {
        const check = () => { schema(); state(); const rows = sql("SELECT data,scope_digest,retention_until FROM fue_registry_control WHERE id=1 LIMIT 2"); need(rows.length === 1 && rows[0].scope_digest === scopeDigest && rows[0].retention_until === m.retentionUntil && rows[0].data === canonical(initial)); for (const t of ["fue_registry_entries", "fue_registry_receipts", "fur_effects"]) need(sql(`SELECT COUNT(*) AS n FROM ${t}`)[0].n === 0); };
        check(); need(canonical(await witness.readHead(scopeDigest)) === canonical(genesis)); check();
      };
      const work = async () => {
        if (a.r.action === "bootstrap") {
          need(catalog().length === 0); await emptyKv(); await list([]);
          const issued = await io("issuer", () => this.env.ISSUER.issue(text)); validateIssued(config, parse(issued));
          mutated = true; transaction(() => { need(catalog().length === 0); for (const ddl of DDL) sql(ddl); sql("INSERT INTO fur_session VALUES(1,?,?,?)", this.env.REHEARSAL_MANIFEST, issued, "pending"); nonce(); schema(); }); await sync(); state("pending"); await list([]);
          const body = { version: "follow-up-storage-witness.v1", kind: "head", scopeDigest, createdAt: m.origin.originalAt, retentionUntil: m.retentionUntil, payload: genesis };
          const expectedHead = encode(signed(body, followUpWitnessSigningBytes(body), signers.witness));
          const ack = await bucket.put(headKey, expectedHead, { onlyIf: { etagDoesNotMatch: "*" } }); need(ack && typeof ack.etag === "string");
          const stored = await bucket.get(headKey); need(stored && stored.etag === ack.etag && stored.size === Buffer.byteLength(expectedHead));
          const reader = stored.body.getReader(); const parts = []; let bytes = 0, complete = false;
          try { for (let i = 0; i < 32; i++) { const part = await reader.read(); if (part.done) { complete = true; break; } bytes += part.value.byteLength; need(bytes <= stored.size); parts.push(Buffer.from(part.value)); } need(complete && bytes === stored.size && Buffer.concat(parts).equals(Buffer.from(expectedHead))); }
          finally { cancel(reader); try { reader.releaseLock(); } catch {} }
          await list([headKey]); await emptyKv();
          transaction(() => { schema(); state("pending"); need(sql("SELECT COUNT(*) AS n FROM fue_registry_control")[0].n === 0); sql("INSERT INTO fue_registry_control VALUES(1,?,?,?)", scopeDigest, m.retentionUntil, canonical(initial)); sql("UPDATE fur_session SET phase='active' WHERE id=1"); }); await sync(); await initialReadback();
          return output({ status: "initialized", counter: 0 });
        }
        if (catalog().length === 0) { await emptyKv(); await list([]); return output({ status: "uninitialized" }); }
        schema(); const session = state(null); if (session.phase !== "active") return output({ status: "indeterminate", bootstrap: "pending", requiresReadOnlyReconciliation: true });
        if (["status", "result"].includes(a.r.action) && sql("SELECT COUNT(*) AS n FROM fue_registry_entries")[0].n === 0) { await initialReadback(); return output({ status: "initialized", counter: 0 }); }
        if (!["status", "result"].includes(a.r.action)) { mutated = true; transaction(() => { state(); nonce(); }); await sync(); state(); if (a.r.action === "revoke") return output({ status: "revoked" }); }
        const registry = createFollowUpEvidenceRegistryAdapter({ ...common, storage: { sql: { exec(q, ...p) { const rows = sql(q, ...p); return { toArray: () => rows }; } }, transactionSync: transaction, sync } });
        const captureBucket = createFollowUpEvidenceCaptureBucket({ ...common, bucket, operationId, originalAt: m.origin.originalAt, retentionUntil: m.retentionUntil });
        const currentFloor = { read: async q => { state(); const result = parse(await io("issuer", () => this.env.ISSUER.issue(text, encode(q)))); state(); return result; } };
        const gate = createFollowUpEvidenceAdmissionGate({ scope, admissionKeys: publicKeys.admission, floorKeys: publicKeys.floor, registry, witness, currentFloor, capture: { bucket: captureBucket, intentKeys: publicKeys.capture, receiptKeys: publicKeys.receipt, receiptSigner: signers.receipt }, clock: Date.now, waitMs: WAIT_MS, operationMs: OPERATION_MS,
          executeAction: async () => {
            fresh(); need(a.r.action === "execute" && a.p.role === "operator"); transaction(() => {
              schema(); state(); need(fresh() < m.origin.dispatchUntil);
              const rows = sql("SELECT c.data AS control,e.data AS entry FROM fue_registry_control c JOIN fue_registry_entries e ON e.business_key=? WHERE c.id=1 LIMIT 2", operationId); need(rows.length === 1);
              const control = parse(rows[0].control), entry = parse(rows[0].entry); need(entry.status === "CONSUMED" && entry.admissionDigest === admissionDigest && entry.retentionUntil === m.retentionUntil && control.pending?.phase === "action" && control.pending.operationId === operationId && control.headDigest === entry.transitionDigest);
              sql("INSERT INTO fur_effects VALUES(?,?,?)", operationId, manifestDigest, fresh());
            }); await sync(); state();
            return { version: "follow-up-capture-metadata.v1", operationId, actionDigest: scope.actionDigest, observedAt: fresh(), outcome: "acknowledged", readback: "matches", statementCount: 1, rowsRead: 0, rowsWritten: 1, evidenceDigests: [hash(canonical({ operationId, manifestDigest }))], reasonCodes: [] };
          }
        });
        const result = await gate[{ admit: "admit", execute: "executeAdmitted", status: "readStatus", result: "readCapture" }[a.r.action]](parse(session.request)); fresh(); state();
        const counter = sql("SELECT COUNT(*) AS n FROM fur_effects WHERE business_key=? AND manifest_digest=?", operationId, manifestDigest)[0].n; need(counter === 0 || counter === 1);
        return output({ status: result.status, counter, gate: result });
      };
      return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { active = false; reject(new TypeError("private_rehearsal_refused")); }, OPERATION_MS); })]);
    } catch { return output({ status: mutated ? "indeterminate" : "refused" }); }
    finally { active = false; clearTimeout(timer); for (const reader of readers) cancel(reader); }
  }
  fetch() { return new Response("Not found", { status: 404 }); }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
