// Unimported source-only candidate. No credentials, network, dispatch, or schema adoption.
// D1 batch owns transactions; trigger-side assertions own rollback, never post-reads.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_FAMILY } from "./reliability-contract.js";

export const FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT = "follow-up-effect-evidence-journal.v1";
const FLAGS = Object.freeze({ sourceOnly: true, simulation: true, authority: false, dispatchAllowed: false,
  outcomeProven: false, replacementAllowed: false, watermarkAdvanceAllowed: false, provenanceScope: "stored_structural_links_only" });
const CLOCK = "(CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const HEX = /^[a-f0-9]{64}$/;
const TEXT = /^[A-Za-z0-9:+_.@/=-]{1,200}$/;
const PREPARE = ["commandAttemptId", "sourceEventId", "lifecycleInstanceId", "obligationId", "workflowId", "workflowVersion", "workflowDocumentSha256", "nodeId", "acceptanceDeploymentAttestationId", "executorDeploymentAttestationId", "executorRuntimeVersion", "leaseEventId", "provider", "providerAccountScope", "idempotencyKey", "attemptNumber", "retryClass", "target", "requestSha256", "renderedCopySha256", "eventId", "occurrenceAt", "detailSha256", "retentionUntil"];
const OBSERVATION = ["commandAttemptId", "eventId", "expectedSequence", "fromState", "toState", "providerReference", "errorCode", "occurrenceAt", "detailSha256"];
const RECEIPT = ["commandAttemptId", "eventId", "providerReceiptId", "provider", "providerAccountScope", "providerReference", "proofLevel", "evidenceSha256", "observedAt", "detailSha256"];
const EVENT_FIELDS = ["sequence", "event_id", "command_attempt_id", "event_type", "event_digest_sha256", "previous_sequence", "state_before", "state_after", "occurrence_at", "observed_at", "ingested_at", "provider", "provider_account_scope", "provider_reference", "provider_receipt_id", "proof_level", "evidence_sha256", "detail_sha256", "error_code", "is_conflict", "retention_until", "source_event_id", "lifecycle_instance_id", "obligation_id", "binding_valid", "receipt_valid", "conflict_known"];
const TRANSITIONS = Object.freeze({ prepared: ["submitted", "ambiguous", "failed_retryable", "failed_terminal"],
  submitted: ["ambiguous", "failed_retryable", "failed_terminal"], failed_retryable: ["ambiguous", "failed_terminal"], ambiguous: ["failed_terminal"] });
const SAFE = new Set(["invalid_input", "database_unavailable", "invalid_database_result", "workflow_mismatch", "attempt_unbound", "identity_conflict", "projection_mismatch", "unbound_cursor", "boundary_mismatch", "invalid_cursor", "effect_binding_conflict", "effect_binding_invalid", "effect_event_conflict", "effect_database_clock_required", "effect_stale_sequence", "effect_prepared_event_invalid", "effect_prepared_event_missing", "effect_projection_stale", "effect_live_fence_missing", "effect_receipt_unlinked", "effect_receipt_ownership_conflict", "effect_receipt_identity_conflict", "effect_receipt_conflict_flag_invalid", "effect_nonmonotonic_sequence", "effect_receipt_projection_failed"]);

function stop(code) { throw new Error(code); }
function data(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 12000 || depth > 12) stop("invalid_input");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) stop("invalid_input"); return; }
  if (typeof value === "string") { if (value.length > 131072) stop("invalid_input"); return; }
  if (!value || typeof value !== "object") stop("invalid_input");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) stop("invalid_input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && value.length > 1000) stop("invalid_input");
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    const d = descriptors[key];
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value") || (array && !/^(0|[1-9][0-9]*)$/.test(key))) stop("invalid_input");
    data(d.value, depth + 1, budget);
  }
  if (array && Object.keys(descriptors).length !== value.length + 1) stop("invalid_input");
}
function shape(value, fields) {
  data(value);
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).sort().join() !== [...fields].sort().join()) stop("invalid_input");
}
function text(value) { if (typeof value !== "string" || !TEXT.test(value)) stop("invalid_input"); }
function digest(value) { if (typeof value !== "string" || !HEX.test(value)) stop("invalid_input"); }
function time(value, positive = false) { if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) stop("invalid_input"); }
function nullable(value, check) { if (value !== null) check(value); }
function statement(db, sql, ...params) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") stop("database_unavailable");
  return db.prepare(sql).bind(...params);
}
async function batch(db, statements) {
  const result = await db.batch(statements);
  if (!Array.isArray(result) || Object.getPrototypeOf(result) !== Array.prototype || result.length !== statements.length) stop("invalid_database_result");
  const slots = Object.getOwnPropertyDescriptors(result);
  if (Reflect.ownKeys(slots).length !== statements.length + 1) stop("invalid_database_result");
  const rows = [];
  for (let i = 0; i < statements.length; i++) {
    const slot = slots[String(i)];
    if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value")) stop("invalid_database_result");
    const item = slot.value;
    if (!item || Object.getPrototypeOf(item) !== Object.prototype) stop("invalid_database_result");
    const d = Object.getOwnPropertyDescriptors(item);
    if (d.success?.value !== true || !Array.isArray(d.results?.value)) stop("invalid_database_result");
    data(d.results.value); // Fractional transport metadata is deliberately not assertion data.
    if (d.results.value.some((row) => !row || Array.isArray(row) || typeof row !== "object")) stop("invalid_database_result");
    rows.push(d.results.value);
  }
  return rows;
}
function reason(error) {
  const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
  if (typeof message === "string") {
    if (SAFE.has(message)) return message;
    const code = message.match(/\beffect_[a-z_]+\b/)?.[0];
    if (SAFE.has(code)) return code;
  }
  return "storage_unavailable_or_conflict";
}
function refused(error) {
  return Object.freeze({ contract: FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, ...FLAGS, status: "refused", durable: false,
    reasonCodes: Object.freeze([reason(error)]), sequence: null, ingestedAt: null });
}

// Canonical tables are mutable projections. Every read/replay must compare them
// to the immutable binding and latest journal state, not just an ID or row count.
const IDENTITY = `c.command_attempt_id = b.command_attempt_id AND c.obligation_id = b.obligation_id
  AND c.idempotency_key = b.idempotency_key AND c.attempt_number = b.attempt_number AND c.retry_class = b.retry_class
  AND c.target = b.target AND c.request_sha256 = b.request_sha256 AND c.rendered_copy_sha256 IS b.rendered_copy_sha256
  AND c.retention_until = b.retention_until AND c.created_at = b.command_created_at
  AND c.updated_at = COALESCE((SELECT p.ingested_at FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = b.command_attempt_id
    AND p.event_type = 'observation' ORDER BY p.sequence DESC LIMIT 1),b.command_created_at)
  AND EXISTS (SELECT 1 FROM lifecycle_obligations o JOIN lifecycle_instances l ON l.lifecycle_instance_id = o.lifecycle_instance_id
    JOIN source_events s ON s.source_event_id = l.source_event_id
    WHERE o.obligation_id = b.obligation_id AND l.lifecycle_instance_id = b.lifecycle_instance_id AND s.source_event_id = b.source_event_id
      AND o.family = b.workflow_id AND l.family = b.workflow_id AND s.family = b.workflow_id AND o.obligation_key = b.node_id
      AND b.retention_until <= MIN(o.retention_until,l.retention_until,s.normalized_retention_until))
  AND b.retention_until > ${CLOCK}
  AND EXISTS (SELECT 1 FROM source_event_runtime_provenance p
    JOIN obligation_lease_events le ON le.lease_event_id = b.lease_event_id
    JOIN automation_deployment_attestations a ON a.deployment_attestation_id = b.acceptance_deployment_attestation_id
    JOIN automation_deployment_attestations x ON x.deployment_attestation_id = b.executor_deployment_attestation_id
    JOIN automation_release_manifests am ON am.release_manifest_id = b.acceptance_release_manifest_id
    JOIN automation_release_manifests xm ON xm.release_manifest_id = b.executor_release_manifest_id
    WHERE p.source_event_id = b.source_event_id AND p.lifecycle_instance_id = b.lifecycle_instance_id
      AND p.deployment_attestation_id = a.deployment_attestation_id AND p.workflow_document_sha256_at_bind = b.workflow_document_sha256
      AND le.obligation_id = b.obligation_id AND le.new_owner = b.lease_owner AND le.lease_acquired_at = b.lease_acquired_at AND le.lease_expires_at = b.lease_expires_at
      AND a.release_manifest_id = am.release_manifest_id AND x.release_manifest_id = xm.release_manifest_id
      AND am.compiled_plan_digest = b.acceptance_compiled_plan_digest AND am.handler_registry_digest = b.acceptance_handler_registry_digest
      AND xm.compiled_plan_digest = b.executor_compiled_plan_digest AND xm.handler_registry_digest = b.executor_handler_registry_digest
      AND am.workflow_document_sha256 = b.workflow_document_sha256 AND xm.workflow_document_sha256 = b.workflow_document_sha256
      AND b.retention_until <= MIN(p.retention_until,le.retention_until,a.retention_until,x.retention_until,am.retention_until,xm.retention_until))
  AND c.state = (SELECT p.state_after FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = b.command_attempt_id
    AND p.event_type IN ('prepared','observation') ORDER BY p.sequence DESC LIMIT 1)
  AND c.provider_reference IS (SELECT p.provider_reference FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = b.command_attempt_id
    AND p.event_type = 'observation' AND p.provider_reference IS NOT NULL ORDER BY p.sequence DESC LIMIT 1)
  AND c.error_code IS (SELECT p.error_code FROM follow_up_effect_evidence_events p WHERE p.command_attempt_id = b.command_attempt_id
    AND p.event_type = 'observation' ORDER BY p.sequence DESC LIMIT 1)`;
const EVENT_SELECT = `SELECT e.*,b.source_event_id,b.lifecycle_instance_id,b.obligation_id,
  CASE WHEN ${IDENTITY} AND e.retention_until = b.retention_until AND e.retention_until > ${CLOCK} THEN 1 ELSE 0 END binding_valid,
  CASE WHEN e.event_type <> 'receipt' OR EXISTS (SELECT 1 FROM provider_receipts r
    WHERE r.provider_receipt_id = e.provider_receipt_id AND r.command_attempt_id = e.command_attempt_id
      AND r.provider = e.provider AND r.provider_reference = e.provider_reference AND r.proof_level = e.proof_level
      AND r.evidence_sha256 = e.evidence_sha256 AND r.observed_at = e.observed_at
      AND r.created_at = e.ingested_at AND r.retention_until = e.retention_until) THEN 1 ELSE 0 END receipt_valid,
  CASE WHEN e.is_conflict = 1 OR EXISTS (SELECT 1 FROM follow_up_effect_evidence_events conflict
    WHERE conflict.event_type = 'receipt' AND conflict.provider = e.provider AND conflict.provider_account_scope = e.provider_account_scope
      AND conflict.provider_reference = e.provider_reference AND conflict.is_conflict = 1) THEN 1 ELSE 0 END conflict_known
  FROM follow_up_effect_evidence_events e LEFT JOIN follow_up_effect_attempt_bindings b ON b.command_attempt_id = e.command_attempt_id
  LEFT JOIN command_attempts c ON c.command_attempt_id = b.command_attempt_id`;
function checkedEvent(row) {
  shape(row, EVENT_FIELDS);
  if (row.binding_valid !== 1 || row.receipt_valid !== 1) stop("projection_mismatch");
  for (const key of ["event_id", "command_attempt_id", "source_event_id", "lifecycle_instance_id", "obligation_id"]) text(row[key]);
  for (const key of ["provider_reference", "provider_receipt_id", "provider_account_scope", "error_code"]) nullable(row[key], text);
  digest(row.event_digest_sha256); digest(row.detail_sha256); nullable(row.evidence_sha256, digest);
  time(row.sequence, true); time(row.previous_sequence); time(row.occurrence_at); time(row.ingested_at); time(row.retention_until);
  nullable(row.observed_at, time);
  if (![0, 1].includes(row.is_conflict) || ![0, 1].includes(row.conflict_known) || row.is_conflict > row.conflict_known
    || row.previous_sequence >= row.sequence || row.occurrence_at > row.ingested_at
    || row.retention_until <= row.ingested_at || row.retention_until > row.ingested_at + 34560000000) stop("invalid_database_result");
  if (row.event_type === "prepared") {
    if (row.previous_sequence !== 0 || row.state_before !== null || row.state_after !== "prepared" || row.observed_at !== null
      || [row.provider, row.provider_account_scope, row.provider_reference, row.provider_receipt_id, row.proof_level, row.evidence_sha256, row.error_code].some((value) => value !== null)
      || row.is_conflict !== 0 || row.conflict_known !== 0) stop("invalid_database_result");
  } else if (row.event_type === "observation") {
    if (row.previous_sequence === 0 || typeof row.state_before !== "string" || !Object.hasOwn(TRANSITIONS, row.state_before)
      || !TRANSITIONS[row.state_before].includes(row.state_after) || row.observed_at !== null
      || [row.provider, row.provider_account_scope, row.provider_receipt_id, row.proof_level, row.evidence_sha256].some((value) => value !== null)
      || row.is_conflict !== 0 || row.conflict_known !== 0) stop("invalid_database_result");
  } else if (row.event_type === "receipt") {
    if (row.previous_sequence === 0 || row.state_before !== null || row.state_after !== null || row.error_code !== null
      || !["gmail", "ghl"].includes(row.provider) || !["accepted", "delivered", "failed", "bounced", "unknown"].includes(row.proof_level)
      || row.observed_at !== row.occurrence_at || row.provider_reference === null || row.provider_account_scope === null
      || row.provider_receipt_id === null || row.evidence_sha256 === null) stop("invalid_database_result");
  } else stop("invalid_database_result");
  return row;
}
async function eventById(db, eventId) {
  const [rows] = await batch(db, [statement(db, `${EVENT_SELECT} WHERE e.event_id = ?`, eventId)]);
  if (rows.length > 1) stop("invalid_database_result");
  return rows.length ? checkedEvent(rows[0]) : null;
}
function matched(row, input, inputDigest, kind) {
  if (row.command_attempt_id !== input.commandAttemptId || row.event_type !== kind || row.event_digest_sha256 !== inputDigest) stop("identity_conflict");
  return row;
}
function success(row, status) {
  checkedEvent(row);
  return Object.freeze({ contract: FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, ...FLAGS, status, durable: true,
    sequence: row.sequence, ingestedAt: row.ingested_at, conflict: row.conflict_known === 1,
    reasonCodes: Object.freeze(row.conflict_known === 1 ? ["conflicting_receipt_evidence"] : []) });
}
async function recoverReplay(db, input, inputDigest, kind, error) {
  try {
    const existing = await eventById(db, input.eventId);
    if (existing) return success(matched(existing, input, inputDigest, kind), "replayed");
  } catch (readError) { return refused(readError); }
  return refused(error);
}

export async function prepareFollowUpEffectAttempt(db, input) {
  let inputDigest;
  try {
    shape(input, PREPARE);
    for (const key of PREPARE.filter((key) => !["workflowVersion", "attemptNumber", "occurrenceAt", "retentionUntil", "renderedCopySha256"].includes(key))) text(input[key]);
    for (const key of ["workflowDocumentSha256", "requestSha256", "detailSha256"]) digest(input[key]);
    nullable(input.renderedCopySha256, digest);
    time(input.workflowVersion, true); time(input.attemptNumber, true); time(input.occurrenceAt); time(input.retentionUntil, true);
    if (input.workflowId !== FOLLOW_UP_FAMILY || !["gmail", "ghl"].includes(input.provider)
      || !["provider_idempotent", "amari_reconcile", "manual_ambiguous"].includes(input.retryClass)) stop("invalid_input");
    inputDigest = await sha256(canonicalJson(input));
    const existing = await eventById(db, input.eventId);
    if (existing) return success(matched(existing, input, inputDigest, "prepared"), "replayed");
    const [attempts, workflows] = await batch(db, [
      statement(db, "SELECT command_attempt_id FROM command_attempts WHERE command_attempt_id = ?", input.commandAttemptId),
      statement(db, "SELECT document FROM workflow_versions WHERE workflow_id = ? AND version = ? AND state = 'published'", input.workflowId, input.workflowVersion),
    ]);
    if (attempts.length) stop("attempt_unbound");
    if (workflows.length !== 1 || typeof workflows[0].document !== "string" || workflows[0].document.length > 131072) stop("workflow_mismatch");
    const documentText = workflows[0].document;
    let document;
    try { document = JSON.parse(documentText); data(document); } catch { stop("workflow_mismatch"); }
    if (await sha256(canonicalJson(document)) !== input.workflowDocumentSha256) stop("workflow_mismatch");
    const command = statement(db, `INSERT INTO command_attempts
      (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,state,retention_until,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'prepared',?,${CLOCK},${CLOCK})`,
    input.commandAttemptId, input.obligationId, input.idempotencyKey, input.attemptNumber, input.retryClass, input.target, input.requestSha256, input.renderedCopySha256, input.retentionUntil);
    const binding = statement(db, `INSERT INTO follow_up_effect_attempt_bindings
      (command_attempt_id,source_event_id,lifecycle_instance_id,obligation_id,workflow_id,workflow_version,workflow_document_sha256,node_id,
       acceptance_deployment_attestation_id,acceptance_release_manifest_id,acceptance_compiled_plan_digest,acceptance_handler_registry_digest,
       executor_deployment_attestation_id,executor_release_manifest_id,executor_compiled_plan_digest,executor_handler_registry_digest,executor_runtime_version,
       lease_event_id,lease_owner,lease_acquired_at,lease_expires_at,provider,provider_account_scope,idempotency_key,attempt_number,retry_class,target,
       request_sha256,rendered_copy_sha256,prepared_event_id,prepare_request_sha256,retention_until,command_created_at)
      SELECT ?,?,?,?,?,?,?,?,a.deployment_attestation_id,a.release_manifest_id,am.compiled_plan_digest,am.handler_registry_digest,
        x.deployment_attestation_id,x.release_manifest_id,xm.compiled_plan_digest,xm.handler_registry_digest,?,
        le.lease_event_id,le.new_owner,le.lease_acquired_at,le.lease_expires_at,?,?,?,?,?,?,?,?,?,?,?,c.created_at
      FROM automation_deployment_attestations a JOIN automation_release_manifests am ON am.release_manifest_id = a.release_manifest_id
      JOIN automation_deployment_attestations x ON x.deployment_attestation_id = ? JOIN automation_release_manifests xm ON xm.release_manifest_id = x.release_manifest_id
      JOIN obligation_lease_events le ON le.lease_event_id = ?
      JOIN command_attempts c ON c.command_attempt_id = ?
      JOIN workflow_versions w ON w.workflow_id = ? AND w.version = ? AND w.document = ? AND w.state = 'published'
      WHERE a.deployment_attestation_id = ?`,
    input.commandAttemptId, input.sourceEventId, input.lifecycleInstanceId, input.obligationId, input.workflowId, input.workflowVersion, input.workflowDocumentSha256, input.nodeId,
    input.executorRuntimeVersion, input.provider, input.providerAccountScope, input.idempotencyKey, input.attemptNumber, input.retryClass, input.target,
    input.requestSha256, input.renderedCopySha256, input.eventId, inputDigest, input.retentionUntil,
    input.executorDeploymentAttestationId, input.leaseEventId, input.commandAttemptId, input.workflowId, input.workflowVersion, documentText, input.acceptanceDeploymentAttestationId);
    // The scalar retention lookup yields NULL when a guarded binding insert did
    // not happen. NOT NULL aborts the whole batch, including the command insert.
    const event = statement(db, `INSERT INTO follow_up_effect_evidence_events
      (event_id,command_attempt_id,event_type,event_digest_sha256,previous_sequence,state_after,occurrence_at,detail_sha256,retention_until)
      VALUES(?,?,'prepared',?,0,'prepared',?,?,(SELECT retention_until FROM follow_up_effect_attempt_bindings WHERE command_attempt_id = ?))`,
    input.eventId, input.commandAttemptId, inputDigest, input.occurrenceAt, input.detailSha256, input.commandAttemptId);
    const results = await batch(db, [command, binding, event, statement(db, `${EVENT_SELECT} WHERE e.event_id = ?`, input.eventId)]);
    if (results[3].length !== 1) stop("invalid_database_result");
    return success(matched(checkedEvent(results[3][0]), input, inputDigest, "prepared"), "prepared");
  } catch (error) {
    return inputDigest ? recoverReplay(db, input, inputDigest, "prepared", error) : refused(error);
  }
}

export async function appendFollowUpEffectObservation(db, input) {
  let inputDigest;
  try {
    shape(input, OBSERVATION);
    for (const key of ["commandAttemptId", "eventId", "fromState", "toState"]) text(input[key]);
    nullable(input.providerReference, text); nullable(input.errorCode, text);
    time(input.expectedSequence, true); time(input.occurrenceAt); digest(input.detailSha256);
    if (!Object.hasOwn(TRANSITIONS, input.fromState) || !TRANSITIONS[input.fromState].includes(input.toState)) stop("invalid_input");
    inputDigest = await sha256(canonicalJson(input));
    const prior = await eventById(db, input.eventId);
    if (prior) return success(matched(prior, input, inputDigest, "observation"), "replayed");
    const [latest] = await batch(db, [statement(db, `${EVENT_SELECT} WHERE e.command_attempt_id = ? ORDER BY e.sequence DESC LIMIT 1`, input.commandAttemptId)]);
    if (latest.length !== 1) stop("attempt_unbound");
    checkedEvent(latest[0]);
    const event = statement(db, `INSERT INTO follow_up_effect_evidence_events
      (event_id,command_attempt_id,event_type,event_digest_sha256,previous_sequence,state_before,state_after,occurrence_at,provider_reference,error_code,detail_sha256,retention_until)
      VALUES(?,?,'observation',?,?,?,?,?,?,?,?,(SELECT retention_until FROM follow_up_effect_attempt_bindings WHERE command_attempt_id = ?))`,
    input.eventId, input.commandAttemptId, inputDigest, input.expectedSequence, input.fromState, input.toState,
    input.occurrenceAt, input.providerReference, input.errorCode, input.detailSha256, input.commandAttemptId);
    const [, rows] = await batch(db, [event, statement(db, `${EVENT_SELECT} WHERE e.event_id = ?`, input.eventId)]);
    if (rows.length !== 1) stop("invalid_database_result");
    return success(matched(checkedEvent(rows[0]), input, inputDigest, "observation"), "recorded");
  } catch (error) {
    return inputDigest ? recoverReplay(db, input, inputDigest, "observation", error) : refused(error);
  }
}

export async function recordFollowUpEffectReceipt(db, input) {
  let inputDigest;
  try {
    shape(input, RECEIPT);
    for (const key of ["commandAttemptId", "eventId", "providerReceiptId", "provider", "providerAccountScope", "providerReference"]) text(input[key]);
    if (!["gmail", "ghl"].includes(input.provider) || !["accepted", "delivered", "failed", "bounced", "unknown"].includes(input.proofLevel)) stop("invalid_input");
    time(input.observedAt); digest(input.evidenceSha256); digest(input.detailSha256);
    inputDigest = await sha256(canonicalJson(input));
    const prior = await eventById(db, input.eventId);
    if (prior) return success(matched(prior, input, inputDigest, "receipt"), "replayed");
    const [latest] = await batch(db, [statement(db, `${EVENT_SELECT} WHERE e.command_attempt_id = ? ORDER BY e.sequence DESC LIMIT 1`, input.commandAttemptId)]);
    if (latest.length !== 1) stop("effect_receipt_unlinked");
    checkedEvent(latest[0]);
    // The journal trigger performs the canonical receipt insert in the same
    // transaction. A uniqueness/ownership failure rolls the journal back too.
    const event = statement(db, `INSERT INTO follow_up_effect_evidence_events
      (event_id,command_attempt_id,event_type,event_digest_sha256,previous_sequence,occurrence_at,observed_at,provider,provider_account_scope,
       provider_reference,provider_receipt_id,proof_level,evidence_sha256,detail_sha256,is_conflict,retention_until)
      VALUES(?,?,'receipt',?,(SELECT COALESCE(MAX(sequence),0) FROM follow_up_effect_evidence_events WHERE command_attempt_id = ?),
        ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM provider_receipts r WHERE r.provider = ? AND r.provider_reference = ?
          AND ((r.proof_level = ? AND r.evidence_sha256 <> ?) OR (r.proof_level = 'delivered' AND ? IN ('failed','bounced'))
            OR (? = 'delivered' AND r.proof_level IN ('failed','bounced')))) THEN 1 ELSE 0 END,
        (SELECT retention_until FROM follow_up_effect_attempt_bindings WHERE command_attempt_id = ?))`,
    input.eventId, input.commandAttemptId, inputDigest, input.commandAttemptId, input.observedAt, input.observedAt,
    input.provider, input.providerAccountScope, input.providerReference, input.providerReceiptId, input.proofLevel,
    input.evidenceSha256, input.detailSha256, input.provider, input.providerReference, input.proofLevel, input.evidenceSha256,
    input.proofLevel, input.proofLevel, input.commandAttemptId);
    const [, rows] = await batch(db, [event, statement(db, `${EVENT_SELECT} WHERE e.event_id = ?`, input.eventId)]);
    if (rows.length !== 1) stop("invalid_database_result");
    const row = matched(checkedEvent(rows[0]), input, inputDigest, "receipt");
    return success(row, row.conflict_known === 1 ? "recorded_conflict" : "recorded");
  } catch (error) {
    return inputDigest ? recoverReplay(db, input, inputDigest, "receipt", error) : refused(error);
  }
}

async function boundaryFor(row) {
  return Object.freeze({ contract: FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, throughSequence: row?.sequence ?? 0,
    eventIdSha256: row ? await sha256(row.event_id) : null, eventDigestSha256: row?.event_digest_sha256 ?? null });
}
async function publicRow(row) {
  checkedEvent(row);
  const ownedId = async (id) => { text(id); return `id_${await sha256(id)}`; };
  return Object.freeze({ sequence: row.sequence, previousSequence: row.previous_sequence,
    eventId: await ownedId(row.event_id), commandAttemptId: await ownedId(row.command_attempt_id),
    sourceEventId: await ownedId(row.source_event_id), lifecycleInstanceId: await ownedId(row.lifecycle_instance_id), obligationId: await ownedId(row.obligation_id),
    family: FOLLOW_UP_FAMILY, eventType: row.event_type, eventDigestSha256: row.event_digest_sha256,
    stateBefore: row.state_before, stateAfter: row.state_after, occurrenceAt: row.occurrence_at, observedAt: row.observed_at, ingestedAt: row.ingested_at,
    provider: row.provider, providerReferenceSha256: row.provider_reference === null ? null : await sha256(row.provider_reference),
    proofLevel: row.proof_level, evidenceSha256: row.evidence_sha256, detailSha256: row.detail_sha256,
    conflict: row.is_conflict === 1, retentionUntil: row.retention_until });
}

export async function readFollowUpEffectEvidenceJournal(db, options = {}) {
  try {
    data(options);
    if (!options || Array.isArray(options) || typeof options !== "object"
      || Object.keys(options).some((key) => !["afterSequence", "throughSequence", "limit", "boundary"].includes(key))) stop("invalid_input");
    const { afterSequence = 0, throughSequence = null, limit = 50, boundary = null } = options;
    time(afterSequence); nullable(throughSequence, time); time(limit, true);
    if (limit > 200 || (throughSequence !== null && afterSequence > throughSequence)) stop("invalid_cursor");
    if ((throughSequence !== null && boundary === null) || (throughSequence === null && afterSequence !== 0)) stop("unbound_cursor");
    if (boundary !== null) {
      shape(boundary, ["contract", "throughSequence", "eventIdSha256", "eventDigestSha256"]);
      time(boundary.throughSequence); nullable(boundary.eventIdSha256, digest); nullable(boundary.eventDigestSha256, digest);
      if (boundary.contract !== FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT || boundary.throughSequence !== throughSequence) stop("boundary_mismatch");
    }
    // The root H and its first page share ONE D1 batch snapshot. Subsequent
    // batches verify the immutable boundary and an actual (not gap) cursor row.
    const queries = throughSequence === null ? [
      statement(db, `${EVENT_SELECT} ORDER BY e.sequence DESC LIMIT 1`),
      statement(db, `${EVENT_SELECT} WHERE e.sequence > 0 AND e.sequence <= (SELECT COALESCE(MAX(sequence),0) FROM follow_up_effect_evidence_events) ORDER BY e.sequence LIMIT ?`, limit + 1),
    ] : [
      statement(db, `${EVENT_SELECT} WHERE e.sequence = ?`, throughSequence),
      statement(db, `${EVENT_SELECT} WHERE e.sequence > ? AND e.sequence <= ? ORDER BY e.sequence LIMIT ?`, afterSequence, throughSequence, limit + 1),
      statement(db, `${EVENT_SELECT} WHERE e.sequence = ?`, afterSequence),
    ];
    const [head, rows, afterRows] = await batch(db, queries);
    if (head.length > 1 || (throughSequence !== null && throughSequence > 0 && head.length !== 1)) stop("boundary_mismatch");
    if (head.length) checkedEvent(head[0]);
    const frozen = await boundaryFor(head[0]);
    if (boundary !== null && canonicalJson(boundary) !== canonicalJson(frozen)) stop("boundary_mismatch");
    const high = frozen.throughSequence;
    if (afterSequence > high) stop("invalid_cursor");
    if (afterRows && (afterRows.length > 1 || (afterSequence > 0 && (afterRows.length !== 1 || afterRows[0].sequence !== afterSequence)))) stop("invalid_cursor");
    if (afterRows?.length) checkedEvent(afterRows[0]);
    if (rows.length > limit + 1) stop("invalid_database_result");
    let previous = afterSequence;
    for (const row of rows) {
      checkedEvent(row);
      if (row.sequence <= previous || row.sequence > high) stop("invalid_database_result");
      previous = row.sequence;
    }
    const hasMore = rows.length > limit;
    const returned = rows.slice(0, limit);
    const nextSequence = returned.length ? returned.at(-1).sequence : afterSequence;
    if (!hasMore && afterSequence < high && nextSequence !== high) stop("boundary_mismatch");
    return Object.freeze({ contract: FOLLOW_UP_EFFECT_EVIDENCE_CONTRACT, ...FLAGS, status: "observed", durable: false,
      scope: "journal_sequence_traversal_only", afterSequence, throughSequence: high, boundary: frozen,
      rows: Object.freeze(await Promise.all(returned.map(publicRow))), nextSequence, hasMore, traversalComplete: !hasMore,
      continuation: hasMore ? Object.freeze({ afterSequence: nextSequence, throughSequence: high, boundary: frozen }) : null,
      reasonCodes: Object.freeze([]) });
  } catch (error) { return refused(error); }
}
