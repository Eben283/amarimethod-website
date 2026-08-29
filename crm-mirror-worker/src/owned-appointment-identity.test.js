import { describe, expect, it } from "vitest";
import { resolveOwnedAppointmentIdentity } from "./owned-appointment-identity.js";

function dbWith(rows) {
  return { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
}

describe("owned appointment identity", () => {
  it("returns stable owned and optional provider crosswalk identity", async () => {
    await expect(resolveOwnedAppointmentIdentity(dbWith([{
      owned_appointment_id: "owned-appt", owned_contact_id: "owned-contact",
      provider_appointment_id: "ghl-appt", provider_contact_id: "ghl-contact",
      provider: "ghl",
      provider_contact_count: 1,
      provider_calendar_id: "calendar", authority: "owned", provider_sync_state: "synced",
    }]), "ghl-appt")).resolves.toEqual({
      ownedAppointmentId: "owned-appt", ownedContactId: "owned-contact",
      providerAppointmentId: "ghl-appt", providerContactId: "ghl-contact",
      provider: "ghl",
      providerCalendarId: "calendar", authority: "owned", providerSyncState: "synced",
    });
  });

  it("fails closed for absent and ambiguous references", async () => {
    await expect(resolveOwnedAppointmentIdentity(dbWith([]), "missing"))
      .rejects.toMatchObject({ code: "owned_appointment_not_found", status: 404 });
    await expect(resolveOwnedAppointmentIdentity(dbWith([
      { owned_appointment_id: "one" }, { owned_appointment_id: "two" },
    ]), "collision")).rejects.toMatchObject({ code: "owned_appointment_ambiguous", status: 409 });
    await expect(resolveOwnedAppointmentIdentity(dbWith([{
      owned_appointment_id: "owned-appt", owned_contact_id: "owned-contact",
      provider_contact_count: 2,
    }]), "owned-appt")).rejects.toMatchObject({ code: "provider_contact_ambiguous", status: 409 });
  });
});
