import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import worker from "./index.js";
import {
  captureOwnedNoteVersion,
  OWNED_NOTE_SOURCE_MODE,
  ownedNoteReleaseReadiness,
  readOwnedNotes,
} from "./owned-notes.js";

function migrations() {
  const directory = new URL("../migrations/", import.meta.url);
  return readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8"));
}

function d1(sqlite) {
  const statement = (sql, values = []) => ({
    sql,
    values,
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes || 0) } }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((item) => item.all())),
  };
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations()) sqlite.exec(migration);
  return sqlite;
}

function insertContact(sqlite, id = "contact-1", archivedAt = null) {
  sqlite.prepare(
    `INSERT INTO contacts (id, display_name, archived_at, created_at, updated_at)
     VALUES (?, 'Avery Example', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(id, archivedAt);
}

function insertAppointment(sqlite, id = "appointment-1", contactId = "contact-1") {
  sqlite.prepare(
    `INSERT INTO appointments (
       id, contact_id, service_id, status, starts_at, ends_at, timezone,
       authority, provider_sync_state, revision, created_at, updated_at
     ) VALUES (?, ?, 'partner-initial', 'confirmed',
               '2026-09-01T17:00:00.000Z', '2026-09-01T18:00:00.000Z',
               'America/Los_Angeles', 'owned', 'not_required', 1,
               '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(id, contactId);
}

const active = { sourceMode: "active" };
const create = (overrides = {}) => ({
  action: "create",
  contactId: "contact-1",
  appointmentId: "appointment-1",
  actor: "Garrett",
  idempotencyKey: "owned-note-command-0001",
  body: "Client reported easier rotation after the session.",
  ...overrides,
});

describe("owned note authority", () => {
  it("is source-pinned shadow and exposes no provider or destructive fallback", async () => {
    expect(OWNED_NOTE_SOURCE_MODE).toBe("shadow");
    expect(ownedNoteReleaseReadiness()).toEqual({
      version: "owned-note-authority.v1",
      sourceMode: "shadow",
      enabled: false,
      providerFallback: null,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      destructiveDeleteExposed: false,
      authorityPromotion: false,
    });
    await expect(captureOwnedNoteVersion({
      prepare: () => { throw new Error("shadow must not touch storage"); },
    }, create())).rejects.toMatchObject({ code: "owned_note_shadow_only", status: 503 });
  });

  it("creates, revises, archives, restores, and exactly replays immutable versions", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);

    const created = await captureOwnedNoteVersion(db, create(), "2026-09-01T17:10:00.000Z", active);
    expect(created).toMatchObject({
      contactId: "contact-1",
      appointmentId: "appointment-1",
      actor: "Garrett",
      action: "create",
      revision: 1,
      priorRevision: 0,
      state: "active",
      deduped: false,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      authorityPromoted: false,
    });
    const replay = await captureOwnedNoteVersion(db, create(), "2026-09-01T17:11:00.000Z", active);
    expect(replay).toMatchObject({ versionId: created.versionId, noteId: created.noteId, revision: 1, deduped: true });

    const revised = await captureOwnedNoteVersion(db, {
      action: "revise",
      contactId: "contact-1",
      appointmentId: "appointment-1",
      noteId: created.noteId,
      expectedRevision: 1,
      actor: "Eben",
      idempotencyKey: "owned-note-command-0002",
      body: "Client reported easier shoulder rotation after the session.",
    }, "2026-09-01T17:12:00.000Z", active);
    expect(revised).toMatchObject({ action: "revise", revision: 2, priorRevision: 1, state: "active" });

    const archived = await captureOwnedNoteVersion(db, {
      action: "archive",
      contactId: "contact-1",
      appointmentId: "appointment-1",
      noteId: created.noteId,
      expectedRevision: 2,
      actor: "Eben",
      idempotencyKey: "owned-note-command-0003",
    }, "2026-09-01T17:13:00.000Z", active);
    expect(archived).toMatchObject({ action: "archive", revision: 3, state: "archived", body: revised.body });
    await expect(readOwnedNotes(db, { contactId: "contact-1" })).resolves.toMatchObject({
      state: "ready",
      notes: [],
    });

    const restored = await captureOwnedNoteVersion(db, {
      action: "restore",
      contactId: "contact-1",
      appointmentId: "appointment-1",
      noteId: created.noteId,
      expectedRevision: 3,
      actor: "Garrett",
      idempotencyKey: "owned-note-command-0004",
    }, "2026-09-01T17:14:00.000Z", active);
    expect(restored).toMatchObject({ action: "restore", revision: 4, state: "active", body: revised.body });
    const current = await readOwnedNotes(db, { contactId: "contact-1" });
    expect(current).toMatchObject({
      state: "ready",
      readOnly: true,
      notes: [{
        note_id: created.noteId,
        contact_id: "contact-1",
        appointment_id: "appointment-1",
        authored_by: "Eben",
        recorded_by: "Garrett",
        revision: 4,
        body: revised.body,
        state: "active",
        authority: "owned",
        created_at: "2026-09-01T17:10:00.000Z",
        updated_at: "2026-09-01T17:14:00.000Z",
      }],
    });

    const archiveReplay = await captureOwnedNoteVersion(db, {
      action: "archive",
      contactId: "contact-1",
      appointmentId: "appointment-1",
      noteId: created.noteId,
      expectedRevision: 2,
      actor: "Eben",
      idempotencyKey: "owned-note-command-0003",
    }, "2026-09-01T17:20:00.000Z", active);
    expect(archiveReplay).toMatchObject({ versionId: archived.versionId, revision: 3, state: "archived", deduped: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_note_versions").get()).toEqual({ count: 4 });
    expect(() => sqlite.exec("UPDATE owned_note_versions SET body_clean = 'changed'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM owned_note_versions")).toThrow(/append-only/i);
    sqlite.close();
  });

  it("joins current owned notes with provider-mirror notes in the authenticated CRM read model", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    sqlite.prepare(
      `INSERT INTO client_notes
       (id, contact_id, provider_note_id, body, authored_by, created_at, updated_at)
       VALUES ('provider-note-1', 'contact-1', 'ghl-note-1', 'Imported provider note',
               'Legacy Staff', '2026-09-01T17:00:00.000Z', '2026-09-01T17:00:00.000Z')`,
    ).run();
    const db = d1(sqlite);
    const owned = await captureOwnedNoteVersion(db, create(), "2026-09-01T17:10:00.000Z", active);

    const response = await worker.fetch(new Request("https://crm.test/contacts/contact-1", {
      headers: { Authorization: "Bearer test-secret" },
    }), { CRM_DB: db, WORKER_AUTH_SECRET: "test-secret" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ownedNoteAuthority).toMatchObject({
      version: "owned-note-authority.v1",
      state: "ready",
      readOnly: true,
    });
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0]).toMatchObject({
      note_id: owned.noteId,
      body: owned.body,
      authored_by: "Garrett",
      recorded_by: "Garrett",
      authority: "owned",
    });
    expect(body.notes[1]).toMatchObject({ body: "Imported provider note", authored_by: "Legacy Staff" });
    expect(body.activityTimeline.filter((item) => item.activity_type === "note")).toEqual([
      expect.objectContaining({ body: owned.body, status: "owned", detail: "Garrett" }),
      expect.objectContaining({ body: "Imported provider note", detail: "Legacy Staff" }),
    ]);
    sqlite.close();
  });

  it("fails closed on key reuse, stale revision, archived contact, and cross-contact appointment identity", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);
    const created = await captureOwnedNoteVersion(db, create(), "2026-09-01T17:10:00.000Z", active);
    await expect(captureOwnedNoteVersion(db, create({ body: "Different content" }), "2026-09-01T17:11:00.000Z", active))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(captureOwnedNoteVersion(db, {
      action: "revise",
      contactId: "contact-1",
      appointmentId: "appointment-1",
      noteId: created.noteId,
      expectedRevision: 2,
      actor: "Garrett",
      idempotencyKey: "owned-note-command-stale",
      body: "Stale edit",
    }, "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "note_revision_conflict" });

    insertContact(sqlite, "contact-archived", "2026-09-01T16:00:00.000Z");
    await expect(captureOwnedNoteVersion(db, create({
      contactId: "contact-archived",
      appointmentId: null,
      idempotencyKey: "owned-note-command-archived",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "contact_unavailable" });

    insertContact(sqlite, "contact-2");
    await expect(captureOwnedNoteVersion(db, create({
      contactId: "contact-2",
      idempotencyKey: "owned-note-command-mismatch",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "appointment_contact_mismatch" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_note_versions").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("enforces revision and contact identity inside the database statement", () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    sqlite.prepare(
      `INSERT INTO owned_note_versions (
         id, note_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, body_clean, body_sha256, command_sha256, state, recorded_at
       ) VALUES ('v1', 'note-1', 'contact-1', 'Garrett', 'raw-note-create', 'create',
                 1, 0, 'Original', ?, ?, 'active', '2026-09-01T17:00:00.000Z')`,
    ).run("a".repeat(64), "b".repeat(64));
    expect(() => sqlite.prepare(
      `INSERT INTO owned_note_versions (
         id, note_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, body_clean, body_sha256, command_sha256, state, recorded_at
       ) VALUES ('v3', 'note-1', 'contact-1', 'Garrett', 'raw-note-stale', 'revise',
                 3, 2, 'Skipped revision', ?, ?, 'active', '2026-09-01T17:01:00.000Z')`,
    ).run("c".repeat(64), "d".repeat(64))).toThrow(/revision conflict/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_note_versions").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("degrades read-only before schema installation and produces no provider, message, payment, or appointment effect", async () => {
    await expect(readOwnedNotes({
      prepare: () => ({ bind() { return this; }, all: async () => { throw new Error("no such table: owned_note_versions"); } }),
    }, { contactId: "contact-1" })).resolves.toEqual({
      version: "owned-note-authority.v1",
      state: "unavailable",
      reason: "schema_unavailable",
      readOnly: true,
      notes: [],
    });

    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    await captureOwnedNoteVersion(d1(sqlite), create(), "2026-09-01T17:10:00.000Z", active);
    for (const table of [
      "client_notes",
      "client_tasks",
      "owned_communication_commands",
      "outbound_delivery_attempts",
      "appointment_payment_records",
      "appointment_payment_events",
      "session_ledger_entries",
      "purchases",
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(sqlite.prepare(
      "SELECT status, revision, authority, provider_sync_state FROM appointments WHERE id = 'appointment-1'",
    ).get()).toEqual({ status: "confirmed", revision: 1, authority: "owned", provider_sync_state: "not_required" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
