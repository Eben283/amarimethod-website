import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { readMissedAppointmentTruth } from "./missed-appointment-truth.js";
import { upsertGhlAppointment } from "./repository.js";

function d1(sqlite) {
  const statement = (sql, values = []) => ({
    sql,
    values,
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes || 0) } }),
    _all: () => ({ results: sqlite.prepare(sql).all(...values) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => statements.map((item) => item._all()),
  };
}

function migrations() {
  const directory = new URL("../migrations/", import.meta.url);
  return readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, directory), "utf8") }));
}

function insertContact(db, id = "contact-1") {
  db.prepare(
    "INSERT INTO contacts (id, display_name, created_at, updated_at) VALUES (?, 'Avery Example', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
  ).run(id);
}

function insertAppointment(db, { id, status, revision = 1, authority = "provider_mirror", startsAt }) {
  db.prepare(
    `INSERT INTO appointments
       (id, contact_id, service_id, provider_appointment_id, status, starts_at, ends_at,
        timezone, authority, provider_sync_state, revision, created_at, updated_at)
     VALUES (?, 'contact-1', 'partner-initial', ?, ?, ?, ?, 'America/Los_Angeles', ?,
             ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(
    id,
    authority === "owned" ? null : `provider-${id}`,
    status,
    startsAt,
    startsAt,
    authority,
    authority === "owned" ? "not_required" : "synced",
    revision,
  );
}

describe("owned missed-appointment truth", () => {
  it("backfills honest baselines, derives a count, and never promotes the legacy field", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const all = migrations();
    for (const migration of all.slice(0, -1)) db.exec(migration.sql);
    expect(all.at(-1).name).toBe("0026_owned_missed_appointment_truth.sql");
    insertContact(db);
    insertAppointment(db, { id: "missed-1", status: "no_show", startsAt: "2026-08-01T17:00:00.000Z" });
    insertAppointment(db, { id: "attended-1", status: "attended", startsAt: "2026-08-08T17:00:00.000Z" });
    db.prepare(
      `INSERT INTO contact_attributes (contact_id, attribute_key, attribute_value, source, updated_at)
       VALUES ('contact-1', 'e9COM3UBr7m8GnCTPPYG', '4', 'ghl', '2026-09-01T00:00:00.000Z')`,
    ).run();
    db.exec(all.at(-1).sql);

    const truth = await readMissedAppointmentTruth(d1(db), { contactId: "contact-1" });
    expect(truth).toMatchObject({
      readOnly: true,
      mutableCounterWritten: false,
      authorityPromoted: false,
      state: "baseline",
      summary: { appointments: 2, missedAppointments: 1, missingFacts: 0, baselineFacts: 2, currentMismatches: 0 },
      legacyObservation: { observedValue: 4, comparable: true, matchesDerived: false, authoritative: false },
      truncated: false,
      missedAppointments: [{ appointmentId: "missed-1", status: "no_show", sourceKind: "migration_baseline", historyComplete: false }],
    });
    expect(() => db.prepare("UPDATE appointment_status_facts SET normalized_status = 'attended'").run())
      .toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM appointment_status_facts").run()).toThrow(/append-only/);
    db.close();
  });

  it("appends revisions once and a correction removes the appointment from the derived count", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations()) db.exec(migration.sql);
    insertContact(db);
    insertAppointment(db, {
      id: "owned-1", status: "confirmed", authority: "owned", startsAt: "2026-08-01T17:00:00.000Z",
    });
    db.prepare(
      `UPDATE appointments
          SET status = 'no_show', revision = revision + 1,
              attendance_marked_at = '2026-08-01T18:00:00.000Z', updated_at = '2026-08-01T18:00:00.000Z'
        WHERE id = 'owned-1'`,
    ).run();
    expect((await readMissedAppointmentTruth(d1(db), { contactId: "contact-1" })).summary.missedAppointments).toBe(1);

    // A replay that does not change canonical status or revision writes no fact.
    db.prepare("UPDATE appointments SET updated_at = '2026-08-01T18:01:00.000Z' WHERE id = 'owned-1'").run();
    expect(db.prepare("SELECT COUNT(*) AS count FROM appointment_status_facts").get()).toEqual({ count: 2 });

    db.prepare(
      `UPDATE appointments
          SET status = 'attended', revision = revision + 1,
              attendance_marked_at = '2026-08-01T18:02:00.000Z', updated_at = '2026-08-01T18:02:00.000Z'
        WHERE id = 'owned-1'`,
    ).run();
    const corrected = await readMissedAppointmentTruth(d1(db), { contactId: "contact-1" });
    expect(corrected).toMatchObject({
      state: "ready",
      summary: { appointments: 1, missedAppointments: 0, missingFacts: 0, baselineFacts: 0, currentMismatches: 0 },
      missedAppointments: [],
    });
    expect(db.prepare(
      "SELECT appointment_revision, normalized_status FROM appointment_status_facts ORDER BY appointment_revision",
    ).all()).toEqual([
      { appointment_revision: 1, normalized_status: "confirmed" },
      { appointment_revision: 2, normalized_status: "no_show" },
      { appointment_revision: 3, normalized_status: "attended" },
    ]);
    db.close();
  });

  it("advances a mirrored appointment revision only when provider status changes", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations()) sqlite.exec(migration.sql);
    insertContact(sqlite);
    const database = d1(sqlite);
    const providerAppointment = (status) => ({
      externalId: "provider-appointment-1",
      contactExternalId: "provider-contact-1",
      calendarId: "lfsnaiGiLNL2z12pLKDP",
      providerStatusRaw: status === "no_show" ? "noshow" : status,
      status,
      startsAt: "2026-08-01T17:00:00.000Z",
      endsAt: "2026-08-01T18:00:00.000Z",
      timezone: "America/Los_Angeles",
      meetingLocation: "662 8th Ave",
    });

    await upsertGhlAppointment(database, providerAppointment("confirmed"), "contact-1", "2026-08-01T16:00:00.000Z");
    await upsertGhlAppointment(database, providerAppointment("no_show"), "contact-1", "2026-08-01T18:00:00.000Z");
    await upsertGhlAppointment(database, providerAppointment("no_show"), "contact-1", "2026-08-01T18:01:00.000Z");

    expect(sqlite.prepare(
      "SELECT status, revision FROM appointments WHERE provider_appointment_id = 'provider-appointment-1'",
    ).get()).toEqual({ status: "no_show", revision: 2 });
    expect(sqlite.prepare(
      "SELECT appointment_revision, normalized_status FROM appointment_status_facts ORDER BY appointment_revision",
    ).all()).toEqual([
      { appointment_revision: 1, normalized_status: "confirmed" },
      { appointment_revision: 2, normalized_status: "no_show" },
    ]);
    expect((await readMissedAppointmentTruth(database, { contactId: "contact-1" })).summary.missedAppointments).toBe(1);
    sqlite.close();
  });

  it("fails closed when schema or owned contact identity is unavailable", async () => {
    await expect(readMissedAppointmentTruth({
      batch: async () => { throw new Error("no such table: appointment_status_facts"); },
      prepare: () => ({ bind() { return this; } }),
    }, { contactId: "contact-1" })).rejects.toMatchObject({ code: "schema_unavailable", status: 503 });
    await expect(readMissedAppointmentTruth({}, { contactId: "bad contact" }))
      .rejects.toMatchObject({ code: "invalid_contact_id" });
  });
});
