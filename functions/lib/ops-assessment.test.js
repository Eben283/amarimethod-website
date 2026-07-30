import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  recordOpsEvent: vi.fn(async (_env, evt) => ({ recorded: true, id: `evt_${evt.hopId}_${evt.outcome}` })),
  openOpsIncident: vi.fn(async () => ({ opened: true, flipped: true, id: "inc_1" })),
  resolveOpsIncident: vi.fn(async () => ({ resolved: 1 })),
}));

vi.mock("./ops-alert.js", () => ({
  recordOpsError: vi.fn(async () => ({ recorded: true, key: "ops:err:x" })),
}));

import {
  describeSlotFields,
  recordAssessmentBookPath,
  recordAssessmentCheckout,
} from "./ops-assessment.js";
import { recordOpsEvent, openOpsIncident, resolveOpsIncident } from "./ops-events.js";
import { recordOpsError } from "./ops-alert.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("describeSlotFields", () => {
  it("shows nulls clearly for Holly-class missing iso", () => {
    expect(
      describeSlotFields({
        slotIso: null,
        slotDate: "2026-08-04",
        type: "amari_assessment",
        calendar: "EM6vB2mq7EAdGCbUb3j1",
      }),
    ).toContain('slot_iso=null');
    expect(
      describeSlotFields({
        slotIso: null,
        slotDate: "2026-08-04",
        type: "amari_assessment",
        calendar: "EM6vB2mq7EAdGCbUb3j1",
      }),
    ).toContain('"2026-08-04"');
  });
});

describe("recordAssessmentBookPath", () => {
  const contact = { id: "holly", firstName: "Holly", lastName: "Brinkman" };
  const slotCondition = {
    expected: "requested_session_slot_iso bookable datetime",
    observed: "slot_iso=null; slot=\"2026-08-04\"",
  };

  it("fail path: payment ok + create_appointment fail + incident + ops:err mirror", async () => {
    const ctx = { env: { AUTOMATION_DB: {} } };
    const res = await recordAssessmentBookPath(ctx, {
      contact,
      productName: "Amari Assessment",
      orderId: "holly-order",
      appointment: null,
      bookError: new Error("no bookable slot"),
      slotCondition,
    });
    expect(res.outcome).toBe("fail");
    expect(recordOpsEvent).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        hopId: "purchase_webhook",
        outcome: "ok",
      }),
    );
    expect(recordOpsEvent).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({
        hopId: "create_appointment",
        outcome: "fail",
        condition: slotCondition,
        personLabel: "Holly Brinkman",
        correlationId: "order:holly-order",
      }),
    );
    expect(openOpsIncident).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({
        title: "Paid Assessment, no appointment",
        severity: "money",
        lawId: "L_paid_assessment_has_appt",
      }),
      expect.objectContaining({ alert: true }),
    );
    expect(recordOpsError).toHaveBeenCalled();
  });

  it("ok path: resolves any open incident", async () => {
    const ctx = { env: {} };
    const res = await recordAssessmentBookPath(ctx, {
      contact,
      productName: "Amari Assessment",
      orderId: "o1",
      appointment: { id: "appt_1" },
      slotCondition,
    });
    expect(res.outcome).toBe("ok");
    expect(resolveOpsIncident).toHaveBeenCalled();
    expect(openOpsIncident).not.toHaveBeenCalled();
    expect(recordOpsError).not.toHaveBeenCalled();
  });
});

describe("recordAssessmentCheckout", () => {
  it("emits create_checkout ok for Assessment", async () => {
    await recordAssessmentCheckout({}, {
      contactId: "c1",
      personLabel: "Ada Lovelace",
      startTime: "2026-08-03T10:00:00-07:00",
      sessionType: "amari_assessment",
    });
    expect(recordOpsEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        hopId: "create_checkout",
        outcome: "ok",
        contactId: "c1",
      }),
    );
  });
});
