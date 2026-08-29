const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/appointments";
const TIMEOUT_MS = 10_000;

function identityError(body, status) {
  const error = new Error(body?.detail || body?.error || "Owned appointment identity is unavailable.");
  error.code = body?.error || "owned_appointment_identity_unavailable";
  error.status = status;
  return error;
}

export async function resolveStaffOwnedAppointmentIdentity(context, reference) {
  if (!context?.env?.WORKER_AUTH_SECRET) throw identityError({}, 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}/${encodeURIComponent(reference)}/identity`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw identityError(body, response.status);
    const identity = body?.identity;
    if (!identity?.ownedAppointmentId || !identity?.ownedContactId) throw identityError({}, 503);
    return Object.freeze(identity);
  } catch (error) {
    if (error?.code) throw error;
    throw identityError({}, 503);
  } finally {
    clearTimeout(timer);
  }
}

export function requireProviderAppointmentIdentity(identity) {
  const provider = String(identity?.provider || (identity?.providerContactId ? "ghl" : ""));
  if (!identity?.providerAppointmentId || !new Set(["ghl", "google_calendar"]).has(provider) ||
      (provider === "ghl" && !identity?.providerContactId)) {
    throw identityError({
      error: "provider_appointment_identity_missing",
      detail: "This owned appointment has no verified temporary provider link.",
    }, 409);
  }
  return {
    provider,
    appointmentId: identity.providerAppointmentId,
    contactId: identity.providerContactId || null,
  };
}
