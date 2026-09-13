import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BYTES,
  ARTIFACT_SHA256,
  assessCrmTaskAssignmentSchemaSnapshot,
  createCrmTaskAssignmentSchemaArtifact,
  crmTaskAssignmentSchemaReadbackQueries,
  verifyCrmTaskAssignmentSchemaTransition,
} from "../../scripts/crm-task-assignment-schema-install-plan.mjs";
import { CRM_DATABASE } from "../../scripts/crm-schema-install-plan.mjs";

function base() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0032_").sort()) {
    db.exec(readFileSync(new URL(name, directory), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
  }
  db.prepare("INSERT INTO contacts (id, display_name, created_at, updated_at) VALUES ('contact-1', 'Example', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')").run();
  db.prepare(`INSERT INTO owned_task_versions
    (id, task_id, contact_id, actor, idempotency_key, action, revision, prior_revision,
     title_clean, title_sha256, due_at, state, command_sha256, recorded_at)
    VALUES ('v1', 'task-1', 'contact-1', 'Eben', 'schema-test-key', 'create', 1, 0,
            'Existing task', ?, NULL, 'open', ?, '2026-09-01T00:00:00Z')`).run("a".repeat(64), "b".repeat(64));
  return db;
}

function snapshot(db) {
  const one = (sql) => db.prepare(sql).get();
  const schema = (name) => one("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name = '" + name + "'") || null;
  const taskColumns = db.prepare("PRAGMA table_info('owned_task_versions')").all();
  const hasAssignment = taskColumns.some((row) => row.name === "assigned_to");
  return {
    databaseId: CRM_DATABASE.id,
    databaseName: CRM_DATABASE.name,
    environment: "production",
    servedByPrimary: true,
    readReplicationEnabled: false,
    integrity: one("PRAGMA integrity_check").integrity_check,
    foreignKeyViolationCount: db.prepare("PRAGMA foreign_key_check").all().length,
    migrations: db.prepare("SELECT id, name, applied_at FROM d1_migrations ORDER BY id").all(),
    taskColumns,
    taskTable: schema("owned_task_versions"),
    assignmentIndex: schema("idx_owned_task_versions_assignment"),
    assignmentTrigger: schema("owned_task_version_state_change_preserves_assignment"),
    taskCounts: {
      versionCount: one("SELECT COUNT(*) AS n FROM owned_task_versions").n,
      taskCount: one("SELECT COUNT(DISTINCT task_id) AS n FROM owned_task_versions").n,
      assignedVersionCount: hasAssignment ? db.prepare("SELECT COUNT(*) AS n FROM owned_task_versions WHERE assigned_to IS NOT NULL").get()?.n || 0 : 0,
    },
  };
}

describe("task assignment schema install plan", () => {
  it("pins one exact source-only artifact and bounded readback", () => {
    const artifact = createCrmTaskAssignmentSchemaArtifact();
    expect(artifact).toMatchObject({ bytes: ARTIFACT_BYTES, sha256: ARTIFACT_SHA256, migrationCount: 1, executionAuthorized: false });
    expect(crmTaskAssignmentSchemaReadbackQueries()).toHaveLength(8);
    expect(crmTaskAssignmentSchemaReadbackQueries().every((query) => /^(SELECT|PRAGMA)/.test(query.sql))).toBe(true);
  });

  it("proves the additive transition preserves existing task history as unassigned", () => {
    const db = base();
    const before = snapshot(db);
    expect(assessCrmTaskAssignmentSchemaSnapshot(before).classification).toBe("exact_v31_base");
    db.exec(createCrmTaskAssignmentSchemaArtifact().sql);
    const after = snapshot(db);
    expect(assessCrmTaskAssignmentSchemaSnapshot(after).classification).toBe("exact_v32_task_assignment");
    expect(verifyCrmTaskAssignmentSchemaTransition(before, after)).toMatchObject({
      status: "verified", classification: "exact_additive_v31_to_v32_transition", preservedVersionCount: 1, preservedTaskCount: 1,
    });
    expect(db.prepare("SELECT assigned_to FROM owned_task_versions WHERE task_id = 'task-1'").get()).toEqual({ assigned_to: null });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("refuses partial, wrong-target, or history-changing evidence", () => {
    const db = base();
    const before = snapshot(db);
    db.exec(createCrmTaskAssignmentSchemaArtifact().sql);
    const after = snapshot(db);
    expect(assessCrmTaskAssignmentSchemaSnapshot({ ...after, servedByPrimary: false }).status).toBe("refused");
    expect(assessCrmTaskAssignmentSchemaSnapshot({ ...after, assignmentTrigger: { ...after.assignmentTrigger, sql: "CREATE TRIGGER owned_task_version_state_change_preserves_assignment AFTER INSERT ON owned_task_versions BEGIN SELECT 1; END" } }).status).toBe("refused");
    expect(assessCrmTaskAssignmentSchemaSnapshot({ ...after, assignmentIndex: { ...after.assignmentIndex, tbl_name: "contacts" } }).status).toBe("refused");
    expect(assessCrmTaskAssignmentSchemaSnapshot({ ...after, taskTable: { ...after.taskTable, sql: after.taskTable.sql.replace("CHECK (assigned_to IS NULL OR assigned_to IN ('Eben', 'Garrett'))", "") } }).status).toBe("refused");
    expect(verifyCrmTaskAssignmentSchemaTransition(before, { ...after, taskCounts: { ...after.taskCounts, versionCount: 2 } }).status).toBe("refused");
    expect(verifyCrmTaskAssignmentSchemaTransition(before, { ...after, databaseId: "wrong" }).status).toBe("refused");
    db.close();
  });
});
