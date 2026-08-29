import { afterEach, describe, expect, it, vi } from "vitest";
import { writeOwnedAppointmentPayment } from "./staff-owned-appointment-payment.js";

afterEach(() => vi.unstubAllGlobals());

describe("Staff owned appointment payment", () => {
  it("writes validated cents through the authenticated owned seam", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    await writeOwnedAppointmentPayment({ env: { WORKER_AUTH_SECRET: "secret" } }, {
      appointmentId: "ghl appointment/1", contactId: "ghl-contact-1", status: "paid",
      method: "cash", note: null, amount: 190, source: "manual", recordedBy: "Garrett",
    });
    expect(fetch.mock.calls[0][0]).toContain("ghl%20appointment%2F1/payment");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ amountCents: 19000, status: "paid" });
  });
});
