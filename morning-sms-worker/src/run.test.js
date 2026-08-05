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
});
