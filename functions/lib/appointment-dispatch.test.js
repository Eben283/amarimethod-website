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

// ── Wired behavior (added with the engine-forward plumbing) ──
import { vi, beforeEach, afterEach } from "vitest";

describe("dispatchAppointmentEvent (wired to the engine workers)", () => {
  const env = {
    REMINDER_ENGINE_URL: "https://reminder-engine.example.workers.dev",
    NURTURE_ENGINE_URL: "https://nurture-engine.example.workers.dev",
    WORKER_AUTH_SECRET: "s3cret",
  };
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, actions: [{ engine: "reminder", action: "enroll" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards a recognized event to BOTH engines' /event routes and merges their actions", async () => {
    const out = await dispatchAppointmentEvent({ env }, confirmedEvent);
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([u]) => u).sort();
    expect(urls).toEqual([
      "https://nurture-engine.example.workers.dev/event",
      "https://reminder-engine.example.workers.dev/event",
    ]);
    expect(out.actions).toHaveLength(2);
  });

  it("one engine failing lands in errors[] without blocking the other", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, actions: [] }), { status: 200 }));
    const out = await dispatchAppointmentEvent({ env }, confirmedEvent);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(["reminder: engine responded 500"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays a silent no-op when the worker URLs aren't configured (pre-deploy)", async () => {
    const out = await dispatchAppointmentEvent({ env: { WORKER_AUTH_SECRET: "s" } }, confirmedEvent);
    expect(out).toEqual({ ok: true, actions: [], errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
