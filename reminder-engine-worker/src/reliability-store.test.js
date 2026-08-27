import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { FOLLOW_UP_FAMILY, buildAcceptedLifecycle, buildRejectedSource } from "../../functions/lib/reliability-contract.js";
import {
  acceptLifecycle, leaseObligation, markSourceDispatched, readExceptionQueue, readReliabilityCounts, readReliabilityHealth,
  readSourceEventDetail, recordEvidenceAccess, rejectSourceEvent, transitionException,
} from "../../functions/lib/reliability-store.js";

const productionV1Fixture = JSON.parse(readFileSync(new URL(
  "../../docs/automation-truth/fixtures/reliability-v1-production-structure-readback.v1.json",
  import.meta.url,
), "utf8"));
const productionV1Rows = productionV1Fixture.projection.map((row) => ({
  type: row.type, name: row.name, tbl_name: row.table, sql: row.sql,
}));

function d1FromSqlite(raw, { sqliteMasterRows = null, schemaMarkers = null } = {}) {
  const statement = (sql) => ({
    sql,
    values: [],
    bind(...values) { this.values = values; return this; },
    first() { return raw.prepare(this.sql).get(...this.values) || null; },
    all() {
      if (sqliteMasterRows && /\bFROM\s+sqlite_master\b/i.test(this.sql)) {
        return { results: sqliteMasterRows.map((row) => ({ ...row })) };
      }
      if (schemaMarkers && /\bFROM\s+reliability_schema_versions\b/i.test(this.sql)) {
        return { results: schemaMarkers.map((row) => ({ ...row })) };
      }
      return { results: raw.prepare(this.sql).all(...this.values) };
    },
    run() {
      const result = raw.prepare(this.sql).run(...this.values);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    prepare: statement,
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const NOW = Date.UTC(2026, 7, 24, 16);
const acceptedInput = (over = {}) => ({
  exceptionFamily: FOLLOW_UP_FAMILY,
  provider: "ghl",
  providerEventId: "exec-1",
  identityVersion: 1,
  identityKey: "ghl:exec-1",
  payloadSha256: "a".repeat(64),
  payloadReference: "restricted://exec-1",
  rawRetentionUntil: NOW + 30 * 24 * 60 * 60 * 1000,
  occurredAt: NOW - 100,
  receivedAt: NOW,
  authenticationResult: "authenticated",
  normalizationState: "normalized",
  normalized: { appointmentId: "appt-1", eventType: "normal", status: "confirmed" },
  sourceVersion: "appointment-events-v1",
  runtimeVersion: "git:7f35492",
  lifecycle: {
    family: FOLLOW_UP_FAMILY,
    scope: "confirmed-normal-follow-up",
    personId: "person-1",
    appointmentId: "appt-1",
    definitionVersion: 2,
    runtimeVersion: "git:7f35492",
  },
  obligations: [
    { obligationKey: "confirmation-email", kind: "observe_confirmation", deadlineAt: NOW + 1_000, ownerRole: "system", closer: "provider_receipt" },
    { obligationKey: "day-before-email", kind: "observe_reminder", deadlineAt: NOW + 2_000, ownerRole: "system", closer: "provider_receipt" },
  ],
  ...over,
});

let raw;
let db;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  db = d1FromSqlite(raw, {
    sqliteMasterRows: productionV1Rows, schemaMarkers: productionV1Fixture.marker,
  });
});

describe("atomic source acceptance", () => {
  it("creates one source, one lifecycle, and the exact initial obligations", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    const result = await acceptLifecycle(db, record, NOW);
    expect(result).toMatchObject({ created: true, deduplicated: false });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(2);
    expect(raw.prepare("SELECT sequence, transition FROM source_event_transitions ORDER BY sequence").all())
      .toEqual([
        { sequence: 1, transition: "received" }, { sequence: 2, transition: "authenticated" },
        { sequence: 3, transition: "normalized" }, { sequence: 4, transition: "accepted" },
      ]);
  });

  it("collapses replay to the already-owned ids and creates no second obligation", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    await acceptLifecycle(db, record, NOW);
    const replay = await acceptLifecycle(db, record, NOW + 1);
    expect(replay).toMatchObject({ created: false, deduplicated: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(2);
    expect(raw.prepare("SELECT COUNT(*) count FROM source_event_transitions WHERE transition='deduplicated'").get().count).toBe(1);
  });

  it("keeps the first lifecycle definition and deadlines immutable when a replay arrives under a newer runtime", async () => {
    const first = await buildAcceptedLifecycle(acceptedInput());
    await acceptLifecycle(db, first, NOW);
    const later = await buildAcceptedLifecycle(acceptedInput({
      runtimeVersion: "git:new-runtime",
      lifecycle: { ...acceptedInput().lifecycle, definitionVersion: 3, runtimeVersion: "git:new-runtime" },
      obligations: acceptedInput().obligations.map((item) => ({ ...item, deadlineAt: item.deadlineAt + 50_000 })),
    }));
    const replay = await acceptLifecycle(db, later, NOW + 50_000);
    expect(replay).toMatchObject({ created: false, deduplicated: true });
    expect(replay.lifecycle).toMatchObject({ definition_version: 2, runtime_version: "git:7f35492" });
    expect(replay.obligations.map((item) => Number(item.deadline_at)).sort())
      .toEqual(first.obligations.map((item) => item.deadlineAt).sort());
  });

  it("records exactly one durable dispatch transition after atomic acceptance", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    const accepted = await acceptLifecycle(db, record, NOW);
    expect(await markSourceDispatched(db, { sourceEventId: accepted.sourceEvent.source_event_id, occurredAt: NOW + 1 }))
      .toMatchObject({ created: true, sourceEventId: accepted.sourceEvent.source_event_id });
    expect(await markSourceDispatched(db, { sourceEventId: accepted.sourceEvent.source_event_id, occurredAt: NOW + 2 }))
      .toMatchObject({ created: false, sourceEventId: accepted.sourceEvent.source_event_id });
    expect(raw.prepare("SELECT sequence, transition FROM source_event_transitions ORDER BY sequence").all())
      .toEqual([
        { sequence: 1, transition: "received" }, { sequence: 2, transition: "authenticated" },
        { sequence: 3, transition: "normalized" }, { sequence: 4, transition: "accepted" },
        { sequence: 5, transition: "dispatched" },
      ]);
  });

  it("atomically sequences simultaneous accepted replays", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    await acceptLifecycle(db, record, NOW);
    const results = await Promise.all([
      acceptLifecycle(db, record, NOW + 1),
      acceptLifecycle(db, record, NOW + 1),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ created: false, deduplicated: true }),
      expect.objectContaining({ created: false, deduplicated: true }),
    ]);
    expect(raw.prepare("SELECT sequence FROM source_event_transitions WHERE transition='deduplicated' ORDER BY sequence").all())
      .toEqual([{ sequence: 5 }, { sequence: 6 }]);
  });

  it("rejects a conflicting payload under the same provider identity", async () => {
    await acceptLifecycle(db, await buildAcceptedLifecycle(acceptedInput()), NOW);
    const collision = await buildAcceptedLifecycle(acceptedInput({ payloadSha256: "b".repeat(64) }));
    await expect(acceptLifecycle(db, collision, NOW + 1)).rejects.toThrow("identity collision");
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(2);
  });

  it("returns the winner's accepted lifecycle when two first deliveries race", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    let injectWinner = true;
    const racingDb = {
      prepare: db.prepare,
      async batch(statements) {
        if (injectWinner) {
          injectWinner = false;
          await acceptLifecycle(db, record, NOW);
        }
        return db.batch(statements);
      },
    };
    const result = await acceptLifecycle(racingDb, record, NOW + 1);
    expect(result).toMatchObject({ created: false, deduplicated: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(1);
  });

  it("rolls the whole D1 batch back when any initial obligation cannot persist", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    record.obligations[1].ownerRole = null;
    await expect(acceptLifecycle(db, record, NOW)).rejects.toThrow();
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_instances").get().count).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_obligations").get().count).toBe(0);
  });
});

describe("rejections, leases, and operator truth", () => {
  it("records ambiguous identity as source evidence plus an exception and no lifecycle", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), normalizationState: "ambiguous", rejectionReason: "provider event identity is ambiguous",
      nextSafeAction: "read provider execution identity", accountableOwner: "Eben",
    });
    await rejectSourceEvent(db, record, NOW);
    const detail = await readSourceEventDetail(db, record.sourceEvent.sourceEventId);
    expect(detail.sourceEvent.state).toBe("rejected");
    expect(detail.lifecycle).toBeNull();
    expect(detail.obligations).toEqual([]);
    expect(detail.exceptions).toHaveLength(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count).toBe(1);
  });

  it("returns the winner's rejected evidence when two first rejections race", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), normalizationState: "ambiguous", rejectionReason: "raced rejection",
      nextSafeAction: "inspect evidence",
    });
    let injectWinner = true;
    const racingDb = {
      prepare: db.prepare,
      async batch(statements) {
        if (injectWinner) {
          injectWinner = false;
          await rejectSourceEvent(db, record, NOW);
        }
        return db.batch(statements);
      },
    };
    const result = await rejectSourceEvent(racingDb, record, NOW + 1);
    expect(result).toMatchObject({ created: false, deduplicated: true });
    expect(raw.prepare("SELECT COUNT(*) count FROM source_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) count FROM lifecycle_exceptions").get().count).toBe(1);
  });

  it("atomically sequences simultaneous rejected replays", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), normalizationState: "ambiguous", rejectionReason: "concurrent replay",
      nextSafeAction: "inspect evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    const results = await Promise.all([
      rejectSourceEvent(db, record, NOW + 1),
      rejectSourceEvent(db, record, NOW + 1),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ created: false, deduplicated: true }),
      expect.objectContaining({ created: false, deduplicated: true }),
    ]);
    expect(raw.prepare("SELECT sequence FROM source_event_transitions WHERE transition='deduplicated' ORDER BY sequence").all())
      .toEqual([{ sequence: 4 }, { sequence: 5 }]);
  });

  it("allows only one live lease and records an expired-lease takeover", async () => {
    const record = await buildAcceptedLifecycle(acceptedInput());
    await acceptLifecycle(db, record, NOW);
    const obligationId = record.obligations[0].obligationId;
    expect(await leaseObligation(db, { obligationId, owner: "worker-a", nowMs: NOW, leaseMs: 100 })).toMatchObject({ acquired: true });
    expect(await leaseObligation(db, { obligationId, owner: "worker-b", nowMs: NOW + 50, leaseMs: 100 })).toEqual({ acquired: false });
    const takeover = await leaseObligation(db, { obligationId, owner: "worker-b", nowMs: NOW + 101, leaseMs: 100 });
    expect(takeover).toMatchObject({ acquired: true, obligation: { lease_owner: "worker-b" } });
    expect(raw.prepare("SELECT event_type, previous_owner, new_owner FROM obligation_lease_events ORDER BY lease_acquired_at").all()).toEqual([
      { event_type: "acquired", previous_owner: null, new_owner: "worker-a" },
      { event_type: "taken_over", previous_owner: "worker-a", new_owner: "worker-b" },
    ]);
  });

  it("never reports a healthy empty queue without proven fresh coverage", async () => {
    expect(await readReliabilityHealth(null, { family: FOLLOW_UP_FAMILY, nowMs: NOW, maxAgeMs: 1_000 }))
      .toMatchObject({ truth: "Unknown", reason: "authority_unavailable" });
    expect(await readReliabilityHealth(db, { family: FOLLOW_UP_FAMILY, nowMs: NOW, maxAgeMs: 1_000 }))
      .toMatchObject({ truth: "Degraded", reason: "coverage_missing", schemaVersion: 1 });
    raw.prepare(`INSERT INTO reconciliation_runs
      (reconciliation_run_id, family, authority, source_version, runtime_version, started_at, completed_at,
       expected_start, expected_end, coverage_start, coverage_end, pagination_complete, state, retention_until)
      VALUES ('r1',?,'AUTOMATION_DB','ghl-v1','git:test',?,?,?,?,?,?,1,'complete',?)`).run(
      FOLLOW_UP_FAMILY, NOW - 500, NOW - 100, NOW - 900, NOW - 200, NOW - 1_000, NOW - 100,
      NOW - 500 + 400 * 24 * 60 * 60 * 1000,
    );
    expect(await readReliabilityHealth(db, { family: FOLLOW_UP_FAMILY, nowMs: NOW, maxAgeMs: 1_000 }))
      .toMatchObject({ truth: "Degraded", reason: "coverage_contract_invalid" });
    expect(await readReliabilityHealth(db, { family: "no-show-missed-count", nowMs: NOW, maxAgeMs: 1_000 }))
      .toMatchObject({ truth: "Degraded", reason: "coverage_contract_unsupported" });
  });

  it("enforces immutable source and exception evidence in SQLite", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "bad identity", nextSafeAction: "inspect evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    expect(() => raw.prepare("UPDATE source_events SET rejection_reason='changed'").run()).toThrow("immutable");
    expect(() => raw.prepare("DELETE FROM exception_events").run()).toThrow("append-only");
  });

  it("drills one exception through acknowledge, investigate, and resolve with immutable audit", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "missing receipt", nextSafeAction: "inspect provider evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    expect(await readExceptionQueue(db)).toHaveLength(1);
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "open", toState: "acknowledged",
      actor: "Eben", occurredAt: NOW + 1, transitionId: "drill-ack",
    });
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "acknowledged", toState: "investigating",
      actor: "Eben", occurredAt: NOW + 2, transitionId: "drill-investigate",
    });
    const resolved = await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "investigating", toState: "resolved",
      actor: "Eben", occurredAt: NOW + 3, transitionId: "drill-resolve",
      evidenceSha256: "e".repeat(64), detail: { resolution: "provider record reconciled" },
    });
    expect(resolved.state).toBe("resolved");
    expect(await readExceptionQueue(db)).toEqual([]);
    const countAfterResolve = raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count;
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "investigating", toState: "resolved",
      actor: "Eben", occurredAt: NOW + 4, transitionId: "drill-stale-fresh-id",
      evidenceSha256: "e".repeat(64),
    })).rejects.toThrow(/changed during transition/);
    expect(raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count).toBe(countAfterResolve);
    expect(raw.prepare("SELECT state FROM lifecycle_exceptions").get()).toEqual({ state: "resolved" });
    expect(raw.prepare("SELECT event_type, actor FROM exception_events ORDER BY occurred_at").all()).toEqual([
      { event_type: "opened", actor: "system" },
      { event_type: "acknowledged", actor: "Eben" },
      { event_type: "investigating", actor: "Eben" },
      { event_type: "resolved", actor: "Eben" },
    ]);
  });

  it("keeps a reused exception transition id from changing state without an audit row", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "audit collision", nextSafeAction: "inspect provider evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "open", toState: "acknowledged",
      actor: "Eben", occurredAt: NOW + 1, transitionId: "same-transition",
    });
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "acknowledged", toState: "investigating",
      actor: "Eben", occurredAt: NOW + 2, transitionId: "same-transition",
    })).rejects.toThrow();
    expect(raw.prepare("SELECT state FROM lifecycle_exceptions WHERE exception_id=?").get(record.exception.exceptionId).state)
      .toBe("acknowledged");
  });

  it("rejects backwards audit clocks, invalid resolution evidence, and expired suppression before batching", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "audit guard", nextSafeAction: "inspect evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "open", toState: "acknowledged",
      actor: "Eben", occurredAt: NOW + 10, transitionId: "guard-ack",
    });
    const before = raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count;
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "acknowledged", toState: "investigating",
      actor: "Eben", occurredAt: NOW + 9, transitionId: "guard-backwards",
    })).rejects.toThrow(/changed during transition/);
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "acknowledged", toState: "resolved",
      actor: "Eben", occurredAt: NOW + 11, transitionId: "guard-no-evidence",
    })).rejects.toThrow(/requires evidenceSha256/);
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "acknowledged", toState: "suppressed_with_expiry",
      actor: "Eben", occurredAt: NOW + 11, transitionId: "guard-expired-suppression",
      suppressionExpiresAt: NOW + 11,
    })).rejects.toThrow(/suppression expiry/);
    expect(raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count).toBe(before);
    expect(raw.prepare("SELECT state,updated_at FROM lifecycle_exceptions").get())
      .toEqual({ state: "acknowledged", updated_at: NOW + 10 });
  });

  it("rolls back the inserted audit event when the state update fails mid-batch", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "forced update failure", nextSafeAction: "inspect evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    const eventCount = raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count;
    raw.exec(`CREATE TRIGGER test_exception_update_abort BEFORE UPDATE ON lifecycle_exceptions
      BEGIN SELECT RAISE(ABORT, 'forced exception update failure'); END`);
    await expect(transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "open", toState: "acknowledged",
      actor: "Eben", occurredAt: NOW + 1, transitionId: "forced-mid-batch-failure",
    })).rejects.toThrow(/forced exception update failure/);
    expect(raw.prepare("SELECT state FROM lifecycle_exceptions").get()).toEqual({ state: "open" });
    expect(raw.prepare("SELECT COUNT(*) count FROM exception_events").get().count).toBe(eventCount);
  });

  it("retains the exact suppression expiry in immutable audit after reopen", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "temporary suppression", nextSafeAction: "inspect after expiry",
    });
    await rejectSourceEvent(db, record, NOW);
    const expiresAt = NOW + 60_000;
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "open", toState: "suppressed_with_expiry",
      actor: "Eben", occurredAt: NOW + 1, transitionId: "suppress-with-expiry",
      suppressionExpiresAt: expiresAt, detail: { reasonCode: "awaiting_provider" },
    });
    await transitionException(db, {
      exceptionId: record.exception.exceptionId, fromState: "suppressed_with_expiry", toState: "open",
      actor: "Eben", occurredAt: expiresAt, transitionId: "reopen-after-expiry",
    });
    expect(raw.prepare("SELECT state,suppression_expires_at FROM lifecycle_exceptions").get())
      .toEqual({ state: "open", suppression_expires_at: null });
    const suppressed = raw.prepare("SELECT detail_json FROM exception_events WHERE exception_event_id='suppress-with-expiry'").get();
    expect(JSON.parse(suppressed.detail_json)).toEqual({
      reasonCode: "awaiting_provider", suppressionExpiresAt: expiresAt,
    });
    expect(() => raw.prepare("UPDATE exception_events SET detail_json='{}' WHERE exception_event_id='suppress-with-expiry'").run())
      .toThrow(/append-only/);
  });

  it("scopes counts, queues, and source detail to the requested lifecycle family", async () => {
    const record = await buildRejectedSource({
      ...acceptedInput(), rejectionReason: "family scope", nextSafeAction: "inspect evidence",
    });
    await rejectSourceEvent(db, record, NOW);
    expect(await readReliabilityCounts(db, { family: FOLLOW_UP_FAMILY })).toEqual({ sourceEventTotal: 1, exceptionTotal: 1 });
    expect(await readReliabilityCounts(db, { family: "other-family" })).toEqual({ sourceEventTotal: 0, exceptionTotal: 0 });
    expect(await readExceptionQueue(db, { family: "other-family" })).toEqual([]);
    expect(await readSourceEventDetail(db, record.sourceEvent.sourceEventId, { family: "other-family" })).toBeNull();
  });

  it("records every Staff evidence read as immutable retained evidence", async () => {
    const first = await recordEvidenceAccess(db, {
      actor: "Eben", family: FOLLOW_UP_FAMILY, action: "view_summary", occurredAt: NOW,
    });
    const second = await recordEvidenceAccess(db, {
      actor: "Eben", family: FOLLOW_UP_FAMILY, action: "view_summary", occurredAt: NOW,
    });
    expect(first).not.toBe(second);
    expect(raw.prepare("SELECT COUNT(*) count FROM evidence_access_events").get().count).toBe(2);
    expect(() => raw.prepare("UPDATE evidence_access_events SET actor='other'").run()).toThrow("append-only");
  });
});
