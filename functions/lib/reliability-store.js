import { NORMALIZED_RETENTION_MS, RELIABILITY_SCHEMA_VERSION, sha256Hex } from "./reliability-contract.js";

function changesOf(result) {
  return Number(result?.meta?.changes || 0);
}

async function sourceByIdentity(db, identityKey) {
  return db.prepare("SELECT * FROM source_events WHERE identity_key = ?").bind(identityKey).first();
}

async function transitionStatement(db, sourceEventId, transition, occurredAt, retentionUntil, detail = null, explicitSequence = null) {
  if (explicitSequence === null) {
    return db.prepare(`INSERT INTO source_event_transitions
      (source_transition_id, source_event_id, sequence, transition, occurred_at, detail_json, retention_until)
      SELECT 'srct_' || lower(hex(randomblob(32))), ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?
      FROM source_event_transitions WHERE source_event_id = ?`).bind(
      sourceEventId, transition, occurredAt, detail ? JSON.stringify(detail) : null, retentionUntil, sourceEventId,
    );
  }
  const id = `srct_${await sha256Hex(`${sourceEventId}\u0000${transition}\u0000${occurredAt}\u0000${explicitSequence}`)}`;
  return db.prepare(`INSERT INTO source_event_transitions
    (source_transition_id, source_event_id, sequence, transition, occurred_at, detail_json, retention_until)
    VALUES (?,?,?,?,?,?,?)`).bind(
    id, sourceEventId, explicitSequence, transition, occurredAt, detail ? JSON.stringify(detail) : null, retentionUntil,
  );
}

async function sourceStateTransitions(db, source, finalTransition, nowMs) {
  const transitions = ["received"];
  if (source.authenticationResult === "authenticated") transitions.push("authenticated");
  if (source.normalizationState === "normalized") transitions.push("normalized");
  transitions.push(finalTransition);
  return Promise.all(transitions.map((transition, index) => transitionStatement(
    db, source.sourceEventId, transition,
    transition === "received" ? source.receivedAt : nowMs,
    source.normalizedRetentionUntil,
    transition === finalTransition ? { sourceVersion: source.sourceVersion, runtimeVersion: source.runtimeVersion } : null,
    index + 1,
  )));
}

async function readAcceptance(db, sourceEventId) {
  const sourceEvent = await db.prepare("SELECT * FROM source_events WHERE source_event_id = ?").bind(sourceEventId).first();
  const lifecycle = await db.prepare("SELECT * FROM lifecycle_instances WHERE source_event_id = ?").bind(sourceEventId).first();
  const obligations = lifecycle ? (await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE lifecycle_instance_id = ? ORDER BY obligation_key",
  ).bind(lifecycle.lifecycle_instance_id).all()).results || [] : [];
  return { sourceEvent, lifecycle, obligations };
}

async function returnAcceptedReplay(db, existing, record, nowMs) {
  if (existing.payload_sha256 !== record.sourceEvent.payloadSha256) {
    throw new Error("source identity collision: payload hash differs");
  }
  if (existing.state !== "accepted" || existing.family !== record.sourceEvent.family) {
    throw new Error("existing source identity is not the same accepted lifecycle family");
  }
  const owned = await readAcceptance(db, existing.source_event_id);
  const expectedObligations = new Map(record.obligations.map((item) => [item.obligationKey, item]));
  const lifecycleMatches = owned.lifecycle
    && owned.lifecycle.lifecycle_instance_id === record.lifecycle.lifecycleInstanceId
    && owned.lifecycle.family === record.lifecycle.family
    && owned.lifecycle.scope === record.lifecycle.scope
    && owned.lifecycle.person_id === record.lifecycle.personId
    && owned.lifecycle.appointment_id === record.lifecycle.appointmentId
    && Number(owned.lifecycle.definition_version) === record.lifecycle.definitionVersion
    && owned.lifecycle.runtime_version === record.lifecycle.runtimeVersion;
  const obligationsMatch = owned.obligations.length === record.obligations.length
    && owned.obligations.every((item) => {
      const expected = expectedObligations.get(item.obligation_key);
      return expected && item.obligation_id === expected.obligationId
        && item.kind === expected.kind && Number(item.deadline_at) === expected.deadlineAt
        && item.owner_role === expected.ownerRole && item.closer === expected.closer;
    });
  if (!lifecycleMatches || !obligationsMatch) throw new Error("existing source event is incomplete");
  await (await transitionStatement(
    db, existing.source_event_id, "deduplicated", nowMs,
    Number(existing.normalized_retention_until), { identityKey: record.sourceEvent.identityKey },
  )).run();
  return { created: false, deduplicated: true, ...owned };
}

export async function acceptLifecycle(db, record, nowMs) {
  if (!db) throw new Error("reliability database unavailable");
  const existing = await sourceByIdentity(db, record.sourceEvent.identityKey);
  if (existing && existing.payload_sha256 !== record.sourceEvent.payloadSha256) {
    throw new Error("source identity collision: payload hash differs");
  }
  if (existing) return returnAcceptedReplay(db, existing, record, nowMs);

  const source = record.sourceEvent;
  const lifecycle = record.lifecycle;
  const sourceInsert = db.prepare(`INSERT INTO source_events
    (source_event_id, provider, family, provider_event_id, identity_version, identity_key, payload_sha256,
     payload_reference, raw_retention_until, normalized_retention_until, occurred_at, received_at, authentication_result,
     normalization_state, normalized_json, rejection_reason, state, source_version, runtime_version,
     accepted_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'accepted',?,?,?,?)`).bind(
    source.sourceEventId, source.provider, source.family, source.providerEventId, source.identityVersion, source.identityKey,
    source.payloadSha256, source.payloadReference, source.rawRetentionUntil, source.normalizedRetentionUntil,
    source.occurredAt, source.receivedAt,
    source.authenticationResult, source.normalizationState, source.normalizedJson, source.sourceVersion,
    source.runtimeVersion, nowMs, nowMs,
  );
  const lifecycleInsert = db.prepare(`INSERT INTO lifecycle_instances
    (lifecycle_instance_id, source_event_id, family, scope, person_id, appointment_id,
     definition_version, runtime_version, state, retention_until, created_at, updated_at)
    SELECT ?,?,?,?,?,?,?,?,'active',?,?,?
    WHERE EXISTS (SELECT 1 FROM source_events WHERE source_event_id = ? AND payload_sha256 = ?)
    ON CONFLICT(lifecycle_instance_id) DO NOTHING`).bind(
    lifecycle.lifecycleInstanceId, source.sourceEventId, lifecycle.family, lifecycle.scope,
    lifecycle.personId, lifecycle.appointmentId, lifecycle.definitionVersion, lifecycle.runtimeVersion,
    lifecycle.retentionUntil,
    nowMs, nowMs, source.sourceEventId, source.payloadSha256,
  );
  const obligationInserts = record.obligations.map((obligation) => db.prepare(`INSERT INTO lifecycle_obligations
    (obligation_id, lifecycle_instance_id, obligation_key, kind, family, deadline_at, owner_role, closer,
     state, retention_until, created_at, updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1 FROM lifecycle_instances l JOIN source_events s ON s.source_event_id = l.source_event_id
      WHERE l.lifecycle_instance_id = ? AND s.payload_sha256 = ?
    )
    `).bind(
      obligation.obligationId, lifecycle.lifecycleInstanceId, obligation.obligationKey, obligation.kind,
      lifecycle.family,
    obligation.deadlineAt, obligation.ownerRole, obligation.closer, obligation.initialState,
    obligation.retentionUntil, nowMs, nowMs,
    lifecycle.lifecycleInstanceId, source.payloadSha256,
  ));

  const transitions = await sourceStateTransitions(db, source, "accepted", nowMs);
  let results;
  try {
    results = await db.batch([sourceInsert, ...transitions, lifecycleInsert, ...obligationInserts]);
  } catch (error) {
    const raced = await sourceByIdentity(db, source.identityKey);
    if (!raced) throw error;
    return returnAcceptedReplay(db, raced, record, nowMs);
  }
  const owned = await readAcceptance(db, source.sourceEventId);
  if (!owned.sourceEvent || !owned.lifecycle || owned.obligations.length !== record.obligations.length) {
    throw new Error("durable acceptance did not create the complete lifecycle transaction");
  }
  return { created: changesOf(results[0]) === 1, deduplicated: false, ...owned };
}

async function returnRejectedReplay(db, existing, record, nowMs) {
  const source = record.sourceEvent;
  const exception = record.exception;
  if (existing.payload_sha256 !== source.payloadSha256) throw new Error("source identity collision: payload hash differs");
  if (existing.state !== "rejected" || existing.family !== source.family) {
    throw new Error("existing source identity is not the same rejected lifecycle family");
  }
  const storedException = await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE exception_id = ? AND source_event_id = ? AND family = ?",
  ).bind(exception.exceptionId, existing.source_event_id, source.family).first();
  const opened = storedException ? await db.prepare(
    "SELECT * FROM exception_events WHERE exception_id = ? AND event_type = 'opened'",
  ).bind(exception.exceptionId).first() : null;
  if (!storedException || !opened) throw new Error("existing rejected source event is incomplete");
  await (await transitionStatement(
    db, existing.source_event_id, "deduplicated", nowMs,
    Number(existing.normalized_retention_until), { identityKey: source.identityKey },
  )).run();
  return { created: false, deduplicated: true, sourceEventId: existing.source_event_id, exceptionId: exception.exceptionId };
}

export async function rejectSourceEvent(db, record, nowMs) {
  if (!db) throw new Error("reliability database unavailable");
  const source = record.sourceEvent;
  const exception = record.exception;
  const existing = await sourceByIdentity(db, source.identityKey);
  if (existing) return returnRejectedReplay(db, existing, record, nowMs);
  const eventId = `exevt_${await sha256Hex(`${exception.exceptionId}\u0000opened`)}`;
  const sourceInsert = db.prepare(`INSERT INTO source_events
      (source_event_id, provider, family, provider_event_id, identity_version, identity_key, payload_sha256,
       payload_reference, raw_retention_until, normalized_retention_until, occurred_at, received_at, authentication_result,
       normalization_state, normalized_json, rejection_reason, state, source_version, runtime_version,
       accepted_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rejected',?,?,NULL,?)`).bind(
      source.sourceEventId, source.provider, source.family, source.providerEventId, source.identityVersion, source.identityKey,
      source.payloadSha256, source.payloadReference, source.rawRetentionUntil, source.normalizedRetentionUntil,
      source.occurredAt, source.receivedAt,
      source.authenticationResult, source.normalizationState, source.normalizedJson, source.rejectionReason,
      source.sourceVersion, source.runtimeVersion, nowMs,
    );
  const transitions = await sourceStateTransitions(db, source, "rejected", nowMs);
  const statements = [sourceInsert, ...transitions,
    db.prepare(`INSERT INTO lifecycle_exceptions
      (exception_id, family, source_event_id, kind, severity, accountable_owner, next_safe_action, state, retention_until, opened_at, updated_at)
      SELECT ?,?,?,?,?,?,?,'open',?,?,? WHERE EXISTS (
        SELECT 1 FROM source_events WHERE source_event_id = ? AND state = 'rejected'
      )`).bind(
      exception.exceptionId, exception.family, source.sourceEventId, exception.kind, exception.severity,
      exception.accountableOwner, exception.nextSafeAction, exception.retentionUntil, nowMs, nowMs, source.sourceEventId,
    ),
    db.prepare(`INSERT INTO exception_events
      (exception_event_id, exception_id, event_type, actor, occurred_at, evidence_sha256, detail_json, retention_until)
      SELECT ?,?,'opened','system',?,?,?,? WHERE EXISTS (
        SELECT 1 FROM lifecycle_exceptions WHERE exception_id = ?
      )`).bind(
      eventId, exception.exceptionId, nowMs, source.payloadSha256,
      JSON.stringify({ reason: source.rejectionReason }), exception.retentionUntil, exception.exceptionId,
    ),
  ];
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    const raced = await sourceByIdentity(db, source.identityKey);
    if (!raced) throw error;
    return returnRejectedReplay(db, raced, record, nowMs);
  }
  const stored = await sourceByIdentity(db, source.identityKey);
  if (!stored) throw new Error("rejected source event was not durably recorded");
  if (stored.payload_sha256 !== source.payloadSha256) throw new Error("source identity collision: payload hash differs");
  const storedException = await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE exception_id = ? AND source_event_id = ?",
  ).bind(exception.exceptionId, stored.source_event_id).first();
  const opened = await db.prepare(
    "SELECT * FROM exception_events WHERE exception_id = ? AND event_type = 'opened'",
  ).bind(exception.exceptionId).first();
  if (!storedException || !opened) throw new Error("rejected source event exception was not durably recorded");
  return { created: changesOf(results[0]) === 1, deduplicated: false, sourceEventId: stored.source_event_id, exceptionId: exception.exceptionId };
}

export async function leaseObligation(db, { obligationId, owner, nowMs, leaseMs }) {
  if (!owner || !Number.isInteger(nowMs) || !Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError("valid owner, nowMs, and leaseMs are required");
  }
  const current = await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE obligation_id = ?",
  ).bind(obligationId).first();
  if (!current || (current.state !== "pending" && !(current.state === "leased" && Number(current.lease_expires_at) < nowMs))) {
    return { acquired: false };
  }
  const expiresAt = nowMs + leaseMs;
  const eventType = current.state === "leased" ? "taken_over" : "acquired";
  const eventId = `lease_${await sha256Hex(`${obligationId}\u0000${eventType}\u0000${nowMs}\u0000${owner}`)}`;
  const update = db.prepare(`UPDATE lifecycle_obligations
    SET state = 'leased', lease_owner = ?, lease_acquired_at = ?, lease_expires_at = ?, updated_at = ?
    WHERE obligation_id = ? AND (
      state = 'pending' OR (state = 'leased' AND lease_expires_at < ?)
    )`).bind(owner, nowMs, expiresAt, nowMs, obligationId, nowMs);
  const event = db.prepare(`INSERT INTO obligation_lease_events
    (lease_event_id, obligation_id, event_type, previous_owner, new_owner, lease_acquired_at, lease_expires_at, retention_until)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM lifecycle_obligations WHERE obligation_id = ? AND state = 'leased' AND lease_owner = ? AND lease_acquired_at = ?
    )`).bind(
    eventId, obligationId, eventType, current.lease_owner || null, owner, nowMs, expiresAt,
    Number(current.retention_until), obligationId, owner, nowMs,
  );
  const results = await db.batch([update, event]);
  if (changesOf(results[0]) !== 1 || changesOf(results[1]) !== 1) {
    throw new Error("obligation lease changed or its immutable acquisition event was not recorded");
  }
  return { acquired: true, obligation: await db.prepare(
    "SELECT * FROM lifecycle_obligations WHERE obligation_id = ?",
  ).bind(obligationId).first() };
}

export async function readReliabilityHealth(db, { family, nowMs, maxAgeMs }) {
  if (!db) return { truth: "Unknown", reason: "authority_unavailable", checkedAt: nowMs };
  try {
    const schema = await db.prepare(
      "SELECT version, applied_at, migration_id FROM reliability_schema_versions ORDER BY version DESC LIMIT 1",
    ).first();
    if (!schema || Number(schema.version) !== RELIABILITY_SCHEMA_VERSION || schema.migration_id !== "reliability-spine-v1") {
      return { truth: "Degraded", reason: "schema_unproven", checkedAt: nowMs, schemaVersion: schema?.version ?? null };
    }
    const coverage = await db.prepare(`SELECT * FROM reconciliation_runs
      WHERE family = ? ORDER BY started_at DESC LIMIT 1`).bind(family).first();
    if (!coverage) return { truth: "Degraded", reason: "coverage_missing", checkedAt: nowMs, schemaVersion: schema.version };
    if (coverage.state !== "complete" || Number(coverage.pagination_complete) !== 1 || !coverage.completed_at) {
      return { truth: "Degraded", reason: "coverage_incomplete", checkedAt: nowMs, schemaVersion: schema.version };
    }
    const authorityValid = coverage.authority === "AUTOMATION_DB"
      && typeof coverage.source_version === "string" && coverage.source_version.length > 0
      && typeof coverage.runtime_version === "string" && coverage.runtime_version.length > 0;
    const rangeValid = Number(coverage.expected_start) <= Number(coverage.expected_end)
      && Number(coverage.coverage_start) <= Number(coverage.expected_start)
      && Number(coverage.coverage_end) >= Number(coverage.expected_end)
      && Number(coverage.coverage_end) <= Number(coverage.completed_at)
      && Number(coverage.completed_at) <= nowMs;
    if (!authorityValid || !rangeValid) {
      return { truth: "Degraded", reason: "coverage_unproven", checkedAt: nowMs, schemaVersion: schema.version };
    }
    if (nowMs - Number(coverage.coverage_end) > maxAgeMs || nowMs - Number(coverage.completed_at) > maxAgeMs) {
      return { truth: "Degraded", reason: "coverage_stale", checkedAt: nowMs, schemaVersion: schema.version, coveredAt: coverage.coverage_end };
    }
    return {
      truth: "Known", reason: "authoritative_and_fresh", checkedAt: nowMs, schemaVersion: schema.version,
      coveredAt: coverage.coverage_end, authority: coverage.authority,
      sourceVersion: coverage.source_version, runtimeVersion: coverage.runtime_version,
    };
  } catch (error) {
    return { truth: "Unknown", reason: "authority_read_failed", checkedAt: nowMs, error: String(error?.message || error) };
  }
}

export async function readSourceEventDetail(db, sourceEventId, { family } = {}) {
  const source = await db.prepare(
    "SELECT * FROM source_events WHERE source_event_id = ? AND (? IS NULL OR family = ?)",
  ).bind(sourceEventId, family || null, family || null).first();
  if (!source) return null;
  const accepted = await readAcceptance(db, sourceEventId);
  const exceptions = (await db.prepare(
    "SELECT * FROM lifecycle_exceptions WHERE source_event_id = ? ORDER BY opened_at",
  ).bind(sourceEventId).all()).results || [];
  const transitions = (await db.prepare(
    "SELECT * FROM source_event_transitions WHERE source_event_id = ? ORDER BY sequence",
  ).bind(sourceEventId).all()).results || [];
  return { ...accepted, transitions, exceptions };
}

const EXCEPTION_TRANSITIONS = {
  open: new Set(["acknowledged", "suppressed_with_expiry"]),
  acknowledged: new Set(["investigating", "resolved", "suppressed_with_expiry"]),
  investigating: new Set(["resolved", "suppressed_with_expiry"]),
  suppressed_with_expiry: new Set(["open"]),
  resolved: new Set(),
};

const EVENT_FOR_STATE = {
  acknowledged: "acknowledged",
  investigating: "investigating",
  resolved: "resolved",
  suppressed_with_expiry: "suppressed",
  open: "reopened",
};

export async function transitionException(db, {
  exceptionId, fromState, toState, actor, occurredAt, transitionId, evidenceSha256 = null,
  detail = null, suppressionExpiresAt = null,
}) {
  if (!EXCEPTION_TRANSITIONS[fromState]?.has(toState)) {
    throw new TypeError(`invalid exception transition: ${fromState} -> ${toState}`);
  }
  if (!actor || !transitionId || !Number.isInteger(occurredAt)) {
    throw new TypeError("actor, transitionId, and occurredAt are required");
  }
  if (toState === "suppressed_with_expiry" && !Number.isInteger(suppressionExpiresAt)) {
    throw new TypeError("suppression expiry is required");
  }
  const update = db.prepare(`UPDATE lifecycle_exceptions
    SET state = ?, suppression_expires_at = ?, updated_at = ?
    WHERE exception_id = ? AND state = ?`).bind(
    toState, toState === "suppressed_with_expiry" ? suppressionExpiresAt : null,
    occurredAt, exceptionId, fromState,
  );
  const event = db.prepare(`INSERT INTO exception_events
    (exception_event_id, exception_id, event_type, actor, occurred_at, evidence_sha256, detail_json, retention_until)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM lifecycle_exceptions WHERE exception_id = ? AND state = ?
    )`).bind(
    transitionId, exceptionId, EVENT_FOR_STATE[toState], actor, occurredAt, evidenceSha256,
    detail ? JSON.stringify(detail) : null, occurredAt + NORMALIZED_RETENTION_MS, exceptionId, toState,
  );
  const results = await db.batch([update, event]);
  if (changesOf(results[0]) !== 1 || changesOf(results[1]) !== 1) {
    throw new Error("exception changed during transition or transition was already recorded");
  }
  return db.prepare("SELECT * FROM lifecycle_exceptions WHERE exception_id = ?").bind(exceptionId).first();
}

export async function readExceptionQueue(db, { family, limit = 100 } = {}) {
  const rows = await db.prepare(`SELECT * FROM lifecycle_exceptions
    WHERE state <> 'resolved' AND (? IS NULL OR family = ?) ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      opened_at ASC LIMIT ?`).bind(family || null, family || null, limit).all();
  return rows.results || [];
}

export async function readRecentSourceEvents(db, { family, limit = 50 } = {}) {
  const rows = await db.prepare(`SELECT
      s.source_event_id, s.provider, s.provider_event_id, s.identity_version, s.payload_sha256,
      s.occurred_at, s.received_at, s.authentication_result, s.normalization_state, s.rejection_reason,
      s.state, s.source_version, s.runtime_version,
      l.lifecycle_instance_id, l.family, l.scope, l.state AS lifecycle_state,
      (SELECT COUNT(*) FROM lifecycle_obligations o WHERE o.lifecycle_instance_id = l.lifecycle_instance_id) AS obligation_count,
      (SELECT COUNT(*) FROM lifecycle_exceptions x WHERE x.source_event_id = s.source_event_id AND x.state <> 'resolved') AS open_exception_count
    FROM source_events s
    LEFT JOIN lifecycle_instances l ON l.source_event_id = s.source_event_id
    WHERE (? IS NULL OR s.family = ?)
    ORDER BY s.received_at DESC LIMIT ?`).bind(family || null, family || null, limit).all();
  return rows.results || [];
}

export async function readReliabilityCounts(db, { family, accountableOwner } = {}) {
  const source = await db.prepare(
    "SELECT COUNT(*) AS count FROM source_events WHERE (? IS NULL OR family = ?)",
  ).bind(family || null, family || null).first();
  const exceptions = await db.prepare(
    `SELECT COUNT(*) AS count FROM lifecycle_exceptions
     WHERE state <> 'resolved' AND (? IS NULL OR family = ?) AND (? IS NULL OR lower(accountable_owner) = lower(?))`,
  ).bind(family || null, family || null, accountableOwner || null, accountableOwner || null).first();
  return { sourceEventTotal: Number(source?.count || 0), exceptionTotal: Number(exceptions?.count || 0) };
}

export async function recordEvidenceAccess(db, { actor, family, action, sourceEventId = null, occurredAt }) {
  if (!actor || !family || !["view_summary", "view_source", "export"].includes(action) || !Number.isInteger(occurredAt)) {
    throw new TypeError("actor, family, action, and occurredAt are required for evidence access");
  }
  const nonce = crypto.randomUUID();
  const accessEventId = `access_${await sha256Hex(`${actor}\u0000${family}\u0000${action}\u0000${sourceEventId || ""}\u0000${occurredAt}\u0000${nonce}`)}`;
  const result = await db.prepare(`INSERT INTO evidence_access_events
    (access_event_id, actor, family, action, source_event_id, occurred_at, retention_until)
    VALUES (?,?,?,?,?,?,?)`).bind(
    accessEventId, actor, family, action, sourceEventId, occurredAt, occurredAt + NORMALIZED_RETENTION_MS,
  ).run();
  if (changesOf(result) !== 1) throw new Error("evidence access was not durably audited");
  return accessEventId;
}
