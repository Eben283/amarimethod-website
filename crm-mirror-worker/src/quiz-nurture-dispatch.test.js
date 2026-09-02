import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import { upsertOwnedQuizIntake } from "./owned-quiz-intake.js";
import { dispatchOwnedQuizNurture, ownedQuizNurtureDispatchReadiness } from "./quiz-nurture-dispatch.js";

function db() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_initial_schema.sql", "0023_owned_quiz_intake.sql", "0031_owned_contact_profile_authority.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
    _run: () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((entry) => entry._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const quiz = () => ({
  idempotencyKey: "a".repeat(64), firstName: "Ari", lastName: "Example",
  email: "ari@example.test", phone: "", patternSignature: "Soft Tissue Tension",
  recoveryPotentialScore: 72, primaryPainLocation: "Lower back", painSeverity: "moderate",
  painDuration: "3 months", treatmentsTried: "", painTrigger: "", additionalPainAreas: "",
  painIntensity: "Moderate", painTiming: "Morning", painType: "Tightness",
  aggravatingActivities: "Sitting", dailyImpact: "Work", treatmentResults: "Temporary",
  healthConditions: "", resultsSummary: "Quiz Results", scores: {
    softTissueTension: 50, jointBoneAlignment: 50, patternDuration: 50,
    dailyActivitiesImpact: 50, bodyAdaptations: 50,
  }, insights: [], referralSource: null, audience: "bay-area",
});

async function captured(database) {
  return upsertOwnedQuizIntake(database, quiz(), "2026-09-01T18:00:00.000Z");
}

describe("owned quiz nurture dispatch", () => {
  it("hands the exact owned contact event to the authenticated shadow engine once", async () => {
    const database = db();
    const intake = await captured(database);
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      actions: [{ engine: "nurture", action: "enroll", detail: { sequenceId: "flow-1-quiz" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const env = { CRM_DB: database, WORKER_AUTH_SECRET: "secret", NURTURE: { fetch } };

    await expect(dispatchOwnedQuizNurture(env, Date.parse("2026-09-01T18:01:00.000Z"))).resolves.toEqual({
      status: "succeeded", considered: 1, dispatched: 1, retryable: 0, manualReview: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://nurture-engine/event");
    expect(init.headers.Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toEqual({ kind: "quiz.submitted", contactId: intake.contactId });
    expect(database.sqlite.prepare("SELECT state, attempts FROM quiz_nurture_dispatches").get())
      .toEqual({ state: "dispatched", attempts: 1 });
    expect(await ownedQuizNurtureDispatchReadiness(database)).toMatchObject({
      configured: true, state: "ready", blocking: 0, counts: { dispatched: 1 }, shadowOnly: true, deliveryEnabled: false,
    });
  });

  it("retries a missing binding and accepts the nurture engine's idempotent no-op", async () => {
    const database = db();
    await captured(database);
    await expect(dispatchOwnedQuizNurture({ CRM_DB: database }, Date.parse("2026-09-01T18:01:00.000Z")))
      .resolves.toMatchObject({ status: "attention", retryable: 1 });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      actions: [{ engine: "nurture", action: "enroll-noop", detail: { sequenceId: "flow-1-quiz" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(dispatchOwnedQuizNurture({ CRM_DB: database, WORKER_AUTH_SECRET: "secret", NURTURE: { fetch } },
      Date.parse("2026-09-01T18:06:00.000Z"))).resolves.toMatchObject({ status: "succeeded", dispatched: 1 });
    expect(database.sqlite.prepare("SELECT state, attempts FROM quiz_nurture_dispatches").get())
      .toEqual({ state: "dispatched", attempts: 2 });
  });

  it("quarantines digest drift and a cross-flow acknowledgement", async () => {
    const drift = db();
    await captured(drift);
    drift.sqlite.prepare("UPDATE quiz_nurture_dispatches SET payload_sha256 = ?").run("0".repeat(64));
    await expect(dispatchOwnedQuizNurture({ CRM_DB: drift }, Date.parse("2026-09-01T18:01:00.000Z")))
      .resolves.toMatchObject({ status: "attention", manualReview: 1 });
    expect(drift.sqlite.prepare("SELECT state, last_error FROM quiz_nurture_dispatches").get())
      .toEqual({ state: "manual_review", last_error: "quiz nurture payload digest mismatch" });

    const crossed = db();
    await captured(crossed);
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      actions: [{ engine: "nurture", action: "enroll", detail: { sequenceId: "flow-3-post-initial" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(dispatchOwnedQuizNurture({ CRM_DB: crossed, WORKER_AUTH_SECRET: "secret", NURTURE: { fetch } },
      Date.parse("2026-09-01T18:01:00.000Z"))).resolves.toMatchObject({ status: "attention", manualReview: 1 });
  });

  it("reports unavailable before migration 0023 is installed", async () => {
    const unavailable = { prepare: () => ({ all: async () => { throw new Error("no table"); } }) };
    await expect(ownedQuizNurtureDispatchReadiness(unavailable)).resolves.toMatchObject({ configured: false, state: "unavailable" });
  });
});
