import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import worker from "./index.js";
import { upsertOwnedQuizIntake } from "./owned-quiz-intake.js";
import {
  CONTACT_FOREIGN_KEY_COVERAGE,
  CONTACT_NON_FK_REFERENCE_COVERAGE,
  ownedQuizRetentionReadiness,
  planOwnedQuizRetention,
} from "./owned-quiz-retention.js";

function d1(sqlite) {
  const statement = (sql, args = []) => ({
    sql,
    args,
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
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture() {
  const crm = new DatabaseSync(":memory:");
  crm.exec("PRAGMA foreign_keys = ON");
  const names = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const name of names) crm.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const automation = new DatabaseSync(":memory:");
  automation.exec(readFileSync(new URL("../../nurture-engine-worker/schema.sql", import.meta.url), "utf8"));
  return { crm, automation, crmDb: d1(crm), automationDb: d1(automation) };
}

const intake = (key, overrides = {}) => ({
  idempotencyKey: key.repeat(64),
  firstName: "Ari",
  lastName: "Example",
  email: "ari@example.test",
  phone: "415-555-1212",
  patternSignature: "Soft Tissue Tension",
  recoveryPotentialScore: 72,
  primaryPainLocation: "Lower back",
  painSeverity: "moderate",
  painDuration: "3 months",
  treatmentsTried: "Massage",
  painTrigger: "Running",
  additionalPainAreas: "Hips",
  painIntensity: "Moderate",
  painTiming: "Morning",
  painType: "Tightness",
  aggravatingActivities: "Sitting",
  dailyImpact: "Work",
  treatmentResults: "Temporary relief",
  healthConditions: "",
  resultsSummary: "Quiz Results — Ari Example",
  scores: {
    softTissueTension: 50,
    jointBoneAlignment: 50,
    patternDuration: 50,
    dailyActivitiesImpact: 50,
    bodyAdaptations: 50,
  },
  insights: [],
  referralSource: null,
  audience: "bay-area",
  ...overrides,
});

async function expiredQuiz(f, { dispatchState = "dispatched", addAutomation = true } = {}) {
  const captured = await upsertOwnedQuizIntake(f.crmDb, intake("a"), "2025-01-01T00:00:00.000Z");
  if (dispatchState !== "pending") {
    f.crm.prepare(
      "UPDATE quiz_nurture_dispatches SET state = ?, dispatched_at = ?, updated_at = ? WHERE contact_id = ?",
    ).run(dispatchState, "2025-01-01T00:01:00.000Z", "2025-01-01T00:01:00.000Z", captured.contactId);
  }
  if (addAutomation) {
    const enrollmentId = `flow-1-quiz:${captured.contactId}`;
    f.automation.prepare(
      `INSERT INTO nurture_enrollments
       (enrollment_id, sequence_id, definition_version, contact_id, entered_at, status, guard_unchecked)
       VALUES (?, 'flow-1-quiz', 2, ?, ?, 'active', 0)`,
    ).run(enrollmentId, captured.contactId, Date.parse("2025-01-01T00:00:00.000Z"));
    f.automation.prepare(
      `INSERT INTO nurture_steps
       (enrollment_id, step_index, after, kind, template, due_at, status)
       VALUES (?, 0, 'PT0S', 'email', 'f1-email-1-quiz-results', ?, 'would_send')`,
    ).run(enrollmentId, Date.parse("2025-01-01T00:00:00.000Z"));
    f.automation.prepare(
      `INSERT INTO automation_events
       (ts, engine, flow_key, definition_version, contact_id, step_index, action, outcome, channel, detail)
       VALUES (?, 'nurture', 'flow-1-quiz', 2, ?, 0, 'would_send', 'would_send', 'email', '{}')`,
    ).run(Date.parse("2025-01-01T00:00:00.000Z"), captured.contactId);
  }
  return captured;
}

describe("owned quiz retention dry-run", () => {
  it("keeps the explicit CRM dependency catalog equal to every migrated contacts foreign key", () => {
    const f = fixture();
    const actual = [];
    const tables = f.crm.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map((row) => row.name);
    for (const table of tables) {
      for (const foreignKey of f.crm.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all()) {
        if (foreignKey.table === "contacts") actual.push(`${table}.${foreignKey.from}`);
      }
    }
    expect(actual.sort()).toEqual(CONTACT_FOREIGN_KEY_COVERAGE.map(([table, column]) => `${table}.${column}`).sort());
    const namedContactCopies = [];
    for (const table of tables) {
      for (const column of f.crm.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()) {
        if (column.name.includes("contact")) namedContactCopies.push(`${table}.${column.name}`);
      }
    }
    const allCoveredNamedCopies = [
      ...CONTACT_FOREIGN_KEY_COVERAGE.map(([table, column]) => `${table}.${column}`),
      ...CONTACT_NON_FK_REFERENCE_COVERAGE
        .filter(([, column]) => column.includes("contact"))
        .map(([table, column]) => `${table}.${column}`),
    ];
    expect(namedContactCopies.sort()).toEqual([...new Set(allCoveredNamedCopies)].sort());
    f.crm.close();
    f.automation.close();
  });

  it("finds the expired original, every CRM projection, and every Flow 1 automation copy without returning health payloads", async () => {
    const f = fixture();
    const captured = await expiredQuiz(f);
    const plan = await planOwnedQuizRetention(f.crmDb, f.automationDb, "2026-09-01T00:00:00.000Z");

    expect(plan.state).toBe("dry_run_ready");
    expect(plan.deletionEnabled).toBe(false);
    expect(plan.coverage).toEqual({
      crmContactForeignKeys: CONTACT_FOREIGN_KEY_COVERAGE.length,
      crmNonForeignKeyReferences: CONTACT_NON_FK_REFERENCE_COVERAGE.length,
      automationRelations: 3,
    });
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      contactId: captured.contactId,
      dispatch: { state: "dispatched", terminal: true },
      retainedSuccessors: 0,
      purgeScope: "expired_source_and_quiz_projections",
      crmQuizCopies: { submissions: 1, dispatches: 1, projections: { roles: 1, tags: 4, attributes: 16 } },
      otherDependencyTotal: 0,
      automationCopies: { enrollments: 1, steps: 1, events: 1 },
      automationCopyTotal: 3,
      automationCleanupRequired: true,
      contactDisposition: "eligible_for_identity_deletion_review",
      state: "dry_run_ready",
      executionEnabled: false,
    });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
    const laterRead = await planOwnedQuizRetention(f.crmDb, f.automationDb, "2026-09-02T00:00:00.000Z");
    expect(laterRead.planDigest).toBe(plan.planDigest);
    const rendered = JSON.stringify(plan);
    expect(rendered).not.toContain("ari@example.test");
    expect(rendered).not.toContain("Lower back");
    expect(rendered).not.toContain("Quiz Results");
    f.crm.close();
    f.automation.close();
  });

  it("preserves shared identity and current projections when a retained successor exists", async () => {
    const f = fixture();
    const captured = await expiredQuiz(f);
    await upsertOwnedQuizIntake(f.crmDb, intake("b", { painDuration: "4 months" }), "2026-09-01T00:00:00.000Z");
    const plan = await planOwnedQuizRetention(f.crmDb, f.automationDb, "2026-09-02T00:00:00.000Z");
    expect(plan.candidates[0]).toMatchObject({
      contactId: captured.contactId,
      retainedSuccessors: 1,
      purgeScope: "expired_source_only",
      automationCleanupRequired: false,
      contactDisposition: "preserve_contact",
    });
    f.crm.close();
    f.automation.close();
  });

  it("preserves a contact with non-quiz business dependencies and blocks unfinished dispatch", async () => {
    const f = fixture();
    const captured = await expiredQuiz(f, { dispatchState: "pending", addAutomation: false });
    f.crm.prepare(
      `INSERT INTO client_notes
       (id, contact_id, provider_note_id, body, authored_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("note-1", captured.contactId, "owned-note-1", "A business note", "Staff",
      "2025-02-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z");
    const plan = await planOwnedQuizRetention(f.crmDb, f.automationDb, "2026-09-01T00:00:00.000Z");
    expect(plan.state).toBe("attention");
    expect(plan.candidates[0]).toMatchObject({
      dispatch: { state: "pending", terminal: false },
      otherDependencies: { "client_notes.contact_id": 1 },
      contactDisposition: "preserve_contact",
      state: "blocked_unfinished_dispatch",
    });
    f.crm.close();
    f.automation.close();
  });

  it("serves only aggregate retention readiness behind Worker authentication", async () => {
    const f = fixture();
    await expiredQuiz(f);
    const env = { CRM_DB: f.crmDb, AUTOMATION_DB: f.automationDb, WORKER_AUTH_SECRET: "worker-secret" };
    const denied = await worker.fetch(new Request("https://crm.test/quiz-intake/retention-readiness"), env);
    expect(denied.status).toBe(401);
    const response = await worker.fetch(new Request("https://crm.test/quiz-intake/retention-readiness", {
      headers: { Authorization: "Bearer worker-secret" },
    }), env);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      state: "dry_run_ready",
      deletionEnabled: false,
      expiredCandidates: 1,
      unfinishedDispatches: 0,
      quizProjectionCleanupRequired: 1,
      automationCleanupRequired: 1,
      automationCopyRows: 3,
      contactIdentityDeletionReview: 1,
      executionContract: "not_exposed",
    });
    expect(body.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(body).not.toHaveProperty("candidates");
    expect(JSON.stringify(body)).not.toContain("contact_email_");
    f.crm.close();
    f.automation.close();
  });

  it("fails closed when either storage schema is unavailable", async () => {
    await expect(ownedQuizRetentionReadiness({}, {}, "2026-09-01T00:00:00.000Z"))
      .resolves.toMatchObject({ state: "unavailable", deletionEnabled: false });
  });
});
