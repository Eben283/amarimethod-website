import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  captureOwnedAppointmentAttendance,
  OWNED_ATTENDANCE_SOURCE_MODE,
  ownedAttendanceReleaseReadiness,
} from "./owned-appointment-attendance.js";
import { readMissedAppointmentTruth } from "./missed-appointment-truth.js";

function migrations() {
  const directory = new URL("../migrations/", import.meta.url);
  return readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, directory), "utf8") }));
}

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

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations()) sqlite.exec(migration.sql);
  return sqlite;
}

function insertContact(sqlite, { id = "contact-1", archivedAt = null } = {}) {
  sqlite.prepare(
    `INSERT INTO contacts (id, display_name, archived_at, created_at, updated_at)
     VALUES (?, 'Avery Example', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(id, archivedAt);
}

function insertAppointment(sqlite, {
  id = "appointment-1",
  contactId = "contact-1",
  status = "confirmed",
  authority = "owned",
  providerSyncState = "not_required",
  revision = 1,
  startsAt = "2026-09-01T17:00:00.000Z",
} = {}) {
  sqlite.prepare(
    `INSERT INTO appointments (
       id, contact_id, service_id, provider_appointment_id, status, starts_at, ends_at,
       timezone, authority, provider_sync_state, revision, created_by, last_modified_by,
       created_at, updated_at
     ) VALUES (?, ?, 'partner-initial', ?, ?, ?, '2026-09-01T18:00:00.000Z',
               'America/Los_Angeles', ?, ?, ?, 'Garrett', 'Garrett',
               '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(
    id,
    contactId,
    authority === "provider_mirror" ? `provider-${id}` : null,
    status,
    startsAt,
    authority,
    providerSyncState,
    revision,
  );
}

const command = (overrides = {}) => ({
  appointmentId: "appointment-1",
  contactId: "contact-1",
  actor: "Garrett",
  idempotencyKey: "attendance-command-0001",
  targetStatus: "no_show",
  expectedRevision: 1,
  ...overrides,
});

const active = { sourceMode: "active" };

function rawCommand(sqlite, {
  id = "aatcmd_raw",
  appointmentId = "appointment-1",
  contactId = "contact-1",
  targetStatus = "no_show",
  priorStatus = "confirmed",
  expectedRevision = 1,
  requestedAt = "2026-09-01T17:05:00.000Z",
} = {}) {
  return sqlite.prepare(
    `INSERT INTO appointment_attendance_commands (
       id, appointment_id, contact_id, actor, idempotency_key, target_status,
       prior_status, expected_revision, result_revision, payload_sha256,
       outcome, state, requested_at, completed_at
     ) VALUES (?, ?, ?, 'Garrett', ?, ?, ?, ?, ?, ?, 'applied', 'completed', ?, ?)`,
  ).run(
    id, appointmentId, contactId, `raw-${id}`, targetStatus, priorStatus,
    expectedRevision, expectedRevision + 1, "a".repeat(64), requestedAt, requestedAt,
  );
}

describe("owned appointment attendance authority", () => {
  it("is source-pinned shadow and cannot be enabled by environment configuration", async () => {
    expect(OWNED_ATTENDANCE_SOURCE_MODE).toBe("shadow");
    expect(ownedAttendanceReleaseReadiness()).toEqual({
      sourceMode: "shadow",
      enabled: false,
      providerFallback: null,
      providerWrite: false,
      sessionLedgerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      authorityPromotion: false,
    });
    await expect(captureOwnedAppointmentAttendance({
      prepare: () => { throw new Error("storage must not be touched"); },
    }, command())).rejects.toMatchObject({ code: "owned_attendance_shadow_only", status: 503 });
  });

  it("atomically applies one no-show, records immutable evidence, and replays exactly once", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);

    const applied = await captureOwnedAppointmentAttendance(
      db,
      command(),
      "2026-09-01T17:05:00.000Z",
      active,
    );
    expect(applied).toMatchObject({
      appointmentId: "appointment-1",
      contactId: "contact-1",
      actor: "Garrett",
      targetStatus: "no_show",
      priorStatus: "confirmed",
      expectedRevision: 1,
      resultRevision: 2,
      outcome: "applied",
      changed: true,
      deduped: false,
      currentStatus: "no_show",
      currentRevision: 2,
      authority: "owned",
      providerSyncState: "not_required",
      providerWrite: false,
      sessionLedgerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      authorityPromoted: false,
    });
    expect(sqlite.prepare(
      `SELECT status, attendance_marked_by, attendance_marked_at, revision,
              authority, provider_sync_state, provider_appointment_id
         FROM appointments WHERE id = 'appointment-1'`,
    ).get()).toEqual({
      status: "no_show",
      attendance_marked_by: "Garrett",
      attendance_marked_at: "2026-09-01T17:05:00.000Z",
      revision: 2,
      authority: "owned",
      provider_sync_state: "not_required",
      provider_appointment_id: null,
    });
    expect(sqlite.prepare(
      "SELECT event_type FROM appointment_attendance_events ORDER BY rowid",
    ).all()).toEqual([{ event_type: "accepted" }, { event_type: "status_applied" }]);
    expect(sqlite.prepare(
      "SELECT appointment_revision, normalized_status FROM appointment_status_facts ORDER BY appointment_revision",
    ).all()).toEqual([
      { appointment_revision: 1, normalized_status: "confirmed" },
      { appointment_revision: 2, normalized_status: "no_show" },
    ]);

    const replay = await captureOwnedAppointmentAttendance(
      db,
      command(),
      "2026-09-01T17:10:00.000Z",
      active,
    );
    expect(replay).toMatchObject({ commandId: applied.commandId, deduped: true, resultRevision: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_attendance_commands").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_attendance_events").get()).toEqual({ count: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_status_facts").get()).toEqual({ count: 2 });
    sqlite.close();
  });

  it("appends an attended correction and derives zero current missed appointments", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);
    await captureOwnedAppointmentAttendance(db, command(), "2026-09-01T17:05:00.000Z", active);
    const corrected = await captureOwnedAppointmentAttendance(db, command({
      idempotencyKey: "attendance-command-0002",
      targetStatus: "attended",
      expectedRevision: 2,
    }), "2026-09-01T17:10:00.000Z", active);

    expect(corrected).toMatchObject({
      priorStatus: "no_show",
      targetStatus: "attended",
      outcome: "applied",
      resultRevision: 3,
      currentStatus: "attended",
      currentRevision: 3,
    });
    expect(sqlite.prepare(
      "SELECT appointment_revision, normalized_status FROM appointment_status_facts ORDER BY appointment_revision",
    ).all()).toEqual([
      { appointment_revision: 1, normalized_status: "confirmed" },
      { appointment_revision: 2, normalized_status: "no_show" },
      { appointment_revision: 3, normalized_status: "attended" },
    ]);
    await expect(readMissedAppointmentTruth(db, { contactId: "contact-1" })).resolves.toMatchObject({
      state: "ready",
      summary: { missedAppointments: 0, missingFacts: 0, currentMismatches: 0 },
    });
    sqlite.close();
  });

  it("reserves a no-change idempotency key without revising appointment truth", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite, { status: "attended", revision: 4 });
    const db = d1(sqlite);
    const noChange = await captureOwnedAppointmentAttendance(db, command({
      targetStatus: "attended",
      expectedRevision: 4,
    }), "2026-09-01T17:05:00.000Z", active);
    expect(noChange).toMatchObject({
      priorStatus: "attended",
      targetStatus: "attended",
      expectedRevision: 4,
      resultRevision: 4,
      outcome: "no_change",
      changed: false,
      deduped: false,
      currentRevision: 4,
    });
    expect(sqlite.prepare("SELECT revision FROM appointments WHERE id = 'appointment-1'").get()).toEqual({ revision: 4 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_status_facts").get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      "SELECT event_type FROM appointment_attendance_events ORDER BY rowid",
    ).all()).toEqual([{ event_type: "accepted" }, { event_type: "status_unchanged" }]);
    const replay = await captureOwnedAppointmentAttendance(db, command({
      targetStatus: "attended",
      expectedRevision: 4,
    }), "2026-09-01T17:20:00.000Z", active);
    expect(replay).toMatchObject({ commandId: noChange.commandId, deduped: true, outcome: "no_change" });
    sqlite.close();
  });

  it("fails closed on reused keys, stale revision, provider mirror, archive, cancellation, and early marking", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);
    await captureOwnedAppointmentAttendance(db, command(), "2026-09-01T17:05:00.000Z", active);
    await expect(captureOwnedAppointmentAttendance(db, command({
      targetStatus: "attended",
    }), "2026-09-01T17:10:00.000Z", active)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(captureOwnedAppointmentAttendance(db, command({
      idempotencyKey: "attendance-command-stale",
      targetStatus: "attended",
      expectedRevision: 1,
    }), "2026-09-01T17:10:00.000Z", active)).rejects.toMatchObject({ code: "appointment_revision_conflict" });

    insertContact(sqlite, { id: "contact-mirror" });
    insertAppointment(sqlite, {
      id: "appointment-mirror",
      contactId: "contact-mirror",
      authority: "provider_mirror",
      providerSyncState: "synced",
    });
    await expect(captureOwnedAppointmentAttendance(db, command({
      appointmentId: "appointment-mirror",
      contactId: "contact-mirror",
      idempotencyKey: "attendance-command-mirror",
    }), "2026-09-01T17:05:00.000Z", active)).rejects.toMatchObject({ code: "appointment_authority_unavailable" });

    insertContact(sqlite, { id: "contact-archived", archivedAt: "2026-09-01T16:00:00.000Z" });
    insertAppointment(sqlite, { id: "appointment-archived", contactId: "contact-archived" });
    await expect(captureOwnedAppointmentAttendance(db, command({
      appointmentId: "appointment-archived",
      contactId: "contact-archived",
      idempotencyKey: "attendance-command-archived",
    }), "2026-09-01T17:05:00.000Z", active)).rejects.toMatchObject({ code: "contact_archived" });

    insertContact(sqlite, { id: "contact-cancelled" });
    insertAppointment(sqlite, { id: "appointment-cancelled", contactId: "contact-cancelled", status: "cancelled" });
    await expect(captureOwnedAppointmentAttendance(db, command({
      appointmentId: "appointment-cancelled",
      contactId: "contact-cancelled",
      idempotencyKey: "attendance-command-cancelled",
    }), "2026-09-01T17:05:00.000Z", active)).rejects.toMatchObject({ code: "appointment_cancelled" });

    insertContact(sqlite, { id: "contact-early" });
    insertAppointment(sqlite, { id: "appointment-early", contactId: "contact-early" });
    await expect(captureOwnedAppointmentAttendance(db, command({
      appointmentId: "appointment-early",
      contactId: "contact-early",
      idempotencyKey: "attendance-command-early-no-show",
    }), "2026-09-01T16:59:59.000Z", active)).rejects.toMatchObject({ code: "no_show_too_early" });
    await expect(captureOwnedAppointmentAttendance(db, command({
      appointmentId: "appointment-early",
      contactId: "contact-early",
      idempotencyKey: "attendance-command-early-attended",
      targetStatus: "attended",
    }), "2026-09-01T14:59:59.000Z", active)).rejects.toMatchObject({ code: "attended_too_early" });
    sqlite.close();
  });

  it("enforces authority, revision, and timing again inside the atomic database statement", () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    expect(() => rawCommand(sqlite, { expectedRevision: 2 })).toThrow(/attendance revision conflict/i);
    expect(() => rawCommand(sqlite, {
      id: "aatcmd_early",
      requestedAt: "2026-09-01T16:59:59.000Z",
    })).toThrow(/no-show marking is too early/i);

    insertContact(sqlite, { id: "contact-mirror" });
    insertAppointment(sqlite, {
      id: "appointment-mirror",
      contactId: "contact-mirror",
      authority: "provider_mirror",
      providerSyncState: "synced",
    });
    expect(() => rawCommand(sqlite, {
      id: "aatcmd_mirror",
      appointmentId: "appointment-mirror",
      contactId: "contact-mirror",
    })).toThrow(/attendance authority unavailable/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_attendance_commands").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_attendance_events").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT status, revision FROM appointments WHERE id = 'appointment-1'").get())
      .toEqual({ status: "confirmed", revision: 1 });
    sqlite.close();
  });

  it("cannot mutate evidence and has zero ledger, payment, message, recovery, or entitlement effect", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    await captureOwnedAppointmentAttendance(
      d1(sqlite), command(), "2026-09-01T17:05:00.000Z", active,
    );
    expect(() => sqlite.exec("UPDATE appointment_attendance_commands SET state = 'completed'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM appointment_attendance_commands"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("UPDATE appointment_attendance_events SET event_type = 'accepted'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM appointment_attendance_events"))
      .toThrow(/append-only/i);
    for (const table of [
      "appointment_payment_events",
      "appointment_payment_records",
      "session_ledger_entries",
      "owned_communication_commands",
      "outbound_delivery_attempts",
      "appointment_recovery_requests",
      "purchases",
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(sqlite.prepare(
      "SELECT authority, provider_sync_state, provider_appointment_id FROM appointments WHERE id = 'appointment-1'",
    ).get()).toEqual({ authority: "owned", provider_sync_state: "not_required", provider_appointment_id: null });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
