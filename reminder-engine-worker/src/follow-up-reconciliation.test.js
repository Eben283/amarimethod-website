import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_FAMILY, NORMALIZED_RETENTION_MS } from "../../functions/lib/reliability-contract.js";
import {
  FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION,
  FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE,
  FOLLOW_UP_RECONCILIATION_RUN_KIND,
  addFollowUpReconciliationDigest,
  canonicalReconciliationJson,
  followUpReconciliationRunId,
  readReliabilityHealth,
  validateFollowUpReconciliationDetail,
} from "../../functions/lib/reliability-store.js";
import {
  FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG,
  FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_VALUE,
  FollowUpReconciliationConflict,
  collectFollowUpReconciliation,
  runFollowUpReconciliationSourceOnly,
  writeFollowUpReconciliationRun,
} from "../../functions/lib/follow-up-reconciliation.js";
import { RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY } from "../../functions/lib/reliability-schema-authority.js";

const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const v2Sql = readFileSync(new URL("../reliability-spine-v2.local.sql", import.meta.url), "utf8");
const observed = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-observed-primary.v1.json",
  import.meta.url,
), "utf8"));
const promotion = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v2-production-lineage-promotion-observed-primary.v1.json",
  import.meta.url,
), "utf8"));
const schemaRows = observed.projection.map((row) => ({
  type: row.type, name: row.name, tbl_name: row.table, sql: row.sql,
}));
const schemaMarkers = promotion.rawPrimaryRows.schemaVersions;
const schemaContracts = promotion.rawPrimaryRows.schemaContracts;
const START = Date.UTC(2026, 7, 26, 8);
const END = START + 60_000;
const CHECKED = END + 1_000;
const D = (character) => character.repeat(64);
const SOURCE_VERSION = "ghl:appointment-events-webhook:v7";
const RUNTIME_VERSION = `${"b".repeat(40)}@follow-up-reminder-engine.v3`;

function resultRows(rows) {
  return { results: rows.map((row) => ({ ...row })) };
}

function d1FromSqlite(raw, { markerRows = schemaMarkers, contractRows = schemaContracts } = {}) {
  const counters = { batch: 0, inserts: 0, updates: 0, statements: [] };
  const statement = (sql) => ({
    sql,
    values: [],
    bind(...values) { this.values = values; return this; },
    first() {
      counters.statements.push(sql);
      return raw.prepare(sql).get(...this.values) || null;
    },
    all() {
      counters.statements.push(sql);
      if (/FROM\s+sqlite_master/i.test(sql)) return resultRows(schemaRows);
      if (/FROM\s+reliability_schema_versions/i.test(sql)) return resultRows(markerRows);
      if (/FROM\s+reliability_schema_contracts/i.test(sql)) return resultRows(contractRows);
      return resultRows(raw.prepare(sql).all(...this.values));
    },
    run() {
      counters.statements.push(sql);
      if (/^\s*INSERT\s+INTO\s+reconciliation_runs/i.test(sql)) counters.inserts += 1;
      if (/^\s*UPDATE\b/i.test(sql)) counters.updates += 1;
      const result = raw.prepare(sql).run(...this.values);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    counters,
    prepare: statement,
    async batch(statements) {
      counters.batch += 1;
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => /^\s*SELECT\b/i.test(item.sql) ? item.all() : item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  raw.exec(schemaSql);
  raw.exec(v2Sql);
  return { raw, db: d1FromSqlite(raw) };
}

function baseComponents() {
  return {
    schema: {
      truth: "Degraded",
      reason: "schema_authority_self_reported_unverified",
      readStatus: "complete",
      version: 2,
      variantId: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.variantId,
      migrationId: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.migrationId,
      migrationState: "current_v2",
      structureSha256: RELIABILITY_SCHEMA_V2_PRODUCTION_AUTHORITY.structureSha256,
    },
    ownedLedger: {
      truth: "Degraded",
      reason: "owned_ledger_self_reported_unverified",
      readStatus: "complete",
      queryVersion: "follow-up-owned-ledger.v1",
      identityDigest: D("1"),
      obligationSetDigest: D("2"),
      sourceEvents: 0,
      sourceTransitions: 0,
      acceptedSourceEvents: 0,
      rejectedSourceEvents: 0,
      lifecycleInstances: 0,
      obligations: 0,
      expectedObligations: 0,
      missingObligations: 0,
      unexpectedObligations: 0,
      commandAttempts: 0,
      openExceptions: 0,
      globalOrphanSourceTransitions: 0,
      globalOrphanLifecycles: 0,
      globalOrphanObligations: 0,
      globalOrphanCommandAttempts: 0,
      invariantViolations: 0,
    },
    runtimeProvenance: {
      truth: "Degraded",
      reason: "runtime_provenance_missing",
      readStatus: "missing",
      releaseManifestIds: [],
      deploymentAttestationIds: [],
      currentDeploymentAttestationId: null,
      attestationExpiresAt: null,
      attestationFresh: false,
      sourceBindings: 0,
      distinctRuntimeVersions: 0,
      unboundAcceptedSources: 0,
      bindingMismatches: 0,
      runtimeVersionMatch: false,
      identityDigest: D("3"),
    },
    ghlAppointmentEventSourceCoverage: {
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
    },
    providerReceipts: {
      truth: "Degraded",
      reason: "provider_receipt_coverage_missing",
      readStatus: "missing",
      expectedReceiptObligations: 0,
      coveredObligations: 0,
      acceptedObligations: 0,
      deliveredObligations: 0,
      failedObligations: 0,
      bouncedObligations: 0,
      unknownObligations: 0,
      zeroDenominatorProven: false,
      lookupErrors: 0,
      cursorExhausted: false,
      identityDigest: D("4"),
      obligationSetDigest: D("2"),
      coverageStart: START,
      coverageEnd: END,
    },
  };
}

function overallFor(components) {
  const reasons = Object.values(components).map((component) => component.reason);
  reasons.push("authority_false", "reconciliation_runtime_not_adopted", "simulation_only");
  return {
    truth: Object.values(components).some((component) => component.truth === "Unknown")
      ? "Unknown"
      : "Degraded",
    reasons: [...new Set(reasons)].sort(),
  };
}

function baseUnsigned() {
  const components = baseComponents();
  return {
    contractVersion: FOLLOW_UP_RECONCILIATION_CONTRACT_VERSION,
    runKind: FOLLOW_UP_RECONCILIATION_RUN_KIND,
    family: FOLLOW_UP_FAMILY,
    sourceVersion: SOURCE_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    startedAt: CHECKED - 500,
    checkedAt: CHECKED,
    simulation: true,
    authority: false,
    producerAdopted: false,
    evidenceScope: FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE,
    window: {
      expectedStart: START,
      expectedEnd: END,
      coverageStart: START,
      coverageEnd: END,
      paginationComplete: true,
      sampleRate: 1,
      activationWatermark: START,
      continuityStart: START,
    },
    components,
    overall: overallFor(components),
  };
}

async function signed(unsigned = baseUnsigned()) {
  const detail = await addFollowUpReconciliationDigest(unsigned);
  return { detail, detailJson: canonicalReconciliationJson(detail) };
}

function rowFor(collected) {
  const detail = collected.detail;
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
    detail_json: collected.detailJson,
    retention_until: detail.startedAt + NORMALIZED_RETENTION_MS,
  };
}

function failedComponent(unsigned, componentName, readStatus) {
  if (["ownedLedger", "runtimeProvenance", "providerReceipts"].includes(componentName)
    && unsigned.window.paginationComplete) {
    unsigned.window.paginationComplete = false;
    unsigned.window.coverageEnd = unsigned.window.expectedStart;
    for (const key of ["ownedLedger", "runtimeProvenance", "providerReceipts"]) {
      failedComponent(unsigned, key, readStatus);
    }
    return unsigned;
  }
  const component = unsigned.components[componentName];
  const prefixes = {
    schema: "schema_authority",
    ownedLedger: "owned_ledger",
    runtimeProvenance: "runtime_provenance",
    ghlAppointmentEventSourceCoverage: "ghl_appointment_event_source_coverage",
    providerReceipts: "provider_receipt_coverage",
  };
  const reasonSuffix = readStatus === "query_error"
    ? "query_failed"
    : readStatus === "permission_error" ? "permission_denied" : "timeout";
  const preserved = componentName === "ownedLedger"
    ? { truth: "Unknown", reason: prefixes[componentName] + "_" + reasonSuffix, readStatus, queryVersion: component.queryVersion }
    : { truth: "Unknown", reason: prefixes[componentName] + "_" + reasonSuffix, readStatus };
  unsigned.components[componentName] = Object.fromEntries(
    Object.keys(component).map((key) => [key, Object.hasOwn(preserved, key) ? preserved[key] : null]),
  );
  unsigned.overall = overallFor(unsigned.components);
  return unsigned;
}

describe("Follow-Up reconciliation v1 contract", () => {
  it("validates canonical bytes only as source-only Degraded and never exposes component Known", async () => {
    const collected = await signed();
    const result = await validateFollowUpReconciliationDetail(collected.detailJson, rowFor(collected));
    expect(result).toMatchObject({ valid: true, overall: { truth: "Degraded" } });
    expect(Object.values(result.components).every((component) => component.truth !== "Known")).toBe(true);
    expect(result.overall.reasons).toEqual([...new Set(result.overall.reasons)].sort());
    expect(result.overall.reasons).toEqual(expect.arrayContaining([
      "simulation_only", "authority_false", "reconciliation_runtime_not_adopted",
      "ghl_appointment_event_source_coverage_missing", "runtime_provenance_missing",
      "provider_receipt_coverage_missing",
    ]));
  });

  it.each([
    ["foreign family", (value) => { value.family = "other"; }],
    ["simulation off", (value) => { value.simulation = false; }],
    ["authority on", (value) => { value.authority = true; }],
    ["producer adopted", (value) => { value.producerAdopted = true; }],
    ["wrong scope", (value) => { value.evidenceScope = "claimed-authority"; }],
    ["wrong run kind", (value) => { value.runKind = "other"; }],
    ["wrong source identity", (value) => { value.sourceVersion = "operator@example.com"; }],
    ["wrong runtime identity", (value) => { value.runtimeVersion = "runtime:operator@example.com"; }],
    ["zero window", (value) => { value.window.expectedStart = value.window.expectedEnd; }],
    ["oversize window", (value) => { value.window.expectedStart = value.window.expectedEnd - 31 * 86_400_000 - 1; }],
    ["future end", (value) => { value.window.expectedEnd = value.checkedAt + 1; value.window.coverageEnd = value.checkedAt + 1; }],
    ["long completion lag", (value) => { value.checkedAt = value.window.expectedEnd + 86_400_001; }],
    ["coverage gap", (value) => { value.window.coverageStart = value.window.expectedStart + 1; }],
    ["incomplete local pagination", (value) => { value.window.paginationComplete = false; }],
    ["wrong sample", (value) => { value.window.sampleRate = 0.5; }],
    ["backwards run clock", (value) => { value.startedAt = value.checkedAt + 1; }],
  ])("rejects %s even when the digest is recomputed", async (_label, mutate) => {
    const unsigned = baseUnsigned();
    mutate(unsigned);
    unsigned.overall = overallFor(unsigned.components);
    const collected = await signed(unsigned);
    await expect(validateFollowUpReconciliationDetail(collected.detailJson)).resolves
      .toMatchObject({ valid: false });
  });

  it("rejects unknown keys, noncanonical JSON, stale digests, and optimistic component truth", async () => {
    const collected = await signed();
    const extra = JSON.parse(collected.detailJson);
    extra.clientName = "must-not-be-stored";
    delete extra.detailDigestSha256;
    const extraResult = await signed(extra);
    expect((await validateFollowUpReconciliationDetail(extraResult.detailJson)).valid).toBe(false);
    expect((await validateFollowUpReconciliationDetail(JSON.stringify(collected.detail, null, 2))).valid).toBe(false);
    const tampered = JSON.parse(collected.detailJson);
    tampered.sourceVersion = "changed";
    expect((await validateFollowUpReconciliationDetail(canonicalReconciliationJson(tampered))).valid).toBe(false);
    const optimistic = baseUnsigned();
    optimistic.components.ownedLedger.truth = "Known";
    optimistic.components.ownedLedger.reason = "owned_ledger_consistent";
    optimistic.overall = overallFor(optimistic.components);
    expect((await validateFollowUpReconciliationDetail((await signed(optimistic)).detailJson)).valid).toBe(false);
  });

  it("rejects missing external-read components that claim cursor or zero-denominator proof", async () => {
    const ghl = baseUnsigned();
    ghl.components.ghlAppointmentEventSourceCoverage.cursorExhausted = true;
    ghl.overall = overallFor(ghl.components);
    expect((await validateFollowUpReconciliationDetail((await signed(ghl)).detailJson)).valid).toBe(false);

    for (const key of ["cursorExhausted", "zeroDenominatorProven"]) {
      const provider = baseUnsigned();
      provider.components.providerReceipts[key] = true;
      provider.overall = overallFor(provider.components);
      expect((await validateFollowUpReconciliationDetail((await signed(provider)).detailJson)).valid).toBe(false);
    }
    const impossibleCounts = baseUnsigned();
    impossibleCounts.components.providerReceipts.coveredObligations = 1;
    impossibleCounts.overall = overallFor(impossibleCounts.components);
    expect((await validateFollowUpReconciliationDetail((await signed(impossibleCounts)).detailJson)).valid).toBe(false);
  });

  it.each([
    ["schema", "query_error"],
    ["ownedLedger", "query_error"],
    ["runtimeProvenance", "permission_error"],
    ["ghlAppointmentEventSourceCoverage", "timeout"],
    ["providerReceipts", "query_error"],
  ])("preserves %s %s as component and overall Unknown only with null evidence", async (component, status) => {
    const unsigned = failedComponent(baseUnsigned(), component, status);
    const collected = await signed(unsigned);
    const result = await validateFollowUpReconciliationDetail(collected.detailJson);
    expect(result).toMatchObject({ valid: true, overall: { truth: "Unknown" } });
    expect(result.components[component].truth).toBe("Unknown");
    const invalid = failedComponent(baseUnsigned(), component, status);
    const evidenceKey = Object.keys(invalid.components[component]).find(
      (key) => !["truth", "reason", "readStatus", "queryVersion"].includes(key),
    );
    invalid.components[component][evidenceKey] = 1;
    invalid.overall = overallFor(invalid.components);
    expect((await validateFollowUpReconciliationDetail((await signed(invalid)).detailJson)).valid).toBe(false);
  });

  it("binds every duplicated row field, deterministic identity, self-reported authority, and exact retention", async () => {
    const collected = await signed();
    const valid = rowFor(collected);
    expect((await validateFollowUpReconciliationDetail(collected.detailJson, valid)).valid).toBe(true);
    for (const [key, value] of [
      ["reconciliation_run_id", "other"],
      ["family", "other"],
      ["authority", "AUTOMATION_DB"],
      ["source_version", "ghl:appointment-events-webhook:v8"],
      ["runtime_version", `${"c".repeat(40)}@follow-up-reminder-engine.v3`],
      ["started_at", valid.started_at - 1],
      ["completed_at", valid.completed_at + 1],
      ["expected_start", valid.expected_start + 1],
      ["expected_end", valid.expected_end - 1],
      ["coverage_start", valid.coverage_start + 1],
      ["coverage_end", valid.coverage_end - 1],
      ["pagination_complete", 0],
      ["state", "complete"],
      ["detail_json", valid.detail_json + " "],
      ["retention_until", valid.retention_until - 1],
    ]) {
      expect((await validateFollowUpReconciliationDetail(collected.detailJson, { ...valid, [key]: value })).valid)
        .toBe(false);
    }
  });

  it("rejects unbounded or narrative identities, oversized arrays/details, and arbitrary GHL ownership prose", async () => {
    for (const version of ["runtime\nsecret", "Eben Smith <eben@example.com>", "user@example.com"]) {
      const unsigned = baseUnsigned();
      unsigned.runtimeVersion = version;
      expect((await validateFollowUpReconciliationDetail((await signed(unsigned)).detailJson)).valid).toBe(false);
    }
    const oversizedArray = baseUnsigned();
    oversizedArray.components.runtimeProvenance.releaseManifestIds = Array.from(
      { length: 129 }, (_item, index) => `release_${String(index).padStart(3, "0")}`,
    );
    oversizedArray.overall = overallFor(oversizedArray.components);
    expect((await validateFollowUpReconciliationDetail((await signed(oversizedArray)).detailJson)).valid).toBe(false);
    const emailArray = baseUnsigned();
    emailArray.components.runtimeProvenance.releaseManifestIds = ["runtime:john@example.com"];
    emailArray.overall = overallFor(emailArray.components);
    expect((await validateFollowUpReconciliationDetail((await signed(emailArray)).detailJson)).valid).toBe(false);
    const schemaPii = baseUnsigned();
    schemaPii.components.schema.variantId = "runtime:john@example.com";
    schemaPii.overall = overallFor(schemaPii.components);
    expect((await validateFollowUpReconciliationDetail((await signed(schemaPii)).detailJson)).valid).toBe(false);
    for (const [componentKey, field, value] of [
      ["schema", "variantId", "EbenSmith"],
      ["schema", "migrationId", "4155551212"],
      ["runtimeProvenance", "releaseManifestIds", ["EbenSmith"]],
      ["runtimeProvenance", "deploymentAttestationIds", ["4155551212"]],
      ["runtimeProvenance", "currentDeploymentAttestationId", "EbenSmith"],
      ["ghlAppointmentEventSourceCoverage", "workflowId", "4155551212"],
    ]) {
      const unsigned = baseUnsigned();
      unsigned.components[componentKey][field] = value;
      unsigned.overall = overallFor(unsigned.components);
      expect((await validateFollowUpReconciliationDetail((await signed(unsigned)).detailJson)).valid).toBe(false);
    }
    await expect(addFollowUpReconciliationDigest({ ...baseUnsigned(), padding: "x".repeat(70_000) }))
      .rejects.toThrow(/byte limit/);
    expect((await validateFollowUpReconciliationDetail("x".repeat(70_000))).valid).toBe(false);
    for (const [key, value] of [["accountableOwner", "somebody else"], ["limitation", "free text\nsecret"]]) {
      const unsigned = baseUnsigned();
      unsigned.components.ghlAppointmentEventSourceCoverage[key] = value;
      unsigned.overall = overallFor(unsigned.components);
      expect((await validateFollowUpReconciliationDetail((await signed(unsigned)).detailJson)).valid).toBe(false);
    }
  });

  it("canonicalizes recursively reordered input to the same bytes, digest, and run identity", async () => {
    const reverse = (value) => {
      if (Array.isArray(value)) return value.map(reverse);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)]));
    };
    const first = await signed(baseUnsigned());
    const second = await signed(reverse(baseUnsigned()));
    expect(first.detailJson).toBe(second.detailJson);
    expect(first.detail.detailDigestSha256).toBe(second.detail.detailDigestSha256);
    expect(followUpReconciliationRunId(first.detail.detailDigestSha256))
      .toBe(followUpReconciliationRunId(second.detail.detailDigestSha256));
    const { raw, db } = database();
    expect(await writeFollowUpReconciliationRun(db, first)).toMatchObject({ created: true });
    expect(await writeFollowUpReconciliationRun(db, second)).toMatchObject({ replayed: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM reconciliation_runs").get()).toEqual({ count: 1 });
  });
});

function insertWorkflow(raw) {
  const document = {
    id: FOLLOW_UP_FAMILY,
    name: "Follow-Up fixture",
    version: 3,
    exits: [],
    trigger: {
      event: "appointment_status_changed",
      calendarIds: ["ZO1jlGfy01rsxVqicoSB"],
      statuses: ["confirmed"],
      eventTypes: ["normal"],
    },
    nodes: [
      {
        id: "confirmation", label: "Confirmation", at: "enroll", skipIfPast: false,
        action: { type: "email", template: "confirmation" },
        message: { audience: "client", channel: "email", subject: "Fixture", body: "Fixture" },
      },
      {
        id: "day-before", label: "Day before", at: "start-1440m", skipIfPast: true,
        when: { field: "reminderPreference", equals: "full" },
        action: { type: "email", template: "day-before" },
        message: { audience: "client", channel: "email", subject: "Fixture", body: "Fixture" },
      },
    ],
  };
  raw.prepare("INSERT INTO workflow_versions (workflow_id,version,state,document,created_at,published_at) VALUES (?,3,'published',?,?,?)")
    .run(FOLLOW_UP_FAMILY, JSON.stringify(document), START - 10_000, START - 10_000);
}

function insertAccepted(raw, suffix, receivedAt, obligationState = "pending", transitionsOverride = null, effectiveStartOverride = null, transitionTimesOverride = null) {
  const retention = receivedAt + NORMALIZED_RETENTION_MS;
  const late = obligationState === "skipped";
  const effectiveStart = effectiveStartOverride ?? (late ? receivedAt : END + 2 * 86_400_000);
  const appointmentId = "appointment-" + suffix;
  const personId = "person-" + suffix;
  const payloadSha256 = createHash("sha256").update("payload-" + suffix).digest("hex");
  const normalized = {
    appointmentId,
    personId,
    calendarId: "ZO1jlGfy01rsxVqicoSB",
    status: "confirmed",
    eventKind: "normal",
    effectiveStart: new Date(effectiveStart).toISOString(),
    reminderPreference: "full",
  };
  const identityKey = "ghl:appointment-event:v1:" + [
    "ghl", appointmentId, normalized.eventKind, normalized.status, normalized.effectiveStart, payloadSha256,
  ].join(":");
  const sourceDigest = createHash("sha256")
    .update("ghl\u00001\u0000" + identityKey).digest("hex");
  const sourceId = "src_" + sourceDigest;
  const lifecycleId = "life_" + sourceDigest;
  raw.prepare("INSERT INTO source_events (source_event_id,provider,family,provider_event_id,identity_version,identity_key,payload_sha256,payload_reference,raw_retention_until,normalized_retention_until,occurred_at,received_at,authentication_result,normalization_state,normalized_json,rejection_reason,state,source_version,runtime_version,accepted_at,created_at) VALUES (?,'ghl',?,NULL,1,?,?,NULL,NULL,?,?,?,'authenticated','normalized',?,NULL,'accepted',?,?,?,?)")
    .run(sourceId, FOLLOW_UP_FAMILY, identityKey, payloadSha256, retention, receivedAt, receivedAt,
      JSON.stringify(normalized), SOURCE_VERSION, RUNTIME_VERSION, receivedAt, receivedAt);
  raw.prepare("INSERT INTO lifecycle_instances (lifecycle_instance_id,source_event_id,family,scope,person_id,appointment_id,definition_version,runtime_version,state,retention_until,created_at,updated_at) VALUES (?,?,?,'confirmed-normal-follow-up',?,?,3,?,'active',?,?,?)")
    .run(lifecycleId, sourceId, FOLLOW_UP_FAMILY, personId, appointmentId, RUNTIME_VERSION,
      retention, receivedAt, receivedAt);
  for (const key of ["confirmation", "day-before"]) {
    const deadlineAt = key === "confirmation" ? receivedAt : effectiveStart - 1_440 * 60_000;
    const state = key === "confirmation" ? "satisfied" : late ? "skipped" : "pending";
    const obligationId = "obl_" + createHash("sha256").update(lifecycleId + "\u0000" + key).digest("hex");
    raw.prepare("INSERT INTO lifecycle_obligations (obligation_id,lifecycle_instance_id,obligation_key,kind,family,deadline_at,owner_role,closer,state,retention_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'provider_receipt',?,?,?,?)")
      .run(obligationId, lifecycleId, key, "client_email", FOLLOW_UP_FAMILY,
        deadlineAt, "system", state, retention, receivedAt, receivedAt);
  }
  const transitionPath = transitionsOverride || ["received", "authenticated", "normalized", "accepted", "dispatched"];
  for (const [index, transition] of transitionPath.entries()) {
    const detail = transition === "accepted"
      ? JSON.stringify({ sourceVersion: SOURCE_VERSION, runtimeVersion: RUNTIME_VERSION })
      : transition === "deduplicated" ? JSON.stringify({ identityKey }) : null;
    const transitionId = "srct_" + createHash("sha256")
      .update("transition-" + suffix + "-" + index).digest("hex");
    raw.prepare("INSERT INTO source_event_transitions (source_transition_id,source_event_id,sequence,transition,occurred_at,detail_json,retention_until) VALUES (?,?,?,?,?,?,?)")
      .run(transitionId, sourceId, index + 1, transition,
        transitionTimesOverride?.[index] ?? receivedAt, detail, retention);
  }
  return { sourceId, lifecycleId };
}

function insertRejected(raw, suffix, receivedAt, { withException = true } = {}) {
  const retention = receivedAt + NORMALIZED_RETENTION_MS;
  const payloadSha256 = createHash("sha256").update("rejected-payload-" + suffix).digest("hex");
  const normalized = {
    appointmentId: "appointment-" + suffix,
    personId: "person-" + suffix,
    calendarId: "ZO1jlGfy01rsxVqicoSB",
    status: "confirmed",
    eventKind: "recurring",
    effectiveStart: new Date(END + 86_400_000).toISOString(),
    reminderPreference: "full",
  };
  const identityKey = [
    "ghl", "appointment-event", "v1-rejected", normalized.appointmentId,
    normalized.eventKind, normalized.status, normalized.effectiveStart, payloadSha256,
  ].join(":");
  const sourceDigest = createHash("sha256")
    .update("ghl\u00001\u0000" + identityKey).digest("hex");
  const sourceId = "src_" + sourceDigest;
  const reason = "Follow-Up event is outside the confirmed Normal entry contract";
  raw.prepare("INSERT INTO source_events (source_event_id,provider,family,provider_event_id,identity_version,identity_key,payload_sha256,payload_reference,raw_retention_until,normalized_retention_until,occurred_at,received_at,authentication_result,normalization_state,normalized_json,rejection_reason,state,source_version,runtime_version,accepted_at,created_at) VALUES (?,'ghl',?,NULL,1,?,?,NULL,NULL,?,?,?,'authenticated','ambiguous',?,?,'rejected',?,?,NULL,?)")
    .run(sourceId, FOLLOW_UP_FAMILY, identityKey, payloadSha256, retention, receivedAt, receivedAt,
      JSON.stringify(normalized), reason, SOURCE_VERSION, RUNTIME_VERSION, receivedAt);
  for (const [index, transition] of ["received", "authenticated", "rejected"].entries()) {
    const detail = transition === "rejected"
      ? JSON.stringify({ sourceVersion: SOURCE_VERSION, runtimeVersion: RUNTIME_VERSION }) : null;
    const transitionId = "srct_" + createHash("sha256")
      .update("rejected-transition-" + suffix + "-" + index).digest("hex");
    raw.prepare("INSERT INTO source_event_transitions (source_transition_id,source_event_id,sequence,transition,occurred_at,detail_json,retention_until) VALUES (?,?,?,?,?,?,?)")
      .run(transitionId, sourceId, index + 1, transition, receivedAt, detail, retention);
  }
  const exceptionId = "exc_" + createHash("sha256")
    .update(sourceId + "\u0000" + reason).digest("hex");
  if (withException) {
    raw.prepare("INSERT INTO lifecycle_exceptions (exception_id,family,source_event_id,lifecycle_instance_id,obligation_id,kind,severity,accountable_owner,next_safe_action,state,suppression_expires_at,retention_until,opened_at,updated_at) VALUES (?,?,?,NULL,NULL,'follow_up_entry_rejected','warning','Eben','inspect','open',NULL,?,?,?)")
      .run(exceptionId, FOLLOW_UP_FAMILY, sourceId, retention, receivedAt, receivedAt);
    const eventId = "exevt_" + createHash("sha256").update(exceptionId + "\u0000opened").digest("hex");
    raw.prepare("INSERT INTO exception_events (exception_event_id,exception_id,event_type,actor,occurred_at,evidence_sha256,detail_json,retention_until) VALUES (?,?,'opened','system',?,?,?,?)")
      .run(eventId, exceptionId, receivedAt, payloadSha256, JSON.stringify({ reason }), retention);
  }
  return { sourceId, exceptionId };
}

function collectInput(overrides = {}) {
  return {
    expectedStart: START,
    expectedEnd: END,
    startedAt: CHECKED - 100,
    checkedAt: CHECKED,
    sourceVersion: SOURCE_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    ...overrides,
  };
}

describe("source-only collector and insert-only writer", () => {
  it("rejects invalid clocks and version identities before any database read", async () => {
    let touches = 0;
    const untouched = new Proxy({}, { get() { touches += 1; throw new Error("database was touched"); } });
    await expect(collectFollowUpReconciliation({
      db: untouched, ...collectInput({ expectedEnd: CHECKED, startedAt: CHECKED - 1 }),
    })).rejects.toThrow(/window or chronology/);
    await expect(collectFollowUpReconciliation({
      db: untouched, ...collectInput({ runtimeVersion: "operator notes\nsecret" }),
    })).rejects.toThrow(/version identity/);
    for (const [key, value] of [
      ["sourceVersion", "ghl:appointment-events-webhook:v" + "1".repeat(200)],
      ["runtimeVersion", "b".repeat(40) + "@follow-up-reminder-engine.v" + "1".repeat(200)],
    ]) {
      await expect(collectFollowUpReconciliation({ db: untouched, ...collectInput({ [key]: value }) }))
        .rejects.toThrow(/version identity/);
    }
    expect(touches).toBe(0);
  });

  it.each(["query failure", "permission denied", "timeout"])("records canonical Unknown for a partial D1 batch: %s", async (failure) => {
    const { db } = database();
    const originalBatch = db.batch.bind(db);
    const failedDb = {
      ...db,
      async batch(statements) {
        const results = await originalBatch(statements);
        results[5] = { success: false, error: failure };
        return results;
      },
    };
    const collected = await collectFollowUpReconciliation({ db: failedDb, ...collectInput() });
    expect(collected.detail.window).toMatchObject({ paginationComplete: false, coverageStart: START, coverageEnd: START });
    expect(collected.detail.overall.truth).toBe("Unknown");
    for (const key of ["ownedLedger", "runtimeProvenance", "providerReceipts"]) {
      expect(collected.detail.components[key].truth).toBe("Unknown");
    }
    expect(db.counters.inserts).toBe(0);
    await writeFollowUpReconciliationRun(db, collected);
    expect(await readReliabilityHealth(db, { family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 100_000 }))
      .toMatchObject({ truth: "Unknown", reason: "coverage_unknown" });
  });

  it.each(["null", "undefined", "false", "sparse"])("never treats a %s batch slot as an empty successful query", async (kind) => {
    const { db } = database();
    const originalBatch = db.batch.bind(db);
    const broken = { ...db, async batch(statements) {
      const results = await originalBatch(statements);
      if (kind === "sparse") delete results[5];
      else results[5] = { null: null, undefined: undefined, false: false }[kind];
      return results;
    } };
    const collected = await collectFollowUpReconciliation({ db: broken, ...collectInput() });
    expect(collected.detail.window).toMatchObject({ paginationComplete: false, coverageEnd: START });
    expect(collected.detail.overall.truth).toBe("Unknown");
    expect(collected.detail.components.ownedLedger.sourceEvents).toBeNull();
  });

  it("binds accepted normalized entry, deterministic source/lifecycle identity, and trigger routing", async () => {
    const mutations = [
      (raw, record) => raw.prepare("UPDATE lifecycle_instances SET person_id='wrong-person' WHERE lifecycle_instance_id=?")
        .run(record.lifecycleId),
      (raw, record) => raw.prepare("UPDATE lifecycle_instances SET appointment_id='wrong-appointment' WHERE lifecycle_instance_id=?")
        .run(record.lifecycleId),
      (raw, record) => {
        raw.exec("DROP TRIGGER source_events_no_update");
        const normalized = JSON.parse(raw.prepare(
          "SELECT normalized_json FROM source_events WHERE source_event_id=?",
        ).get(record.sourceId).normalized_json);
        normalized.status = "noshow";
        raw.prepare("UPDATE source_events SET normalized_json=? WHERE source_event_id=?")
          .run(JSON.stringify(normalized), record.sourceId);
      },
      (raw, record) => {
        raw.exec("DROP TRIGGER source_events_no_update");
        const normalized = JSON.parse(raw.prepare(
          "SELECT normalized_json FROM source_events WHERE source_event_id=?",
        ).get(record.sourceId).normalized_json);
        normalized.eventKind = "recurring";
        raw.prepare("UPDATE source_events SET normalized_json=? WHERE source_event_id=?")
          .run(JSON.stringify(normalized), record.sourceId);
      },
      (raw, record) => {
        raw.exec("DROP TRIGGER source_events_no_update");
        const normalized = JSON.parse(raw.prepare(
          "SELECT normalized_json FROM source_events WHERE source_event_id=?",
        ).get(record.sourceId).normalized_json);
        normalized.calendarId = "not-an-approved-calendar";
        raw.prepare("UPDATE source_events SET normalized_json=? WHERE source_event_id=?")
          .run(JSON.stringify(normalized), record.sourceId);
      },
      (raw, record) => {
        raw.exec("DROP TRIGGER source_events_no_update");
        raw.prepare("UPDATE source_events SET identity_key='arbitrary-but-self-consistent' WHERE source_event_id=?")
          .run(record.sourceId);
      },
    ];
    for (const mutate of mutations) {
      const { raw, db } = database();
      insertWorkflow(raw);
      const record = insertAccepted(raw, "normalized-binding", START);
      mutate(raw, record);
      const owned = (await collectFollowUpReconciliation({ db, ...collectInput() }))
        .detail.components.ownedLedger;
      expect(owned.reason).toBe("owned_ledger_incomplete");
      expect(owned.invariantViolations).toBeGreaterThan(0);
    }
  });

  it("requires a rejected source's exact fallback identity and deterministic named exception", async () => {
    const complete = database();
    insertRejected(complete.raw, "rejected-complete", START);
    expect((await collectFollowUpReconciliation({ db: complete.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_self_reported_unverified", rejectedSourceEvents: 1, invariantViolations: 0,
    });

    const missing = database();
    insertRejected(missing.raw, "rejected-missing", START, { withException: false });
    expect((await collectFollowUpReconciliation({ db: missing.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", rejectedSourceEvents: 1, invariantViolations: 1,
    });
  });

  it("requires immutable exception opening evidence and binds its exact bytes", async () => {
    const { raw, db } = database();
    const record = insertRejected(raw, "exception-audit", START);
    const baseline = (await collectFollowUpReconciliation({ db, ...collectInput() })).detail.components.ownedLedger;
    raw.exec("DROP TRIGGER exception_events_no_update");
    raw.prepare("UPDATE exception_events SET detail_json='{}' WHERE exception_id=?").run(record.exceptionId);
    const mutated = (await collectFollowUpReconciliation({ db, ...collectInput() })).detail.components.ownedLedger;
    expect(mutated.reason).toBe("owned_ledger_incomplete");
    expect(mutated.identityDigest).not.toBe(baseline.identityDigest);
    raw.exec("DROP TRIGGER exception_events_no_delete");
    raw.prepare("DELETE FROM exception_events WHERE exception_id=?").run(record.exceptionId);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() })).detail.components.ownedLedger.reason)
      .toBe("owned_ledger_incomplete");
  });

  it.each(["destination", "duplicate", "modifiedBy"])("uses the runtime compiler/eligibility law for %s mutations", async (mutation) => {
    const { raw, db } = database();
    insertWorkflow(raw);
    insertAccepted(raw, "compiler", START);
    const document = JSON.parse(raw.prepare("SELECT document FROM workflow_versions").get().document);
    if (mutation === "destination") document.nodes[0].message.channel = "sms";
    if (mutation === "duplicate") document.nodes.push(document.nodes[0]);
    if (mutation === "modifiedBy") document.trigger.modifiedBy = ["contact"];
    raw.prepare("UPDATE workflow_versions SET document=?").run(JSON.stringify(document));
    expect((await collectFollowUpReconciliation({ db, ...collectInput() })).detail.components.ownedLedger.reason)
      .toBe("owned_ledger_incomplete");
  });

  it.each(["malformed", "oversized"])("keeps %s runtime identifiers out of persisted detail without aborting", async (mode) => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "runtime-ids", START);
    const originalBatch = db.batch.bind(db);
    const rows = Array.from({ length: mode === "oversized" ? 129 : 1 }, (_, index) => ({
      source_event_id: record.sourceId, lifecycle_instance_id: record.lifecycleId,
      invocation_id: "fixture", deployment_attestation_id: mode === "malformed" ? "EbenSmith" : "depatt_" + index.toString(16).padStart(64, "0"),
      release_manifest_id: mode === "malformed" ? "4155551212" : "relm_" + index.toString(16).padStart(64, "0"),
      cloudflare_version_id: "fixture", version_id: "fixture",
      attestation_runtime: RUNTIME_VERSION, manifest_runtime: RUNTIME_VERSION,
      workflow_document_sha256_at_bind: D("1"), workflow_document_sha256: D("1"),
      schema_structure_sha256_at_bind: D("2"), schema_structure_sha256: D("2"),
      follow_up_delivery_release_at_bind: "approved", follow_up_assigned_user_delivery_at_bind: "approved",
      bound_at: START, attestation_observed_at: START, attested_at: START,
      recorded_at: START, expires_at: CHECKED + 1_000, manifest_created_at: START,
      retention_until: START + NORMALIZED_RETENTION_MS,
      attestation_retention_until: START + NORMALIZED_RETENTION_MS,
      manifest_retention_until: START + NORMALIZED_RETENTION_MS,
    }));
    const injected = { ...db, async batch(statements) {
      const results = await originalBatch(statements);
      results[12] = resultRows(rows);
      return results;
    } };
    const collected = await collectFollowUpReconciliation({ db: injected, ...collectInput() });
    expect(collected.detail.components.runtimeProvenance).toMatchObject({
      truth: "Degraded", reason: "runtime_provenance_incomplete",
      releaseManifestIds: [], deploymentAttestationIds: [],
    });
    expect(collected.detailJson).not.toContain("EbenSmith");
    expect(collected.detailJson).not.toContain("4155551212");
    await expect(writeFollowUpReconciliationRun(db, collected)).resolves.toMatchObject({ created: true });
  });

  it("collects one [start,end) D1 snapshot, excludes cutoff rows, and never claims external/source-send ownership", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    insertAccepted(raw, "a", START - 1);
    const inWindow = insertAccepted(raw, "b", START);
    insertAccepted(raw, "c", END - 1, "skipped");
    insertAccepted(raw, "d", END);
    insertAccepted(raw, "e", END + 1);
    const confirmationId = "obl_" + createHash("sha256")
      .update(inWindow.lifecycleId + "\u0000confirmation").digest("hex");
    raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-after',?,'idem-after',1,'provider_idempotent','gmail',?,NULL,'ref-after','accepted',NULL,?,?,?)")
      .run(confirmationId, D("8"), END + NORMALIZED_RETENTION_MS, END, END);
    raw.prepare("INSERT INTO provider_receipts (provider_receipt_id,command_attempt_id,provider,provider_reference,proof_level,evidence_sha256,observed_at,retention_until,created_at) VALUES ('receipt-after','cmd-after','gmail','ref-after','delivered',?,?,?,?)")
      .run(D("9"), END, END + NORMALIZED_RETENTION_MS, END);

    const collected = await collectFollowUpReconciliation({ db, ...collectInput() });
    expect(db.counters.batch).toBe(1);
    expect(collected.detail.components.ownedLedger).toMatchObject({
      sourceEvents: 2,
      lifecycleInstances: 2,
      expectedObligations: 4,
      obligations: 4,
      missingObligations: 0,
      unexpectedObligations: 0,
      invariantViolations: 0,
    });
    expect(collected.detail.components.providerReceipts).toMatchObject({
      expectedReceiptObligations: 2,
      coveredObligations: 0,
      reason: "provider_receipt_coverage_missing",
    });
    expect(collected.detail.components.ghlAppointmentEventSourceCoverage).toMatchObject({
      reason: "ghl_appointment_event_source_coverage_missing",
      workflowName: null,
    });
    expect(collected.detail.overall).toMatchObject({ truth: "Degraded" });
    expect(collected.detail.overall.reasons).toContain("reconciliation_runtime_not_adopted");
    const persisted = canonicalReconciliationJson(collected.detail);
    for (const piiToken of ["person-b", "person-c", "appointment-b", "appointment-c", "identity-b", "identity-c"]) {
      expect(persisted).not.toContain(piiToken);
    }
  });

  it("is disabled by default without touching the database and has no production import or release binding", async () => {
    const untouched = new Proxy({}, { get() { throw new Error("database was touched"); } });
    await expect(runFollowUpReconciliationSourceOnly({ env: {}, db: untouched, input: collectInput() }))
      .resolves.toEqual({ enabled: false, created: false, replayed: false });
    const websiteRoot = fileURLToPath(new URL("../../", import.meta.url));
    const productionFiles = [];
    const inertSourceNames = new Set([
      "follow-up-reconciliation.js",
      "follow-up-reconciliation-drill.js",
    ]);
    const excludedDirectories = new Set([
      ".git", ".astro", ".vite", ".wrangler", "coverage", "dist", "docs",
      "fixtures", "node_modules", "test", "tests",
    ]);
    const walk = (path) => {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        if (statSync(child).isDirectory()) {
          if (!excludedDirectories.has(name)) walk(child);
        } else if (/\.(?:js|mjs|cjs|ts|tsx|toml|json)$/.test(name)
          && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)
          && !inertSourceNames.has(name)) productionFiles.push(child);
      }
    };
    walk(websiteRoot);
    productionFiles.push(
      join(websiteRoot, "reminder-engine-worker", "schema.sql"),
    );
    const unexpectedImports = productionFiles.filter((path) => {
      const contents = readFileSync(path, "utf8");
      const configReference = /(?:package\.json|wrangler\.toml|schema\.sql)$/.test(path)
        && contents.includes("follow-up-reconciliation");
      return configReference
        || /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'][^"']*follow-up-reconciliation(?:\.js)?["']/.test(contents)
        || contents.includes(FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG);
    });
    expect(unexpectedImports).toEqual([]);
    const source = readFileSync(new URL("../../functions/lib/follow-up-reconciliation.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(|UPDATE\s+reconciliation_runs|DELETE\s+FROM\s+reconciliation_runs/i);
  });

  it("inserts once, replays identical bytes without another INSERT, and rejects a deterministic collision", async () => {
    const { raw, db } = database();
    const collected = await signed();
    const first = await writeFollowUpReconciliationRun(db, collected);
    expect(first).toMatchObject({ created: true, replayed: false });
    expect(db.counters.inserts).toBe(1);
    const replay = await writeFollowUpReconciliationRun(db, collected);
    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(replay.row).toEqual(first.row);
    expect(db.counters.inserts).toBe(1);
    expect(db.counters.updates).toBe(0);

    raw.prepare("UPDATE reconciliation_runs SET source_version='collision' WHERE reconciliation_run_id=?")
      .run(first.row.reconciliation_run_id);
    await expect(writeFollowUpReconciliationRun(db, collected)).rejects.toBeInstanceOf(FollowUpReconciliationConflict);
    expect(raw.prepare("SELECT source_version FROM reconciliation_runs").get()).toEqual({ source_version: "collision" });
    expect(db.counters.inserts).toBe(1);
  });

  it("converges two identical concurrent attempts on one immutable row", async () => {
    const { raw, db } = database();
    const collected = await signed();
    let releasePreReads;
    let preReads = 0;
    const bothPreReads = new Promise((resolve) => { releasePreReads = resolve; });
    const racingDb = {
      ...db,
      prepare(sql) {
        const inner = db.prepare(sql);
        if (!/^SELECT \* FROM reconciliation_runs WHERE reconciliation_run_id = \?$/.test(sql)) return inner;
        return {
          bind(...values) { inner.bind(...values); return this; },
          async first() {
            preReads += 1;
            if (preReads <= 2) {
              if (preReads === 2) releasePreReads();
              await bothPreReads;
              return null;
            }
            return inner.first();
          },
        };
      },
    };
    const results = await Promise.all([
      writeFollowUpReconciliationRun(racingDb, collected),
      writeFollowUpReconciliationRun(racingDb, collected),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM reconciliation_runs").get()).toEqual({ count: 1 });
    expect(db.counters.inserts).toBe(2);
    expect(db.counters.updates).toBe(0);
  });

  it("fails the owned component for a same-count wrong transition path or wrong obligation binding", async () => {
    const first = database();
    insertWorkflow(first.raw);
    insertAccepted(first.raw, "route", START, "pending", [
      "received", "authenticated", "deduplicated", "accepted", "dispatched",
    ]);
    const wrongPath = await collectFollowUpReconciliation({ db: first.db, ...collectInput() });
    expect(wrongPath.detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });

    const second = database();
    insertWorkflow(second.raw);
    const { lifecycleId } = insertAccepted(second.raw, "binding", START);
    second.raw.prepare("UPDATE lifecycle_obligations SET kind='internal_sms' WHERE lifecycle_instance_id=? AND obligation_key='day-before'")
      .run(lifecycleId);
    const wrongBinding = await collectFollowUpReconciliation({ db: second.db, ...collectInput() });
    expect(wrongBinding.detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("does not label a source cohort with a different syntactically-valid source version", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    insertAccepted(raw, "version-mismatch", START);
    expect((await collectFollowUpReconciliation({
      db, ...collectInput({ sourceVersion: "ghl:appointment-events-webhook:v8" }),
    })).detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("binds the owned digest to every assertion-driving local snapshot surface", async () => {
    const collectDigest = async ({ transitions = null, mutate = null } = {}) => {
      const { raw, db } = database();
      insertWorkflow(raw);
      const record = insertAccepted(raw, "digest", START, "pending", transitions);
      if (mutate) mutate(raw, record);
      return (await collectFollowUpReconciliation({ db, ...collectInput() }))
        .detail.components.ownedLedger.identityDigest;
    };
    const baseline = await collectDigest();
    const variants = [
      await collectDigest({ transitions: [
        "received", "authenticated", "deduplicated", "accepted", "dispatched",
      ] }),
      await collectDigest({ mutate(raw, record) {
        raw.prepare("UPDATE lifecycle_instances SET scope='wrong-scope' WHERE lifecycle_instance_id=?")
          .run(record.lifecycleId);
      } }),
      await collectDigest({ mutate(raw, record) {
        raw.prepare("UPDATE lifecycle_obligations SET kind='internal_sms' WHERE lifecycle_instance_id=? AND obligation_key='day-before'")
          .run(record.lifecycleId);
      } }),
      await collectDigest({ mutate(raw, record) {
        const confirmationId = "obl_" + createHash("sha256")
          .update(record.lifecycleId + "\u0000confirmation").digest("hex");
        raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-digest',?,'idem-digest',1,'provider_idempotent','gmail',?,NULL,'ref-digest','accepted',NULL,?,?,?)")
          .run(confirmationId, D("8"), START + NORMALIZED_RETENTION_MS, START, START);
      } }),
      await collectDigest({ mutate(raw, record) {
        const confirmationId = "obl_" + createHash("sha256")
          .update(record.lifecycleId + "\u0000confirmation").digest("hex");
        raw.prepare("INSERT INTO lifecycle_exceptions (exception_id,family,source_event_id,lifecycle_instance_id,obligation_id,kind,severity,accountable_owner,next_safe_action,state,suppression_expires_at,retention_until,opened_at,updated_at) VALUES ('exc-digest',?,?,?,?,?,'warning','Eben','inspect','open',NULL,?,?,?)")
          .run(FOLLOW_UP_FAMILY, record.sourceId, record.lifecycleId, confirmationId, "missing_receipt",
            START + NORMALIZED_RETENTION_MS, START, START);
      } }),
    ];
    expect(variants.every((value) => value !== baseline)).toBe(true);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it("accepts the legal deduplicated replay interleaving before the one durable dispatch", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    insertAccepted(raw, "race", START, "pending", [
      "received", "authenticated", "normalized", "accepted", "deduplicated", "dispatched", "deduplicated",
    ]);
    const raced = (await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger;
    expect(raced).toMatchObject({
      reason: "owned_ledger_self_reported_unverified", invariantViolations: 0,
    });
    const ordinary = database();
    insertWorkflow(ordinary.raw);
    insertAccepted(ordinary.raw, "race", START);
    const ordinaryOwned = (await collectFollowUpReconciliation({ db: ordinary.db, ...collectInput() }))
      .detail.components.ownedLedger;
    expect(ordinaryOwned).toMatchObject({
      reason: "owned_ledger_self_reported_unverified", invariantViolations: 0,
    });
    expect(raced.identityDigest).not.toBe(ordinaryOwned.identityDigest);
  });

  it("defers every non-active lifecycle until an audited terminal-state law exists", async () => {
    const complete = database();
    insertWorkflow(complete.raw);
    const completed = insertAccepted(complete.raw, "completed-good", START);
    complete.raw.prepare("UPDATE lifecycle_obligations SET state='satisfied' WHERE lifecycle_instance_id=?")
      .run(completed.lifecycleId);
    complete.raw.prepare("UPDATE lifecycle_instances SET state='completed' WHERE lifecycle_instance_id=?")
      .run(completed.lifecycleId);
    expect((await collectFollowUpReconciliation({ db: complete.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });

    const incomplete = database();
    insertWorkflow(incomplete.raw);
    const terminal = insertAccepted(incomplete.raw, "completed-bad", START);
    incomplete.raw.prepare("UPDATE lifecycle_instances SET state='completed' WHERE lifecycle_instance_id=?")
      .run(terminal.lifecycleId);
    expect((await collectFollowUpReconciliation({ db: incomplete.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("treats global orphans outside the cohort window as a conservative integrity failure", async () => {
    const { raw, db } = database();
    raw.exec("PRAGMA foreign_keys=OFF");
    raw.prepare("INSERT INTO source_event_transitions (source_transition_id,source_event_id,sequence,transition,occurred_at,detail_json,retention_until) VALUES ('global-old-orphan','missing-source',1,'received',?,NULL,?)")
      .run(START - 86_400_000, START - 86_400_000 + NORMALIZED_RETENTION_MS);
    raw.exec("PRAGMA foreign_keys=ON");
    const owned = (await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger;
    expect(owned).toMatchObject({
      reason: "owned_ledger_incomplete",
      globalOrphanSourceTransitions: 1,
    });
  });

  it("rejects cross-linked exceptions and binds every exception fact into owned identity", async () => {
    const cross = database();
    insertWorkflow(cross.raw);
    const first = insertAccepted(cross.raw, "exception-a", START);
    const second = insertAccepted(cross.raw, "exception-b", START + 1);
    const secondObligation = "obl_" + createHash("sha256")
      .update(second.lifecycleId + "\u0000confirmation").digest("hex");
    cross.raw.prepare("INSERT INTO lifecycle_exceptions (exception_id,family,source_event_id,lifecycle_instance_id,obligation_id,kind,severity,accountable_owner,next_safe_action,state,suppression_expires_at,retention_until,opened_at,updated_at) VALUES ('cross-linked',?,?,?,?,?,'warning','Eben','inspect','open',NULL,?,?,?)")
      .run(FOLLOW_UP_FAMILY, first.sourceId, second.lifecycleId, secondObligation, "missing_receipt",
        START + NORMALIZED_RETENTION_MS, START + 2, START + 2);
    expect((await collectFollowUpReconciliation({ db: cross.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({ reason: "owned_ledger_incomplete" });

    const digestFor = async (kind, openedAt) => {
      const { raw, db } = database();
      insertWorkflow(raw);
      const record = insertAccepted(raw, "exception-digest", START);
      const obligationId = "obl_" + createHash("sha256")
        .update(record.lifecycleId + "\u0000confirmation").digest("hex");
      raw.prepare("INSERT INTO lifecycle_exceptions (exception_id,family,source_event_id,lifecycle_instance_id,obligation_id,kind,severity,accountable_owner,next_safe_action,state,suppression_expires_at,retention_until,opened_at,updated_at) VALUES ('exception-digest',?,?,?,?,?,'warning','Eben','inspect','open',NULL,?,?,?)")
        .run(FOLLOW_UP_FAMILY, record.sourceId, record.lifecycleId, obligationId, kind,
          openedAt + NORMALIZED_RETENTION_MS, openedAt, openedAt);
      return (await collectFollowUpReconciliation({ db, ...collectInput() }))
        .detail.components.ownedLedger.identityDigest;
    };
    const baseline = await digestFor("missing_receipt", START + 2);
    expect(await digestFor("different_kind", START + 2)).not.toBe(baseline);
    expect(await digestFor("missing_receipt", START + 3)).not.toBe(baseline);
  });

  it.each([
    ["deterministic id", "obligation_id", "wrong-obligation-id"],
    ["family", "family", "other-family"],
    ["kind", "kind", "internal_sms"],
    ["owner role", "owner_role", "assigned_user"],
    ["closer", "closer", "provider_exit_evidence"],
    ["deadline", "deadline_at", END + 86_400_001],
    ["skip direction", "state", "skipped"],
  ])("rejects an obligation with wrong %s even when the key and count match", async (_label, column, value) => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "obligation-field", START);
    raw.prepare(`UPDATE lifecycle_obligations SET ${column}=? WHERE lifecycle_instance_id=? AND obligation_key='day-before'`)
      .run(value, record.lifecycleId);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("binds the received and accepted transition clocks to their source row", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    insertAccepted(raw, "clock", START, "pending", null, null, [
      START + 1, START + 1, START + 1, START + 1, START + 1,
    ]);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("flags a command side effect attached to a skipped obligation", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "skipped-effect", START, "skipped");
    const skippedId = "obl_" + createHash("sha256")
      .update(record.lifecycleId + "\u0000day-before").digest("hex");
    raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-skipped',?,'idem-skipped',1,'provider_idempotent','gmail',?,NULL,'ref-skipped','accepted',NULL,?,?,?)")
      .run(skippedId, D("8"), START + NORMALIZED_RETENTION_MS, START, START);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({
      reason: "owned_ledger_incomplete", invariantViolations: 1,
    });
  });

  it("classifies conflicting terminal provider proofs as unknown instead of choosing one", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "receipt-conflict", START);
    const confirmationId = "obl_" + createHash("sha256")
      .update(record.lifecycleId + "\u0000confirmation").digest("hex");
    raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-conflict',?,'idem-conflict',1,'provider_idempotent','gmail',?,NULL,'ref-conflict','accepted',NULL,?,?,?)")
      .run(confirmationId, D("8"), START + NORMALIZED_RETENTION_MS, START, START);
    for (const [index, proof] of ["delivered", "bounced"].entries()) {
      raw.prepare("INSERT INTO provider_receipts (provider_receipt_id,command_attempt_id,provider,provider_reference,proof_level,evidence_sha256,observed_at,retention_until,created_at) VALUES (?,'cmd-conflict','gmail','ref-conflict',?,?,?,?,?)")
        .run(`receipt-conflict-${index}`, proof, D(String(index + 1)), START + index,
          START + NORMALIZED_RETENTION_MS, START + index);
    }
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.providerReceipts).toMatchObject({
      expectedReceiptObligations: 1,
      coveredObligations: 1,
      deliveredObligations: 0,
      bouncedObligations: 0,
      unknownObligations: 1,
      reason: "provider_receipt_coverage_missing",
    });
  });

  it.each([
    ["provider", "other-provider", "ref-exact", START + 2, START + 2],
    ["reference", "gmail", "wrong-reference", START + 2, START + 2],
    ["chronology", "gmail", "ref-exact", START, START],
    ["observation after receipt creation", "gmail", "ref-exact", START + 3, START + 2],
    ["invalid evidence digest", "gmail", "ref-exact", START + 2, START + 2],
  ])("classifies a receipt with invalid %s binding as unknown evidence", async (
    _label, provider, receiptReference, observedAt, receiptCreatedAt,
  ) => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "receipt-invalid-" + _label, START);
    const confirmationId = "obl_" + createHash("sha256")
      .update(record.lifecycleId + "\u0000confirmation").digest("hex");
    raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-invalid',?,'idem-invalid',1,'provider_idempotent','gmail',?,NULL,'ref-exact','accepted',NULL,?,?,?)")
      .run(confirmationId, D("8"), START + 1 + NORMALIZED_RETENTION_MS, START + 1, START + 1);
    raw.prepare("INSERT INTO provider_receipts (provider_receipt_id,command_attempt_id,provider,provider_reference,proof_level,evidence_sha256,observed_at,retention_until,created_at) VALUES ('receipt-invalid','cmd-invalid',?,?, 'delivered',?,?,?,?)")
      .run(provider, receiptReference, _label === "invalid evidence digest" ? "not-a-digest" : D("9"), observedAt,
        receiptCreatedAt + NORMALIZED_RETENTION_MS, receiptCreatedAt);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.providerReceipts).toMatchObject({
      expectedReceiptObligations: 1,
      coveredObligations: 1,
      deliveredObligations: 0,
      unknownObligations: 1,
      lookupErrors: 1,
    });
  });

  it("binds ignored and no-receipt provider rows into the local-receipt digest", async () => {
    const digestFor = async (target) => {
      const { raw, db } = database();
      insertWorkflow(raw);
      const record = insertAccepted(raw, "ignored-receipt", START, "skipped");
      const skippedId = "obl_" + createHash("sha256")
        .update(record.lifecycleId + "\u0000day-before").digest("hex");
      raw.prepare("INSERT INTO command_attempts (command_attempt_id,obligation_id,idempotency_key,attempt_number,retry_class,target,request_sha256,rendered_copy_sha256,provider_reference,state,error_code,retention_until,created_at,updated_at) VALUES ('cmd-ignored',?,'idem-ignored',1,'provider_idempotent',?,?,NULL,'ref-ignored','accepted',NULL,?,?,?)")
        .run(skippedId, target, D("8"), START + NORMALIZED_RETENTION_MS, START, START);
      return (await collectFollowUpReconciliation({ db, ...collectInput() }))
        .detail.components.providerReceipts.identityDigest;
    };
    expect(await digestFor("gmail")).not.toBe(await digestFor("ghl"));
  });

  it("fails when linked evidence is deletable at the reconciliation read clock", async () => {
    const { raw, db } = database();
    insertWorkflow(raw);
    const record = insertAccepted(raw, "retention-edge", START);
    raw.prepare("UPDATE lifecycle_obligations SET retention_until=? WHERE lifecycle_instance_id=? AND obligation_key='day-before'")
      .run(CHECKED, record.lifecycleId);
    expect((await collectFollowUpReconciliation({ db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({ reason: "owned_ledger_incomplete" });
  });

  it("treats a pending deadline before the half-open cutoff as overdue but the cutoff boundary as not overdue", async () => {
    const before = database();
    insertWorkflow(before.raw);
    insertAccepted(before.raw, "before", START, "pending", null, END + 86_400_000 - 1);
    expect((await collectFollowUpReconciliation({ db: before.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({ reason: "owned_ledger_incomplete", invariantViolations: 1 });

    const boundary = database();
    insertWorkflow(boundary.raw);
    insertAccepted(boundary.raw, "boundary", START, "pending", null, END + 86_400_000);
    expect((await collectFollowUpReconciliation({ db: boundary.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({ reason: "owned_ledger_self_reported_unverified", invariantViolations: 0 });

    const leased = database();
    insertWorkflow(leased.raw);
    const leasedRecord = insertAccepted(leased.raw, "leased", START, "pending", null, END + 86_400_000 - 1);
    leased.raw.prepare("UPDATE lifecycle_obligations SET state='leased',lease_owner='worker',lease_acquired_at=?,lease_expires_at=? WHERE lifecycle_instance_id=? AND obligation_key='day-before'")
      .run(START, END + 1_000, leasedRecord.lifecycleId);
    expect((await collectFollowUpReconciliation({ db: leased.db, ...collectInput() }))
      .detail.components.ownedLedger).toMatchObject({ reason: "owned_ledger_incomplete", invariantViolations: 1 });
  });

  it("requires the exact source-only release value and still persists only Degraded evidence", async () => {
    const { raw, db } = database();
    const wrong = await runFollowUpReconciliationSourceOnly({
      env: { [FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG]: "enabled" },
      db,
      input: collectInput(),
    });
    expect(wrong).toEqual({ enabled: false, created: false, replayed: false });
    const result = await runFollowUpReconciliationSourceOnly({
      env: {
        [FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_FLAG]:
          FOLLOW_UP_RECONCILIATION_SOURCE_ONLY_RELEASE_VALUE,
      },
      db,
      input: collectInput(),
    });
    expect(result).toMatchObject({ enabled: true, created: true, row: {
      authority: "SOURCE_ONLY_SELF_REPORTED",
      state: "degraded",
    } });
    expect(raw.prepare("SELECT COUNT(*) count FROM reconciliation_runs").get()).toEqual({ count: 1 });
  });
});

describe("Staff reconciliation health fail-closed precedence", () => {
  it("preserves unavailable authority for unsupported families and rejects future read clocks", async () => {
    expect(await readReliabilityHealth({ prepare() { throw new Error("schema unavailable"); } }, {
      family: "no-show-missed-count", nowMs: CHECKED, maxAgeMs: 100_000,
    })).toMatchObject({ truth: "Unknown", reason: "authority_read_failed" });
    const { db } = database();
    await writeFollowUpReconciliationRun(db, await signed());
    expect(await readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED - 120_000, maxAgeMs: 100_000,
    })).toMatchObject({ truth: "Degraded", reason: "coverage_clock_invalid" });
  });
  it("returns source-only Degraded when fresh, coverage_stale when stale, and never Known", async () => {
    const { db } = database();
    const collected = await signed();
    await writeFollowUpReconciliationRun(db, collected);
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 10_000,
    })).resolves.toMatchObject({
      truth: "Degraded", reason: "coverage_degraded",
      componentTruth: {
        schema: { truth: "Degraded", evidenceScope: FOLLOW_UP_RECONCILIATION_EVIDENCE_SCOPE },
      },
    });
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED + 20_000, maxAgeMs: 10_000,
    })).resolves.toMatchObject({ truth: "Degraded", reason: "coverage_stale" });
  });

  it("preserves component Unknown and annotates objective staleness", async () => {
    const { db } = database();
    const unsigned = failedComponent(baseUnsigned(), "runtimeProvenance", "timeout");
    const collected = await signed(unsigned);
    await writeFollowUpReconciliationRun(db, collected);
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 100_000,
    })).resolves.toMatchObject({ truth: "Unknown", reason: "coverage_unknown", stale: false });
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED + 20_000, maxAgeMs: 10_000,
    })).resolves.toMatchObject({
      truth: "Unknown", reason: "coverage_unknown", stale: true,
      reasons: expect.arrayContaining(["coverage_stale", "runtime_provenance_timeout"]),
    });
  });

  it("preserves schema-read Unknown across actual-schema mismatch and staleness annotations", async () => {
    const { db } = database();
    const unsigned = failedComponent(baseUnsigned(), "schema", "query_error");
    const collected = await signed(unsigned);
    await writeFollowUpReconciliationRun(db, collected);
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 10_000,
    })).resolves.toMatchObject({
      truth: "Unknown", reason: "coverage_unknown", stale: false, schemaMismatch: true,
      reasons: expect.arrayContaining(["schema_authority_query_failed", "coverage_schema_mismatch"]),
    });
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED + 20_000, maxAgeMs: 10_000,
    })).resolves.toMatchObject({
      truth: "Unknown", reason: "coverage_unknown", stale: true, schemaMismatch: true,
      reasons: expect.arrayContaining(["coverage_schema_mismatch", "coverage_stale"]),
    });
  });

  it("keeps a valid component Unknown dominant when current schema authority is unproven", async () => {
    const { raw, db } = database();
    const unsigned = failedComponent(baseUnsigned(), "runtimeProvenance", "timeout");
    await writeFollowUpReconciliationRun(db, await signed(unsigned));
    const wrongMarkers = schemaMarkers.map((row) => ({ ...row, description: "wrong-marker" }));
    const unproven = d1FromSqlite(raw, { markerRows: wrongMarkers });
    await expect(readReliabilityHealth(unproven, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 10_000,
    })).resolves.toMatchObject({
      truth: "Unknown", reason: "coverage_unknown", schemaMismatch: true,
      reasons: expect.arrayContaining(["runtime_provenance_timeout", "schema_unproven"]),
    });
  });

  it("fails closed when two distinct runs share the latest start clock", async () => {
    const { db } = database();
    const first = await signed();
    const secondUnsigned = baseUnsigned();
    secondUnsigned.sourceVersion = "ghl:appointment-events-webhook:v8";
    const second = await signed(secondUnsigned);
    await writeFollowUpReconciliationRun(db, first);
    await writeFollowUpReconciliationRun(db, second);
    await expect(readReliabilityHealth(db, {
      family: FOLLOW_UP_FAMILY, nowMs: CHECKED, maxAgeMs: 10_000,
    })).resolves.toMatchObject({ truth: "Degraded", reason: "coverage_ambiguous" });
  });
});
