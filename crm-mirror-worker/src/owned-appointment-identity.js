const REFERENCE = /^[A-Za-z0-9_-]{1,160}$/;

export class OwnedAppointmentIdentityError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "OwnedAppointmentIdentityError";
    this.code = code;
    this.status = status;
  }
}

export async function resolveOwnedAppointmentIdentity(db, reference) {
  const value = String(reference || "").trim();
  if (!REFERENCE.test(value)) {
    throw new OwnedAppointmentIdentityError("appointment reference required", "appointment_reference_required", 400);
  }
  const result = await db.prepare(
    `SELECT appointment.id AS owned_appointment_id,
            appointment.contact_id AS owned_contact_id,
            appointment.provider_appointment_id,
            appointment.provider_calendar_id,
            appointment.authority,
            appointment.provider_sync_state,
            (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(external_id) END
               FROM external_records
              WHERE contact_id = appointment.contact_id
                AND provider = 'ghl'
                AND object_type = 'contact') AS provider_contact_id,
            (SELECT COUNT(*)
               FROM external_records
              WHERE contact_id = appointment.contact_id
                AND provider = 'ghl'
                AND object_type = 'contact') AS provider_contact_count
       FROM appointments appointment
      WHERE appointment.id = ? OR appointment.provider_appointment_id = ?
      ORDER BY CASE WHEN appointment.id = ? THEN 0 ELSE 1 END
      LIMIT 2`,
  ).bind(value, value, value).all();
  const rows = result.results || [];
  if (rows.length === 0) {
    throw new OwnedAppointmentIdentityError("appointment is not linked to the owned CRM", "owned_appointment_not_found", 404);
  }
  const identities = new Map(rows.map((row) => [row.owned_appointment_id, row]));
  if (identities.size !== 1) {
    throw new OwnedAppointmentIdentityError("appointment reference is ambiguous", "owned_appointment_ambiguous", 409);
  }
  const row = [...identities.values()][0];
  if (Number(row.provider_contact_count || 0) > 1) {
    throw new OwnedAppointmentIdentityError(
      "appointment contact has ambiguous provider identity",
      "provider_contact_ambiguous",
      409,
    );
  }
  return {
    ownedAppointmentId: row.owned_appointment_id,
    ownedContactId: row.owned_contact_id,
    providerAppointmentId: row.provider_appointment_id || null,
    providerContactId: row.provider_contact_id || null,
    providerCalendarId: row.provider_calendar_id || null,
    authority: row.authority,
    providerSyncState: row.provider_sync_state,
  };
}
