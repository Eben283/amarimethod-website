// Read today's first GHL appointment (for schedule pull-forward). Optional —
// if GHL creds/token are missing, the runner falls back to 08:00 / 09:30.

import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { dateKeyInZone, zonedTimeToUtcMs } from "./schedule.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
export const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const CANCELLED = new Set(["cancelled", "canceled", "invalid", "no_show", "noshow"]);

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

/**
 * Earliest active appointment start (ms) for the Pacific day containing nowMs.
 * Returns null when none / GHL unavailable.
 */
export async function fetchFirstAppointmentMs(env, nowMs, timeZone = "America/Los_Angeles") {
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

  let earliest = null;
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
        if (!isActive(event)) continue;
        const ms = apptStartMs(event);
        if (ms == null) continue;
        if (earliest == null || ms < earliest) earliest = ms;
      }
    } catch (err) {
      console.warn(`[morning-sms] events ${cal.id} failed: ${err.message}`);
    }
  }
  return earliest;
}
