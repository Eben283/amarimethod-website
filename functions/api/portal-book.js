/**
 * POST /api/portal-book
 * Creates an appointment in GHL for the authenticated client.
 *
 * Body: {
 *   calendarId: string,
 *   startTime: string,   // ISO datetime e.g. "2026-02-20T10:00:00"
 *   timezone: string,    // e.g. "America/New_York"
 *   sessionType: 'in-person' | 'virtual'
 * }
 */

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "../lib/portal-helpers.js";
import { appointmentEndTime } from "../lib/datetime.js";

const allowedOrigin = 'https://www.amarimethod.com';

// B2 (2026-06-11 review): the ONLY calendars a portal client may book through
// this endpoint are the two package follow-up calendars. The server derives the
// calendar from sessionType and never trusts a client-supplied calendarId — so
// the $225 Initial Session calendar, partner, and entrainment calendars are
// unreachable here. (IDs mirror portal/src/components/BookingModal.tsx.)
export const PORTAL_FOLLOWUP_CALENDARS = {
  'in-person': 'ZO1jlGfy01rsxVqicoSB',
  'virtual':   'bJFkhVP35Ecwh4tLnSmy',
};

export function resolvePortalCalendar(sessionType) {
  return PORTAL_FOLLOWUP_CALENDARS[sessionType] || null;
}

const SESSIONS_REMAINING_FIELD_ID = 'wrQSkx6BhXwDGIn1d0V4';

// Block a follow-up booking when the package balance is clearly exhausted
// (sessions_remaining <= 0). Fails OPEN when the field is missing/unparseable —
// the calendar allowlist is the primary guard, and we don't want to block a
// legitimate client over a field we can't read.
export function portalBalanceExhausted(contact) {
  const raw = getCustomField(contact, 'sessions_remaining', {
    sessions_remaining: SESSIONS_REMAINING_FIELD_ID,
  });
  if (raw === null || raw === undefined || String(raw).trim() === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  return n <= 0;
}

function cors(requestOrigin) {
  const origin = requestOrigin === allowedOrigin ? allowedOrigin : '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const GHL_API_KEY = await getGhlToken(context);

  // Verify session token and extract contactId
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401, origin);

  let contactId, email;
  try {
    const payload = await verifySessionToken(token, env.JWT_SECRET);
    contactId = payload.contactId;
    email = payload.email;
  } catch {
    return json({ error: 'Unauthorized' }, 401, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin);
  }

  const { startTime, timezone, sessionType, idempotencyKey } = body;

  if (!startTime || !timezone || !sessionType) {
    return json({ error: 'startTime, timezone, and sessionType are required' }, 400, origin);
  }

  // Idempotency: if the client supplied a key and we've already processed it,
  // return the cached result instead of double-booking. KV TTL = 1 hour (long
  // enough to cover any retry storm; GHL booking slots don't move mid-session).
  const kvKey = idempotencyKey ? `portal-book:${contactId}:${idempotencyKey}` : null;
  if (kvKey && context.env.PORTAL_KV) {
    const cached = await context.env.PORTAL_KV.get(kvKey, 'json').catch(() => null);
    if (cached) return json(cached, 200, origin);
  }

  // B2: derive the calendar server-side from sessionType — never trust a
  // client-supplied calendarId. Anything but the two portal follow-up types
  // is rejected.
  const calendarId = resolvePortalCalendar(sessionType);
  if (!calendarId) {
    return json({ error: 'Invalid sessionType' }, 400, origin);
  }

  // Fetch contact details from GHL to get name/phone (and the session balance).
  let contact;
  try {
    const contactRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        headers: ghlHeaders(GHL_API_KEY),
      }
    );
    if (!contactRes.ok) throw new Error(`GHL contact fetch failed: ${contactRes.status}`);
    const contactData = await contactRes.json();
    contact = contactData.contact;
  } catch (err) {
    console.error('Failed to fetch contact:', err);
    return json({ error: 'Failed to retrieve contact information' }, 422, origin);
  }

  // B2: don't let a client with an exhausted package book a free follow-up.
  if (portalBalanceExhausted(contact)) {
    return json(
      { error: 'No sessions remaining in your package. Please purchase a new series to book another session.' },
      403,
      origin,
    );
  }

  // Create the appointment title
  const title = sessionType === 'virtual'
    ? 'Follow-up Session (Virtual)'
    : 'Follow-up Session (In Person)';

  // GHL requires the timezone offset to be present in startTime/endTime
  // (e.g. "2026-03-15T10:00:00-07:00"); stripping it makes GHL reject the slot
  // as "not available". appointmentEndTime preserves both the instant
  // (start + 50 min, handling midnight crossings) and the offset.
  const endTime = appointmentEndTime(startTime, 50);

  // Build the appointment payload
  const appointmentPayload = {
    calendarId,
    locationId: env.GHL_LOCATION_ID || '7pIO7FHVAyBT1jKGhfQM',
    contactId,
    startTime,   // pass through as-is, with offset intact
    endTime,
    selectedTimezone: timezone,
    title,
    appointmentStatus: 'confirmed',
    // Pre-fill contact details
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    email: contact?.email || email,
    phone: contact?.phone || '',
  };

  try {
    const bookRes = await fetch(
      'https://services.leadconnectorhq.com/calendars/events/appointments',
      {
        method: 'POST',
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify(appointmentPayload),
      }
    );

    if (!bookRes.ok) {
      const errText = await bookRes.text();
      console.error('GHL booking error:', bookRes.status, errText);
      // Surface the actual GHL error so the modal can display it for debugging
      return json({ error: `Booking failed (${bookRes.status}): ${errText}` }, 422, origin);
    }

    const apptData = await bookRes.json();

    const result = {
      success: true,
      appointment: {
        id: apptData.id,
        title,
        startTime,
        sessionType,
      },
    };

    // Cache the successful result so duplicate confirms return the same
    // appointment instead of creating a second one.
    if (kvKey && context.env.PORTAL_KV) {
      await context.env.PORTAL_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 3600 }).catch(() => {});
    }

    return json(result, 200, origin);
  } catch (err) {
    console.error('portal-book error:', err);
    return json({ error: 'Internal server error' }, 500, origin);
  }
}
