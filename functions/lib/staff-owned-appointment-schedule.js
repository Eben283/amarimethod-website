const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/appointments";
const TIMEOUT_MS = 10_000;

export async function fetchOwnedAppointmentSchedule(context, input) {
  if (!context?.env?.WORKER_AUTH_SECRET) throw new Error("Owned appointment schedule is not configured.");
  const params = new URLSearchParams({
    startTime: new Date(input.startTime).toISOString(),
    endTime: new Date(input.endTime).toISOString(),
  });
  if (input.includeCancelled) params.set("includeCancelled", "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}?${params}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Owned appointment schedule failed (${response.status}).`);
    const body = await response.json();
    if (body?.source !== "owned_crm" || !Array.isArray(body.appointments) || !body.truth) {
      throw new Error("Owned appointment schedule returned an invalid contract.");
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export function staffScheduleSummaries(schedule) {
  return schedule.appointments.map((appointment) => ({
    id: appointment.id,
    calendarId: appointment.providerCalendarId || "",
    contactId: appointment.contactId,
    contactName: appointment.contactName,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    title: appointment.serviceName || "Session",
    calendarName: appointment.serviceName || "Session",
    appointmentStatus: appointment.status,
    meetingLocation: null,
    sessionsRemaining: 0,
    sessionsCompleted: 0,
    seriesType: "none",
    tags: [],
    sessionPrepaid: false,
    paymentStatus: "unknown",
    paymentMethod: null,
    paymentNote: null,
    authority: appointment.authority,
    providerSyncState: appointment.providerSyncState,
    truthState: appointment.truthState,
    providerAppointmentId: appointment.providerAppointmentId,
  }));
}
