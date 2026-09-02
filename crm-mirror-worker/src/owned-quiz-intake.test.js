import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  normalizeOwnedQuizIntake,
  ownedQuizIntakeReadiness,
  OwnedQuizIntakeError,
  upsertOwnedQuizIntake,
} from "./owned-quiz-intake.js";
import worker from "./index.js";

function d1Database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0001_initial_schema.sql", "0023_owned_quiz_intake.sql", "0031_owned_contact_profile_authority.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
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

function valid(overrides = {}) {
  return {
    idempotencyKey: "a".repeat(64),
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
    insights: [{ title: "A useful observation", description: "A short explanation." }],
    referralSource: "garrettmtb",
    audience: "bay-area",
    ...overrides,
  };
}

describe("owned quiz intake", () => {
  it("strictly validates the server-to-server normalized contract", () => {
    expect(normalizeOwnedQuizIntake(valid({ email: " Ari@Example.TEST " }))).toMatchObject({
      email: "ari@example.test",
      painSeverity: "moderate",
      audience: "bay-area",
    });
    expect(() => normalizeOwnedQuizIntake(valid({ forged: true }))).toThrow(OwnedQuizIntakeError);
    expect(() => normalizeOwnedQuizIntake(valid({ audience: "everywhere" }))).toThrow("audience is invalid");
    expect(() => normalizeOwnedQuizIntake(valid({ idempotencyKey: "short" }))).toThrow("idempotencyKey is invalid");
  });

  it("atomically creates an owned lead, exact quiz facts, tags, and retained source evidence", async () => {
    const db = d1Database();
    const now = "2026-09-01T16:00:00.000Z";
    const result = await upsertOwnedQuizIntake(db, valid(), now);

    expect(result).toMatchObject({ deduped: false });
    expect(result.contactId).toMatch(/^contact_email_[a-f0-9]{32}$/);
    expect(db.sqlite.prepare(
      "SELECT first_name, last_name, display_name, email_normalized, phone_e164 FROM contacts",
    ).get()).toEqual({
      first_name: "Ari", last_name: "Example", display_name: "Ari Example",
      email_normalized: "ari@example.test", phone_e164: "+14155551212",
    });
    expect(db.sqlite.prepare(
      "SELECT role, source FROM contact_roles WHERE contact_id = ?",
    ).get(result.contactId)).toEqual({ role: "lead", source: "owned:quiz" });
    expect(db.sqlite.prepare(
      "SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY tag",
    ).all(result.contactId).map((row) => row.tag)).toEqual([
      "audience-bay-area", "pain-location-lower-back", "pain-severity-moderate",
      "quiz submitted", "referred-by-garrettmtb",
    ]);
    expect(db.sqlite.prepare(
      "SELECT attribute_value FROM contact_attributes WHERE contact_id = ? AND source = 'owned:quiz' AND attribute_key = 'painPatternSignature'",
    ).get(result.contactId).attribute_value).toBe("Soft Tissue Tension");
    expect(db.sqlite.prepare(
      "SELECT retention_until FROM quiz_intake_submissions",
    ).get().retention_until).toBe("2027-10-06T16:00:00.000Z");
    expect(db.sqlite.prepare(
      "SELECT state, attempts, event_json FROM quiz_nurture_dispatches",
    ).get()).toEqual({
      state: "pending",
      attempts: 0,
      event_json: JSON.stringify({ kind: "quiz.submitted", contactId: result.contactId }),
    });
    expect(() => db.sqlite.prepare(
      "UPDATE quiz_intake_submissions SET normalized_json = '{}'",
    ).run()).toThrow(/append-only/);
    await expect(ownedQuizIntakeReadiness(db, "2026-09-01T16:01:00.000Z")).resolves.toEqual({
      state: "ready", total: 1, expired: 0, lastSubmittedAt: now,
    });
    await expect(ownedQuizIntakeReadiness(db, "2027-10-06T16:00:00.000Z")).resolves.toEqual({
      state: "attention", total: 1, expired: 1, lastSubmittedAt: now,
    });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.sqlite.close();
  });

  it("deduplicates an exact replay and rejects a changed payload under the same key", async () => {
    const db = d1Database();
    const first = await upsertOwnedQuizIntake(db, valid(), "2026-09-01T16:00:00.000Z");
    const replay = await upsertOwnedQuizIntake(db, valid(), "2026-09-01T16:01:00.000Z");
    expect(replay).toEqual({ ...first, deduped: true });
    await expect(upsertOwnedQuizIntake(db, valid({ firstName: "Changed" }), "2026-09-01T16:02:00.000Z"))
      .rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_intake_submissions").get().count).toBe(1);
    db.sqlite.close();
  });

  it("links an exact existing email without overwriting established CRM identity", async () => {
    const db = d1Database();
    db.sqlite.prepare(`
      INSERT INTO contacts
        (id, first_name, last_name, display_name, email_normalized, phone_e164, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("existing-1", "Established", "Name", "Established Name", "ari@example.test", "+14155550000",
      "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");

    const result = await upsertOwnedQuizIntake(db, valid(), "2026-09-01T16:00:00.000Z");
    expect(result.contactId).toBe("existing-1");
    expect(db.sqlite.prepare(
      "SELECT first_name, display_name, phone_e164 FROM contacts WHERE id = 'existing-1'",
    ).get()).toEqual({ first_name: "Established", display_name: "Established Name", phone_e164: "+14155550000" });
    expect(db.sqlite.prepare(
      "SELECT attribute_value FROM contact_attributes WHERE contact_id = 'existing-1' AND attribute_key = 'primaryPainLocation'",
    ).get().attribute_value).toBe("Lower back");
    db.sqlite.close();
  });

  it("does not let quiz intake overwrite a Staff-owned name or phone destination", async () => {
    const db = d1Database();
    db.sqlite.prepare(`
      INSERT INTO contacts
        (id, first_name, last_name, display_name, email_normalized, phone_e164,
         name_authority, name_revision, phone_authority, phone_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'owned', 3, 'owned', 2, ?, ?)
    `).run("existing-owned", "Staff", "Truth", "Staff Truth", "ari@example.test", "+14155550000",
      "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");

    const result = await upsertOwnedQuizIntake(db, valid({
      firstName: "Quiz", lastName: "Overwrite", phone: "415-555-9999",
    }), "2026-09-01T16:00:00.000Z");
    expect(result.contactId).toBe("existing-owned");
    expect(db.sqlite.prepare(
      `SELECT first_name,last_name,display_name,phone_e164,
              name_authority,name_revision,phone_authority,phone_revision
         FROM contacts WHERE id='existing-owned'`,
    ).get()).toEqual({
      first_name: "Staff", last_name: "Truth", display_name: "Staff Truth",
      phone_e164: "+14155550000", name_authority: "owned", name_revision: 3,
      phone_authority: "owned", phone_revision: 2,
    });
    db.sqlite.close();
  });

  it("fails closed rather than guessing when an email maps to multiple owned people", async () => {
    const db = d1Database();
    for (const id of ["contact-1", "contact-2"]) {
      db.sqlite.prepare(`
        INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, id, "ari@example.test", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    }
    await expect(upsertOwnedQuizIntake(db, valid(), "2026-09-01T16:00:00.000Z"))
      .rejects.toMatchObject({ code: "ambiguous_contact", status: 409 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_intake_submissions").get().count).toBe(0);
    db.sqlite.close();
  });

  it("does not silently reactivate or attach fresh health data to an archived person", async () => {
    const db = d1Database();
    db.sqlite.prepare(`
      INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("archived-1", "Archived Person", "ari@example.test", "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z", "2026-08-15T00:00:00.000Z");
    await expect(upsertOwnedQuizIntake(db, valid(), "2026-09-01T16:00:00.000Z"))
      .rejects.toMatchObject({ code: "archived_contact_review", status: 409 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_intake_submissions").get().count).toBe(0);
    expect(db.sqlite.prepare("SELECT archived_at FROM contacts WHERE id = 'archived-1'").get().archived_at)
      .toBe("2026-08-15T00:00:00.000Z");
    db.sqlite.close();
  });

  it("keeps the intake route behind explicit Worker auth and bounded validation", async () => {
    const db = d1Database();
    const request = (authorization, body = valid()) => new Request("https://crm.test/contacts/quiz-intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
    const env = { CRM_DB: db, WORKER_AUTH_SECRET: "worker-secret" };

    expect((await worker.fetch(request(), env)).status).toBe(401);
    const invalid = await worker.fetch(request("Bearer worker-secret", valid({ audience: "forged" })), env);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "invalid_quiz_intake" });

    const created = await worker.fetch(request("Bearer worker-secret"), env);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      success: true,
      deduped: false,
      contactId: expect.stringMatching(/^contact_email_/),
      payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM quiz_intake_submissions").get().count).toBe(1);

    const readiness = await worker.fetch(new Request("https://crm.test/quiz-intake/readiness", {
      headers: { Authorization: "Bearer worker-secret" },
    }), env);
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({
      state: "ready",
      total: 1,
      expired: 0,
      nurtureDispatch: { configured: true, state: "pending", blocking: 1, shadowOnly: true, deliveryEnabled: false },
    });
    db.sqlite.close();
  });

  it("reports an honest unavailable readiness state before the schema is installed", async () => {
    await expect(ownedQuizIntakeReadiness({
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no table"); } }) }),
    })).resolves.toEqual({ state: "unavailable", total: 0, expired: 0, lastSubmittedAt: null });
  });
});
