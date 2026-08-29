const MAX_RANGE_MS = 45 * 86_400_000;

function truthState(row) {
  if (row.authority !== "owned") return "mirrored";
  if (row.provider_sync_state === "synced" || row.provider_sync_state === "not_required") return "authoritative";
  if (row.provider_sync_state === "pending") return "propagating";
  return "degraded";
}

function integerOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function detailedAppointment(row) {
  const ledgerEntryCount = Number(row.ledger_entry_count || 0);
  const importedBalance = integerOrNull(row.imported_sessions_remaining);
  const sessionsRemaining = ledgerEntryCount > 0
    ? Number(row.ledger_balance || 0)
    : importedBalance;
  const paymentStatus = row.payment_status || "unknown";
  const paymentRequired = !["discovery", "partner_session", "study"].includes(row.service_family);
  const balanceSource = ledgerEntryCount > 0
    ? "owned_ledger"
    : importedBalance == null ? "unknown" : "provider_mirror";
  const seriesType = row.imported_series_type || "none";
  const meetingSource = row.meeting_location
    ? "owned"
    : row.provider_meeting_location ? "provider_mirror" : "unknown";
  const paymentSource = row.payment_status ? "owned_record" : "unknown";
  const complete = balanceSource !== "unknown" && (!paymentRequired || paymentSource !== "unknown");
  return {
    meetingLocation: row.meeting_location || row.provider_meeting_location || null,
    sessionsRemaining: sessionsRemaining ?? 0,
    sessionsCompleted: Number(row.sessions_completed || 0),
    seriesType,
    tags: row.tags_joined ? String(row.tags_joined).split("\u001f").filter(Boolean) : [],
    sessionPrepaid: paymentStatus === "paid" || paymentStatus === "on-package" || Number(sessionsRemaining || 0) > 0,
    paymentStatus,
    paymentMethod: row.payment_method || null,
    paymentNote: row.payment_note || null,
    enrichmentFailed: false,
    detailTruth: {
      overall: complete ? "complete" : "partial",
      sessionBalance: balanceSource,
      series: row.imported_series_type ? "provider_mirror" : "unknown",
      payment: paymentSource,
      meetingLocation: meetingSource,
    },
  };
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
  const includeDetail = input?.includeDetail === true;
  const now = new Date(input?.now || Date.now()).toISOString();
  const result = await db.prepare(
    `SELECT appointment.id, appointment.contact_id, contact.display_name,
            appointment.service_id, service.name AS service_name, service.service_family,
            appointment.provider_appointment_id, appointment.provider_calendar_id,
            appointment.status, appointment.starts_at, appointment.ends_at,
            appointment.timezone, appointment.authority,
            appointment.provider_sync_state, appointment.revision,
            appointment.meeting_location, appointment.provider_meeting_location,
            appointment.updated_at,
            (SELECT GROUP_CONCAT(tag, char(31)) FROM (
               SELECT tag FROM contact_tags
                WHERE contact_id = contact.id ORDER BY tag
             )) AS tags_joined,
            (SELECT attribute_value FROM contact_attributes
              WHERE contact_id = contact.id AND source = 'ghl'
                AND attribute_key = 'wrQSkx6BhXwDGIn1d0V4') AS imported_sessions_remaining,
            (SELECT attribute_value FROM contact_attributes
              WHERE contact_id = contact.id AND source = 'ghl'
                AND attribute_key = '3i93lTkmuAV49s9nh0q8') AS imported_series_type,
            (SELECT COUNT(*) FROM session_ledger_entries ledger
              WHERE ledger.contact_id = contact.id) AS ledger_entry_count,
            (SELECT COALESCE(SUM(credits), 0) FROM session_ledger_entries ledger
              WHERE ledger.contact_id = contact.id) AS ledger_balance,
            (SELECT COUNT(*)
               FROM appointments history
               LEFT JOIN services history_service ON history_service.id = history.service_id
              WHERE history.contact_id = contact.id
                AND (history.status = 'attended'
                  OR (history.status IN ('booked', 'confirmed')
                    AND datetime(history.starts_at) < datetime(?)))
                AND COALESCE(history_service.service_family, '') NOT IN ('discovery', 'study')
            ) AS sessions_completed,
            payment.status AS payment_status, payment.method AS payment_method,
            payment.note AS payment_note
       FROM appointments appointment
       JOIN contacts contact ON contact.id = appointment.contact_id
       LEFT JOIN services service ON service.id = appointment.service_id
       LEFT JOIN appointment_payment_records payment ON payment.appointment_id = appointment.id
      WHERE appointment.starts_at IS NOT NULL
        AND datetime(appointment.starts_at) >= datetime(?)
        AND datetime(appointment.starts_at) <= datetime(?)
        AND (? = 1 OR appointment.status <> 'cancelled')
      ORDER BY datetime(appointment.starts_at), appointment.id
      LIMIT 1000`,
  ).bind(now, range.startTime, range.endTime, includeCancelled ? 1 : 0).all();
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
    ...(includeDetail ? detailedAppointment(row) : {}),
  }));
  return {
    source: "owned_crm",
    detailIncluded: includeDetail,
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
