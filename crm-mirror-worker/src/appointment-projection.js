// Owned appointment lifecycle projection.
//
// This module is deliberately pure. Provider observations remain append-only in
// D1; this code derives a current shadow state and reconciliation evidence at
// read time. It never books, reschedules, cancels, messages, or writes upstream.

const CREATE_EVENT_TYPES = new Set(["AppointmentCreate", "create"]);

function value(row, snake, camel) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function observationKey(row) {
  return [
    value(row, "provider", "provider"),
    value(row, "provider_event_id", "providerEventId"),
    value(row, "evidence_hash", "evidenceHash"),
  ].join(":");
}

function eventTime(row) {
  return value(row, "provider_occurred_at", "providerOccurredAt")
    || value(row, "observed_at", "observedAt")
    || "";
}

function normalizedObservation(row) {
  return {
    id: value(row, "id", "id"),
    provider: value(row, "provider", "provider") || "ghl",
    sourceKind: value(row, "source_kind", "sourceKind"),
    providerEventId: value(row, "provider_event_id", "providerEventId"),
    providerEventType: value(row, "provider_event_type", "providerEventType"),
    providerAppointmentId: value(row, "provider_appointment_id", "providerAppointmentId"),
    providerContactId: value(row, "provider_contact_id", "providerContactId"),
    providerCalendarId: value(row, "provider_calendar_id", "providerCalendarId"),
    providerStatusRaw: value(row, "provider_status_raw", "providerStatusRaw"),
    status: value(row, "normalized_status", "status") || "unknown",
    startsAt: value(row, "starts_at", "startsAt"),
    endsAt: value(row, "ends_at", "endsAt"),
    timezone: value(row, "timezone", "timezone"),
    providerOccurredAt: value(row, "provider_occurred_at", "providerOccurredAt"),
    observedAt: value(row, "observed_at", "observedAt"),
    evidenceHash: value(row, "evidence_hash", "evidenceHash"),
  };
}

function scheduleChanged(previous, next) {
  return previous.startsAt !== next.startsAt
    || previous.endsAt !== next.endsAt
    || previous.providerCalendarId !== next.providerCalendarId;
}

/** Derive one lifecycle transition without mutating either input. */
export function deriveAppointmentTransition(previous, row) {
  const current = normalizedObservation(row);
  let transition = "observed";
  if (current.status === "cancelled") transition = "cancel";
  else if (!previous) transition = "create";
  else if (scheduleChanged(previous, current)) transition = "reschedule";
  else if (previous.status !== current.status || previous.providerStatusRaw !== current.providerStatusRaw) transition = "status";
  return { transition, current: { ...current, transition } };
}

function mirrorDiff(projected, mirror) {
  const fields = [
    ["providerCalendarId", "provider_calendar_id"],
    ["providerStatusRaw", "provider_status_raw"],
    ["status", "status"],
    ["startsAt", "starts_at"],
    ["endsAt", "ends_at"],
    ["timezone", "timezone"],
  ];
  return fields
    .filter(([projectionField, mirrorField]) => (projected[projectionField] ?? null) !== (mirror?.[mirrorField] ?? null))
    .map(([projectionField]) => projectionField);
}

/**
 * Reconcile append-only observations with the existing current mirror.
 * Exact retries collapse; the same provider event ID with different evidence
 * remains visible as a conflict rather than being overwritten.
 */
export function reconcileAppointmentProjection({ events = [], currentAppointments = [] } = {}) {
  const exactSeen = new Set();
  const distinct = [];
  const evidenceByProviderEvent = new Map();
  const issues = [];

  for (const row of events) {
    const exactKey = observationKey(row);
    if (exactSeen.has(exactKey)) continue;
    exactSeen.add(exactKey);
    distinct.push(row);
    const eventKey = `${value(row, "provider", "provider")}:${value(row, "provider_event_id", "providerEventId")}`;
    const evidenceHash = value(row, "evidence_hash", "evidenceHash");
    const previousHash = evidenceByProviderEvent.get(eventKey);
    if (previousHash && previousHash !== evidenceHash) {
      issues.push({
        code: "provider_event_collision",
        providerEventId: value(row, "provider_event_id", "providerEventId"),
        providerAppointmentId: value(row, "provider_appointment_id", "providerAppointmentId"),
        evidenceHashes: [previousHash, evidenceHash],
      });
    } else if (!previousHash) {
      evidenceByProviderEvent.set(eventKey, evidenceHash);
    }
  }

  distinct.sort((left, right) => {
    const timeOrder = eventTime(left).localeCompare(eventTime(right));
    return timeOrder || String(value(left, "id", "id") || "").localeCompare(String(value(right, "id", "id") || ""));
  });

  const grouped = new Map();
  for (const row of distinct) {
    const appointmentId = value(row, "provider_appointment_id", "providerAppointmentId");
    if (!grouped.has(appointmentId)) grouped.set(appointmentId, []);
    grouped.get(appointmentId).push(row);
  }

  const appointments = [];
  for (const [providerAppointmentId, rows] of grouped) {
    let current = null;
    let historyComplete = true;
    const transitions = [];
    for (const row of rows) {
      if (!current && !CREATE_EVENT_TYPES.has(value(row, "provider_event_type", "providerEventType"))) {
        historyComplete = false;
        issues.push({ code: "missing_create", providerAppointmentId, firstProviderEventId: value(row, "provider_event_id", "providerEventId") });
      }
      const derived = deriveAppointmentTransition(current, row);
      current = derived.current;
      transitions.push({
        transition: derived.transition,
        providerEventId: current.providerEventId,
        evidenceHash: current.evidenceHash,
        occurredAt: current.providerOccurredAt,
        observedAt: current.observedAt,
      });
    }
    appointments.push({ ...current, historyComplete, transitions });
  }

  const projectedById = new Map(appointments.map((appointment) => [appointment.providerAppointmentId, appointment]));
  for (const mirror of currentAppointments) {
    const providerAppointmentId = mirror.provider_appointment_id;
    const projected = projectedById.get(providerAppointmentId);
    if (!projected) {
      issues.push({ code: "missing_shadow_observation", providerAppointmentId });
      continue;
    }
    const differingFields = mirrorDiff(projected, mirror);
    if (differingFields.length) issues.push({ code: "shadow_current_mismatch", providerAppointmentId, differingFields });
  }
  const currentIds = new Set(currentAppointments.map((appointment) => appointment.provider_appointment_id));
  for (const appointment of appointments) {
    if (!currentIds.has(appointment.providerAppointmentId)) {
      issues.push({ code: "shadow_without_current_mirror", providerAppointmentId: appointment.providerAppointmentId });
    }
  }

  return {
    shadowOnly: true,
    summary: {
      appointments: appointments.length,
      observations: distinct.length,
      conflicts: issues.length,
      historyGaps: issues.filter((issue) => ["missing_create", "missing_shadow_observation", "shadow_without_current_mirror"].includes(issue.code)).length,
    },
    appointments,
    issues,
  };
}

/** Explicit cutover blocker; this intentionally does not resolve the policy. */
export function appointmentBufferReadiness() {
  return {
    state: "conflict",
    runtimeAppOwnedMinutes: 20,
    olderDocumentedMinutes: 10,
    blocksWriteAuthority: true,
    evidence: [
      "functions/lib/booking-slot-policy.js",
      "ops/memory/project_native_booking.md",
      "ops/memory/ghl_calendars_source_of_truth.md",
    ],
    note: "Runtime booking enforces 20 minutes while older booking/calendar evidence records 10 minutes for main 50-minute sessions. Resolve and verify before owned booking writes.",
  };
}
