import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  createTask,
  sanitizeSummary,
  validateAuditEvent,
  validatePrincipal,
} from "./ops-ledger.js";

const migration = readFileSync(
  new URL("../../db/operations-ledger-v1-migration.sql", import.meta.url),
  "utf8",
);
const principal = { kind: "codex", id: "ledger-core-test" };

function db() {
  const value = new DatabaseSync(":memory:");
  value.exec("PRAGMA foreign_keys = ON");
  value.exec(migration);
  return value;
}

describe("Operations Ledger sanitizer and principal boundary", () => {
  it("rejects email/phone-like summaries and sensitive field names", () => {
    expect(() => sanitizeSummary("Follow up with jane@example.com")).toThrow(/personal data/);
    expect(() => sanitizeSummary("Call +1 (415) 555-0123")).toThrow(/personal data/);
    expect(() => validateAuditEvent({
      eventType: "task.updated", summary: "Task updated", idempotencyKey: "event-1",
      principal, fieldNames: ["email"],
    })).toThrow(/sensitive field name/);
  });

  it("requires a server-resolved principal object and rejects raw actor strings", () => {
    expect(validatePrincipal({ type: "worker", id: "reconcile" })).toEqual({ kind: "worker", ref: "reconcile" });
    expect(() => validatePrincipal("human:eben")).toThrow(/principal/);
    expect(() => validatePrincipal({ actor: "human:eben" })).toThrow(/raw actor/);
    expect(() => validatePrincipal({ kind: "unknown", id: "x" })).toThrow(/unsupported/);
  });

  it("accepts only field names and non-negative counts, never arbitrary metadata", () => {
    const event = validateAuditEvent({
      eventType: "reconcile.completed", summary: "Reconciliation completed",
      idempotencyKey: "event-fields-1", principal,
      fieldNames: ["status", "record_id"], counts: { status: 2 },
      subjects: [{ type: "task", ref: "task:1", fieldNames: ["status"], counts: { status: 1 } }],
    });
    expect(event.fieldNames).toEqual(["status", "record_id"]);
    expect(event.counts).toEqual({ status: 2 });
    expect(event.subjects[0]).toMatchObject({ type: "task", ref: "task:1" });
    expect(() => validateAuditEvent({
      eventType: "reconcile.completed", summary: "Reconciliation completed",
      idempotencyKey: "event-meta-1", principal, meta: { status: "done" },
    })).toThrow(/not an allowed field/);
    expect(() => validateAuditEvent({
      eventType: "reconcile.completed", summary: "Reconciliation completed",
      idempotencyKey: "event-count-1", principal, counts: { status: "two" },
    })).toThrow(/non-negative integer/);
  });
});

describe("Operations Ledger append/idempotency and immutability", () => {
  it("returns the original row for an identical idempotency retry and rejects conflicts", async () => {
    const value = db();
    const input = {
      eventType: "task.created", summary: "Task created", idempotencyKey: "event-idem-1",
      principal, fieldNames: ["status"], counts: { status: 1 },
      subjects: [{ type: "task", ref: "task:1", fieldNames: ["status"], counts: { status: 1 } }],
    };
    const first = await appendAuditEvent(value, input, { now: 100 });
    const second = await appendAuditEvent(value, input, { now: 200 });
    expect(first.state).toBe("created");
    expect(second.state).toBe("existing");
    expect(second.event.id).toBe(first.event.id);
    expect(second.event.subjects).toHaveLength(1);
    await expect(appendAuditEvent(value, { ...input, summary: "A different task event" })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(value.prepare("SELECT COUNT(*) AS n FROM ops_audit_events").get().n).toBe(1);
    expect(value.prepare("SELECT COUNT(*) AS n FROM ops_audit_subjects").get().n).toBe(1);
  });

  it("keeps audit rows immutable while allowing task projections to update", async () => {
    const value = db();
    const task = await createTask(value, { idempotencyKey: "task-idem-1", title: "Review release health", principal }, { now: 100 });
    expect(task.state).toBe("created");
    expect(() => value.prepare("UPDATE ops_audit_events SET summary = 'changed'").run()).toThrow(/append-only/);
    expect(() => value.prepare("DELETE FROM ops_audit_subjects").run()).toThrow(/append-only/);
    expect(value.prepare("UPDATE ops_tasks SET status = 'done' WHERE id = ?").run(task.task.id).changes).toBe(1);
  });

  it("creates the expected five ledger tables and idempotency indexes", () => {
    const value = db();
    const names = value.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ops_%' ORDER BY name").all().map((row) => row.name);
    expect(names).toEqual(["ops_audit_events", "ops_audit_subjects", "ops_incident_links", "ops_releases", "ops_tasks"]);
    const indexes = value.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'sqlite_autoindex_ops_%'").all().map((row) => row.name);
    expect(indexes.length).toBeGreaterThanOrEqual(5);
  });
});
