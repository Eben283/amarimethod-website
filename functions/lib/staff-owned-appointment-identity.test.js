import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requireProviderAppointmentIdentity,
  resolveStaffOwnedAppointmentIdentity,
} from "./staff-owned-appointment-identity.js";

afterEach(() => vi.unstubAllGlobals());

describe("Staff owned appointment identity", () => {
  it("resolves an old provider reference to stable owned identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ identity: {
      ownedAppointmentId: "owned-appt", ownedContactId: "owned-contact",
      providerAppointmentId: "ghl-appt", providerContactId: "ghl-contact",
    } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const identity = await resolveStaffOwnedAppointmentIdentity({ env: { WORKER_AUTH_SECRET: "secret" } }, "ghl-appt");
    expect(identity.ownedAppointmentId).toBe("owned-appt");
    expect(requireProviderAppointmentIdentity(identity)).toEqual({ provider: "ghl", appointmentId: "ghl-appt", contactId: "ghl-contact" });
  });

  it("does not invent a provider reference for a provider-free appointment", () => {
    expect(() => requireProviderAppointmentIdentity({ ownedAppointmentId: "owned", ownedContactId: "contact" }))
      .toThrow(/no verified temporary provider link/i);
  });
});
