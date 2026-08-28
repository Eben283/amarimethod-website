import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as consumer from "../../functions/lib/follow-up-consumer-retention-store.js";
import * as journal from "../../functions/lib/follow-up-effect-evidence-store.js";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY as SCHEMA } from "../../functions/lib/reliability-schema-authority.js";

const family = "follow-up-session-reminders", D = (c) => c.repeat(64);
const hash = (s) => createHash("sha256").update(s).digest("hex"), id = (s) => `id_${hash(s)}`;
const production = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json", import.meta.url), "utf8"));
const sql = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const runtime = `${"a".repeat(40)}@follow-up-reminder-engine.v3`;
const workflow = { id: family, name: "Local composition fixture", version: 3, executionMode: "active",
  trigger: { calendarIds: ["calendar"], statuses: ["confirmed"], eventTypes: ["normal"] }, exits: [],
  nodes: ["confirmation", "reminder"].map((node) => ({ id: node, label: node, at: "enroll", skipIfPast: false,
    action: { type: "sms", template: node }, message: { audience: "client", channel: "sms", body: "Local test only" } })) };
let raw, db, now, retention, workflowHash;
const temporaryDirectories = [];
const checkpoints = "follow_up_consumer_checkpoints", reasons = "follow_up_consumer_retained_reasons", events = "follow_up_effect_evidence_events";
const consumerWrite = (query) => query.includes(`INSERT INTO ${checkpoints}(`);

function assertFunctionBounds(query) {
  const functions = /\b(json_object|json_set|json_array|json_extract|json_array_length|json_group_array|json_valid|json_type|coalesce|min|max|substr|length|cast|strftime|count|sum)\s*\(/gi;
  let match;
  while ((match = functions.exec(query))) {
    let depth = 1, args = 1, quote = null;
    for (let i = functions.lastIndex; i < query.length && depth; i++) {
      const ch = query[i];
      if (quote) { if (ch === quote) { if (query[i + 1] === quote) i++; else quote = null; } continue; }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) args++;
    }
    expect(args, `${match[1]} function argument limit`).toBeLessThanOrEqual(32);
  }
}

// Actual SQLite statements/transactions behind the async D1-shaped API. No
// canned assertion rows. Candidate SQL is applied only to this local fixture.
function connection(database, hooks = {}) {
  const operations = [], errors = [];
  return { operations, errors, prepare(query) { return { query, args: [], bind(...args) { this.args = args; return this; } }; },
    async batch(statements) {
      operations.push(statements.map((s) => s.query));
      database.exec("BEGIN IMMEDIATE");
      let results;
      try {
        results = statements.map((s, index) => {
          expect(s.args.length).toBeLessThanOrEqual(100);
          expect(Buffer.byteLength(s.query)).toBeLessThanOrEqual(100000);
          for (const arg of s.args) if (typeof arg === "string") expect(Buffer.byteLength(arg)).toBeLessThanOrEqual(2000000);
          assertFunctionBounds(s.query);
          hooks.beforeStatement?.(s.query, index);
          const q = database.prepare(s.query);
          if (q.columns().length) return { success: true, results: q.all(...s.args).map((r) => ({ ...r })), meta: { duration: 0.125, rows_written: 0, changed_db: false } };
          const r = q.run(...s.args); return { success: true, results: [], meta: { changes: Number(r.changes), duration: 0.125 } };
        });
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); errors.push(error.message); throw error; }
      await hooks.afterBatch?.(statements, results);
      return hooks.batchResult ? hooks.batchResult(results, statements) : results;
    } };
}
function insert(table, row) {
  const keys = Object.keys(row);
  raw.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
}
function fullRow(table, overrides) {
  const row = {};
  for (const c of raw.prepare(`SELECT name,type FROM pragma_table_info('${table}')`).all()) row[c.name] = c.type === "INTEGER" ? 1 : /sha256|digest/.test(c.name) ? D("a") : "fixture";
  return { ...row, ...overrides };
}
function seed() {
  // Synthetic relational provenance only: these signatures/envelopes are NOT
  // authenticated, and no composition result may promote them to authority.
  workflowHash = hash(canonicalJson(workflow));
  insert("workflow_versions", { workflow_id: family, version: 3, state: "published", document: canonicalJson(workflow), created_at: now - 20000, published_at: now - 15000 });
  insert("source_events", { source_event_id: "source-a", provider: "ghl", family, identity_version: 1, identity_key: "fixture-source-a", payload_sha256: D("b"), normalized_retention_until: retention, occurred_at: now - 1000, received_at: now - 1000, authentication_result: "authenticated", normalization_state: "normalized", normalized_json: "{}", state: "accepted", source_version: "ghl:appointment-events-webhook:v7", runtime_version: runtime, accepted_at: now - 1000, created_at: now - 1000 });
  insert("lifecycle_instances", { lifecycle_instance_id: "life-a", source_event_id: "source-a", family, scope: "confirmed-normal-follow-up", person_id: "private-person", appointment_id: "private-appointment", definition_version: 3, runtime_version: runtime, state: "active", retention_until: retention, created_at: now - 1000, updated_at: now - 1000 });
  obligation("a", "confirmation");
  const common = { release_manifest_id: `relm_${D("a")}`, release_manifest_digest: D("a"), source_revision: "a".repeat(40), source_tree: "b".repeat(40), worker_version: "follow-up-reminder-engine.v3", runtime_version: runtime, workflow_id: family, workflow_version: 3, workflow_document_sha256: workflowHash, schema_database_id: "fixture-db", schema_migration_id: SCHEMA.migrationId, schema_version: 2, schema_structure_sha256: SCHEMA.structureSha256, follow_up_delivery_release: "approved", follow_up_assigned_user_delivery: "approved", canonical_json: "{}", retention_until: retention };
  insert("automation_release_manifests", fullRow("automation_release_manifests", { ...common, family, workflow_state: "published", created_at: now - 20000 }));
  insert("automation_deployment_attestations", fullRow("automation_deployment_attestations", { ...common, deployment_attestation_id: `depatt_${D("b")}`, platform: "cloudflare", service: "reminder-engine", environment: "production", deployment_id: "fixture-deployment", version_id: "fixture-version", traffic_percent: 100, authentication_method: "ed25519", authentication_signature: "a".repeat(128), observed_at: now - 12000, attested_at: now - 10000, recorded_at: now - 9000, expires_at: now + 600000 }));
  insert("source_event_runtime_provenance", { source_event_id: "source-a", lifecycle_instance_id: "life-a", invocation_id: "fixture-invocation", deployment_attestation_id: `depatt_${D("b")}`, cloudflare_version_id: "fixture-version", workflow_document_sha256_at_bind: workflowHash, schema_structure_sha256_at_bind: SCHEMA.structureSha256, follow_up_delivery_release_at_bind: "approved", follow_up_assigned_user_delivery_at_bind: "approved", bound_at: now - 1000, retention_until: retention });
}
function obligation(suffix, node) {
  insert("lifecycle_obligations", { obligation_id: `obligation-${suffix}`, lifecycle_instance_id: "life-a", obligation_key: node, kind: "client_sms", family, deadline_at: now, owner_role: "system", closer: "provider_receipt", state: "leased", lease_owner: "fixture-executor", lease_acquired_at: now - 500, lease_expires_at: now + 300000, retention_until: retention, created_at: now - 1000, updated_at: now - 1000 });
  insert("obligation_lease_events", { lease_event_id: `lease-${suffix}`, obligation_id: `obligation-${suffix}`, event_type: "acquired", previous_owner: null, new_owner: "fixture-executor", lease_acquired_at: now - 500, lease_expires_at: now + 300000, retention_until: retention });
}
function boot(populate = true, candidate = true) {
  raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON");
  for (const type of ["table", "index", "trigger"]) for (const row of production.projection.filter((r) => r.type === type)) raw.exec(row.sql);
  insert("reliability_schema_versions", production.marker[0]);
  for (const name of ["reliability-spine-v2-production-lineage-install.local.sql", "reliability-spine-v2-production-lineage-promote.local.sql"]) {
    raw.exec("BEGIN IMMEDIATE"); try { raw.exec(sql(name)); raw.exec("COMMIT"); } catch (error) { raw.exec("ROLLBACK"); throw error; }
  }
  now = Math.floor(Date.now() / 1000) * 1000; retention = now + 86400000;
  if (populate) seed();
  if (candidate) { raw.exec(sql("reliability-effect-evidence.candidate.sql")); raw.exec(sql("reliability-consumer-retention.candidate.sql")); }
  db = connection(raw);
}
const databaseNow = () => raw.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER) n").get().n;
function prepareInput(suffix = "a", patch = {}) { return { commandAttemptId: `attempt-${suffix}`, sourceEventId: "source-a", lifecycleInstanceId: "life-a", obligationId: `obligation-${suffix}`, leaseEventId: `lease-${suffix}`, workflowId: family, workflowVersion: 3, workflowDocumentSha256: workflowHash, nodeId: suffix === "a" ? "confirmation" : "reminder", acceptanceDeploymentAttestationId: `depatt_${D("b")}`, executorDeploymentAttestationId: `depatt_${D("b")}`, executorRuntimeVersion: runtime, provider: "ghl", providerAccountScope: "account-fixture", idempotencyKey: `effect-${suffix}`, attemptNumber: 1, retryClass: "manual_ambiguous", target: "ghl", requestSha256: D("c"), renderedCopySha256: D("d"), eventId: `event-prepared-${suffix}`, occurrenceAt: now - 500, detailSha256: D("e"), retentionUntil: retention, ...patch }; }
function observation(sequence, suffix = "a", patch = {}) { return { commandAttemptId: `attempt-${suffix}`, eventId: `event-submitted-${suffix}`, expectedSequence: sequence, fromState: "prepared", toState: "submitted", providerReference: `private-reference-${suffix}`, errorCode: null, occurrenceAt: databaseNow(), detailSha256: D("f"), ...patch }; }
function receipt(patch = {}) { return { commandAttemptId: "attempt-a", eventId: "event-receipt-a", providerReceiptId: "receipt-a", provider: "ghl", providerAccountScope: "account-fixture", providerReference: "private-reference-a", proofLevel: "accepted", evidenceSha256: D("f"), observedAt: databaseNow(), detailSha256: D("e"), ...patch }; }
async function prepared(suffix = "a") { const result = await journal.prepareFollowUpEffectAttempt(db, prepareInput(suffix)); expect(result.status).toBe("prepared"); return result; }
async function submitted(suffix = "a") { const p = await prepared(suffix); const s = await journal.appendFollowUpEffectObservation(db, observation(p.sequence, suffix)); expect(s.status).toBe("recorded"); return s; }
async function received(patch = {}) { const r = await journal.recordFollowUpEffectReceipt(db, receipt(patch)); expect(["recorded", "recorded_conflict"]).toContain(r.status); return r; }
function compositionOptions(patch = {}) {
  const readAt = databaseNow();
  return { inventoryOptions: { readAt, limit: 200, cutoff: { receivedStart: now - 60000, receivedEnd: readAt, ingestedStart: now - 60000, ingestedEnd: now - 30000, plannedAt: readAt, maxPages: 1, maxCandidates: 200 } },
    previousCarryForward: { candidates: [], cursor: null }, journalPageSize: 200, maxJournalPages: 20, maxCandidates: 200, ...patch };
}
function candidate(kind, rawId, reasonCodes = ["carry_forward"]) { const identity = id(rawId); return { candidateId: `${kind}:${identity}`, family, kind, identity, reasonCodes, unresolved: true }; }

const input = (operationId = "input-a", patch = {}) => {
  const o = compositionOptions();
  return { consumerKey: "local-reader", operationId, inventoryOptions: o.inventoryOptions, previousCarryForward: o.previousCarryForward, ...patch };
};
const advance = (operationId = "advance-a", patch = {}) => ({ consumerKey: "local-reader", operationId, pageSize: 200, maxPages: 20, ...patch });
const read = (patch = {}) => ({ consumerKey: "local-reader", checkpointId: null, cursor: null, limit: 200, ...patch });
const count = (table) => Number(raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
function snapshot() {
  const directory = mkdtempSync(join(tmpdir(), "follow-up-consumer-test-")); temporaryDirectories.push(directory);
  const path = join(directory, "snapshot.sqlite"); raw.prepare("VACUUM INTO ?").run(path); return path;
}
function restore(path) { raw.close(); raw = new DatabaseSync(path); raw.exec("PRAGMA foreign_keys=ON"); db = connection(raw); }
function addSource(suffix) {
  const row = { ...raw.prepare("SELECT * FROM source_events WHERE source_event_id='source-a'").get() };
  row.source_event_id = `source-${suffix}`; row.identity_key = `fixture-source-${suffix}`; insert("source_events", row);
}
function changeCheckpoint(sqlText, ...params) {
  raw.exec("DROP TRIGGER follow_up_consumer_checkpoints_no_update"); raw.prepare(sqlText).run(...params);
}
function flags(r) {
  expect(r).toMatchObject({ sourceOnly: true, simulation: true, authority: false, authoritativeCoverage: false, producerAdopted: false,
    dispatchAllowed: false, outcomeProven: false, replacementAllowed: false, watermarkAdvanceAllowed: false, retainPreviousCarryForward: true,
    coherentRollbackDetectable: false, externalRestoreWitness: "absent", provenanceScope: "stored_structural_links_only" });
}
function refused(r) { flags(r); expect(r.status).toBe("refused"); }
async function collect(checkpointId = null, limit = 50) {
  const all = []; let cursor = null, first;
  do {
    const r = await consumer.readRetainedFollowUpCandidates(db, read({ checkpointId, cursor, limit })); expect(r.status).toBe("observed"); flags(r);
    first ??= r; all.push(...r.candidates); checkpointId = r.checkpoint.checkpointId; cursor = r.continuation;
  } while (cursor);
  return { candidates: all, first };
}
beforeEach(() => boot());
afterEach(() => { vi.restoreAllMocks(); raw?.close(); for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("durable consumer retention over real promoted-v2 SQLite", () => {
  it("retains current inventory and exact prior carry without advancing any journal prefix", async () => {
    const o = input(); o.previousCarryForward.candidates.push(candidate("evidence", "old-event", ["sequenced_evidence", "terminal_anomaly"]));
    const r = await consumer.retainFollowUpConsumerInputs(db, o); expect(r.status, JSON.stringify({ r, errors: db.errors })).toBe("retained"); flags(r);
    expect(r.checkpoint.prefix.throughSequence).toBe(0); expect(count("follow_up_consumer_checkpoints")).toBe(1);
    const all = await collect(); expect(all.candidates).toHaveLength(4); expect(all.candidates.find((c) => c.kind === "evidence").reasonCodes).toEqual(["carry_forward", "sequenced_evidence", "terminal_anomaly"]);
  });
  it("commits multiple actual journal pages atomically with all memberships", async () => {
    await submitted(); await received(); const r = await consumer.advanceFollowUpConsumerPrefix(db, advance("advance-a", { pageSize: 1 }));
    expect(r.status, JSON.stringify({ r, errors: db.errors })).toBe("advanced"); flags(r); expect(r.pagesCommitted).toBe(3); expect(r.checkpoint.prefix.throughSequence).toBe(3);
    expect(r.checkpoint.recordedWindowComplete).toBe(true); expect(count("follow_up_consumer_checkpoints")).toBe(3);
    expect((await collect(null, 2)).candidates).toHaveLength(6);
  });
  it("preserves more than200 unresolved candidates through stable grouped keyset pages", async () => {
    for (let batchNo = 0; batchNo < 3; batchNo++) {
      const o = input(`input-${batchNo}`); o.previousCarryForward.candidates = Array.from({ length: 100 }, (_, i) => candidate("evidence", `old-${batchNo}-${i}`, ["sequenced_evidence", "terminal_anomaly"]));
      expect((await consumer.retainFollowUpConsumerInputs(db, o)).status).toBe("retained");
    }
    const all = await collect(null, 37); expect(all.candidates).toHaveLength(303); expect(new Set(all.candidates.map((c) => c.candidateId)).size).toBe(303);
    expect(all.candidates.filter((c) => c.kind === "evidence").every((c) => c.reasonCodes.length === 3)).toBe(true);
  });
  it("keeps a budget-limited H across operations while post-H events await the next window", async () => {
    await submitted(); const first = await consumer.advanceFollowUpConsumerPrefix(db, advance("one", { pageSize: 1, maxPages: 1 }));
    expect(first.status).toBe("advanced"); expect(first.checkpoint.prefix.throughSequence).toBe(1); expect(first.checkpoint.boundary.throughSequence).toBe(2);
    await received(); const second = await consumer.advanceFollowUpConsumerPrefix(db, advance("two", { pageSize: 1 }));
    expect(second.status).toBe("advanced"); expect(second.checkpoint.prefix.throughSequence).toBe(2); expect(second.checkpoint.boundary.throughSequence).toBe(2);
    const third = await consumer.advanceFollowUpConsumerPrefix(db, advance("three")); expect(third.status).toBe("advanced"); expect(third.checkpoint.prefix.throughSequence).toBe(3);
  });
  it("replays the exact operation and refuses changed content under the same operation ID", async () => {
    await submitted(); const o = advance("same", { pageSize: 1 }), first = await consumer.advanceFollowUpConsumerPrefix(db, o);
    expect(first.status).toBe("advanced"); const replay = await consumer.advanceFollowUpConsumerPrefix(db, o); expect(replay.status).toBe("replayed");
    expect(replay.checkpoint).toEqual(first.checkpoint); expect(count("follow_up_consumer_checkpoints")).toBe(2);
    refused(await consumer.advanceFollowUpConsumerPrefix(db, { ...o, pageSize: 2 }));
  });
  it("has no provider action, raw private identity/ref spool or lifted authority", async () => {
    await submitted(); await received(); const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance()); expect(r.status).toBe("advanced"); const all = await collect(); flags(r); expect(fetch).not.toHaveBeenCalled();
    const payloads = raw.prepare("SELECT payload_json FROM follow_up_consumer_checkpoints").all();
    expect(JSON.stringify([r, all, payloads])).not.toMatch(/private-|account-fixture|source-a|life-a|attempt-a|obligation-a/);
  });

  it("aborts every planned page when only the final page loses its exact proof", async () => {
    await submitted(); await received(); let inserts = 0;
    db = connection(raw, { beforeStatement(query) {
      if (consumerWrite(query) && ++inserts === 3) raw.prepare("UPDATE provider_receipts SET evidence_sha256=? WHERE provider_receipt_id='receipt-a'").run(D("a"));
    } });
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance("atomic", { pageSize: 1 })); refused(r);
    expect(inserts).toBe(3); expect(count(checkpoints)).toBe(0); expect(count(reasons)).toBe(0);
    expect(raw.prepare("SELECT evidence_sha256 FROM provider_receipts WHERE provider_receipt_id='receipt-a'").get().evidence_sha256).toBe(D("f"));
  });
  it("rolls back checkpoint and earlier reason inserts on a membership failure", async () => {
    await submitted(); raw.exec(`CREATE TRIGGER fixture_reason_failure BEFORE INSERT ON ${reasons} WHEN NEW.member_index=2 BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance())); expect(count(checkpoints)).toBe(0); expect(count(reasons)).toBe(0);
  });
  it.each(["delete", "digest"])("detects an interior prefix %s even with its H anchor intact", async (mode) => {
    await submitted(); await received(); const first = await consumer.advanceFollowUpConsumerPrefix(db, advance("first")); expect(first.status).toBe("advanced");
    const retained = count(reasons);
    raw.exec(`DROP TRIGGER follow_up_effect_events_no_${mode === "delete" ? "delete" : "update"}`);
    if (mode === "delete") raw.prepare(`DELETE FROM ${events} WHERE sequence=2`).run();
    else raw.prepare(`UPDATE ${events} SET event_digest_sha256=? WHERE sequence=2`).run(D("a"));
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("next"))); expect(count(checkpoints)).toBe(1); expect(count(reasons)).toBe(retained);
    const retainedRead = await consumer.readRetainedFollowUpCandidates(db, read()); expect(retainedRead.status).toBe("observed");
    expect(retainedRead.journalContinuity).toBe("gap"); expect(retainedRead.candidates.length).toBeGreaterThan(0);
  });
  it("rechecks the whole prior prefix inside the write transaction", async () => {
    await submitted(); await received(); expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("first"))).status).toBe("advanced");
    const retained = count(reasons); raw.exec("DROP TRIGGER follow_up_effect_events_no_update");
    db = connection(raw, { beforeStatement(query) { if (consumerWrite(query)) raw.prepare(`UPDATE ${events} SET event_digest_sha256=? WHERE sequence=2`).run(D("a")); } });
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("race"))); expect(count(checkpoints)).toBe(1); expect(count(reasons)).toBe(retained);
    expect(raw.prepare(`SELECT event_digest_sha256 FROM ${events} WHERE sequence=2`).get().event_digest_sha256).not.toBe(D("a"));
  });
  it("detects a mixed ancestor checkpoint restore with identical generations and member counts", async () => {
    const first = await consumer.retainFollowUpConsumerInputs(db, input("first")); expect(first.status).toBe("retained");
    expect((await consumer.retainFollowUpConsumerInputs(db, input("second"))).status).toBe("retained");
    changeCheckpoint(`UPDATE ${checkpoints} SET checkpoint_digest=? WHERE generation=1`, D("a"));
    refused(await consumer.readRetainedFollowUpCandidates(db, read())); refused(await consumer.retainFollowUpConsumerInputs(db, input("third")));
    expect(count(checkpoints)).toBe(2);
  });
  it.each(["reason", "owner", "index"])("rejects same-count retained membership %s substitution", async (kind) => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained"); const before = count(reasons);
    raw.exec("DROP TRIGGER follow_up_consumer_reasons_no_update");
    if (kind === "reason") raw.prepare(`UPDATE ${reasons} SET reason_code='terminal_anomaly' WHERE member_index=0`).run();
    else if (kind === "owner") raw.prepare(`UPDATE ${reasons} SET consumer_key='other-reader' WHERE member_index=0`).run();
    else raw.prepare(`UPDATE ${reasons} SET member_index=999 WHERE member_index=0`).run();
    refused(await consumer.readRetainedFollowUpCandidates(db, read())); refused(await consumer.advanceFollowUpConsumerPrefix(db, advance()));
    expect(count(reasons)).toBe(before); expect(count(checkpoints)).toBe(1);
  });
  it("rechecks ancestor/member integrity after read but before INSERT", async () => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained"); raw.exec("DROP TRIGGER follow_up_consumer_reasons_no_update");
    db = connection(raw, { beforeStatement(query) { if (consumerWrite(query)) raw.prepare(`UPDATE ${reasons} SET reason_code='terminal_anomaly' WHERE member_index=0`).run(); } });
    refused(await consumer.retainFollowUpConsumerInputs(db, input("next"))); expect(count(checkpoints)).toBe(1);
    expect(raw.prepare(`SELECT reason_code FROM ${reasons} WHERE member_index=0`).get().reason_code).not.toBe("terminal_anomaly");
  });
  it("detects inventory membership added after observation instead of certifying only the old rows", async () => {
    db = connection(raw, { beforeStatement(query) { if (consumerWrite(query)) addSource("concurrent"); } });
    refused(await consumer.retainFollowUpConsumerInputs(db, input())); expect(count(checkpoints)).toBe(0); expect(count(reasons)).toBe(0); expect(count("source_events")).toBe(1);
  });
  it("recovers an exact multi-page operation after a lost committed response", async () => {
    await submitted(); await received(); let lost = false;
    db = connection(raw, { afterBatch(statements) { if (!lost && statements.some((s) => consumerWrite(s.query))) { lost = true; throw new Error("lost response private-data"); } } });
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance("lost", { pageSize: 1 })); expect(r.status).toBe("replayed"); expect(r.pagesCommitted).toBe(3);
    expect(count(checkpoints)).toBe(3); expect((await collect()).candidates).toHaveLength(6); expect(JSON.stringify(r)).not.toContain("private-data");
  });
  it("does not claim a failed write when commit and recovery are both unobservable", async () => {
    await prepared(); let lost = false;
    db = connection(raw, { beforeStatement() { if (lost) throw new Error("read outage"); }, afterBatch(statements) {
      if (statements.some((s) => consumerWrite(s.query))) { lost = true; throw new Error("lost committed response"); }
    } });
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance()); refused(r); expect(r.durable).toBe(null); expect(r.reasonCodes).toEqual(["write_outcome_unknown"]); expect(count(checkpoints)).toBe(1);
  });
  it("uses CAS to allow only one competing successor for the same consumer", async () => {
    await submitted(); const results = await Promise.all([
      consumer.advanceFollowUpConsumerPrefix(db, advance("race-a", { pageSize: 1 })), consumer.advanceFollowUpConsumerPrefix(db, advance("race-b", { pageSize: 1 })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["advanced", "refused"]); expect(count(checkpoints)).toBe(2); for (const r of results) flags(r);
  });
  it("keeps distinct consumers independent over the same canonical journal", async () => {
    await submitted(); const r = await Promise.all([consumer.advanceFollowUpConsumerPrefix(db, advance("a")),
      consumer.advanceFollowUpConsumerPrefix(db, advance("b", { consumerKey: "other-reader" }))]);
    expect(r.every((v) => v.status === "advanced")).toBe(true); expect(r[0].checkpoint.consumerId).not.toBe(r[1].checkpoint.consumerId); expect(count(checkpoints)).toBe(2);
  });
  it("survives restart with an unfinished fixed H and exact operation replay", async () => {
    await submitted(); const first = await consumer.advanceFollowUpConsumerPrefix(db, advance("first", { pageSize: 1, maxPages: 1 })); expect(first.status).toBe("advanced");
    restore(snapshot()); expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("first", { pageSize: 1, maxPages: 1 }))).status).toBe("replayed");
    await received(); const next = await consumer.advanceFollowUpConsumerPrefix(db, advance("next")); expect(next.status).toBe("advanced");
    expect(next.checkpoint.boundary.throughSequence).toBe(2); expect(next.checkpoint.prefix.throughSequence).toBe(2); expect((await collect()).candidates).toHaveLength(5);
  });
  it("honestly cannot detect a coherent rollback of both checkpoint and journal without an external witness", async () => {
    await submitted(); const initial = await consumer.advanceFollowUpConsumerPrefix(db, advance("initial")); expect(initial.status).toBe("advanced"); const old = snapshot();
    await received(); expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("later"))).checkpoint.prefix.throughSequence).toBe(3);
    restore(old); const seen = await consumer.readRetainedFollowUpCandidates(db, read()); expect(seen.status).toBe("observed"); flags(seen);
    expect(seen.checkpoint.prefix.throughSequence).toBe(2); expect(seen.coherentRollbackDetectable).toBe(false); expect(seen.externalRestoreWitness).toBe("absent");
    const resumed = await consumer.advanceFollowUpConsumerPrefix(db, advance("after-restore")); expect(resumed.status).toBe("advanced"); flags(resumed);
  });
  it("does not delete retained work when its required lifecycle retention expires", async () => {
    await submitted(); const first = await consumer.advanceFollowUpConsumerPrefix(db, advance("first")); expect(first.status).toBe("advanced"); const retained = count(reasons);
    raw.prepare("UPDATE lifecycle_instances SET retention_until=? WHERE lifecycle_instance_id='life-a'").run(now - 1);
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("next"))); const seen = await consumer.readRetainedFollowUpCandidates(db, read());
    expect(seen.status).toBe("observed"); expect(seen.journalContinuity).toBe("gap"); expect(seen.reasonCodes).toContain("retained_evidence_gap"); expect(count(reasons)).toBe(retained);
  });
  it("retains the original H after expiry of an empty-tail anchor", async () => {
    await prepared(); const first = await consumer.advanceFollowUpConsumerPrefix(db, advance("first")); expect(first.status).toBe("advanced");
    raw.prepare("UPDATE lifecycle_instances SET retention_until=? WHERE lifecycle_instance_id='life-a'").run(now - 1);
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("empty-tail"))); expect(count(checkpoints)).toBe(1);
  });
  it("replays an expired operation only as historical persistence, never fresh progress", async () => {
    await prepared(); const options = advance("historical"), first = await consumer.advanceFollowUpConsumerPrefix(db, options);
    expect(first.status).toBe("advanced"); raw.prepare("UPDATE lifecycle_instances SET retention_until=? WHERE lifecycle_instance_id='life-a'").run(now - 1);
    const replay = await consumer.advanceFollowUpConsumerPrefix(db, options); expect(replay.status).toBe("replayed"); expect(replay.checkpoint).toEqual(first.checkpoint); flags(replay);
    expect(count(checkpoints)).toBe(1); expect((await consumer.readRetainedFollowUpCandidates(db, read())).journalContinuity).toBe("gap");
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("fresh")));
  });
  it("spools more than200 actual journal candidates without a full-root200 candidate ceiling", async () => {
    await submitted();
    for (let i = 0; i < 201; i++) await received({ eventId: `event-receipt-${i}`, providerReceiptId: `receipt-${i}`, evidenceSha256: hash(`receipt-evidence-${i}`) });
    const result = await consumer.advanceFollowUpConsumerPrefix(db, advance("many", { pageSize: 200 }));
    expect(result.status, JSON.stringify({ result, errors: db.errors })).toBe("advanced"); expect(result.pagesCommitted).toBe(2); expect(result.checkpoint.prefix.throughSequence).toBe(203);
    const all = await collect(null, 23); expect(all.candidates).toHaveLength(206); expect(all.candidates.filter((c) => c.kind === "evidence")).toHaveLength(203);
    expect(all.first.inventoryCoverage).toBe("bounded_current_observation_only");
  });
  it("handles another same-consumer operation between planned pages without partial progress", async () => {
    await submitted(); await received(); const competitor = connection(raw); let competed = false, other;
    db = connection(raw, { async afterBatch(statements) {
      if (!competed && statements.length === 4 && statements[0].query.includes("follow_up_consumer_journal_v1")) {
        competed = true; other = await consumer.advanceFollowUpConsumerPrefix(competitor, advance("competitor", { pageSize: 1, maxPages: 1 }));
      }
    } });
    const outer = await consumer.advanceFollowUpConsumerPrefix(db, advance("outer", { pageSize: 1 })); expect(other.status).toBe("advanced"); refused(outer);
    expect(count(checkpoints)).toBe(1); expect(raw.prepare(`SELECT operation_id FROM ${checkpoints}`).get().operation_id).toBe("competitor");
    const retry = await consumer.advanceFollowUpConsumerPrefix(db, advance("outer", { pageSize: 1 })); expect(retry.status).toBe("advanced"); expect(retry.pagesCommitted).toBe(2);
    expect(retry.checkpoint.boundary).toEqual(other.checkpoint.boundary); expect((await collect()).candidates).toHaveLength(6);
  });
  it("excludes a real post-H append that commits while an operation is being planned", async () => {
    await submitted(); const journalDb = connection(raw); let added = false;
    db = connection(raw, { async afterBatch(statements) {
      if (!added && statements.length === 4 && statements[0].query.includes("follow_up_consumer_journal_v1")) {
        added = true; expect((await journal.recordFollowUpEffectReceipt(journalDb, receipt())).status).toBe("recorded");
      }
    } });
    const result = await consumer.advanceFollowUpConsumerPrefix(db, advance("fixed", { pageSize: 1 })); expect(result.status).toBe("advanced");
    expect(result.checkpoint.boundary.throughSequence).toBe(2); expect(result.checkpoint.prefix.throughSequence).toBe(2); expect(count(events)).toBe(3);
    expect((await collect()).candidates).toHaveLength(5); expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("later"))).checkpoint.prefix.throughSequence).toBe(3);
  });
  it("serializes same-consumer races across two real SQLite connections", async () => {
    await submitted(); const path = snapshot(); restore(path); const otherRaw = new DatabaseSync(path); otherRaw.exec("PRAGMA foreign_keys=ON");
    try {
      const other = connection(otherRaw); const results = await Promise.all([consumer.advanceFollowUpConsumerPrefix(db, advance("first")), consumer.advanceFollowUpConsumerPrefix(other, advance("second"))]);
      expect(results.map((r) => r.status).sort()).toEqual(["advanced", "refused"]); expect(count(checkpoints)).toBe(1);
    } finally { otherRaw.close(); }
  });
  it("allows real sequence gaps and per-attempt predecessors across operation boundaries", async () => {
    const p = await prepared(); raw.prepare("UPDATE sqlite_sequence SET seq=seq+5 WHERE name=?").run(events);
    obligation("b", "reminder"); const b = await prepared("b"); expect(b.sequence).toBe(7);
    expect((await journal.appendFollowUpEffectObservation(db, observation(p.sequence))).status).toBe("recorded");
    expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("first", { pageSize: 1, maxPages: 1 }))).checkpoint.prefix.throughSequence).toBe(1);
    const second = await consumer.advanceFollowUpConsumerPrefix(db, advance("second", { pageSize: 1 })); expect(second.status).toBe("advanced"); expect(second.checkpoint.prefix.throughSequence).toBe(8);
    expect((await collect()).candidates).toHaveLength(7);
  });
  it("checks per-attempt predecessor history before a saved prefix", async () => {
    await submitted(); await received(); expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("first", { pageSize: 1, maxPages: 1 }))).status).toBe("advanced");
    raw.exec("DROP TRIGGER follow_up_effect_events_no_update"); raw.prepare(`UPDATE ${events} SET previous_sequence=1 WHERE sequence=3`).run();
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("next"))); expect(count(checkpoints)).toBe(1);
  });
  it("retains contradictory terminal proofs across pages and later nonconflicting observations", async () => {
    await submitted(); await received({ proofLevel: "delivered" });
    await received({ eventId: "bounce", providerReceiptId: "receipt-bounce", proofLevel: "bounced", evidenceSha256: D("b") });
    await received({ eventId: "accepted", providerReceiptId: "receipt-accepted", proofLevel: "accepted", evidenceSha256: D("a") });
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance("proofs", { pageSize: 1 })); expect(r.status).toBe("advanced");
    const all = await collect(); expect(all.candidates.find((c) => c.kind === "obligation").reasonCodes).toContain("conflicting_receipt_evidence");
    expect(all.candidates.find((c) => c.identity === id("accepted")).reasonCodes).not.toContain("conflicting_receipt_evidence");
  });
  it("rejects a forged false conflict flag relative to earlier retained proof history", async () => {
    await submitted(); await received({ proofLevel: "delivered" });
    expect((await consumer.advanceFollowUpConsumerPrefix(db, advance("first"))).status).toBe("advanced");
    await received({ eventId: "bounce", providerReceiptId: "receipt-bounce", proofLevel: "bounced", evidenceSha256: D("b") });
    raw.exec("DROP TRIGGER follow_up_effect_events_no_update"); raw.prepare(`UPDATE ${events} SET is_conflict=0 WHERE event_id='bounce'`).run();
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("next"))); expect(count(checkpoints)).toBe(1);
  });
  it("rejects provider/reference aliases owned by another actual attempt", async () => {
    await submitted(); await received(); obligation("b", "reminder"); await submitted("b");
    await received({ commandAttemptId: "attempt-b", eventId: "event-receipt-b", providerReceiptId: "receipt-b", providerReference: "private-reference-b", proofLevel: "delivered", evidenceSha256: D("a") });
    raw.exec("DROP TRIGGER follow_up_effect_events_no_update");
    raw.prepare(`UPDATE ${events} SET provider_reference='private-reference-a' WHERE command_attempt_id='attempt-b' AND provider_reference IS NOT NULL`).run();
    raw.prepare("UPDATE command_attempts SET provider_reference='private-reference-a' WHERE command_attempt_id='attempt-b'").run();
    raw.prepare("UPDATE provider_receipts SET provider_reference='private-reference-a' WHERE command_attempt_id='attempt-b'").run();
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance())); expect(count(checkpoints)).toBe(0);
  });
  it("enforces D1's32 argument limit while preserving all nullable raw fields", async () => {
    assertFunctionBounds(sql("reliability-consumer-retention.candidate.sql")); await prepared();
    const row = JSON.parse(raw.prepare("SELECT row_json FROM follow_up_consumer_journal_v1").get().row_json);
    expect(Object.keys(row)).toHaveLength(24);
    for (const key of ["state_before", "provider", "provider_account_scope", "provider_reference", "provider_receipt_id", "proof_level", "evidence_sha256", "observed_at", "error_code"]) expect(row[key]).toBe(null);
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance()); expect(r.status).toBe("advanced");
    const writes = db.operations.filter((op) => op.some(consumerWrite)); expect(writes).toHaveLength(1); expect(writes[0].length).toBeLessThanOrEqual(21);
  });
  it("retains all prior reason sets including an unprojected or absent identity", async () => {
    const o = input(); o.previousCarryForward.candidates = [candidate("anomaly", "old-anomaly", ["terminal_anomaly"]), candidate("source", "older-source", ["new_source", "late_linked_evidence"])];
    const r = await consumer.retainFollowUpConsumerInputs(db, o); expect(r.status).toBe("retained");
    expect(r.retainedPriorCarryForward).toEqual(o.previousCarryForward); const all = await collect();
    expect(all.candidates.find((c) => c.identity === id("older-source")).reasonCodes).toEqual(expect.arrayContaining(["new_source", "late_linked_evidence", "carry_forward"]));
    expect(all.candidates.find((c) => c.kind === "anomaly").reasonCodes).toEqual(["carry_forward", "terminal_anomaly"]);
  });
  it("rejects input union overflow without truncating existing durable unresolved work", async () => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained"); const retained = count(reasons);
    const o = input("overflow"); o.previousCarryForward.candidates = Array.from({ length: 200 }, (_, i) => candidate("evidence", `old-${i}`));
    const r = await consumer.retainFollowUpConsumerInputs(db, o); refused(r); expect(r.retainedPriorCarryForward.candidates).toHaveLength(200);
    expect(count(checkpoints)).toBe(1); expect(count(reasons)).toBe(retained);
  });
  it("does not label the frozen inventory's over200 refusal exhaustive current coverage", async () => {
    for (let i = 0; i < 200; i++) addSource(`extra-${i}`);
    const r = await consumer.retainFollowUpConsumerInputs(db, input()); refused(r); expect(count(checkpoints)).toBe(0); expect(r.inventoryCoverage).toBe("bounded_current_observation_only");
  });
  it("keeps candidate pagination bound to the immutable checkpoint despite concurrent additions", async () => {
    const first = input("first"); first.previousCarryForward.candidates = [candidate("evidence", "old")]; expect((await consumer.retainFollowUpConsumerInputs(db, first)).status).toBe("retained");
    const page = await consumer.readRetainedFollowUpCandidates(db, read({ limit: 1 })); expect(page.continuation).not.toBe(null);
    const next = input("next"); next.previousCarryForward.candidates = [candidate("evidence", "new")]; expect((await consumer.retainFollowUpConsumerInputs(db, next)).status).toBe("retained");
    const old = await collect(page.checkpoint.checkpointId, 1); expect(old.candidates).toHaveLength(4); expect(old.candidates.some((c) => c.identity === id("new"))).toBe(false);
    expect((await collect()).candidates).toHaveLength(5);
  });
  it.each(["digest", "candidate", "consumer", "checkpoint"])("rejects forged %s pagination ownership", async (kind) => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained"); const p = await consumer.readRetainedFollowUpCandidates(db, read({ limit: 1 }));
    const o = read({ checkpointId: p.checkpoint.checkpointId, cursor: { ...p.continuation } });
    if (kind === "digest") o.cursor.checkpointDigestSha256 = D("a"); else if (kind === "candidate") o.cursor.afterCandidateId = `evidence:${id("missing")}`;
    else if (kind === "consumer") o.consumerKey = "other-reader"; else o.checkpointId = `ckp_${D("b")}`;
    refused(await consumer.readRetainedFollowUpCandidates(db, o));
  });
  it.each(["checkpoint", "reason"])("rejects direct REPLACE of a %s with recursive triggers disabled", async (kind) => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained"); raw.exec("PRAGMA recursive_triggers=OFF");
    const table = kind === "checkpoint" ? checkpoints : reasons, row = { ...raw.prepare(`SELECT * FROM ${table} LIMIT 1`).get() }, fields = Object.keys(row);
    expect(() => raw.prepare(`INSERT OR REPLACE INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...fields.map((k) => row[k]))).toThrow(/consumer_/);
    expect(count(checkpoints)).toBe(1);
  });
  it.each([checkpoints, reasons])("makes%s immutable and undeletable", async (table) => {
    expect((await consumer.retainFollowUpConsumerInputs(db, input())).status).toBe("retained");
    expect(() => raw.prepare(`UPDATE ${table} SET consumer_key=consumer_key`).run()).toThrow(/immutable/);
    expect(() => raw.prepare(`DELETE FROM ${table}`).run()).toThrow(/immutable/);
  });
  it("snapshots every caller input before its first await", async () => {
    const o = input(), original = structuredClone(o); let mutated = false;
    db = connection(raw, { beforeStatement() { if (!mutated) { mutated = true; o.consumerKey = "changed"; o.inventoryOptions.cutoff.receivedStart = 0; o.previousCarryForward.candidates.push(candidate("evidence", "injected")); } } });
    const r = await consumer.retainFollowUpConsumerInputs(db, o); expect(r.status).toBe("retained"); expect(r.checkpoint.consumerId).toBe(id(original.consumerKey));
    expect(r.retainedPriorCarryForward).toEqual(original.previousCarryForward); expect((await collect()).candidates).toHaveLength(3);
  });
  it.each(["getter", "symbol", "prototype", "sparse", "cutoff", "authority", "bounds"])("rejects malformed%s before any database work", async (kind) => {
    const o = input(); let getterCalls = 0;
    if (kind === "getter") Object.defineProperty(o.inventoryOptions.cutoff, "receivedStart", { enumerable: true, get() { getterCalls++; return 0; } });
    else if (kind === "symbol") o[Symbol("secret")] = true;
    else if (kind === "prototype") Object.setPrototypeOf(o.inventoryOptions, { untrusted: true });
    else if (kind === "sparse") o.previousCarryForward.candidates = new Array(1);
    else if (kind === "cutoff") o.inventoryOptions.cutoff.receivedStart = o.inventoryOptions.cutoff.receivedEnd;
    else if (kind === "authority") o.authority = true;
    else o.inventoryOptions.limit = 201;
    refused(await consumer.retainFollowUpConsumerInputs(db, o)); expect(getterCalls).toBe(0); expect(db.operations).toHaveLength(0); expect(count(checkpoints)).toBe(0);
  });
  it.each([0, 201])("rejects journal page bounds %s before database work", async (pageSize) => {
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("invalid", { pageSize }))); expect(db.operations).toHaveLength(0);
  });
  it.each([0, 21])("rejects page budget bounds%s before database work", async (maxPages) => {
    refused(await consumer.advanceFollowUpConsumerPrefix(db, advance("invalid", { maxPages }))); expect(db.operations).toHaveLength(0);
  });
  it.each(["cardinality", "getter", "row", "metadata"])("handles%s D1 output without trusting raw fields or transport metadata", async (kind) => {
    await prepared(); let getters = 0;
    db = connection(raw, { batchResult(results, statements) {
      if (!statements[0].query.includes("follow_up_consumer_journal_v1")) return results;
      if (kind === "cardinality") return results.slice(1);
      if (kind === "getter") { Object.defineProperty(results[0], "results", { enumerable: true, get() { getters++; return []; } }); return results; }
      if (kind === "row") { results[0].results[0].row_json = '{"private-person":"secret"}'; return results; }
      for (const r of results) r.meta = { duration: 0.125 }; return results;
    } });
    const r = await consumer.advanceFollowUpConsumerPrefix(db, advance()); if (kind === "metadata") expect(r.status).toBe("advanced"); else refused(r);
    expect(getters).toBe(0); expect(JSON.stringify(r)).not.toContain("private-person");
  });
});
