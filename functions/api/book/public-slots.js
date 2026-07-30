/**
 * GET /api/book/public-slots?calendarId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=America/Los_Angeles
 *
 * Public (unauthenticated) calendar slot lookup for the native booking flow.
 * Same shape as portal-slots.js but with no JWT requirement and a strict
 * calendar allowlist so this endpoint can't be used to enumerate other GHL
 * calendars in the location.
 */

import { ghlFetch } from "../../lib/ghl.js";
import { applyLookBusy } from "../../lib/look-busy.js";
import { applyHourPackPreference } from "../../lib/booking-slot-policy.js";

const ALLOWED_ORIGIN = "https://www.amarimethod.com";

// Only the public booking calendars. Anything else returns 403 — this prevents
// the endpoint from exposing internal calendars (Entrainment, partner-side, etc.)
// even though they share the same GHL location.
const ALLOWED_CALENDARS = new Set([
  "G7OAnnJuFbMF6nQSlZVQ", // Initial Session — In Person ($225, 60 min)
  "ySmht5hx4uZGEpgZrlCw", // Initial Session — Virtual ($225, 60 min)
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person ($190, 50 min)
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual ($190, 50 min)
  "USgPsktqRcuomdUgpShL", // Discovery Call (free, 15 min)
  "EM6vB2mq7EAdGCbUb3j1", // Amari Assessment — In Person ($29, 40 min)
]);

function corsHeaders(requestOrigin) {
  const allow = requestOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status, requestOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(requestOrigin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || ""),
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const origin = request.headers.get("Origin") || "";
  const url = new URL(request.url);

  const calendarId = url.searchParams.get("calendarId") || "";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const timezone =
    url.searchParams.get("timezone") || "America/Los_Angeles";

  if (!calendarId || !startDate || !endDate) {
    return json(
      { error: "calendarId, startDate, and endDate are required" },
      400,
      origin,
    );
  }

  if (!ALLOWED_CALENDARS.has(calendarId)) {
    return json({ error: "calendarId not allowed" }, 403, origin);
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    return json({ error: "dates must be YYYY-MM-DD" }, 400, origin);
  }

  // GHL's /free-slots endpoint silently rejects ranges longer than ~31 days
  // with a 422. To support the two-month calendar view (60 days), we chunk
  // the request into ≤30-day slices and merge the results.
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`) + 12 * 60 * 60 * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return json({ error: "invalid date range" }, 400, origin);
  }
  if (endMs <= startMs) {
    return json({ error: "endDate must be after startDate" }, 400, origin);
  }
  // Cap the total range at 90 days to prevent abuse.
  const MAX_TOTAL_DAYS = 90;
  if (endMs - startMs > MAX_TOTAL_DAYS * 86400 * 1000) {
    return json(
      { error: `date range too wide (max ${MAX_TOTAL_DAYS} days)` },
      400,
      origin,
    );
  }

  // Build chunk boundaries — each chunk ≤ 30 days
  const CHUNK_DAYS = 30;
  const CHUNK_MS = CHUNK_DAYS * 86400 * 1000;
  const chunks = [];
  for (let cursor = startMs; cursor < endMs; cursor += CHUNK_MS) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, endMs);
    chunks.push({ start: cursor, end: chunkEnd });
  }

  // Fetch all chunks in parallel
  const responses = await Promise.allSettled(
    chunks.map((c) => {
      const ghlUrl =
        `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots` +
        `?startDate=${c.start}&endDate=${c.end}&timezone=${encodeURIComponent(timezone)}`;
      return ghlFetch(context, ghlUrl, { method: "GET" });
    }),
  );

  // Merge slot results from all chunks into a single date-keyed object.
  // If any chunk fails, we still return what we got from the others —
  // user sees partial calendar instead of a hard error.
  const merged = {};
  let hadAnySuccess = false;
  for (let i = 0; i < responses.length; i++) {
    const settled = responses[i];
    if (settled.status !== "fulfilled") {
      console.error(
        `[book/public-slots] chunk ${i} threw:`,
        settled.reason && settled.reason.message,
      );
      continue;
    }
    const ghlRes = settled.value;
    if (!ghlRes.ok) {
      const body = await ghlRes.text();
      console.error(
        `[book/public-slots] chunk ${i} GHL ${ghlRes.status}: ${body.slice(0, 200)}`,
      );
      continue;
    }
    hadAnySuccess = true;
    const data = await ghlRes.json();
    for (const [key, val] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const dailySlots = val && Array.isArray(val.slots) ? val.slots : [];
      if (!merged[key]) merged[key] = [];
      // GHL may return the same slot twice if our chunks overlap by even a
      // millisecond on a boundary day — dedupe by ISO datetime string.
      for (const iso of dailySlots) {
        if (!merged[key].includes(iso)) merged[key].push(iso);
      }
    }
  }

  if (!hadAnySuccess) {
    return json({ error: "Upstream calendar lookup failed" }, 422, origin);
  }

  // Flatten merged { "YYYY-MM-DD": ["...ISO..."] } into the slot array shape
  // the frontend expects. Mirrors portal-slots.js.
  const slots = [];
  const sortedDates = Object.keys(merged).sort();
  for (const date of sortedDates) {
    const isoSlots = (merged[date] || []).slice().sort();
    for (const iso of isoSlots) {
      // GHL slot format: "2026-05-14T10:30:00-07:00"
      // Split by ":" to grab hour/minute. The third segment ("00-07")
      // contains the offset and is discarded.
      const timePart = iso.split("T")[1] || "";
      const hour = parseInt(timePart.split(":")[0], 10) || 0;
      const minute = parseInt(timePart.split(":")[1], 10) || 0;
      slots.push({
        date,
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        hour,
        minute,
        datetime: iso,
      });
    }
  }

  // Prefer on-hour main sessions / intro slots that leave the next Follow-up
  // hour free, then thin with look-busy. Both only filter GHL-approved times.
  const packed = applyHourPackPreference(slots, { calendarId });
  return json(
    { slots: applyLookBusy(packed, { calendarId }) },
    200,
    origin,
  );
}
