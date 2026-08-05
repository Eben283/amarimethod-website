// GHL appointment workflows do not reliably fire when an API-created appointment
// is born already `confirmed`. Live-isolated verification on 2026-08-04 proved
// that creating it as `new`, then issuing a separate status update to `confirmed`,
// fires the existing Appointment Status workflows with full appointment context.

export class AppointmentHandoffError extends Error {
  constructor(phase, status, detail, appointmentId = null, cleanupStatus = null) {
    super(`GHL appointment ${phase} failed (${status || "unknown"}): ${String(detail || "unknown error").slice(0, 500)}`);
    this.name = "AppointmentHandoffError";
    this.phase = phase;
    this.status = status || 0;
    this.detail = String(detail || "");
    this.appointmentId = appointmentId;
    this.cleanupStatus = cleanupStatus;
  }
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "response body unavailable";
  }
}

export async function createConfirmedAppointment({ request, endpoint, payload }) {
  if (typeof request !== "function") throw new TypeError("request callback required");
  if (!endpoint) throw new TypeError("appointment endpoint required");

  const createResponse = await request(endpoint, {
    method: "POST",
    body: JSON.stringify({ ...payload, appointmentStatus: "new" }),
  });
  if (!createResponse.ok) {
    throw new AppointmentHandoffError("create", createResponse.status, await responseText(createResponse));
  }

  const data = await createResponse.json();
  const appointmentId = data?.id || data?.appointment?.id || data?.event?.id || null;
  if (!appointmentId) {
    throw new AppointmentHandoffError("create", 502, "GHL response did not include an appointment ID");
  }

  const appointmentUrl = `${endpoint}/${encodeURIComponent(appointmentId)}`;
  const confirmResponse = await request(appointmentUrl, {
    method: "PUT",
    body: JSON.stringify({ appointmentStatus: "confirmed" }),
  });
  if (!confirmResponse.ok) {
    const detail = await responseText(confirmResponse);
    let cleanupStatus = null;
    try {
      const cleanup = await request(appointmentUrl, {
        method: "PUT",
        body: JSON.stringify({ appointmentStatus: "cancelled" }),
      });
      cleanupStatus = cleanup.status;
    } catch {
      cleanupStatus = 0;
    }
    throw new AppointmentHandoffError("confirm", confirmResponse.status, detail, appointmentId, cleanupStatus);
  }

  return {
    ...data,
    id: appointmentId,
    appointment: data?.appointment
      ? { ...data.appointment, id: appointmentId, appointmentStatus: "confirmed" }
      : data?.appointment,
    appointmentStatus: "confirmed",
  };
}
