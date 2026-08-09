import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requireStaffAuth: vi.fn(), corsHeaders: () => ({}) };
});

import { onRequestGet, onRequestPut } from "./staff-communication-preferences.js";
import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { preferenceKey } from "../lib/team-communication-preferences.js";

function makeKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key, type) => {
      const value = values.get(key);
      if (value == null) return null;
      return type === "json" ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key, value) => values.set(key, value)),
    values,
  };
}

function context({ method = "GET", body, kv = makeKv() } = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/staff-communication-preferences", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: kv === null ? {} : { PORTAL_KV: kv },
  };
}

function allow(user) {
  requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user } });
}

beforeEach(() => vi.clearAllMocks());

describe("staff communication preferences auth and defaults", () => {
  it("rejects unauthenticated requests before touching storage", async () => {
    const kv = makeKv();
    requireStaffAuth.mockResolvedValue({ error: new Response("denied", { status: 401 }) });
    const response = await onRequestGet(context({ kv }));
    expect(response.status).toBe(401);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("returns audited Eben defaults without claiming they control delivery", async () => {
    allow("Eben");
    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toBe("Eben");
    expect(body.saved).toBe(false);
    expect(body.appliedToDelivery).toBe(false);
    expect(body.preferences.quietHours.enabled).toBe(false);
    expect(body.preferences.categories.morning_agenda.channels).toEqual({ in_app: false, email: false, sms: true });
    expect(body.preferences.categories.money_booking_incidents.channels).toEqual({ in_app: false, email: true, sms: true });
    expect(body.preferences.categories.wrong_message_incidents.channels.sms).toBe(true);
    expect(body.preferences.categories.system_incidents.channels.sms).toBe(true);
  });

  it("returns Garrett's narrower current route and an honest no-storage state", async () => {
    allow("garrett");
    const response = await onRequestGet(context({ kv: null }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toBe("Garrett");
    expect(body.storageAvailable).toBe(false);
    expect(body.preferences.categories.morning_agenda.enabled).toBe(true);
    expect(body.preferences.categories.money_booking_incidents.enabled).toBe(false);
    expect(body.preferences.categories.money_booking_incidents.channels).toEqual({ in_app: false, email: false, sms: false });
  });

  it("does not expose settings to an unknown staff identity", async () => {
    allow("SomeoneElse");
    const response = await onRequestGet(context());
    expect(response.status).toBe(403);
  });
});

describe("staff communication preferences writes", () => {
  it("stores only the authenticated user's versioned key and remains foundation-only", async () => {
    allow("Eben");
    const kv = makeKv();
    const getResponse = await onRequestGet(context({ kv }));
    const initial = await getResponse.json();
    initial.preferences.timezone = "America/New_York";
    initial.preferences.quietHours = { enabled: true, start: "22:15", end: "06:45" };
    initial.preferences.escalation = {
      enabled: true,
      afterMinutes: 45,
      fallbackChannel: "sms",
      fallbackStaff: "Garrett",
    };

    const response = await onRequestPut(context({ method: "PUT", body: { preferences: initial.preferences, user: "Garrett" }, kv }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toBe("Eben");
    expect(body.appliedToDelivery).toBe(false);
    expect(body.preferences.timezone).toBe("America/New_York");
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put.mock.calls[0][0]).toBe(preferenceKey("Eben"));
    const stored = JSON.parse(kv.put.mock.calls[0][1]);
    expect(stored.user).toBe("Eben");
    expect(stored.updatedBy).toBe("Eben");
    expect(stored.appliedToDelivery).toBe(false);
  });

  it("rejects unknown categories, invalid fallback, and unavailable storage", async () => {
    allow("Garrett");
    const defaultsResponse = await onRequestGet(context());
    const defaults = (await defaultsResponse.json()).preferences;

    const unknown = structuredClone(defaults);
    unknown.categories.surprise = { enabled: true, cadence: "immediate", channels: {} };
    expect((await onRequestPut(context({ method: "PUT", body: unknown }))).status).toBe(400);

    const badFallback = structuredClone(defaults);
    badFallback.escalation = { enabled: true, afterMinutes: 30, fallbackChannel: "push", fallbackStaff: "Eben" };
    expect((await onRequestPut(context({ method: "PUT", body: badFallback }))).status).toBe(400);

    expect((await onRequestPut(context({ method: "PUT", body: defaults, kv: null }))).status).toBe(422);
  });

  it("reads a saved record from only the authenticated user's key", async () => {
    allow("Garrett");
    const defaultsResponse = await onRequestGet(context());
    const preferences = (await defaultsResponse.json()).preferences;
    preferences.timezone = "Europe/London";
    const saved = JSON.stringify({ user: "Garrett", preferences, updatedAt: "2026-08-08T10:00:00.000Z" });
    const kv = makeKv({ [preferenceKey("Garrett")]: saved });

    const response = await onRequestGet(context({ kv }));
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.preferences.timezone).toBe("Europe/London");
    expect(kv.get).toHaveBeenCalledWith(preferenceKey("Garrett"), "json");
  });
});
