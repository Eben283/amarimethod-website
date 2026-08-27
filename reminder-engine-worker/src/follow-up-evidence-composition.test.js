import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeFollowUpEvidenceComposition as compose, FOLLOW_UP_EVIDENCE_COMPOSITION_CONTRACT } from "../../functions/lib/follow-up-evidence-composition.js";
import * as journal from "../../functions/lib/follow-up-effect-evidence-store.js";
import * as inventory from "../../functions/lib/follow-up-current-inventory.js";
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

// Actual SQLite statements/transactions behind the async D1-shaped API. No
// canned assertion rows. Candidate SQL is applied only to this local fixture.
function connection(database, hooks = {}) {
  const operations = [];
  return { operations, prepare(query) { return { query, args: [], bind(...args) { this.args = args; return this; } }; },
    async batch(statements) {
      operations.push(statements.map((s) => s.query));
      database.exec("BEGIN IMMEDIATE");
      let results;
      try {
        results = statements.map((s, index) => {
          hooks.beforeStatement?.(s.query, index);
          const q = database.prepare(s.query);
          if (q.columns().length) return { success: true, results: q.all(...s.args).map((r) => ({ ...r })), meta: { duration: 0.125, rows_written: 0, changed_db: false } };
          const r = q.run(...s.args); return { success: true, results: [], meta: { changes: Number(r.changes), duration: 0.125 } };
        });
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
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
  if (candidate) raw.exec(sql("reliability-effect-evidence.candidate.sql"));
  db = connection(raw);
}
const databaseNow = () => raw.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER) n").get().n;
function prepareInput(suffix = "a", patch = {}) { return { commandAttemptId: `attempt-${suffix}`, sourceEventId: "source-a", lifecycleInstanceId: "life-a", obligationId: `obligation-${suffix}`, leaseEventId: `lease-${suffix}`, workflowId: family, workflowVersion: 3, workflowDocumentSha256: workflowHash, nodeId: suffix === "a" ? "confirmation" : "reminder", acceptanceDeploymentAttestationId: `depatt_${D("b")}`, executorDeploymentAttestationId: `depatt_${D("b")}`, executorRuntimeVersion: runtime, provider: "ghl", providerAccountScope: "account-fixture", idempotencyKey: `effect-${suffix}`, attemptNumber: 1, retryClass: "manual_ambiguous", target: "ghl", requestSha256: D("c"), renderedCopySha256: D("d"), eventId: `event-prepared-${suffix}`, occurrenceAt: now - 500, detailSha256: D("e"), retentionUntil: retention, ...patch }; }
function observation(sequence, suffix = "a", patch = {}) { return { commandAttemptId: `attempt-${suffix}`, eventId: `event-submitted-${suffix}`, expectedSequence: sequence, fromState: "prepared", toState: "submitted", providerReference: `private-reference-${suffix}`, errorCode: null, occurrenceAt: databaseNow(), detailSha256: D("f"), ...patch }; }
function receipt(patch = {}) { return { commandAttemptId: "attempt-a", eventId: "event-receipt-a", providerReceiptId: "receipt-a", provider: "ghl", providerAccountScope: "account-fixture", providerReference: "private-reference-a", proofLevel: "accepted", evidenceSha256: D("f"), observedAt: databaseNow(), detailSha256: D("e"), ...patch }; }
async function prepared(suffix = "a") { const result = await journal.prepareFollowUpEffectAttempt(db, prepareInput(suffix)); expect(result.status).toBe("prepared"); return result; }
async function submitted(suffix = "a") { const p = await prepared(suffix); const s = await journal.appendFollowUpEffectObservation(db, observation(p.sequence, suffix)); expect(s.status).toBe("recorded"); return s; }
async function received(patch = {}) { const r = await journal.recordFollowUpEffectReceipt(db, receipt(patch)); expect(["recorded", "recorded_conflict"]).toContain(r.status); return r; }
function options(patch = {}) {
  const readAt = databaseNow();
  return { inventoryOptions: { readAt, limit: 200, cutoff: { receivedStart: now - 60000, receivedEnd: readAt, ingestedStart: now - 60000, ingestedEnd: now - 30000, plannedAt: readAt, maxPages: 1, maxCandidates: 200 } },
    previousCarryForward: { candidates: [], cursor: null }, journalPageSize: 200, maxJournalPages: 20, maxCandidates: 200, ...patch };
}
function candidate(kind, rawId, reasonCodes = ["carry_forward"]) { const identity = id(rawId); return { candidateId: `${kind}:${identity}`, family, kind, identity, reasonCodes, unresolved: true }; }
function checkFlags(r) {
  expect(r).toMatchObject({ contract: FOLLOW_UP_EVIDENCE_COMPOSITION_CONTRACT, simulation: true, sourceOnly: true, retainPreviousCarryForward: true,
    authority: false, authoritativeCoverage: false, producerAdopted: false, dispatchAllowed: false, outcomeProven: false,
    replacementAllowed: false, watermarkAdvanceAllowed: false, observationScope: "separate_inventory_read_and_fixed_journal_boundary" });
  expect(r.reasonCodes).toEqual(expect.arrayContaining(["provider_coverage_unproven", "stored_structural_links_only", "separate_observation_scopes"]));
}
function checkFailure(r, prior = null, code) {
  checkFlags(r); expect(r).toMatchObject({ status: "incomplete", candidates: [], journalEvidence: [], proposedCarryForward: null,
    inputDigestSha256: null, retainedPriorCarryForward: prior, previousCarryForwardValidated: prior !== null });
  if (code) expect(r.reasonCodes).toContain(code);
}
function tamperJournal(mutate) {
  const original = journal.readFollowUpEffectEvidenceJournal; let page = 0;
  return vi.spyOn(journal, "readFollowUpEffectEvidenceJournal").mockImplementation(async (...args) => {
    const result = structuredClone(await original(...args)); return mutate(result, ++page, args[1]) ?? result;
  });
}
beforeEach(() => boot());
afterEach(() => { vi.restoreAllMocks(); raw?.close(); });

describe("source-only evidence composition over actual SQLite and frozen D1 readers", () => {
  it("composes empty journal/current inventory with a zero boundary and no completeness authority", async () => {
    const r = await compose(db, options()); checkFlags(r);
    expect(r).toMatchObject({ status: "composed", journalTraversalComplete: true, journalPagesRead: 1, journalEvidence: [],
      journalBoundary: { contract: journal.FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, throughSequence: 0, eventIdSha256: null, eventDigestSha256: null } });
    expect(r.candidates.map((c) => c.kind)).toEqual(["lifecycle", "obligation", "source"]);
    expect(r.proposedCarryForward).toEqual({ candidates: r.candidates, cursor: null });
    expect(db.operations.map((batch) => batch.length)).toEqual([5, 2]);
    for (const query of db.operations.flat()) { expect(query).toMatch(/^SELECT /); expect(query).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP)\b/); }
  });
  it("allows an actually empty database without inventing candidates", async () => {
    raw.close(); boot(false); const r = await compose(db, options());
    expect(r).toMatchObject({ status: "composed", candidates: [], journalEvidence: [], proposedCarryForward: { candidates: [], cursor: null } }); checkFlags(r);
  });
  it("preserves late event times and DB ingestion rather than filtering/coercing the timestamp selector", async () => {
    await submitted(); const observedAt = databaseNow();
    // A genuine post-submission observation, ingested later. The cutoff falls
    // between those two clocks; no pre-effect receipt is needed for this proof.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await received({ observedAt }); const o = options(); o.inventoryOptions.cutoff.ingestedEnd = observedAt + 1;
    const frozen = await journal.readFollowUpEffectEvidenceJournal(db);
    const r = await compose(db, o); expect(r.status).toBe("composed"); checkFlags(r);
    expect(r.journalEvidence).toEqual(frozen.rows);
    const late = r.journalEvidence.find((row) => row.eventType === "receipt");
    expect(late.observedAt).toBe(observedAt); expect(late.occurrenceAt).toBe(observedAt);
    expect(late.ingestedAt).toBeGreaterThan(o.inventoryOptions.cutoff.ingestedEnd);
    expect(r.candidates.find((c) => c.candidateId === `evidence:${late.eventId}`).reasonCodes).toEqual(["sequenced_evidence"]);
    expect(r.candidates.every((c) => c.unresolved === true)).toBe(true);
  });
  it("does not treat an old source absent from selected inventory as a missing journal parent", async () => {
    await submitted(); const o = options(); o.inventoryOptions.cutoff.receivedStart = now;
    const r = await compose(db, o); expect(r.status).toBe("composed");
    expect(r.candidates.find((c) => c.candidateId === `source:${id("source-a")}`).reasonCodes).toEqual(["journal_linked_parent"]);
    expect(r.candidates.flatMap((c) => c.reasonCodes)).not.toContain("candidate_missing");
  });
  it("preserves every prior kind and original reason set, including unprojected evidence/anomaly", async () => {
    const o = options(); o.previousCarryForward.candidates = [candidate("source", "source-a", ["missing_parent", "new_source"]),
      candidate("evidence", "prior-event", ["sequenced_evidence", "conflicting_receipt_evidence"]), candidate("anomaly", "prior-anomaly", ["terminal_anomaly", "retention_expired"])];
    const original = structuredClone(o.previousCarryForward), r = await compose(db, o);
    expect(r.status).toBe("composed"); expect(r.retainedPriorCarryForward).toEqual(original); expect(o.previousCarryForward).toEqual(original);
    for (const old of original.candidates) {
      const current = r.candidates.find((c) => c.candidateId === old.candidateId);
      expect(current.reasonCodes).toEqual([...new Set([...old.reasonCodes, "carry_forward"])].sort());
    }
    expect(r.candidates.filter((c) => ["evidence", "anomaly"].includes(c.kind)).every((c) => !c.reasonCodes.includes("candidate_missing"))).toBe(true);
  });
  it("round trips proposed carry, retaining journal evidence instead of passing it to the old selector", async () => {
    await submitted(); await received(); const o = options(), first = await compose(db, o);
    const second = await compose(db, { ...o, previousCarryForward: first.proposedCarryForward });
    expect(second.status).toBe("composed"); expect(second.candidates).toHaveLength(first.candidates.length);
    for (const item of first.candidates) expect(second.candidates.find((c) => c.candidateId === item.candidateId).reasonCodes).toEqual([...new Set([...item.reasonCodes, "carry_forward"])].sort());
  });
  it("holds one H across pages and defers a concurrent post-H commit until the next root replay", async () => {
    await submitted(); let appended = false;
    const interleaved = connection(raw, { async afterBatch(statements) {
      if (!appended && statements.length === 2 && statements[0].query.startsWith("SELECT e.*")) {
        appended = true; const r = await journal.recordFollowUpEffectReceipt(connection(raw), receipt()); expect(r.status).toBe("recorded");
      }
    } });
    const o = options({ journalPageSize: 1 }); const first = await compose(interleaved, o);
    expect(first.status).toBe("composed"); expect(first.journalBoundary.throughSequence).toBe(2);
    expect(first.journalEvidence.map((r) => r.sequence)).toEqual([1, 2]); expect(first.journalPagesRead).toBe(2);
    const second = await compose(db, o); expect(second.status).toBe("composed"); expect(second.journalBoundary.throughSequence).toBe(3);
    expect(second.journalEvidence.map((r) => r.sequence)).toEqual([1, 2, 3]); expect(second.inputDigestSha256).not.toBe(first.inputDigestSha256);
  });
  it("accepts real committed allocation gaps and per-attempt interleaving across one-row pages", async () => {
    const a = await prepared(); raw.prepare("UPDATE sqlite_sequence SET seq=seq+5 WHERE name='follow_up_effect_evidence_events'").run();
    obligation("b", "reminder"); const b = await prepared("b");
    expect((await journal.appendFollowUpEffectObservation(db, observation(a.sequence))).status).toBe("recorded");
    expect((await journal.appendFollowUpEffectObservation(db, observation(b.sequence, "b"))).status).toBe("recorded");
    await received(); const r = await compose(db, options({ journalPageSize: 1 })); expect(r.status).toBe("composed");
    expect(r.journalEvidence.map((row) => row.sequence)).toEqual([1, 7, 8, 9, 10]);
    expect(r.journalEvidence.map((row) => row.previousSequence)).toEqual([0, 0, 1, 7, 8]);
  });
  it("retains conflicting receipts as evidence and on the obligation without closing/removing anything", async () => {
    await submitted(); await received({ proofLevel: "delivered" });
    await received({ eventId: "event-bounced", providerReceiptId: "receipt-bounced", proofLevel: "bounced", evidenceSha256: D("a") });
    const r = await compose(db, options({ journalPageSize: 2 })); expect(r.status).toBe("composed"); checkFlags(r);
    const conflict = r.journalEvidence.find((row) => row.conflict); expect(conflict.proofLevel).toBe("bounced");
    expect(r.candidates.find((c) => c.identity === conflict.eventId).reasonCodes).toContain("conflicting_receipt_evidence");
    expect(r.candidates.find((c) => c.candidateId === `obligation:${id("obligation-a")}`).reasonCodes).toContain("conflicting_receipt_evidence");
    expect(raw.prepare("SELECT state FROM lifecycle_obligations").get().state).toBe("leased");
  });
  it("has an order-independent digest for duplicate/reordered carry and reason sets", async () => {
    const a = candidate("source", "source-a", ["new_source", "journal_linked_parent"]), b = candidate("evidence", "old", ["sequenced_evidence", "terminal_anomaly"]);
    const o = options({ previousCarryForward: { candidates: [a, b, a], cursor: null } });
    const first = await compose(db, o), second = await compose(db, { ...o, previousCarryForward: { candidates: [{ ...b, reasonCodes: [...b.reasonCodes].reverse() }, { ...a, reasonCodes: [...a.reasonCodes].reverse() }], cursor: null } });
    expect(first.status).toBe("composed"); expect(second.status).toBe("composed"); expect(second.inputDigestSha256).toBe(first.inputDigestSha256); expect(second.candidates).toEqual(first.candidates);
    const third = await compose(db, { ...o, previousCarryForward: { candidates: [a, { ...b, reasonCodes: ["sequenced_evidence"] }], cursor: null } });
    expect(third.inputDigestSha256).not.toBe(first.inputDigestSha256);
  });
  it("snapshots all options/carry before await and freezes safe returned data without freezing the caller", async () => {
    const o = options({ previousCarryForward: { candidates: [candidate("anomaly", "old", ["terminal_anomaly"])], cursor: null } }), expected = structuredClone(o);
    let mutated = false;
    const hooked = connection(raw, { beforeStatement() { if (!mutated) { mutated = true; o.previousCarryForward.candidates[0].reasonCodes[0] = "not-allowed"; o.previousCarryForward.candidates.length = 0; o.inventoryOptions.cutoff.receivedStart = 0; o.maxCandidates = 1; o.maxJournalPages = 1; } } });
    const result = await compose(hooked, o), unmutated = await compose(db, expected);
    expect(result.status).toBe("composed"); expect(result.inputDigestSha256).toBe(unmutated.inputDigestSha256);
    expect(result.retainedPriorCarryForward).toEqual(expected.previousCarryForward);
    for (const value of [result, result.candidates, result.candidates[0], result.candidates[0].reasonCodes, result.retainedPriorCarryForward.candidates]) expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(o)).toBe(false);
  });
  it("makes no writes/network calls and emits no raw owned identity, provider reference or private person", async () => {
    await submitted(); await received(); const readDb = connection(raw), before = raw.prepare("SELECT total_changes() n").get().n;
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const r = await compose(readDb, options({ journalPageSize: 1 })); expect(r.status).toBe("composed");
    expect(raw.prepare("SELECT total_changes() n").get().n).toBe(before); expect(fetch).not.toHaveBeenCalled();
    for (const query of readDb.operations.flat()) expect(query).toMatch(/^SELECT /);
    expect(JSON.stringify(r)).not.toMatch(/source-a|life-a|obligation-a|attempt-a|event-prepared|private-|account-fixture|fixture-deployment/);
    expect(r.journalEvidence.every((row) => /^id_[a-f0-9]{64}$/.test(row.eventId))).toBe(true);
  });
});

describe("incomplete evidence never replaces validated prior carry", () => {
  it("refuses a genuinely missing supported prior candidate without erasing its reasons", async () => {
    const prior = { candidates: [candidate("obligation", "no-such-obligation", ["unresolved_obligation"])], cursor: null };
    checkFailure(await compose(db, options({ previousCarryForward: prior })), prior, "required_inventory_evidence_unavailable");
  });
  it.each(["source", "lifecycle", "obligation"])("fails closed on actual expired required %s inventory", async (kind) => {
    const [table, column] = { source: ["source_events", "normalized_retention_until"], lifecycle: ["lifecycle_instances", "retention_until"], obligation: ["lifecycle_obligations", "retention_until"] }[kind];
    if (kind === "source") insert("source_events", { ...raw.prepare("SELECT * FROM source_events").get(), source_event_id: "source-expired", identity_key: "source-expired", normalized_retention_until: now - 1 });
    else raw.prepare(`UPDATE ${table} SET ${column}=?`).run(now - 1);
    const o = options(); checkFailure(await compose(db, o), o.previousCarryForward, "required_inventory_evidence_unavailable");
  });
  it("refuses absent candidate journal schema, rather than treating it as an empty journal", async () => {
    raw.close(); boot(true, false); const o = options(); checkFailure(await compose(db, o), o.previousCarryForward, "journal_unavailable");
  });
  it("refuses a journal parent that expires after the separate inventory observation", async () => {
    await submitted(); const o = options();
    const hooked = connection(raw, { afterBatch(statements) { if (statements.length === 5) raw.prepare("UPDATE lifecycle_instances SET retention_until=?").run(now - 1); } });
    checkFailure(await compose(hooked, o), o.previousCarryForward, "journal_unavailable");
  });
  it("does not truncate a bounded inventory, candidate union or fixed-H traversal into success", async () => {
    obligation("b", "reminder"); await submitted(); await received(); const o = options();
    checkFailure(await compose(db, { ...o, inventoryOptions: { ...o.inventoryOptions, limit: 1 } }), o.previousCarryForward, "inventory_unavailable");
    checkFailure(await compose(db, { ...o, maxCandidates: 4 }), o.previousCarryForward, "candidate_limit_exceeded");
    const pages = await compose(db, { ...o, journalPageSize: 1, maxJournalPages: 2 });
    checkFailure(pages, o.previousCarryForward, "journal_page_limit_exceeded"); expect(pages.journalPagesRead).toBe(2); expect(pages.journalTraversalComplete).toBe(false);
  });
  it("permits the exact candidate cap but refuses cap+1 preserving the original complete carry", async () => {
    const prior = { candidates: Array.from({ length: 197 }, (_, i) => candidate("evidence", `prior-${i}`, ["sequenced_evidence"])), cursor: null };
    const o = options({ previousCarryForward: prior }); const full = await compose(db, o); expect(full.status).toBe("composed"); expect(full.candidates).toHaveLength(200);
    prior.candidates.push(candidate("anomaly", "one-more", ["terminal_anomaly"])); checkFailure(await compose(db, o), prior, "candidate_limit_exceeded");
  });
  it("sanitizes transport exceptions and retains prior carry on an unavailable database", async () => {
    const o = options({ previousCarryForward: { candidates: [candidate("evidence", "old")], cursor: null } });
    const badDb = { prepare() { throw new Error("secret-person/provider-private-token"); } };
    const r = await compose(badDb, o); checkFailure(r, o.previousCarryForward, "inventory_unavailable");
    expect(JSON.stringify(r)).not.toMatch(/secret-person|private-token/);
  });
});

describe("descriptor-safe bounded input contract", () => {
  it.each([
    ["unknown caller completeness", (o) => { o.traversalComplete = true; }],
    ["caller journal envelope", (o) => { o.journal = { status: "observed", rows: [] }; }],
    ["caller H", (o) => { o.throughSequence = 20; }],
    ["caller continuation", (o) => { o.continuation = null; }],
    ["zero candidate cap", (o) => { o.maxCandidates = 0; }],
    ["candidate cap above 200", (o) => { o.maxCandidates = 201; }],
    ["journal page above 200", (o) => { o.journalPageSize = 201; }],
    ["pages above 20", (o) => { o.maxJournalPages = 21; }],
    ["zero pages", (o) => { o.maxJournalPages = 0; }],
    ["string bound", (o) => { o.journalPageSize = "1"; }],
    ["mismatched inventory read clock", (o) => { o.inventoryOptions.readAt += 1; }],
    ["empty timestamp window", (o) => { o.inventoryOptions.cutoff.ingestedStart = o.inventoryOptions.cutoff.ingestedEnd; }],
    ["unsafe cutoff clock", (o) => { o.inventoryOptions.cutoff.plannedAt = Number.MAX_SAFE_INTEGER + 1; }],
    ["extra symbol", (o) => { o[Symbol("hidden")] = "private-input"; }],
  ])("rejects %s before any read and preserves independently valid carry", async (_name, mutate) => {
    const o = options({ previousCarryForward: { candidates: [candidate("evidence", "previous")], cursor: null } }), prior = structuredClone(o.previousCarryForward);
    mutate(o); checkFailure(await compose(db, o), prior, "invalid_input"); expect(db.operations).toEqual([]);
  });
  it.each([
    ["nonroot cursor", (o) => { o.previousCarryForward.cursor = "cursor"; }],
    ["unknown reason", (o) => { o.previousCarryForward.candidates[0].reasonCodes = ["private-untrusted-reason"]; }],
    ["raw identity", (o) => { o.previousCarryForward.candidates[0].identity = "private-identity"; }],
    ["unsupported kind", (o) => { o.previousCarryForward.candidates[0].kind = "private-kind"; }],
    ["resolved carry", (o) => { o.previousCarryForward.candidates[0].unresolved = false; }],
    ["sparse array", (o) => { o.previousCarryForward.candidates.length = 2; }],
    ["array extra property", (o) => { o.previousCarryForward.candidates.secret = "private-data"; }],
    ["nonplain record", (o) => { Object.setPrototypeOf(o.previousCarryForward.candidates[0], { inherited: true }); }],
  ])("rejects malformed carry (%s) without echoing or dropping the external store", async (_name, mutate) => {
    const o = options({ previousCarryForward: { candidates: [candidate("evidence", "previous")], cursor: null } }); mutate(o);
    const r = await compose(db, o); checkFailure(r, null, "invalid_carry"); expect(db.operations).toEqual([]); expect(JSON.stringify(r)).not.toMatch(/private-/);
  });
  it("rejects nested getters without executing them, before the first reader await", async () => {
    const o = options({ previousCarryForward: { candidates: [candidate("evidence", "previous")], cursor: null } }), getter = vi.fn(() => "private-data");
    Object.defineProperty(o.previousCarryForward.candidates[0], "identity", { enumerable: true, get: getter });
    checkFailure(await compose(db, o), null, "invalid_carry"); expect(getter).not.toHaveBeenCalled(); expect(db.operations).toEqual([]);
  });
  it("rejects top-level getters and nonenumerable fields but still retains valid carry", async () => {
    const getter = vi.fn(() => 200), o = options();
    Object.defineProperty(o, "journalPageSize", { enumerable: true, get: getter });
    checkFailure(await compose(db, o), o.previousCarryForward, "invalid_input"); expect(getter).not.toHaveBeenCalled();
    const hidden = options(); Object.defineProperty(hidden.inventoryOptions, "secret", { value: "private-data" });
    checkFailure(await compose(db, hidden), hidden.previousCarryForward, "invalid_input"); expect(db.operations).toEqual([]);
  });
});

describe("adversarial reader envelopes cannot confer completeness or identity", () => {
  // These spies modify *actual* SQLite reader results only to exercise the
  // orchestration boundary. The public API never accepts these envelopes.
  it.each([
    ["wrong contract", (p) => { p.contract = "untrusted"; }],
    ["authority lift", (p) => { p.authority = true; }],
    ["fake H", (p) => { p.throughSequence += 1; }],
    ["fake terminal flag", (p) => { p.traversalComplete = false; }],
    ["fake continuation", (p) => { p.continuation = { afterSequence: 1, throughSequence: 3, boundary: p.boundary }; }],
    ["skipped first event", (p) => { p.rows.shift(); }],
    ["wrong predecessor", (p) => { p.rows[2].previousSequence = 1; }],
    ["changed attempt parent", (p) => { p.rows[1].sourceEventId = id("different-source"); }],
    ["raw state", (p) => { p.rows[1].stateAfter = "private-arbitrary-state"; }],
    ["coerced timestamp", (p) => { p.rows[2].ingestedAt = String(p.rows[2].ingestedAt); }],
    ["cross family", (p) => { p.rows[1].family = "another-family"; }],
    ["extra assertion content", (p) => { p.rows[0].payload = { private: "secret" }; }],
    ["head event identity mismatch", (p) => { p.boundary.eventIdSha256 = D("a"); }],
  ])("refuses %s without partial candidates, evidence or carry proposal", async (_name, mutate) => {
    await submitted(); await received(); tamperJournal(mutate);
    const o = options({ previousCarryForward: { candidates: [candidate("anomaly", "prior")], cursor: null } });
    const r = await compose(db, o); checkFailure(r, o.previousCarryForward); expect(JSON.stringify(r)).not.toMatch(/private-arbitrary|secret/);
  });
  it.each(["boundary", "cursor", "duplicate_event", "after", "hasMore"])("refuses page-separated %s tampering", async (kind) => {
    await submitted(); await received();
    tamperJournal((p, number) => {
      if (kind === "boundary" && number === 2) p.boundary.eventDigestSha256 = D("a");
      if (kind === "cursor" && number === 1) p.continuation.afterSequence = 0;
      if (kind === "duplicate_event" && number === 2) p.rows[0].eventId = id("event-prepared-a");
      if (kind === "after" && number === 2) p.afterSequence = 0;
      if (kind === "hasMore" && number === 1) p.hasMore = false;
    });
    const o = options({ journalPageSize: 1 }); checkFailure(await compose(db, o), o.previousCarryForward);
  });
  it("rejects a structurally legal observation that skips the per-attempt state transition", async () => {
    await submitted(); tamperJournal((p) => { p.rows[1].stateBefore = "submitted"; p.rows[1].stateAfter = "ambiguous"; });
    const o = options(); checkFailure(await compose(db, o), o.previousCarryForward, "invalid_journal_chain");
  });
  it("rejects cross-attempt provider/reference ownership aliases even when both local chains agree", async () => {
    await submitted(); await received(); obligation("b", "reminder"); await submitted("b");
    await received({ commandAttemptId: "attempt-b", eventId: "event-receipt-b", providerReceiptId: "receipt-b", providerReference: "private-reference-b" });
    expect((await compose(db, options({ journalPageSize: 1 }))).status).toBe("composed");
    tamperJournal((p) => { for (const row of p.rows) if (row.commandAttemptId === id("attempt-b") && row.providerReferenceSha256 !== null) row.providerReferenceSha256 = hash("private-reference-a"); });
    const o = options({ journalPageSize: 1 }); checkFailure(await compose(db, o), o.previousCarryForward, "journal_identity_conflict");
  });
  it("rejects contradictory explicit lifecycle/source links across otherwise separate attempts", async () => {
    await prepared(); obligation("b", "reminder"); await prepared("b");
    tamperJournal((p) => { for (const row of p.rows) if (row.commandAttemptId === id("attempt-b")) row.sourceEventId = id("different-source"); });
    const o = options({ journalPageSize: 1 }); checkFailure(await compose(db, o), o.previousCarryForward, "journal_identity_conflict");
  });
  it.each(["terminal_contradiction", "same_proof_different_evidence"])("refuses a hidden %s even across page boundaries", async (kind) => {
    await submitted(); await received({ proofLevel: "delivered" });
    await received({ eventId: "event-conflict", providerReceiptId: "receipt-conflict", proofLevel: kind === "terminal_contradiction" ? "bounced" : "delivered", evidenceSha256: D("a") });
    tamperJournal((p) => { for (const row of p.rows) row.conflict = false; });
    const o = options({ journalPageSize: 1 }); checkFailure(await compose(db, o), o.previousCarryForward, "invalid_journal_chain");
  });
  it("allows accepted→delivered progression and keeps a prior conflict despite a later nonconflicting accepted receipt", async () => {
    await submitted(); await received({ proofLevel: "delivered" });
    await received({ eventId: "event-bounced", providerReceiptId: "receipt-bounced", proofLevel: "bounced", evidenceSha256: D("a") });
    await received({ eventId: "event-accepted", providerReceiptId: "receipt-accepted", proofLevel: "accepted", evidenceSha256: D("b") });
    const r = await compose(db, options({ journalPageSize: 1 })); expect(r.status).toBe("composed");
    expect(r.journalEvidence.filter((e) => e.eventType === "receipt").map((e) => e.conflict)).toEqual([false, true, false]);
    expect(r.candidates.find((c) => c.candidateId === `obligation:${id("obligation-a")}`).reasonCodes).toContain("conflicting_receipt_evidence");
    obligation("b", "reminder"); await submitted("b");
    await received({ commandAttemptId: "attempt-b", eventId: "event-accepted-b", providerReceiptId: "receipt-accepted-b", providerReference: "private-reference-b", proofLevel: "accepted" });
    await received({ commandAttemptId: "attempt-b", eventId: "event-delivered-b", providerReceiptId: "receipt-delivered-b", providerReference: "private-reference-b", proofLevel: "delivered", evidenceSha256: D("c") });
    const progressed = await compose(db, options({ journalPageSize: 1 })); expect(progressed.status).toBe("composed");
    expect(progressed.journalEvidence.filter((e) => e.commandAttemptId === id("attempt-b")).some((e) => e.conflict)).toBe(false);
  });
  it("retains true conflict whose earlier canonical proof is not projected in this journal", async () => {
    await submitted(); insert("provider_receipts", { provider_receipt_id: "outside-journal", command_attempt_id: "attempt-a", provider: "ghl", provider_reference: "private-reference-a", proof_level: "delivered", evidence_sha256: D("b"), observed_at: now - 100, retention_until: retention, created_at: databaseNow() });
    await received({ proofLevel: "bounced" }); const r = await compose(db, options());
    expect(r.status).toBe("composed"); expect(r.journalEvidence.filter((e) => e.eventType === "receipt")).toHaveLength(1);
    expect(r.journalEvidence.at(-1).conflict).toBe(true); checkFlags(r);
  });
  it("does not execute reader-result getters or echo malformed assertion values", async () => {
    await prepared(); const getter = vi.fn(() => "private-result");
    tamperJournal((p) => { Object.defineProperty(p.rows[0], "eventType", { enumerable: true, get: getter }); });
    const o = options(); const r = await compose(db, o); checkFailure(r, o.previousCarryForward, "malformed_journal");
    expect(getter).not.toHaveBeenCalled(); expect(JSON.stringify(r)).not.toContain("private-result");
  });
  it.each(["lift", "missing", "malformed"])("rejects invalid inventory output %s without reclassifying prior reasons", async (kind) => {
    const original = inventory.observeFollowUpCurrentInventory;
    vi.spyOn(inventory, "observeFollowUpCurrentInventory").mockImplementation(async (...args) => {
      const r = structuredClone(await original(...args));
      if (kind === "lift") r.selection.authoritativeCoverage = true;
      if (kind === "missing") { r.selection.candidates[0].reasonCodes = ["missing_parent"]; r.selection.retainedCarryForward = r.selection.candidates; }
      if (kind === "malformed") r.selection.candidates[0].identity = "private-raw-id";
      return r;
    });
    const o = options({ previousCarryForward: { candidates: [candidate("evidence", "old")], cursor: null } });
    const r = await compose(db, o); checkFailure(r, o.previousCarryForward); expect(JSON.stringify(r)).not.toContain("private-raw-id");
  });
});
