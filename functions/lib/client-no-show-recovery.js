import { verifyAppointmentManageToken } from "./appointment-manage-token.js";
import { resolveStaffOwnedAppointmentIdentity } from "./staff-owned-appointment-identity.js";
import { captureOwnedAppointmentRecoveryRequest } from "./staff-owned-appointment-store.js";

const RECOVERABLE_AUTHORITY = new Set(["owned", "provider_mirror"]);
const RECOVERABLE_SYNC = new Set(["synced", "not_required"]);

const clean = (value, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";

function fail(message, code, status = 409) {
  throw Object.assign(new Error(message), { code, status });
}

export async function resolveClientNoShowRecoveryContext(context, token, nowMs = Date.now()) {
  const secret = context?.env?.APPOINTMENT_MANAGE_LINK_SECRET;
  if (clean(secret).length < 32) {
    fail("Appointment recovery is temporarily unavailable.", "appointment_manage_secret_unavailable", 503);
  }
  let claims;
  try {
    claims = await verifyAppointmentManageToken(secret, token, { capability: "recovery", nowMs });
  } catch {
    fail("This recovery link is invalid or has expired.", "appointment_recovery_link_invalid", 401);
  }
  const identity = await resolveStaffOwnedAppointmentIdentity(context, claims.appointmentId);
  if (identity.ownedAppointmentId !== claims.appointmentId || identity.ownedContactId !== claims.contactId) {
    fail("This recovery link does not match the owned appointment.", "appointment_recovery_identity_mismatch");
  }
  if (Number(identity.revision) !== claims.revision) {
    fail("This appointment has changed since the recovery link was issued.", "appointment_recovery_link_stale");
  }
  if (!clean(identity.serviceId)) {
    fail("This appointment has no governed service identity.", "appointment_recovery_service_unavailable");
  }
  if (!RECOVERABLE_AUTHORITY.has(clean(identity.authority)) ||
      !RECOVERABLE_SYNC.has(clean(identity.providerSyncState))) {
    fail("This appointment is not ready for a recovery request.", "appointment_recovery_authority_unavailable");
  }
  if (clean(identity.status, 40).toLowerCase() !== "no_show") {
    fail("This appointment is not recorded as missed.", "appointment_recovery_not_missed");
  }
  const startsAt = Date.parse(identity.startsAt || "");
  if (!Number.isFinite(startsAt) || startsAt > nowMs) {
    fail("This appointment is not eligible for recovery review.", "appointment_recovery_time_invalid");
  }
  return Object.freeze({ claims, identity: Object.freeze(identity) });
}

export async function executeClientNoShowRecoveryRequest(context, token, nowMs = Date.now()) {
  const { claims, identity } = await resolveClientNoShowRecoveryContext(context, token, nowMs);
  return captureOwnedAppointmentRecoveryRequest(context, {
    appointmentId: identity.ownedAppointmentId,
    contactId: identity.ownedContactId,
    appointmentRevision: claims.revision,
  });
}
