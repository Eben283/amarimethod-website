import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveStaffBookType, listStaffBookTypes, flattenSlots } from "../lib/staff-book-calendars.js";

describe("staff-book-calendars", () => {
  it("maps assessment to the Assessment calendar", () => {
    const booking = resolveStaffBookType("assessment");
    expect(booking.calendarId).toBe("EM6vB2mq7EAdGCbUb3j1");
    expect(booking.durationMinutes).toBe(40);
  });

  it("rejects unknown session types", () => {
    expect(resolveStaffBookType("nope")).toBeNull();
  });

  it("lists types for the UI", () => {
    const types = listStaffBookTypes();
    expect(types.some((t) => t.id === "assessment")).toBe(true);
    expect(types.some((t) => t.id === "followup_package_in_person")).toBe(true);
    expect(types.some((t) => t.id === "followup_in_person")).toBe(true);
    expect(types.some((t) => t.id === "initial_in_person")).toBe(true);
    expect(types.some((t) => t.id === "partner_initial")).toBe(true);
  });

  it("maps pay-as-you-go follow-up calendars", () => {
    expect(resolveStaffBookType("followup_in_person")?.calendarId).toBe("SKDVOL8wtUN6Ne0ppbC9");
    expect(resolveStaffBookType("followup_virtual")?.calendarId).toBe("oVn77FcecFY16iS2pHyP");
    expect(resolveStaffBookType("initial_virtual")?.calendarId).toBe("ySmht5hx4uZGEpgZrlCw");
  });
});

describe("flattenSlots", () => {
  it("flattens GHL free-slot maps", () => {
    const slots = flattenSlots({
      "2026-08-04": { slots: ["2026-08-04T11:00:00-07:00", "2026-08-04T11:00:00-07:00"] },
      "2026-08-05": { slots: ["2026-08-05T09:00:00-07:00"] },
    });
    expect(slots).toEqual([
      { date: "2026-08-04", hour: 11, minute: 0, datetime: "2026-08-04T11:00:00-07:00" },
      { date: "2026-08-05", hour: 9, minute: 0, datetime: "2026-08-05T09:00:00-07:00" },
    ]);
  });
});

describe("staff-book API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("books assessment for a contact with idempotency", async () => {
    const kv = new Map();
    const ghlFetch = vi.fn(async (ctx, url, opts = {}) => {
      if (String(url).includes("/contacts/") && !String(url).includes("/appointments") && opts.method !== "POST") {
        return {
          ok: true,
          json: async () => ({ contact: { id: "c1", firstName: "Holly", lastName: "B", email: "h@x.com", phone: "+15551212" } }),
        };
      }
      if (String(url).includes("/appointments") && opts.method !== "POST") {
        return { ok: true, json: async () => ({ appointments: [] }) };
      }
      if (String(url).includes("/calendars/events/appointments") && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        expect(body.calendarId).toBe("EM6vB2mq7EAdGCbUb3j1");
        expect(body.toNotify).toBe(true);
        expect(body.endTime).toMatch(/T11:40:00-07:00$/);
        return { ok: true, json: async () => ({ id: "appt1" }) };
      }
      return { ok: false, status: 500, text: async () => "no" };
    });

    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "book",
          contactId: "c1",
          sessionType: "assessment",
          startTime: "2026-08-04T11:00:00-07:00",
          timezone: "America/Los_Angeles",
          idempotencyKey: "idem-1",
        },
        error: null,
      })),
    }));
    vi.doMock("../lib/ghl.js", () => ({ ghlFetch }));

    const { onRequestPost } = await import("./staff-book.js");
    const env = {
      PORTAL_KV: {
        get: async (key, type) => {
          const raw = kv.get(key);
          if (!raw) return null;
          return type === "json" ? JSON.parse(raw) : raw;
        },
        put: async (key, value) => { kv.set(key, value); },
      },
    };
    const res = await onRequestPost({
      request: new Request("https://example.com/api/staff-book", { method: "POST" }),
      env,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appointment.id).toBe("appt1");
    expect(body.appointment.sessionType).toBe("assessment");

    // Idempotent replay
    const res2 = await onRequestPost({
      request: new Request("https://example.com/api/staff-book", { method: "POST" }),
      env,
    });
    expect(res2.status).toBe(200);
    const createCalls = ghlFetch.mock.calls.filter((c) => String(c[1]).includes("/calendars/events/appointments") && c[2]?.method === "POST");
    expect(createCalls.length).toBe(1);
  });

  it("rejects unknown sessionType", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
      parseJsonBody: vi.fn(async () => ({
        body: { action: "book", contactId: "c1", sessionType: "nope", startTime: "2026-08-04T11:00:00-07:00", idempotencyKey: "x" },
        error: null,
      })),
    }));
    vi.doMock("../lib/ghl.js", () => ({ ghlFetch: vi.fn() }));
    const { onRequestPost } = await import("./staff-book.js");
    const res = await onRequestPost({
      request: new Request("https://example.com/api/staff-book", { method: "POST" }),
      env: {},
    });
    expect(res.status).toBe(400);
  });
});
