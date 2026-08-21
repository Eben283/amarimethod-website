// Read today's GHL appointments. Optional — if GHL credentials are missing,
// the runner keeps its normal schedule and reports that the agenda is unavailable.

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { FIELD_IDS } from "../../functions/lib/ghl-fields.js";
import { hydrateOrders } from "../../functions/lib/ghl-orders.js";
import { deriveLedger, SERIES_CALENDAR_IDS } from "../../functions/lib/session-ledger.js";
import { dateKeyInZone, zonedTimeToUtcMs } from "./schedule.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

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
      [event?.firstName, event?.lastName].filter(Boolean).join(" "),
    ) || null,
    calendarName: text(event?.calendarName || calendar?.name) || null,
    title: text(event?.title) || null,
    lastPackageSession: false,
  };
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
export async function fetchTodaysAppointments(env, nowMs, timeZone = "America/Los_Angeles") {
  if (!env?.PORTAL_KV) return null;
  if (!env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET) return null;

  const dateKey = dateKeyInZone(nowMs, timeZone);
  const { start, end } = dayRangeMs(dateKey, timeZone);

  let calendars;
  try {
    const calData = await ghlGet(env, "/calendars/");
    calendars = calData.calendars || [];
  } catch (err) {
    console.warn(`[morning-sms] calendar list failed: ${err.message}`);
    return null;
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
      return null;
    }
  }
  appointments.sort((a, b) => a.startMs - b.startMs);
  await markLastPackageSessions(env, appointments);
  return appointments;
}

/** Earliest active appointment start for schedule pull-forward. */
export async function fetchFirstAppointmentMs(env, nowMs, timeZone = "America/Los_Angeles") {
  const appointments = await fetchTodaysAppointments(env, nowMs, timeZone);
  return appointments?.[0]?.startMs ?? null;
}
