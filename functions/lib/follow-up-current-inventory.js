// Source-only current-row observation. No historical snapshot or ingestion authority.
import { canonicalJson, sha256 } from "./automation-truth-phase-b.js";
import { FOLLOW_UP_FAMILY } from "./reliability-contract.js";
import { planFollowUpCoverageSelection } from "./follow-up-coverage-selection.js";

const CONTRACT = "follow-up-current-inventory.v1";
const TABLES = ["source_events", "lifecycle_instances", "lifecycle_obligations", "lifecycle_exceptions"];
const COLUMNS = {
  source_events: ["source_event_id", "family", "received_at", "normalized_retention_until"],
  lifecycle_instances: ["lifecycle_instance_id", "source_event_id", "family", "state", "retention_until"],
  lifecycle_obligations: ["obligation_id", "lifecycle_instance_id", "family", "state", "deadline_at", "retention_until"],
  lifecycle_exceptions: ["exception_id", "family", "source_event_id", "lifecycle_instance_id", "obligation_id", "state", "retention_until"],
};
const FLAGS = Object.freeze({ simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false,
  outcomeProven: false, replacementAllowed: false, retainPreviousCarryForward: true });
const SAFE_FAILURES = new Set(["invalid_data", "invalid_shape", "invalid_clock", "invalid_identity", "invalid_bounds", "invalid_selector_input", "snapshot_read_failed", "invalid_schema_column", "schema_capability_unavailable", "cross_family_inventory", "duplicate_identity", "future_source", "invalid_state", "source_parent_missing", "lifecycle_parent_missing", "exception_lineage_invalid"]);

// Inspect descriptors before reading any caller-supplied value, including nested arrays.
function data(value, depth = 0) {
  if (depth > 12) throw new TypeError("invalid_data");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (value.length > 512) throw new TypeError("invalid_data"); return; }
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) throw new TypeError("invalid_data"); return; }
  if (!value || typeof value !== "object") throw new TypeError("invalid_data");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) throw new TypeError("invalid_data");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && value.length > 1000) throw new TypeError("invalid_data");
  for (const key of Reflect.ownKeys(descriptors)) {
    if (array && key === "length") continue;
    const d = descriptors[key];
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value") || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw new TypeError("invalid_data");
    data(d.value, depth + 1);
  }
  if (array) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(descriptors, String(i))) throw new TypeError("invalid_data");
}
function exact(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).sort().join() !== [...fields].sort().join()) throw new TypeError("invalid_shape");
}
function snapshotRows(results) {
  if (!Array.isArray(results) || Object.getPrototypeOf(results) !== Array.prototype || results.length !== 5) throw new TypeError("snapshot_read_failed");
  const descriptors = Object.getOwnPropertyDescriptors(results);
  if (Reflect.ownKeys(descriptors).length !== 6) throw new TypeError("snapshot_read_failed");
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const d = descriptors[String(i)];
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("snapshot_read_failed");
    const result = d.value;
    if (!result || Object.getPrototypeOf(result) !== Object.prototype) throw new TypeError("snapshot_read_failed");
    const fields = Object.getOwnPropertyDescriptors(result);
    for (const key of Reflect.ownKeys(fields)) if (typeof key !== "string" || !fields[key].enumerable || !Object.hasOwn(fields[key], "value")) throw new TypeError("snapshot_read_failed");
    if (fields.success?.value !== true || !Array.isArray(fields.results?.value)) throw new TypeError("snapshot_read_failed");
    // D1 transport metadata is not an assertion row; fractional durations are normal.
    data(fields.results.value); rows.push(fields.results.value);
  }
  return rows;
}
function clock(value) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("invalid_clock"); }
function identity(value) { if (typeof value !== "string" || !/^[A-Za-z0-9:_.-]{1,200}$/.test(value)) throw new TypeError("invalid_identity"); }
function nullableId(value) { if (value !== null) identity(value); }
function failure(reason, readAt = null) {
  return Object.freeze({ contract: CONTRACT, ...FLAGS, status: "incomplete", readAt,
    stateTimeScope: "current_at_read_not_historical", schemaCapability: "unproven", inventoryComplete: false,
    lateEvidenceProjection: "unavailable", reasonCodes: Object.freeze([reason, "late_evidence_ingestion_and_linkage_unavailable"]),
    snapshotDigest: null, selection: null });
}
function statement(db, sql, ...values) { return db.prepare(sql).bind(...values); }

export async function observeFollowUpCurrentInventory(db, options) {
  let readAt = null;
  try {
    data(options); exact(options, ["readAt", "limit", "cutoff", "previousCarryForward"]);
    clock(options.readAt); readAt = options.readAt;
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200 || options.cutoff?.plannedAt !== readAt) throw new TypeError("invalid_bounds");
    const { cutoff, previousCarryForward } = options;
    const emptyPage = { snapshotId: "validation", receivedStart: cutoff.receivedStart, receivedEnd: cutoff.receivedEnd,
      ingestedStart: cutoff.ingestedStart, ingestedEnd: cutoff.ingestedEnd, cursor: null, nextCursor: null,
      sources: [], lifecycles: [], obligations: [], exceptions: [], evidence: [], anomalies: [] };
    const validation = await planFollowUpCoverageSelection({ cutoff, previousCarryForward, snapshotPages: { traversalComplete: true, pages: [emptyPage] } });
    if (validation.inputDigestSha256 === null) throw new TypeError("invalid_selector_input");
    if (previousCarryForward.candidates.some((c) => c.kind === "evidence" || c.kind === "anomaly")) return failure("carry_kind_not_projected_preserve_previous", readAt);
    if (previousCarryForward.candidates.some((c) => !/^id_[a-f0-9]{64}$/.test(c.identity))) return failure("carry_identity_domain_unsupported", readAt);
    if (!db) return failure("database_unavailable", readAt);
    const bound = options.limit + 1;
    const results = await db.batch([
      statement(db, "SELECT m.name table_name,p.name column_name,p.type column_type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name IN (?,?,?,?) ORDER BY m.name,p.cid", ...TABLES),
      statement(db, "SELECT source_event_id,family,received_at,normalized_retention_until FROM source_events WHERE family=? ORDER BY source_event_id LIMIT ?", FOLLOW_UP_FAMILY, bound),
      statement(db, "SELECT l.lifecycle_instance_id,l.source_event_id,l.family,l.state,l.retention_until FROM lifecycle_instances l LEFT JOIN source_events s ON s.source_event_id=l.source_event_id WHERE l.family=? OR s.family=? ORDER BY l.lifecycle_instance_id LIMIT ?", FOLLOW_UP_FAMILY, FOLLOW_UP_FAMILY, bound),
      statement(db, "SELECT o.obligation_id,o.lifecycle_instance_id,o.family,o.state,o.deadline_at,o.retention_until FROM lifecycle_obligations o LEFT JOIN lifecycle_instances l ON l.lifecycle_instance_id=o.lifecycle_instance_id WHERE o.family=? OR l.family=? ORDER BY o.obligation_id LIMIT ?", FOLLOW_UP_FAMILY, FOLLOW_UP_FAMILY, bound),
      statement(db, "SELECT x.exception_id,x.family,x.source_event_id,x.lifecycle_instance_id,x.obligation_id,x.state,x.retention_until FROM lifecycle_exceptions x LEFT JOIN source_events s ON s.source_event_id=x.source_event_id LEFT JOIN lifecycle_instances l ON l.lifecycle_instance_id=x.lifecycle_instance_id LEFT JOIN lifecycle_obligations o ON o.obligation_id=x.obligation_id WHERE x.family=? OR s.family=? OR l.family=? OR o.family=? ORDER BY x.exception_id LIMIT ?", FOLLOW_UP_FAMILY, FOLLOW_UP_FAMILY, FOLLOW_UP_FAMILY, FOLLOW_UP_FAMILY, bound),
    ]);
    const [catalog, sources, lifecycles, obligations, exceptions] = snapshotRows(results);
    for (const row of catalog) { exact(row, ["table_name", "column_name", "column_type"]); for (const key of ["table_name", "column_name", "column_type"]) if (typeof row[key] !== "string") throw new TypeError("invalid_schema_column"); }
    for (const table of TABLES) for (const name of COLUMNS[table]) {
      const found = catalog.filter((r) => r.table_name === table && r.column_name === name);
      const type = /(_at|_until)$/.test(name) ? "INTEGER" : "TEXT";
      if (found.length !== 1 || found[0].column_type !== type) throw new TypeError("schema_capability_unavailable");
    }
    if ([sources, lifecycles, obligations, exceptions].some((rows) => rows.length > options.limit)) return failure("inventory_limit_exceeded", readAt);
    const maps = [new Map(), new Map(), new Map(), new Map()];
    const kinds = [sources, lifecycles, obligations, exceptions];
    for (let i = 0; i < kinds.length; i++) for (const row of kinds[i]) {
      exact(row, COLUMNS[TABLES[i]]);
      if (row.family !== FOLLOW_UP_FAMILY) throw new TypeError("cross_family_inventory");
      const key = row[COLUMNS[TABLES[i]][0]]; identity(key);
      if (maps[i].has(key)) throw new TypeError("duplicate_identity");
      maps[i].set(key, row);
      clock(row[i === 0 ? "normalized_retention_until" : "retention_until"]);
    }
    for (const s of sources) { clock(s.received_at); if (s.received_at > readAt) throw new TypeError("future_source"); }
    const states = [[lifecycles, ["active", "superseded", "cancelled", "completed", "exception"]], [obligations, ["pending", "leased", "satisfied", "skipped", "cancelled", "overdue_exception"]], [exceptions, ["open", "acknowledged", "investigating", "resolved", "suppressed_with_expiry"]]];
    for (const [rows, allowed] of states) for (const row of rows) if (typeof row.state !== "string" || !allowed.includes(row.state)) throw new TypeError("invalid_state");
    for (const l of lifecycles) { identity(l.source_event_id); if (!maps[0].has(l.source_event_id)) throw new TypeError("source_parent_missing"); }
    for (const o of obligations) { identity(o.lifecycle_instance_id); clock(o.deadline_at); if (!maps[1].has(o.lifecycle_instance_id)) throw new TypeError("lifecycle_parent_missing"); }
    for (const x of exceptions) {
      for (const field of ["source_event_id", "lifecycle_instance_id", "obligation_id"]) nullableId(x[field]);
      if (x.source_event_id === null && x.lifecycle_instance_id === null && x.obligation_id === null) continue; // Explicit family-level exception; no parent is invented.
      const o = x.obligation_id === null ? null : maps[2].get(x.obligation_id);
      const l = x.lifecycle_instance_id === null ? (o ? maps[1].get(o.lifecycle_instance_id) : null) : maps[1].get(x.lifecycle_instance_id);
      const s = x.source_event_id === null ? (l ? maps[0].get(l.source_event_id) : null) : maps[0].get(x.source_event_id);
      if ((x.obligation_id !== null && !o) || (x.lifecycle_instance_id !== null && !l) || !s || (o && (!l || o.lifecycle_instance_id !== l.lifecycle_instance_id)) || (l && l.source_event_id !== s.source_event_id)) throw new TypeError("exception_lineage_invalid");
    }
    // Only hashed owned identities leave this adapter. No raw payload, contact or provider reference.
    const hashed = new Map();
    for (const map of maps) for (const key of map.keys()) hashed.set(key, `id_${await sha256(key)}`);
    const sorted = (rows) => [...rows].sort((a, b) => { const x = canonicalJson(a), y = canonicalJson(b); return x < y ? -1 : x > y ? 1 : 0; });
    const snapshotDigest = await sha256(canonicalJson({ readAt, catalog: sorted(catalog), sources: sorted(sources), lifecycles: sorted(lifecycles), obligations: sorted(obligations), exceptions: sorted(exceptions) }));
    const projected = { ...emptyPage, snapshotId: `inventory_${snapshotDigest}`,
      sources: sources.map((s) => ({ sourceEventId: hashed.get(s.source_event_id), family: s.family, receivedAt: s.received_at })),
      lifecycles: lifecycles.map((l) => ({ lifecycleInstanceId: hashed.get(l.lifecycle_instance_id), sourceEventId: hashed.get(l.source_event_id), state: l.state, retentionUntil: l.retention_until })),
      obligations: obligations.map((o) => ({ obligationId: hashed.get(o.obligation_id), lifecycleInstanceId: hashed.get(o.lifecycle_instance_id), state: o.state, deadlineAt: o.deadline_at, retentionUntil: o.retention_until })),
      exceptions: exceptions.map((x) => ({ exceptionId: hashed.get(x.exception_id), family: x.family, state: x.state, retentionUntil: x.retention_until })),
      anomalies: sources.filter((s) => s.normalized_retention_until <= readAt).map((s) => ({ family: s.family, entityType: "source", entityId: hashed.get(s.source_event_id), reasonCode: "retention_expired" })),
    };
    const selection = await planFollowUpCoverageSelection({ cutoff, previousCarryForward, snapshotPages: { traversalComplete: true, pages: [projected] } });
    if (selection.status !== "selected") return failure("selection_incomplete", readAt);
    return Object.freeze({ contract: CONTRACT, ...FLAGS, status: "observed", readAt, stateTimeScope: "current_at_read_not_historical",
      schemaCapability: "required_columns_present_not_schema_authority", inventoryComplete: true, carryIdentityDomain: "id_sha256_owned_identity.v1",
      lateEvidenceProjection: "unavailable", reasonCodes: Object.freeze(["late_evidence_ingestion_and_linkage_unavailable", ...(exceptions.some((x) => x.source_event_id === null && x.lifecycle_instance_id === null && x.obligation_id === null) ? ["family_level_exception_has_no_entity_link"] : [])]), snapshotDigest, selection });
  } catch (error) {
    const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
    return failure(typeof message === "string" && SAFE_FAILURES.has(message) ? message : "invalid_or_unavailable_inventory", readAt);
  }
}
