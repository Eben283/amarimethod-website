import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import { runMorningSms } from "./run.js";

const originalFetch = globalThis.fetch;

function testEnv() {
  const values = new Map([
    ["ghl_access_token", "test-token"],
    ["ghl_token_expiry", String(Date.now() + 60 * 60 * 1000)],
    ["morning-sms:2026-08-05:prepare:contact123", "already-sent"],
  ]);
  return {
    GHL_CLIENT_ID: "client",
    GHL_CLIENT_SECRET: "secret",
    MORNING_SMS_CONTACT_IDS: "contact123",
    MORNING_SMS_MODE: "active",
    TIMEZONE: "America/Los_Angeles",
    PORTAL_KV: {
      get: async (key) => values.get(key) ?? null,
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetForTests();
});

describe("runMorningSms", () => {
  it("renders the complete agenda in a dry run even after today's real send", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") {
        return Response.json({ calendars: [{ id: "cal-assessment", name: "Assessment" }] });
      }
      return Response.json({ events: [{
        startTime: "2026-08-05T09:00:00-07:00",
        contactName: "Test Member",
        appointmentStatus: "confirmed",
      }] });
    };

    const summary = await runMorningSms(testEnv(), {
      nowMs: Date.parse("2026-08-05T15:00:00Z"),
      forceKinds: ["prepare"],
      dryRun: true,
    });

    assert.equal(summary.sends.length, 1);
    assert.equal(summary.skipped.length, 0);
    assert.equal(summary.schedule.appointmentCount, 1);
    assert.equal(
      summary.sends[0].body,
      "Today's appointments:\n9:00 AM — Test Member · Assessment\n\nTime to prepare for the day.",
    );
    assert.equal(summary.sends[0].result.shadowed, true);
  });

  it("marks the package-ending appointment from the authoritative ledger", async () => {
    const contactId = "member123456";
    const packageCalendarId = "ZO1jlGfy01rsxVqicoSB";
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") {
        return Response.json({ calendars: [{ id: packageCalendarId, name: "Follow-up Session — In Person (Package)" }] });
      }
      if (url.pathname === "/calendars/events") {
        return Response.json({ events: [{
          startTime: "2026-08-05T09:00:00-07:00",
          contactId,
          calendarId: packageCalendarId,
          contactName: "Test Member",
          appointmentStatus: "confirmed",
        }] });
      }
      if (url.pathname === `/contacts/${contactId}/appointments`) {
        return Response.json({ appointments: [
          { calendarId: packageCalendarId, appointmentStatus: "showed", startTime: "2026-07-08T09:00:00-07:00" },
          { calendarId: packageCalendarId, appointmentStatus: "showed", startTime: "2026-07-15T09:00:00-07:00" },
          { calendarId: packageCalendarId, appointmentStatus: "showed", startTime: "2026-07-22T09:00:00-07:00" },
        ] });
      }
      if (url.pathname === `/contacts/${contactId}`) {
        return Response.json({ contact: { customFields: [
          { id: "wrQSkx6BhXwDGIn1d0V4", value: "1" },
          { id: "3i93lTkmuAV49s9nh0q8", value: "4-session" },
        ] } });
      }
      if (url.pathname === "/payments/orders") {
        return Response.json({ data: [{
          _id: "order-package",
          status: "completed",
          amount: 720,
          sourceType: "point_of_sale",
          createdAt: "2026-07-01T12:00:00-07:00",
          items: [{ product: { _id: "69986faa724ecd2343ebaa6e" } }],
        }] });
      }
      if (url.pathname === "/invoices/") return Response.json({ invoices: [] });
      throw new Error(`Unexpected fetch ${url.pathname}`);
    };

    const summary = await runMorningSms(testEnv(), {
      nowMs: Date.parse("2026-08-05T15:00:00Z"),
      forceKinds: ["prepare"],
      dryRun: true,
    });

    assert.equal(
      summary.sends[0].body,
      "Today's appointments:\n9:00 AM — Test Member · Follow-up Session — In Person (Package) · LAST PACKAGE SESSION\n\nTime to prepare for the day.",
    );
  });
});
