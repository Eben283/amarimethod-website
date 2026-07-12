import { describe, it, expect } from "vitest";
import { dispatchAppointmentEvent } from "./appointment-dispatch.js";

// The dispatch seam: the endpoint hands it a recognized typed event; today it routes nowhere
// and returns an empty action list. Consumers (reminder/nurture/pipeline) get added by editing
// appointment-dispatch.js only, never the endpoint.

const confirmedEvent = Object.freeze({
  type: "confirmed",
  recognized: true,
  status: "confirmed",
  calendarId: "G7OAnnJuFbMF6nQSlZVQ",
  contactId: "cont_xyz",
  appointmentId: "appt_abc123",
  startAt: "2026-07-20T15:00:00-07:00",
  modifiedBy: "customer",
});

const ctx = { env: {} };

describe("dispatchAppointmentEvent (stub seam)", () => {
  it("returns ok with an empty action list for a recognized event", async () => {
    const out = await dispatchAppointmentEvent(ctx, confirmedEvent);
    expect(out).toEqual({ ok: true, actions: [], errors: [] });
  });

  it("does not mutate a (frozen) event", async () => {
    // confirmedEvent is Object.frozen; a mutation attempt would throw in module strict mode.
    await expect(dispatchAppointmentEvent(ctx, confirmedEvent)).resolves.toMatchObject({ ok: true });
  });

  it("never throws on malformed input", async () => {
    for (const bad of [null, undefined, {}, { type: "confirmed" }]) {
      const out = await dispatchAppointmentEvent(ctx, bad);
      expect(out.ok).toBe(true);
      expect(out.actions).toEqual([]);
    }
    const noCtx = await dispatchAppointmentEvent(undefined, confirmedEvent);
    expect(noCtx.ok).toBe(true);
  });

  it("returns a fresh object (and fresh arrays) per call", async () => {
    const a = await dispatchAppointmentEvent(ctx, confirmedEvent);
    const b = await dispatchAppointmentEvent(ctx, confirmedEvent);
    expect(a).not.toBe(b);
    expect(a.actions).not.toBe(b.actions);
    expect(a.errors).not.toBe(b.errors);
  });
});
