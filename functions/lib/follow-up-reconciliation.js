import {
  FOLLOW_UP_FAMILY, NORMALIZED_RETENTION_MS, sha256Hex,
} from "./reliability-contract.js";
import { defineWorkflow, executableFlow } from "../../reminder-engine-worker/src/workflow-definition.js";
import { enroll } from "../../reminder-engine-worker/src/enroll.js";
import {
  RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY,
  readReliabilitySchemaAuthority,
} from "./reliability-schema-authority.js";
import {
  FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION,
  FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE,
  FOLLOW_UP_RECONCILIATION_MAX_COMPLETION_LAG_MS,
  FOLLOW_UP_RECONCILIATION_MAX_RUN_MS,
  FOLLOW_UP_RECONCILIATION_MAX_WINDOW_MS,
  FOLLOW_UP_RECONCILIATION_RUN_KIND,
  addFollowUpReconciliationDigest,
  canonicalReconciliationJson,
  followUpReconciliationRunId,
  validateFollowUpReconciliationDetail,
} from "./reliability-store.js";

export const FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG =
  "FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE";
export const FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_VALUE =
  "reviewed-source-only-v1";
export const FOLLOW_UP_OWNED_LEDGER_QUERY_VERSION = "follow-up-owned-ledger.v1";

const COMPONENT_ORDER = [
  "schema", "ownedLedger", "runtimeProvenance", "ghlAppointmentEventSourceCoverage", "providerReceipts",
];
const SOURCE_VERSION_RE = /^ghl:appointment-events-webhook:v[1-9][0-9]*$/;
const RUNTIME_VERSION_RE = /^[a-f0-9]{40}@follow-up-reminder-engine\.v[1-9][0-9]*$/;
const ACCEPTED_TRANSITION_PREFIX = ["received", "authenticated", "normalized", "accepted"];
const ACCEPTED_NORMALIZED_KEYS = [
  "appointmentId", "calendarId", "effectiveStart", "eventKind", "personId", "reminderPreference", "status",
];
const ALLOWED_OBLIGATION_STATES = new Set([
  "pending", "leased", "satisfied", "skipped", "cancelled", "overdue_exception",
]);
const EXCEPTION_EVENT_TRANSITIONS = Object.freeze({
  open: Object.freeze({ acknowledged: "acknowledged", suppressed: "suppressed_with_expiry" }),
  acknowledged: Object.freeze({ investigating: "investigating", resolved: "resolved", suppressed: "suppressed_with_expiry" }),
  investigating: Object.freeze({ resolved: "resolved", suppressed: "suppressed_with_expiry" }),
  suppressed_with_expiry: Object.freeze({ reopened: "open" }),
  resolved: Object.freeze({}),
});

function assertCollectorInput({
  expectedStart, expectedEnd, startedAt, checkedAt, sourceVersion, runtimeVersion,
  activationWatermark, continuityStart,
}) {
  for (const [label, value] of Object.entries({
    expectedStart, expectedEnd, startedAt, checkedAt, activationWatermark, continuityStart,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " must be a nonnegative safe integer");
  }
  for (const [label, value] of Object.entries({ sourceVersion, runtimeVersion })) {
    const pattern = label === "sourceVersion" ? SOURCE_VERSION_RE : RUNTIME_VERSION_RE;
    if (typeof value !== "string" || value.length > 160 || value !== value.trim() || !pattern.test(value)) {
      throw new TypeError(label + " must be a bounded canonical version identity");
    }
  }
  if (expectedStart >= expectedEnd
    || expectedEnd - expectedStart > FOLLOW_UP_RECONCILIATION_MAX_WINDOW_MS
    || expectedEnd > startedAt
    || startedAt > checkedAt
    || checkedAt - startedAt > FOLLOW_UP_RECONCILIATION_MAX_RUN_MS
    || checkedAt - expectedEnd > FOLLOW_UP_RECONCILIATION_MAX_COMPLETION_LAG_MS
    || activationWatermark > expectedStart
    || continuityStart > expectedStart) {
    throw new TypeError("reconciliation collector window or chronology is invalid");
  }
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

function releaseEnabled(env) {
  return env?.[FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG]
    === FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_VALUE;
}

function failureStatus(error) {
  const message = String(error?.message || error).toLowerCase();
  if (message.includes("permission") || message.includes("unauthor") || message.includes("forbidden")) {
    return "permission_error";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "query_error";
}

function failureReason(prefix, status) {
  if (status === "permission_error") return prefix + "_permission_denied";
  if (status === "timeout") return prefix + "_timeout";
  return prefix + "_query_failed";
}

function failedOwnedLedger(readStatus) {
  return {
    truth: "Unknown",
    reason: failureReason("owned_ledger", readStatus),
    readStatus,
    queryVersion: FOLLOW_UP_OWNED_LEDGER_QUERY_VERSION,
    identityDigest: null,
    obligationSetDigest: null,
    sourceEvents: null,
    sourceTransitions: null,
    acceptedSourceEvents: null,
    rejectedSourceEvents: null,
    lifecycleInstances: null,
    obligations: null,
    expectedObligations: null,
    missingObligations: null,
    unexpectedObligations: null,
    commandAttempts: null,
    openExceptions: null,
    globalOrphanSourceTransitions: null,
    globalOrphanLifecycles: null,
    globalOrphanObligations: null,
    globalOrphanCommandAttempts: null,
    invariantViolations: null,
  };
}

function failedRuntimeProvenance(readStatus) {
  return {
    truth: "Unknown",
    reason: failureReason("runtime_provenance", readStatus),
    readStatus,
    releaseManifestIds: null,
    deploymentAttestationIds: null,
    currentDeploymentAttestationId: null,
    attestationExpiresAt: null,
    attestationFresh: null,
    sourceBindings: null,
    distinctRuntimeVersions: null,
    unboundAcceptedSources: null,
    bindingMismatches: null,
    runtimeVersionMatch: null,
    identityDigest: null,
  };
}

function failedProviderReceipts(readStatus) {
  return {
    truth: "Unknown",
    reason: failureReason("provider_receipt_coverage", readStatus),
    readStatus,
    expectedReceiptObligations: null,
    coveredObligations: null,
    acceptedObligations: null,
    deliveredObligations: null,
    failedObligations: null,
    bouncedObligations: null,
    unknownObligations: null,
    zeroDenominatorProven: null,
    lookupErrors: null,
    cursorExhausted: null,
    identityDigest: null,
    obligationSetDigest: null,
    coverageStart: null,
    coverageEnd: null,
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

async function digest(value) {
  return sha256Hex(canonicalReconciliationJson(value));
}

async function collectSchemaComponent(db) {
  try {
    const authority = await readReliabilitySchemaAuthority(db);
    const exactV2 = authority.proven
      && authority.version === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.version
      && authority.variantId === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.variantId
      && authority.migrationState === "current_v2"
      && authority.structure?.digest === RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256;
    if (!exactV2) {
      return {
        truth: "Degraded", reason: "schema_authority_missing_or_unproven", readStatus: "missing",
        version: null, variantId: null, migrationId: null, migrationState: null, structureSha256: null,
      };
    }
    return {
      truth: "Degraded", reason: "schema_authority_self_reported_unverified", readStatus: "complete",
      version: authority.version,
      variantId: authority.variantId,
      migrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId,
      migrationState: authority.migrationState,
      structureSha256: authority.structure.digest,
    };
  } catch (error) {
    const readStatus = failureStatus(error);
    return {
      truth: "Unknown", reason: failureReason("schema_authority", readStatus), readStatus,
      version: null, variantId: null, migrationId: null, migrationState: null, structureSha256: null,
    };
  }
}

function query(db, sql, ...bindings) {
  return db.prepare(sql).bind(...bindings);
}

async function collectLocalSnapshot(db, expectedStart, expectedEnd) {
  const bounds = [FOLLOW_UP_FAMILY, expectedStart, expectedEnd];
  const statements = [
    query(db, "SELECT source_event_id,provider,provider_event_id,identity_version,identity_key,payload_sha256,state,source_version,runtime_version,authentication_result,normalization_state,normalized_json,rejection_reason,occurred_at,received_at,accepted_at,created_at,normalized_retention_until FROM source_events WHERE family = ? AND received_at >= ? AND received_at < ? ORDER BY source_event_id", ...bounds),
    query(db, "SELECT t.source_transition_id,t.source_event_id,t.sequence,t.transition,t.occurred_at,t.detail_json,t.retention_until FROM source_event_transitions t JOIN source_events s ON s.source_event_id=t.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND t.occurred_at < ? ORDER BY t.source_event_id,t.sequence", ...bounds, expectedEnd),
    query(db, "SELECT l.lifecycle_instance_id,l.source_event_id,l.family,l.scope,l.person_id,l.appointment_id,l.definition_version,l.runtime_version,l.state,l.retention_until,l.created_at,l.updated_at FROM lifecycle_instances l JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND l.created_at < ? ORDER BY l.lifecycle_instance_id", ...bounds, expectedEnd),
    query(db, "SELECT o.obligation_id,o.lifecycle_instance_id,o.obligation_key,o.kind,o.family,o.owner_role,o.closer,o.state,o.deadline_at,o.lease_expires_at,o.retention_until,o.created_at,o.updated_at FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND l.created_at < ? AND o.created_at < ? ORDER BY o.lifecycle_instance_id,o.obligation_key", ...bounds, expectedEnd, expectedEnd),
    query(db, "SELECT DISTINCT w.version,w.state,w.document,w.published_at FROM workflow_versions w JOIN lifecycle_instances l ON l.definition_version=w.version JOIN source_events s ON s.source_event_id=l.source_event_id WHERE w.workflow_id = ? AND s.family = ? AND s.received_at >= ? AND s.received_at < ? AND l.created_at < ? ORDER BY w.version", FOLLOW_UP_FAMILY, ...bounds, expectedEnd),
    query(db, "SELECT c.command_attempt_id,c.obligation_id,c.state,c.target,c.provider_reference,c.retention_until,c.created_at,c.updated_at FROM command_attempts c JOIN lifecycle_obligations o ON o.obligation_id=c.obligation_id JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND c.created_at < ? ORDER BY c.obligation_id,c.attempt_number,c.command_attempt_id", ...bounds, expectedEnd),
    query(db, "SELECT x.exception_id,x.family,x.source_event_id,x.lifecycle_instance_id,x.obligation_id,x.kind,x.severity,x.accountable_owner,x.next_safe_action,x.state,x.suppression_expires_at,x.retention_until,x.opened_at,x.updated_at FROM lifecycle_exceptions x WHERE x.family = ? AND x.opened_at < ? AND (x.source_event_id IN (SELECT s.source_event_id FROM source_events s WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?) OR x.lifecycle_instance_id IN (SELECT l.lifecycle_instance_id FROM lifecycle_instances l JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?) OR x.obligation_id IN (SELECT o.obligation_id FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?)) ORDER BY x.exception_id", FOLLOW_UP_FAMILY, expectedEnd, ...bounds, ...bounds, ...bounds),
    query(db, "SELECT e.exception_event_id,e.exception_id,e.event_type,e.actor,e.occurred_at,e.evidence_sha256,e.detail_json,e.retention_until FROM exception_events e JOIN lifecycle_exceptions x ON x.exception_id=e.exception_id WHERE x.family = ? AND x.opened_at < ? AND (x.source_event_id IN (SELECT s.source_event_id FROM source_events s WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?) OR x.lifecycle_instance_id IN (SELECT l.lifecycle_instance_id FROM lifecycle_instances l JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?) OR x.obligation_id IN (SELECT o.obligation_id FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ?)) ORDER BY e.exception_id,e.occurred_at,CASE e.event_type WHEN 'opened' THEN 0 ELSE 1 END,e.exception_event_id", FOLLOW_UP_FAMILY, expectedEnd, ...bounds, ...bounds, ...bounds),
    query(db, "SELECT COUNT(*) count FROM source_event_transitions t LEFT JOIN source_events s ON s.source_event_id=t.source_event_id WHERE s.source_event_id IS NULL"),
    query(db, "SELECT COUNT(*) count FROM lifecycle_instances l LEFT JOIN source_events s ON s.source_event_id=l.source_event_id WHERE s.source_event_id IS NULL"),
    query(db, "SELECT COUNT(*) count FROM lifecycle_obligations o LEFT JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id WHERE l.lifecycle_instance_id IS NULL"),
    query(db, "SELECT COUNT(*) count FROM command_attempts c LEFT JOIN lifecycle_obligations o ON o.obligation_id=c.obligation_id WHERE o.obligation_id IS NULL"),
    query(db, "SELECT p.*,a.release_manifest_id,a.version_id,a.runtime_version attestation_runtime,a.expires_at,a.observed_at attestation_observed_at,a.attested_at,a.recorded_at,a.retention_until attestation_retention_until,m.runtime_version manifest_runtime,m.created_at manifest_created_at,m.retention_until manifest_retention_until,m.workflow_document_sha256,m.schema_structure_sha256 FROM source_event_runtime_provenance p JOIN source_events s ON s.source_event_id=p.source_event_id LEFT JOIN automation_deployment_attestations a ON a.deployment_attestation_id=p.deployment_attestation_id LEFT JOIN automation_release_manifests m ON m.release_manifest_id=a.release_manifest_id WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND p.bound_at < ? ORDER BY p.source_event_id,p.deployment_attestation_id", ...bounds, expectedEnd),
    query(db, "SELECT o.obligation_id,o.state obligation_state,o.deadline_at,o.created_at obligation_created_at,c.command_attempt_id,c.state command_state,c.target command_target,c.provider_reference command_provider_reference,c.created_at command_created_at,c.updated_at command_updated_at,r.provider_receipt_id,r.provider,r.provider_reference receipt_provider_reference,r.proof_level,r.evidence_sha256,r.observed_at,r.created_at receipt_created_at,r.retention_until receipt_retention_until FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id JOIN source_events s ON s.source_event_id=l.source_event_id LEFT JOIN command_attempts c ON c.obligation_id=o.obligation_id AND c.created_at < ? LEFT JOIN provider_receipts r ON r.command_attempt_id=c.command_attempt_id AND r.observed_at < ? AND r.created_at < ? WHERE s.family = ? AND s.received_at >= ? AND s.received_at < ? AND o.created_at < ? AND o.closer = 'provider_receipt' ORDER BY o.obligation_id,c.command_attempt_id,r.observed_at,r.provider_receipt_id", expectedEnd, expectedEnd, expectedEnd, ...bounds, expectedEnd),
  ];
  const results = await db.batch(statements);
  const failedIndex = Array.isArray(results)
    ? results.findIndex((result) => result?.success === false
      || (!Array.isArray(result) && !Array.isArray(result?.results)))
    : -1;
  const failed = failedIndex >= 0 ? results[failedIndex] : null;
  if (!Array.isArray(results) || results.length !== statements.length || failedIndex >= 0) {
    const detail = String(failed?.error || failed?.message || "batch result missing");
    throw new Error(`owned reconciliation snapshot batch was incomplete: ${detail}`);
  }
  const rows = results.map(rowsOf);
  return {
    sources: rows[0],
    transitions: rows[1],
    lifecycles: rows[2],
    obligations: rows[3],
    workflows: rows[4],
    commands: rows[5],
    exceptions: rows[6],
    exceptionEvents: rows[7],
    globalOrphanTransitions: rows[8],
    globalOrphanLifecycles: rows[9],
    globalOrphanObligations: rows[10],
    globalOrphanCommands: rows[11],
    runtimeProvenance: rows[12],
    providerReceipts: rows[13],
  };
}

function canonicalDetailObject(detailJson) {
  if (detailJson === null) return null;
  try {
    const value = JSON.parse(detailJson);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || canonicalReconciliationJson(value) !== detailJson) return false;
    return value;
  } catch {
    return false;
  }
}

function exactAcceptedNormalized(source) {
  let normalized;
  try {
    normalized = JSON.parse(source.normalized_json || "null");
  } catch {
    return null;
  }
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)
    || JSON.stringify(Object.keys(normalized).sort()) !== JSON.stringify(ACCEPTED_NORMALIZED_KEYS)
    || ["appointmentId", "personId", "calendarId", "effectiveStart"].some(
      (key) => typeof normalized[key] !== "string" || !normalized[key],
    )
    || normalized.status !== "confirmed"
    || normalized.eventKind !== "normal"
    || !new Set(["full", "some", "none"]).has(normalized.reminderPreference)
    || !Number.isFinite(Date.parse(normalized.effectiveStart))) return null;
  return normalized;
}

function transitionPathIsExact(source, rows) {
  if (rows.some((row, index) => Number(row.sequence) !== index + 1
    || (index > 0 && Number(row.occurred_at) < Number(rows[index - 1].occurred_at)))) return false;
  if (!rows[0] || Number(rows[0].occurred_at) !== Number(source.received_at)) return false;
  for (const row of rows) {
    if (!/^srct_[a-f0-9]{64}$/.test(String(row.source_transition_id || ""))) return false;
    if (row.transition === "accepted" || row.transition === "rejected") {
      let detail;
      try {
        detail = JSON.parse(row.detail_json || "null");
      } catch {
        return false;
      }
      if (!detail || JSON.stringify(Object.keys(detail).sort())
          !== JSON.stringify(["runtimeVersion", "sourceVersion"])
        || detail.sourceVersion !== source.source_version
        || detail.runtimeVersion !== source.runtime_version) return false;
    } else if (row.transition === "deduplicated") {
      let detail;
      try {
        detail = JSON.parse(row.detail_json || "null");
      } catch {
        return false;
      }
      if (!detail || JSON.stringify(Object.keys(detail)) !== JSON.stringify(["identityKey"])
        || detail.identityKey !== source.identity_key) return false;
    } else if (row.detail_json !== null) return false;
  }
  const actual = rows.map((row) => row.transition);
  let baseline;
  if (source.state === "accepted") {
    baseline = ACCEPTED_TRANSITION_PREFIX;
    if (!Number.isSafeInteger(Number(source.accepted_at))
      || Number(rows[3]?.occurred_at) !== Number(source.accepted_at)) return false;
  } else if (source.state === "rejected") {
    baseline = ["received"];
    if (source.authentication_result === "authenticated") baseline.push("authenticated");
    if (source.normalization_state === "normalized") baseline.push("normalized");
    baseline.push("rejected");
  } else {
    return false;
  }
  if (actual.length < baseline.length
    || baseline.some((transition, index) => actual[index] !== transition)) return false;
  if (source.state === "accepted") {
    const tail = actual.slice(baseline.length);
    return tail.filter((transition) => transition === "dispatched").length === 1
      && tail.every((transition) => transition === "dispatched" || transition === "deduplicated");
  }
  if (Number(rows[baseline.length - 1]?.occurred_at) !== Number(source.created_at)) return false;
  return actual.slice(baseline.length).every((transition) => transition === "deduplicated");
}

async function exceptionEventRouteIsExact(exception, rows, checkedAt) {
  if (!rows.length) return false;
  const expectedOpenedId = `exevt_${await sha256Hex(`${exception.exception_id}\u0000opened`)}`;
  let state = "open";
  let lastOccurredAt = null;
  for (const [index, row] of rows.entries()) {
    const occurredAt = Number(row.occurred_at);
    const retentionUntil = Number(row.retention_until);
    const detail = canonicalDetailObject(row.detail_json);
    if (row.exception_id !== exception.exception_id
      || typeof row.actor !== "string" || !row.actor || row.actor.length > 100
      || !Number.isSafeInteger(occurredAt) || occurredAt < Number(exception.opened_at)
      || occurredAt > checkedAt
      || (lastOccurredAt !== null && occurredAt < lastOccurredAt)
      || retentionUntil !== occurredAt + NORMALIZED_RETENTION_MS
      || retentionUntil <= checkedAt
      || (row.evidence_sha256 !== null
        && !/^[a-f0-9]{64}$/.test(String(row.evidence_sha256 || "")))
      || (row.detail_json !== null && detail === false)) return false;
    if (index === 0) {
      if (row.event_type !== "opened"
        || row.exception_event_id !== expectedOpenedId
        || row.actor !== "system"
        || occurredAt !== Number(exception.opened_at)
        || !/^[a-f0-9]{64}$/.test(String(row.evidence_sha256 || ""))
        || detail === null) return false;
    } else {
      const nextState = EXCEPTION_EVENT_TRANSITIONS[state]?.[row.event_type];
      if (!nextState) return false;
      if (row.event_type === "resolved"
        && !/^[a-f0-9]{64}$/.test(String(row.evidence_sha256 || ""))) return false;
      if (row.event_type === "suppressed") {
        if (!detail || !Number.isSafeInteger(detail.suppressionExpiresAt)
          || detail.suppressionExpiresAt <= occurredAt) return false;
      }
      state = nextState;
    }
    lastOccurredAt = occurredAt;
  }
  if (state !== exception.state || lastOccurredAt !== Number(exception.updated_at)) return false;
  if (state === "suppressed_with_expiry") {
    const lastDetail = canonicalDetailObject(rows.at(-1).detail_json);
    if (!lastDetail || Number(exception.suppression_expires_at) !== lastDetail.suppressionExpiresAt) {
      return false;
    }
  } else if (exception.suppression_expires_at !== null) return false;
  return true;
}

async function expectedObligation(lifecycle, node, step) {
  if (!node || typeof node.id !== "string" || !node.id
    || typeof node.at !== "string" || !node.action || typeof node.action.type !== "string") {
    throw new TypeError("published workflow node is incomplete");
  }
  const deadlineAt = step.dueAt;
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt < 0) throw new TypeError("workflow deadline is invalid");
  const exit = node.action.type === "exit_flow";
  const audience = node.message?.audience;
  const channel = node.message?.channel;
  if (!exit && (!audience || !channel)) throw new TypeError("published workflow message routing is incomplete");
  const ownerRole = audience === "internal" ? "assigned_user" : "system";
  const initialState = step.status;
  return {
    obligationId: `obl_${await sha256Hex(`${lifecycle.lifecycle_instance_id}\u0000${node.id}`)}`,
    lifecycleInstanceId: lifecycle.lifecycle_instance_id,
    obligationKey: node.id,
    kind: exit ? "external_workflow_exit" : `${audience}_${channel}`,
    family: FOLLOW_UP_FAMILY,
    deadlineAt,
    ownerRole,
    closer: exit ? "provider_exit_evidence" : "provider_receipt",
    initialState,
  };
}

async function ownedComponent(snapshot, expectedEnd, checkedAt, sourceVersion, runtimeVersion) {
  const {
    sources, transitions, lifecycles, obligations, workflows, commands, exceptions,
    exceptionEvents,
    globalOrphanTransitions: orphanTransitions,
    globalOrphanLifecycles: orphanLifecycles,
    globalOrphanObligations: orphanObligations,
    globalOrphanCommands: orphanCommands,
  } = snapshot;
  const sourceById = new Map(sources.map((row) => [row.source_event_id, row]));
  const transitionsBySource = new Map();
  for (const row of transitions) {
    if (!transitionsBySource.has(row.source_event_id)) transitionsBySource.set(row.source_event_id, []);
    transitionsBySource.get(row.source_event_id).push(row);
  }
  const lifecycleBySource = new Map();
  for (const row of lifecycles) {
    if (!lifecycleBySource.has(row.source_event_id)) lifecycleBySource.set(row.source_event_id, []);
    lifecycleBySource.get(row.source_event_id).push(row);
  }
  const lifecycleById = new Map(lifecycles.map((row) => [row.lifecycle_instance_id, row]));
  const obligationsByLifecycle = new Map();
  for (const row of obligations) {
    if (!obligationsByLifecycle.has(row.lifecycle_instance_id)) obligationsByLifecycle.set(row.lifecycle_instance_id, []);
    obligationsByLifecycle.get(row.lifecycle_instance_id).push(row);
  }
  const obligationById = new Map(obligations.map((row) => [row.obligation_id, row]));
  const exceptionEventsByException = new Map();
  for (const row of exceptionEvents) {
    if (!exceptionEventsByException.has(row.exception_id)) {
      exceptionEventsByException.set(row.exception_id, []);
    }
    exceptionEventsByException.get(row.exception_id).push(row);
  }
  const workflowByVersion = new Map();
  let invariantViolations = 0;
  for (const row of workflows) {
    try {
      const document = defineWorkflow(JSON.parse(row.document));
      if (document.id !== FOLLOW_UP_FAMILY || document.version !== Number(row.version) || !Array.isArray(document.nodes)) {
        invariantViolations += 1;
      } else {
        workflowByVersion.set(Number(row.version), {
          document,
          flow: executableFlow(document),
          state: row.state,
          publishedAt: row.published_at == null ? null : Number(row.published_at),
        });
      }
    } catch {
      invariantViolations += 1;
    }
  }

  const expectedSet = [];
  const actualByKey = new Map(obligations.map((row) => [
    row.lifecycle_instance_id + "\u0000" + row.obligation_key, row,
  ]));
  invariantViolations += obligations.filter((row) => (
    (new Set(["pending", "leased"]).has(row.state) && Number(row.deadline_at) < expectedEnd)
      || (row.state === "leased" && Number(row.lease_expires_at) < expectedEnd)
  )).length;
  const obligationStateById = new Map(obligations.map((row) => [row.obligation_id, row.state]));
  invariantViolations += commands.filter((row) => new Set(["skipped", "cancelled"])
    .has(obligationStateById.get(row.obligation_id))).length;
  const normalizedBySource = new Map();
  const expectedLifecycleIdBySource = new Map();
  for (const source of sources) {
    const ownedLifecycles = lifecycleBySource.get(source.source_event_id) || [];
    if (source.state === "accepted" ? ownedLifecycles.length !== 1 : ownedLifecycles.length !== 0) {
      invariantViolations += 1;
    }
    if (source.state !== "accepted" && source.state !== "rejected") invariantViolations += 1;
    if (source.source_version !== sourceVersion || source.runtime_version !== runtimeVersion) {
      invariantViolations += 1;
    }
    const identityDigest = await sha256Hex(
      source.provider + "\u0000" + Number(source.identity_version) + "\u0000" + source.identity_key,
    );
    expectedLifecycleIdBySource.set(source.source_event_id, "life_" + identityDigest);
    if (source.provider !== "ghl"
      || Number(source.identity_version) !== 1
      || !/^[a-f0-9]{64}$/.test(String(source.payload_sha256 || ""))
      || source.source_event_id !== "src_" + identityDigest
      || !Number.isSafeInteger(Number(source.occurred_at))
      || !Number.isSafeInteger(Number(source.received_at))
      || !Number.isSafeInteger(Number(source.created_at))
      || Number(source.occurred_at) !== Number(source.received_at)
      || Number(source.created_at) < Number(source.received_at)
      || Number(source.created_at) >= expectedEnd
      || Number(source.normalized_retention_until)
        !== Number(source.received_at) + NORMALIZED_RETENTION_MS
      || Number(source.normalized_retention_until) <= checkedAt) invariantViolations += 1;
    if (source.state === "accepted") {
      const normalized = exactAcceptedNormalized(source);
      normalizedBySource.set(source.source_event_id, normalized);
      const compositeIdentity = normalized
        ? "ghl:appointment-event:v1:" + [
          "ghl",
          normalized.appointmentId, normalized.eventKind, normalized.status,
          normalized.effectiveStart, source.payload_sha256,
        ].join(":") : null;
      if (!normalized
        || source.authentication_result !== "authenticated"
        || source.normalization_state !== "normalized"
        || Number(source.accepted_at) !== Number(source.created_at)
        || source.identity_key !== compositeIdentity) invariantViolations += 1;
    } else if (source.state === "rejected") {
      let normalized = {};
      try {
        const parsed = JSON.parse(source.normalized_json || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) normalized = parsed;
      } catch {
        normalized = {};
      }
      const fallbackIdentity = [
        "ghl", "appointment-event", "v1-rejected",
        normalized.appointmentId || "unknown",
        normalized.eventKind || "unknown",
        normalized.status || "unknown",
        normalized.effectiveStart || "unknown",
        source.payload_sha256,
      ].join(":");
      if (source.identity_key !== fallbackIdentity
        || !new Set(["authenticated", "rejected"]).has(source.authentication_result)
        || !new Set(["ambiguous", "rejected"]).has(source.normalization_state)
        || source.accepted_at !== null) invariantViolations += 1;
    }
    if (!transitionPathIsExact(source, transitionsBySource.get(source.source_event_id) || [])) {
      invariantViolations += 1;
    }
  }
  for (const transition of transitions) {
    const source = sourceById.get(transition.source_event_id);
    if (!source
      || Number(transition.retention_until) !== Number(source.normalized_retention_until)
      || Number(transition.retention_until) <= checkedAt) invariantViolations += 1;
  }
  for (const lifecycle of lifecycles) {
    const source = sourceById.get(lifecycle.source_event_id);
    const workflowRecord = workflowByVersion.get(Number(lifecycle.definition_version));
    const normalized = normalizedBySource.get(lifecycle.source_event_id);
    if (!source
      || !normalized
      || lifecycle.lifecycle_instance_id !== expectedLifecycleIdBySource.get(lifecycle.source_event_id)
      || lifecycle.family !== FOLLOW_UP_FAMILY
      || lifecycle.scope !== "confirmed-normal-follow-up"
      || lifecycle.runtime_version !== source.runtime_version
      || lifecycle.state !== "active"
      || lifecycle.person_id !== normalized?.personId
      || lifecycle.appointment_id !== normalized?.appointmentId
      || Number(lifecycle.retention_until) !== Number(source.normalized_retention_until)
      || Number(lifecycle.retention_until) <= checkedAt
      || Number(lifecycle.created_at) < Number(source.received_at)
      || Number(lifecycle.created_at) !== Number(source.accepted_at)
      || Number(lifecycle.updated_at) < Number(lifecycle.created_at)
      || !workflowRecord
      || !new Set(["published", "retired"]).has(workflowRecord.state)
      || workflowRecord.publishedAt === null
      || workflowRecord.publishedAt > Number(lifecycle.created_at)) {
      invariantViolations += 1;
      continue;
    }
    const enrollment = enroll({
      recognized: true,
      appointmentId: normalized.appointmentId,
      contactId: normalized.personId,
      calendarId: normalized.calendarId,
      type: normalized.status,
      appointmentEventType: normalized.eventKind,
      startAt: normalized.effectiveStart,
      context: { reminderPreference: normalized.reminderPreference },
    }, workflowRecord.flow, Number(source.received_at));
    if (!enrollment) {
      invariantViolations += 1;
      continue;
    }
    const nodeByTemplate = new Map(workflowRecord.document.nodes.map((node) => [node.action.template, node]));
    for (const step of enrollment.steps) {
      try {
        expectedSet.push(await expectedObligation(lifecycle, nodeByTemplate.get(step.template), step));
      } catch {
        invariantViolations += 1;
      }
    }
  }
  expectedSet.sort((left, right) => {
    const leftKey = left.lifecycleInstanceId + "\u0000" + left.obligationKey;
    const rightKey = right.lifecycleInstanceId + "\u0000" + right.obligationKey;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const expectedLookup = new Map(expectedSet.map((item) => [
    item.lifecycleInstanceId + "\u0000" + item.obligationKey, item,
  ]));
  const missingObligations = [...expectedLookup.keys()].filter((key) => !actualByKey.has(key)).length;
  const unexpectedObligations = [...actualByKey.keys()].filter((key) => !expectedLookup.has(key)).length;
  for (const [key, expected] of expectedLookup) {
    const actual = actualByKey.get(key);
    if (!actual) continue;
    const stateValid = expected.initialState === "skipped"
      ? new Set(["skipped", "cancelled"]).has(actual.state)
      : ALLOWED_OBLIGATION_STATES.has(actual.state) && actual.state !== "skipped";
    if (actual.obligation_id !== expected.obligationId
      || actual.kind !== expected.kind
      || actual.family !== expected.family
      || Number(actual.deadline_at) !== expected.deadlineAt
      || actual.owner_role !== expected.ownerRole
      || actual.closer !== expected.closer
      || Number(actual.retention_until)
        !== Number(sourceById.get(lifecycleById.get(actual.lifecycle_instance_id)?.source_event_id)
          ?.normalized_retention_until)
      || Number(actual.retention_until) <= checkedAt
      || Number(actual.created_at)
        !== Number(sourceById.get(lifecycleById.get(actual.lifecycle_instance_id)?.source_event_id)
          ?.accepted_at)
      || Number(actual.updated_at) < Number(actual.created_at)
      || !stateValid) invariantViolations += 1;
  }
  for (const command of commands) {
    const obligation = obligationById.get(command.obligation_id);
    const createdAt = Number(command.created_at);
    if (!obligation
      || !Number.isSafeInteger(createdAt)
      || createdAt < Number(obligation.created_at)
      || Number(command.updated_at) < createdAt
      || Number(command.retention_until) <= checkedAt
      || Number(command.retention_until) > createdAt + NORMALIZED_RETENTION_MS) invariantViolations += 1;
  }
  const exceptionsBySource = new Map();
  for (const exception of exceptions) {
    if (exception.source_event_id) {
      if (!exceptionsBySource.has(exception.source_event_id)) exceptionsBySource.set(exception.source_event_id, []);
      exceptionsBySource.get(exception.source_event_id).push(exception);
    }
    const linkedSources = new Set();
    const linkedSource = exception.source_event_id ? sourceById.get(exception.source_event_id) : null;
    const linkedLifecycle = exception.lifecycle_instance_id
      ? lifecycleById.get(exception.lifecycle_instance_id) : null;
    const linkedObligation = exception.obligation_id ? obligationById.get(exception.obligation_id) : null;
    const obligationLifecycle = linkedObligation
      ? lifecycleById.get(linkedObligation.lifecycle_instance_id) : null;
    if (linkedSource) linkedSources.add(linkedSource.source_event_id);
    if (linkedLifecycle) linkedSources.add(linkedLifecycle.source_event_id);
    if (obligationLifecycle) linkedSources.add(obligationLifecycle.source_event_id);
    const openedAt = Number(exception.opened_at);
    const updatedAt = Number(exception.updated_at);
    if (exception.family !== FOLLOW_UP_FAMILY
      || (!exception.source_event_id && !exception.lifecycle_instance_id && !exception.obligation_id)
      || (exception.source_event_id && !linkedSource)
      || (exception.lifecycle_instance_id && !linkedLifecycle)
      || (exception.obligation_id && !linkedObligation)
      || linkedSources.size !== 1
      || (linkedLifecycle && linkedSource && linkedLifecycle.source_event_id !== linkedSource.source_event_id)
      || (linkedObligation && linkedLifecycle
        && linkedObligation.lifecycle_instance_id !== linkedLifecycle.lifecycle_instance_id)
      || typeof exception.kind !== "string" || !exception.kind
      || !new Set(["info", "warning", "critical"]).has(exception.severity)
      || typeof exception.accountable_owner !== "string" || !exception.accountable_owner
      || typeof exception.next_safe_action !== "string" || !exception.next_safe_action
      || !Number.isSafeInteger(openedAt) || !Number.isSafeInteger(updatedAt)
      || updatedAt < openedAt
      || Number(exception.retention_until) !== openedAt + NORMALIZED_RETENTION_MS
      || Number(exception.retention_until) <= checkedAt
      || (linkedSources.size === 1
        && openedAt < Number(sourceById.get([...linkedSources][0])?.received_at))
      || (exception.state === "suppressed_with_expiry"
        && (!Number.isSafeInteger(Number(exception.suppression_expires_at))
          || Number(exception.suppression_expires_at) <= updatedAt))
      || !(await exceptionEventRouteIsExact(
        exception, exceptionEventsByException.get(exception.exception_id) || [], checkedAt,
      ))) invariantViolations += 1;
  }
  for (const source of sources.filter((row) => row.state === "rejected")) {
    const expectedExceptionId = "exc_" + await sha256Hex(
      source.source_event_id + "\u0000" + source.rejection_reason,
    );
    const sourceExceptions = exceptionsBySource.get(source.source_event_id) || [];
    const exactException = sourceExceptions.find((exception) => (
      exception.exception_id === expectedExceptionId
      && new Set(["follow_up_identity_ambiguous", "follow_up_entry_rejected"]).has(exception.kind)
    ));
    const opened = exactException
      ? (exceptionEventsByException.get(exactException.exception_id) || [])[0]
      : null;
    if (typeof source.rejection_reason !== "string" || !source.rejection_reason
      || !exactException
      || Number(exactException.opened_at) !== Number(source.created_at)
      || Number(exactException.retention_until) !== Number(source.normalized_retention_until)
      || opened?.evidence_sha256 !== source.payload_sha256
      || opened?.detail_json !== canonicalReconciliationJson({ reason: source.rejection_reason })) {
      invariantViolations += 1;
    }
  }
  const acceptedSourceEvents = sources.filter((row) => row.state === "accepted").length;
  const rejectedSourceEvents = sources.filter((row) => row.state === "rejected").length;
  const sourceFacts = await Promise.all(sources.map(async (row) => ({
    sourceEventIdSha256: await sha256Hex(row.source_event_id),
    provider: row.provider,
    providerEventIdSha256: row.provider_event_id ? await sha256Hex(row.provider_event_id) : null,
    identityVersion: Number(row.identity_version),
    identityKeySha256: await sha256Hex(row.identity_key),
    payloadSha256: row.payload_sha256,
    state: row.state,
    sourceVersion: row.source_version,
    runtimeVersion: row.runtime_version,
    authenticationResult: row.authentication_result,
    normalizationState: row.normalization_state,
    normalizedSha256: await sha256Hex(row.normalized_json || ""),
    rejectionReasonSha256: row.rejection_reason ? await sha256Hex(row.rejection_reason) : null,
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
    acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
    createdAt: Number(row.created_at),
    retentionUntil: Number(row.normalized_retention_until),
  })));
  const commandFacts = await Promise.all(commands.map(async (row) => ({
    commandAttemptId: row.command_attempt_id,
    obligationId: row.obligation_id,
    state: row.state,
    targetSha256: await sha256Hex(row.target),
    providerReferenceSha256: row.provider_reference ? await sha256Hex(row.provider_reference) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    retentionUntil: Number(row.retention_until),
  })));
  const lifecycleFacts = await Promise.all(lifecycles.map(async (row) => ({
    lifecycleInstanceIdSha256: await sha256Hex(row.lifecycle_instance_id),
    sourceEventIdSha256: await sha256Hex(row.source_event_id),
    family: row.family,
    scope: row.scope,
    personIdSha256: await sha256Hex(row.person_id),
    appointmentIdSha256: await sha256Hex(row.appointment_id),
    definitionVersion: Number(row.definition_version),
    runtimeVersion: row.runtime_version,
    state: row.state,
    retentionUntil: Number(row.retention_until),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  })));
  const exceptionFacts = await Promise.all(exceptions.map(async (row) => ({
    exceptionIdSha256: await sha256Hex(row.exception_id),
    family: row.family,
    sourceEventIdSha256: row.source_event_id ? await sha256Hex(row.source_event_id) : null,
    lifecycleInstanceIdSha256: row.lifecycle_instance_id
      ? await sha256Hex(row.lifecycle_instance_id) : null,
    obligationIdSha256: row.obligation_id ? await sha256Hex(row.obligation_id) : null,
    kindSha256: await sha256Hex(row.kind),
    severity: row.severity,
    accountableOwnerSha256: await sha256Hex(row.accountable_owner),
    nextSafeActionSha256: await sha256Hex(row.next_safe_action),
    state: row.state,
    suppressionExpiresAt: row.suppression_expires_at === null
      ? null : Number(row.suppression_expires_at),
    retentionUntil: Number(row.retention_until),
    openedAt: Number(row.opened_at),
    updatedAt: Number(row.updated_at),
  })));
  const transitionFacts = await Promise.all(transitions.map(async (row) => ({
    sourceTransitionIdSha256: await sha256Hex(row.source_transition_id),
    sourceEventIdSha256: await sha256Hex(row.source_event_id),
    sequence: Number(row.sequence),
    transition: row.transition,
    occurredAt: Number(row.occurred_at),
    detailSha256: row.detail_json ? await sha256Hex(row.detail_json) : null,
    retentionUntil: Number(row.retention_until),
  })));
  const exceptionEventFacts = await Promise.all(exceptionEvents.map(async (row) => ({
    exceptionEventIdSha256: await sha256Hex(row.exception_event_id),
    exceptionIdSha256: await sha256Hex(row.exception_id),
    eventType: row.event_type,
    actorSha256: await sha256Hex(row.actor),
    occurredAt: Number(row.occurred_at),
    evidenceSha256: row.evidence_sha256,
    detailSha256: row.detail_json ? await sha256Hex(row.detail_json) : null,
    retentionUntil: Number(row.retention_until),
  })));
  const identitySnapshot = {
    sources: sourceFacts,
    transitions: transitionFacts,
    lifecycles: lifecycleFacts,
    obligations: obligations.map((row) => ({
      obligationId: row.obligation_id,
      lifecycleInstanceId: row.lifecycle_instance_id,
      obligationKey: row.obligation_key,
      kind: row.kind,
      family: row.family,
      ownerRole: row.owner_role,
      closer: row.closer,
      state: row.state,
      deadlineAt: Number(row.deadline_at),
      leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
      retentionUntil: Number(row.retention_until),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    })),
    commands: commandFacts,
    exceptions: exceptionFacts,
    exceptionEvents: exceptionEventFacts,
    workflowVersions: await Promise.all(workflows.map(async (row) => ({
      version: Number(row.version),
      state: row.state,
      publishedAt: row.published_at === null ? null : Number(row.published_at),
      documentSha256: await sha256Hex(row.document),
    }))),
    globalOrphans: {
      sourceTransitions: Number(orphanTransitions[0]?.count || 0),
      lifecycles: Number(orphanLifecycles[0]?.count || 0),
      obligations: Number(orphanObligations[0]?.count || 0),
      commandAttempts: Number(orphanCommands[0]?.count || 0),
    },
  };
  const consistent = acceptedSourceEvents + rejectedSourceEvents === sources.length
    && lifecycles.length === acceptedSourceEvents
    && obligations.length === expectedSet.length
    && missingObligations === 0
    && unexpectedObligations === 0
    && Number(orphanTransitions[0]?.count || 0) === 0
    && Number(orphanLifecycles[0]?.count || 0) === 0
    && Number(orphanObligations[0]?.count || 0) === 0
    && Number(orphanCommands[0]?.count || 0) === 0
    && invariantViolations === 0;
  return {
    truth: "Degraded",
    reason: consistent ? "owned_ledger_self_reported_unverified" : "owned_ledger_incomplete",
    readStatus: "complete",
    queryVersion: FOLLOW_UP_OWNED_LEDGER_QUERY_VERSION,
    identityDigest: await digest(identitySnapshot),
    obligationSetDigest: await digest(expectedSet),
    sourceEvents: sources.length,
    sourceTransitions: transitions.length,
    acceptedSourceEvents,
    rejectedSourceEvents,
    lifecycleInstances: lifecycles.length,
    obligations: obligations.length,
    expectedObligations: expectedSet.length,
    missingObligations,
    unexpectedObligations,
    commandAttempts: commands.length,
    openExceptions: exceptions.filter((row) => row.state !== "resolved").length,
    globalOrphanSourceTransitions: Number(orphanTransitions[0]?.count || 0),
    globalOrphanLifecycles: Number(orphanLifecycles[0]?.count || 0),
    globalOrphanObligations: Number(orphanObligations[0]?.count || 0),
    globalOrphanCommandAttempts: Number(orphanCommands[0]?.count || 0),
    invariantViolations,
  };
}

async function runtimeComponent(snapshot, sources, checkedAt, runtimeVersion) {
  const rows = snapshot.runtimeProvenance;
  if (!rows.length) {
    return {
      truth: "Degraded", reason: "runtime_provenance_missing", readStatus: "missing",
      releaseManifestIds: [], deploymentAttestationIds: [], currentDeploymentAttestationId: null,
      attestationExpiresAt: null, attestationFresh: false, sourceBindings: 0,
      distinctRuntimeVersions: sortedUnique(sources.map((row) => row.runtime_version)).length,
      unboundAcceptedSources: sources.filter((row) => row.state === "accepted").length,
      bindingMismatches: 0, runtimeVersionMatch: false, identityDigest: await digest([]),
    };
  }
  const rawReleaseIds = sortedUnique(rows.map((row) => row.release_manifest_id).filter(Boolean));
  const rawAttestationIds = sortedUnique(rows.map((row) => row.deployment_attestation_id).filter(Boolean));
  const invalidIds = rawReleaseIds.filter((id) => !/^relm_[a-f0-9]{64}$/.test(id)).length
    + rawAttestationIds.filter((id) => !/^depatt_[a-f0-9]{64}$/.test(id)).length
    + Number(rawReleaseIds.length > 128) + Number(rawAttestationIds.length > 128);
  const releaseManifestIds = invalidIds ? [] : rawReleaseIds;
  const deploymentAttestationIds = invalidIds ? [] : rawAttestationIds;
  const accepted = sources.filter((row) => row.state === "accepted");
  const boundIds = new Set(rows.map((row) => row.source_event_id));
  const lifecycleBySource = new Map(snapshot.lifecycles.map((row) => [row.source_event_id, row]));
  const sourceById = new Map(sources.map((row) => [row.source_event_id, row]));
  const bindingMismatches = invalidIds + rows.filter((row) => !row.release_manifest_id
    || row.version_id !== row.cloudflare_version_id
    || row.attestation_runtime !== row.manifest_runtime
    || row.lifecycle_instance_id !== lifecycleBySource.get(row.source_event_id)?.lifecycle_instance_id
    || row.workflow_document_sha256_at_bind !== row.workflow_document_sha256
    || row.schema_structure_sha256_at_bind !== row.schema_structure_sha256
    || Number(row.bound_at) < Number(sourceById.get(row.source_event_id)?.accepted_at)
    || Number(row.bound_at) < Number(row.attested_at)
    || Number(row.bound_at) >= Number(row.expires_at)
    || Number(row.manifest_created_at) > Number(row.attested_at)
    || Number(row.attestation_observed_at) > Number(row.attested_at)
    || Number(row.attested_at) > Number(row.recorded_at)
    || Number(row.retention_until) <= checkedAt
    || Number(row.attestation_retention_until) <= checkedAt
    || Number(row.manifest_retention_until) <= checkedAt).length;
  const runtimeVersionMatch = accepted.length > 0
    && accepted.every((row) => row.runtime_version === runtimeVersion)
    && rows.every((row) => row.attestation_runtime === runtimeVersion && row.manifest_runtime === runtimeVersion);
  return {
    truth: "Degraded", reason: "runtime_provenance_incomplete", readStatus: "complete",
    releaseManifestIds,
    deploymentAttestationIds,
    currentDeploymentAttestationId: null,
    attestationExpiresAt: null,
    attestationFresh: false,
    sourceBindings: rows.length,
    distinctRuntimeVersions: sortedUnique(sources.map((row) => row.runtime_version)).length,
    unboundAcceptedSources: accepted.filter((row) => !boundIds.has(row.source_event_id)).length,
    bindingMismatches,
    runtimeVersionMatch,
    identityDigest: await digest(await Promise.all(rows.map(async (row) => ({
      rowSha256: await sha256Hex(canonicalReconciliationJson(row)),
    })))),
  };
}

async function providerComponent(snapshot, owned, expectedStart, expectedEnd, checkedAt) {
  const rows = snapshot.providerReceipts;
  const invalidReceipt = (row) => {
    const obligationCreatedAt = Number(row.obligation_created_at);
    const commandCreatedAt = Number(row.command_created_at);
    const observedAt = Number(row.observed_at);
    const receiptCreatedAt = Number(row.receipt_created_at);
    const receiptRetentionUntil = Number(row.receipt_retention_until);
    return !row.command_attempt_id
      || !Number.isSafeInteger(obligationCreatedAt)
      || !Number.isSafeInteger(commandCreatedAt)
      || !Number.isSafeInteger(observedAt)
      || !Number.isSafeInteger(receiptCreatedAt)
      || commandCreatedAt < obligationCreatedAt
      || observedAt < commandCreatedAt
      || receiptCreatedAt < commandCreatedAt
      || observedAt > receiptCreatedAt
      || observedAt >= expectedEnd
      || receiptCreatedAt >= expectedEnd
      || receiptRetentionUntil <= checkedAt
      || receiptRetentionUntil > receiptCreatedAt + NORMALIZED_RETENTION_MS
      || !/^[a-f0-9]{64}$/.test(String(row.evidence_sha256 || ""))
      || row.provider !== row.command_target
      || !row.command_provider_reference
      || row.receipt_provider_reference !== row.command_provider_reference;
  };
  const effectStates = new Set(["submitted", "accepted", "ambiguous", "reconciled"]);
  const eligible = rows.filter((row) => !new Set(["skipped", "cancelled"]).has(row.obligation_state))
    .filter((row) => row.obligation_state === "satisfied" || effectStates.has(row.command_state));
  const obligationIds = sortedUnique(eligible.map((row) => row.obligation_id));
  const byObligation = new Map(obligationIds.map((id) => [id, []]));
  for (const row of eligible) {
    if (row.proof_level) byObligation.get(row.obligation_id).push(row);
  }
  const classified = {
    acceptedObligations: 0,
    deliveredObligations: 0,
    failedObligations: 0,
    bouncedObligations: 0,
    unknownObligations: 0,
  };
  let coveredObligations = 0;
  let lookupErrors = 0;
  for (const receiptRows of byObligation.values()) {
    const invalidRows = receiptRows.filter(invalidReceipt);
    const levels = new Set(receiptRows.map((row) => row.proof_level));
    if (!levels.size) continue;
    coveredObligations += 1;
    if (invalidRows.length) {
      lookupErrors += invalidRows.length;
      classified.unknownObligations += 1;
      continue;
    }
    const terminal = ["delivered", "bounced", "failed"].filter((level) => levels.has(level));
    if (terminal.length > 1) classified.unknownObligations += 1;
    else if (levels.has("delivered")) classified.deliveredObligations += 1;
    else if (levels.has("bounced")) classified.bouncedObligations += 1;
    else if (levels.has("failed")) classified.failedObligations += 1;
    else if (levels.has("accepted")) classified.acceptedObligations += 1;
    else classified.unknownObligations += 1;
  }
  const expectedReceiptObligations = obligationIds.length;
  return {
    truth: "Degraded",
    reason: "provider_receipt_coverage_missing",
    readStatus: "missing",
    expectedReceiptObligations,
    coveredObligations,
    ...classified,
    zeroDenominatorProven: false,
    lookupErrors,
    // This scans only D1 evidence already recorded by Amari. It is not an
    // independent provider readback and therefore cannot exhaust a provider cursor.
    cursorExhausted: false,
    identityDigest: await digest(await Promise.all(rows
      .map(async (row) => ({
        obligationIdSha256: await sha256Hex(row.obligation_id),
        obligationState: row.obligation_state,
        obligationDeadlineAt: Number(row.deadline_at),
        obligationCreatedAt: Number(row.obligation_created_at),
        commandAttemptIdSha256: row.command_attempt_id
          ? await sha256Hex(row.command_attempt_id) : null,
        commandState: row.command_state,
        commandTargetSha256: row.command_target ? await sha256Hex(row.command_target) : null,
        commandProviderReferenceSha256: row.command_provider_reference
          ? await sha256Hex(row.command_provider_reference) : null,
        commandCreatedAt: row.command_created_at === null ? null : Number(row.command_created_at),
        commandUpdatedAt: row.command_updated_at === null ? null : Number(row.command_updated_at),
        providerReceiptIdSha256: row.provider_receipt_id
          ? await sha256Hex(row.provider_receipt_id) : null,
        provider: row.provider,
        receiptProviderReferenceSha256: row.receipt_provider_reference
          ? await sha256Hex(row.receipt_provider_reference) : null,
        proofLevel: row.proof_level,
        evidenceSha256: row.evidence_sha256,
        observedAt: row.observed_at === null ? null : Number(row.observed_at),
        receiptCreatedAt: row.receipt_created_at === null ? null : Number(row.receipt_created_at),
        receiptRetentionUntil: row.receipt_retention_until === null
          ? null : Number(row.receipt_retention_until),
        eligible: eligible.includes(row),
        invalidReceipt: row.proof_level ? invalidReceipt(row) : false,
      })))),
    obligationSetDigest: owned.obligationSetDigest,
    coverageStart: expectedStart,
    coverageEnd: expectedEnd,
  };
}

function missingGhlCoverage() {
  return {
    truth: "Degraded",
    reason: "ghl_appointment_event_source_coverage_missing",
    readStatus: "missing",
    source: null,
    workflowName: null,
    workflowId: null,
    workflowVersion: null,
    pagesRead: null,
    cursorExhausted: false,
    expectedExecutions: null,
    observedExecutions: null,
    joinedExecutions: null,
    unjoinedExecutions: null,
    identityDigest: null,
    lookupErrors: null,
    accountableOwner: null,
    cadence: null,
    freshnessMs: null,
    observedAt: null,
    coverageStart: null,
    coverageEnd: null,
    limitation: null,
  };
}

function overallFor(components) {
  const reasons = COMPONENT_ORDER.map((key) => components[key])
    .filter((component) => component.truth !== "Known")
    .map((component) => component.reason);
  reasons.push("authority_false", "reconciliation_runtime_not_adopted", "simulation_only");
  return {
    truth: COMPONENT_ORDER.some((key) => components[key].truth === "Unknown") ? "Unknown" : "Degraded",
    reasons: sortedUnique(reasons),
  };
}

export async function collectFollowUpReconciliation({
  db, expectedStart, expectedEnd, startedAt, checkedAt, sourceVersion, runtimeVersion,
  activationWatermark = expectedStart, continuityStart = expectedStart,
}) {
  assertCollectorInput({
    expectedStart, expectedEnd, startedAt, checkedAt, sourceVersion, runtimeVersion,
    activationWatermark, continuityStart,
  });
  if (!db) throw new TypeError("reconciliation database is required");
  const schema = await collectSchemaComponent(db);
  let snapshot = null;
  let snapshotFailure = null;
  try {
    snapshot = await collectLocalSnapshot(db, expectedStart, expectedEnd);
  } catch (error) {
    snapshotFailure = error;
  }
  const readStatus = snapshotFailure ? failureStatus(snapshotFailure) : null;
  const ownedLedger = snapshotFailure
    ? failedOwnedLedger(readStatus)
    : await ownedComponent(snapshot, expectedEnd, checkedAt, sourceVersion, runtimeVersion);
  const runtimeProvenance = snapshotFailure
    ? failedRuntimeProvenance(readStatus)
    : await runtimeComponent(snapshot, snapshot.sources, checkedAt, runtimeVersion);
  const providerReceipts = snapshotFailure
    ? failedProviderReceipts(readStatus)
    : await providerComponent(snapshot, ownedLedger, expectedStart, expectedEnd, checkedAt);
  const components = {
    schema,
    ownedLedger,
    runtimeProvenance,
    ghlAppointmentEventSourceCoverage: missingGhlCoverage(),
    providerReceipts,
  };
  const unsigned = {
    contractVersion: FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION,
    runKind: FOLLOW_UP_RECONCILIATION_RUN_KIND,
    family: FOLLOW_UP_FAMILY,
    sourceVersion,
    runtimeVersion,
    startedAt,
    checkedAt,
    simulation: true,
    authority: false,
    producerAdopted: false,
    evidenceScope: FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE,
    window: {
      expectedStart,
      expectedEnd,
      coverageStart: expectedStart,
      coverageEnd: snapshotFailure ? expectedStart : expectedEnd,
      // This is only the completeness of the single local D1 batch. GHL and
      // provider cursor truth stays inside the named components.
      paginationComplete: !snapshotFailure,
      sampleRate: 1,
      activationWatermark,
      continuityStart,
    },
    components,
    overall: overallFor(components),
  };
  const detail = await addFollowUpReconciliationDigest(unsigned);
  const detailJson = canonicalReconciliationJson(detail);
  const validation = await validateFollowUpReconciliationDetail(detailJson);
  if (!validation.valid) throw new Error("collected reconciliation detail failed contract: " + validation.reason);
  return { detail, detailJson };
}

const ROW_FIELDS = [
  "reconciliation_run_id", "family", "authority", "source_version", "runtime_version",
  "started_at", "completed_at", "expected_start", "expected_end", "coverage_start",
  "coverage_end", "pagination_complete", "state", "detail_json", "retention_until",
];

function rowFor(detail, detailJson) {
  return {
    reconciliation_run_id: followUpReconciliationRunId(detail.detailDigestSha256),
    family: detail.family,
    authority: "SOURCE_ONLY_SELF_REPORTED",
    source_version: detail.sourceVersion,
    runtime_version: detail.runtimeVersion,
    started_at: detail.startedAt,
    completed_at: detail.checkedAt,
    expected_start: detail.window.expectedStart,
    expected_end: detail.window.expectedEnd,
    coverage_start: detail.window.coverageStart,
    coverage_end: detail.window.coverageEnd,
    pagination_complete: Number(detail.window.paginationComplete),
    state: "degraded",
    detail_json: detailJson,
    retention_until: detail.startedAt + NORMALIZED_RETENTION_MS,
  };
}

function exactRow(existing, expected) {
  return ROW_FIELDS.every((key) => {
    if (typeof expected[key] === "number") return Number(existing?.[key]) === expected[key];
    return existing?.[key] === expected[key];
  });
}

export class FollowUpReconciliationConflict extends Error {
  constructor(message) {
    super(message);
    this.name = "FollowUpReconciliationConflict";
    this.code = "follow_up_reconciliation_conflict";
  }
}

export async function writeFollowUpReconciliationRun(db, collected) {
  if (!db) throw new TypeError("reconciliation database is required");
  const detail = collected?.detail;
  const detailJson = collected?.detailJson;
  const record = rowFor(detail, detailJson);
  const validation = await validateFollowUpReconciliationDetail(detailJson, record);
  if (!validation.valid) throw new TypeError("reconciliation row rejected: " + validation.reason);
  const existing = await db.prepare(
    "SELECT * FROM reconciliation_runs WHERE reconciliation_run_id = ?",
  ).bind(record.reconciliation_run_id).first();
  if (existing) {
    if (exactRow(existing, record)) return { created: false, replayed: true, row: record };
    throw new FollowUpReconciliationConflict("deterministic reconciliation identity has different bytes");
  }
  const statement = db.prepare(
    "INSERT INTO reconciliation_runs (reconciliation_run_id,family,authority,source_version,runtime_version,started_at,completed_at,expected_start,expected_end,coverage_start,coverage_end,pagination_complete,state,detail_json,retention_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(...ROW_FIELDS.map((key) => record[key]));
  try {
    const result = await statement.run();
    if (Number(result?.meta?.changes || 0) !== 1) throw new Error("reconciliation insert did not write exactly one row");
    const persisted = await db.prepare(
      "SELECT * FROM reconciliation_runs WHERE reconciliation_run_id = ?",
    ).bind(record.reconciliation_run_id).first();
    if (!persisted || !exactRow(persisted, record)) {
      throw new FollowUpReconciliationConflict("inserted reconciliation bytes did not read back exactly");
    }
    return { created: true, replayed: false, row: record };
  } catch (error) {
    const raced = await db.prepare(
      "SELECT * FROM reconciliation_runs WHERE reconciliation_run_id = ?",
    ).bind(record.reconciliation_run_id).first();
    if (raced && exactRow(raced, record)) return { created: false, replayed: true, row: record };
    if (raced) throw new FollowUpReconciliationConflict("concurrent reconciliation identity has different bytes");
    throw error;
  }
}

export async function runFollowUpReconciliationSourceOnly({ env = {}, db, input }) {
  if (!releaseEnabled(env)) return { enabled: false, created: false, replayed: false };
  const collected = await collectFollowUpReconciliation({ db, ...input });
  const stored = await writeFollowUpReconciliationRun(db, collected);
  return { enabled: true, detail: collected.detail, ...stored };
}
