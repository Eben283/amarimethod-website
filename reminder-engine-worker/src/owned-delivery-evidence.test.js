import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimOwnedDeliveryEffect,
  describeOwnedDeliveryEffect,
  executeOwnedDeliveryEffect,
  prepareOwnedDeliveryEffect,
  recordOwnedDeliveryAcceptance,
} from "./owned-delivery-evidence.js";

function d1(raw) {
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...values) => statement(sql, values),
    first: async () => {
      const row = raw.prepare(sql).get(...args);
      return row ? { ...row } : null;
    },
    all: async () => ({ results: raw.prepare(sql).all(...args).map((row) => ({ ...row })) }),
    run: async () => {
      const result = raw.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => {
          const result = raw.prepare(item.sql).run(...item.args);
          return { meta: { changes: Number(result.changes) } };
        });
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const input = (patch = {}) => ({
  flowKey: "partner-initial-in-person",
  enrollmentId: "partner-initial-in-person:provider-appointment",
  stepIndex: 1,
  definitionVersion: 2,
  idempotencyKey: "partner-initial:owned-appointment:v2:1",
  channel: "email",
  recipient: "avery@example.com",
  provider: "gmail-eben",
  subject: "Your partner session is confirmed",
  text: "Hi Avery, your session is confirmed.",
  ...patch,
});

let raw;
let db;
let clock;

beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  raw.prepare(
    `INSERT INTO reminder_enrollments
       (enrollment_id, flow_key, definition_version, appointment_id, contact_id,
        calendar_id, start_at, start_ms, enrolled_at, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "partner-initial-in-person:provider-appointment", "partner-initial-in-person", 2,
    "provider-appointment", "provider-contact", "partner-calendar",
    "2026-09-08T17:00:00.000Z", Date.parse("2026-09-08T17:00:00.000Z"),
    Date.parse("2026-09-01T21:00:00.000Z"), "active",
  );
  raw.prepare(
    `INSERT INTO reminder_steps
       (enrollment_id, step_index, at, type, template, due_at, status)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    "partner-initial-in-person:provider-appointment", 1, "enroll", "email",
    "confirmation", Date.parse("2026-09-01T21:00:00.000Z"), "pending",
  );
  db = d1(raw);
  clock = Date.parse("2026-09-01T21:00:00.000Z");
});

describe("owned delivery effect evidence", () => {
  it("stores hashes and immutable effect identity before any transport", async () => {
    const effect = await describeOwnedDeliveryEffect(input());
    const prepared = await prepareOwnedDeliveryEffect(db, input(), clock);
    expect(prepared).toMatchObject({ status: "prepared", state: "prepared", dispatchAllowed: false });
    expect(effect.effectId).toMatch(/^ode_[a-f0-9]{64}$/);
    const row = raw.prepare("SELECT * FROM owned_delivery_attempts").get();
    expect(row).toMatchObject({
      effect_id: effect.effectId,
      flow_key: "partner-initial-in-person",
      state: "prepared",
      request_sha256: effect.requestSha256,
      recipient_sha256: effect.recipientSha256,
    });
    expect(JSON.stringify(row)).not.toContain("avery@example.com");
    expect(JSON.stringify(row)).not.toContain("session is confirmed");
    expect(raw.prepare("SELECT transition FROM owned_delivery_effect_events").get().transition).toBe("prepared");
  });

  it("claims once, records provider acceptance, and replays without a second send", async () => {
    const transport = vi.fn().mockResolvedValue({ success: true, messageId: "gmail-message-1" });
    const first = await executeOwnedDeliveryEffect(db, input(), transport, () => ++clock);
    const replay = await executeOwnedDeliveryEffect(db, input(), transport, () => ++clock);
    expect(first).toEqual({ success: true, messageId: "gmail-message-1", evidence: "accepted" });
    expect(replay).toEqual({ success: true, messageId: "gmail-message-1", replayed: true, evidence: "accepted" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(raw.prepare("SELECT state, provider_reference FROM owned_delivery_attempts").get())
      .toEqual({ state: "accepted", provider_reference: "gmail-message-1" });
    expect(raw.prepare("SELECT proof_level, provider_reference FROM owned_delivery_receipts").get())
      .toEqual({ proof_level: "accepted", provider_reference: "gmail-message-1" });
    expect(raw.prepare("SELECT group_concat(transition, ',') transitions FROM owned_delivery_effect_events ORDER BY sequence").get().transitions)
      .toBe("prepared,submitted,accepted");
  });

  it("holds an ambiguous transport outcome for manual reconciliation and never retries it", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("connection closed after submission"));
    const first = await executeOwnedDeliveryEffect(db, input(), transport, () => ++clock);
    const replay = await executeOwnedDeliveryEffect(db, input(), transport, () => ++clock);
    expect(first).toMatchObject({ success: false, ambiguous: true });
    expect(replay).toEqual({ success: false, error: "delivery effect requires manual reconciliation", ambiguous: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(raw.prepare("SELECT state, error_code FROM owned_delivery_attempts").get())
      .toEqual({ state: "ambiguous", error_code: "transport_exception" });
    expect(raw.prepare("SELECT group_concat(transition, ',') transitions FROM owned_delivery_effect_events ORDER BY sequence").get().transitions)
      .toBe("prepared,submitted,ambiguous");
  });

  it("refuses changed request content under the same idempotency identity", async () => {
    expect(await prepareOwnedDeliveryEffect(db, input(), clock)).toMatchObject({ status: "prepared" });
    expect(await prepareOwnedDeliveryEffect(db, input({ text: "Changed after preparation" }), clock + 1))
      .toMatchObject({ status: "refused", reason: "delivery effect identity collision" });
    expect(raw.prepare("SELECT count(*) count FROM owned_delivery_attempts").get().count).toBe(1);
  });

  it("requires a real pending step and admits only one concurrent dispatch claim", async () => {
    expect(await prepareOwnedDeliveryEffect(db, input({ stepIndex: 9 }), clock))
      .toMatchObject({ status: "refused" });
    expect(await prepareOwnedDeliveryEffect(db, input({ flowKey: "other-flow" }), clock))
      .toMatchObject({ status: "refused" });
    const prepared = await prepareOwnedDeliveryEffect(db, input(), clock + 1);
    const [left, right] = await Promise.all([
      claimOwnedDeliveryEffect(db, prepared, clock + 2),
      claimOwnedDeliveryEffect(db, prepared, clock + 2),
    ]);
    expect([left.dispatchAllowed, right.dispatchAllowed].sort()).toEqual([false, true]);
    expect(raw.prepare("SELECT count(*) count FROM owned_delivery_effect_events WHERE transition='submitted'").get().count).toBe(1);
  });

  it("refuses a conflicting accepted receipt and makes evidence append-only", async () => {
    const prepared = await prepareOwnedDeliveryEffect(db, input(), clock);
    expect(await claimOwnedDeliveryEffect(db, prepared, clock + 1)).toMatchObject({ dispatchAllowed: true });
    expect(await recordOwnedDeliveryAcceptance(db, prepared, "gmail-message-1", clock + 2))
      .toMatchObject({ status: "recorded", outcomeProven: true });
    expect(await recordOwnedDeliveryAcceptance(db, prepared, "gmail-message-2", clock + 3))
      .toMatchObject({ status: "refused", outcomeProven: false });
    expect(() => raw.exec("UPDATE owned_delivery_effect_events SET transition='accepted'")).toThrow();
    expect(() => raw.exec("DELETE FROM owned_delivery_receipts")).toThrow();
    expect(() => raw.exec("DELETE FROM owned_delivery_attempts")).toThrow();
  });

  it("does not allow one provider reference to prove two different effects", async () => {
    raw.prepare(
      `INSERT INTO reminder_steps
         (enrollment_id, step_index, at, type, template, due_at, status)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      "partner-initial-in-person:provider-appointment", 2, "-24h", "email",
      "day-before", clock, "pending",
    );
    const first = await prepareOwnedDeliveryEffect(db, input(), clock);
    const secondInput = input({
      stepIndex: 2,
      idempotencyKey: "partner-initial:owned-appointment:v2:2",
      subject: "Tomorrow",
      text: "Your appointment is tomorrow.",
    });
    const second = await prepareOwnedDeliveryEffect(db, secondInput, clock);
    expect(await claimOwnedDeliveryEffect(db, first, clock + 1)).toMatchObject({ dispatchAllowed: true });
    expect(await claimOwnedDeliveryEffect(db, second, clock + 1)).toMatchObject({ dispatchAllowed: true });
    expect(await recordOwnedDeliveryAcceptance(db, first, "gmail-shared-reference", clock + 2))
      .toMatchObject({ outcomeProven: true });
    expect(await recordOwnedDeliveryAcceptance(db, second, "gmail-shared-reference", clock + 3))
      .toMatchObject({ status: "refused", outcomeProven: false });
    expect(raw.prepare("SELECT count(*) count FROM owned_delivery_receipts").get().count).toBe(1);
  });

  it("permits child-first deletion only after the 400-day evidence window expires", async () => {
    const expiredClock = Date.parse("2020-01-01T00:00:00.000Z");
    expect(await prepareOwnedDeliveryEffect(db, input(), expiredClock)).toMatchObject({ status: "prepared" });
    expect(() => raw.exec("DELETE FROM owned_delivery_attempts")).toThrow();
    expect(raw.exec("DELETE FROM owned_delivery_effect_events")).toBeUndefined();
    expect(raw.exec("DELETE FROM owned_delivery_attempts")).toBeUndefined();
    expect(raw.prepare("SELECT count(*) count FROM owned_delivery_attempts").get().count).toBe(0);
  });
});
