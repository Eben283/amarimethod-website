// Public Amari study booking endpoint. The customer sees amarimethod.com;
// GHL remains the appointment and reminder system behind it.
import { ghlFetch } from '../lib/ghl.js';
import { STUDY_CALENDAR_ID } from '../lib/studies.js';
import { appointmentEndTime } from '../lib/datetime.js';
import { assertSlotRespectsAppBuffer, fetchAppBufferEvents, filterSlotsByAppBuffer } from '../lib/app-owned-buffer.js';
import { createConfirmedAppointment } from '../lib/ghl-appointment-handoff.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const ORIGINS = new Set(['https://www.amarimethod.com', 'https://amarimethod.com']);

function headers(origin) { return { 'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://www.amarimethod.com', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; }
function json(data, status, origin) { return new Response(JSON.stringify(data), { status, headers: headers(origin) }); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()); }
function validPhone(value) { return String(value).replace(/[^\d+]/g, '').length >= 10; }
function splitName(name) { const parts = String(name).trim().replace(/\s+/g, ' ').split(' '); return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }; }

function flattenSlots(data) {
  const slots = [];
  for (const date of Object.keys(data || {}).sort()) {
    for (const datetime of (Array.isArray(data[date]?.slots) ? data[date].slots : []).slice().sort()) {
      const parts = (String(datetime).split('T')[1] || '').split(':');
      const hour = Number.parseInt(parts[0], 10); const minute = Number.parseInt(parts[1], 10);
      if (Number.isInteger(hour) && Number.isInteger(minute)) slots.push({ date, hour, minute, datetime });
    }
  }
  return slots;
}

async function slots(context, startDate, endDate, timezone) {
  const start = Date.parse(`${startDate}T00:00:00Z`); const end = Date.parse(`${endDate}T23:59:59Z`) + 12 * 60 * 60 * 1000;
  const response = await ghlFetch(context, `${GHL_API_BASE}/calendars/${STUDY_CALENDAR_ID}/free-slots?startDate=${start}&endDate=${end}&timezone=${encodeURIComponent(timezone)}`);
  if (!response.ok) throw new Error('Could not load available times.');
  const rawSlots = flattenSlots(await response.json());
  const events = await fetchAppBufferEvents(context, start, end);
  return filterSlotsByAppBuffer(rawSlots, STUDY_CALENDAR_ID, events);
}

async function rateLimit(context, key) {
  if (!context.env.PORTAL_KV) return false;
  const current = Number(await context.env.PORTAL_KV.get(key)) || 0;
  if (current >= 12) return true;
  await context.env.PORTAL_KV.put(key, String(current + 1), { expirationTtl: 3600 });
  return false;
}

export async function onRequestOptions({ request }) { return new Response(null, { status: 204, headers: headers(request.headers.get('Origin') || '') }); }

export async function onRequestGet(context) {
  const origin = context.request.headers.get('Origin') || ''; const url = new URL(context.request.url);
  const startDate = url.searchParams.get('startDate') || ''; const endDate = url.searchParams.get('endDate') || ''; const timezone = url.searchParams.get('timezone') || 'America/Los_Angeles';
  if (!validDate(startDate) || !validDate(endDate) || Date.parse(`${endDate}T00:00:00Z`) < Date.parse(`${startDate}T00:00:00Z`)) return json({ error: 'Choose a valid calendar month.' }, 400, origin);
  try { return json({ slots: await slots(context, startDate, endDate, timezone) }, 200, origin); }
  catch (error) { console.error('[study-book] slots:', error.message); return json({ error: 'Could not load available times. Please try again.' }, 422, origin); }
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get('Origin') || '';
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await rateLimit(context, `study-book:${ip}`)) return json({ error: 'Please wait a moment and try again.' }, 429, origin);
    const body = await context.request.json(); const { name, phone, email, startTime, timezone = 'America/Los_Angeles' } = body;
    if (!name || !validPhone(phone) || !validEmail(email) || !startTime || Number.isNaN(Date.parse(startTime))) return json({ error: 'Enter your name, mobile number, email, and choose a time.' }, 400, origin);
    const { firstName, lastName } = splitName(name); const cleanPhone = String(phone).replace(/[^\d+]/g, '').slice(0, 20); const cleanEmail = String(email).trim().toLowerCase().slice(0, 254);
    const upsert = await ghlFetch(context, `${GHL_API_BASE}/contacts/upsert`, { method: 'POST', body: JSON.stringify({ firstName, lastName, phone: cleanPhone, email: cleanEmail, locationId: GHL_LOCATION_ID, source: 'Amari study booking page' }) });
    if (!upsert.ok) throw new Error('contact upsert failed');
    const contactId = (await upsert.json()).contact?.id;
    if (!contactId) throw new Error('contact ID missing');
    await assertSlotRespectsAppBuffer(context, startTime, STUDY_CALENDAR_ID);
    await createConfirmedAppointment({
      endpoint: `${GHL_API_BASE}/calendars/events/appointments`,
      request: (url, options) => ghlFetch(context, url, options),
      payload: {
        calendarId: STUDY_CALENDAR_ID,
        locationId: GHL_LOCATION_ID,
        contactId,
        startTime,
        endTime: appointmentEndTime(startTime, 15),
        selectedTimezone: timezone,
        title: 'Amari Study 15-Minute Session',
        firstName,
        lastName,
        email: cleanEmail,
        phone: cleanPhone,
      },
    });
    return json({ success: true, appointment: { startTime } }, 200, origin);
  } catch (error) { console.error('[study-book] booking:', error.message); return json({ error: 'We could not save that booking. Please try again.' }, 422, origin); }
}
