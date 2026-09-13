import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import worker from "./index.js";
import {
  captureOwnedTaskVersion,
  OWNED_TASK_SOURCE_MODE,
  ownedTaskReleaseReadiness,
  readOwnedTasks,
} from "./owned-tasks.js";

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
               '2026-09-03T17:00:00.000Z', '2026-09-03T18:00:00.000Z',
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
  idempotencyKey: "owned-task-command-0001",
  title: "Confirm the client's next practice plan",
  dueAt: "2026-09-02T10:00:00-07:00",
  assignedTo: "Eben",
  ...overrides,
});

function transition(action, taskId, expectedRevision, idempotencyKey, overrides = {}) {
  return {
    action,
    contactId: "contact-1",
    appointmentId: "appointment-1",
    taskId,
    expectedRevision,
    actor: "Garrett",
    idempotencyKey,
    ...overrides,
  };
}

describe("owned task authority", () => {
  it("is source-pinned active and exposes no provider or destructive fallback", async () => {
    expect(OWNED_TASK_SOURCE_MODE).toBe("active");
    expect(ownedTaskReleaseReadiness()).toEqual({
      version: "owned-task-authority.v2",
      sourceMode: "active",
      enabled: true,
      providerFallback: null,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      destructiveDeleteExposed: false,
      authorityPromotion: false,
    });
    await expect(captureOwnedTaskVersion({
      prepare: () => { throw new Error("shadow must not touch storage"); },
    }, create(), undefined, { sourceMode: "shadow" })).rejects.toMatchObject({ code: "owned_task_shadow_only", status: 503 });
  });

  it("creates, revises, completes, archives, restores, reopens, and exactly replays immutable versions", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);

    const created = await captureOwnedTaskVersion(db, create(), "2026-09-01T17:10:00.000Z", active);
    expect(created).toMatchObject({
      contactId: "contact-1",
      appointmentId: "appointment-1",
      actor: "Garrett",
      action: "create",
      revision: 1,
      priorRevision: 0,
      dueAt: "2026-09-02T17:00:00.000Z",
      assignedTo: "Eben",
      state: "open",
      completedAt: null,
      deduped: false,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      destructiveDeleteExposed: false,
      authorityPromoted: false,
    });
    const replay = await captureOwnedTaskVersion(db, create(), "2026-09-01T17:11:00.000Z", active);
    expect(replay).toMatchObject({ versionId: created.versionId, taskId: created.taskId, revision: 1, deduped: true });

    const revised = await captureOwnedTaskVersion(db, transition(
      "revise", created.taskId, 1, "owned-task-command-0002", {
        actor: "Eben",
        title: "Confirm the client's updated practice plan",
        dueAt: "2026-09-02T11:00:00-07:00",
        assignedTo: "Garrett",
      },
    ), "2026-09-01T17:12:00.000Z", active);
    expect(revised).toMatchObject({ action: "revise", revision: 2, state: "open", dueAt: "2026-09-02T18:00:00.000Z", assignedTo: "Garrett" });

    const completed = await captureOwnedTaskVersion(db, transition(
      "complete", created.taskId, 2, "owned-task-command-0003",
    ), "2026-09-01T17:13:00.000Z", active);
    expect(completed).toMatchObject({
      action: "complete", revision: 3, state: "completed",
      title: revised.title, dueAt: revised.dueAt, completedAt: "2026-09-01T17:13:00.000Z",
      assignedTo: "Garrett",
    });

    const archivedCompleted = await captureOwnedTaskVersion(db, transition(
      "archive", created.taskId, 3, "owned-task-command-0004",
    ), "2026-09-01T17:14:00.000Z", active);
    expect(archivedCompleted).toMatchObject({
      action: "archive", revision: 4, state: "archived", archivedFromState: "completed",
      completedAt: completed.completedAt,
    });
    await expect(readOwnedTasks(db, { contactId: "contact-1" })).resolves.toMatchObject({ state: "ready", tasks: [] });

    const restoredCompleted = await captureOwnedTaskVersion(db, transition(
      "restore", created.taskId, 4, "owned-task-command-0005",
    ), "2026-09-01T17:15:00.000Z", active);
    expect(restoredCompleted).toMatchObject({
      action: "restore", revision: 5, state: "completed", archivedFromState: null,
      completedAt: completed.completedAt,
    });

    const reopened = await captureOwnedTaskVersion(db, transition(
      "reopen", created.taskId, 5, "owned-task-command-0006",
    ), "2026-09-01T17:16:00.000Z", active);
    expect(reopened).toMatchObject({ action: "reopen", revision: 6, state: "open", completedAt: null });

    const archivedOpen = await captureOwnedTaskVersion(db, transition(
      "archive", created.taskId, 6, "owned-task-command-0007",
    ), "2026-09-01T17:17:00.000Z", active);
    expect(archivedOpen).toMatchObject({ state: "archived", archivedFromState: "open", completedAt: null });
    const restoredOpen = await captureOwnedTaskVersion(db, transition(
      "restore", created.taskId, 7, "owned-task-command-0008",
    ), "2026-09-01T17:18:00.000Z", active);
    expect(restoredOpen).toMatchObject({ state: "open", archivedFromState: null, completedAt: null });

    const current = await readOwnedTasks(db, { contactId: "contact-1" });
    expect(current).toMatchObject({
      state: "ready",
      readOnly: true,
      tasks: [{
        task_id: created.taskId,
        contact_id: "contact-1",
        appointment_id: "appointment-1",
        defined_by: "Eben",
        recorded_by: "Garrett",
        revision: 8,
        title: revised.title,
        due_at: revised.dueAt,
        assigned_to: "Garrett",
        completed_at: null,
        status: "open",
        state: "open",
        authority: "owned",
        created_at: "2026-09-01T17:10:00.000Z",
        updated_at: "2026-09-01T17:18:00.000Z",
      }],
    });

    const archiveReplay = await captureOwnedTaskVersion(db, transition(
      "archive", created.taskId, 3, "owned-task-command-0004",
    ), "2026-09-01T17:20:00.000Z", active);
    expect(archiveReplay).toMatchObject({
      versionId: archivedCompleted.versionId, revision: 4, state: "archived", deduped: true,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_task_versions").get()).toEqual({ count: 8 });
    expect(() => sqlite.exec("UPDATE owned_task_versions SET title_clean = 'changed'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM owned_task_versions")).toThrow(/append-only/i);
    sqlite.close();
  });

  it("reconciles overlapping identical creates and transitions without duplicate versions", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);
    const created = await Promise.all([captureOwnedTaskVersion(db, create()), captureOwnedTaskVersion(db, create())]);
    expect(created[0].taskId).toBe(created[1].taskId);
    expect(created.filter((row) => row.deduped)).toHaveLength(1);
    const command = transition("complete", created[0].taskId, 1, "concurrent-complete-0001");
    const completed = await Promise.all([captureOwnedTaskVersion(db, command), captureOwnedTaskVersion(db, command)]);
    expect(completed.every((row) => row.revision === 2)).toBe(true);
    expect(completed.filter((row) => row.deduped)).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM owned_task_versions").get().n).toBe(2);
    sqlite.close();
  });

  it("accepts the four reviewed HTTP commands with authenticated actor and exact replay", async () => {
    const sqlite = database();
    insertContact(sqlite);
    const values = new Map();
    const env = { CRM_DB: d1(sqlite), WORKER_AUTH_SECRET: "test-secret", PORTAL_KV: {
      get: async (key) => values.get(key) || null,
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    } };
    const access = await worker.fetch(new Request("https://crm.test/dashboard-access-link?view=client-desk", {
      method: "POST", headers: { Authorization: "Bearer test-secret", "X-Staff-Actor": "Eben" },
    }), env);
    const handoff = await worker.fetch(new Request((await access.json()).url), env);
    const cookie = handoff.headers.get("Set-Cookie");
    const send = (body) => worker.fetch(new Request("https://crm.test/tasks/commands", {
      method: "POST", headers: { Cookie: cookie, Origin: "https://crm.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), env);
    const command = { action: "create", contactId: "contact-1", title: "Review assessment", dueAt: null, assignedTo: "Garrett", idempotencyKey: "route-create-00001" };
    const response = await send(command);
    expect(response.status).toBe(201);
    const task = (await response.json()).task;
    expect(task).toMatchObject({ actor: "Eben", contactId: "contact-1", revision: 1, dueAt: null, assignedTo: "Garrett" });
    expect((await send(command)).status).toBe(200);
    const revised = await send({ action: "revise", contactId: "contact-1", taskId: task.taskId, expectedRevision: 1, title: "Review updated assessment", dueAt: "2026-09-04T09:30:00-07:00", assignedTo: "Eben", idempotencyKey: "route-revise-00001" });
    expect(revised.status).toBe(201);
    await expect(revised.json()).resolves.toMatchObject({ task: { revision: 2, assignedTo: "Eben", dueAt: "2026-09-04T16:30:00.000Z" } });
    for (const [action, revision] of [["complete", 2], ["reopen", 3]]) {
      const changed = await send({ action, contactId: "contact-1", taskId: task.taskId, expectedRevision: revision, idempotencyKey: "route-" + action + "-00001" });
      expect(changed.status).toBe(201);
      expect((await changed.json()).task.revision).toBe(revision + 1);
    }
    for (const action of ["archive", "restore"]) expect((await send({ ...command, action })).status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM owned_task_versions").get().n).toBe(4);
    sqlite.close();
  });

  it("joins current owned tasks with provider-mirror tasks in the authenticated CRM read model", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    sqlite.prepare(
      `INSERT INTO client_tasks
       (id, contact_id, provider_task_id, title, due_at, completed_at, status, created_at, updated_at)
       VALUES ('provider-task-1', 'contact-1', 'ghl-task-1', 'Imported provider task',
               '2026-09-04T17:00:00.000Z', NULL, 'open',
               '2026-09-01T17:00:00.000Z', '2026-09-01T17:00:00.000Z')`,
    ).run();
    const db = d1(sqlite);
    const owned = await captureOwnedTaskVersion(db, create(), "2026-09-01T17:10:00.000Z", active);

    const response = await worker.fetch(new Request("https://crm.test/contacts/contact-1", {
      headers: { Authorization: "Bearer test-secret" },
    }), { CRM_DB: db, WORKER_AUTH_SECRET: "test-secret" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ownedTaskAuthority).toMatchObject({
      version: "owned-task-authority.v2",
      state: "ready",
      readOnly: true,
    });
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0]).toMatchObject({
      task_id: owned.taskId,
      title: owned.title,
      status: "open",
      authority: "owned",
    });
    expect(body.tasks[1]).toMatchObject({ title: "Imported provider task", status: "open" });
    expect(body.activityTimeline.filter((item) => item.activity_type === "task")).toEqual([
      expect.objectContaining({ subject: owned.title, status: "open", detail: owned.dueAt }),
      expect.objectContaining({ subject: "Imported provider task", status: "open" }),
    ]);
    sqlite.close();
  });

  it("fails closed on key reuse, ambiguous due time, stale revision, archived contact, and cross-contact appointment identity", async () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    const db = d1(sqlite);
    const created = await captureOwnedTaskVersion(db, create(), "2026-09-01T17:10:00.000Z", active);
    await expect(captureOwnedTaskVersion(db, create({ title: "Different task" }), "2026-09-01T17:11:00.000Z", active))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(captureOwnedTaskVersion(db, create({
      idempotencyKey: "owned-task-command-bad-due",
      dueAt: "2026-09-02",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "invalid_task_due_at" });
    await expect(captureOwnedTaskVersion(db, create({
      idempotencyKey: "owned-task-command-bad-assignee",
      assignedTo: "Someone else",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "invalid_task_assignee" });
    await expect(captureOwnedTaskVersion(db, transition(
      "complete", created.taskId, 2, "owned-task-command-stale",
    ), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "task_revision_conflict" });

    insertContact(sqlite, "contact-archived", "2026-09-01T16:00:00.000Z");
    await expect(captureOwnedTaskVersion(db, create({
      contactId: "contact-archived",
      appointmentId: null,
      idempotencyKey: "owned-task-command-archived",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "contact_unavailable" });

    insertContact(sqlite, "contact-2");
    await expect(captureOwnedTaskVersion(db, create({
      contactId: "contact-2",
      idempotencyKey: "owned-task-command-mismatch",
    }), "2026-09-01T17:11:00.000Z", active)).rejects.toMatchObject({ code: "appointment_contact_mismatch" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_task_versions").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("enforces revision and contact identity inside the database statement", () => {
    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    sqlite.prepare(
      `INSERT INTO owned_task_versions (
         id, task_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, title_clean, title_sha256, due_at, state,
         archived_from_state, completed_at, command_sha256, recorded_at
       ) VALUES ('v1', 'task-1', 'contact-1', 'Garrett', 'raw-task-create', 'create',
                 1, 0, 'Original', ?, NULL, 'open', NULL, NULL, ?, '2026-09-01T17:00:00.000Z')`,
    ).run("a".repeat(64), "b".repeat(64));
    expect(() => sqlite.prepare(
      `INSERT INTO owned_task_versions (
         id, task_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, title_clean, title_sha256, due_at, state,
         archived_from_state, completed_at, command_sha256, recorded_at
       ) VALUES ('v3', 'task-1', 'contact-1', 'Garrett', 'raw-task-stale', 'revise',
                 3, 2, 'Skipped revision', ?, NULL, 'open', NULL, NULL, ?, '2026-09-01T17:01:00.000Z')`,
    ).run("c".repeat(64), "d".repeat(64))).toThrow(/revision conflict/i);
    expect(() => sqlite.prepare(
      `INSERT INTO owned_task_versions (
         id, task_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, title_clean, title_sha256, due_at, state,
         archived_from_state, completed_at, command_sha256, recorded_at
       ) VALUES ('v2', 'task-1', 'contact-1', 'Eben', 'raw-task-drift', 'complete',
                 2, 1, 'Changed while completing', ?, NULL, 'completed', NULL,
                 '2026-09-01T17:02:00.000Z', ?, '2026-09-01T17:02:00.000Z')`,
    ).run("e".repeat(64), "f".repeat(64))).toThrow(/completion conflict/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_task_versions").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("adds assignment without rewriting existing task history and preserves legacy replay", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const entries = readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const name of entries.filter((name) => name < "0032_")) {
      sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    insertContact(sqlite);
    const legacyKey = "legacy-task-command-0001";
    const legacyCommand = [
      "owned-task-authority.v1", "Eben", legacyKey, "create", "contact-1", "", "", "0",
      "Legacy task", "",
    ].join("\n");
    const legacyDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(legacyCommand))),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    sqlite.prepare(
      `INSERT INTO owned_task_versions (
         id, task_id, contact_id, actor, idempotency_key, action, revision,
         prior_revision, title_clean, title_sha256, due_at, state,
         archived_from_state, completed_at, command_sha256, recorded_at
       ) VALUES ('legacy-v1', 'legacy-task', 'contact-1', 'Eben', ?, 'create',
                 1, 0, 'Legacy task', ?, NULL, 'open', NULL, NULL, ?, '2026-09-01T17:00:00.000Z')`,
    ).run(legacyKey, "a".repeat(64), legacyDigest);
    sqlite.exec(readFileSync(new URL("../migrations/0032_owned_task_assignment.sql", import.meta.url), "utf8"));

    expect(sqlite.prepare("SELECT assigned_to FROM owned_task_versions WHERE task_id = 'legacy-task'").get())
      .toEqual({ assigned_to: null });
    const replay = await captureOwnedTaskVersion(d1(sqlite), {
      action: "create", contactId: "contact-1", actor: "Eben", idempotencyKey: legacyKey,
      title: "Legacy task", dueAt: null,
    }, "2026-09-01T18:00:00.000Z", active);
    expect(replay).toMatchObject({ taskId: "legacy-task", assignedTo: null, deduped: true });

    const revised = await captureOwnedTaskVersion(d1(sqlite), {
      action: "revise", contactId: "contact-1", taskId: "legacy-task", expectedRevision: 1,
      actor: "Garrett", idempotencyKey: "legacy-task-revise-0001", title: "Assigned legacy task",
      dueAt: "2026-09-04T09:30:00-07:00", assignedTo: "Garrett",
    }, "2026-09-01T18:01:00.000Z", active);
    expect(revised).toMatchObject({ revision: 2, assignedTo: "Garrett" });
    const revisedTitleHash = sqlite.prepare("SELECT title_sha256 FROM owned_task_versions WHERE task_id = 'legacy-task' AND revision = 2").get().title_sha256;
    expect(() => sqlite.prepare(
      `INSERT INTO owned_task_versions (
         id, task_id, contact_id, actor, idempotency_key, action, revision, prior_revision,
         title_clean, title_sha256, due_at, state, completed_at, command_sha256, recorded_at, assigned_to
       ) VALUES ('bad-assignment-v3', 'legacy-task', 'contact-1', 'Eben', 'bad-assignment-state-key',
                 'complete', 3, 2, 'Assigned legacy task', ?, '2026-09-04T16:30:00.000Z', 'completed',
                 '2026-09-01T18:02:00.000Z', ?, '2026-09-01T18:02:00.000Z', 'Eben')`,
    ).run(revisedTitleHash, "d".repeat(64))).toThrow(/assignment conflict/i);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });

  it("degrades read-only before schema installation and produces no provider, message, payment, appointment, or ledger effect", async () => {
    await expect(readOwnedTasks({
      prepare: () => ({ bind() { return this; }, all: async () => { throw new Error("no such table: owned_task_versions"); } }),
    }, { contactId: "contact-1" })).resolves.toEqual({
      version: "owned-task-authority.v2",
      state: "unavailable",
      reason: "schema_unavailable",
      readOnly: true,
      tasks: [],
    });

    const sqlite = database();
    insertContact(sqlite);
    insertAppointment(sqlite);
    await captureOwnedTaskVersion(d1(sqlite), create(), "2026-09-01T17:10:00.000Z", active);
    for (const table of [
      "client_notes",
      "client_tasks",
      "owned_note_versions",
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
