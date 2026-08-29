const MAX_RANGE_MS = 45 * 86_400_000;

function truthState(row) {
  if (row.authority !== "owned") return "mirrored";
  if (row.provider_sync_state === "synced" || row.provider_sync_state === "not_required") return "authoritative";
  if (row.provider_sync_state === "pending") return "propagating";
  return "degraded";
}

export function normalizeOwnedScheduleRange(input) {
  const startMs = Date.parse(input?.startTime || "");
  const endMs = Date.parse(input?.endTime || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > MAX_RANGE_MS) {
    throw new TypeError("valid appointment range of 45 days or less required");
  }
  return { startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString() };
}

export async function listOwnedAppointmentSchedule(db, input) {
  if (!db) throw new Error("owned appointment storage is unavailable");
  const range = normalizeOwnedScheduleRange(input);
  const includeCancelled = input?.includeCancelled === true;
  const result = await db.prepare(
    `SELECT appointment.id, appointment.contact_id, contact.display_name,
            appointment.service_id, service.name AS service_name,
            appointment.provider_appointment_id, appointment.provider_calendar_id,
            appointment.status, appointment.starts_at, appointment.ends_at,
            appointment.timezone, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            appointment.updated_at
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
      WHERE appointment.starts_at IS NOT NULL
        AND datetime(appointment.starts_at) >= datetime(?)
        AND datetime(appointment.starts_at) <= datetime(?)
        AND (? = 1 OR appointment.status <> 'cancelled')
      ORDER BY datetime(appointment.starts_at), appointment.id
      LIMIT 1000`,
  ).bind(range.startTime, range.endTime, includeCancelled ? 1 : 0).all();
  const appointments = (result.results || []).map((row) => ({
    id: row.id,
    contactId: row.contact_id,
    contactName: row.display_name,
    serviceId: row.service_id || null,
    serviceName: row.service_name || "Session",
    startTime: row.starts_at,
    endTime: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    authority: row.authority,
    providerSyncState: row.provider_sync_state,
    truthState: truthState(row),
    revision: Number(row.revision || 1),
    providerAppointmentId: row.provider_appointment_id || null,
    providerCalendarId: row.provider_calendar_id || null,
    updatedAt: row.updated_at,
  }));
  return {
    source: "owned_crm",
    range,
    appointments,
    truth: {
      authoritative: appointments.filter((row) => row.truthState === "authoritative").length,
      propagating: appointments.filter((row) => row.truthState === "propagating").length,
      mirrored: appointments.filter((row) => row.truthState === "mirrored").length,
      degraded: appointments.filter((row) => row.truthState === "degraded").length,
    },
  };
}
