// OFFLINE ONLY: produces SQL text/parameters, never opens a database or calls a
// provider. Metadata supplied by a caller is not authenticated live evidence.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../functions/lib/automation-truth-phase-b.js";
import { assessReliabilitySchemaAuthority } from "../functions/lib/reliability-schema-authority.js";

export const FOLLOW_UP_EVIDENCE_INSTALL_CONTRACT = "follow-up-evidence-install-plan.v1";
const CONTRACT = FOLLOW_UP_EVIDENCE_INSTALL_CONTRACT;
const DATABASE = "089d810a-9d2d-43a4-8f1d-dc3620835557";
const GATE = "follow_up_evidence_install_gate_v1", MAX_AGE_MS = 300000;
const CLOCK = "(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const VIEW = "follow_up_consumer_journal_v1";
const TABLES = ["follow_up_effect_attempt_bindings", "follow_up_effect_evidence_events", "follow_up_consumer_checkpoints", "follow_up_consumer_retained_reasons"];
const READS = ["catalog", "markers", "contracts", "foreign_keys", "candidate_counts"];
const AUTHORITY_FIXTURE = { path: "docs/automation-truth/fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json", sha256: "cc9783c2e4ac903ff33307dec3e707a603c194a1d8bfb24e8b02183d0dae9537" };
const ARTIFACTS = [
  { path: "reminder-engine-worker/reliability-effect-evidence.candidate.sql", sha256: "4a71cc0da24928677df2c26702600576df9ed80441a94c5f6e10b6c82aa36069", statements: 15 },
  { path: "reminder-engine-worker/reliability-consumer-retention.candidate.sql", sha256: "0fef0772950d429fc3dfb5ec4827089ea562523d3945917d114b22a99f2ebb88", statements: 14 },
];
const FLAGS = { sourceOnly: true, simulation: true, executionAuthorized: false, productionReadAuthorized: false, installationProven: false,
  authority: false, producerAdopted: false, dispatchAllowed: false, replacementAllowed: false, watermarkAdvanceAllowed: false,
  primaryMetadataAuthenticated: false, recoveryAuthenticated: false, restoreAuthorized: false, automaticRetryAllowed: false,
  coherentRollbackDetectable: false, firstRowAdoptionAllowed: false };
const SAFE = new Set(["invalid_input", "invalid_snapshot", "wrong_database", "invalid_source_revision", "missing_snapshot", "primary_metadata_unproven",
  "snapshot_not_fresh", "missing_recovery_metadata", "invalid_recovery_metadata", "recovery_metadata_not_fresh", "schema_authority_mismatch",
  "foreign_key_violation", "catalog_conflict", "partial_installation", "unexpected_population", "artifact_mismatch", "unsupported_sql",
  "invalid_plan_identity", "d1_limit_exceeded", "offline_plan_unavailable", "foreign_keys_disabled", "readback_predates_plan"]);
const fail = (code) => { throw new Error(code); };
const digest = (text) => createHash("sha256").update(text).digest("hex");
const bytes = (text) => Buffer.byteLength(text, "utf8");
function exact(value, keys, code = "invalid_input") {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) fail(code);
}
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail("invalid_snapshot"); }
function text(value, max = 300) { if (typeof value !== "string" || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail("invalid_input"); }
function freeze(value) { if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
function snapshot(value, depth = 0, budget = { n: 0 }) {
  if (++budget.n > 100000 || depth > 15) fail("invalid_input");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("invalid_input"); return value; }
  if (typeof value === "string") { if (bytes(value) > 2000000) fail("invalid_input"); return value; }
  if (!value || typeof value !== "object") fail("invalid_input");
  const array = Array.isArray(value); if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail("invalid_input");
  const descriptors = Object.getOwnPropertyDescriptors(value), length = array ? descriptors.length.value : null, entries = [];
  if ((array && length > 3000) || (!array && Reflect.ownKeys(descriptors).length > 100)) fail("invalid_input");
  for (const k of Reflect.ownKeys(descriptors)) {
    if (array && k === "length") continue;
    const d = descriptors[k]; if (typeof k !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
      || (array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length))) fail("invalid_input");
    entries.push([k, snapshot(d.value, depth + 1, budget)]);
  }
  if (!array) return Object.fromEntries(entries);
  if (entries.length !== length) fail("invalid_input"); const out = new Array(length); for (const [k, v] of entries) out[Number(k)] = v; return out;
}
function result(status, extra = {}) { return freeze({ contract: CONTRACT, ...FLAGS, status, statements: [], reasonCodes: [], ...extra }); }
function errorResult(error) {
  const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
  return result("refused", { reasonCodes: [SAFE.has(code) ? code : "offline_plan_unavailable"] });
}
const sortedCatalog = (rows) => [...rows].sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Lexer respects comments and quoted text. Trigger BEGIN/CASE/END is handled
// below; semicolons inside its body never become independent statements.
function tokens(sql) {
  const out = []; let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith("--", i)) { const end = sql.indexOf("\n", i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith("/*", i)) { const end = sql.indexOf("*/", i + 2); if (end < 0) fail("unsupported_sql"); i = end + 2; continue; }
    const start = i, ch = sql[i];
    if (["'", '"', "`", "["].includes(ch)) {
      const closing = ch === "[" ? "]" : ch; i++; let closed = false;
      while (i < sql.length) { if (sql[i++] === closing) { if (sql[i] === closing) { i++; continue; } closed = true; break; } }
      if (!closed) fail("unsupported_sql"); out.push({ value: sql.slice(start, i), upper: "", kind: "quoted", start, end: i }); continue;
    }
    if (/[A-Za-z_]/.test(ch)) { while (i < sql.length && /[A-Za-z_0-9]/.test(sql[i])) i++; }
    else i++;
    const value = sql.slice(start, i); out.push({ value, upper: value.toUpperCase(), kind: "token", start, end: i });
  }
  return out;
}
export function splitFollowUpEvidenceSql(sql) {
  if (typeof sql !== "string" || bytes(sql) > 100000) fail("unsupported_sql");
  const all = tokens(sql), statements = []; let current = [], parens = 0, trigger = false, body = false, ended = false, cases = 0;
  for (const t of all) {
    current.push(t); if (current.length === 2) trigger = current[0].upper === "CREATE" && current[1].upper === "TRIGGER";
    if (t.value === "(") parens++; if (t.value === ")" && --parens < 0) fail("unsupported_sql");
    if (trigger && t.upper === "BEGIN" && !body) body = true;
    else if (body && t.upper === "CASE") cases++;
    else if (body && t.upper === "END") { if (cases) cases--; else ended = true; }
    if (t.value === ";" && parens === 0 && (!trigger || ended)) {
      if (current[0].upper !== "CREATE" || !["TABLE", "INDEX", "TRIGGER", "VIEW"].includes(current[1]?.upper)) fail("unsupported_sql");
      statements.push(sql.slice(current[0].start, t.end)); current = []; parens = 0; trigger = false; body = false; ended = false; cases = 0;
    }
  }
  if (current.length || parens || body) fail("unsupported_sql"); return statements;
}
function implicitIndexes(ts, table) {
  const first = ts.findIndex((t) => t.value === "("), parts = []; let depth = 0, part = [];
  for (const t of ts.slice(first + 1)) {
    if (t.value === ")" && depth === 0) { if (part.length) parts.push(part); break; }
    if (t.value === "," && depth === 0) { parts.push(part); part = []; continue; }
    if (t.value === "(") depth++; if (t.value === ")") depth--; part.push(t);
  }
  let count = 0;
  for (const p of parts) {
    const words = p.filter((t) => t.kind === "token").map((t) => t.upper);
    if (words[0] === "UNIQUE") count++;
    else if (words[0] === "PRIMARY") count++;
    else { if (words.includes("PRIMARY") && words[1] !== "INTEGER") count++; if (words.includes("UNIQUE")) count++; }
  }
  return Array.from({ length: count }, (_, i) => ({ type: "index", name: `sqlite_autoindex_${table}_${i + 1}`, tbl_name: table, sql: null }));
}
function additiveCatalog(statements) {
  const rows = [];
  for (const sql of statements) {
    const ts = tokens(sql), type = ts[1].upper.toLowerCase(), name = ts[2].value;
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) fail("unsupported_sql");
    const tblName = ["table", "view"].includes(type) ? name : ts[ts.findIndex((t) => t.upper === "ON") + 1]?.value;
    if (!tblName || (type === "trigger" && !TABLES.includes(tblName))) fail("unsupported_sql");
    rows.push({ type, name, tbl_name: tblName, sql: sql.slice(0, -1).trim() });
    if (type === "table") rows.push(...implicitIndexes(ts, name));
  }
  if (rows.length !== 39 || rows.filter((r) => r.sql === null).length !== 10) fail("artifact_mismatch");
  return sortedCatalog(rows);
}
function artifacts() {
  const statements = [];
  for (const a of ARTIFACTS) {
    const sql = readFileSync(new URL(`../${a.path}`, import.meta.url), "utf8"); if (digest(sql) !== a.sha256) fail("artifact_mismatch");
    const parsed = splitFollowUpEvidenceSql(sql); if (parsed.length !== a.statements) fail("artifact_mismatch"); statements.push(...parsed);
  }
  const authorityText = readFileSync(new URL(`../${AUTHORITY_FIXTURE.path}`, import.meta.url), "utf8");
  if (digest(authorityText) !== AUTHORITY_FIXTURE.sha256) fail("artifact_mismatch");
  return { statements, catalog: additiveCatalog(statements), authority: JSON.parse(authorityText).rawPrimaryRows };
}
function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 2000) fail("invalid_snapshot"); const seen = new Set();
  for (const row of catalog) {
    exact(row, ["type", "name", "tbl_name", "sql"], "invalid_snapshot");
    if (!["table", "index", "trigger", "view"].includes(row.type)) fail("invalid_snapshot"); text(row.name); text(row.tbl_name);
    if (row.name === GATE || (row.sql === null ? row.type !== "index" || !row.name.startsWith("sqlite_autoindex_") : typeof row.sql !== "string" || !row.sql.length || bytes(row.sql) > 100000)) fail("invalid_snapshot");
    const key = `${row.type}:${row.name}`; if (seen.has(key)) fail("invalid_snapshot"); seen.add(key);
  }
}
async function validateSnapshot(s, now, fresh, pinnedAuthority) {
  exact(s, ["databaseId", "capturedAt", "catalog", "markers", "contracts", "foreignKeysEnabled", "foreignKeyViolations", "candidateTableCounts", "candidateViewRowCount", "readEvidence"], "invalid_snapshot");
  if (s.databaseId !== DATABASE) fail("wrong_database"); integer(s.capturedAt); validateCatalog(s.catalog);
  if (!Array.isArray(s.markers) || !Array.isArray(s.contracts) || !Array.isArray(s.foreignKeyViolations)) fail("invalid_snapshot");
  for (const r of s.markers) { exact(r, ["version", "applied_at", "migration_id", "description"], "invalid_snapshot"); integer(r.version, 1); integer(r.applied_at, 1); text(r.migration_id); text(r.description); }
  for (const r of s.contracts) { exact(r, ["version", "migration_id", "canonicalization", "structure_sha256", "expected_objects_json", "applied_at"], "invalid_snapshot"); integer(r.version, 1); integer(r.applied_at, 1); }
  if (canonicalJson(s.markers) !== canonicalJson(pinnedAuthority.schemaVersions)
    || canonicalJson(s.contracts) !== canonicalJson(pinnedAuthority.schemaContracts)) fail("schema_authority_mismatch");
  const authority = await assessReliabilitySchemaAuthority({ markers: s.markers, contracts: s.contracts, sqliteMaster: s.catalog });
  if (!authority.proven || authority.migrationState !== "current_v2" || authority.structure.objects.length !== 69) fail("schema_authority_mismatch");
  if (s.foreignKeyViolations.length) fail("foreign_key_violation");
  if (s.foreignKeysEnabled !== true) fail("foreign_keys_disabled");
  exact(s.candidateTableCounts, TABLES, "invalid_snapshot"); for (const v of Object.values(s.candidateTableCounts)) if (v !== null) integer(v);
  if (fresh && (s.capturedAt > now || now - s.capturedAt > MAX_AGE_MS)) return "snapshot_not_fresh";
  const hasView = s.catalog.some((r) => r.name === VIEW && r.type === "view"), requiredReads = [...READS, ...(hasView ? ["candidate_view"] : [])];
  if (hasView) integer(s.candidateViewRowCount); else if (s.candidateViewRowCount !== null) fail("invalid_snapshot");
  if (!Array.isArray(s.readEvidence) || s.readEvidence.length !== requiredReads.length) return "primary_metadata_unproven";
  const kinds = new Set();
  for (const r of s.readEvidence) {
    exact(r, ["kind", "success", "servedByPrimary", "rowsWritten", "changes", "changedDb"], "invalid_snapshot");
    if (!requiredReads.includes(r.kind) || kinds.has(r.kind) || r.success !== true || r.servedByPrimary !== true || r.rowsWritten !== 0 || r.changes !== 0 || r.changedDb !== false) return "primary_metadata_unproven";
    kinds.add(r.kind);
  }
  return null;
}
function installationState(s, additive) {
  const names = new Set(additive.map((r) => r.name)), found = s.catalog.filter((r) => names.has(r.name) || TABLES.includes(r.tbl_name) || r.tbl_name === VIEW);
  if (!found.length) { if (Object.values(s.candidateTableCounts).some((n) => n !== null)) fail("invalid_snapshot"); return "absent"; }
  if (canonicalJson(sortedCatalog(found)) !== canonicalJson(additive)) fail(found.length === additive.length ? "catalog_conflict" : "partial_installation");
  if (Object.values(s.candidateTableCounts).some((n) => n === null)) fail("invalid_snapshot");
  return Object.values(s.candidateTableCounts).some((n) => n !== 0) || s.candidateViewRowCount !== 0 ? "populated" : "empty";
}
function validateRecovery(r, now, fresh) {
  if (r === null) return "missing_recovery_metadata";
  exact(r, ["databaseId", "source", "bookmark", "capturedAt", "externalRecordId", "owner"], "invalid_recovery_metadata");
  if (r.source !== "cloudflare_time_travel") fail("invalid_recovery_metadata");
  if (r.databaseId !== DATABASE) fail("wrong_database"); integer(r.capturedAt); for (const k of ["bookmark", "externalRecordId", "owner"]) text(r[k]);
  return fresh && (r.capturedAt > now || now - r.capturedAt > MAX_AGE_MS) ? "recovery_metadata_not_fresh" : null;
}
function validateBasis(input) {
  exact(input, ["databaseId", "sourceRevision", "snapshot", "recovery"]);
  if (input.databaseId !== DATABASE) fail("wrong_database"); if (typeof input.sourceRevision !== "string" || !/^[a-f0-9]{40}$/.test(input.sourceRevision)) fail("invalid_source_revision");
}
const tuples = (fields, alias) => fields.map((f) => `json_extract(${alias}.value,'$.${f}')`).join(",");
function exactRows(table, fields, path, where = "") {
  const cols = fields.join(","), expected = `SELECT ${tuples(fields, "j")} FROM json_each((SELECT data FROM proof),'$.${path}') j`;
  const actual = `SELECT ${cols} FROM ${table} ${where}`;
  return `(SELECT COUNT(*) FROM ${table} ${where})=json_array_length((SELECT data FROM proof),'$.${path}')
    AND NOT EXISTS(${expected} EXCEPT ${actual}) AND NOT EXISTS(${actual} EXCEPT ${expected})`;
}
const ASSERTION = `WITH proof(data) AS(VALUES(?)) INSERT INTO ${GATE}(accepted) SELECT CASE WHEN
  ${exactRows("sqlite_master", ["type", "name", "tbl_name", "sql"], "catalog", `WHERE type IN ('table','index','trigger','view') AND name<>'${GATE}'`)}
  AND ${exactRows("reliability_schema_versions", ["version", "applied_at", "migration_id", "description"], "markers")}
  AND ${exactRows("reliability_schema_contracts", ["version", "migration_id", "canonicalization", "structure_sha256", "expected_objects_json", "applied_at"], "contracts")}
  AND (SELECT foreign_keys FROM pragma_foreign_keys)=1
  AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)
  AND json_extract((SELECT data FROM proof),'$.capturedAt')<=${CLOCK}
  AND ${CLOCK}-json_extract((SELECT data FROM proof),'$.capturedAt')<=${MAX_AGE_MS}
  AND json_extract((SELECT data FROM proof),'$.recoveryCapturedAt')<=${CLOCK}
  AND ${CLOCK}-json_extract((SELECT data FROM proof),'$.recoveryCapturedAt')<=${MAX_AGE_MS}
  THEN 1 ELSE 0 END`;
function statementBounds(statement) {
  if (bytes(statement.sql) > 100000 || statement.params.length > 100 || statement.params.some((p) => typeof p !== "string" || bytes(p) > 2000000)) fail("d1_limit_exceeded");
  const ts = tokens(statement.sql), functions = new Set(["JSON_OBJECT", "JSON_SET", "JSON_ARRAY", "JSON_EXTRACT", "JSON_ARRAY_LENGTH", "JSON_GROUP_ARRAY", "JSON_VALID", "JSON_TYPE", "COALESCE", "MIN", "MAX", "SUBSTR", "LENGTH", "CAST", "STRFTIME", "COUNT", "SUM", "CHANGES", "RAISE"]);
  for (let i = 0; i < ts.length - 1; i++) if (functions.has(ts[i].upper) && ts[i + 1].value === "(") {
    let depth = 1, args = 1;
    for (let j = i + 2; j < ts.length && depth; j++) { if (ts[j].value === "(") depth++; else if (ts[j].value === ")") depth--; else if (ts[j].value === "," && depth === 1) args++; }
    if (depth || args > 32) fail("d1_limit_exceeded");
  }
}
function build(input, a) {
  const before = { catalog: sortedCatalog(input.snapshot.catalog), markers: input.snapshot.markers, contracts: input.snapshot.contracts,
    capturedAt: input.snapshot.capturedAt, recoveryCapturedAt: input.recovery.capturedAt };
  const after = { ...before, catalog: sortedCatalog([...before.catalog, ...a.catalog]) };
  const post = ASSERTION.replace("THEN 1 ELSE 0 END", `AND ${TABLES.map((t) => `(SELECT COUNT(*) FROM ${t})=0`).join(" AND ")}
    AND (SELECT COUNT(*) FROM ${VIEW})=0 THEN 1 ELSE 0 END`);
  const statements = [
    { kind: "create_gate", sql: `CREATE TABLE ${GATE}(accepted INTEGER NOT NULL CHECK(accepted=1))`, params: [] },
    { kind: "precondition", sql: ASSERTION, params: [canonicalJson(before)] },
    ...a.statements.map((sql, i) => ({ kind: i < 15 ? "effect_ddl" : "consumer_ddl", sql, params: [] })),
    { kind: "postcondition", sql: post, params: [canonicalJson(after)] },
    { kind: "remove_gate", sql: `DROP TABLE ${GATE}`, params: [] },
  ];
  for (const s of statements) statementBounds(s);
  const body = { contract: CONTRACT, databaseId: DATABASE, sourceRevision: input.sourceRevision,
    artifacts: ARTIFACTS.map(({ path, sha256 }) => ({ path, sha256 })), authorityFixture: AUTHORITY_FIXTURE, basisDigest: digest(canonicalJson(input)),
    beforeCatalogDigest: digest(canonicalJson(before.catalog)), afterCatalogDigest: digest(canonicalJson(after.catalog)),
    additiveCatalogDigest: digest(canonicalJson(a.catalog)), explicitCreateCount: 29, additiveCatalogCount: 39, statements };
  return { ...body, planDigest: digest(canonicalJson(body)), basis: input };
}

/** Metadata can make a plan structurally ready, never authorized to execute. */
export async function planFollowUpEvidenceInstall(options) {
  try {
    const input = freeze(snapshot(options)); validateBasis(input); const now = Date.now(), a = artifacts();
    if (input.snapshot === null) return result("pending", { reasonCodes: ["missing_snapshot"] });
    const pending = await validateSnapshot(input.snapshot, now, true, a.authority); if (pending) return result("pending", { reasonCodes: [pending] });
    const state = installationState(input.snapshot, a.catalog);
    if (state === "empty") return result("already_installed", { classification: "exact_empty_installation_metadata", reasonCodes: ["readback_only_no_replay"] });
    if (state === "populated") fail("unexpected_population");
    const recoveryPending = validateRecovery(input.recovery, now, true); if (recoveryPending) return result("pending", { reasonCodes: [recoveryPending] });
    return result("planned", { ...build(input, a), evidenceScope: "caller_supplied_metadata_not_authenticated",
      transactionRequirement: "one_atomic_D1_batch_not_executed", transportCompatibility: "unproven",
      reasonCodes: ["separate_execution_approval_required", "recovery_bookmark_not_authenticated", "first_row_adoption_separately_gated"] });
  } catch (error) { return errorResult(error); }
}

/** A lost response is classified from fresh readback; never retry/drop/reset. */
export async function classifyFollowUpEvidenceInstallOutcome(options) {
  try {
    const input = freeze(snapshot(options)); exact(input, ["basis", "planDigest", "snapshot"]); validateBasis(input.basis);
    const now = Date.now(), a = artifacts();
    if (input.basis.snapshot === null || await validateSnapshot(input.basis.snapshot, now, false, a.authority)
      || validateRecovery(input.basis.recovery, now, false) || installationState(input.basis.snapshot, a.catalog) !== "absent") fail("invalid_plan_identity");
    const plan = build(input.basis, a); if (typeof input.planDigest !== "string" || input.planDigest !== plan.planDigest) fail("invalid_plan_identity");
    if (input.snapshot === null) return result("pending", { classification: "indeterminate", reasonCodes: ["missing_snapshot"] });
    const pending = await validateSnapshot(input.snapshot, now, true, a.authority); if (pending) return result("pending", { classification: "indeterminate", reasonCodes: [pending] });
    if (input.snapshot.capturedAt < Math.max(input.basis.snapshot.capturedAt, input.basis.recovery.capturedAt)) fail("readback_predates_plan");
    const s = input.snapshot, prior = input.basis.snapshot;
    if (canonicalJson(s.markers) !== canonicalJson(prior.markers) || canonicalJson(s.contracts) !== canonicalJson(prior.contracts)) fail("catalog_conflict");
    const state = installationState(s, a.catalog), actual = digest(canonicalJson(sortedCatalog(s.catalog)));
    if (state === "absent" && actual === plan.beforeCatalogDigest) return result("classified", { classification: "not_installed", planDigest: plan.planDigest });
    if (state === "empty" && actual === plan.afterCatalogDigest) return result("classified", { classification: "installed_empty", planDigest: plan.planDigest });
    if (state === "populated") fail("unexpected_population"); fail("catalog_conflict");
  } catch (error) { return freeze({ ...errorResult(error), classification: "indeterminate" }); }
}
