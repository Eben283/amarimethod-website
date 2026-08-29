import { createGhlStaffCalendarProvider } from "./staff-calendar-provider-ghl.js";
import { createGoogleStaffCalendarProvider } from "./staff-calendar-provider-google.js";
import { requireProviderContactIdentity } from "./staff-owned-contact-identity.js";

const SUPPORTED = new Set(["ghl", "google_calendar"]);

export function configuredStaffCalendarProvider(env) {
  const provider = String(env?.STAFF_APPOINTMENT_CALENDAR_PROVIDER || "ghl").trim();
  if (!SUPPORTED.has(provider)) {
    const error = new Error("Configured Staff appointment calendar provider is unsupported.");
    error.code = "calendar_provider_unsupported";
    throw error;
  }
  return provider;
}

export function configuredStaffCalendarProviderForBooking(env, booking) {
  // The first reviewed non-GHL vertical is the in-person Partner Initial
  // service. Every other service remains on its current adapter until its own
  // location/meeting/payment/lifecycle contract is migrated coherently.
  return booking?.serviceId === "partner-initial" ? configuredStaffCalendarProvider(env) : "ghl";
}

export function createStaffCalendarProvider(context, identity, requestedProvider = null) {
  const provider = requestedProvider || configuredStaffCalendarProvider(context?.env);
  if (provider === "google_calendar") {
    return createGoogleStaffCalendarProvider(context, identity?.ownedContactId);
  }
  return createGhlStaffCalendarProvider(context, requireProviderContactIdentity(identity));
}
