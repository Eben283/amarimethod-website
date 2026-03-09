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

async function verifySessionToken(tokenString, secret) {
  const parts = tokenString.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(atob(body));
  if (!payload.exp || Date.now() > payload.exp) throw new Error('Token expired');
  return payload;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';

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
        headers: {
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: '2021-07-28',
        },
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

  // Strip timezone offset from startTime if present — GHL expects local time in
  // selectedTimezone format, not an ISO string with embedded offset
  // e.g. "2026-03-15T10:00:00-07:00" → "2026-03-15T10:00:00"
  const cleanStartTime = startTime.replace(/[+-]\d{2}:\d{2}$/, '').replace('Z', '');

  // Compute endTime: follow-up sessions are 50 min. Treat cleanStartTime as UTC
  // for arithmetic only — the local time values remain correct.
  const startMs = new Date(cleanStartTime + 'Z').getTime();
  const cleanEndTime = new Date(startMs + 50 * 60 * 1000)
    .toISOString()
    .replace('Z', '')
    .replace(/\.\d{3}$/, ''); // e.g. "2026-03-15T10:50:00"

  // Build the appointment payload
  const appointmentPayload = {
    calendarId,
    locationId: env.GHL_LOCATION_ID || '7pIO7FHVAyBT1jKGhfQM',
    contactId,
    startTime: cleanStartTime,
    endTime: cleanEndTime,
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
        headers: {
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
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
