import { sha256Hex } from "./reliability-contract.js";

export const RELIABILITY_SCHEMA_V1 = Object.freeze({
  version: 1,
  variantId: "production-live-v1-f7af1024",
  appliedAt: 1787631973000,
  migrationId: "reliability-spine-v1",
  description: "Durable source events, lifecycle instances, obligations, receipts, reconciliation, and exceptions",
  canonicalization: "sqlite-master-required-closure.v1",
  structureSha256: "f7af1024be129a24cb8a68a0c70a4bd3a8820104f9a5e36a58df97bbe7bbdd4f",
  expectedObjects: Object.freeze([
    "index:idx_command_obligation",
    "index:idx_enr_contact",
    "index:idx_evidence_access",
    "index:idx_evt_contact",
    "index:idx_evt_engine_flow",
    "index:idx_evt_flow",
    "index:idx_exception_events",
    "index:idx_exceptions_family_queue",
    "index:idx_exceptions_queue",
    "index:idx_lease_events",
    "index:idx_lifecycle_appointment",
    "index:idx_lifecycle_family_state",
    "index:idx_lifecycle_person",
    "index:idx_obligations_due",
    "index:idx_obligations_lease",
    "index:idx_reconciliation_family",
    "index:idx_source_events_provider_event",
    "index:idx_source_events_received",
    "index:idx_source_transitions",
    "index:idx_steps_due",
    "index:idx_workflow_one_published",
    "table:automation_events",
    "table:command_attempts",
    "table:evidence_access_events",
    "table:exception_events",
    "table:lifecycle_exceptions",
    "table:lifecycle_instances",
    "table:lifecycle_obligations",
    "table:obligation_lease_events",
    "table:provider_receipts",
    "table:reconciliation_runs",
    "table:reliability_schema_versions",
    "table:reminder_enrollments",
    "table:reminder_steps",
    "table:source_event_transitions",
    "table:source_events",
    "table:workflow_versions",
    "trigger:automation_events_no_delete",
    "trigger:automation_events_no_update",
    "trigger:evidence_access_no_delete",
    "trigger:evidence_access_no_update",
    "trigger:exception_events_no_delete",
    "trigger:exception_events_no_update",
    "trigger:lease_events_no_delete",
    "trigger:lease_events_no_update",
    "trigger:source_events_no_delete",
    "trigger:source_events_no_update",
    "trigger:source_transitions_no_delete",
    "trigger:source_transitions_no_update",
  ]),
});

// These clean-bootstrap shapes are retained as local design evidence only.
// They are not production authority: the historical production-v1 DDL differs
// in three exact sqlite_master rows, so the additive v2 target must be
// reconciled before either candidate SQL file can be authorized.
export const RELIABILITY_SCHEMA_V1_LOCAL_CANDIDATE = Object.freeze({
  ...RELIABILITY_SCHEMA_V1,
  variantId: "clean-bootstrap-v1-cd57730",
  structureSha256: "cd57730cfbf6a04cc3db670e0b299a27041191e880684eb86acd134ab734f5a2",
});

export const RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE = Object.freeze({
  version: 2,
  variantId: "clean-bootstrap-v2-b289c40",
  migrationId: "reliability-spine-v2-deployment-attestation",
  description: "Authenticated release manifests, deployment attestations, and source-event runtime provenance",
  canonicalization: "sqlite-master-required-closure.v1",
  structureSha256: "b289c4022a06c23d2c806d122ef2687077815aea5ae85fde064681250f1c8ed6",
  expectedObjects: Object.freeze([
    "index:idx_command_obligation",
    "index:idx_deployment_attestations_latest",
    "index:idx_deployment_attestations_release",
    "index:idx_deployment_attestations_runtime_version",
    "index:idx_enr_contact",
    "index:idx_evidence_access",
    "index:idx_evt_contact",
    "index:idx_evt_engine_flow",
    "index:idx_evt_flow",
    "index:idx_exception_events",
    "index:idx_exceptions_family_queue",
    "index:idx_exceptions_queue",
    "index:idx_lease_events",
    "index:idx_lifecycle_appointment",
    "index:idx_lifecycle_family_state",
    "index:idx_lifecycle_person",
    "index:idx_obligations_due",
    "index:idx_obligations_lease",
    "index:idx_reconciliation_family",
    "index:idx_source_events_provider_event",
    "index:idx_source_events_received",
    "index:idx_source_runtime_provenance_deployment",
    "index:idx_source_transitions",
    "index:idx_steps_due",
    "index:idx_workflow_one_published",
    "table:automation_deployment_attestations",
    "table:automation_events",
    "table:automation_release_manifests",
    "table:command_attempts",
    "table:evidence_access_events",
    "table:exception_events",
    "table:lifecycle_exceptions",
    "table:lifecycle_instances",
    "table:lifecycle_obligations",
    "table:obligation_lease_events",
    "table:provider_receipts",
    "table:reconciliation_runs",
    "table:reliability_schema_contracts",
    "table:reliability_schema_versions",
    "table:reminder_enrollments",
    "table:reminder_steps",
    "table:source_event_runtime_provenance",
    "table:source_event_transitions",
    "table:source_events",
    "table:workflow_versions",
    "trigger:automation_deployment_attestations_consistent_insert",
    "trigger:automation_deployment_attestations_no_delete",
    "trigger:automation_deployment_attestations_no_overlap_conflict",
    "trigger:automation_deployment_attestations_no_update",
    "trigger:automation_deployment_attestations_no_version_identity_conflict",
    "trigger:automation_events_no_delete",
    "trigger:automation_events_no_update",
    "trigger:automation_release_manifests_no_delete",
    "trigger:automation_release_manifests_no_update",
    "trigger:evidence_access_no_delete",
    "trigger:evidence_access_no_update",
    "trigger:exception_events_no_delete",
    "trigger:exception_events_no_update",
    "trigger:lease_events_no_delete",
    "trigger:lease_events_no_update",
    "trigger:reliability_schema_contracts_no_delete",
    "trigger:reliability_schema_contracts_no_update",
    "trigger:source_event_runtime_provenance_consistent_insert",
    "trigger:source_event_runtime_provenance_no_delete",
    "trigger:source_event_runtime_provenance_no_update",
    "trigger:source_events_no_delete",
    "trigger:source_events_no_update",
    "trigger:source_transitions_no_delete",
    "trigger:source_transitions_no_update",
  ]),
});

// Exact source-only candidate produced by applying the reviewed twenty
// additive objects to the checked-in historical production-v1 projection.
// It is not accepted production authority and does not authorize any SQL
// artifact. Staff continues to prove only RELIABILITY_SCHEMA_V1.
export const RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE = Object.freeze({
  ...RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE,
  variantId: "production-live-lineage-v2-8c7245a",
  migrationId: "reliability-spine-v2-production-lineage-candidate-unobserved",
  description: "Predicted production-lineage v2 structure candidate; not observed authority",
  structureSha256: "8c7245ae2bb34d053e1d13e2f7c0ed632eca1c5aa0a52259c476100ec9388a62",
});

const V2_ONLY_OBJECTS = new Set(RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.expectedObjects.filter(
  (object) => !RELIABILITY_SCHEMA_V1.expectedObjects.includes(object),
));
const V2_ADDITIVE_TABLES = Object.freeze([
  "automation_deployment_attestations",
  "automation_release_manifests",
  "reliability_schema_contracts",
  "source_event_runtime_provenance",
]);

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function all(db, sql, ...bindings) {
  const statement = db.prepare(sql);
  const bound = bindings.length ? statement.bind(...bindings) : statement;
  return rowsOf(await bound.all());
}

function normalizeDdl(sql) {
  return String(sql).replace(/\r\n?/g, "\n").trim();
}

export function reliabilityStructureProjection(sqliteMasterRows, schemaContract) {
  const tables = new Set(schemaContract.expectedObjects
    .filter((object) => object.startsWith("table:"))
    .map((object) => object.slice("table:".length)));
  return sqliteMasterRows
    .filter((row) => !String(row.name || "").startsWith("sqlite_autoindex"))
    .filter((row) => (row.type === "table" && tables.has(row.name))
      || ((row.type === "index" || row.type === "trigger") && tables.has(row.tbl_name)))
    .map((row) => ({
      type: row.type,
      name: row.name,
      table: row.tbl_name,
      sql: normalizeDdl(row.sql),
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type < right.type ? -1 : 1;
      if (left.name === right.name) return 0;
      return left.name < right.name ? -1 : 1;
    });
}

export async function assessReliabilityStructure(sqliteMasterRows, schemaContract) {
  const projection = reliabilityStructureProjection(sqliteMasterRows, schemaContract);
  const objects = projection.map((row) => `${row.type}:${row.name}`);
  const digest = await sha256Hex(JSON.stringify(projection));
  return {
    proven: JSON.stringify(objects) === JSON.stringify(schemaContract.expectedObjects)
      && digest === schemaContract.structureSha256,
    objects,
    digest,
    expectedObjects: schemaContract.expectedObjects,
    expectedDigest: schemaContract.structureSha256,
  };
}

export async function readReliabilitySchemaSnapshot(db) {
  const markers = await all(db, `SELECT version,applied_at,migration_id,description
    FROM reliability_schema_versions ORDER BY version`);
  const sqliteMaster = await all(db, `SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE type IN ('table','index','trigger') ORDER BY type,name`);
  const hasContractTable = sqliteMaster.some((row) => row.type === "table" && row.name === "reliability_schema_contracts");
  const contracts = hasContractTable
    ? await all(db, `SELECT version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at
      FROM reliability_schema_contracts ORDER BY version`)
    : [];
  return { markers, sqliteMaster, contracts };
}

function exactMarker(marker, contract) {
  return marker
    && Number(marker.version) === contract.version
    && marker.migration_id === contract.migrationId
    && marker.description === contract.description
    && Number.isInteger(Number(marker.applied_at))
    && Number(marker.applied_at) > 0
    && (contract.appliedAt == null || Number(marker.applied_at) === contract.appliedAt);
}

export async function assessReliabilitySchemaAuthority(snapshot) {
  const latest = snapshot.markers.at(-1) || null;
  if (!latest) return { proven: false, reason: "schema_marker_missing", version: null };

  if (Number(latest.version) === RELIABILITY_SCHEMA_V1.version) {
    if (snapshot.markers.length !== 1 || !exactMarker(latest, RELIABILITY_SCHEMA_V1)) {
      return { proven: false, reason: "schema_v1_marker_mismatch", version: 1 };
    }
    const v1Structure = await assessReliabilityStructure(snapshot.sqliteMaster, RELIABILITY_SCHEMA_V1);
    if (!v1Structure.proven) {
      return { proven: false, reason: "schema_v1_structure_mismatch", version: 1, structure: v1Structure };
    }

    const v2Projection = reliabilityStructureProjection(
      snapshot.sqliteMaster,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    );
    const installedV2Objects = v2Projection.map((row) => `${row.type}:${row.name}`)
      .filter((object) => !RELIABILITY_SCHEMA_V1.expectedObjects.includes(object));
    if (installedV2Objects.length === 0) {
      return {
        proven: true,
        reason: "schema_v1_exact_authority",
        version: 1,
        variantId: RELIABILITY_SCHEMA_V1.variantId,
        migrationState: "current_v1",
        structure: v1Structure,
      };
    }

    const v2Structure = await assessReliabilityStructure(
      snapshot.sqliteMaster,
      RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    );
    if (installedV2Objects.length === V2_ONLY_OBJECTS.size
      && v2Structure.proven
      && snapshot.contracts.length === 0) {
      return {
        proven: false,
        reason: "schema_v2_physical_install_awaiting_promotion",
        version: 1,
        variantId: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE.variantId,
        migrationState: "installed_awaiting_promotion",
        structure: v1Structure,
        candidateStructure: v2Structure,
        installedV2Objects,
      };
    }
    return {
      proven: false,
      reason: "schema_v2_partial_or_conflicting",
      version: 1,
      migrationState: "blocked",
      structure: v1Structure,
      stagedStructure: v2Structure,
      installedV2Objects,
    };
  }

  if (Number(latest.version) !== RELIABILITY_SCHEMA_V2_LOCAL_CANDIDATE.version) {
    return { proven: false, reason: "schema_version_unknown", version: Number(latest.version) };
  }
  return {
    proven: false,
    reason: "schema_v2_authority_not_defined",
    version: 2,
    migrationState: "blocked",
  };
}

export async function assessReliabilityV2InstallCandidatePreflight(snapshot) {
  const authority = await assessReliabilitySchemaAuthority(snapshot);
  if (authority.proven && authority.version === 1) {
    return {
      candidateCompatible: true,
      authorized: false,
      state: "exact_live_v1_candidate_input",
      reason: "schema_v2_install_requires_separate_authorization",
      authority,
      installedV2Objects: [],
      target: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    };
  }
  return {
    candidateCompatible: false,
    authorized: false,
    state: "blocked",
    reason: authority.reason,
    authority,
  };
}

export async function assessReliabilityV2PromotionCandidatePreflight(snapshot) {
  const authority = await assessReliabilitySchemaAuthority(snapshot);
  const additiveTablesEmpty = V2_ADDITIVE_TABLES.every(
    (table) => Number.isInteger(snapshot.additiveTableCounts?.[table])
      && snapshot.additiveTableCounts[table] === 0,
  );
  if (authority.reason === "schema_v2_physical_install_awaiting_promotion"
    && authority.candidateStructure?.proven
    && snapshot.contracts.length === 0
    && additiveTablesEmpty) {
    return {
      candidateCompatible: true,
      structureCompatible: true,
      additiveTablesEmpty: true,
      authorized: false,
      state: "predicted_shape_requires_primary_readback",
      reason: "schema_v2_primary_readback_required",
      authority,
      predictedTarget: RELIABILITY_SCHEMA_V2_PRODUCTION_LINEAGE_CANDIDATE,
    };
  }
  if (authority.reason === "schema_v2_physical_install_awaiting_promotion"
    && authority.candidateStructure?.proven
    && snapshot.contracts.length === 0) {
    return {
      candidateCompatible: false,
      structureCompatible: true,
      additiveTablesEmpty: false,
      authorized: false,
      state: "blocked",
      reason: "schema_v2_additive_table_emptiness_unproven",
      authority,
    };
  }
  return {
    candidateCompatible: false,
    structureCompatible: false,
    authorized: false,
    state: "blocked",
    reason: authority.reason,
    authority,
  };
}

export async function assessReliabilityV2MigrationPreflight(snapshot) {
  const candidate = await assessReliabilityV2InstallCandidatePreflight(snapshot);
  return {
    ready: false,
    state: "blocked",
    reason: candidate.candidateCompatible
      ? "schema_v2_source_only_not_authorized"
      : candidate.reason,
    authority: candidate.authority,
    candidate,
  };
}

export async function assertReliabilityV2MigrationPreflight(db) {
  const snapshot = await readReliabilitySchemaSnapshot(db);
  const result = await assessReliabilityV2MigrationPreflight(snapshot);
  if (!result.ready) {
    const error = new Error(`reliability v2 migration preflight failed: ${result.reason}`);
    error.code = result.reason;
    throw error;
  }
  return result;
}

export async function assertReliabilityV2Postflight(db) {
  const snapshot = await readReliabilitySchemaSnapshot(db);
  const authority = await assessReliabilitySchemaAuthority(snapshot);
  if (!authority.proven || authority.version !== 2) {
    const error = new Error(`reliability v2 postflight failed: ${authority.reason}`);
    error.code = authority.reason;
    throw error;
  }
  return authority;
}

export async function readReliabilitySchemaAuthority(db) {
  return assessReliabilitySchemaAuthority(await readReliabilitySchemaSnapshot(db));
}
