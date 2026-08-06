// App-owned booking buffers. GHL exposes raw free slots with slotBuffer=0;
// every native booking surface filters those slots against this policy.

import { ghlFetch } from "./ghl.js";
import { parsePacificWallClock } from "./datetime.js";
import { policyForCalendarId, SLOT_POLICIES } from "./booking-slot-policy.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const EVENT_LOOKUP_CONCURRENCY = 3;
const INACTIVE_STATUSES = new Set(["cancelled", "canceled", "no_show", "noshow"]);

export const APP_BUFFER_CALENDAR_IDS = Object.freeze(
  Object.values(SLOT_POLICIES).flatMap((policy) => policy.calendarIds),
);

function timeMs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  return parsePacificWallClock(String(value || ""));
}

function eventStatus(event) {
  return String(event?.appointmentStatus || event?.status || "").toLowerCase();
}

export function isBlockingAppointment(event) {
  return !!event && !INACTIVE_STATUSES.has(eventStatus(event));
}

export function eventRange(event) {
  const start = timeMs(event?.startTime || event?.start_time);
  if (!Number.isFinite(start)) return null;
  const endFromEvent = timeMs(event?.endTime || event?.end_time);
  const policy = policyForCalendarId(event?.calendarId || event?.calendar_id);
  const end = Number.isFinite(endFromEvent)
    ? endFromEvent
    : start + (policy?.durationMinutes || 0) * 60_000;
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end, policy };
}

/**
 * True when a proposed native booking respects the post-buffer on both sides
 * of every existing Amari appointment. Existing events and selected slots are
 * never returned to the browser; only availability is exposed.
 */
export function slotRespectsAppBuffer(startTime, calendarId, events) {
  const proposed = policyForCalendarId(calendarId);
  const start = timeMs(startTime);
  if (!proposed || !Number.isFinite(start)) return false;
  const endWithBuffer = start + (proposed.durationMinutes + proposed.bufferMinutes) * 60_000;
  for (const event of events || []) {
    if (!isBlockingAppointment(event)) continue;
    const range = eventRange(event);
    if (!range) continue;
    const existingEndWithBuffer = range.end + (range.policy?.bufferMinutes || 0) * 60_000;
    if (start < existingEndWithBuffer && range.start < endWithBuffer) return false;
  }
  return true;
}

export function filterSlotsByAppBuffer(slots, calendarId, events) {
  if (!policyForCalendarId(calendarId)) return slots;
  return (slots || []).filter((slot) =>
    slotRespectsAppBuffer(slot?.datetime || slot?.startTime, calendarId, events),
  );
}

function localDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : "";
}

function localMinutes(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

/**
 * Shape the displayed options around Garrett's existing appointments without
 * exposing those appointments. A morning cluster keeps morning choices plus
 * one later option; a morning-and-evening day keeps only choices near either
 * cluster so the middle stays clear. This is presentation only: the buffer
 * filter above remains the availability authority.
 */
export function applyGarrettSchedulePreference(slots, events) {
  if (!Array.isArray(slots) || slots.length === 0) return slots;
  const eventsByDate = new Map();
  for (const event of events || []) {
    if (!isBlockingAppointment(event)) continue;
    const range = eventRange(event);
    // Every real appointment is a schedule anchor, including 10-minute-buffer
    // Discovery calls. Buffer length controls collision safety above; it must
    // not decide whether an existing booking influences day clustering.
    if (!range?.policy) continue;
    const date = localDate(event?.startTime || event?.start_time);
    const minutes = localMinutes(event?.startTime || event?.start_time);
    if (!date || minutes == null) continue;
    if (!eventsByDate.has(date)) eventsByDate.set(date, []);
    eventsByDate.get(date).push(minutes);
  }

  const byDate = new Map();
  for (const slot of slots) {
    const date = slot?.date || localDate(slot?.datetime || slot?.startTime);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(slot);
  }

  const preferred = [];
  for (const [date, daySlots] of byDate) {
    const anchors = eventsByDate.get(date) || [];
    if (!anchors.length) {
      preferred.push(...daySlots);
      continue;
    }
    const timed = daySlots.map((slot) => ({ slot, minutes: localMinutes(slot?.datetime || slot?.startTime) }));
    const morning = anchors.some((minutes) => minutes < 12 * 60);
    const evening = anchors.some((minutes) => minutes >= 16 * 60);
    let selected;
    if (morning && evening) {
      // Keep roughly two hours on either side of the booked clusters; this
      // deliberately avoids offering an isolated middle-of-day appointment.
      selected = timed.filter(({ minutes }) => minutes != null && anchors.some((anchor) => Math.abs(minutes - anchor) <= 120));
    } else if (morning) {
      const nearMorning = timed.filter(({ minutes }) => minutes != null && minutes < 14 * 60);
      const later = timed.find(({ minutes }) => minutes != null && minutes >= 15 * 60);
      selected = later ? [...nearMorning, later] : nearMorning;
    } else if (evening) {
      const nearEvening = timed.filter(({ minutes }) => minutes != null && minutes >= 14 * 60);
      const earlier = timed.find(({ minutes }) => minutes != null && minutes < 12 * 60);
      selected = earlier ? [earlier, ...nearEvening] : nearEvening;
    } else {
      selected = timed.filter(({ minutes }) => minutes != null && anchors.some((anchor) => Math.abs(minutes - anchor) <= 120));
    }
    // Never hide a day entirely if the source calendar offered real slots.
    preferred.push(...(selected.length ? selected.map(({ slot }) => slot) : daySlots));
  }
  return preferred.sort((a, b) => String(a?.datetime || a?.startTime || "").localeCompare(String(b?.datetime || b?.startTime || "")));
}

function eventUrl(calendarId, startTime, endTime) {
  return `${GHL_API_BASE}/calendars/events?locationId=${GHL_LOCATION_ID}&calendarId=${calendarId}&startTime=${startTime}&endTime=${endTime}`;
}

/** Load only time/status/calendar metadata needed to enforce buffers. */
export async function fetchAppBufferEvents(context, startTime, endTime) {
  const start = Number(startTime) - 2 * 60 * 60 * 1000;
  const end = Number(endTime) + 2 * 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Invalid buffer event range");
  }
  // Keep each request inside the same 30-day envelope used by GHL's
  // availability endpoint. This avoids a long public availability query
  // failing solely because the selected window spans more than a month.
  const windows = [];
  for (let cursor = start; cursor < end; cursor += 30 * 86400_000) {
    windows.push([cursor, Math.min(cursor + 30 * 86400_000, end)]);
  }
  const requests = APP_BUFFER_CALENDAR_IDS.flatMap((calendarId) =>
    windows.map(([windowStart, windowEnd]) => ({ calendarId, windowStart, windowEnd })),
  );
  const responses = [];
  // GHL applies location-wide rate limits. A public two-month lookup can fan
  // out across every Amari calendar, so run bounded batches instead of sending
  // the entire cross-calendar sweep at once. Any failed request still rejects
  // the lookup and keeps availability fail-closed.
  for (let i = 0; i < requests.length; i += EVENT_LOOKUP_CONCURRENCY) {
    const batch = requests.slice(i, i + EVENT_LOOKUP_CONCURRENCY);
    const batchResponses = await Promise.all(
      batch.map(async ({ calendarId, windowStart, windowEnd }) => {
        const response = await ghlFetch(context, eventUrl(calendarId, windowStart, windowEnd));
        if (!response.ok) throw new Error(`Buffer event lookup failed (${response.status})`);
        const data = await response.json();
        return data.events || data.appointments || [];
      }),
    );
    responses.push(...batchResponses);
  }
  const seen = new Set();
  return responses.flat().filter((event) => {
    const id = String(event?.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function assertSlotRespectsAppBuffer(context, startTime, calendarId) {
  const start = timeMs(startTime);
  const policy = policyForCalendarId(calendarId);
  if (!Number.isFinite(start) || !policy) throw new Error("Invalid app-owned buffer request");
  const events = await fetchAppBufferEvents(
    context,
    start,
    start + (policy.durationMinutes + policy.bufferMinutes) * 60_000,
  );
  if (!slotRespectsAppBuffer(startTime, calendarId, events)) {
    throw new Error("That time no longer has the required scheduling buffer");
  }
}
