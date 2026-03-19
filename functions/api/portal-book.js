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

const allowedOrigin = 'https://www.amarimethod.com';

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

  const { calendarId, startTime, timezone, sessionType } = body;

  if (!calendarId || !startTime || !timezone || !sessionType) {
    return json({ error: 'calendarId, startTime, timezone, and sessionType are required' }, 400, origin);
  }

  // Fetch contact details from GHL to get name/phone
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

  // Create the appointment title
  const title = sessionType === 'virtual'
    ? 'Follow-up Session (Virtual)'
    : 'Follow-up Session (In Person)';

  // GHL requires the timezone offset to be present in startTime/endTime
  // (e.g. "2026-03-15T10:00:00-07:00"). Stripping the offset causes GHL to
  // reject the slot as "not available" for some calendar types.
  // Extract the offset so we can re-apply it to the computed endTime.
  const offsetMatch = startTime.match(/([+-]\d{2}:\d{2})$/);
  const tzOffset = offsetMatch ? offsetMatch[1] : '';

  // Compute endTime by adding 50 min to the local time parts, then re-append offset.
  const localStartTime = startTime.replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');
  const [dateStr, timeStr] = localStartTime.split('T');
  const [hh, mm, ss = '00'] = timeStr.split(':');
  const totalMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10) + 50;
  const endHH = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const endMM = String(totalMinutes % 60).padStart(2, '0');
  const endTime = `${dateStr}T${endHH}:${endMM}:${ss}${tzOffset}`; // e.g. "2026-03-15T10:50:00-07:00"

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

    return json({
      success: true,
      appointment: {
        id: apptData.id,
        title,
        startTime,
        sessionType,
      },
    }, 200, origin);
  } catch (err) {
    console.error('portal-book error:', err);
    return json({ error: 'Internal server error' }, 500, origin);
  }
}
