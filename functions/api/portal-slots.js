/**
 * GET /api/portal-slots?calendarId=xxx&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=America/New_York
 * Returns available time slots from GHL for a given calendar and date range.
 * Requires valid portal session token.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  // Verify session token
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

  try {
    const { verifyJwt } = await import('./_jwt.js');
    await verifyJwt(token, env.JWT_SECRET, 'session');
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const calendarId = url.searchParams.get('calendarId');
  const startDate = url.searchParams.get('startDate'); // YYYY-MM-DD
  const endDate = url.searchParams.get('endDate');     // YYYY-MM-DD
  const timezone = url.searchParams.get('timezone') || 'America/New_York';

  if (!calendarId || !startDate || !endDate) {
    return json({ error: 'calendarId, startDate, and endDate are required' }, 400);
  }

  // Convert YYYY-MM-DD to epoch ms for GHL
  const startTimestamp = new Date(`${startDate}T00:00:00`).getTime();
  const endTimestamp = new Date(`${endDate}T23:59:59`).getTime();

  try {
    const ghlRes = await fetch(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${startTimestamp}&endDate=${endTimestamp}&timezone=${encodeURIComponent(timezone)}`,
      {
        headers: {
          Authorization: `Bearer ${env.GHL_API_KEY}`,
          Version: '2021-07-28',
        },
      }
    );

    if (!ghlRes.ok) {
      const err = await ghlRes.text();
      console.error('GHL slots error:', ghlRes.status, err);
      return json({ error: 'Failed to fetch slots' }, 422);
    }

    const data = await ghlRes.json();

    // GHL returns { _dates_: { "YYYY-MM-DD": { slots: ["HH:MM", ...] } } }
    // Normalize to a flat array of { date, time, datetime } objects
    const slots = [];
    const dates = data._dates_ || {};
    for (const [date, val] of Object.entries(dates)) {
      const timeSlots = val.slots || [];
      for (const time of timeSlots) {
        // time is like "09:00" or "09:00:00"
        const [hour, minute] = time.split(':');
        slots.push({
          date,          // "YYYY-MM-DD"
          time,          // "HH:MM"
          hour: parseInt(hour),
          minute: parseInt(minute || '0'),
          // ISO datetime for creating the appointment
          datetime: `${date}T${time.length === 5 ? time + ':00' : time}`,
        });
      }
    }

    return json({ slots });
  } catch (err) {
    console.error('portal-slots error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}
