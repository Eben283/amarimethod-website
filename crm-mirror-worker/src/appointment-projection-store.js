import {
  appointmentBufferReadiness,
  deriveAppointmentTransition,
  reconcileAppointmentProjection,
} from "./appointment-projection.js";

// Keep Calendar's readiness request light. This is a bounded reconciliation
// signal, not the appointment-history detail endpoint.
const READ_LIMIT = 1000;

function canonicalAppointment(appointment) {
  return JSON.stringify({
    provider: "ghl",
    providerAppointmentId: appointment.externalId || null,
    providerContactId: appointment.contactExternalId || null,
    providerCalendarId: appointment.calendarId || null,
    providerStatusRaw: appointment.providerStatusRaw || null,
    normalizedStatus: appointment.status || "unknown",
    startsAt: appointment.startsAt || null,
    endsAt: appointment.endsAt || null,
    timezone: appointment.timezone || null,
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function eventId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Append one provider observation. The unique provider-event/evidence tuple
 * makes exact retries no-ops while retaining contradictory provider evidence.
 */
export async function recordAppointmentObservation(db, appointment, evidence = {}, observedAt) {
  if (!appointment?.externalId) throw new Error("provider appointment ID required");
  const evidenceHash = evidence.evidenceHash || await sha256(canonicalAppointment(appointment));
  const sourceKind = evidence.sourceKind === "webhook" ? "webhook" : "snapshot";
  const providerEventId = evidence.providerEventId
    || `snapshot:${appointment.externalId}:${evidenceHash}`;
  const duplicate = await db.prepare(
    `SELECT id, transition_type
     FROM appointment_projection_events
     WHERE provider = 'ghl' AND provider_event_id = ? AND evidence_hash = ?`,
  ).bind(providerEventId, evidenceHash).first();
  if (duplicate) return { duplicate: true, id: duplicate.id, transition: duplicate.transition_type };

  const previous = await db.prepare(
    `SELECT * FROM appointment_projection_events
     WHERE provider = 'ghl' AND provider_appointment_id = ?
     ORDER BY COALESCE(provider_occurred_at, observed_at) DESC, observed_at DESC, id DESC
     LIMIT 1`,
  ).bind(appointment.externalId).first();
  const providerEventType = evidence.providerEventType
    || (previous ? "sync_snapshot" : "sync_initial");
  const row = {
    id: eventId(),
    provider: "ghl",
    source_kind: sourceKind,
    provider_event_id: providerEventId,
    provider_event_type: providerEventType,
    provider_appointment_id: appointment.externalId,
    provider_contact_id: appointment.contactExternalId || null,
    provider_calendar_id: appointment.calendarId || null,
    provider_status_raw: appointment.providerStatusRaw || null,
    normalized_status: appointment.status || "unknown",
    starts_at: appointment.startsAt || null,
    ends_at: appointment.endsAt || null,
    timezone: appointment.timezone || null,
    provider_occurred_at: evidence.providerOccurredAt || null,
    observed_at: observedAt,
    evidence_hash: evidenceHash,
  };
  const { transition } = deriveAppointmentTransition(previous, row);

  await db.prepare(
    `INSERT INTO appointment_projection_events
     (id, provider, source_kind, provider_event_id, provider_event_type,
      provider_appointment_id, provider_contact_id, provider_calendar_id,
      provider_status_raw, normalized_status, starts_at, ends_at, timezone,
      transition_type, provider_occurred_at, observed_at, evidence_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_event_id, evidence_hash) DO NOTHING`,
  ).bind(
    row.id, row.provider, row.source_kind, row.provider_event_id, row.provider_event_type,
    row.provider_appointment_id, row.provider_contact_id, row.provider_calendar_id,
    row.provider_status_raw, row.normalized_status, row.starts_at, row.ends_at, row.timezone,
    transition, row.provider_occurred_at, row.observed_at, row.evidence_hash,
  ).run();
  return { duplicate: false, id: row.id, transition, evidenceHash, providerEventId };
}

/**
 * Protected, read-only shadow state. Missing D1 migration is an honest
 * unavailable state; it never prevents the provider-backed Staff schedule.
 */
export async function appointmentProjectionReadiness(db, generatedAt) {
  const bufferPolicy = appointmentBufferReadiness();
  try {
    const [countRow, eventsResult, currentResult] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM appointment_projection_events").bind().first(),
      db.prepare(
        `SELECT * FROM appointment_projection_events
         ORDER BY COALESCE(provider_occurred_at, observed_at) DESC, observed_at DESC, id DESC
         LIMIT ?`,
      ).bind(READ_LIMIT).all(),
      db.prepare(
        `SELECT provider_appointment_id, provider_calendar_id, provider_status_raw,
                status, starts_at, ends_at, timezone
         FROM appointments`,
      ).bind().all(),
    ]);
    const events = eventsResult.results || [];
    const totalObservations = Number(countRow?.count || 0);
    const reconciliation = reconcileAppointmentProjection({
      // Reconciliation applies observations in chronological order itself.
      events,
      currentAppointments: currentResult.results || [],
    });
    const truncated = totalObservations > events.length;
    if (truncated) {
      reconciliation.issues.push({
        code: "projection_window_truncated",
        observationsRead: events.length,
        totalObservations,
      });
      reconciliation.summary.conflicts += 1;
      reconciliation.summary.historyGaps += 1;
    }
    return {
      configured: true,
      shadowOnly: true,
      state: bufferPolicy.blocksWriteAuthority || reconciliation.summary.conflicts ? "attention" : "ready",
      generatedAt,
      liveScheduleFallback: true,
      coverage: { observationsRead: events.length, totalObservations, truncated },
      reconciliation: {
        shadowOnly: true,
        summary: reconciliation.summary,
        issues: reconciliation.issues.slice(0, 100),
        issueCoverage: {
          returned: Math.min(reconciliation.issues.length, 100),
          total: reconciliation.issues.length,
          truncated: reconciliation.issues.length > 100,
        },
      },
      bufferPolicy,
    };
  } catch (error) {
    return {
      configured: false,
      shadowOnly: true,
      state: "unavailable",
      generatedAt,
      liveScheduleFallback: true,
      reason: error instanceof Error ? error.message : String(error),
      bufferPolicy,
    };
  }
}
