// OFFLINE ONLY. Builds and verifies the exact additive 0032 schema artifact.
// This module has no Cloudflare client, credential access, database write target,
// deployment path, provider adapter, message sender, or authority-promotion seam.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CRM_DATABASE } from "./crm-schema-install-plan.mjs";

export const CRM_TASK_ASSIGNMENT_SCHEMA_CONTRACT = "crm-task-assignment-schema-install-plan.v1";
export const MIGRATION_NAME = "0032_owned_task_assignment.sql";
export const MIGRATION_SHA256 = "3e0433e0b07f50a399498ace91ccc6c4fedd7c165eec0ade908472d3649c92e9";
export const ARTIFACT_SHA256 = "452448fc8bbbd59348f55ffcfa3ac3d5cc2585dec72a074b15fafeaee4be8995";
export const ARTIFACT_BYTES = 1350;

const MIGRATION_URL = new URL(`../crm-mirror-worker/migrations/${MIGRATION_NAME}`, import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const frozen = (value) => Object.freeze(value);
const flags = frozen({
  sourceOnly: true,
  executionAuthorized: false,
  productionWriteAuthorized: false,
  deploymentAuthorized: false,
  providerChangeAuthorized: false,
  customerActionAuthorized: false,
  authorityPromotionAuthorized: false,
  rollbackAuthorized: false,
});

export function createCrmTaskAssignmentSchemaArtifact() {
  const migration = readFileSync(MIGRATION_URL, "utf8");
  if (sha256(migration) !== MIGRATION_SHA256) throw new Error("migration_hash_mismatch");
  const sql = migration + (migration.endsWith("\n") ? "" : "\n")
    + `INSERT INTO d1_migrations (name) VALUES ('${MIGRATION_NAME}');\n`;
  if (Buffer.byteLength(sql) !== ARTIFACT_BYTES || sha256(sql) !== ARTIFACT_SHA256) {
    throw new Error("install_artifact_mismatch");
  }
  return frozen({
    contract: CRM_TASK_ASSIGNMENT_SCHEMA_CONTRACT,
    database: CRM_DATABASE,
    fromMigration: "0031_owned_contact_profile_authority.sql",
    throughMigration: MIGRATION_NAME,
    migrationCount: 1,
    migrations: frozen([frozen({ name: MIGRATION_NAME, sha256: MIGRATION_SHA256, bytes: Buffer.byteLength(migration) })]),
    sql,
    bytes: ARTIFACT_BYTES,
    sha256: ARTIFACT_SHA256,
    statementScope: "exact_0032_migration_bytes_plus_one_d1_migrations_insert",
    ...flags,
  });
}

export function crmTaskAssignmentSchemaReadbackQueries() {
  return frozen([
    frozen({ key: "ledger", sql: "SELECT id, name, applied_at FROM d1_migrations ORDER BY id" }),
    frozen({ key: "taskColumns", sql: "PRAGMA table_info('owned_task_versions')" }),
    frozen({ key: "assignmentIndex", sql: "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name = 'idx_owned_task_versions_assignment'" }),
    frozen({ key: "assignmentTrigger", sql: "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name = 'owned_task_version_state_change_preserves_assignment'" }),
    frozen({ key: "taskCounts", sql: "SELECT COUNT(*) AS version_count, COUNT(DISTINCT task_id) AS task_count, SUM(CASE WHEN assigned_to IS NOT NULL THEN 1 ELSE 0 END) AS assigned_version_count FROM owned_task_versions" }),
    frozen({ key: "integrity", sql: "PRAGMA integrity_check" }),
    frozen({ key: "foreignKeys", sql: "PRAGMA foreign_key_check" }),
  ]);
}

export function assessCrmTaskAssignmentSchemaSnapshot(snapshot) {
  const result = (status, extra = {}) => frozen({ contract: CRM_TASK_ASSIGNMENT_SCHEMA_CONTRACT, status, ...extra, ...flags });
  try {
    if (!snapshot || snapshot.databaseId !== CRM_DATABASE.id || snapshot.databaseName !== CRM_DATABASE.name
      || snapshot.environment !== "production") throw new Error("wrong_database");
    if (!snapshot.servedByPrimary || snapshot.readReplicationEnabled !== false) throw new Error("primary_readback_unproven");
    if (snapshot.integrity !== "ok" || Number(snapshot.foreignKeyViolationCount) !== 0) throw new Error("integrity_unproven");
    const ledger = Array.isArray(snapshot.migrations) ? snapshot.migrations : [];
    const columns = Array.isArray(snapshot.taskColumns) ? snapshot.taskColumns : [];
    const hasAssignment = columns.some((row) => row.name === "assigned_to" && String(row.type).toUpperCase() === "TEXT");
    const hasIndex = snapshot.assignmentIndex?.name === "idx_owned_task_versions_assignment";
    const hasTrigger = snapshot.assignmentTrigger?.name === "owned_task_version_state_change_preserves_assignment";
    if (ledger.at(-1)?.name === "0031_owned_contact_profile_authority.sql" && !hasAssignment && !hasIndex && !hasTrigger) {
      return result("proven", { classification: "exact_v31_base", migrationCount: ledger.length });
    }
    if (ledger.at(-1)?.name === MIGRATION_NAME && hasAssignment && hasIndex && hasTrigger) {
      return result("proven", { classification: "exact_v32_task_assignment", migrationCount: ledger.length });
    }
    throw new Error("schema_or_ledger_mismatch");
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "snapshot_assessment_failed"] });
  }
}

export function verifyCrmTaskAssignmentSchemaTransition(before, after) {
  const result = (status, extra = {}) => frozen({ contract: CRM_TASK_ASSIGNMENT_SCHEMA_CONTRACT, status, ...extra, ...flags });
  try {
    const beforeAssessment = assessCrmTaskAssignmentSchemaSnapshot(before);
    const afterAssessment = assessCrmTaskAssignmentSchemaSnapshot(after);
    if (beforeAssessment.classification !== "exact_v31_base") throw new Error("exact_v31_base_required");
    if (afterAssessment.classification !== "exact_v32_task_assignment") throw new Error("exact_v32_target_required");
    if (after.migrations.length !== before.migrations.length + 1
      || after.migrations.at(-1)?.id !== before.migrations.at(-1)?.id + 1
      || JSON.stringify(after.migrations.slice(0, -1)) !== JSON.stringify(before.migrations)) throw new Error("migration_ledger_transition_mismatch");
    for (const key of ["versionCount", "taskCount"]) {
      if (Number(before.taskCounts?.[key]) !== Number(after.taskCounts?.[key])) throw new Error("task_history_count_changed");
    }
    if (Number(after.taskCounts?.assignedVersionCount) !== 0) throw new Error("existing_task_assignment_changed");
    return result("verified", {
      classification: "exact_additive_v31_to_v32_transition",
      preservedVersionCount: Number(after.taskCounts.versionCount),
      preservedTaskCount: Number(after.taskCounts.taskCount),
      artifactSha256: ARTIFACT_SHA256,
    });
  } catch (error) {
    return result("refused", { reasonCodes: [error?.message || "transition_verification_failed"] });
  }
}
