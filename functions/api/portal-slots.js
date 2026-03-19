/**
 * GET /api/portal-slots?calendarId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=America/New_York
 * Returns available time slots from GHL for a given calendar and date range.
 * Requires valid portal session token.
 */

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const allowedOrigin = 'https://www.amarimethod.com';

function cors(requestOrigin) {
  const origin = requestOrigin === allowedOrigin ? allowedOrigin : '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, requestOrigin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(requestOrigin), 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: cors(origin) });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const GHL_API_KEY = await getGhlToken(context);

  // Verify session token
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401, origin);

  try {
    await verifySessionToken(token, env.JWT_SECRET);
  } catch {
    return json({ error: 'Unauthorized' }, 401, origin);
  }

  const url = new URL(request.url);
  const calendarId = url.searchParams.get('calendarId');
  const startDate = url.searchParams.get('startDate'); // YYYY-MM-DD
  const endDate = url.searchParams.get('endDate');     // YYYY-MM-DD
  const timezone = url.searchParams.get('timezone') || 'America/New_York';

  if (!calendarId || !startDate || !endDate) {
    return json({ error: 'calendarId, startDate, and endDate are required' }, 400, origin);
  }

  // Convert YYYY-MM-DD to epoch ms for GHL
  const startTimestamp = new Date(`${startDate}T00:00:00`).getTime();
  const endTimestamp = new Date(`${endDate}T23:59:59`).getTime();

  try {
    const ghlRes = await fetch(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startTimestamp}&endDate=${endTimestamp}&timezone=${encodeURIComponent(timezone)}`,
      {
        headers: ghlHeaders(GHL_API_KEY),
      }
    );

    if (!ghlRes.ok) {
      const err = await ghlRes.text();
      console.error('GHL slots error:', ghlRes.status, err);
      return json({ error: 'Failed to fetch slots' }, 422, origin);
    }

    const data = await ghlRes.json();

    // GHL returns { "YYYY-MM-DD": { slots: ["YYYY-MM-DDTHH:MM:SS-TZ", ...] }, traceId: "..." }
    // Normalize to a flat array of { date, time, hour, minute, datetime } objects
    const slots = [];
    for (const [key, val] of Object.entries(data)) {
      // Skip non-date keys like traceId
      if (!key.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
      const date = key; // "YYYY-MM-DD"
      const timeSlots = val.slots || [];
      for (const isoSlot of timeSlots) {
        // isoSlot is like "2026-02-24T11:30:00-07:00"
        // NOTE: Do NOT use new Date().getHours() — Cloudflare Workers run in UTC,
        // so getHours() returns UTC hours, not the slot's local time. Parse the
        // time components directly from the ISO string instead.
        const timePart = isoSlot.split('T')[1] || '';
        const hour = parseInt(timePart.split(':')[0], 10) || 0;
        const minute = parseInt(timePart.split(':')[1], 10) || 0;
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');
        slots.push({
          date,                    // "YYYY-MM-DD"
          time: `${hh}:${mm}`,    // "HH:MM" in the timezone GHL returned it in
          hour,
          minute,
          datetime: isoSlot,       // full ISO string for booking
        });
      }
    }

    return json({ slots }, 200, origin);
  } catch (err) {
    console.error('portal-slots error:', err);
    return json({ error: 'Internal server error' }, 500, origin);
  }
}
