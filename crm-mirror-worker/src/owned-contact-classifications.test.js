import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import worker from "./index.js";
import {
  captureOwnedContactClassification,
  OWNED_CLASSIFICATION_SOURCE_MODE,
  ownedContactClassificationReleaseReadiness,
} from "./owned-contact-classifications.js";

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

const active = { sourceMode: "active" };
const command = (action, value, key, overrides = {}) => ({
  action,
  value,
  contactId: "contact-1",
  actor: "Garrett",
  idempotencyKey: key,
  ...overrides,
});

describe("owned contact classifications", () => {
  it("is source-pinned shadow and exposes no provider or destructive evidence fallback", async () => {
    expect(OWNED_CLASSIFICATION_SOURCE_MODE).toBe("shadow");
    expect(ownedContactClassificationReleaseReadiness()).toEqual({
      version: "owned-contact-classifications.v1",
      sourceMode: "shadow",
      enabled: false,
      providerFallback: null,
      providerWrite: false,
      messageWrite: false,
      paymentWrite: false,
      appointmentWrite: false,
      destructiveEvidenceDelete: false,
      authorityPromotion: false,
    });
    await expect(captureOwnedContactClassification({
      prepare: () => { throw new Error("shadow must not touch storage"); },
    }, command("add_tag", "follow-up", "classification-command-0001")))
      .rejects.toMatchObject({ code: "owned_classification_shadow_only", status: 503 });
  });

  it("materializes reversible tags and roles while exact old replay cannot overwrite later state", async () => {
    const sqlite = database();
    insertContact(sqlite);
    const db = d1(sqlite);

    const added = await captureOwnedContactClassification(db,
      command("add_tag", "Follow Up", "classification-command-0001"),
      "2026-09-01T17:00:00.000Z", active);
    expect(added).toMatchObject({
      action: "add_tag", value: "follow-up", resultState: "applied", source: "owned:staff",
      deduped: false, providerWrite: false, messageWrite: false, paymentWrite: false,
      appointmentWrite: false, destructiveEvidenceDelete: false, authorityPromoted: false,
    });
    const replay = await captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-0001"),
      "2026-09-01T17:01:00.000Z", active);
    expect(replay).toMatchObject({ commandId: added.commandId, resultState: "applied", deduped: true });

    const duplicateAdd = await captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-0002"),
      "2026-09-01T17:02:00.000Z", active);
    expect(duplicateAdd).toMatchObject({ resultState: "already_effective", deduped: false });

    const removed = await captureOwnedContactClassification(db,
      command("remove_tag", "follow-up", "classification-command-0003"),
      "2026-09-01T17:03:00.000Z", active);
    expect(removed).toMatchObject({ resultState: "applied" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM contact_tags WHERE source = 'owned:staff'").get()).toEqual({ count: 0 });

    await captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-0004"),
      "2026-09-01T17:04:00.000Z", active);
    const oldRemoveReplay = await captureOwnedContactClassification(db,
      command("remove_tag", "follow-up", "classification-command-0003"),
      "2026-09-01T17:05:00.000Z", active);
    expect(oldRemoveReplay).toMatchObject({ commandId: removed.commandId, deduped: true });
    expect(sqlite.prepare("SELECT tag, source FROM contact_tags").all()).toEqual([
      { tag: "follow-up", source: "owned:staff" },
    ]);

    const granted = await captureOwnedContactClassification(db,
      command("grant_role", "client", "classification-command-0005"),
      "2026-09-01T17:06:00.000Z", active);
    expect(granted).toMatchObject({ resultState: "applied" });
    const revoked = await captureOwnedContactClassification(db,
      command("revoke_role", "client", "classification-command-0006"),
      "2026-09-01T17:07:00.000Z", active);
    expect(revoked).toMatchObject({ resultState: "applied" });
    const absent = await captureOwnedContactClassification(db,
      command("revoke_role", "client", "classification-command-0007"),
      "2026-09-01T17:08:00.000Z", active);
    expect(absent).toMatchObject({ resultState: "already_absent" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM contact_roles WHERE source = 'owned:staff'").get()).toEqual({ count: 0 });

    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_contact_classification_commands").get()).toEqual({ count: 7 });
    expect(() => sqlite.exec("UPDATE owned_contact_classification_commands SET value_clean = 'changed'"))
      .toThrow(/append-only/i);
    expect(() => sqlite.exec("DELETE FROM owned_contact_classification_commands")).toThrow(/append-only/i);
    sqlite.close();
  });

  it("joins owned and provider classifications without duplicate labels in the authenticated read model", async () => {
    const sqlite = database();
    insertContact(sqlite);
    sqlite.prepare(
      "INSERT INTO contact_tags (contact_id, tag, source, created_at) VALUES ('contact-1', 'focus', 'ghl', '2026-09-01T16:00:00.000Z')",
    ).run();
    sqlite.prepare(
      "INSERT INTO contact_roles (contact_id, role, source, created_at) VALUES ('contact-1', 'lead', 'ghl', '2026-09-01T16:00:00.000Z')",
    ).run();
    const db = d1(sqlite);
    await captureOwnedContactClassification(db,
      command("add_tag", "focus", "classification-command-read-1"),
      "2026-09-01T17:00:00.000Z", active);
    await captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-read-2"),
      "2026-09-01T17:01:00.000Z", active);
    await captureOwnedContactClassification(db,
      command("grant_role", "lead", "classification-command-read-3"),
      "2026-09-01T17:02:00.000Z", active);
    await captureOwnedContactClassification(db,
      command("grant_role", "client", "classification-command-read-4"),
      "2026-09-01T17:03:00.000Z", active);

    const response = await worker.fetch(new Request("https://crm.test/contacts/contact-1", {
      headers: { Authorization: "Bearer test-secret" },
    }), { CRM_DB: db, WORKER_AUTH_SECRET: "test-secret" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tags).toEqual(["focus", "follow-up"]);
    expect(body.roles).toEqual(["client", "lead"]);
    expect(sqlite.prepare(
      "SELECT tag, source FROM contact_tags WHERE contact_id = 'contact-1' ORDER BY source, tag",
    ).all()).toEqual([
      { tag: "focus", source: "ghl" },
      { tag: "focus", source: "owned:staff" },
      { tag: "follow-up", source: "owned:staff" },
    ]);

    await captureOwnedContactClassification(db,
      command("remove_tag", "focus", "classification-command-read-5"),
      "2026-09-01T17:04:00.000Z", active);
    await captureOwnedContactClassification(db,
      command("revoke_role", "lead", "classification-command-read-6"),
      "2026-09-01T17:05:00.000Z", active);
    expect(sqlite.prepare(
      "SELECT tag, source FROM contact_tags WHERE contact_id = 'contact-1' ORDER BY source, tag",
    ).all()).toEqual([
      { tag: "focus", source: "ghl" },
      { tag: "follow-up", source: "owned:staff" },
    ]);
    expect(sqlite.prepare(
      "SELECT role, source FROM contact_roles WHERE contact_id = 'contact-1' ORDER BY source, role",
    ).all()).toEqual([
      { role: "lead", source: "ghl" },
      { role: "client", source: "owned:staff" },
    ]);
    const isolated = await worker.fetch(new Request("https://crm.test/contacts/contact-1", {
      headers: { Authorization: "Bearer test-secret" },
    }), { CRM_DB: db, WORKER_AUTH_SECRET: "test-secret" });
    const isolatedBody = await isolated.json();
    expect(isolatedBody.tags).toEqual(["focus", "follow-up"]);
    expect(isolatedBody.roles).toEqual(["client", "lead"]);
    sqlite.close();
  });

  it("fails closed on key drift, invalid classification values, and archived contacts", async () => {
    const sqlite = database();
    insertContact(sqlite);
    const db = d1(sqlite);
    await captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-fail-1"),
      "2026-09-01T17:00:00.000Z", active);
    await expect(captureOwnedContactClassification(db,
      command("add_tag", "different", "classification-command-fail-1"),
      "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(captureOwnedContactClassification(db,
      command("add_tag", "not/valid", "classification-command-fail-2"),
      "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "invalid_tag" });
    await expect(captureOwnedContactClassification(db,
      command("grant_role", "owner", "classification-command-fail-3"),
      "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "invalid_role" });

    insertContact(sqlite, "contact-archived", "2026-09-01T16:00:00.000Z");
    await expect(captureOwnedContactClassification(db,
      command("add_tag", "follow-up", "classification-command-fail-4", { contactId: "contact-archived" }),
      "2026-09-01T17:01:00.000Z", active)).rejects.toMatchObject({ code: "contact_unavailable" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_contact_classification_commands").get()).toEqual({ count: 1 });
    sqlite.close();
  });

  it("rejects direct result-state forgery inside the database", () => {
    const sqlite = database();
    insertContact(sqlite);
    expect(() => sqlite.prepare(
      `INSERT INTO owned_contact_classification_commands
       (id, contact_id, actor, idempotency_key, action, value_clean, command_sha256,
        capture_nonce, result_state, recorded_at)
       VALUES ('raw-1', 'contact-1', 'Garrett', 'raw-classification-1', 'add_tag',
               'follow-up', ?, ?, 'already_effective', '2026-09-01T17:00:00.000Z')`,
    ).run("a".repeat(64), "b".repeat(32))).toThrow(/result mismatch/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM owned_contact_classification_commands").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM contact_tags WHERE source = 'owned:staff'").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  it("changes only owned materialized classifications and immutable command evidence", async () => {
    const sqlite = database();
    insertContact(sqlite);
    const before = sqlite.prepare("SELECT * FROM contacts WHERE id = 'contact-1'").get();
    await captureOwnedContactClassification(d1(sqlite),
      command("grant_role", "client", "classification-command-zero-effect"),
      "2026-09-01T17:00:00.000Z", active);
    expect(sqlite.prepare("SELECT * FROM contacts WHERE id = 'contact-1'").get()).toEqual(before);
    expect(sqlite.prepare("SELECT role, source FROM contact_roles").all()).toEqual([
      { role: "client", source: "owned:staff" },
    ]);
    for (const table of [
      "external_records",
      "client_notes",
      "client_tasks",
      "owned_note_versions",
      "owned_task_versions",
      "owned_communication_commands",
      "outbound_delivery_attempts",
      "appointment_payment_records",
      "appointment_payment_events",
      "session_ledger_entries",
      "purchases",
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
  });
});
