import { describe, expect, it, vi } from "vitest";
import { normalizeGhlReceipt, reconcileDeliveryReceipts } from "./delivery-receipts.js";

const SENT_SMS = Object.freeze({
  id: 17,
  ts: Date.parse("2026-08-10T22:00:33.000Z"),
  engine: "reminder",
  flow_key: "initial-in-person",
  definition_version: 3,
  contact_id: "contact_1",
  appointment_id: "appointment_1",
  step_index: 3,
  action: "send",
  outcome: "sent",
  channel: "sms",
  message_ref: "message_1",
});

describe("normalizeGhlReceipt", () => {
  it("reads a terminal delivered status from the real nested message shape", () => {
    expect(normalizeGhlReceipt({ message: { id: "message_1", status: "delivered", messageType: "TYPE_SMS" } }))
      .toEqual({ terminal: true, outcome: "delivered", providerStatus: "delivered" });
    expect(normalizeGhlReceipt({ message: { status: "completed" } }))
      .toEqual({ terminal: true, outcome: "delivered", providerStatus: "completed" });
  });

  it("maps provider failure and bounce states without calling them delivered", () => {
    expect(normalizeGhlReceipt({ message: { status: "failed" } })).toEqual({ terminal: true, outcome: "failed", providerStatus: "failed" });
    expect(normalizeGhlReceipt({ message: { status: "cancelled" } })).toEqual({ terminal: true, outcome: "failed", providerStatus: "cancelled" });
    expect(normalizeGhlReceipt({ message: { status: "bounced" } })).toEqual({ terminal: true, outcome: "bounced", providerStatus: "bounced" });
  });

  it("keeps queued and unknown states non-terminal", () => {
    expect(normalizeGhlReceipt({ message: { status: "pending" } })).toEqual({ terminal: false, outcome: null, providerStatus: "pending" });
    expect(normalizeGhlReceipt({ message: {} })).toEqual({ terminal: false, outcome: null, providerStatus: "unknown" });
  });
});

describe("reconcileDeliveryReceipts", () => {
  it("appends one immutable terminal event tied to the exact send reference", async () => {
    const appendReceipt = vi.fn(async () => true);
    const db = {};
    const result = await reconcileDeliveryReceipts({ REMINDER_DB: db }, Date.parse("2026-08-10T22:05:00.000Z"), {
      loadCandidates: vi.fn(async () => [SENT_SMS]),
      readGhlMessage: vi.fn(async () => ({ message: { id: "message_1", status: "delivered", messageType: "TYPE_SMS" } })),
      appendReceipt,
      flowKeys: ["initial-in-person"],
    });

    expect(result).toEqual({ checked: 1, recorded: 1, pending: 0, errors: 0 });
    expect(appendReceipt).toHaveBeenCalledWith(db, expect.objectContaining({
      ts: Date.parse("2026-08-10T22:05:00.000Z"),
      engine: "reminder",
      flowKey: "initial-in-person",
      definitionVersion: 3,
      contactId: "contact_1",
      appointmentId: "appointment_1",
      stepIndex: 3,
      action: "delivery_status",
      outcome: "delivered",
      channel: "sms",
      message_ref: "message_1",
      detail: { provider: "ghl", providerStatus: "delivered", sourceEventId: 17 },
    }));
  });

  it("publishes bounded receipt health separately from delivery events", async () => {
    const put = vi.fn(async () => undefined);
    await reconcileDeliveryReceipts({ REMINDER_DB: {}, PORTAL_KV: { put } }, Date.parse("2026-08-10T22:05:00.000Z"), {
      loadCandidates: vi.fn(async () => [SENT_SMS]),
      readGhlMessage: vi.fn(async () => ({ message: { status: "pending" } })),
      appendReceipt: vi.fn(),
      limit: 25,
      flowKeys: ["initial-in-person"],
    });
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0]).toBe("reminder:delivery-receipts:initial-in-person");
    expect(JSON.parse(put.mock.calls[0][1])).toEqual(expect.objectContaining({
      status: "healthy",
      checkedAt: "2026-08-10T22:05:00.000Z",
      checked: 1,
      pending: 1,
      errors: 0,
      lookbackDays: 30,
      batchLimit: 25,
    }));
  });

  it("does not fabricate a final event while the provider is pending", async () => {
    const appendReceipt = vi.fn();
    const result = await reconcileDeliveryReceipts({}, Date.now(), {
      loadCandidates: vi.fn(async () => [SENT_SMS]),
      readGhlMessage: vi.fn(async () => ({ message: { status: "pending" } })),
      appendReceipt,
      flowKeys: ["initial-in-person"],
    });
    expect(result).toEqual({ checked: 1, recorded: 0, pending: 1, errors: 0 });
    expect(appendReceipt).not.toHaveBeenCalled();
  });

  it("keeps lookup failures separate from message delivery failures", async () => {
    const appendReceipt = vi.fn();
    const result = await reconcileDeliveryReceipts({}, Date.now(), {
      loadCandidates: vi.fn(async () => [SENT_SMS]),
      readGhlMessage: vi.fn(async () => { throw new Error("provider unavailable"); }),
      appendReceipt,
      flowKeys: ["initial-in-person"],
    });
    expect(result).toEqual({ checked: 1, recorded: 0, pending: 0, errors: 1 });
    expect(appendReceipt).not.toHaveBeenCalled();
  });

  it("covers No Show SMS receipts with a separate health record", async () => {
    const put = vi.fn(async () => undefined);
    const noShowSms = { ...SENT_SMS, flow_key: "no-show-recovery", definition_version: 3 };
    const loadCandidates = vi.fn(async (_db, _since, _limit, _bucket, flowKey) => flowKey === "no-show-recovery" ? [noShowSms] : []);
    const result = await reconcileDeliveryReceipts({ REMINDER_DB: {}, PORTAL_KV: { put } }, Date.parse("2026-08-10T22:05:00.000Z"), {
      loadCandidates,
      readGhlMessage: vi.fn(async () => ({ message: { status: "delivered" } })),
      appendReceipt: vi.fn(async () => true),
    });
    expect(result).toEqual({ checked: 1, recorded: 1, pending: 0, errors: 0 });
    expect(loadCandidates).toHaveBeenCalledTimes(4);
    expect(put).toHaveBeenCalledTimes(4);
    const noShowHealth = put.mock.calls.find(([key]) => key === "reminder:delivery-receipts:no-show-recovery");
    expect(JSON.parse(noShowHealth[1])).toEqual(expect.objectContaining({ flowKey: "no-show-recovery", checked: 1, recorded: 1, status: "healthy" }));
  });
});
