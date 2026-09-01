import { beforeEach, describe, expect, it } from "vitest";

import { fakeD1 } from "./fake-d1.js";
import { handleEnrollmentImport } from "./import-enrollments.js";

const NOW = Date.parse("2026-09-01T12:00:00-07:00");
const DAY = 86400000;

const item = (overrides = {}) => ({
  sequenceId: "flow-1-quiz",
  contactId: "contact-9",
  enteredAt: NOW - 8 * DAY,
  nextStepIndex: 3,
  nextDueAt: NOW + 2 * DAY,
  capturedAt: NOW - 5 * 60 * 1000,
  cursorSource: "provider_enrollment_history",
  ...overrides,
});

const request = (enrollments) => new Request("https://nurture.example/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enrollments }),
});

let env;
beforeEach(() => { env = { NURTURE_DB: fakeD1() }; });

describe("handleEnrollmentImport", () => {
  it("imports an exact fresh cursor, persists history, and records bounded evidence", async () => {
    const response = await handleEnrollmentImport(request([item()]), env, NOW);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.counts).toEqual({ imported: 1, skipped: 0, errors: 0 });
    expect(body.results[0]).toEqual(expect.objectContaining({
      status: "imported", nextStepIndex: 3, nextDueAt: NOW + 2 * DAY,
    }));
    expect(env.NURTURE_DB._steps.map((step) => step.status)).toEqual([
      "imported", "imported", "imported", "pending", "pending", "pending",
    ]);
    expect(env.NURTURE_DB._events).toHaveLength(1);
    expect(env.NURTURE_DB._events[0]).toEqual(expect.objectContaining({
      action: "imported", outcome: "imported", contact_id: "contact-9",
    }));
    expect(JSON.parse(env.NURTURE_DB._events[0].detail)).toEqual(expect.objectContaining({
      cursorSource: "provider_enrollment_history", importedSteps: 3, mode: "shadow",
    }));
  });

  it("is idempotent: an exact replay skips without row or event churn", async () => {
    await handleEnrollmentImport(request([item()]), env, NOW);
    const response = await handleEnrollmentImport(request([item()]), env, NOW);
    const body = await response.json();

    expect(body.counts).toEqual({ imported: 0, skipped: 1, errors: 0 });
    expect(env.NURTURE_DB._enrollments.size).toBe(1);
    expect(env.NURTURE_DB._steps).toHaveLength(6);
    expect(env.NURTURE_DB._events).toHaveLength(1);
  });

  it("preserves ordered mixed-batch results while bad cursors make no writes", async () => {
    const response = await handleEnrollmentImport(request([
      item(),
      item({ contactId: "bad-sequence", sequenceId: "unknown" }),
      item({ contactId: "stale", capturedAt: NOW - 2 * 3600000 }),
    ]), env, NOW);
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.counts).toEqual({ imported: 1, skipped: 0, errors: 2 });
    expect(body.results.map((result) => result.status)).toEqual(["imported", "error", "error"]);
    expect(body.results[1].error).toBe("unknown sequenceId");
    expect(body.results[2].error).toContain("stale");
    expect(env.NURTURE_DB._enrollments.size).toBe(1);
  });

  it("rejects an empty/malformed/oversized contract before database writes", async () => {
    expect((await handleEnrollmentImport(request([]), env, NOW)).status).toBe(400);
    expect((await handleEnrollmentImport(new Request("https://nurture.example/import", {
      method: "POST", body: "{nope",
    }), env, NOW)).status).toBe(400);
    expect((await handleEnrollmentImport(new Request("https://nurture.example/import", {
      method: "POST", headers: { "content-length": "70000" }, body: "{}",
    }), env, NOW)).status).toBe(413);
    expect(env.NURTURE_DB._enrollments.size).toBe(0);
  });

  it("fails closed without the D1 binding", async () => {
    const response = await handleEnrollmentImport(request([item()]), {}, NOW);
    expect(response.status).toBe(503);
  });
});
