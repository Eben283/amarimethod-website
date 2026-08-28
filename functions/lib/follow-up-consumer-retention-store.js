// UNIMPORTED source-only observer candidate. No D1 installation, runtime owner,
// provider action, purge, closure or authenticated coverage is adopted here.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_FAMILY } from "./reliability-contract.js";
import { observeFollowUpCurrentInventory } from "./follow-up-current-inventory.js";

export const FOLLOW_UP_CONSUMER_RETENTION_CONTRACT = "follow-up-consumer-retention.v1";
export const FOLLOW_UP_CONSUMER_READ_CONTRACT = "follow-up-checkpoint-aware-journal-read.v1";
const CONTRACT = FOLLOW_UP_CONSUMER_RETENTION_CONTRACT, JOURNAL = "follow-up-effect-evidence-journal.v1";
const FLAGS = { sourceOnly: true, simulation: true, retainPreviousCarryForward: true, authority: false, authoritativeCoverage: false,
  producerAdopted: false, dispatchAllowed: false, outcomeProven: false, replacementAllowed: false, watermarkAdvanceAllowed: false,
  provenanceScope: "stored_structural_links_only", coherentRollbackDetectable: false, externalRestoreWitness: "absent" };
const CLOCK = "(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const VIEW = "follow_up_consumer_journal_v1", CP = "follow_up_consumer_checkpoints", MEMBERS = "follow_up_consumer_retained_reasons";
const HEX = /^[a-f0-9]{64}$/, ID = /^id_[a-f0-9]{64}$/, KEY = /^[A-Za-z0-9:_.-]{1,200}$/;
const KINDS = ["source", "lifecycle", "obligation", "exception", "evidence", "anomaly"];
const REASONS = ["new_source", "unresolved_lifecycle", "unresolved_obligation", "open_exception", "carry_forward", "late_linked_evidence",
  "terminal_anomaly", "retention_expired", "missing_parent", "unsupported_terminal_state", "candidate_missing", "sequenced_evidence", "journal_linked_parent", "conflicting_receipt_evidence"];
const SAFE = new Set(["invalid_input", "invalid_carry", "database_unavailable", "invalid_database_result", "inventory_unavailable", "inventory_changed",
  "inventory_evidence_gap", "input_limit_exceeded", "consumer_checkpoint_conflict", "consumer_checkpoint_stale", "consumer_operation_conflict",
  "consumer_retention_gap", "consumer_source_changed", "consumer_boundary_conflict", "consumer_payload_invalid", "consumer_reason_invalid",
  "consumer_reason_conflict", "checkpoint_mismatch", "journal_evidence_gap", "invalid_cursor", "write_outcome_unknown", "storage_unavailable"]);
const CP_FIELDS = ["checkpoint_id", "consumer_key", "generation", "previous_checkpoint_id", "previous_checkpoint_digest", "operation_id", "operation_digest",
  "operation_kind", "operation_page", "operation_complete", "prefix_sequence", "prefix_event_id_sha256", "prefix_event_digest", "window_high_sequence",
  "window_event_id_sha256", "window_event_digest", "window_complete", "prefix_digest", "evidence_valid_until", "cumulative_member_count",
  "payload_json", "payload_digest", "checkpoint_digest", "created_at"];
const RAW_FIELDS = ["sequence", "previous_sequence", "event_id", "command_attempt_id", "source_event_id", "lifecycle_instance_id", "obligation_id",
  "event_type", "event_digest_sha256", "state_before", "state_after", "occurrence_at", "observed_at", "ingested_at", "provider", "provider_account_scope",
  "provider_reference", "provider_receipt_id", "proof_level", "evidence_sha256", "detail_sha256", "error_code", "is_conflict", "retention_until"];
const CUTOFF_FIELDS = ["receivedStart", "receivedEnd", "ingestedStart", "ingestedEnd", "plannedAt", "maxPages", "maxCandidates"];
const TRANSITIONS = { prepared: ["submitted", "ambiguous", "failed_retryable", "failed_terminal"], submitted: ["ambiguous", "failed_retryable", "failed_terminal"], failed_retryable: ["ambiguous", "failed_terminal"], ambiguous: ["failed_terminal"] };
const COLUMNS = [
  ["source_event_id", "family", "received_at", "normalized_retention_until"],
  ["lifecycle_instance_id", "source_event_id", "family", "state", "retention_until"],
  ["obligation_id", "lifecycle_instance_id", "family", "state", "deadline_at", "retention_until"],
  ["exception_id", "family", "source_event_id", "lifecycle_instance_id", "obligation_id", "state", "retention_until"],
];
const F = `'${FOLLOW_UP_FAMILY}'`;
const jsonColumns = (fields, alias) => fields.map((f) => `'${f}',${alias}.${f}`).join(",");
// These are actual SELECTs, not a proxy that rewrites the frozen inventory reader.
const INVENTORY_SQL = [
  "SELECT json_object('table_name',m.name,'column_name',p.name,'column_type',p.type) row_json FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name IN ('source_events','lifecycle_instances','lifecycle_obligations','lifecycle_exceptions') ORDER BY m.name,p.cid",
  `SELECT json_object(${jsonColumns(COLUMNS[0], "s")}) row_json FROM source_events s WHERE s.family=${F} ORDER BY s.source_event_id LIMIT $LIMIT`,
  `SELECT json_object(${jsonColumns(COLUMNS[1], "l")}) row_json FROM lifecycle_instances l LEFT JOIN source_events s ON s.source_event_id=l.source_event_id WHERE l.family=${F} OR s.family=${F} ORDER BY l.lifecycle_instance_id LIMIT $LIMIT`,
  `SELECT json_object(${jsonColumns(COLUMNS[2], "o")}) row_json FROM lifecycle_obligations o LEFT JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id WHERE o.family=${F} OR l.family=${F} ORDER BY o.obligation_id LIMIT $LIMIT`,
  `SELECT json_object(${jsonColumns(COLUMNS[3], "x")}) row_json FROM lifecycle_exceptions x LEFT JOIN source_events s ON s.source_event_id=x.source_event_id LEFT JOIN lifecycle_instances l ON l.lifecycle_instance_id=x.lifecycle_instance_id LEFT JOIN lifecycle_obligations o ON o.obligation_id=x.obligation_id WHERE x.family=${F} OR s.family=${F} OR l.family=${F} OR o.family=${F} ORDER BY x.exception_id LIMIT $LIMIT`,
];

function stop(code) { throw new Error(code); }
function exact(v, fields, code = "invalid_input") { if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== [...fields].sort().join()) stop(code); }
function int(v, min = 0, max = Number.MAX_SAFE_INTEGER, code = "invalid_input") { if (!Number.isSafeInteger(v) || v < min || v > max) stop(code); }
function hash(v, code = "invalid_database_result") { if (typeof v !== "string" || !HEX.test(v)) stop(code); }
function key(v) { if (typeof v !== "string" || !KEY.test(v)) stop("invalid_input"); }
function owned(v, code = "invalid_carry") { if (typeof v !== "string" || !ID.test(v)) stop(code); }
function freeze(v) { if (v && typeof v === "object") { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; }
function copy(v, code = "invalid_input", depth = 0, budget = { n: 0 }, maxString = 512) {
  if (++budget.n > 100000 || depth > 14) stop(code);
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) stop(code); return v; }
  if (typeof v === "string") { if (v.length > maxString) stop(code); return v; }
  if (!v || typeof v !== "object") stop(code);
  const array = Array.isArray(v); if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) stop(code);
  const d = Object.getOwnPropertyDescriptors(v), length = array ? d.length.value : null, entries = [];
  if ((array && length > 10000) || (!array && Reflect.ownKeys(d).length > 100)) stop(code);
  for (const k of Reflect.ownKeys(d)) {
    if (array && k === "length") continue;
    if (typeof k !== "string" || !d[k].enumerable || !Object.hasOwn(d[k], "value") || (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))) stop(code);
    entries.push([k, copy(d[k].value, code, depth + 1, budget, maxString)]);
  }
  if (!array) return Object.fromEntries(entries);
  if (entries.length !== length) stop(code);
  const out = new Array(length); for (const [k, x] of entries) out[Number(k)] = x; return out;
}
function candidates(items, code = "invalid_carry") {
  if (!Array.isArray(items) || items.length > 200) stop(code);
  for (const c of items) {
    exact(c, ["candidateId", "family", "kind", "identity", "reasonCodes", "unresolved"], code); owned(c.identity, code);
    if (!KINDS.includes(c.kind) || c.family !== FOLLOW_UP_FAMILY || c.candidateId !== `${c.kind}:${c.identity}` || c.unresolved !== true
      || !Array.isArray(c.reasonCodes) || !c.reasonCodes.length || c.reasonCodes.length > REASONS.length || c.reasonCodes.some((r) => !REASONS.includes(r))) stop(code);
  }
}
function carry(input) { const v = copy(input, "invalid_carry"); exact(v, ["candidates", "cursor"], "invalid_carry"); if (v.cursor !== null) stop("invalid_carry"); candidates(v.candidates); return freeze(v); }
function statement(db, sql, ...params) {
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") stop("database_unavailable");
  if (params.length > 100 || new TextEncoder().encode(sql).length > 100000) stop("invalid_input");
  return db.prepare(sql).bind(...params);
}
async function batch(db, statements) {
  const output = await db.batch(statements);
  if (!Array.isArray(output) || Object.getPrototypeOf(output) !== Array.prototype || output.length !== statements.length) stop("invalid_database_result");
  const d = Object.getOwnPropertyDescriptors(output); if (Reflect.ownKeys(d).length !== output.length + 1) stop("invalid_database_result");
  return statements.map((_, i) => {
    const slot = d[String(i)]; if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value")) stop("invalid_database_result");
    if (!slot.value || Object.getPrototypeOf(slot.value) !== Object.prototype) stop("invalid_database_result");
    const fields = Object.getOwnPropertyDescriptors(slot.value);
    if (fields.success?.value !== true || !Array.isArray(fields.results?.value)) stop("invalid_database_result");
    const rows = copy(fields.results.value, "invalid_database_result", 0, { n: 0 }, 1500000);
    if (rows.some((r) => !r || Array.isArray(r) || typeof r !== "object")) stop("invalid_database_result");
    return rows;
  });
}
function reason(error) {
  try { const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
    if (SAFE.has(message)) return message;
    const code = typeof message === "string" ? message.match(/\bconsumer_[a-z_]+\b/)?.[0] : null; if (SAFE.has(code)) return code;
  } catch { /* Never reflect an untrusted exception. */ }
  return "storage_unavailable";
}
function envelope(extra) { return freeze({ contract: CONTRACT, ...FLAGS, family: FOLLOW_UP_FAMILY, scope: "durable_structural_observer_only",
  inventoryCoverage: "bounded_current_observation_only", restoreDetection: "internal_mismatch_only", ...extra }); }
function refusal(error, prior = null, uncertain = false) { return envelope({ status: "refused", durable: uncertain ? null : false,
  checkpoint: null, candidates: [], continuation: null, retainedPriorCarryForward: prior, reasonCodes: [uncertain ? "write_outcome_unknown" : reason(error)] }); }
function core(row) { return Object.fromEntries(CP_FIELDS.filter((k) => !["checkpoint_id", "checkpoint_digest", "created_at"].includes(k)).map((k) => [k, row[k]])); }
function memberList(items) {
  const members = new Map();
  for (const c of items) for (const r of c.reasonCodes) {
    if (!REASONS.includes(r)) stop("invalid_carry");
    members.set(`${c.candidateId}:${r}`, { candidateId: c.candidateId, kind: c.kind, identity: c.identity, reasonCode: r });
  }
  if (members.size > 2800) stop("input_limit_exceeded");
  return [...members.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, v]) => v);
}
async function checkedCheckpoint(row) {
  exact(row, CP_FIELDS, "invalid_database_result"); key(row.consumer_key); key(row.operation_id);
  for (const k of ["generation", "operation_page", "prefix_sequence", "window_high_sequence", "cumulative_member_count", "created_at"]) int(row[k], k === "generation" ? 1 : 0, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  for (const k of ["operation_digest", "prefix_digest", "payload_digest", "checkpoint_digest"]) hash(row[k]);
  for (const k of ["previous_checkpoint_digest", "prefix_event_id_sha256", "prefix_event_digest", "window_event_id_sha256", "window_event_digest"]) if (row[k] !== null) hash(row[k]);
  if (!["inputs", "journal"].includes(row.operation_kind) || row.operation_page > 19 || ![0, 1].includes(row.window_complete)
    || ![0, 1].includes(row.operation_complete) || row.prefix_sequence > row.window_high_sequence || row.window_complete !== Number(row.prefix_sequence === row.window_high_sequence)
    || (row.prefix_sequence === 0 ? row.prefix_event_id_sha256 !== null || row.prefix_event_digest !== null : row.prefix_event_id_sha256 === null || row.prefix_event_digest === null)
    || (row.window_high_sequence === 0 ? row.window_event_id_sha256 !== null || row.window_event_digest !== null : row.window_event_id_sha256 === null || row.window_event_digest === null)
    || (row.generation === 1 ? row.previous_checkpoint_id !== null || row.previous_checkpoint_digest !== null
      : typeof row.previous_checkpoint_id !== "string" || !/^ckp_[a-f0-9]{64}$/.test(row.previous_checkpoint_id) || row.previous_checkpoint_digest === null)) stop("checkpoint_mismatch");
  if (row.evidence_valid_until !== null) int(row.evidence_valid_until, 1, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  if (typeof row.payload_json !== "string" || row.payload_json.length > 1500000 || await sha256(row.payload_json) !== row.payload_digest) stop("checkpoint_mismatch");
  const payload = copy(JSON.parse(row.payload_json), "invalid_database_result");
  exact(payload, ["contract", "inventorySnapshotDigest", "carryDigest", "rows", "members"], "invalid_database_result");
  if (payload.contract !== CONTRACT || !Array.isArray(payload.rows) || payload.rows.length > 200 || !Array.isArray(payload.members) || payload.members.length > 2800) stop("checkpoint_mismatch");
  for (const m of payload.members) {
    exact(m, ["candidateId", "kind", "identity", "reasonCode"], "invalid_database_result"); owned(m.identity, "invalid_database_result");
    if (!KINDS.includes(m.kind) || m.candidateId !== `${m.kind}:${m.identity}` || !REASONS.includes(m.reasonCode)) stop("checkpoint_mismatch");
  }
  if (canonicalJson(payload) !== row.payload_json || await sha256(canonicalJson(core(row))) !== row.checkpoint_digest || row.checkpoint_id !== `ckp_${row.checkpoint_digest}`) stop("checkpoint_mismatch");
  return row;
}
// Complete SQL integrity scans return bounded scalars. They do not claim a
// bounded total scan cost or detect a coherent rollback without a witness.
const STORED_STATE_SQL = `WITH scope(consumer_key,generation,prefix_sequence) AS(VALUES(?,?,?))
  SELECT (SELECT COUNT(*) FROM ${CP} p,scope s WHERE p.consumer_key=s.consumer_key AND p.generation<=s.generation) checkpoint_count,
    (SELECT COUNT(*) FROM ${MEMBERS} r,scope s WHERE r.consumer_key=s.consumer_key AND r.generation<=s.generation) member_count,
    ${CLOCK} now_ms,
    NOT EXISTS(SELECT 1 FROM ${CP} p,scope s LEFT JOIN ${CP} q ON q.consumer_key=p.consumer_key AND q.generation=p.generation-1
      WHERE p.consumer_key=s.consumer_key AND p.generation<=s.generation AND (
        (p.generation=1 AND (p.previous_checkpoint_id IS NOT NULL OR p.previous_checkpoint_digest IS NOT NULL))
        OR (p.generation>1 AND (q.checkpoint_id IS NULL OR p.previous_checkpoint_id IS NOT q.checkpoint_id OR p.previous_checkpoint_digest IS NOT q.checkpoint_digest))
        OR p.cumulative_member_count<>COALESCE(q.cumulative_member_count,0)+json_array_length(p.payload_json,'$.members')
        OR (SELECT COUNT(*) FROM ${MEMBERS} r WHERE r.checkpoint_id=p.checkpoint_id)<>json_array_length(p.payload_json,'$.members')))
    AND NOT EXISTS(SELECT 1 FROM ${MEMBERS} r,scope s LEFT JOIN ${CP} p ON p.checkpoint_id=r.checkpoint_id
      WHERE ((r.consumer_key=s.consumer_key AND r.generation<=s.generation) OR (p.consumer_key=s.consumer_key AND p.generation<=s.generation))
        AND (p.checkpoint_id IS NULL OR r.consumer_key<>p.consumer_key OR r.generation<>p.generation
          OR NOT EXISTS(SELECT 1 FROM json_each(p.payload_json,'$.members') m WHERE m.key=r.member_index
            AND json_extract(m.value,'$.candidateId')=r.candidate_id AND json_extract(m.value,'$.kind')=r.kind
            AND json_extract(m.value,'$.identity')=r.identity AND json_extract(m.value,'$.reasonCode')=r.reason_code))) storage_valid,
    (SELECT COUNT(*) FROM follow_up_effect_evidence_events e,scope s WHERE e.sequence<=s.prefix_sequence)
      =COALESCE((SELECT SUM(json_array_length(p.payload_json,'$.rows')) FROM ${CP} p,scope s WHERE p.consumer_key=s.consumer_key AND p.generation<=s.generation),0)
    AND NOT EXISTS(SELECT 1 FROM ${CP} p,scope s JOIN json_each(p.payload_json,'$.rows') r LEFT JOIN ${VIEW} e ON e.sequence=json_extract(r.value,'$.sequence')
      WHERE p.consumer_key=s.consumer_key AND p.generation<=s.generation AND (e.sequence IS NULL OR e.valid<>1 OR e.event_digest_sha256<>json_extract(r.value,'$.eventDigestSha256'))) prefix_valid`;
function stateStatement(db, row) { return statement(db, STORED_STATE_SQL, row.consumer_key, row.generation, row.prefix_sequence); }
function checkedState(rows, row) {
  if (rows.length !== 1) stop("invalid_database_result");
  const r = rows[0]; exact(r, ["checkpoint_count", "member_count", "now_ms", "storage_valid", "prefix_valid"], "invalid_database_result");
  for (const k of ["checkpoint_count", "member_count", "now_ms"]) int(r[k], 0, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  if (![0, 1].includes(r.storage_valid) || ![0, 1].includes(r.prefix_valid)) stop("invalid_database_result");
  if (r.checkpoint_count !== row.generation || r.member_count !== row.cumulative_member_count || r.storage_valid !== 1) stop("consumer_retention_gap");
  return r;
}
async function loadHead(db, consumerKey) {
  const [rows] = await batch(db, [statement(db, `SELECT * FROM ${CP} WHERE consumer_key=? ORDER BY generation DESC LIMIT 1`, consumerKey)]);
  if (rows.length > 1) stop("invalid_database_result"); if (!rows.length) return null;
  const row = await checkedCheckpoint(rows[0]); if (row.operation_complete !== 1) stop("consumer_operation_conflict");
  const [states] = await batch(db, [stateStatement(db, row)]), state = checkedState(states, row);
  if (state.prefix_valid !== 1) stop("consumer_retention_gap"); return row;
}
async function operation(db, input, digest) {
  const [rows] = await batch(db, [statement(db, `SELECT * FROM ${CP} WHERE consumer_key=? AND operation_id=? ORDER BY operation_page LIMIT 21`, input.consumerKey, input.operationId)]);
  if (rows.length > 20) stop("consumer_operation_conflict");
  for (let i = 0; i < rows.length; i++) {
    await checkedCheckpoint(rows[i]);
    if (rows[i].operation_digest !== digest || rows[i].operation_page !== i || rows[i].operation_complete !== Number(i === rows.length - 1)
      || (i > 0 && rows[i].previous_checkpoint_id !== rows[i - 1].checkpoint_id)) stop("consumer_operation_conflict");
  }
  if (rows.length) { const [states] = await batch(db, [stateStatement(db, rows.at(-1))]); checkedState(states, rows.at(-1)); }
  return rows;
}
async function publicCheckpoint(row) { return { checkpointId: row.checkpoint_id, checkpointDigestSha256: row.checkpoint_digest,
  consumerId: `id_${await sha256(row.consumer_key)}`, generation: row.generation, createdAt: row.created_at,
  prefix: { contract: JOURNAL, throughSequence: row.prefix_sequence, eventIdSha256: row.prefix_event_id_sha256, eventDigestSha256: row.prefix_event_digest },
  boundary: { contract: JOURNAL, throughSequence: row.window_high_sequence, eventIdSha256: row.window_event_id_sha256, eventDigestSha256: row.window_event_digest },
  prefixDigestSha256: row.prefix_digest, recordedWindowComplete: row.window_complete === 1, evidenceValidUntil: row.evidence_valid_until,
  retainedReasonCount: row.cumulative_member_count }; }
async function success(rows, status, prior = null) {
  const last = rows.at(-1); if (!last) stop("consumer_source_changed");
  return envelope({ status, durable: true, pagesCommitted: rows.length, checkpoint: await publicCheckpoint(last),
    retainedPriorCarryForward: prior, reasonCodes: ["no_authenticated_coverage", "no_external_restore_witness"] });
}
function rawRow(row, allowGap = false) {
  exact(row, ["sequence", "event_id", "event_digest_sha256", "retention_until", "valid", "row_json"], "invalid_database_result");
  if (![0, 1].includes(row.valid) || (!allowGap && row.valid !== 1)) stop("journal_evidence_gap");
  if (typeof row.row_json !== "string" || row.row_json.length > 16000) stop("invalid_database_result");
  const r = copy(JSON.parse(row.row_json), "invalid_database_result"); exact(r, RAW_FIELDS, "invalid_database_result");
  for (const k of ["event_id", "command_attempt_id", "source_event_id", "lifecycle_instance_id", "obligation_id"])
    if (typeof r[k] !== "string" || !/^[A-Za-z0-9:+_.@/=-]{1,200}$/.test(r[k])) stop("invalid_database_result");
  for (const k of ["provider_account_scope", "provider_reference", "provider_receipt_id", "error_code"]) if (r[k] !== null && (typeof r[k] !== "string" || !/^[A-Za-z0-9:+_.@/=-]{1,200}$/.test(r[k]))) stop("invalid_database_result");
  for (const k of ["event_digest_sha256", "detail_sha256"]) hash(r[k]); if (r.evidence_sha256 !== null) hash(r.evidence_sha256);
  int(r.sequence, 1, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  for (const k of ["previous_sequence", "occurrence_at", "ingested_at", "retention_until"]) int(r[k], 0, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  if (r.observed_at !== null) int(r.observed_at, 0, Number.MAX_SAFE_INTEGER, "invalid_database_result");
  if (r.sequence !== row.sequence || r.event_id !== row.event_id || r.event_digest_sha256 !== row.event_digest_sha256 || r.retention_until !== row.retention_until
    || r.previous_sequence >= r.sequence || r.occurrence_at > r.ingested_at || r.retention_until <= r.ingested_at || r.retention_until > r.ingested_at + 34560000000 || ![0, 1].includes(r.is_conflict)) stop("invalid_database_result");
  if (r.event_type === "prepared") {
    if (r.previous_sequence !== 0 || r.state_before !== null || r.state_after !== "prepared" || r.is_conflict !== 0
      || [r.observed_at, r.provider, r.provider_reference, r.provider_account_scope, r.provider_receipt_id, r.proof_level, r.evidence_sha256, r.error_code].some((v) => v !== null)) stop("invalid_database_result");
  } else if (r.event_type === "observation") {
    if (r.previous_sequence === 0 || !Object.hasOwn(TRANSITIONS, r.state_before) || !TRANSITIONS[r.state_before].includes(r.state_after) || r.is_conflict !== 0
      || [r.observed_at, r.provider, r.provider_account_scope, r.provider_receipt_id, r.proof_level, r.evidence_sha256].some((v) => v !== null)) stop("invalid_database_result");
  } else if (r.event_type === "receipt") {
    if (r.previous_sequence === 0 || r.state_before !== null || r.state_after !== null || r.error_code !== null || !["gmail", "ghl"].includes(r.provider)
      || !["accepted", "delivered", "failed", "bounced", "unknown"].includes(r.proof_level) || r.observed_at !== r.occurrence_at
      || [r.provider_reference, r.provider_account_scope, r.provider_receipt_id, r.evidence_sha256].some((v) => v === null)) stop("invalid_database_result");
  } else stop("invalid_database_result");
  return r;
}
async function projection(row) {
  const r = rawRow(row), ids = await Promise.all([r.event_id, r.command_attempt_id, r.source_event_id, r.lifecycle_instance_id, r.obligation_id].map(async (x) => `id_${await sha256(x)}`));
  return { sequence: r.sequence, previousSequence: r.previous_sequence, eventId: ids[0], commandAttemptId: ids[1], sourceEventId: ids[2], lifecycleInstanceId: ids[3], obligationId: ids[4],
    family: FOLLOW_UP_FAMILY, eventType: r.event_type, eventDigestSha256: r.event_digest_sha256, stateBefore: r.state_before, stateAfter: r.state_after,
    occurrenceAt: r.occurrence_at, observedAt: r.observed_at, ingestedAt: r.ingested_at, provider: r.provider,
    providerReferenceSha256: r.provider_reference === null ? null : await sha256(r.provider_reference), proofLevel: r.proof_level,
    evidenceSha256: r.evidence_sha256, detailSha256: r.detail_sha256, conflict: r.is_conflict === 1, retentionUntil: r.retention_until };
}
async function anchor(rows, expectedSequence, expectedId, expectedDigest, allowGap = false) {
  if (!rows.length) { if (expectedSequence > 0) stop("consumer_boundary_conflict"); return { sequence: 0, id: null, digest: null, until: null, valid: true }; }
  if (rows.length !== 1) stop("invalid_database_result"); const r = rawRow(rows[0], allowGap), identity = await sha256(r.event_id);
  if (expectedSequence !== null && (r.sequence !== expectedSequence || identity !== expectedId || r.event_digest_sha256 !== expectedDigest)) stop("consumer_boundary_conflict");
  return { sequence: r.sequence, id: identity, digest: r.event_digest_sha256, until: r.retention_until, valid: rows[0].valid === 1 };
}
const minimum = (...v) => { const values = v.flat().filter((x) => x !== null); return values.length ? Math.min(...values) : null; };
async function readPage(db, previous, limit) {
  const after = previous?.prefix_sequence ?? 0, fixed = previous && !previous.window_complete ? previous.window_high_sequence : null;
  const highSql = fixed === null ? "(SELECT COALESCE(MAX(sequence),0) FROM follow_up_effect_evidence_events)" : String(fixed);
  const [head, before, page, clocks] = await batch(db, [statement(db, `SELECT * FROM ${VIEW} WHERE sequence=${highSql}`),
    statement(db, `SELECT * FROM ${VIEW} WHERE sequence=?`, after),
    statement(db, `SELECT * FROM ${VIEW} WHERE sequence>? AND sequence<=${highSql} ORDER BY sequence LIMIT ?`, after, limit + 1),
    statement(db, `SELECT ${CLOCK} now_ms`)]);
  const h = await anchor(head, fixed, fixed === null ? null : previous.window_event_id_sha256, fixed === null ? null : previous.window_event_digest);
  await anchor(before, after, previous?.prefix_event_id_sha256 ?? null, previous?.prefix_event_digest ?? null);
  if (clocks.length !== 1) stop("invalid_database_result"); exact(clocks[0], ["now_ms"], "invalid_database_result"); int(clocks[0].now_ms);
  if (previous?.evidence_valid_until !== null && previous?.evidence_valid_until !== undefined && previous.evidence_valid_until <= clocks[0].now_ms) stop("consumer_retention_gap");
  if (page.length > limit + 1 || after > h.sequence) stop("consumer_boundary_conflict");
  let last = after; for (const row of page) { rawRow(row); if (row.sequence <= last || row.sequence > h.sequence) stop("consumer_boundary_conflict"); last = row.sequence; }
  const selected = page.slice(0, limit), hasMore = page.length > limit;
  const end = selected.length ? selected.at(-1) : before[0];
  if (!hasMore && (end?.sequence ?? 0) !== h.sequence) stop("consumer_boundary_conflict");
  return { rows: await Promise.all(selected.map(projection)), h, end: end ? await anchor([end], null, null, null) : h, hasMore,
    until: minimum(previous?.evidence_valid_until ?? null, head.map((r) => r.retention_until), before.map((r) => r.retention_until), page.map((r) => r.retention_until)),
    proof: { kind: "journal", after, high: h.sequence, limit, page, head, before } };
}

// A single insert gates all membership writes. Exact raw row/anchor snapshots
// travel only as transient parameters. SQL does NOT pretend to compute SHA256.
const pageMatch = (path, condition) => `NOT EXISTS(SELECT 1 FROM json_each(proof.data,'$.${path}') p LEFT JOIN ${VIEW} e ON e.sequence=json_extract(p.value,'$.sequence') WHERE e.sequence IS NULL OR e.valid<>1 OR e.row_json IS NOT json_extract(p.value,'$.row_json')) AND (SELECT COUNT(*) FROM ${VIEW} e WHERE ${condition})=json_array_length(proof.data,'$.${path}')`;
const INVENTORY_MATCH = INVENTORY_SQL.map((sql, i) => `json_extract(proof.data,'$.inventory[${i}]') IS (SELECT COALESCE(json_group_array(row_json),'[]') FROM (${sql.replace("$LIMIT", "json_extract(proof.data,'$.inventoryLimit')+1")}))`).join(" AND ");
const JOURNAL_MATCH = `${pageMatch("head", "e.sequence=json_extract(proof.data,'$.high')")} AND ${pageMatch("before", "e.sequence=json_extract(proof.data,'$.after')")}
  AND NOT EXISTS(SELECT 1 FROM json_each(proof.data,'$.page') p LEFT JOIN ${VIEW} e ON e.sequence=json_extract(p.value,'$.sequence')
    WHERE e.sequence IS NULL OR e.valid<>1 OR e.row_json IS NOT json_extract(p.value,'$.row_json'))
  AND (SELECT COUNT(*) FROM (SELECT sequence FROM ${VIEW} WHERE sequence>json_extract(proof.data,'$.after') AND sequence<=json_extract(proof.data,'$.high') ORDER BY sequence LIMIT json_extract(proof.data,'$.limit')+1))=json_array_length(proof.data,'$.page')
  AND NOT EXISTS(SELECT sequence FROM (SELECT sequence FROM ${VIEW} WHERE sequence>json_extract(proof.data,'$.after') AND sequence<=json_extract(proof.data,'$.high') ORDER BY sequence LIMIT json_extract(proof.data,'$.limit')+1)
    EXCEPT SELECT json_extract(value,'$.sequence') FROM json_each(proof.data,'$.page'))`;
function insertStatement(db, row, proof) {
  const fields = CP_FIELDS.filter((k) => k !== "created_at");
  const proofMatches = `(json_extract(proof.data,'$.kind')='journal' AND ${JOURNAL_MATCH}) OR
    (json_extract(proof.data,'$.kind')='inputs' AND json_extract(proof.data,'$.readAt')<=${CLOCK} AND ${INVENTORY_MATCH})`
    .replaceAll("proof.data", "(SELECT data FROM proof)"); // LIMIT cannot reference an outer query column.
  // Always attempt one row. A proof miss produces a NOT NULL violation INSIDE
  // the transaction, rolling back earlier pages too; never a zero-row success.
  return statement(db, `WITH proof(data) AS (VALUES(?)) INSERT INTO ${CP}(${fields.join(",")})
    SELECT CASE WHEN ${proofMatches} THEN ? ELSE NULL END,${fields.slice(1).map(() => "?").join(",")} FROM proof`, JSON.stringify(proof), ...fields.map((k) => row[k]));
}
async function makeCheckpoint(input, operationDigest, previous, pageIndex, complete, values, payload) {
  const row = { checkpoint_id: null, consumer_key: input.consumerKey, generation: (previous?.generation ?? 0) + 1,
    previous_checkpoint_id: previous?.checkpoint_id ?? null, previous_checkpoint_digest: previous?.checkpoint_digest ?? null,
    operation_id: input.operationId, operation_digest: operationDigest, operation_kind: values.kind, operation_page: pageIndex, operation_complete: Number(complete),
    prefix_sequence: values.end.sequence, prefix_event_id_sha256: values.end.id, prefix_event_digest: values.end.digest,
    window_high_sequence: values.h.sequence, window_event_id_sha256: values.h.id, window_event_digest: values.h.digest,
    window_complete: Number(values.end.sequence === values.h.sequence), prefix_digest: values.prefixDigest,
    evidence_valid_until: values.until, cumulative_member_count: (previous?.cumulative_member_count ?? 0) + payload.members.length,
    payload_json: canonicalJson(payload), payload_digest: null, checkpoint_digest: null };
  if (new TextEncoder().encode(row.payload_json).length > 1500000) stop("input_limit_exceeded");
  row.payload_digest = await sha256(row.payload_json); row.checkpoint_digest = await sha256(canonicalJson(core(row))); row.checkpoint_id = `ckp_${row.checkpoint_digest}`;
  return row;
}
async function commit(db, input, digest, plans) {
  const results = await batch(db, [...plans.map((p) => insertStatement(db, p.row, p.proof)), statement(db, `SELECT * FROM ${CP} WHERE consumer_key=? AND operation_id=? ORDER BY operation_page`, input.consumerKey, input.operationId)]);
  const rows = results.at(-1); if (rows.length !== plans.length) stop("consumer_source_changed");
  for (let i = 0; i < rows.length; i++) { await checkedCheckpoint(rows[i]); if (rows[i].checkpoint_id !== plans[i].row.checkpoint_id || rows[i].operation_digest !== digest) stop("checkpoint_mismatch"); }
  return rows;
}
async function recover(db, input, digest, error, prior) {
  try { const rows = await operation(db, input, digest); if (rows.length) return success(rows, "replayed", prior); }
  catch { return refusal(error, prior, true); }
  return refusal(error, prior);
}

/** Additive retention only. Valid input carry is never treated as authenticated. */
export async function retainFollowUpConsumerInputs(db, options) {
  let prior = null, input, digest, writing = false;
  try {
    const d = options && typeof options === "object" ? Object.getOwnPropertyDescriptor(options, "previousCarryForward") : null;
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) stop("invalid_carry"); prior = carry(d.value);
    input = freeze(copy(options)); exact(input, ["consumerKey", "operationId", "inventoryOptions", "previousCarryForward"]); key(input.consumerKey); key(input.operationId);
    if (canonicalJson(prior) !== canonicalJson(input.previousCarryForward)) stop("invalid_carry");
    exact(input.inventoryOptions, ["readAt", "limit", "cutoff"]); int(input.inventoryOptions.limit, 1, 200); int(input.inventoryOptions.readAt);
    const cutoff = input.inventoryOptions.cutoff; exact(cutoff, CUTOFF_FIELDS);
    for (const name of CUTOFF_FIELDS.slice(0, 5)) int(cutoff[name]);
    int(cutoff.maxPages, 1, 20); int(cutoff.maxCandidates, 1, 200);
    if (cutoff.plannedAt !== input.inventoryOptions.readAt || !(cutoff.receivedStart < cutoff.receivedEnd && cutoff.ingestedStart < cutoff.ingestedEnd
      && cutoff.receivedEnd <= cutoff.plannedAt && cutoff.ingestedEnd <= cutoff.plannedAt)) stop("invalid_input");
    digest = await sha256(canonicalJson(input)); const replay = await operation(db, input, digest); if (replay.length) return success(replay, "replayed", prior);
    const previous = await loadHead(db, input.consumerKey);
    const supported = prior.candidates.filter((c) => ["source", "lifecycle", "obligation", "exception"].includes(c.kind)).map((c) => ({ ...c, reasonCodes: ["carry_forward"] }));
    const observed = copy(await observeFollowUpCurrentInventory(db, { ...input.inventoryOptions, previousCarryForward: { candidates: supported, cursor: null } }), "invalid_database_result");
    if (observed.status !== "observed" || observed.inventoryComplete !== true || observed.authority !== false || observed.selection?.status !== "selected" || observed.selection.authoritativeCoverage !== false) stop("inventory_unavailable");
    candidates(observed.selection.candidates, "invalid_database_result"); hash(observed.snapshotDigest);
    const priorIds = new Set(prior.candidates.map((c) => c.candidateId));
    if (observed.selection.candidates.some((c) => c.reasonCodes.some((r) => ["retention_expired", "missing_parent"].includes(r)
      || (r === "candidate_missing" && !priorIds.has(c.candidateId))))) stop("inventory_evidence_gap");
    const proofs = await batch(db, INVENTORY_SQL.map((sql) => statement(db, sql.replace("$LIMIT", "?"), ...(sql.includes("$LIMIT") ? [input.inventoryOptions.limit + 1] : []))));
    const inventory = proofs.map((rows) => rows.map((r) => { exact(r, ["row_json"], "invalid_database_result"); if (typeof r.row_json !== "string") stop("invalid_database_result"); return r.row_json; }));
    const parsed = inventory.map((rows) => rows.map((r) => copy(JSON.parse(r), "invalid_database_result")));
    if (parsed.slice(1).some((r) => r.length > input.inventoryOptions.limit)) stop("inventory_changed");
    const sorted = (rows) => [...rows].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
    const snapshotDigest = await sha256(canonicalJson({ readAt: input.inventoryOptions.readAt, catalog: sorted(parsed[0]), sources: sorted(parsed[1]), lifecycles: sorted(parsed[2]), obligations: sorted(parsed[3]), exceptions: sorted(parsed[4]) }));
    if (snapshotDigest !== observed.snapshotDigest) stop("inventory_changed");
    const items = [...prior.candidates.map((c) => ({ ...c, reasonCodes: [...c.reasonCodes, "carry_forward"] })), ...observed.selection.candidates];
    if (new Set(items.map((c) => c.candidateId)).size > 200) stop("input_limit_exceeded");
    const payload = { contract: CONTRACT, inventorySnapshotDigest: snapshotDigest, carryDigest: await sha256(canonicalJson(prior)), rows: [], members: memberList(items) };
    const prefixDigest = previous?.prefix_digest ?? await sha256(canonicalJson({ contract: CONTRACT, consumerKey: input.consumerKey, prefix: 0 }));
    const row = await makeCheckpoint(input, digest, previous, 0, true, { kind: "inputs", prefixDigest,
      end: { sequence: previous?.prefix_sequence ?? 0, id: previous?.prefix_event_id_sha256 ?? null, digest: previous?.prefix_event_digest ?? null },
      h: { sequence: previous?.window_high_sequence ?? 0, id: previous?.window_event_id_sha256 ?? null, digest: previous?.window_event_digest ?? null },
      until: minimum(previous?.evidence_valid_until ?? null, parsed.slice(1).flatMap((rows, i) => rows.map((r) => r[i === 0 ? "normalized_retention_until" : "retention_until"]))) }, payload);
    writing = true; return success(await commit(db, input, digest, [{ row, proof: { kind: "inputs", readAt: input.inventoryOptions.readAt, inventoryLimit: input.inventoryOptions.limit, inventory } }]), "retained", prior);
  } catch (error) { return writing ? recover(db, input, digest, error, prior) : refusal(error, prior); }
}

/** At most twenty pages are planned, then committed atomically in <=21 statements. */
export async function advanceFollowUpConsumerPrefix(db, options) {
  let input, digest, writing = false;
  try {
    input = freeze(copy(options)); exact(input, ["consumerKey", "operationId", "pageSize", "maxPages"]); key(input.consumerKey); key(input.operationId);
    int(input.pageSize, 1, 200); int(input.maxPages, 1, 20);
    digest = await sha256(canonicalJson(input)); const replay = await operation(db, input, digest); if (replay.length) return success(replay, "replayed");
    let previous = await loadHead(db, input.consumerKey); const plans = [];
    for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex++) {
      const page = await readPage(db, previous, input.pageSize), items = [];
      for (const r of page.rows) {
        const c = (kind, identity, reasons) => ({ candidateId: `${kind}:${identity}`, kind, identity, reasonCodes: reasons });
        items.push(c("evidence", r.eventId, ["sequenced_evidence", ...(r.conflict ? ["conflicting_receipt_evidence"] : [])]));
        for (const [kind, identity] of [["source", r.sourceEventId], ["lifecycle", r.lifecycleInstanceId], ["obligation", r.obligationId]]) items.push(c(kind, identity, ["journal_linked_parent", ...(r.conflict && kind === "obligation" ? ["conflicting_receipt_evidence"] : [])]));
      }
      const priorDigest = previous?.prefix_digest ?? await sha256(canonicalJson({ contract: CONTRACT, consumerKey: input.consumerKey, prefix: 0 }));
      const row = await makeCheckpoint(input, digest, previous, pageIndex, !page.hasMore || pageIndex === input.maxPages - 1,
        { kind: "journal", end: page.end, h: page.h, until: page.until, prefixDigest: page.rows.length ? await sha256(canonicalJson({ contract: CONTRACT, previousPrefixDigest: priorDigest, rows: page.rows })) : priorDigest },
        { contract: CONTRACT, inventorySnapshotDigest: null, carryDigest: null, rows: page.rows, members: memberList(items) });
      plans.push({ row, proof: page.proof }); previous = row; if (!page.hasMore) break;
    }
    writing = true; return success(await commit(db, input, digest, plans), "advanced");
  } catch (error) { return writing ? recover(db, input, digest, error, null) : refusal(error); }
}

/** Immutable-checkpoint-bound candidate pages. Expiry is a gap, never deletion. */
export async function readRetainedFollowUpCandidates(db, options) {
  try {
    const input = freeze(copy(options)); exact(input, ["consumerKey", "checkpointId", "cursor", "limit"]); key(input.consumerKey); int(input.limit, 1, 200);
    if (input.checkpointId !== null && (typeof input.checkpointId !== "string" || !/^ckp_[a-f0-9]{64}$/.test(input.checkpointId))) stop("invalid_cursor");
    if (input.cursor !== null) { exact(input.cursor, ["contract", "checkpointId", "checkpointDigestSha256", "afterCandidateId"]); hash(input.cursor.checkpointDigestSha256, "invalid_cursor");
      if (input.cursor.contract !== CONTRACT || input.checkpointId === null || input.cursor.checkpointId !== input.checkpointId
        || typeof input.cursor.afterCandidateId !== "string" || !/^(source|lifecycle|obligation|exception|evidence|anomaly):id_[a-f0-9]{64}$/.test(input.cursor.afterCandidateId)) stop("invalid_cursor"); }
    const [found] = await batch(db, [input.checkpointId === null ? statement(db, `SELECT * FROM ${CP} WHERE consumer_key=? ORDER BY generation DESC LIMIT 1`, input.consumerKey)
      : statement(db, `SELECT * FROM ${CP} WHERE consumer_key=? AND checkpoint_id=?`, input.consumerKey, input.checkpointId)]);
    if (found.length !== 1) stop("checkpoint_mismatch"); const cp = await checkedCheckpoint(found[0]);
    if (input.cursor && input.cursor.checkpointDigestSha256 !== cp.checkpoint_digest) stop("invalid_cursor");
    const after = input.cursor?.afterCandidateId ?? "";
    const [counts, anchors, rows, before] = await batch(db, [
      stateStatement(db, cp),
      statement(db, `SELECT * FROM ${VIEW} WHERE sequence IN (?,?) ORDER BY sequence`, cp.prefix_sequence, cp.window_high_sequence),
      statement(db, `SELECT candidate_id,kind,identity,json_group_array(DISTINCT reason_code) reason_codes_json FROM ${MEMBERS}
        WHERE consumer_key=? AND generation<=? AND candidate_id>? GROUP BY candidate_id,kind,identity ORDER BY candidate_id LIMIT ?`, input.consumerKey, cp.generation, after, input.limit + 1),
      statement(db, `SELECT candidate_id FROM ${MEMBERS} WHERE consumer_key=? AND generation<=? AND candidate_id=? LIMIT 1`, input.consumerKey, cp.generation, after),
    ]);
    const state = checkedState(counts, cp);
    if (input.cursor && (before.length !== 1 || before[0].candidate_id !== after)) stop("invalid_cursor");
    let gap = state.prefix_valid !== 1 || (cp.evidence_valid_until !== null && cp.evidence_valid_until <= state.now_ms);
    for (const [sequence, identity, digest] of [[cp.prefix_sequence, cp.prefix_event_id_sha256, cp.prefix_event_digest], [cp.window_high_sequence, cp.window_event_id_sha256, cp.window_event_digest]]) {
      try { const a = await anchor(anchors.filter((r) => r.sequence === sequence), sequence, identity, digest, true); if (!a.valid) gap = true; } catch { gap = true; }
    }
    if (rows.length > input.limit + 1) stop("invalid_database_result");
    const result = []; let previous = after;
    for (const row of rows) {
      exact(row, ["candidate_id", "kind", "identity", "reason_codes_json"], "invalid_database_result"); owned(row.identity, "invalid_database_result");
      if (!KINDS.includes(row.kind) || row.candidate_id !== `${row.kind}:${row.identity}` || row.candidate_id <= previous || typeof row.reason_codes_json !== "string") stop("invalid_database_result");
      const reasonCodes = copy(JSON.parse(row.reason_codes_json), "invalid_database_result"); if (!Array.isArray(reasonCodes) || !reasonCodes.length || reasonCodes.length > REASONS.length || reasonCodes.some((r) => !REASONS.includes(r))) stop("invalid_database_result");
      result.push({ candidateId: row.candidate_id, family: FOLLOW_UP_FAMILY, kind: row.kind, identity: row.identity, reasonCodes: [...new Set(reasonCodes)].sort(), unresolved: true }); previous = row.candidate_id;
    }
    const hasMore = result.length > input.limit, selected = result.slice(0, input.limit);
    return envelope({ status: "observed", durable: true, checkpoint: await publicCheckpoint(cp), candidates: selected, hasMore,
      journalContinuity: gap ? "gap" : "recorded_structural_anchors_present", continuation: hasMore ? { contract: CONTRACT, checkpointId: cp.checkpoint_id, checkpointDigestSha256: cp.checkpoint_digest, afterCandidateId: selected.at(-1).candidateId } : null,
      reasonCodes: ["no_authenticated_coverage", "no_external_restore_witness", ...(gap ? ["retained_evidence_gap"] : [])] });
  } catch (error) { return refusal(error); }
}
