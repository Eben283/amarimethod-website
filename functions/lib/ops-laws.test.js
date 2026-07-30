import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  openOpsIncident: vi.fn(async () => ({ opened: true, flipped: true, id: "inc_1" })),
  resolveOpsIncident: vi.fn(async () => ({ resolved: 0 })),
  listOpsEvents: vi.fn(async () => []),
}));

import { ASSESSMENT_APPT_LAG_MS, sweepPaidAssessmentHasAppt } from "./ops-laws.js";
import { openOpsIncident, resolveOpsIncident } from "./ops-events.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";

function fakeD1({ payments = [], appointments = [] } = {}) {
  const prepare = (sql) => ({
    _args: [],
    bind(...a) {
      this._args = a;
      return this;
    },
    async all() {
      if (/hop_id = 'purchase_webhook'/.test(sql)) {
        const cutoff = this._args[1];
        return {
          results: payments.filter((p) => p.at_ms <= cutoff),
        };
      }
      return { results: [] };
    },
    async first() {
      const a = this._args;
      if (/hop_id = 'create_appointment'/.test(sql) && /correlation_id/.test(sql)) {
        return appointments.find((x) => x.correlation_id === a[1] && x.outcome === "ok") || null;
      }
      if (/hop_id = 'create_appointment'/.test(sql) && /contact_id/.test(sql)) {
        return (
          appointments.find(
            (x) => x.contact_id === a[1] && x.at_ms >= a[2] && x.outcome === "ok",
          ) || null
        );
      }
      return null;
    },
    async run() {
      return { meta: { changes: 0 } };
    },
  });
  return { prepare };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sweepPaidAssessmentHasAppt", () => {
  const NOW = Date.parse("2026-07-29T12:00:00.000Z");

  it("opens incident when payment is older than lag and no appointment ok", async () => {
    const payAt = NOW - ASSESSMENT_APPT_LAG_MS - 1000;
    const db = fakeD1({
      payments: [
        {
          id: "evt_pay",
          at_ms: payAt,
          correlation_id: "order:o1",
          contact_id: "c1",
          person_label: "Holly Brinkman",
          money_json: null,
          summary: "paid",
        },
      ],
      appointments: [],
    });
    const res = await sweepPaidAssessmentHasAppt({ AUTOMATION_DB: db }, NOW, {
      context: { env: { AUTOMATION_DB: db } },
    });
    expect(res.checked).toBe(1);
    expect(res.opened).toBe(1);
    expect(openOpsIncident).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        lawId: "L_paid_assessment_has_appt",
        title: "Paid Assessment, no appointment",
      }),
      expect.anything(),
    );
  });

  it("resolves when appointment ok exists for the correlation", async () => {
    resolveOpsIncident.mockResolvedValueOnce({ resolved: 1 });
    const payAt = NOW - ASSESSMENT_APPT_LAG_MS - 1000;
    const db = fakeD1({
      payments: [
        {
          id: "evt_pay",
          at_ms: payAt,
          correlation_id: "order:o1",
          contact_id: "c1",
          person_label: "Ada",
        },
      ],
      appointments: [{ correlation_id: "order:o1", outcome: "ok", contact_id: "c1", at_ms: payAt + 1 }],
    });
    const res = await sweepPaidAssessmentHasAppt({ AUTOMATION_DB: db }, NOW);
    expect(res.opened).toBe(0);
    expect(resolveOpsIncident).toHaveBeenCalled();
    expect(openOpsIncident).not.toHaveBeenCalled();
  });

  it("no AUTOMATION_DB: clean no-op", async () => {
    const res = await sweepPaidAssessmentHasAppt({}, NOW);
    expect(res).toEqual({ checked: 0, opened: 0, resolved: 0, reason: "no-db" });
  });
});
