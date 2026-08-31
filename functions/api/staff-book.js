// Cloudflare Pages Function: POST /api/staff-book
// Staff "Book for someone" — pick a contact + session type + free slot,
// create the GHL appointment. Server maps sessionType → calendar (never
// trusts client calendarId).

import { corsHeaders, parseJsonBody, requireStaffAuth } from "../lib/endpoint-guards.js";
import { ghlFetch } from "../lib/ghl.js";
import { appointmentEndTime } from "../lib/datetime.js";
import { listStaffBookTypes, resolveStaffBookType, flattenSlots } from "../lib/staff-book-calendars.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { applyGarrettSchedulePreference, assertSlotRespectsAppBuffer, fetchAppBufferEvents, filterSlotsByAppBuffer } from "../lib/app-owned-buffer.js";
import { createConfirmedAppointment } from "../lib/ghl-appointment-handoff.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const METHODS = "POST, OPTIONS";
const CANCELLED = new Set(["cancelled", "canceled"]);

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanText(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validDateRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 32 * 86400000;
}

async function freeSlots(context, calendarId, startDate, endDate, timezone) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`) + 12 * 60 * 60 * 1000;
  const windows = [];
  for (let cursor = start; cursor < end; cursor += 30 * 86400000) {
    windows.push([cursor, Math.min(cursor + 30 * 86400000, end)]);
  }
  const responses = await Promise.all(windows.map(([windowStart, windowEnd]) => ghlFetch(
    context,
    `${GHL_API_BASE}/calendars/${calendarId}/free-slots?startDate=${windowStart}&endDate=${windowEnd}&timezone=${encodeURIComponent(timezone)}`,
  )));
  const merged = {};
  let succeeded = false;
  for (const response of responses) {
    if (!response.ok) {
      console.error("[staff-book] slot lookup error:", response.status, (await response.text()).slice(0, 200));
      continue;
    }
    succeeded = true;
    const data = await response.json();
    for (const [date, value] of Object.entries(data)) {
      if (!merged[date]) merged[date] = { slots: [] };
      for (const slot of (Array.isArray(value?.slots) ? value.slots : [])) {
        if (!merged[date].slots.includes(slot)) merged[date].slots.push(slot);
      }
    }
  }
  if (!succeeded) throw new Error("Could not load available times.");
  const slots = flattenSlots(merged);
  const events = await fetchAppBufferEvents(context, start, end);
  return applyGarrettSchedulePreference(
    filterSlotsByAppBuffer(slots, calendarId, events),
    events,
  );
}

async function findUpcomingOnCalendar(context, contactId, calendarId) {
  const response = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`);
  if (!response.ok) return null;
  const data = await response.json();
  const now = Date.now();
  const upcoming = (data.appointments || data.events || [])
    .filter((appt) => appt?.calendarId === calendarId)
    .map((appt) => ({
      id: String(appt.id || ""),
      startTime: appt.startTime || appt.start_time || "",
      status: String(appt.appointmentStatus || appt.status || "").toLowerCase(),
    }))
    .filter((appt) => appt.id && appt.startTime && !CANCELLED.has(appt.status) && Date.parse(appt.startTime) >= now - 60 * 60 * 1000)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return upcoming[0] || null;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), METHODS),
  });
}

export async function onRequestPost(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const { body, error: parseError } = await parseJsonBody(context.request, headers);
  if (parseError) return parseError;

  const action = cleanText(body.action, 40);

  if (action === "list-types") {
    return json({ types: listStaffBookTypes() }, 200, headers);
  }

  if (action === "get-slots") {
    const sessionType = cleanText(body.sessionType, 64);
    const startDate = cleanText(body.startDate, 10);
    const endDate = cleanText(body.endDate, 10);
    const timezone = cleanText(body.timezone, 80) || "America/Los_Angeles";
    const booking = resolveStaffBookType(sessionType);
    if (!booking) return json({ error: "Choose a session type." }, 400, headers);
    if (!validDateRange(startDate, endDate)) return json({ error: "Choose a valid calendar month." }, 400, headers);
    try {
      const slots = await freeSlots(context, booking.calendarId, startDate, endDate, timezone);
      return json({ slots, sessionType, calendarId: booking.calendarId }, 200, headers);
    } catch (err) {
      // Pages may replace 502/503 responses with Cloudflare HTML. Keep this a
      // JSON application error so Staff always receives the contract above.
      return json({ error: err.message || "Could not load available times." }, 500, headers);
    }
  }

  if (action === "book") {
    const contactId = cleanText(body.contactId, 80);
    const sessionType = cleanText(body.sessionType, 64);
    const startTime = cleanText(body.startTime, 80);
    const timezone = cleanText(body.timezone, 80) || "America/Los_Angeles";
    const idempotencyKey = cleanText(body.idempotencyKey, 100);
    const notify = body.notify !== false;
    const booking = resolveStaffBookType(sessionType);

    if (!booking) return json({ error: "Choose a session type." }, 400, headers);
    if (!contactId) return json({ error: "contactId required" }, 400, headers);
    if (!startTime || Number.isNaN(Date.parse(startTime))) {
      return json({ error: "Choose an available time." }, 400, headers);
    }
    if (!idempotencyKey) return json({ error: "idempotencyKey required" }, 400, headers);
    // Owned services must enter through /api/staff-appointments so the CRM
    // command is accepted before the temporary provider edge can mutate. Keep
    // this legacy endpoint available only for services that have not reached
    // that authority boundary yet; never let it become a parallel bypass.
    if (booking.serviceId) {
      return json({
        error: "Use the Staff appointment manager for this appointment type.",
        code: "owned_appointment_route_required",
      }, 409, headers);
    }

    const cacheKey = `staff-book:${contactId}:${idempotencyKey}`;
    const existing = await context.env.PORTAL_KV?.get(cacheKey, "json");
    if (existing) return json(existing, 200, headers);

    try {
      await assertSlotRespectsAppBuffer(context, startTime, booking.calendarId);
    } catch (err) {
      return json({ error: "That time is no longer available. Choose another one." }, 422, headers);
    }

    const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
    if (!contactRes.ok) {
      return json({ error: "Could not load that contact." }, 404, headers);
    }
    const contactData = await contactRes.json();
    const contact = contactData.contact || contactData;

    const already = await findUpcomingOnCalendar(context, contactId, booking.calendarId);
    if (already) {
      return json({
        error: "They already have an upcoming appointment on this calendar.",
        existingAppointment: already,
      }, 409, headers);
    }

    let data;
    try {
      data = await createConfirmedAppointment({
        endpoint: `${GHL_API_BASE}/calendars/events/appointments`,
        request: (url, options) => ghlFetch(context, url, options),
        payload: {
          calendarId: booking.calendarId,
          locationId: GHL_LOCATION_ID,
          contactId,
          startTime,
          endTime: appointmentEndTime(startTime, booking.durationMinutes),
          selectedTimezone: timezone,
          title: booking.title,
          toNotify: notify,
          ignoreDateRange: false,
          firstName: contact.firstName || contact.first_name || "",
          lastName: contact.lastName || contact.last_name || "",
          email: contact.email || "",
          phone: contact.phone || "",
        },
      });
    } catch (err) {
      const detail = String(err?.detail || err?.message || err);
      console.error("[staff-book] create error:", err?.status || 0, detail.slice(0, 300));
      context.waitUntil?.(
        recordOpsError(context.env, "staff-book", "Staff book appointment failed", {
          contactId,
          sessionType,
          status: err?.status || 0,
          error: detail.slice(0, 300),
        }),
      );
      context.waitUntil?.(
        emitPathHop(context.env, {
          pathId: "staff_book",
          hopId: "create_appointment",
          outcome: "fail",
          summary: "Staff book failed",
          source: "staff-book",
          contactId,
          reasonCode: "book_failed",
        }),
      );
      return json({ error: "That time is no longer available. Choose another one." }, 422, headers);
    }
    const result = {
      appointment: {
        id: data.id || data.appointment?.id || "",
        startTime,
        sessionType,
        calendarId: booking.calendarId,
        title: booking.title,
      },
    };
    context.waitUntil?.(
      emitPathHop(context.env, {
        pathId: "staff_book",
        hopId: "create_appointment",
        outcome: "ok",
        summary: `Staff booked ${booking.title}${result.appointment.id ? ` (${result.appointment.id})` : ""}`,
        source: "staff-book",
        contactId,
        trigger: { type: "staff.book", id: sessionType },
      }),
    );
    await context.env.PORTAL_KV?.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
    return json(result, 200, headers);
  }

  return json({ error: "Unknown action" }, 400, headers);
}
