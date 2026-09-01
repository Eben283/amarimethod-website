import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import { runMorningSms } from "./run.js";
import { MORNING_SMS_DEFINITION } from "./config.js";
import { defineMorningSmsWorkflow } from "./workflow-definition.js";

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
  it("fails closed if the displayed node order no longer matches the executor", () => {
    const definition = structuredClone(MORNING_SMS_DEFINITION);
    [definition.steps[5], definition.steps[6]] = [definition.steps[6], definition.steps[5]];
    assert.throws(() => defineMorningSmsWorkflow(definition), /step order or branching/);
  });

  it("fails closed if the dynamic agenda logic is no longer inspectable", () => {
    const definition = structuredClone(MORNING_SMS_DEFINITION);
    delete definition.steps.find((step) => step.id === "morning-send-agenda").logic;
    assert.throws(() => defineMorningSmsWorkflow(definition), /inspectable logic/);
  });

  it("executes message copy and node identity from the canonical workflow document", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") return Response.json({ calendars: [] });
      return Response.json({ events: [] });
    };
    const definition = structuredClone(MORNING_SMS_DEFINITION);
    definition.definitionVersion = 99;
    definition.steps.find((step) => step.id === "morning-send-agenda").copy = "CANONICAL {{agenda}}";

    const summary = await runMorningSms(testEnv(), {
      nowMs: Date.parse("2026-08-05T15:00:00Z"),
      forceKinds: ["prepare"],
      dryRun: true,
      definition,
    });

    assert.equal(summary.definitionId, MORNING_SMS_DEFINITION.id);
    assert.equal(summary.definitionVersion, 99);
    assert.equal(summary.sends[0].body, "CANONICAL Good morning — no appointments today.");
    assert.deepEqual(summary.executedNodeIds, [
      "morning-cron",
      "morning-calendar-read",
      "morning-last-session",
      "morning-schedule",
      "morning-agenda",
      "morning-send-agenda",
      "morning-run-evidence",
    ]);
  });

  it("executes the dynamic agenda format published by the canonical workflow document", async () => {
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
    const definition = structuredClone(MORNING_SMS_DEFINITION);
    definition.agendaCopy.appointmentLine = "{{time}} / {{label}}";

    const summary = await runMorningSms(testEnv(), {
      nowMs: Date.parse("2026-08-05T15:00:00Z"),
      forceKinds: ["prepare"],
      dryRun: true,
      definition,
    });

    assert.equal(
      summary.sends[0].body,
      "Today's appointments:\n9:00 AM / Test Member\n\nTime to prepare for the day.",
    );
  });

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
      "Today's appointments:\n9:00 AM — Test Member\n\nTime to prepare for the day.",
    );
    assert.equal(summary.sends[0].result.shadowed, true);
  });

  it("records the canonical trigger, schedule, and evidence nodes when nothing is due", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") return Response.json({ calendars: [] });
      return Response.json({ events: [] });
    };
    const summary = await runMorningSms(testEnv(), { nowMs: Date.parse("2026-08-05T14:30:00Z") });
    assert.deepEqual(summary.executedNodeIds, [
      "morning-cron",
      "morning-calendar-read",
      "morning-last-session",
      "morning-schedule",
      "morning-run-evidence",
    ]);
    assert.deepEqual(summary.skipped, ["nothing due in grace window"]);
  });

  it("leaves prepare eligible for the next cron instead of sending a bad fallback", async () => {
    const env = testEnv();
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/calendars/") return Response.json({ calendars: [{ id: "cal-fail", name: "Assessment" }] });
      return new Response("rate limited", { status: 429 });
    };

    const summary = await runMorningSms(env, {
      nowMs: Date.parse("2026-08-05T15:00:00Z"),
      forceKinds: ["prepare"],
    });

    assert.equal(summary.sends.length, 0);
    assert.deepEqual(summary.skipped, [{ kind: "prepare", reason: "appointment-lookup-unavailable-will-retry" }]);
    assert.deepEqual(summary.agendaLookup, { status: "unavailable", attempts: 2, reason: "ghl-429" });
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
      "Today's appointments:\n9:00 AM — Test Member · SELL: LAST PACKAGE SESSION\n\nTime to prepare for the day.",
    );
  });
});
