// Provider-neutral missed-appointment truth.
//
// Counts are derived from the latest immutable canonical status fact for each
// appointment. No mutable contact counter is written, and this read model has
// no provider call, message, payment, entitlement, or appointment mutation.

const CONTACT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const DEFAULT_LIMIT = 25;

export class MissedAppointmentTruthError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "MissedAppointmentTruthError";
    this.code = code;
    this.status = status;
  }
}

function limitOf(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function count(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function observedLegacyCounter(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function stateFor(summary) {
  if (summary.missingFacts || summary.currentMismatches) return "attention";
  if (summary.baselineFacts) return "baseline";
  return "ready";
}

export async function readMissedAppointmentTruth(db, { contactId, limit = DEFAULT_LIMIT } = {}) {
  if (!db) throw new MissedAppointmentTruthError("missed-appointment storage is unavailable", "storage_unavailable", 503);
  const ownedContactId = String(contactId || "").trim();
  if (!CONTACT_ID.test(ownedContactId)) {
    throw new MissedAppointmentTruthError("valid owned contactId is required", "invalid_contact_id");
  }
  const bounded = limitOf(limit);
  try {
    const [contact, summary, rows] = await db.batch([
      db.prepare(
        `SELECT contact.id, contact.display_name,
                legacy.attribute_value AS legacy_missed_appointments
           FROM contacts contact
           LEFT JOIN contact_attributes legacy
             ON legacy.contact_id = contact.id
            AND legacy.source = 'ghl'
            AND legacy.attribute_key = 'e9COM3UBr7m8GnCTPPYG'
          WHERE contact.id = ?`,
      ).bind(ownedContactId),
      db.prepare(
        `WITH latest AS (
           SELECT fact.*
             FROM appointment_status_facts fact
             JOIN (
               SELECT appointment_id, MAX(appointment_revision) AS appointment_revision
                 FROM appointment_status_facts
                WHERE contact_id = ?
                GROUP BY appointment_id
             ) current_fact
               ON current_fact.appointment_id = fact.appointment_id
              AND current_fact.appointment_revision = fact.appointment_revision
         )
         SELECT
           COUNT(appointment.id) AS appointments,
           SUM(CASE WHEN latest.normalized_status = 'no_show' THEN 1 ELSE 0 END) AS missed_appointments,
           SUM(CASE WHEN latest.id IS NULL THEN 1 ELSE 0 END) AS missing_facts,
           SUM(CASE WHEN latest.id IS NOT NULL AND latest.history_complete = 0 THEN 1 ELSE 0 END) AS baseline_facts,
           SUM(CASE WHEN latest.id IS NOT NULL AND (
             latest.contact_id <> appointment.contact_id
             OR latest.appointment_revision <> appointment.revision
             OR latest.normalized_status <> appointment.status
             OR latest.authority <> appointment.authority
           ) THEN 1 ELSE 0 END) AS current_mismatches
         FROM appointments appointment
         LEFT JOIN latest ON latest.appointment_id = appointment.id
         WHERE appointment.contact_id = ?`,
      ).bind(ownedContactId, ownedContactId),
      db.prepare(
        `WITH latest AS (
           SELECT fact.*
             FROM appointment_status_facts fact
             JOIN (
               SELECT appointment_id, MAX(appointment_revision) AS appointment_revision
                 FROM appointment_status_facts
                WHERE contact_id = ?
                GROUP BY appointment_id
             ) current_fact
               ON current_fact.appointment_id = fact.appointment_id
              AND current_fact.appointment_revision = fact.appointment_revision
         )
         SELECT latest.appointment_id, latest.appointment_revision, latest.normalized_status,
                latest.authority, latest.source_kind, latest.history_complete,
                latest.effective_at, latest.recorded_at,
                appointment.starts_at, appointment.ends_at, service.name AS service_name
           FROM latest
           JOIN appointments appointment ON appointment.id = latest.appointment_id
           LEFT JOIN services service ON service.id = appointment.service_id
          WHERE latest.contact_id = ? AND latest.normalized_status = 'no_show'
          ORDER BY datetime(COALESCE(appointment.starts_at, latest.effective_at)) DESC,
                   latest.appointment_id
          LIMIT ?`,
      ).bind(ownedContactId, ownedContactId, bounded),
    ]);
    const contactRow = contact.results?.[0] || null;
    if (!contactRow) throw new MissedAppointmentTruthError("owned contact not found", "contact_not_found", 404);
    const raw = summary.results?.[0] || {};
    const derived = Object.freeze({
      appointments: count(raw.appointments),
      missedAppointments: count(raw.missed_appointments),
      missingFacts: count(raw.missing_facts),
      baselineFacts: count(raw.baseline_facts),
      currentMismatches: count(raw.current_mismatches),
    });
    const legacyObserved = observedLegacyCounter(contactRow.legacy_missed_appointments);
    return Object.freeze({
      version: "owned-missed-appointment-truth.v1",
      readOnly: true,
      mutableCounterWritten: false,
      authorityPromoted: false,
      contact: Object.freeze({ id: contactRow.id, displayName: contactRow.display_name }),
      state: stateFor(derived),
      summary: derived,
      legacyObservation: Object.freeze({
        source: "ghl_contact_field_ingest_observation",
        fieldId: "e9COM3UBr7m8GnCTPPYG",
        observedValue: legacyObserved,
        comparable: legacyObserved !== null,
        matchesDerived: legacyObserved === null ? null : legacyObserved === derived.missedAppointments,
        authoritative: false,
      }),
      truncated: derived.missedAppointments > (rows.results || []).length,
      missedAppointments: Object.freeze((rows.results || []).map((row) => Object.freeze({
        appointmentId: row.appointment_id,
        revision: count(row.appointment_revision),
        status: row.normalized_status,
        authority: row.authority,
        sourceKind: row.source_kind,
        historyComplete: Number(row.history_complete) === 1,
        effectiveAt: row.effective_at,
        recordedAt: row.recorded_at,
        startsAt: row.starts_at || null,
        endsAt: row.ends_at || null,
        serviceName: row.service_name || null,
      }))),
    });
  } catch (error) {
    if (error instanceof MissedAppointmentTruthError) throw error;
    if (/no such table: appointment_status_facts/i.test(String(error?.message || error))) {
      throw new MissedAppointmentTruthError("owned missed-appointment schema is not installed", "schema_unavailable", 503);
    }
    throw error;
  }
}
