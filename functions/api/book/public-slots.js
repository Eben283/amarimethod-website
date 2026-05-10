/**
 * GET /api/book/public-slots?calendarId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=America/Los_Angeles
 *
 * Public (unauthenticated) calendar slot lookup for the native booking flow.
 * Same shape as portal-slots.js but with no JWT requirement and a strict
 * calendar allowlist so this endpoint can't be used to enumerate other GHL
 * calendars in the location.
 */

import { ghlFetch } from "../../lib/ghl.js";

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

  // Cap the lookahead at 60 days to prevent abusive wide-range requests.
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`) + 12 * 60 * 60 * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return json({ error: "invalid date range" }, 400, origin);
  }
  if (endMs - startMs > 65 * 86400 * 1000) {
    return json({ error: "date range too wide (max 60 days)" }, 400, origin);
  }

  const ghlUrl =
    `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots` +
    `?startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(timezone)}`;

  let ghlRes;
  try {
    ghlRes = await ghlFetch(context, ghlUrl, { method: "GET" });
  } catch (err) {
    console.error("[book/public-slots] ghlFetch threw:", err);
    return json({ error: "Upstream calendar lookup failed" }, 422, origin);
  }

  if (!ghlRes.ok) {
    const body = await ghlRes.text();
    console.error(
      `[book/public-slots] GHL ${ghlRes.status} ${calendarId}: ${body}`,
    );
    return json({ error: "Upstream calendar lookup failed" }, 422, origin);
  }

  const data = await ghlRes.json();

  // Flatten { "YYYY-MM-DD": { slots: ["...ISO..."] }, traceId: "..." }
  // into [{ date, time, hour, minute, datetime }]. Mirrors portal-slots.js.
  const slots = [];
  for (const [key, val] of Object.entries(data)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const dailySlots = (val && Array.isArray(val.slots)) ? val.slots : [];
    for (const iso of dailySlots) {
      // GHL slot format: "2026-05-14T10:30:00-07:00"
      // We split by ":" to grab hour/minute. The third segment ("00-07")
      // contains the offset and is discarded, so we don't need to strip
      // the offset suffix manually — and trying to do so with a regex
      // character class like [+-Z] is a bug (the dash is interpreted as
      // a range operator, matching every char from + to Z including ":"
      // and digits, which collapses timePart to "" → every slot 12am).
      const timePart = iso.split("T")[1] || "";
      const hour = parseInt(timePart.split(":")[0], 10) || 0;
      const minute = parseInt(timePart.split(":")[1], 10) || 0;
      slots.push({
        date: key,
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        hour,
        minute,
        datetime: iso,
      });
    }
  }

  return json({ slots }, 200, origin);
}
