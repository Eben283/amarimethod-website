import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  FOLLOW_UP_FAMILY,
  NORMALIZED_RETENTION_MS,
  buildAcceptedLifecycle,
  sha256Hex,
} from "../../functions/lib/reliability-contract.js";
import {
  acceptLifecycle,
  markSourceDispatched,
  readExceptionQueue,
  transitionException,
} from "../../functions/lib/reliability-store.js";

export const FOLLOW_UP_OPERATOR_DRILL_VERSION = "follow-up-reconciliation-operator-drill.v1";

const DEFAULT_NOW_MS = Date.UTC(2026, 7, 27, 5, 0, 0);
const SIMULATED_APPOINTMENT_ID = "simulation-only-appointment";
const SIMULATED_PERSON_ID = "simulation-only-person";

function changesOf(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function d1FromSqlite(raw) {
  const statement = (sql) => ({
    sql,
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    first() {
      return raw.prepare(this.sql).get(...this.values) || null;
    },
    all() {
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

function count(raw, table) {
  return Number(raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function exceptionState(raw, exceptionId) {
  return raw.prepare(
    "SELECT state FROM lifecycle_exceptions WHERE exception_id = ?",
  ).get(exceptionId)?.state || null;
}

async function seedAcceptedMissingReceipt(raw, db, { nowMs }) {
  const record = await buildAcceptedLifecycle({
    provider: "simulation-only",
    providerEventId: "simulation-only-follow-up-receipt-drill",
    identityVersion: 1,
    identityKey: "simulation-only:follow-up:missing-provider-receipt",
    payloadSha256: await sha256Hex("simulation-only accepted Follow-Up source evidence"),
    payloadReference: null,
    rawRetentionUntil: null,
    occurredAt: nowMs - 2_000,
    receivedAt: nowMs - 1_000,
    authenticationResult: "authenticated",
    normalizationState: "normalized",
    normalized: {
      appointmentId: SIMULATED_APPOINTMENT_ID,
      eventType: "normal",
      simulation: true,
      status: "confirmed",
    },
    sourceVersion: "simulation-only-source.v1",
    runtimeVersion: "local-memory-only",
    lifecycle: {
      family: FOLLOW_UP_FAMILY,
      scope: "confirmed-normal-follow-up",
      personId: SIMULATED_PERSON_ID,
      appointmentId: SIMULATED_APPOINTMENT_ID,
      definitionVersion: 3,
      runtimeVersion: "local-memory-only",
    },
    obligations: [{
      obligationKey: "confirmation-email-provider-receipt",
      kind: "observe_provider_receipt",
      deadlineAt: nowMs - 500,
      ownerRole: "reconciliation",
      closer: "provider_receipt",
    }],
  });
  const accepted = await acceptLifecycle(db, record, nowMs - 1_000);
  await markSourceDispatched(db, {
    sourceEventId: accepted.sourceEvent.source_event_id,
    occurredAt: nowMs - 900,
  });

  const sourceEventId = accepted.sourceEvent.source_event_id;
  const lifecycleInstanceId = accepted.lifecycle.lifecycle_instance_id;
  const obligationId = accepted.obligations[0].obligation_id;
  const commandAttemptId = "cmd_simulation_only_missing_receipt";
  const exceptionId = "exc_simulation_only_missing_provider_receipt";
  const openedEventId = "exevt_simulation_only_missing_provider_receipt_opened";
  const openedAt = nowMs;
  const openedEvidenceSha256 = await sha256Hex(
    `${commandAttemptId}\u0000expected provider receipt absent`,
  );
  const retentionUntil = openedAt + NORMALIZED_RETENTION_MS;
  const commandCreatedAt = nowMs - 800;
  const command = db.prepare(`INSERT INTO command_attempts
    (command_attempt_id, obligation_id, idempotency_key, attempt_number, retry_class, target,
     request_sha256, rendered_copy_sha256, provider_reference, state, error_code,
     retention_until, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'accepted',NULL,?,?,?)`).bind(
    commandAttemptId,
    obligationId,
    "simulation-only:follow-up:confirmation-email",
    1,
    "manual_ambiguous",
    "simulation-only://provider-receipt",
    await sha256Hex("simulation-only provider command request"),
    await sha256Hex("simulation-only rendered message"),
    "simulation-only-provider-reference",
    commandCreatedAt + NORMALIZED_RETENTION_MS,
    commandCreatedAt,
    commandCreatedAt,
  );
  const exception = db.prepare(`INSERT INTO lifecycle_exceptions
    (exception_id, family, source_event_id, lifecycle_instance_id, obligation_id, kind, severity,
     accountable_owner, next_safe_action, state, suppression_expires_at, retention_until, opened_at, updated_at)
    VALUES (?,?,?,?,?,'missing_provider_receipt','warning','Eben',
      'Inspect the simulated receipt evidence only','open',NULL,?,?,?)`).bind(
    exceptionId,
    FOLLOW_UP_FAMILY,
    sourceEventId,
    lifecycleInstanceId,
    obligationId,
    retentionUntil,
    openedAt,
    openedAt,
  );
  const opened = db.prepare(`INSERT INTO exception_events
    (exception_event_id, exception_id, event_type, actor, occurred_at, evidence_sha256, detail_json, retention_until)
    VALUES (?,?,'opened','system',?,?,?,?)`).bind(
    openedEventId,
    exceptionId,
    openedAt,
    openedEvidenceSha256,
    JSON.stringify({
      action: "open",
      commandAttemptId,
      reason: "expected provider receipt absent",
      simulation: true,
    }),
    retentionUntil,
  );
  const results = await db.batch([command, exception, opened]);
  if (results.some((result) => changesOf(result) !== 1)) {
    throw new Error("simulated missing-receipt evidence was not created atomically");
  }

  return {
    commandAttemptId,
    exceptionId,
    lifecycleInstanceId,
    obligationId,
    openedAt,
    openedEvidenceSha256,
    sourceEventId,
  };
}

async function expectRejectedTransition(operation, label) {
  try {
    await operation();
  } catch {
    return true;
  }
  throw new Error(`${label} was unexpectedly accepted`);
}

function assertExactAudit(events, expected) {
  if (events.length !== expected.length) throw new Error("operator drill audit event count mismatch");
  if (new Set(events.map((event) => event.exception_event_id)).size !== events.length) {
    throw new Error("operator drill audit event ids are not unique");
  }
  events.forEach((event, index) => {
    const want = expected[index];
    if (event.event_type !== want.eventType || event.actor !== want.actor || Number(event.occurred_at) !== want.occurredAt) {
      throw new Error(`operator drill audit event ${index} identity mismatch`);
    }
    if (event.evidence_sha256 !== want.evidenceSha256) {
      throw new Error(`operator drill audit event ${index} evidence mismatch`);
    }
    const detail = JSON.parse(event.detail_json || "null");
    if (!detail || detail.simulation !== true || detail.action !== want.action) {
      throw new Error(`operator drill audit event ${index} detail mismatch`);
    }
  });
}

export async function runFollowUpReconciliationOperatorDrill({
  actor = "Eben",
  nowMs = DEFAULT_NOW_MS,
} = {}) {
  if (actor !== "Eben" || !Number.isSafeInteger(nowMs)) {
    throw new TypeError("operator drill requires actor Eben and integer nowMs");
  }

  const raw = new DatabaseSync(":memory:");
  try {
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
    const db = d1FromSqlite(raw);
    const seeded = await seedAcceptedMissingReceipt(raw, db, { nowMs });
    const sourceBefore = raw.prepare(
      "SELECT * FROM source_events WHERE source_event_id = ?",
    ).get(seeded.sourceEventId);

    const acknowledgeEvidence = await sha256Hex("simulation-only operator acknowledgement");
    const investigateEvidence = await sha256Hex("simulation-only operator investigation");
    const resolveEvidence = await sha256Hex("simulation-only receipt absence reconciled");
    const acknowledgeId = "exevt_simulation_only_missing_receipt_acknowledged";
    const investigateId = "exevt_simulation_only_missing_receipt_investigating";
    const resolveId = "exevt_simulation_only_missing_receipt_resolved";
    const queueStates = [];
    const assertQueueState = async (expectedState) => {
      const queue = await readExceptionQueue(db, { family: FOLLOW_UP_FAMILY });
      const item = queue.find((row) => row.exception_id === seeded.exceptionId);
      if (!item || item.state !== expectedState) {
        throw new Error(`simulated exception was not visible in Staff queue as ${expectedState}`);
      }
      queueStates.push(expectedState);
    };
    await assertQueueState("open");

    await transitionException(db, {
      exceptionId: seeded.exceptionId,
      fromState: "open",
      toState: "acknowledged",
      actor,
      occurredAt: nowMs + 1,
      transitionId: acknowledgeId,
      evidenceSha256: acknowledgeEvidence,
      detail: { action: "acknowledge", simulation: true },
    });
    await assertQueueState("acknowledged");

    const eventsAfterAcknowledge = count(raw, "exception_events");
    const reusedTransitionBlocked = await expectRejectedTransition(
      () => transitionException(db, {
        exceptionId: seeded.exceptionId,
        fromState: "acknowledged",
        toState: "investigating",
        actor,
        occurredAt: nowMs + 2,
        transitionId: acknowledgeId,
        evidenceSha256: investigateEvidence,
        detail: { action: "investigate", simulation: true },
      }),
      "reused exception transition id",
    );
    if (exceptionState(raw, seeded.exceptionId) !== "acknowledged"
      || count(raw, "exception_events") !== eventsAfterAcknowledge) {
      throw new Error("reused exception transition did not roll back atomically");
    }

    await transitionException(db, {
      exceptionId: seeded.exceptionId,
      fromState: "acknowledged",
      toState: "investigating",
      actor,
      occurredAt: nowMs + 2,
      transitionId: investigateId,
      evidenceSha256: investigateEvidence,
      detail: { action: "investigate", simulation: true },
    });
    await assertQueueState("investigating");

    const eventsAfterInvestigating = count(raw, "exception_events");
    const staleTransitionBlocked = await expectRejectedTransition(
      () => transitionException(db, {
        exceptionId: seeded.exceptionId,
        fromState: "acknowledged",
        toState: "resolved",
        actor,
        occurredAt: nowMs + 3,
        transitionId: "exevt_simulation_only_stale_transition",
        evidenceSha256: resolveEvidence,
        detail: { action: "resolve", simulation: true },
      }),
      "stale exception transition",
    );
    if (exceptionState(raw, seeded.exceptionId) !== "investigating"
      || count(raw, "exception_events") !== eventsAfterInvestigating) {
      throw new Error("stale exception transition changed state or audit evidence");
    }

    await transitionException(db, {
      exceptionId: seeded.exceptionId,
      fromState: "investigating",
      toState: "resolved",
      actor,
      occurredAt: nowMs + 3,
      transitionId: resolveId,
      evidenceSha256: resolveEvidence,
      detail: { action: "resolve", simulation: true },
    });

    const eventsAfterResolve = count(raw, "exception_events");
    const staleTargetReplayBlocked = await expectRejectedTransition(
      () => transitionException(db, {
        exceptionId: seeded.exceptionId,
        fromState: "investigating",
        toState: "resolved",
        actor,
        occurredAt: nowMs + 4,
        transitionId: "exevt_simulation_only_stale_target_replay",
        evidenceSha256: resolveEvidence,
        detail: { action: "resolve", simulation: true },
      }),
      "stale exception target replay",
    );
    if (exceptionState(raw, seeded.exceptionId) !== "resolved"
      || count(raw, "exception_events") !== eventsAfterResolve) {
      throw new Error("stale target replay appended false audit evidence");
    }

    let immutableSourceBlocked = false;
    try {
      raw.prepare("UPDATE source_events SET runtime_version = 'changed' WHERE source_event_id = ?")
        .run(seeded.sourceEventId);
    } catch {
      immutableSourceBlocked = true;
    }
    const sourceAfter = raw.prepare(
      "SELECT * FROM source_events WHERE source_event_id = ?",
    ).get(seeded.sourceEventId);
    if (!immutableSourceBlocked || JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) {
      throw new Error("accepted source evidence was mutable");
    }

    const events = raw.prepare(
      "SELECT * FROM exception_events WHERE exception_id = ? ORDER BY occurred_at, exception_event_id",
    ).all(seeded.exceptionId);
    assertExactAudit(events, [
      {
        action: "open",
        actor: "system",
        eventType: "opened",
        evidenceSha256: seeded.openedEvidenceSha256,
        occurredAt: seeded.openedAt,
      },
      {
        action: "acknowledge",
        actor,
        eventType: "acknowledged",
        evidenceSha256: acknowledgeEvidence,
        occurredAt: nowMs + 1,
      },
      {
        action: "investigate",
        actor,
        eventType: "investigating",
        evidenceSha256: investigateEvidence,
        occurredAt: nowMs + 2,
      },
      {
        action: "resolve",
        actor,
        eventType: "resolved",
        evidenceSha256: resolveEvidence,
        occurredAt: nowMs + 3,
      },
    ]);

    const exception = raw.prepare(
      "SELECT * FROM lifecycle_exceptions WHERE exception_id = ?",
    ).get(seeded.exceptionId);
    if (exception.source_event_id !== seeded.sourceEventId
      || exception.lifecycle_instance_id !== seeded.lifecycleInstanceId
      || exception.obligation_id !== seeded.obligationId) {
      throw new Error("missing-receipt exception is not linked to its accepted lifecycle obligation");
    }
    if (sourceAfter.state !== "accepted") {
      throw new Error("missing-receipt drill changed the accepted source state");
    }
    const obligationState = raw.prepare(
      "SELECT state FROM lifecycle_obligations WHERE obligation_id = ?",
    ).get(seeded.obligationId)?.state;
    if (obligationState !== "pending" || count(raw, "provider_receipts") !== 0) {
      throw new Error("operator mechanics drill invented an obligation outcome or provider receipt");
    }
    if ((await readExceptionQueue(db, { family: FOLLOW_UP_FAMILY })).length !== 0) {
      throw new Error("resolved simulated exception remained in the active queue");
    }
    queueStates.push("resolved_absent");

    return {
      drillVersion: FOLLOW_UP_OPERATOR_DRILL_VERSION,
      simulation: true,
      authority: false,
      productionHealthImpact: false,
      mechanicsOnly: true,
      providerReceiptObserved: false,
      obligationOutcomeProven: false,
      family: FOLLOW_UP_FAMILY,
      sourceState: sourceAfter.state,
      finalObligationState: obligationState,
      finalExceptionState: exception.state,
      sourceEventId: seeded.sourceEventId,
      lifecycleInstanceId: seeded.lifecycleInstanceId,
      obligationId: seeded.obligationId,
      commandAttemptId: seeded.commandAttemptId,
      exceptionId: seeded.exceptionId,
      auditEvents: events.map((event) => ({
        actor: event.actor,
        detail: JSON.parse(event.detail_json),
        eventId: event.exception_event_id,
        eventType: event.event_type,
        evidenceSha256: event.evidence_sha256,
        occurredAt: Number(event.occurred_at),
      })),
      checks: {
        immutableSourceBlocked,
        queueLifecycleVisible: queueStates.join("|") === "open|acknowledged|investigating|resolved_absent",
        reusedTransitionBlocked,
        staleTargetReplayBlocked,
        staleTransitionBlocked,
      },
      queueStates,
      localDatabaseCounts: {
        commandAttempts: count(raw, "command_attempts"),
        exceptionEvents: count(raw, "exception_events"),
        exceptions: count(raw, "lifecycle_exceptions"),
        lifecycleInstances: count(raw, "lifecycle_instances"),
        obligations: count(raw, "lifecycle_obligations"),
        providerReceipts: count(raw, "provider_receipts"),
        reconciliationRuns: count(raw, "reconciliation_runs"),
        sourceEvents: count(raw, "source_events"),
      },
      networkCalls: 0,
      providerCalls: 0,
      runtimeBindingsUsed: 0,
    };
  } finally {
    raw.close();
  }
}
