import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/appointment-dispatch.js", () => ({ dispatchAppointmentEvent: vi.fn() }));
vi.mock("../lib/processed-events.js", () => ({ claimProcessedEvent: vi.fn() }));
vi.mock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn() }));

import { onRequestPost } from "./appointment-webhook.js";
import { dispatchAppointmentEvent } from "../lib/appointment-dispatch.js";
import { claimProcessedEvent } from "../lib/processed-events.js";
import { recordOpsError } from "../lib/ops-alert.js";

const SECRET = "endpoint-secret";
const SHARED = "shared-secret";

// Shapes verbatim from appointment-event.test.js so both files break together if aliases change.
const NESTED_CONFIRMED = () => ({
  type: "AppointmentUpdate",
  appointment: { id: "appt_abc123", calendarId: "G7OAnnJuFbMF6nQSlZVQ", contactId: "cont_xyz", startTime: "2026-07-20T15:00:00-07:00", appointmentStatus: "confirmed" },
  modified_by: "customer",
});
const FLAT_CANCELLED = () => ({ appointmentId: "appt_abc123", calendarId: "G7OAnnJuFbMF6nQSlZVQ", contactId: "cont_xyz", startTime: "2026-07-20T15:00:00-07:00", status: "cancelled" });
const CANCELED_ALIAS = () => ({ appointment: { id: "appt_abc123", calendarId: "cal_x", contactId: "cont_x", appointmentStatus: "canceled" } });
const UNKNOWN_STATUS = () => ({ appointment: { id: "appt_zzz", calendarId: "cal_x", contactId: "cont_x", appointmentStatus: "somethingelse" } });

function makeContext({ body, secretHeader, env = {} } = {}) {
  return {
    env: { GHL_APPOINTMENT_WEBHOOK_SECRET: SECRET, ATTEND_DB: {}, ...env },
    request: {
      json: async () => {
        if (body === "BADJSON") throw new SyntaxError("Unexpected token");
        return body;
      },
      headers: { get: (h) => (h === "X-Webhook-Secret" ? secretHeader : null) },
    },
    waitUntil: vi.fn(),
  };
}

async function readJson(res) {
  return JSON.parse(await res.text());
}

beforeEach(() => {
  dispatchAppointmentEvent.mockReset().mockResolvedValue({ ok: true, actions: [], errors: [] });
  claimProcessedEvent.mockReset().mockResolvedValue({ ok: true });
  recordOpsError.mockReset().mockResolvedValue({ recorded: true });
});

describe("appointment-webhook onRequestPost", () => {
  it("500 when no secret env is configured", async () => {
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET, env: { GHL_APPOINTMENT_WEBHOOK_SECRET: undefined } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(500);
    expect((await readJson(res)).error).toBeTruthy();
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("401 on wrong secret", async () => {
    const res = await onRequestPost(makeContext({ body: NESTED_CONFIRMED(), secretHeader: "nope" }));
    expect(res.status).toBe(401);
    expect(claimProcessedEvent).not.toHaveBeenCalled();
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("accepts the fallback GHL_WEBHOOK_SECRET when the per-endpoint secret is unset", async () => {
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SHARED, env: { GHL_APPOINTMENT_WEBHOOK_SECRET: undefined, GHL_WEBHOOK_SECRET: SHARED } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it("rejects the fallback secret once the per-endpoint secret exists", async () => {
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SHARED, env: { GHL_WEBHOOK_SECRET: SHARED } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const res = await onRequestPost(makeContext({ body: "BADJSON", secretHeader: SECRET }));
    expect(res.status).toBe(400);
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("skips an unknown-status payload", async () => {
    const res = await onRequestPost(makeContext({ body: UNKNOWN_STATUS(), secretHeader: SECRET }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ success: true, skipped: true });
    expect(claimProcessedEvent).not.toHaveBeenCalled();
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("skips a payload with no appointmentId", async () => {
    const res = await onRequestPost(makeContext({ body: { appointmentStatus: "confirmed", contactId: "k" }, secretHeader: SECRET }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ skipped: true });
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("recognized confirmed event claims and dispatches exactly once", async () => {
    dispatchAppointmentEvent.mockResolvedValue({ ok: true, actions: [{ engine: "reminder", action: "enroll" }], errors: [] });
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(claimProcessedEvent).toHaveBeenCalledWith(ctx.env.ATTEND_DB, "appt:appt_abc123:confirmed");
    expect(dispatchAppointmentEvent).toHaveBeenCalledTimes(1);
    expect(dispatchAppointmentEvent).toHaveBeenCalledWith(ctx, expect.objectContaining({ type: "confirmed", appointmentId: "appt_abc123", recognized: true }));
    expect(await readJson(res)).toMatchObject({ success: true, type: "confirmed", actions: [{ engine: "reminder", action: "enroll" }] });
  });

  it("duplicate event does not dispatch again", async () => {
    claimProcessedEvent.mockResolvedValue({ ok: false, duplicate: true });
    const res = await onRequestPost(makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ success: true, duplicate: true });
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("same appointment with a new status is a fresh claim key", async () => {
    await onRequestPost(makeContext({ body: FLAT_CANCELLED(), secretHeader: SECRET }));
    expect(claimProcessedEvent).toHaveBeenCalledWith(expect.anything(), "appt:appt_abc123:cancelled");
    expect(dispatchAppointmentEvent).toHaveBeenCalled();
  });

  it("alias status maps to the typed key", async () => {
    await onRequestPost(makeContext({ body: CANCELED_ALIAS(), secretHeader: SECRET }));
    expect(claimProcessedEvent).toHaveBeenCalledWith(expect.anything(), "appt:appt_abc123:cancelled");
  });

  it("KV fallback when D1 is unbound: put + proceed, then dedupe", async () => {
    claimProcessedEvent.mockResolvedValue(null); // D1 unavailable
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) };
    const ctx1 = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET, env: { ATTEND_DB: null, PURCHASE_KV: kv } });
    const res1 = await onRequestPost(ctx1);
    expect(res1.status).toBe(200);
    expect(kv.put).toHaveBeenCalledWith("appt:appt_abc123:confirmed", expect.anything(), expect.objectContaining({ expirationTtl: expect.any(Number) }));
    expect(dispatchAppointmentEvent).toHaveBeenCalledTimes(1);

    dispatchAppointmentEvent.mockClear();
    const kv2 = { get: vi.fn().mockResolvedValue("2026-07-19T00:00:00Z"), put: vi.fn() };
    const res2 = await onRequestPost(makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET, env: { ATTEND_DB: null, PURCHASE_KV: kv2 } }));
    expect(await readJson(res2)).toMatchObject({ duplicate: true });
    expect(dispatchAppointmentEvent).not.toHaveBeenCalled();
  });

  it("claim failure is non-fatal: dispatch still runs, 200, ops error recorded", async () => {
    claimProcessedEvent.mockRejectedValue(new Error("d1 down"));
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(dispatchAppointmentEvent).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(recordOpsError).toHaveBeenCalled();
  });

  it("dispatch failure never surfaces as 5xx", async () => {
    dispatchAppointmentEvent.mockRejectedValue(new Error("consumer broke"));
    const ctx = makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET });
    const res = await onRequestPost(ctx);
    expect([200]).toContain(res.status);
    expect(recordOpsError).toHaveBeenCalled();
  });

  it("every tested response is JSON with safe status codes", async () => {
    // sweep a few paths; assert Content-Type + status set membership
    const cases = [
      makeContext({ body: NESTED_CONFIRMED(), secretHeader: SECRET }),
      makeContext({ body: UNKNOWN_STATUS(), secretHeader: SECRET }),
      makeContext({ body: "BADJSON", secretHeader: SECRET }),
      makeContext({ body: NESTED_CONFIRMED(), secretHeader: "wrong" }),
    ];
    for (const c of cases) {
      const res = await onRequestPost(c);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect([200, 400, 401, 500]).toContain(res.status);
    }
  });
});
