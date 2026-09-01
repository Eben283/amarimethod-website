import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import { fetchTodaysAppointments, fetchTodaysAppointmentsWithRetry, LOCATION_ID } from "./appointments.js";

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
        firstAndOnlyAppointment: false,
        secondToLastStudySession: false,
      },
      {
        startMs: Date.parse("2026-08-05T11:00:00-07:00"),
        contactId: null,
        calendarId: "cal-later",
        contactName: "Grace Hopper",
        calendarName: "Follow-up Session",
        title: null,
        lastPackageSession: false,
        firstAndOnlyAppointment: false,
        secondToLastStudySession: false,
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

  it("retries the complete calendar sweep after a transient calendar failure", async () => {
    let failuresRemaining = 1;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") return jsonResponse({ calendars: [{ id: "cal-1", name: "Assessment" }] });
      if (failuresRemaining-- > 0) return new Response("rate limited", { status: 429 });
      return jsonResponse({ events: [] });
    };

    const result = await fetchTodaysAppointmentsWithRetry(
      env(),
      Date.parse("2026-08-05T15:00:00Z"),
      "America/Los_Angeles",
      { attempts: 2, delayMs: 0 },
    );

    assert.deepEqual(result, { appointments: [], error: null, attempts: 2 });
  });

  it("fills an absent event name and flags only proven first/only and second-to-last study opportunities", async () => {
    const studyCalendarId = "J1N09B6bRYPOGNyVAfmX";
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") return jsonResponse({ calendars: [
        { id: "cal-assessment", name: "Assessment" },
        { id: studyCalendarId, name: "Amari Study 15-Minute Session" },
      ] });
      if (url.pathname === "/calendars/events") {
        if (url.searchParams.get("calendarId") === "cal-assessment") return jsonResponse({ events: [{
          startTime: "2026-08-05T09:00:00-07:00", contactId: "first-only", appointmentStatus: "confirmed",
        }] });
        return jsonResponse({ events: [{
          startTime: "2026-08-05T10:00:00-07:00", contactId: "study-second", contactName: "Grace Hopper", appointmentStatus: "confirmed",
        }] });
      }
      if (url.pathname === "/contacts/first-only") return jsonResponse({ contact: { firstName: "Ada", lastName: "Lovelace", customFields: [] } });
      if (url.pathname === "/contacts/first-only/appointments") return jsonResponse({ appointments: [
        { calendarId: "cal-assessment", appointmentStatus: "confirmed" },
      ] });
      if (url.pathname === "/contacts/study-second") return jsonResponse({ contact: { customFields: [] } });
      if (url.pathname === "/contacts/study-second/appointments") return jsonResponse({ appointments: [
        { calendarId: studyCalendarId, appointmentStatus: "showed" },
      ] });
      throw new Error(`Unexpected fetch ${url.pathname}`);
    };

    const appointments = await fetchTodaysAppointments(env(), Date.parse("2026-08-05T15:00:00Z"));

    assert.deepEqual(appointments.map(({ contactName, firstAndOnlyAppointment, secondToLastStudySession }) => ({
      contactName, firstAndOnlyAppointment, secondToLastStudySession,
    })), [
      { contactName: "Ada Lovelace", firstAndOnlyAppointment: true, secondToLastStudySession: false },
      { contactName: "Grace Hopper", firstAndOnlyAppointment: false, secondToLastStudySession: true },
    ]);
  });
});
