import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFollowUpEvidenceInstallOutcome, planFollowUpEvidenceInstall, splitFollowUpEvidenceSql } from "../../scripts/follow-up-evidence-install-plan.mjs";
import { canonicalJson } from "../../functions/lib/automation-truth-phase-b.js";
import { assessReliabilitySchemaAuthority } from "../../functions/lib/reliability-schema-authority.js";

const DATABASE = "089d810a-9d2d-43a4-8f1d-dc3620835557", SOURCE = "dfdcace0cc377421979fc38ffc73e1ce48f05cd2";
const GATE = "follow_up_evidence_install_gate_v1", VIEW = "follow_up_consumer_journal_v1";
const TABLES = ["follow_up_effect_attempt_bindings", "follow_up_effect_evidence_events", "follow_up_consumer_checkpoints", "follow_up_consumer_retained_reasons"];
const fixture = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json", import.meta.url), "utf8"));
const promotion = JSON.parse(readFileSync(new URL("../../docs/automation-truth/fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json", import.meta.url), "utf8")).rawPrimaryRows;
const sql = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const effect = sql("reliability-effect-evidence.candidate.sql"), consumer = sql("reliability-consumer-retention.candidate.sql");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const ORIGINAL_ARTIFACTS = [
  { name: "effect", source: effect, cases: 20, sha256: "9b6f640d212692ff67cbc0b6ab9654ce7f8df7908eceaf192c2b405bcf7441ea" },
  { name: "consumer", source: consumer, cases: 16, sha256: "208512e371d115778a17608c74cabd267f31c3145a4b0b05125048c8e6e142d4" },
];
// Independent, test-only lexical oracle. Match whole quoted/comment tokens so
// their CASE/END text cannot masquerade as an expression or a trigger boundary.
function casePairs(source) {
  const tokens = /--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|[A-Za-z_][A-Za-z_0-9]*|[()]/g;
  const stack = [], pairs = [];
  for (const match of source.matchAll(tokens)) {
    const word = match[0].toUpperCase();
    if (word === "CASE") stack.push(match.index);
    else if (word === "END" && stack.length) pairs.push({ start: stack.pop(), end: match.index + match[0].length });
  }
  if (stack.length) throw new Error("unclosed CASE expression");
  return pairs.sort((a, b) => a.start - b.start);
}
function removeCaseWrappers(source) {
  const removed = new Set();
  for (const { start, end } of casePairs(source)) {
    if (source[start - 1] !== "(" || source[end] !== ")") throw new Error("CASE expression must be fully parenthesized");
    removed.add(start - 1); removed.add(end);
  }
  return source.split("").filter((_, index) => !removed.has(index)).join("");
}
let raw;
function catalog() { return raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type,name").all().map((r) => ({ ...r })); }
function rows(query) { return raw.prepare(query).all().map((r) => ({ ...r })); }
function readSnapshot() {
  const all = catalog(), present = new Set(all.filter((r) => r.type === "table").map((r) => r.name)), hasView = all.some((r) => r.name === VIEW && r.type === "view");
  return { databaseId: DATABASE, capturedAt: Date.now(), catalog: all,
    markers: rows("SELECT version,applied_at,migration_id,description FROM reliability_schema_versions ORDER BY version"),
    contracts: rows("SELECT version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at FROM reliability_schema_contracts ORDER BY version"),
    foreignKeysEnabled: raw.prepare("PRAGMA foreign_keys").get().foreign_keys === 1, foreignKeyViolations: rows("PRAGMA foreign_key_check"),
    candidateTableCounts: Object.fromEntries(TABLES.map((name) => [name, present.has(name) ? raw.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n : null])),
    candidateViewRowCount: hasView ? raw.prepare(`SELECT COUNT(*) n FROM ${VIEW}`).get().n : null,
    readEvidence: ["catalog", "markers", "contracts", "foreign_keys", "candidate_counts", ...(hasView ? ["candidate_view"] : [])]
      .map((kind) => ({ kind, success: true, servedByPrimary: true, rowsWritten: 0, changes: 0, changedDb: false })) };
}
function input() { return { databaseId: DATABASE, sourceRevision: SOURCE, snapshot: readSnapshot(), recovery: {
  databaseId: DATABASE, source: "cloudflare_time_travel", bookmark: "fixture-bookmark-not-provider-verified", capturedAt: Date.now(),
  externalRecordId: "private-ledger-fixture", owner: "fixture-operator" } }; }
function flags(result) {
  expect(result).toMatchObject({ sourceOnly: true, simulation: true, executionAuthorized: false, productionReadAuthorized: false,
    installationProven: false, authority: false, producerAdopted: false, dispatchAllowed: false, replacementAllowed: false,
    watermarkAdvanceAllowed: false, primaryMetadataAuthenticated: false, recoveryAuthenticated: false, restoreAuthorized: false,
    automaticRetryAllowed: false, coherentRollbackDetectable: false, firstRowAdoptionAllowed: false });
}
function refused(result) { flags(result); expect(result.status).toBe("refused"); expect(result.statements).toEqual([]); }
async function plan(options = input()) {
  const p = await planFollowUpEvidenceInstall(options); expect(p.status, JSON.stringify(p.reasonCodes)).toBe("planned"); flags(p); return p;
}
function execute(plan, before = () => {}) {
  // Test-only local transaction harness. The actual planner has no database
  // dependency and never executes SQL, trusted or untrusted.
  raw.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 0; i < plan.statements.length; i++) { const s = plan.statements[i]; before(s, i); raw.prepare(s.sql).run(...s.params); }
    raw.exec("COMMIT");
  } catch (error) { raw.exec("ROLLBACK"); throw error; }
}
const classify = (p, snapshot = readSnapshot()) => classifyFollowUpEvidenceInstallOutcome({ basis: p.basis, planDigest: p.planDigest, snapshot });
beforeEach(() => {
  raw = new DatabaseSync(":memory:"); raw.exec("PRAGMA foreign_keys=ON");
  for (const type of ["table", "index", "trigger"]) for (const row of fixture.projection.filter((r) => r.type === type)) raw.exec(row.sql);
  const marker = fixture.marker[0]; raw.prepare("INSERT INTO reliability_schema_versions VALUES(?,?,?,?)").run(marker.version, marker.applied_at, marker.migration_id, marker.description);
  raw.exec(sql("reliability-spine-v2-production-lineage-install.local.sql"));
  // Use the actual observed authority rows. Running promotion anew would stamp
  // today's clock, which is deliberately NOT the pinned production identity.
  const v2 = promotion.schemaVersions[1]; raw.prepare("INSERT INTO reliability_schema_versions VALUES(?,?,?,?)").run(v2.version, v2.applied_at, v2.migration_id, v2.description);
  const c = promotion.schemaContracts[0]; raw.prepare("INSERT INTO reliability_schema_contracts(version,migration_id,canonicalization,structure_sha256,expected_objects_json,applied_at) VALUES(?,?,?,?,?,?)")
    .run(c.version, c.migration_id, c.canonicalization, c.structure_sha256, c.expected_objects_json, c.applied_at);
  raw.prepare("INSERT INTO automation_events(ts,engine,contact_id,detail) VALUES(?,?,?,?)").run(Date.now(), "fixture", "private-contact", "existing work");
  raw.exec("CREATE VIEW unrelated_existing_view AS SELECT id,ts FROM automation_events");
});
afterEach(() => { vi.restoreAllMocks(); raw?.close(); });

describe("offline exact Follow-Up installation envelope", () => {
  it("pins both artifacts and derives all39 catalog additions without altering a database", async () => {
    const before = catalog(), p = await plan(); expect(catalog()).toEqual(before);
    expect(p).toMatchObject({ explicitCreateCount: 29, additiveCatalogCount: 39, transactionRequirement: "one_atomic_D1_batch_not_executed", transportCompatibility: "unproven" });
    expect(p.artifacts.map((r) => r.sha256)).toEqual([hash(effect), hash(consumer)]);
    expect(p.authorityFixture.sha256).toBe("cc9783c2e4ac903ff33307dec3e707a603c194a1d8bfb24e8b02183d0dae9537");
    expect(p.statements).toHaveLength(33); expect(p.statements.slice(2, 17).every((s) => s.kind === "effect_ddl")).toBe(true);
    expect(p.statements.slice(17, 31).every((s) => s.kind === "consumer_ddl")).toBe(true);
    expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.statements[1].params)).toBe(true);
  });
  it("produces the exact SQLite catalog, empty tables/view and preserved v2 authority", async () => {
    const before = readSnapshot(), data = rows("SELECT * FROM automation_events"), sequence = rows("SELECT * FROM sqlite_sequence"), p = await plan(); execute(p);
    const after = readSnapshot(), priorNames = new Set(before.catalog.map((r) => `${r.type}:${r.name}`));
    const addition = after.catalog.filter((r) => !priorNames.has(`${r.type}:${r.name}`));
    expect(after.catalog.filter((r) => priorNames.has(`${r.type}:${r.name}`))).toEqual(before.catalog); expect(addition).toHaveLength(39);
    expect(addition.filter((r) => r.sql === null)).toHaveLength(10); expect(hash(canonicalJson(addition))).toBe(p.additiveCatalogDigest);
    expect(hash(JSON.stringify(addition))).toBe("7440241ab197941fc5a8d2ce49761b880cb4dd84af208336f9230c219c4aa905");
    expect(rows("SELECT * FROM automation_events")).toEqual(data); expect(rows("SELECT * FROM sqlite_sequence")).toEqual(sequence);
    expect(after.markers).toEqual(before.markers); expect(after.contracts).toEqual(before.contracts); expect(Object.values(after.candidateTableCounts)).toEqual([0, 0, 0, 0]);
    expect(after.candidateViewRowCount).toBe(0); expect(after.foreignKeyViolations).toEqual([]); expect(after.catalog.some((r) => r.name === GATE)).toBe(false);
    const assessed = await assessReliabilitySchemaAuthority({ markers: after.markers, contracts: after.contracts, sqliteMaster: after.catalog });
    expect(assessed).toMatchObject({ proven: true, migrationState: "current_v2", appliedAt: 1787803363000 }); expect(assessed.structure.objects).toHaveLength(69);
  });
  it.each(["after_effect", "final_consumer", "postcondition"])("rolls back the entire installation on%s failure", async (point) => {
    const before = readSnapshot(), data = rows("SELECT * FROM automation_events"), p = await plan(); let failed = false;
    expect(() => execute(p, (s, i) => {
      if ((point === "after_effect" && i === 17) || (point === "final_consumer" && i === 30)) { failed = true; raw.prepare("SELECT * FROM absent_failure_fixture").all(); }
      if (point === "postcondition" && s.kind === "postcondition") { failed = true; raw.exec("CREATE TABLE unexpected_schema_change(n INTEGER)"); }
    })).toThrow(); expect(failed).toBe(true); expect(catalog()).toEqual(before.catalog); expect(rows("SELECT * FROM automation_events")).toEqual(data);
    expect(rows("SELECT * FROM sqlite_sequence")).toEqual([{ name: "automation_events", seq: 1 }]);
  });
  it("rejects a precondition race before any candidate objects commit", async () => {
    const before = catalog(), p = await plan();
    expect(() => execute(p, (s) => { if (s.kind === "precondition") raw.exec("CREATE TABLE concurrent_ddl(n INTEGER)"); })).toThrow(/CHECK/);
    expect(catalog()).toEqual(before);
  });
  it("rechecks metadata age against database time inside the transaction", async () => {
    const before = catalog(), p = await plan(), shifted = Date.now() + 400000;
    raw.function("strftime", (format, _when) => format === "%s" ? String(Math.floor(shifted / 1000)) : "00.000");
    expect(() => execute(p)).toThrow(/CHECK/); expect(catalog()).toEqual(before);
  });
  it("requires foreign keys still enabled at execution", async () => {
    const before = catalog(), p = await plan(); raw.exec("PRAGMA foreign_keys=OFF"); expect(() => execute(p)).toThrow(/CHECK/); expect(catalog()).toEqual(before);
  });
  it("classifies a lost committed response without producing another executable plan", async () => {
    const p = await plan(); execute(p); const outcome = await classify(p); flags(outcome);
    expect(outcome).toMatchObject({ status: "classified", classification: "installed_empty", planDigest: p.planDigest, statements: [] });
    const again = await planFollowUpEvidenceInstall(input()); expect(again.status).toBe("already_installed"); expect(again.statements).toEqual([]); flags(again);
  });
  it("classifies uncommitted failure as not_installed but never retries automatically", async () => {
    const p = await plan(); expect(() => execute(p, (_, i) => { if (i === 17) throw new Error("test connection failure"); })).toThrow();
    const r = await classify(p); expect(r).toMatchObject({ status: "classified", classification: "not_installed", automaticRetryAllowed: false, statements: [] });
  });
  it("does not resolve unknown outcome with an older but still-fresh snapshot", async () => {
    const p = await plan(), old = readSnapshot(); old.capturedAt = p.basis.snapshot.capturedAt - 1;
    const r = await classify(p, old); refused(r); expect(r.reasonCodes).toEqual(["readback_predates_plan"]);
  });
  it("refuses duplicate execution rather than dropping or replacing existing objects", async () => {
    const p = await plan(); execute(p); const complete = catalog(); expect(() => execute(p)).toThrow(/CHECK/); expect(catalog()).toEqual(complete);
  });
  it.each(["catalog", "markers", "contracts", "source", "bookmark"])("binds%s to the immutable plan identity", async (part) => {
    const p = await plan(), b = structuredClone(p.basis);
    if (part === "catalog") b.snapshot.catalog.find((r) => r.name === "unrelated_existing_view").sql += " ";
    else if (part === "markers") b.snapshot.markers[1].applied_at++;
    else if (part === "contracts") b.snapshot.contracts[0].applied_at++;
    else if (part === "source") b.sourceRevision = "a".repeat(40);
    else b.recovery.bookmark += "-changed";
    refused(await classifyFollowUpEvidenceInstallOutcome({ basis: b, planDigest: p.planDigest, snapshot: readSnapshot() }));
  });
  it.each(["missing_snapshot", "missing_recovery", "old_snapshot", "future_snapshot", "old_recovery", "primary", "metadata"])("returns pending for%s with no statements", async (kind) => {
    const o = input();
    if (kind === "missing_snapshot") o.snapshot = null; else if (kind === "missing_recovery") o.recovery = null;
    else if (kind === "old_snapshot") o.snapshot.capturedAt -= 400000; else if (kind === "future_snapshot") o.snapshot.capturedAt += 400000;
    else if (kind === "old_recovery") o.recovery.capturedAt -= 400000; else if (kind === "primary") o.snapshot.readEvidence[0].servedByPrimary = false;
    else o.snapshot.readEvidence = [];
    const r = await planFollowUpEvidenceInstall(o); expect(r.status).toBe("pending"); expect(r.statements).toEqual([]); flags(r);
  });
  it.each(["database", "snapshot_database", "recovery_database", "source", "foreign_keys", "violations", "marker", "joint_applied_at", "contract", "canonical_ddl"])("refuses%s mismatch", async (kind) => {
    const o = input();
    if (kind === "database") o.databaseId = "wrong"; else if (kind === "snapshot_database") o.snapshot.databaseId = "wrong";
    else if (kind === "recovery_database") o.recovery.databaseId = "wrong"; else if (kind === "source") o.sourceRevision = "main";
    else if (kind === "foreign_keys") o.snapshot.foreignKeysEnabled = false; else if (kind === "violations") o.snapshot.foreignKeyViolations = [{ table: "fixture", rowid: 1, parent: "parent", fkid: 0 }];
    else if (kind === "marker") o.snapshot.markers.pop(); else if (kind === "joint_applied_at") { o.snapshot.markers[1].applied_at++; o.snapshot.contracts[0].applied_at++; }
    else if (kind === "contract") o.snapshot.contracts[0].structure_sha256 = "a".repeat(64);
    else o.snapshot.catalog.find((r) => r.type === "table" && r.name === "command_attempts").sql += " -- changed";
    refused(await planFollowUpEvidenceInstall(o));
  });
  it("does not accept a session-labelled token as recovery-route evidence", async () => {
    const o = input(); o.recovery.source = "sessions_first_primary"; const r = await planFollowUpEvidenceInstall(o); refused(r);
    expect(r.reasonCodes).toEqual(["invalid_recovery_metadata"]);
  });
  it("refuses a partial install and preserves it untouched", async () => {
    raw.exec(effect); const prior = catalog(); refused(await planFollowUpEvidenceInstall(input())); expect(catalog()).toEqual(prior);
  });
  it.each(["table_trigger", "view_trigger", "index", "changed_view"])("refuses a completed candidate with%s instead of exact-empty classification", async (kind) => {
    const p = await plan(); execute(p);
    if (kind === "table_trigger") raw.exec("CREATE TRIGGER rogue_table BEFORE INSERT ON follow_up_consumer_checkpoints BEGIN SELECT 1; END");
    else if (kind === "view_trigger") raw.exec(`CREATE TRIGGER rogue_view INSTEAD OF INSERT ON ${VIEW} BEGIN SELECT 1; END`);
    else if (kind === "index") raw.exec("CREATE INDEX rogue_index ON follow_up_consumer_checkpoints(consumer_key)");
    else { raw.exec(`DROP VIEW ${VIEW}`); raw.exec(`CREATE VIEW ${VIEW} AS SELECT 1 AS n WHERE 0`); }
    const current = catalog(); refused(await planFollowUpEvidenceInstall(input())); refused(await classify(p)); expect(catalog()).toEqual(current);
  });
  it("requires successful explicit view-read metadata for completed installation", async () => {
    const p = await plan(); execute(p); const o = input(); o.snapshot.readEvidence.pop();
    const r = await planFollowUpEvidenceInstall(o); expect(r.status).toBe("pending"); expect(r.reasonCodes).toEqual(["primary_metadata_unproven"]); expect(r.statements).toEqual([]);
  });
  it("refuses any unexpected candidate data instead of treating it as install replay", async () => {
    const p = await plan(); execute(p); const s = readSnapshot(); s.candidateTableCounts.follow_up_consumer_checkpoints = 1;
    const r = await classify(p, s); refused(r); expect(r.reasonCodes).toEqual(["unexpected_population"]);
  });
  it("retains unrelated tables and views but never executes caller-supplied catalog DDL", async () => {
    const o = input(), injected = "CREATE VIEW supplied_untrusted AS SELECT 'x; DROP TABLE automation_events;'";
    o.snapshot.catalog.push({ type: "view", name: "supplied_untrusted", tbl_name: "supplied_untrusted", sql: injected });
    const p = await plan(o); expect(p.statements.every((s) => !s.sql.includes("supplied_untrusted"))).toBe(true);
    expect(p.statements[1].params[0]).toContain(injected); expect(() => execute(p)).toThrow(/CHECK/); expect(rows("SELECT * FROM automation_events")).toHaveLength(1);
  });
  it("snapshots nested caller data before the first await", async () => {
    const o = input(), original = structuredClone(o), promise = planFollowUpEvidenceInstall(o); o.sourceRevision = "a".repeat(40); o.recovery.bookmark = "changed";
    o.snapshot.markers[1].applied_at++; const p = await promise; expect(p.status).toBe("planned"); expect(p.basis).toEqual(original);
  });
  it.each(["getter", "nested_getter", "symbol", "sparse", "prototype", "authority"])("rejects%s input without invoking accessors", async (kind) => {
    const o = input(); let reads = 0;
    if (kind === "getter") Object.defineProperty(o, "sourceRevision", { enumerable: true, get() { reads++; return SOURCE; } });
    else if (kind === "nested_getter") Object.defineProperty(o.snapshot.catalog[0], "sql", { enumerable: true, get() { reads++; return "secret"; } });
    else if (kind === "symbol") o[Symbol("x")] = true; else if (kind === "sparse") delete o.snapshot.catalog[0];
    else if (kind === "prototype") Object.setPrototypeOf(o.recovery, { authority: true }); else o.authority = true;
    const r = await planFollowUpEvidenceInstall(o); refused(r); expect(reads).toBe(0); expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("rejects oversized metadata with bounded sanitized failure", async () => {
    const o = input(); o.recovery.bookmark = "private-secret".repeat(200000); const r = await planFollowUpEvidenceInstall(o); refused(r); expect(JSON.stringify(r).length).toBeLessThan(1500);
  });
  it("is deterministic for the same snapshot and stays within D1 statement/string/binding bounds", async () => {
    const o = input(), a = await plan(o), b = await plan(o); expect(a).toEqual(b);
    expect(a.statements.length).toBeLessThanOrEqual(50);
    for (const s of a.statements) { expect(Buffer.byteLength(s.sql)).toBeLessThanOrEqual(100000); expect(s.params.length).toBeLessThanOrEqual(100);
      for (const p of s.params) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(2000000); }
    expect(a.statements.some((s) => /\bBEGIN\s+(?:IMMEDIATE|TRANSACTION)|\bCOMMIT\b/.test(s.sql))).toBe(false);
  });
  it("preserves semicolons, comments, quoted END and nested CASE inside a complete trigger", () => {
    const t = "CREATE TRIGGER fixture BEFORE INSERT ON test BEGIN SELECT CASE WHEN 1 THEN 'END; it''s quoted' ELSE 'a;b' END; /* END; */ SELECT 2; END;";
    const statements = splitFollowUpEvidenceSql(`-- before;\nCREATE TABLE test(n TEXT DEFAULT 'semi;colon');\n${t}\n-- after;`);
    expect(statements).toHaveLength(2); expect(statements[1]).toBe(t);
    expect(splitFollowUpEvidenceSql(effect)).toHaveLength(15); expect(splitFollowUpEvidenceSql(consumer)).toHaveLength(14);
  });
  it.each(ORIGINAL_ARTIFACTS)("changes only complete CASE wrappers in the $name artifact", ({ source, cases, sha256 }) => {
    expect(casePairs(source)).toHaveLength(cases);
    const original = removeCaseWrappers(source);
    expect(hash(original)).toBe(sha256); expect(hash(source)).not.toBe(sha256);
    expect(Buffer.byteLength(source) - Buffer.byteLength(original)).toBe(cases * 2);
  });
  it("pairs nested CASE expressions independently of quoted text, comments and the trigger END", () => {
    const source = "CREATE TRIGGER [CASE] AFTER INSERT ON t BEGIN SELECT (CASE WHEN 1 THEN (CASE WHEN 0 THEN 'END; it''s CASE' ELSE \"END\" END) ELSE `CASE` END); /* CASE END; */ -- END CASE\n END;";
    expect(casePairs(source)).toHaveLength(2);
    expect(removeCaseWrappers(source)).toBe("CREATE TRIGGER [CASE] AFTER INSERT ON t BEGIN SELECT CASE WHEN 1 THEN CASE WHEN 0 THEN 'END; it''s CASE' ELSE \"END\" END ELSE `CASE` END; /* CASE END; */ -- END CASE\n END;");
    expect(splitFollowUpEvidenceSql(source)).toEqual([source]);
  });
  it.each([
    "SELECT CASE WHEN 1 THEN 1 END;",
    "SELECT (CASE WHEN 1 THEN 1 END + 2);",
    "SELECT (1 + CASE WHEN 1 THEN 1 END);",
    "SELECT (CASE WHEN 1 THEN CASE WHEN 0 THEN 1 END ELSE 2 END);",
    "SELECT (CASE WHEN 1 THEN 1);",
  ])("detects an absent, partial or unclosed CASE wrapper: %s", (source) => {
    expect(() => removeCaseWrappers(source)).toThrow(/CASE/);
  });
  it("compiles identical SQLite guard programs and view bytecode before and after all36 wrappers", () => {
    const baseline = catalog(), databases = [];
    try {
      for (const sources of [[removeCaseWrappers(effect), removeCaseWrappers(consumer)], [effect, consumer]]) {
        const db = new DatabaseSync(":memory:"); databases.push(db); db.exec("PRAGMA foreign_keys=ON");
        // Only this test's trusted, locally constructed fixture DDL is copied.
        // SQLite creates its own implicit indexes and sqlite_sequence table.
        for (const type of ["table", "index", "view", "trigger"]) for (const row of baseline.filter((r) => r.type === type && r.sql && !r.name.startsWith("sqlite_"))) db.exec(row.sql);
        for (const source of sources) db.exec(source);
      }
      const statements = TABLES.flatMap((name) => [
        `INSERT INTO ${name} DEFAULT VALUES`, `INSERT OR REPLACE INTO ${name} DEFAULT VALUES`,
        `UPDATE ${name} SET rowid=rowid`, `DELETE FROM ${name}`,
      ]).concat(`SELECT * FROM ${VIEW}`);
      const bytecode = (db, statement) => {
        const virtualTables = new Map();
        return db.prepare(`EXPLAIN ${statement}`).all().map((row) => {
          let p4 = row.p4;
          // Trace is source spelling; VOpen embeds connection-local pointers.
          // Canonicalize pointer identity in first-use order, preserving aliases.
          // Every opcode and remaining operand/constant must remain identical.
          if (row.opcode === "Trace") p4 = "[statement source text]";
          else if (row.opcode === "VOpen" && /^vtab:[0-9A-F]+$/i.test(p4)) {
            if (!virtualTables.has(p4)) virtualTables.set(p4, `vtab:${virtualTables.size}`);
            p4 = virtualTables.get(p4);
          }
          return { ...row, p4 };
        });
      };
      for (const statement of statements) {
        const before = bytecode(databases[0], statement), after = bytecode(databases[1], statement);
        expect(after, statement).toEqual(before);
        if (!statement.startsWith("SELECT")) expect(after.some((r) => r.opcode === "Program"), statement).toBe(true);
      }
    } finally { for (const db of databases) db.close(); }
  });
  it.each([1, 0, null])("preserves CASE guard truth/NULL behavior and RAISE for input %s", (value) => {
    for (const wrapped of [false, true]) {
      const name = wrapped ? "wrapped_case_guard" : "original_case_guard";
      const expression = "CASE WHEN NEW.value<>1 THEN RAISE(ABORT,'case_guard_failed') END";
      raw.exec(`CREATE TABLE ${name}(value INTEGER); CREATE TRIGGER ${name}_trigger BEFORE INSERT ON ${name} BEGIN SELECT ${wrapped ? `(${expression})` : expression}; END;`);
      const insert = () => raw.prepare(`INSERT INTO ${name}(value) VALUES(?)`).run(value);
      if (value === 0) { expect(insert).toThrow("case_guard_failed"); expect(rows(`SELECT * FROM ${name}`)).toEqual([]); }
      else { insert(); expect(rows(`SELECT * FROM ${name}`)).toEqual([{ value }]); }
    }
  });
  it("does not relabel an old exact-empty installation as the revised artifact", async () => {
    raw.exec(removeCaseWrappers(effect)); raw.exec(removeCaseWrappers(consumer));
    const before = catalog(), r = await planFollowUpEvidenceInstall(input());
    refused(r); expect(r.reasonCodes).toEqual(["catalog_conflict"]); expect(catalog()).toEqual(before);
  });
  it.each(["DROP TABLE x;", "CREATE TABLE x(n TEXT DEFAULT 'unfinished);", "CREATE TABLE x(n INTEGER)", "CREATE TRIGGER t BEFORE INSERT ON x BEGIN SELECT 1;", "/* unclosed"])("refuses incomplete or unsupported SQL %s", (source) => {
    expect(() => splitFollowUpEvidenceSql(source)).toThrow(/unsupported_sql/);
  });
  it("makes no external request and returns no customer data or provider error", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("private-provider-secret")), p = await plan();
    expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(p)).not.toContain("private-contact"); expect(JSON.stringify(p)).not.toContain("private-provider-secret");
    const pending = await classify(p, null); expect(pending.status).toBe("pending"); expect(pending.classification).toBe("indeterminate"); flags(pending);
  });
});
