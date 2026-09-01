import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { upsertOwnedQuizIntake } from "../../crm-mirror-worker/src/owned-quiz-intake.js";
import { readOwnedContactFields, readOwnedContactRecipient } from "./owned-contact.js";
import { renderNurtureTemplate } from "./templates.js";

function d1Database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const path of [
    "../../crm-mirror-worker/migrations/0001_initial_schema.sql",
    "../../crm-mirror-worker/migrations/0023_owned_quiz_intake.sql",
  ]) sqlite.exec(readFileSync(new URL(path, import.meta.url), "utf8"));
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    _run: () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    sqlite,
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

const intake = {
  idempotencyKey: "d".repeat(64),
  firstName: "Ari",
  lastName: "Example",
  email: "ari@example.test",
  phone: "",
  patternSignature: "Soft Tissue Tension",
  recoveryPotentialScore: 72,
  primaryPainLocation: "Lower back",
  painSeverity: "moderate",
  painDuration: "3 months",
  treatmentsTried: "",
  painTrigger: "Running",
  additionalPainAreas: "",
  painIntensity: "Moderate",
  painTiming: "Morning",
  painType: "Tightness",
  aggravatingActivities: "Sitting",
  dailyImpact: "Work",
  treatmentResults: "",
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
};

describe("owned quiz intake to native nurture copy", () => {
  it("renders the immediate and personalized messages without any GHL identity or field read", async () => {
    const db = d1Database();
    const captured = await upsertOwnedQuizIntake(db, intake, "2026-09-01T16:00:00.000Z");
    const [recipient, fields] = await Promise.all([
      readOwnedContactRecipient(db, captured.contactId),
      readOwnedContactFields(db, captured.contactId),
    ]);
    const merge = {
      "contact.first_name": recipient.firstName,
      "contact.primary_pain_location": fields.primaryPainLocation,
      "contact.pain_pattern_signature": fields.painPatternSignature,
      "contact.pain_duration": fields.painDuration,
    };

    expect(fields).toEqual({
      primaryPainLocation: "Lower back",
      painPatternSignature: "Soft Tissue Tension",
      painDuration: "3 months",
    });
    expect(renderNurtureTemplate("f1-email-1-quiz-results", merge)).toMatchObject({
      subject: "Ari, your Soft Tissue Tension pattern explained",
      preheader: "Here's what your quiz results reveal about your Lower back pain.",
    });
    expect(renderNurtureTemplate("f1-email-2", merge).body)
      .toContain("After 3 months of dealing with Lower back pain");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM external_records").get().count).toBe(0);
    db.sqlite.close();
  });
});
