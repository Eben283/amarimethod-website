// Automation dashboard — read layer over the shared amari-automation D1 spine (DASHBOARD-PLAN
// v1: per-contact timeline + failures table). Pure queries, no writes, no GHL calls; the staff
// endpoint (functions/api/staff-automations.js) is a thin auth wrapper around these.
//
// Scale note (from the plan): a few hundred rows total — plain per-table queries, no rollups.

import { eventEvidence, findAutomationDefinition } from "./automation-registry.js";
import { familyForDefinition } from "./automation-families.js";

function familyReference(engine, key) {
  const family = familyForDefinition(engine, key);
  return family ? { key: family.key, name: family.name } : null;
}

function parseDetail(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return { raw }; }
}

function normalizeEvent(r) {
  return {
    id: r.id,
    ts: r.ts,
    occurredAt: exactIso(r.ts),
    engine: r.engine,
    flowKey: r.flow_key,
    definitionVersion: r.definition_version ?? null,
    contactId: r.contact_id,
    appointmentId: r.appointment_id,
    stepIndex: r.step_index,
    action: r.action,
    outcome: r.outcome,
    channel: r.channel,
    messageRef: r.message_ref,
    family: familyReference(r.engine, r.flow_key),
    detail: parseDetail(r.detail),
    evidence: eventEvidence(r),
  };
}

function exactIso(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function nextPendingStep(steps) {
  const pending = steps.filter((s) => s.status === "pending").sort((a, b) => a.due_at - b.due_at);
  if (!pending.length) return null;
  const s = pending[0];
  return {
    stepIndex: s.step_index,
    template: s.template,
    dueAt: s.due_at,
    dueAtIso: exactIso(s.due_at),
    type: s.type ?? s.kind ?? null,
  };
}

function normalizeStep(s) {
  return {
    stepIndex: s.step_index,
    at: s.at ?? s.after ?? null,
    type: s.type ?? s.kind ?? null,
    template: s.template,
    dueAt: s.due_at,
    dueAtIso: exactIso(s.due_at),
    status: s.status,
  };
}

function reminderEnrollment(e, allSteps) {
  const raw = allSteps.filter((s) => s.enrollment_id === e.enrollment_id);
  const definition = findAutomationDefinition("reminder", e.flow_key);
  return {
    engine: "reminder",
    key: e.flow_key,
    definitionId: definition?.id || null,
    definitionVersion: e.definition_version ?? null,
    currentDefinitionVersion: definition?.definitionVersion || null,
    family: familyReference("reminder", e.flow_key),
    enrollmentId: e.enrollment_id,
    appointmentId: e.appointment_id,
    startAt: e.start_at,
    startAtIso: exactIso(e.start_ms ?? e.start_at),
    enteredAt: e.enrolled_at,
    enteredAtIso: exactIso(e.enrolled_at),
    status: e.status,
    steps: raw.map(normalizeStep),
    nextStep: e.status === "active" ? nextPendingStep(raw) : null,
    evidence: {
      source: "owned_d1_enrollment",
      gaps: enrollmentEvidenceGaps(e.definition_version, definition),
    },
  };
}

function nurtureEnrollment(e, allSteps) {
  const raw = allSteps.filter((s) => s.enrollment_id === e.enrollment_id);
  const definition = findAutomationDefinition("nurture", e.sequence_id);
  return {
    engine: "nurture",
    key: e.sequence_id,
    definitionId: definition?.id || null,
    definitionVersion: e.definition_version ?? null,
    currentDefinitionVersion: definition?.definitionVersion || null,
    family: familyReference("nurture", e.sequence_id),
    enrollmentId: e.enrollment_id,
    enteredAt: e.entered_at,
    enteredAtIso: exactIso(e.entered_at),
    status: e.status,
    guardUnchecked: !!e.guard_unchecked,
    steps: raw.map(normalizeStep),
    nextStep: e.status === "active" ? nextPendingStep(raw) : null,
    evidence: {
      source: "owned_d1_enrollment",
      gaps: [
        ...enrollmentEvidenceGaps(e.definition_version, definition),
        ...(e.guard_unchecked ? [{
          code: "entry_guard_unverified",
          label: "The enrollment was recorded without verifying its entry guard.",
        }] : []),
      ],
    },
  };
}

function enrollmentEvidenceGaps(recordedVersion, currentDefinition) {
  if (!currentDefinition) {
    return [{
      code: "definition_not_registered",
      label: "This enrollment key has no matching owned definition in the current registry.",
    }];
  }
  if (recordedVersion == null) {
    return [{
      code: "definition_version_not_recorded",
      label: "This enrollment predates definition-version capture, so its exact definition revision is unknown.",
    }];
  }
  if (recordedVersion !== currentDefinition.definitionVersion) {
    return [{
      code: "historical_definition_snapshot_not_loaded",
      label: `This enrollment used definition version ${recordedVersion}; the read API currently exposes version ${currentDefinition.definitionVersion}.`,
    }];
  }
  return [];
}

async function rows(db, sql, ...binds) {
  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}

/**
 * Everything the automation system knows about one contact: enrollments across both engines
 * (normalized, with the next pending step resolved), purchase-cluster state, and the
 * reverse-chron event history. An unknown contact yields an empty view, never an error.
 */
export async function contactAutomationView(db, contactId, eventLimit = 200) {
  const [
    remEnr, remSteps, nurEnr, nurSteps, timers, confirmations, lpSends, events,
  ] = await Promise.all([
    rows(db, `SELECT * FROM reminder_enrollments WHERE contact_id = ?`, contactId),
    rows(db, `SELECT s.* FROM reminder_steps s
       JOIN reminder_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE e.contact_id = ?`, contactId),
    rows(db, `SELECT * FROM nurture_enrollments WHERE contact_id = ?`, contactId),
    rows(db, `SELECT s.* FROM nurture_steps s
       JOIN nurture_enrollments e ON e.enrollment_id = s.enrollment_id
       WHERE e.contact_id = ?`, contactId),
    rows(db, `SELECT * FROM upgrade_offer_timers WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM purchase_confirmations WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM lp_onboarding_sends WHERE contact_id = ?`, contactId),
    rows(db, `SELECT * FROM automation_events WHERE contact_id = ? ORDER BY ts DESC LIMIT ?`, contactId, eventLimit),
  ]);

  const enrollments = [
    ...remEnr.map((e) => reminderEnrollment(e, remSteps)),
    ...nurEnr.map((e) => nurtureEnrollment(e, nurSteps)),
  ];

  return {
    contactId,
    enrollments,
    upgradeOffer: timers[0] || null,
    confirmations,
    lpOnboarding: lpSends[0] || null,
    events: events.map(normalizeEvent),
  };
}

/**
 * One registered automation with its owned D1 enrollments and append-only execution history.
 * The caller validates that the definition exists; this query never synthesizes external history.
 */
export async function automationExecutionView(db, { engine, key, enrollmentLimit = 200, eventLimit = 500 }) {
  let enrollmentRows;
  let stepRows;

  if (engine === "reminder") {
    [enrollmentRows, stepRows] = await Promise.all([
      rows(db, `SELECT * FROM reminder_enrollments WHERE flow_key = ? ORDER BY enrolled_at DESC LIMIT ?`, key, enrollmentLimit),
      rows(db, `SELECT s.* FROM reminder_steps s
        JOIN reminder_enrollments e ON e.enrollment_id = s.enrollment_id
        WHERE e.flow_key = ?`, key),
    ]);
  } else {
    [enrollmentRows, stepRows] = await Promise.all([
      rows(db, `SELECT * FROM nurture_enrollments WHERE sequence_id = ? ORDER BY entered_at DESC LIMIT ?`, key, enrollmentLimit),
      rows(db, `SELECT s.* FROM nurture_steps s
        JOIN nurture_enrollments e ON e.enrollment_id = s.enrollment_id
        WHERE e.sequence_id = ?`, key),
    ]);
  }

  const events = await rows(
    db,
    `SELECT * FROM automation_events WHERE engine = ? AND flow_key = ? ORDER BY ts DESC LIMIT ?`,
    engine, key, eventLimit,
  );

  return {
    enrollments: engine === "reminder"
      ? enrollmentRows.map((row) => reminderEnrollment(row, stepRows))
      : enrollmentRows.map((row) => nurtureEnrollment(row, stepRows)),
    events: events.map(normalizeEvent),
  };
}

/**
 * One operator-facing lifecycle family across every definition currently owned in code.
 * Historical/provider source records remain family metadata; only owned definition keys are
 * queried from D1, so this cannot imply that external execution history was imported.
 */
export async function automationFamilyExecutionView(db, family) {
  const definitions = Array.isArray(family?.ownedDefinitions) ? family.ownedDefinitions : [];
  if (!definitions.length) return { enrollments: [], events: [] };
  const views = await Promise.all(definitions.map((definition) => automationExecutionView(db, {
    engine: definition.engine,
    key: definition.key,
  })));
  const enrollments = views
    .flatMap((view) => view.enrollments)
    .sort((a, b) => Date.parse(b.enteredAtIso || 0) - Date.parse(a.enteredAtIso || 0));
  const events = views
    .flatMap((view) => view.events)
    .sort((a, b) => Date.parse(b.occurredAt || 0) - Date.parse(a.occurredAt || 0));
  return { enrollments, events };
}

/**
 * The activity feed: EVERY automation event since the cutoff, all contacts, newest first —
 * "what is happening today / yesterday" (Eben's v1 ask, 2026-07-12). This is the shadow-watch
 * instrument: during the beside-GHL period the feed is the log you compare against what GHL
 * actually sent.
 */
export async function activityView(db, { sinceMs = 0, limit = 500 } = {}) {
  const res = await rows(
    db,
    `SELECT * FROM automation_events WHERE ts >= ? ORDER BY ts DESC LIMIT ?`,
    sinceMs, limit,
  );
  return res.map(normalizeEvent);
}

/**
 * The failures table: every failed/bounced/error event since the cutoff, newest first.
 */
export async function failuresView(db, { sinceMs = 0, limit = 100 } = {}) {
  const res = await rows(
    db,
    `SELECT * FROM automation_events WHERE outcome IN ('failed','bounced','error') AND ts >= ?
     ORDER BY ts DESC LIMIT ?`,
    sinceMs, limit,
  );
  return res.map(normalizeEvent);
}
