import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_FAMILY } from "../../functions/lib/reliability-contract.js";
import { observeFollowUpCurrentInventory } from "../../functions/lib/follow-up-current-inventory.js";

const family = FOLLOW_UP_FAMILY;
const options = () => ({ readAt: 300, limit: 20, cutoff: { receivedStart: 100, receivedEnd: 200, ingestedStart: 100, ingestedEnd: 200, plannedAt: 300, maxPages: 1, maxCandidates: 200 }, previousCarryForward: { cursor: null, candidates: [] } });
let raw;
function source(id = "src-a", received = 1, f = family) {
  raw.prepare("INSERT INTO source_events(source_event_id,provider,family,identity_version,identity_key,payload_sha256,normalized_retention_until,occurred_at,received_at,authentication_result,normalization_state,state,source_version,runtime_version,accepted_at,created_at) VALUES (?,'ghl',?,1,?,'hash',10000,?,?,'authenticated','normalized','accepted','source','runtime',?,?)").run(id, f, id, received, received, received, received);
}
function lifecycle(id = "life-a", sourceId = "src-a", f = family) {
  raw.prepare("INSERT INTO lifecycle_instances(lifecycle_instance_id,source_event_id,family,scope,person_id,appointment_id,definition_version,runtime_version,state,retention_until,created_at,updated_at) VALUES (?,?,?,'scope','private-person','private-appointment',3,'runtime','active',10000,1,1)").run(id, sourceId, f);
}
function obligation(id = "obl-a", life = "life-a", f = family) {
  raw.prepare("INSERT INTO lifecycle_obligations(obligation_id,lifecycle_instance_id,obligation_key,kind,family,deadline_at,owner_role,closer,state,retention_until,created_at,updated_at) VALUES (?,?,?,'send',?,900,'system','provider_receipt','pending',10000,1,1)").run(id, life, id, f);
}
function exception(id = "exc-a", s = "src-a", l = null, o = null, f = family) {
  raw.prepare("INSERT INTO lifecycle_exceptions(exception_id,family,source_event_id,lifecycle_instance_id,obligation_id,kind,severity,accountable_owner,next_safe_action,state,retention_until,opened_at,updated_at) VALUES (?,?,?,?,?,'test','warning','private-owner','private-action','open',10000,1,1)").run(id, f, s, l, o);
}

function db(mutate = (r) => r) {
  const queries = [];
  return { queries, prepare(sql) { queries.push(sql); return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = statements.map(({ sql, values }) => {
          expect(sql).toMatch(/^SELECT /); expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP)\b/);
          return { success: true, results: raw.prepare(sql).all(...values).map((r) => ({ ...r })) };
        });
        raw.exec("COMMIT"); return mutate(results);
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    } };
}
beforeEach(() => { raw = new DatabaseSync(":memory:"); raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")); source(); lifecycle(); obligation(); });
afterEach(() => raw.close());

describe("Follow-Up current inventory observation", () => {
  it("reads actual old retained SQLite inventory in one SELECT batch without claiming historical or receipt authority", async () => {
    const connection = db(); const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden")); const value = options(); const before = structuredClone(value);
    try {
      const result = await observeFollowUpCurrentInventory(connection, value);
      expect(result).toMatchObject({ status: "observed", readAt: 300, inventoryComplete: true, lateEvidenceProjection: "unavailable", authority: false, replacementAllowed: false, retainPreviousCarryForward: true, stateTimeScope: "current_at_read_not_historical" });
      expect(connection.queries).toHaveLength(5);
      expect(result.selection.candidates.map((c) => c.kind)).toEqual(["lifecycle", "obligation"]);
      expect(JSON.stringify(result)).not.toMatch(/private-|src-a|life-a|obl-a/);
      expect(result.selection.candidates.some((c) => c.kind === "evidence")).toBe(false);
      expect(value).toEqual(before); expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("is deterministic but hashes changed current state without reconstructing a cutoff", async () => {
    const a = await observeFollowUpCurrentInventory(db(), options()); expect(await observeFollowUpCurrentInventory(db(), options())).toEqual(a);
    raw.exec("UPDATE lifecycle_obligations SET state='satisfied' WHERE obligation_id='obl-a'");
    const b = await observeFollowUpCurrentInventory(db(), options()); expect(b.snapshotDigest).not.toBe(a.snapshotDigest);
    expect(b.selection.candidates.find((c) => c.kind === "obligation").reasonCodes).toContain("unsupported_terminal_state");
  });
  it("accepts real fractional D1 transport metadata and normalizes row arrival order", async () => {
    source("src-b"); lifecycle("life-b", "src-b"); obligation("obl-b", "life-b");
    const first = await observeFollowUpCurrentInventory(db(), options());
    const reordered = await observeFollowUpCurrentInventory(db((rows) => rows.map((r) => ({ ...r, results: [...r.results].reverse(), meta: { duration: 0.372, rows_read: 15, rows_written: 0, changed_db: false } }))), options());
    expect(first.status).toBe("observed"); expect(reordered).toEqual(first);
  });
  it("round trips only hashed adapter carry identities, not raw selector identities", async () => {
    const first = await observeFollowUpCurrentInventory(db(), options()); const value = options(); value.previousCarryForward.candidates = first.selection.retainedCarryForward;
    const next = await observeFollowUpCurrentInventory(db(), value); expect(next.status).toBe("observed");
    expect(next.selection.candidates.some((c) => c.reasonCodes.includes("candidate_missing"))).toBe(false);
    raw.exec("DELETE FROM lifecycle_obligations");
    const absent = await observeFollowUpCurrentInventory(db(), value); expect(absent.status).toBe("observed");
    expect(absent.selection.candidates.find((c) => c.kind === "obligation").reasonCodes).toContain("candidate_missing");
    value.previousCarryForward.candidates = [{ candidateId: "source:raw", identity: "raw", kind: "source", family, reasonCodes: ["new_source"], unresolved: true }];
    const connection = db(); expect((await observeFollowUpCurrentInventory(connection, value)).reasonCodes).toContain("carry_identity_domain_unsupported"); expect(connection.queries).toHaveLength(0);
  });
  it("does not project actual receipt timestamps as an ingestion clock", async () => {
    const first = await observeFollowUpCurrentInventory(db(), options());
    raw.prepare("INSERT INTO command_attempts(command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,provider_reference,state,retention_until,created_at,updated_at) VALUES ('cmd','obl-a','idem',1,'provider_idempotent','ghl','hash','private-ref','accepted',10000,100,100)").run();
    raw.prepare("INSERT INTO provider_receipts(provider_receipt_id,command_attempt_id,provider,provider_reference,proof_level,evidence_sha256,observed_at,retention_until,created_at) VALUES ('receipt','cmd','ghl','private-ref','delivered','hash',120,10000,150)").run();
    const result = await observeFollowUpCurrentInventory(db(), options());
    expect(result).toEqual(first); expect(result.lateEvidenceProjection).toBe("unavailable");
    expect(result.selection.candidates.some((c) => c.kind === "evidence")).toBe(false);
  });
  it("uses received-window bounds only for discovery reasons, not inventory exclusion", async () => {
    for (const at of [0, 100, 199, 200, 300]) source(`src-${at}`, at);
    const r = await observeFollowUpCurrentInventory(db(), options()); expect(r.status).toBe("observed");
    expect(r.selection.candidates.filter((c) => c.kind === "source")).toHaveLength(2);
    expect(r.selection.candidates.some((c) => c.kind === "lifecycle")).toBe(true);
    source("future", 301); expect((await observeFollowUpCurrentInventory(db(), options())).reasonCodes).toContain("future_source");
  });
  it.each([1, 2, 3, 4])("bounds actual SQL inventory kind %i at limit+1", async (index) => {
    source("src-b"); lifecycle("life-b", "src-b"); obligation("obl-b", "life-b"); exception(); exception("exc-b", "src-b");
    const value = options(); value.limit = 1; let count;
    const r = await observeFollowUpCurrentInventory(db((rows) => { count = rows[index].results.length; return rows; }), value);
    expect(count).toBe(2); expect(r.reasonCodes).toContain("inventory_limit_exceeded"); expect(r.replacementAllowed).toBe(false);
  });
  it.each([null, undefined, false, "sparse", "failed", "missing-results"])("rejects malformed batch slot %s", async (bad) => {
    const result = await observeFollowUpCurrentInventory(db((r) => { if (bad === "sparse") delete r[2]; else r[2] = bad === "failed" ? { success: false, results: [] } : bad === "missing-results" ? { success: true } : bad; return r; }), options());
    expect(result).toMatchObject({ status: "incomplete", inventoryComplete: false, replacementAllowed: false, selection: null });
  });
  it("checks real schema columns rather than trusting a marker", async () => {
    raw.exec("ALTER TABLE lifecycle_exceptions RENAME COLUMN retention_until TO missing_retention");
    expect((await observeFollowUpCurrentInventory(db(), options())).status).toBe("incomplete");
  });
  it("fails both per-kind and candidate output overflow without replacement", async () => {
    source("src-b"); const value = options(); value.limit = 1;
    expect((await observeFollowUpCurrentInventory(db(), value)).reasonCodes).toContain("inventory_limit_exceeded");
    value.limit = 20; value.cutoff.maxCandidates = 1;
    expect(await observeFollowUpCurrentInventory(db(), value)).toMatchObject({ status: "incomplete", selection: null, replacementAllowed: false, retainPreviousCarryForward: true });
  });
  it("rejects an orphan and cross-family parent or child", async () => {
    raw.exec("PRAGMA foreign_keys=OFF"); obligation("orphan", "absent");
    expect((await observeFollowUpCurrentInventory(db(), options())).status).toBe("incomplete");
    raw.exec("DELETE FROM lifecycle_obligations WHERE obligation_id='orphan'; UPDATE lifecycle_instances SET family='other'");
    expect((await observeFollowUpCurrentInventory(db(), options())).status).toBe("incomplete");
  });
  it("handles source-only and family-level exceptions without inventing links; rejects contradictory chains", async () => {
    exception(); exception("family", null);
    const good = await observeFollowUpCurrentInventory(db(), options()); expect(good.status).toBe("observed");
    expect(good.reasonCodes).toContain("family_level_exception_has_no_entity_link");
    source("src-b"); lifecycle("life-b", "src-b");
    exception("cross", "src-a", "life-b", "obl-a");
    expect((await observeFollowUpCurrentInventory(db(), options())).status).toBe("incomplete");
  });
  it("projects expired source retention explicitly", async () => {
    const result = await observeFollowUpCurrentInventory(db((rows) => { rows[1].results[0].normalized_retention_until = 300; return rows; }), options());
    expect(result.selection.candidates.find((c) => c.kind === "source").reasonCodes).toContain("retention_expired");
  });
  it("rejects unprojected evidence carry rather than calling it absent in the database", async () => {
    const value = options(); value.previousCarryForward.candidates = [{ candidateId: "evidence:old", kind: "evidence", identity: "old", family, reasonCodes: ["late_linked_evidence"], unresolved: true }];
    const connection = db(); const result = await observeFollowUpCurrentInventory(connection, value);
    expect(result.reasonCodes).toContain("carry_kind_not_projected_preserve_previous"); expect(connection.queries).toHaveLength(0);
  });
  it("rejects options and result getters before invocation or hashing", async () => {
    let calls = 0; const value = options(); Object.defineProperty(value.cutoff, "plannedAt", { enumerable: true, get() { calls++; return 300; } });
    const connection = db(); expect((await observeFollowUpCurrentInventory(connection, value)).status).toBe("incomplete"); expect(connection.queries).toHaveLength(0);
    const result = await observeFollowUpCurrentInventory(db((r) => { Object.defineProperty(r[2].results[0], "state", { enumerable: true, get() { calls++; return "active"; } }); return r; }), options());
    expect(result.status).toBe("incomplete"); expect(calls).toBe(0);
  });
  it("rejects malformed clocks/states and remains absent from production entrypoints", async () => {
    const value = options(); value.readAt = 299; expect((await observeFollowUpCurrentInventory(db(), value)).status).toBe("incomplete");
    expect((await observeFollowUpCurrentInventory(db((r) => { r[2].results[0].state = {}; return r; }), options())).status).toBe("incomplete");
    expect(readFileSync(new URL("./index.js", import.meta.url), "utf8")).not.toContain("follow-up-current-inventory");
    expect(readFileSync(new URL("../../functions/api/staff-automations.js", import.meta.url), "utf8")).not.toContain("follow-up-current-inventory");
  });
});
