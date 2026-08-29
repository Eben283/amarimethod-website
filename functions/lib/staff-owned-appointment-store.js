// Pages-side client for the owned CRM appointment command owner.
// All durable identity and execution state lives in CRM_DB; this adapter only
// translates the existing schedule-domain store interface into authenticated
// Worker calls during the temporary GHL propagation phase.

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/appointments/commands";
const TIMEOUT_MS = 10_000;

function commandError(body, status) {
  const error = new Error(body?.detail || body?.error || "Owned appointment command failed.");
  error.code = body?.error || "owned_appointment_unavailable";
  error.status = status;
  if (error.code === "manual_review") error.manualReview = true;
  return error;
}

async function post(context, actor, payload) {
  if (!context?.env?.WORKER_AUTH_SECRET) throw commandError({ error: "owned_appointment_unavailable" }, 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}`,
        "Content-Type": "application/json",
        "X-Staff-Actor": actor,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw commandError(body, response.status);
    return body;
  } catch (error) {
    if (error?.code) throw error;
    throw commandError({ error: "owned_appointment_unavailable", detail: "Owned appointment command is unavailable." }, 503);
  } finally {
    clearTimeout(timer);
  }
}

export function createOwnedAppointmentScheduleStore(context, input) {
  const actor = String(input?.actor || "");
  const serviceId = String(input?.booking?.serviceId || "");
  const calendarId = String(input?.booking?.calendarId || "");
  if (!new Set(["Eben", "Garrett"]).has(actor) || !serviceId || !calendarId) {
    throw new TypeError("owned appointment store identity required");
  }
  let commandId = null;
  let ownedAppointmentId = null;

  return Object.freeze({
    async claim() {
      const captured = await post(context, actor, {
        action: "schedule",
        contactId: input.contactId,
        serviceId,
        idempotencyKey: input.idempotencyKey,
        startTime: input.startTime,
        timezone: input.timezone,
      });
      commandId = captured.appointment?.commandId;
      ownedAppointmentId = captured.appointment?.appointmentId;
      if (!commandId || !ownedAppointmentId) throw commandError({ error: "owned_appointment_invalid_readback" }, 503);
      const claimed = await post(context, actor, { action: "claim", commandId });
      const execution = claimed.execution || {};
      if (claimed.state === "completed") return { state: "completed", operation: { result: execution.result } };
      if (claimed.state === "rejected") {
        throw commandError({ error: "appointment_rejected", detail: execution.lastError || "Appointment request was rejected." }, 409);
      }
      if (claimed.state !== "acquired") return { state: claimed.state || "in_progress", operation: execution };
      return {
        state: "acquired",
        operation: {
          ...execution,
          appointmentId: execution.providerRecordId || null,
          ownedAppointmentId,
        },
      };
    },

    checkpointAppointment(providerRecordId) {
      return post(context, actor, {
        action: "provider-link",
        commandId,
        provider: "ghl",
        providerRecordId,
        providerCalendarId: calendarId,
        providerStatusRaw: "new",
      });
    },

    clearAppointment(providerRecordId) {
      return post(context, actor, { action: "provider-unlink", commandId, providerRecordId });
    },

    canonicalResult(result) {
      return {
        ...result,
        appointmentId: ownedAppointmentId,
        providerAppointmentId: result.appointmentId,
        authority: "owned",
      };
    },

    async complete(result) {
      const response = await post(context, actor, { action: "complete", commandId, result });
      return response.execution;
    },

    async fail(error, options = {}) {
      const response = await post(context, actor, {
        action: "fail",
        commandId,
        error: String(error?.message || error || "appointment execution failed").slice(0, 1000),
        manualReview: options.manualReview === true,
        terminal: error?.code === "slot_unavailable" || error?.code === "invalid_schedule_time",
      });
      return response.execution;
    },
  });
}
