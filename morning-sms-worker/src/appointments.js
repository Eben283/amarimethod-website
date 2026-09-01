// Read today's GHL appointments. Optional — if GHL credentials are missing,
// the runner keeps its normal schedule and reports that the agenda is unavailable.

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { FIELD_IDS } from "../../functions/lib/ghl-fields.js";
import { hydrateOrders } from "../../functions/lib/ghl-orders.js";
import { deriveLedger, SERIES_CALENDAR_IDS } from "../../functions/lib/session-ledger.js";
import { dateKeyInZone, zonedTimeToUtcMs } from "./schedule.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const STUDY_CALENDAR_ID = "J1N09B6bRYPOGNyVAfmX";
const STUDY_SESSIONS_DONE_FIELD_ID = "Q9DqX2C4ml2TGW679UlM";

const CANCELLED = new Set(["cancelled", "canceled", "invalid", "no_show", "noshow"]);
const LEDGER_FIELD_DEFS = Object.freeze({
  sessions_remaining: FIELD_IDS.sessions_remaining,
  sessions_completed: FIELD_IDS.sessions_completed,
  series_type: FIELD_IDS.series_type,
  sessions_remaining_locked: FIELD_IDS.sessions_remaining_locked,
  session_prepaid: FIELD_IDS.session_prepaid,
});

async function ghlGet(env, path) {
  const token = await getAccessToken(env);
  const url = new URL(`${GHL_BASE}${path}`);
  if (!url.searchParams.has("locationId")) url.searchParams.set("locationId", LOCATION_ID);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function lookupErrorReason(err) {
  const message = String(err?.message || "");
  const ghlStatus = /^GHL (\d{3}):/.exec(message)?.[1];
  if (ghlStatus) return `ghl-${ghlStatus}`;
  if (/PORTAL_KV binding/i.test(message)) return "missing-kv-binding";
  if (/GHL_CLIENT_ID|GHL_CLIENT_SECRET/i.test(message)) return "missing-ghl-credentials";
  if (/fetch failed|network|timeout/i.test(message)) return "network";
  return "calendar-read-failed";
}

function dayRangeMs(dateKey, timeZone) {
  const start = zonedTimeToUtcMs(dateKey, 0, timeZone);
  // Next civil midnight − 1ms
  const [y, mo, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  // nextKey above is UTC-based civil arithmetic on the Y-M-D numbers which matches
  // the Pacific dateKey string advancing by one calendar day.
  const end = zonedTimeToUtcMs(nextKey, 0, timeZone) - 1;
  return { start, end };
}

function apptStartMs(event) {
  const raw = event?.startTime || event?.start_time;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function isActive(event) {
  const status = String(event?.appointmentStatus || event?.status || "").toLowerCase();
  if (CANCELLED.has(status)) return false;
  return true;
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function appointmentFromEvent(event, calendar) {
  const startMs = apptStartMs(event);
  if (startMs == null || !isActive(event)) return null;

  return {
    startMs,
    contactId: text(event?.contactId || event?.contact_id) || null,
    calendarId: text(event?.calendarId || event?.calendar_id || calendar?.id) || null,
    contactName: text(
      event?.contactName ||
      event?.contact_name ||
      [event?.firstName || event?.contact?.firstName, event?.lastName || event?.contact?.lastName].filter(Boolean).join(" "),
    ) || null,
    calendarName: text(event?.calendarName || calendar?.name) || null,
    title: text(event?.title || event?.appointmentTitle || event?.name) || null,
    lastPackageSession: false,
    firstAndOnlyAppointment: false,
    secondToLastStudySession: false,
  };
}

function contactName(contact) {
  return text(contact?.contactName || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ")) || null;
}

function customFieldValue(contact, fieldId) {
  const fields = Array.isArray(contact?.customFields) ? contact.customFields : [];
  const field = fields.find((candidate) => String(candidate?.id || candidate?.key || "") === fieldId);
  return field?.value ?? null;
}

function activeAppointments(appointments) {
  return appointments.filter(isActive);
}

function isInitialOrAssessment(appointment) {
  return /\b(initial|assessment)\b/i.test(`${appointment?.calendarName || ""} ${appointment?.title || ""}`);
}

function isCompletedStudyAppointment(appointment) {
  const status = String(appointment?.appointmentStatus || appointment?.status || "").toLowerCase();
  const calendarId = text(appointment?.calendarId || appointment?.calendar_id);
  return calendarId === STUDY_CALENDAR_ID && ["showed", "completed"].includes(status);
}

async function fetchContactContext(env, contactId) {
  const [contactData, appointmentsData] = await Promise.all([
    ghlGet(env, `/contacts/${contactId}`),
    ghlGet(env, `/contacts/${contactId}/appointments`),
  ]);
  return {
    contact: contactData.contact || contactData || {},
    appointments: appointmentsData.appointments || appointmentsData.events || [],
  };
}

/**
 * Add sales cues only when the supporting contact history proves them. These
 * lookups are deliberately optional: an enrichment failure never drops or
 * delays an otherwise complete agenda.
 */
async function enrichNamesAndSalesOpportunities(env, appointments) {
  const byContact = new Map();
  for (const appointment of appointments) {
    if (!appointment.contactId) continue;
    const group = byContact.get(appointment.contactId) || [];
    group.push(appointment);
    byContact.set(appointment.contactId, group);
  }

  for (const [contactId, todaysAppointments] of byContact) {
    const needsName = todaysAppointments.some((appointment) => !appointment.contactName);
    const initialCandidate = todaysAppointments.some(isInitialOrAssessment);
    const studyCandidate = todaysAppointments.some((appointment) => appointment.calendarId === STUDY_CALENDAR_ID);
    if (!needsName && !initialCandidate && !studyCandidate) continue;

    try {
      const context = await fetchContactContext(env, contactId);
      const name = contactName(context.contact);
      if (name) {
        for (const appointment of todaysAppointments) {
          if (!appointment.contactName) appointment.contactName = name;
        }
      }

      // A first/only opportunity requires exactly one non-cancelled appointment
      // in the contact's complete appointment history; do not infer it merely
      // because today's calendar happens to contain one appointment.
      if (activeAppointments(context.appointments).length === 1) {
        for (const appointment of todaysAppointments) {
          if (isInitialOrAssessment(appointment)) appointment.firstAndOnlyAppointment = true;
        }
      }

      // Studies are three sessions. Prefer the authoritative completed counter;
      // the completed-history fallback is only used when it agrees exactly.
      const completedRaw = customFieldValue(context.contact, STUDY_SESSIONS_DONE_FIELD_ID);
      const completedField = completedRaw == null || completedRaw === "" ? null : Number(completedRaw);
      const completedByHistory = context.appointments.filter(isCompletedStudyAppointment).length;
      if (completedField === 1 || (completedField == null && completedByHistory === 1)) {
        for (const appointment of todaysAppointments) {
          if (appointment.calendarId === STUDY_CALENDAR_ID) appointment.secondToLastStudySession = true;
        }
      }
    } catch (err) {
      console.warn(`[morning-sms] contact opportunity context ${contactId} failed: ${err.message}`);
    }
  }
}

async function fetchContactLedger(env, contactId) {
  const [contactData, ordersData, invoicesData, appointmentsData] = await Promise.all([
    ghlGet(env, `/contacts/${contactId}`),
    ghlGet(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`),
    ghlGet(env, `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
    ghlGet(env, `/contacts/${contactId}/appointments`),
  ]);

  const fetchFailures = [];
  const ordersList = ordersData.data || ordersData.orders || [];
  const invoices = invoicesData.invoices || [];
  const appointments = appointmentsData.appointments || appointmentsData.events || [];
  if (ordersList.length >= 100) fetchFailures.push("orders page full at 100 — history may be truncated");
  if (invoices.length >= 100) fetchFailures.push("invoices page full at 100 — history may be truncated");

  const orders = await hydrateOrders(
    (orderId) => ghlGet(
      env,
      `/payments/orders/${orderId}?altId=${LOCATION_ID}&altType=location`,
    ),
    ordersList,
  );

  return deriveLedger({
    contact: contactData.contact || { customFields: [] },
    orders,
    invoices,
    appointments,
    fieldDefs: LEDGER_FIELD_DEFS,
    fetchFailures,
  });
}

function ledgerCanProveLastSession(ledger) {
  return ledger?.confidence === "high" || ledger?.manualLock === true;
}

async function markLastPackageSessions(env, appointments) {
  const byContact = new Map();
  for (const appointment of appointments) {
    if (!appointment.contactId || !SERIES_CALENDAR_IDS.has(appointment.calendarId)) continue;
    const group = byContact.get(appointment.contactId) || [];
    group.push(appointment);
    byContact.set(appointment.contactId, group);
  }

  // One contact at a time: each ledger read fans out to four GHL endpoints,
  // so sequential enrichment stays below Cloudflare's connection ceiling.
  for (const [contactId, todaysPackageAppointments] of byContact) {
    try {
      const ledger = await fetchContactLedger(env, contactId);
      if (!ledgerCanProveLastSession(ledger)) continue;
      const remaining = Number(ledger.display?.remaining);
      if (!Number.isInteger(remaining) || remaining < 1) continue;
      // If two package visits are booked on the same day and two visits
      // remain, the second one is the package-ending appointment.
      if (remaining <= todaysPackageAppointments.length) {
        todaysPackageAppointments[remaining - 1].lastPackageSession = true;
      }
    } catch (err) {
      // The agenda is still useful without the badge. Fail closed instead of
      // guessing from a stale raw sessions_remaining field.
      console.warn(`[morning-sms] package ledger ${contactId} failed: ${err.message}`);
    }
  }
}

/**
 * Active appointments for the Pacific day containing nowMs, sorted by start.
 * Returns null when any required GHL read is unavailable and [] only when the
 * complete calendar set was read successfully and the day is genuinely empty.
 */
export async function fetchTodaysAppointmentsResult(env, nowMs, timeZone = "America/Los_Angeles") {
  if (!env?.PORTAL_KV) return { appointments: null, error: "missing-kv-binding" };
  if (!env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET) return { appointments: null, error: "missing-ghl-credentials" };

  const dateKey = dateKeyInZone(nowMs, timeZone);
  const { start, end } = dayRangeMs(dateKey, timeZone);

  let calendars;
  try {
    const calData = await ghlGet(env, "/calendars/");
    calendars = calData.calendars || [];
  } catch (err) {
    console.warn(`[morning-sms] calendar list failed: ${err.message}`);
    return { appointments: null, error: lookupErrorReason(err) };
  }

  const appointments = [];
  for (const cal of calendars) {
    try {
      const params = new URLSearchParams({
        locationId: LOCATION_ID,
        calendarId: cal.id,
        startTime: String(start),
        endTime: String(end),
      });
      const data = await ghlGet(env, `/calendars/events?${params}`);
      for (const event of data.events || []) {
        const appointment = appointmentFromEvent(event, cal);
        if (appointment) appointments.push(appointment);
      }
    } catch (err) {
      console.warn(`[morning-sms] events ${cal.id} failed: ${err.message}`);
      return { appointments: null, error: lookupErrorReason(err) };
    }
  }
  appointments.sort((a, b) => a.startMs - b.startMs);
  await enrichNamesAndSalesOpportunities(env, appointments);
  await markLastPackageSessions(env, appointments);
  return { appointments, error: null };
}

/**
 * Read the complete agenda once. Kept as the simple public helper for callers
 * that only need appointments, while the runner uses the retrying result API.
 */
export async function fetchTodaysAppointments(env, nowMs, timeZone = "America/Los_Angeles") {
  const result = await fetchTodaysAppointmentsResult(env, nowMs, timeZone);
  return result.appointments;
}

/**
 * A transient GHL calendar failure must not turn into a bad agenda. Retry the
 * complete sweep, preserving the all-or-nothing contract against partial lists.
 */
export async function fetchTodaysAppointmentsWithRetry(env, nowMs, timeZone = "America/Los_Angeles", { attempts = 2, delayMs = 250 } = {}) {
  let result = { appointments: null, error: "calendar-read-failed" };
  const totalAttempts = Math.max(1, Math.floor(attempts));
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    result = await fetchTodaysAppointmentsResult(env, nowMs, timeZone);
    if (result.appointments !== null) return { ...result, attempts: attempt };
    if (attempt < totalAttempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  return { ...result, attempts: totalAttempts };
}

/** Earliest active appointment start for schedule pull-forward. */
export async function fetchFirstAppointmentMs(env, nowMs, timeZone = "America/Los_Angeles") {
  const appointments = await fetchTodaysAppointments(env, nowMs, timeZone);
  return appointments?.[0]?.startMs ?? null;
}
