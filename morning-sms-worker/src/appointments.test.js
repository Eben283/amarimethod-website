import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import { fetchTodaysAppointments, LOCATION_ID } from "./appointments.js";

const originalFetch = globalThis.fetch;

function env() {
  const values = new Map([
    ["ghl_access_token", "test-token"],
    ["ghl_token_expiry", String(Date.now() + 60 * 60 * 1000)],
  ]);
  return {
    GHL_CLIENT_ID: "client",
    GHL_CLIENT_SECRET: "secret",
    PORTAL_KV: {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => values.set(key, value),
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetForTests();
});

describe("fetchTodaysAppointments", () => {
  it("returns every active appointment in start order with its calendar label", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") {
        return jsonResponse({ calendars: [
          { id: "cal-later", name: "Follow-up Session" },
          { id: "cal-earlier", name: "Assessment" },
        ] });
      }
      assert.equal(url.searchParams.get("locationId"), LOCATION_ID);
      if (url.searchParams.get("calendarId") === "cal-later") {
        return jsonResponse({ events: [
          { startTime: "2026-08-05T11:00:00-07:00", contactName: "Grace Hopper", appointmentStatus: "confirmed" },
          { startTime: "2026-08-05T12:00:00-07:00", contactName: "Cancelled Member", appointmentStatus: "cancelled" },
        ] });
      }
      return jsonResponse({ events: [
        { startTime: "2026-08-05T09:00:00-07:00", contactName: "Ada Lovelace", appointmentStatus: "new" },
        { startTime: "not-a-date", contactName: "Invalid Time", appointmentStatus: "confirmed" },
      ] });
    };

    const appointments = await fetchTodaysAppointments(
      env(),
      Date.parse("2026-08-05T15:00:00Z"),
    );

    assert.deepEqual(appointments, [
      {
        startMs: Date.parse("2026-08-05T09:00:00-07:00"),
        contactId: null,
        calendarId: "cal-earlier",
        contactName: "Ada Lovelace",
        calendarName: "Assessment",
        title: null,
        lastPackageSession: false,
      },
      {
        startMs: Date.parse("2026-08-05T11:00:00-07:00"),
        contactId: null,
        calendarId: "cal-later",
        contactName: "Grace Hopper",
        calendarName: "Follow-up Session",
        title: null,
        lastPackageSession: false,
      },
    ]);
  });

  it("fails closed instead of sending a partial agenda when one calendar read fails", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") {
        return jsonResponse({ calendars: [
          { id: "cal-ok", name: "Assessment" },
          { id: "cal-fail", name: "Follow-up Session" },
        ] });
      }
      if (url.searchParams.get("calendarId") === "cal-fail") {
        return new Response("rate limited", { status: 429 });
      }
      return jsonResponse({ events: [
        { startTime: "2026-08-05T09:00:00-07:00", contactName: "Ada Lovelace", appointmentStatus: "confirmed" },
      ] });
    };

    const appointments = await fetchTodaysAppointments(
      env(),
      Date.parse("2026-08-05T15:00:00Z"),
    );

    assert.equal(appointments, null);
  });
});
