import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../../functions/lib/follow-up-effect-evidence-store.js";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY as SCHEMA } from "../../functions/lib/reliability-schema-authority.js";

const family = "follow-up-session-reminders", D = (c) => c.repeat(64);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const production = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json", import.meta.url), "utf8"));
const sql = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
let raw, db, now, retention, workflowHash;
const workflow = { id: family, name: "Local effect fixture", version: 3, executionMode: "active", trigger: { calendarIds: ["calendar"], statuses: ["confirmed"], eventTypes: ["normal"] }, exits: [], nodes: [{ id: "confirmation", label: "Confirmation", at: "enroll", skipIfPast: false, action: { type: "sms", template: "confirmation" }, message: { audience: "client", channel: "sms", body: "Local test only" } }] };
workflow.nodes.push({ ...workflow.nodes[0], id: "reminder", action: { type: "sms", template: "reminder" } });
function connection(raw, hooks = {}) {
  const operations = [];
  return { operations, prepare(query) { return { query, args: [], bind(...args) { this.args = args; return this; },
    async first() { const r = raw.prepare(query).get(...this.args); const value = r ? { ...r } : null; return hooks.first ? hooks.first(query, value) : value; },
    async all() { const result = { success: true, results: raw.prepare(query).all(...this.args).map((r) => ({ ...r })), meta: { duration: 0.125, rows_written: 0 } }; return hooks.all ? hooks.all(query, result) : result; },
    async run() { const r = raw.prepare(query).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; },
  }; }, async batch(statements) {
    operations.push(statements.map((s) => s.query)); raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s, i) => { hooks.beforeStatement?.(s.query, i); const query = raw.prepare(s.query);
        if (query.columns().length) return { success: true, results: query.all(...s.args).map((r) => ({ ...r })), meta: { duration: 0.125, rows_written: 0 } };
        const r = query.run(...s.args); return { success: true, results: [], meta: { changes: Number(r.changes), duration: 0.125 } };
      }); raw.exec("COMMIT"); return hooks.batchResult ? hooks.batchResult(results) : results;
    } catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
}
function insert(table, row) { const keys = Object.keys(row); raw.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k])); }
function fullRow(table, overrides) {
  const row = {}; for (const c of raw.prepare(`SELECT name,type FROM pragma_table_info('${table}')`).all()) row[c.name] = c.type === "INTEGER" ? 1 : /sha256|digest/.test(c.name) ? D("a") : "fixture";
  return { ...row, ...overrides };
}
function seed() {
  // These are synthetic *relational* provenance records in the full promoted-v2
  // schema. Their signatures/canonical envelopes are not authenticated here.
  // No result from this candidate may claim runtime authenticity or authority.
  workflowHash = hash(canonicalJson(workflow)); const runtime = `${"a".repeat(40)}@follow-up-reminder-engine.v3`;
  insert("workflow_versions", { workflow_id: family, version: 3, state: "published", document: canonicalJson(workflow), created_at: now - 20000, published_at: now - 15000 });
  insert("source_events", { source_event_id: "source-a", provider: "ghl", family, identity_version: 1, identity_key: "fixture-source-a", payload_sha256: D("b"), normalized_retention_until: retention, occurred_at: now - 1000, received_at: now - 1000, authentication_result: "authenticated", normalization_state: "normalized", normalized_json: "{}", state: "accepted", source_version: "ghl:appointment-events-webhook:v7", runtime_version: runtime, accepted_at: now - 1000, created_at: now - 1000 });
  insert("lifecycle_instances", { lifecycle_instance_id: "life-a", source_event_id: "source-a", family, scope: "confirmed-normal-follow-up", person_id: "private-person", appointment_id: "private-appointment", definition_version: 3, runtime_version: runtime, state: "active", retention_until: retention, created_at: now - 1000, updated_at: now - 1000 });
  insert("lifecycle_obligations", { obligation_id: "obligation-a", lifecycle_instance_id: "life-a", obligation_key: "confirmation", kind: "client_sms", family, deadline_at: now, owner_role: "system", closer: "provider_receipt", state: "pending", retention_until: retention, created_at: now - 1000, updated_at: now - 1000 });
  const common = { release_manifest_id: `relm_${D("a")}`, release_manifest_digest: D("a"), source_revision: "a".repeat(40), source_tree: "b".repeat(40), worker_version: "follow-up-reminder-engine.v3", runtime_version: runtime, workflow_id: family, workflow_version: 3, workflow_document_sha256: workflowHash, schema_database_id: "fixture-db", schema_migration_id: SCHEMA.migrationId, schema_version: 2, schema_structure_sha256: SCHEMA.structureSha256, follow_up_delivery_release: "approved", follow_up_assigned_user_delivery: "approved", canonical_json: "{}", retention_until: retention };
  insert("automation_release_manifests", fullRow("automation_release_manifests", { ...common, family, workflow_state: "published", created_at: now - 20000 }));
  insert("automation_deployment_attestations", fullRow("automation_deployment_attestations", { ...common, deployment_attestation_id: `depatt_${D("b")}`, platform: "cloudflare", service: "reminder-engine", environment: "production", deployment_id: "fixture-deployment", version_id: "fixture-version", traffic_percent: 100, authentication_method: "ed25519", authentication_signature: "a".repeat(128), observed_at: now - 12000, attested_at: now - 10000, recorded_at: now - 9000, expires_at: now + 600000 }));
  insert("source_event_runtime_provenance", { source_event_id: "source-a", lifecycle_instance_id: "life-a", invocation_id: "fixture-invocation", deployment_attestation_id: `depatt_${D("b")}`, cloudflare_version_id: "fixture-version", workflow_document_sha256_at_bind: workflowHash, schema_structure_sha256_at_bind: SCHEMA.structureSha256, follow_up_delivery_release_at_bind: "approved", follow_up_assigned_user_delivery_at_bind: "approved", bound_at: now - 1000, retention_until: retention });
}
beforeEach(() => {
  raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON");
  for (const type of ["table", "index", "trigger"]) for (const row of production.projection.filter((r) => r.type === type)) raw.exec(row.sql);
  insert("reliability_schema_versions", production.marker[0]);
  for (const name of ["reliability-spine-v2-production-lineage-install.local.sql", "reliability-spine-v2-production-lineage-promote.local.sql"]) { raw.exec("BEGIN IMMEDIATE"); try { raw.exec(sql(name)); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } }
  now = Math.floor(Date.now() / 1000) * 1000; retention = now + 86400000;
  seed(); raw.exec(sql("reliability-effect-evidence.candidate.sql")); db = connection(raw);
  raw.prepare("UPDATE lifecycle_obligations SET state='leased',lease_owner='fixture-executor',lease_acquired_at=?,lease_expires_at=? WHERE obligation_id='obligation-a'").run(now - 500, now + 300000);
  insert("obligation_lease_events", { lease_event_id: "lease-a", obligation_id: "obligation-a", event_type: "acquired", previous_owner: null, new_owner: "fixture-executor", lease_acquired_at: now - 500, lease_expires_at: now + 300000, retention_until: retention });
});
afterEach(() => raw?.close());
function prepareInput(patch = {}) { return { commandAttemptId: "attempt-a", sourceEventId: "source-a", lifecycleInstanceId: "life-a", obligationId: "obligation-a", leaseEventId: "lease-a", workflowId: family, workflowVersion: 3, workflowDocumentSha256: workflowHash, nodeId: "confirmation", acceptanceDeploymentAttestationId: `depatt_${D("b")}`, executorDeploymentAttestationId: `depatt_${D("b")}`, executorRuntimeVersion: `${"a".repeat(40)}@follow-up-reminder-engine.v3`, provider: "ghl", providerAccountScope: "account-fixture", idempotencyKey: "effect-a", attemptNumber: 1, retryClass: "manual_ambiguous", target: "ghl", requestSha256: D("c"), renderedCopySha256: D("d"), eventId: "event-prepared", occurrenceAt: now - 500, detailSha256: D("e"), retentionUntil: retention, ...patch }; }
const count = (table) => Number(raw.prepare(`SELECT count(*) n FROM ${table}`).get().n);
const databaseNow = () => raw.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER) n").get().n;
const command = () => ({ ...raw.prepare("SELECT * FROM command_attempts WHERE command_attempt_id='attempt-a'").get() });
function observation(sequence, patch = {}) { return { commandAttemptId: "attempt-a", eventId: "event-submitted", expectedSequence: sequence, fromState: "prepared", toState: "submitted", providerReference: "private-message-reference", errorCode: null, occurrenceAt: databaseNow(), detailSha256: D("f"), ...patch }; }
function receipt(patch = {}) { return { commandAttemptId: "attempt-a", eventId: "event-receipt", providerReceiptId: "receipt-a", provider: "ghl", providerAccountScope: "account-fixture", providerReference: "private-message-reference", proofLevel: "accepted", evidenceSha256: D("f"), observedAt: databaseNow(), detailSha256: D("e"), ...patch }; }
async function submitted() { const p = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(p.status).toBe("prepared"); const input = observation(p.sequence); const s = await store.appendFollowUpEffectObservation(db, input); expect(s.status).toBe("recorded"); return { ...s, input }; }
async function secondSubmitted() {
  insert("lifecycle_obligations", { obligation_id: "obligation-b", lifecycle_instance_id: "life-a", obligation_key: "reminder", kind: "client_sms", family, deadline_at: now, owner_role: "system", closer: "provider_receipt", state: "leased", lease_owner: "fixture-executor", lease_acquired_at: now - 500, lease_expires_at: now + 300000, retention_until: retention, created_at: now - 1000, updated_at: now - 1000 });
  insert("obligation_lease_events", { lease_event_id: "lease-b", obligation_id: "obligation-b", event_type: "acquired", previous_owner: null, new_owner: "fixture-executor", lease_acquired_at: now - 500, lease_expires_at: now + 300000, retention_until: retention });
  const p = await store.prepareFollowUpEffectAttempt(db, prepareInput({ commandAttemptId: "attempt-b", obligationId: "obligation-b", leaseEventId: "lease-b", nodeId: "reminder", idempotencyKey: "effect-b", eventId: "event-prepared-b" }));
  expect(p.status).toBe("prepared");
  expect(await store.appendFollowUpEffectObservation(db, observation(p.sequence, { commandAttemptId: "attempt-b", eventId: "event-submitted-b" }))).toMatchObject({ status: "recorded" });
}
describe("durable effect candidate against actual promoted-v2 SQLite", () => {
  it("uses full production-v2 schema with real provenance constraints", () => {
    expect(raw.prepare("SELECT structure_sha256 FROM reliability_schema_contracts WHERE version=2").get().structure_sha256).toBe(SCHEMA.structureSha256);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]); expect(count("source_event_runtime_provenance")).toBe(1);
  });
  it("atomically prepares an attempt, exact binding and database-ingested event before any transport", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try { const r = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(r).toMatchObject({ status: "prepared", durable: true, authority: false, dispatchAllowed: false });
      expect(count("command_attempts")).toBe(1); expect(count("follow_up_effect_attempt_bindings")).toBe(1); expect(count("follow_up_effect_evidence_events")).toBe(1); expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it.each([
    { sourceEventId: "missing" }, { lifecycleInstanceId: "missing" }, { obligationId: "missing" },
    { nodeId: "not-the-obligation" }, { workflowVersion: 99 }, { workflowDocumentSha256: D("f") },
    { acceptanceDeploymentAttestationId: `depatt_${D("c")}` }, { executorDeploymentAttestationId: `depatt_${D("c")}` },
    { executorRuntimeVersion: "wrong-runtime" }, { leaseEventId: "missing" }, { provider: "gmail", target: "gmail" },
  ])("refuses missing/cross-linked exact execution evidence %j before preparing", async (patch) => {
    const r = await store.prepareFollowUpEffectAttempt(db, prepareInput(patch)); expect(r.status).toBe("refused");
    expect(count("command_attempts")).toBe(0); expect(count("follow_up_effect_attempt_bindings")).toBe(0); expect(count("follow_up_effect_evidence_events")).toBe(0);
  });
  it("replays identical preparation without appending and refuses changed request identity", async () => {
    const input = prepareInput(), before = structuredClone(input);
    const first = await store.prepareFollowUpEffectAttempt(db, input), replay = await store.prepareFollowUpEffectAttempt(db, input);
    expect(first.status).toBe("prepared"); expect(replay.status).toBe("replayed"); expect(replay.sequence).toBe(first.sequence);
    expect(await store.prepareFollowUpEffectAttempt(db, prepareInput({ requestSha256: D("f") }))).toMatchObject({ status: "refused" });
    expect(input).toEqual(before); expect(count("command_attempts")).toBe(1); expect(count("follow_up_effect_evidence_events")).toBe(1);
  });
  it("two real SQLite connections converge identical concurrent preparation to one durable effect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "amari-effect-test-")), path = join(directory, "race.sqlite");
    let left, right;
    try {
      raw.prepare("VACUUM INTO ?").run(path); left = new DatabaseSync(path); right = new DatabaseSync(path);
      left.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000"); right.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000");
      const results = await Promise.all([store.prepareFollowUpEffectAttempt(connection(left), prepareInput()), store.prepareFollowUpEffectAttempt(connection(right), prepareInput())]);
      expect(results.map((r) => r.status).sort()).toEqual(["prepared", "replayed"]); expect(results[0].sequence).toBe(results[1].sequence);
      expect(left.prepare("SELECT count(*) n FROM command_attempts").get().n).toBe(1); expect(left.prepare("SELECT count(*) n FROM follow_up_effect_evidence_events").get().n).toBe(1);
    } finally { left?.close(); right?.close(); rmSync(directory, { recursive: true }); }
  });
  it("rolls back all pre-effect rows when a later statement aborts", async () => {
    raw.exec("CREATE TRIGGER local_abort_binding BEFORE INSERT ON follow_up_effect_attempt_bindings BEGIN SELECT RAISE(ABORT,'local test abort'); END");
    expect(await store.prepareFollowUpEffectAttempt(db, prepareInput())).toMatchObject({ status: "refused" });
    expect(count("command_attempts")).toBe(0); expect(count("follow_up_effect_attempt_bindings")).toBe(0); expect(count("follow_up_effect_evidence_events")).toBe(0);
  });
  it("records submitted then ambiguous and never authorizes a resend", async () => {
    const s = await submitted();
    const input = observation(s.sequence, { eventId: "event-ambiguous", fromState: "submitted", toState: "ambiguous", errorCode: "transport_timeout" });
    expect(await store.appendFollowUpEffectObservation(db, input)).toMatchObject({ status: "recorded", dispatchAllowed: false });
    expect(command().state).toBe("ambiguous");
    expect(await store.appendFollowUpEffectObservation(db, observation(s.sequence, { eventId: "event-resend", fromState: "ambiguous" }))).toMatchObject({ status: "refused" });
    expect(count("follow_up_effect_evidence_events")).toBe(3);
  });
  it("cannot launder ambiguity through retryable into another same-attempt submission", async () => {
    const s = await submitted(); const ambiguous = await store.appendFollowUpEffectObservation(db, observation(s.sequence, { eventId: "timeout", fromState: "submitted", toState: "ambiguous", errorCode: "transport_timeout" }));
    const retry = await store.appendFollowUpEffectObservation(db, observation(ambiguous.sequence, { eventId: "retryable", fromState: "ambiguous", toState: "failed_retryable", errorCode: "retryable" }));
    const current = command(), last = retry.sequence || ambiguous.sequence;
    expect(await store.appendFollowUpEffectObservation(db, observation(last, { eventId: "unsafe-resend", fromState: current.state, toState: "submitted" }))).toMatchObject({ status: "refused", durable: false });
    expect(command().state).not.toBe("submitted");
  });
  it("retains a late timeout observation after the current execution lease has expired", async () => {
    const s = await submitted(); raw.prepare("UPDATE lifecycle_obligations SET lease_expires_at=? WHERE obligation_id='obligation-a'").run(now - 1);
    expect(await store.appendFollowUpEffectObservation(db, observation(s.sequence, { eventId: "late-timeout", fromState: "submitted", toState: "ambiguous", errorCode: "transport_timeout" }))).toMatchObject({ status: "recorded", dispatchAllowed: false });
    expect(command().state).toBe("ambiguous");
  });
  it("atomically refuses workflow document change between pre-read and binding insertion", async () => {
    let changed = false;
    db = connection(raw, { beforeStatement(query) { if (!changed && /INSERT\s+INTO\s+command_attempts/i.test(query)) { changed = true; const altered = structuredClone(workflow); altered.nodes[0].message.body = "Changed after validation"; raw.prepare("UPDATE workflow_versions SET document=? WHERE workflow_id=? AND version=3").run(canonicalJson(altered), family); } } });
    const r = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(changed).toBe(true); expect(r.status).toBe("refused"); expect(count("command_attempts")).toBe(0); expect(count("follow_up_effect_evidence_events")).toBe(0);
  });
  it("CAS rejects stale sequence/state without appending false audit evidence", async () => {
    const s = await submitted(), before = command();
    expect(await store.appendFollowUpEffectObservation(db, observation(s.sequence - 1, { eventId: "stale-new-id" }))).toMatchObject({ status: "refused" });
    expect(command()).toEqual(before); expect(count("follow_up_effect_evidence_events")).toBe(2);
  });
  it("CAS command-projection failure rolls journal insertion back", async () => {
    const p = await store.prepareFollowUpEffectAttempt(db, prepareInput());
    raw.exec("CREATE TRIGGER local_abort_projection BEFORE UPDATE ON command_attempts BEGIN SELECT RAISE(ABORT,'local projection abort'); END");
    expect(await store.appendFollowUpEffectObservation(db, observation(p.sequence))).toMatchObject({ status: "refused" });
    expect(command().state).toBe("prepared"); expect(count("follow_up_effect_evidence_events")).toBe(1);
  });
  it("transaction-time journal projection check defeats a forged command-state race", async () => {
    const p = await store.prepareFollowUpEffectAttempt(db, prepareInput()); let changed = false;
    db = connection(raw, { beforeStatement(query) { if (!changed && /INSERT\s+INTO\s+follow_up_effect_evidence_events/i.test(query)) { changed = true; raw.exec("UPDATE command_attempts SET state='submitted' WHERE command_attempt_id='attempt-a'"); } } });
    const r = await store.appendFollowUpEffectObservation(db, observation(p.sequence, { eventId: "raced-observation", fromState: "submitted", toState: "ambiguous", errorCode: "transport_timeout" }));
    expect(changed).toBe(true); expect(r).toMatchObject({ status: "refused", durable: false }); expect(command().state).toBe("prepared"); expect(count("follow_up_effect_evidence_events")).toBe(1);
  });
  it("records accepted then delivered without closing the obligation", async () => {
    await submitted();
    expect(await store.recordFollowUpEffectReceipt(db, receipt())).toMatchObject({ status: "recorded", outcomeProven: false });
    expect(await store.recordFollowUpEffectReceipt(db, receipt({ eventId: "event-delivered", providerReceiptId: "receipt-delivered", proofLevel: "delivered" }))).toMatchObject({ status: "recorded" });
    expect(count("provider_receipts")).toBe(2); expect(raw.prepare("SELECT state FROM lifecycle_obligations").get().state).toBe("leased");
  });
  it.each([{ provider: "gmail" }, { providerAccountScope: "other-account" }, { providerReference: "other-message" }, { evidenceSha256: "not-a-digest" }, { proofLevel: "sent" }])("refuses unlinked or malformed receipt evidence %j", async (patch) => {
    await submitted(); const r = await store.recordFollowUpEffectReceipt(db, receipt(patch)); expect(r).toMatchObject({ status: "refused", durable: false });
    expect(count("provider_receipts")).toBe(0); expect(count("follow_up_effect_evidence_events")).toBe(2);
  });
  it("refuses future observed receipt clocks without persisting either projection", async () => {
    await submitted(); expect(await store.recordFollowUpEffectReceipt(db, receipt({ observedAt: databaseNow() + 600000 }))).toMatchObject({ status: "refused", durable: false });
    expect(count("provider_receipts")).toBe(0); expect(count("follow_up_effect_evidence_events")).toBe(2);
  });
  it("retains conflicting terminal receipts as conflict, never last-wins success", async () => {
    await submitted(); await store.recordFollowUpEffectReceipt(db, receipt({ proofLevel: "delivered" }));
    const conflictInput = receipt({ eventId: "event-bounced", providerReceiptId: "receipt-bounced", proofLevel: "bounced" });
    const r = await store.recordFollowUpEffectReceipt(db, conflictInput);
    expect(r).toMatchObject({ status: "recorded_conflict", outcomeProven: false }); expect(count("provider_receipts")).toBe(2);
    const replay = await store.recordFollowUpEffectReceipt(db, conflictInput);
    expect(replay.status === "recorded_conflict" || replay.status === "replayed" && replay.reasonCodes.some((code) => /conflict/.test(code))).toBe(true);
    expect(count("provider_receipts")).toBe(2); expect(replay.outcomeProven).toBe(false);
  });
  it("refuses replay when mutable canonical command projection no longer matches journal evidence", async () => {
    const s = await submitted(); raw.prepare("UPDATE command_attempts SET request_sha256=? WHERE command_attempt_id='attempt-a'").run(D("0"));
    const r = await store.appendFollowUpEffectObservation(db, s.input); expect(r.status).toBe("refused"); expect(r.durable).toBe(false);
    expect(count("follow_up_effect_evidence_events")).toBe(2);
  });
  it("refuses receipt replay when canonical receipt projection has been corrupted", async () => {
    await submitted(); const input = receipt(); await store.recordFollowUpEffectReceipt(db, input);
    raw.prepare("UPDATE provider_receipts SET evidence_sha256=? WHERE provider_receipt_id='receipt-a'").run(D("0"));
    const r = await store.recordFollowUpEffectReceipt(db, input); expect(r.status).toBe("refused"); expect(r.durable).toBe(false); expect(count("provider_receipts")).toBe(1);
  });
  it("replays exact receipt and refuses identity-content collisions", async () => {
    await submitted(); const input = receipt(), a = await store.recordFollowUpEffectReceipt(db, input);
    const b = await store.recordFollowUpEffectReceipt(db, input); expect(b.status).toBe("replayed"); expect(b.sequence).toBe(a.sequence);
    expect(await store.recordFollowUpEffectReceipt(db, receipt({ evidenceSha256: D("a") }))).toMatchObject({ status: "refused" });
    expect(count("provider_receipts")).toBe(1);
  });
  it("refuses receipt identity reuse across real separately bound attempts", async () => {
    await submitted(); await secondSubmitted(); await store.recordFollowUpEffectReceipt(db, receipt());
    expect(await store.recordFollowUpEffectReceipt(db, receipt({ commandAttemptId: "attempt-b", eventId: "receipt-cross-attempt" }))).toMatchObject({ status: "refused" });
    expect(count("provider_receipts")).toBe(1);
    expect(raw.prepare("SELECT command_attempt_id FROM provider_receipts").get().command_attempt_id).toBe("attempt-a");
  });
  it("refuses provider-reference alias reuse even under a different receipt primary key", async () => {
    await submitted(); await secondSubmitted(); await store.recordFollowUpEffectReceipt(db, receipt());
    expect(await store.recordFollowUpEffectReceipt(db, receipt({ commandAttemptId: "attempt-b", eventId: "alias-event", providerReceiptId: "alias-receipt", proofLevel: "delivered" }))).toMatchObject({ status: "refused" });
    expect(count("provider_receipts")).toBe(1);
  });
  it("refuses expired or taken-over execution lease before preparing", async () => {
    raw.prepare("UPDATE lifecycle_obligations SET lease_expires_at=? WHERE obligation_id='obligation-a'").run(now - 1);
    expect(await store.prepareFollowUpEffectAttempt(db, prepareInput())).toMatchObject({ status: "refused" }); expect(count("command_attempts")).toBe(0);
  });
  it("refuses genuinely missing acceptance provenance rather than trusting supplied attestation IDs", async () => {
    // Deliberately corrupt only this in-memory fixture to exercise readback failure.
    raw.exec("DROP TRIGGER source_event_runtime_provenance_no_delete; DELETE FROM source_event_runtime_provenance");
    expect(await store.prepareFollowUpEffectAttempt(db, prepareInput())).toMatchObject({ status: "refused", durable: false }); expect(count("command_attempts")).toBe(0);
  });
  it("does not invoke caller getters or accept injected ingestion clocks", async () => {
    let called = 0; const input = prepareInput(); Object.defineProperty(input, "nodeId", { enumerable: true, get() { called++; return "confirmation"; } });
    expect(await store.prepareFollowUpEffectAttempt(db, input)).toMatchObject({ status: "refused" }); expect(called).toBe(0);
    expect(await store.prepareFollowUpEffectAttempt(db, prepareInput({ ingestedAt: now }))).toMatchObject({ status: "refused" }); expect(count("command_attempts")).toBe(0);
  });
  it("candidate attempt binding and event history cannot be updated or deleted", async () => {
    await submitted();
    expect(() => raw.exec("UPDATE follow_up_effect_attempt_bindings SET command_attempt_id='mutated'")).toThrow();
    expect(() => raw.exec("DELETE FROM follow_up_effect_attempt_bindings")).toThrow();
    expect(() => raw.exec("DELETE FROM follow_up_effect_evidence_events")).toThrow();
  });
  it.each(["follow_up_effect_attempt_bindings", "follow_up_effect_evidence_events"])("blocks INSERT OR REPLACE on %s even with recursive triggers disabled", async (table) => {
    await submitted(); raw.exec("PRAGMA recursive_triggers=OFF"); const row = { ...raw.prepare(`SELECT * FROM ${table} LIMIT 1`).get() }, keys = Object.keys(row);
    expect(() => raw.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]))).toThrow();
    expect({ ...raw.prepare(`SELECT * FROM ${table} LIMIT 1`).get() }).toEqual(row);
  });
  it("accepts real AUTOINCREMENT allocation gaps without inventing missing journal events", async () => {
    const p = await store.prepareFollowUpEffectAttempt(db, prepareInput());
    expect(raw.prepare("UPDATE sqlite_sequence SET seq=seq+5 WHERE name='follow_up_effect_evidence_events'").run().changes).toBe(1);
    const s = await store.appendFollowUpEffectObservation(db, observation(p.sequence)); expect(s.status).toBe("recorded"); expect(s.sequence).toBe(p.sequence + 6);
    const read = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(read.status).toBe("observed"); expect(read.rows).toHaveLength(2); expect(read.traversalComplete).toBe(true);
    expect(await store.readFollowUpEffectEvidenceJournal(db, { afterSequence: p.sequence + 1, throughSequence: read.throughSequence, boundary: read.boundary })).toMatchObject({ status: "refused" });
    expect(await store.readFollowUpEffectEvidenceJournal(db, { afterSequence: p.sequence })).toMatchObject({ status: "refused" });
  });
  it("refuses frozen-boundary tampering, foreign boundary and future high-water cursors", async () => {
    await submitted(); const first = await store.readFollowUpEffectEvidenceJournal(db, { limit: 1 });
    for (const patch of [{ throughSequence: first.throughSequence + 100 }, { boundary: { ...first.boundary, eventDigestSha256: D("0") } }, { boundary: { ...first.boundary, eventIdSha256: D("0") } }]) {
      const r = await store.readFollowUpEffectEvidenceJournal(db, { afterSequence: first.nextSequence, throughSequence: first.throughSequence, boundary: first.boundary, limit: 1, ...patch });
      expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
    }
  });
  it("does not call retained journal healthy when its actual lifecycle parent has expired", async () => {
    await submitted(); raw.prepare("UPDATE lifecycle_instances SET retention_until=? WHERE lifecycle_instance_id='life-a'").run(now - 1);
    const r = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
  });
  it("revalidates an expired high-water parent even when the continuation tail is empty", async () => {
    await submitted(); const first = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(first.status).toBe("observed");
    raw.prepare("UPDATE lifecycle_instances SET retention_until=? WHERE lifecycle_instance_id='life-a'").run(now - 1);
    const r = await store.readFollowUpEffectEvidenceJournal(db, { afterSequence: first.throughSequence, throughSequence: first.throughSequence, boundary: first.boundary, limit: 50 });
    expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
  });
  it("refuses journal traversal after an actual linked parent is missing", async () => {
    await submitted(); raw.exec("PRAGMA foreign_keys=OFF; DELETE FROM lifecycle_instances WHERE lifecycle_instance_id='life-a'");
    const r = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
  });
  it("refuses malformed returned journal rows rather than silently omitting them", async () => {
    await submitted();
    db = connection(raw, { all: (query, result) => /follow_up_effect_evidence_events/.test(query) ? { ...result, results: [null] } : result,
      batchResult: (results) => results.map((r) => r.results?.length ? { ...r, results: [null] } : r) });
    const r = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
  });
  it.each([
    { event_type: "PRIVATE_BAD_ENUM" }, { state_after: "PRIVATE_BAD_ENUM" }, { proof_level: "PRIVATE_BAD_ENUM" },
    { provider: "PRIVATE_BAD_ENUM" }, { occurrence_at: "PRIVATE_BAD_CLOCK" },
  ])("refuses malformed non-null assertion fields in real event result %j", async (patch) => {
    await submitted();
    db = connection(raw, { batchResult: (results) => results.map((result) => ({ ...result, results: result.results.map((row) => Object.hasOwn(row, "event_type") ? { ...row, ...patch } : row) })) });
    const r = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(r.status).toBe("refused"); expect(r.traversalComplete).not.toBe(true);
    expect(JSON.stringify(r)).not.toContain("PRIVATE_BAD");
  });
  it("late receipt retains old observation time but gets new DB ingestion sequence/time", async () => {
    const s = await submitted();
    const observedAt = command().created_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    raw.prepare("UPDATE lifecycle_obligations SET lease_expires_at=? WHERE obligation_id='obligation-a'").run(now - 1);
    const r = await store.recordFollowUpEffectReceipt(db, receipt({ observedAt }));
    expect(r.status).toBe("recorded"); expect(r.sequence).toBeGreaterThan(s.sequence); expect(r.ingestedAt).toBeGreaterThan(observedAt);
    expect(raw.prepare("SELECT observed_at FROM provider_receipts").get().observed_at).toBe(observedAt);
  });
  it("uses fixed-H pagination while later events arrive, then reads those on a new traversal", async () => {
    await submitted(); const first = await store.readFollowUpEffectEvidenceJournal(db, { limit: 1 });
    expect(first.status).toBe("observed"); expect(first.rows).toHaveLength(1); expect(first.hasMore).toBe(true);
    await store.recordFollowUpEffectReceipt(db, receipt());
    const second = await store.readFollowUpEffectEvidenceJournal(db, { afterSequence: first.nextSequence, throughSequence: first.throughSequence, boundary: first.boundary, limit: 1 });
    expect(second.status).toBe("observed"); expect(second.rows).toHaveLength(1); expect(second.hasMore).toBe(false); expect(second.traversalComplete).toBe(true);
    const current = await store.readFollowUpEffectEvidenceJournal(db, { limit: 50 }); expect(current.rows).toHaveLength(3);
    const rendered = JSON.stringify(current); expect(rendered).not.toContain("private-message-reference"); expect(rendered).not.toContain("account-fixture"); expect(rendered).not.toContain("private-person");
  });
  it.each([{ afterSequence: -1 }, { limit: 0 }, { limit: 100000 }, { afterSequence: 2, throughSequence: 1 }, { throughSequence: 1 }])("refuses invalid/unbound cursor %j", async (input) => {
    expect(await store.readFollowUpEffectEvidenceJournal(db, input)).toMatchObject({ status: "refused" });
  });
  it.each([null, false, undefined, { success: false, error: "private database error" }])("does not claim durable success from broken batch result %j", async (value) => {
    db = connection(raw, { batchResult: () => value });
    const r = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(r.status).toBe("refused"); expect(r.durable).toBe(false); expect(JSON.stringify(r)).not.toContain("private database error");
  });
  it.each(["null", "undefined", "sparse", "failed"])("refuses a malformed middle batch statement (%s) even after an uncertain commit", async (kind) => {
    db = connection(raw, { batchResult(results) { const bad = results.slice(); if (kind === "sparse") delete bad[1]; else bad[1] = kind === "null" ? null : kind === "undefined" ? undefined : { success: false, results: [], error: "private statement failure" }; return bad; } });
    const r = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(r).toMatchObject({ status: "refused", durable: false }); expect(JSON.stringify(r)).not.toContain("private statement failure");
    // The transport result is unknown, not a claim the transaction rolled back.
    // Retrying the *same* identity with a working connection must safely read back.
    db = connection(raw); const retry = await store.prepareFollowUpEffectAttempt(db, prepareInput()); expect(["prepared", "replayed"]).toContain(retry.status);
    expect(count("command_attempts")).toBe(1); expect(count("follow_up_effect_evidence_events")).toBe(1);
  });
  it("keeps the three inert evidence modules isolated from every other production module and schema route", () => {
    const root = new URL("../../", import.meta.url), violations = [];
    function visit(dir) {
      for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
        if (["node_modules", ".git", ".wrangler", ".vite"].includes(entry.name)) continue;
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) { visit(`${path}/`); continue; }
        if (!/\.(?:js|mjs|cjs|ts|tsx|json|toml|sql)$/.test(path) || /(?:\.test\.|\.spec\.|\/fixtures\/)/.test(path)
          || ["functions/lib/follow-up-effect-evidence-store.js", "functions/lib/follow-up-evidence-composition.js", "functions/lib/follow-up-consumer-retention-store.js"].includes(path)) continue;
        const source = readFileSync(new URL(path, root), "utf8");
        if (/follow-up-effect-evidence-store|follow-up-evidence-composition|follow-up-consumer-retention-store|reliability-effect-evidence\.candidate|reliability-consumer-retention\.candidate/.test(source)) violations.push(path);
      }
    }
    visit(""); expect(violations).toEqual([]);
  });
});
