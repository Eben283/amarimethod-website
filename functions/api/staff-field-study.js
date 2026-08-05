// Cloudflare Pages Function: GET/POST /api/staff-field-study
//
// The table flow intentionally has its own record and GHL tag.  A person who
// has already had their first session at the table must not enter the flyer
// journey (which asks them to book that first session).  Contact details and
// the calendar-facing study name live in GHL; the baseline answers and body
// map stay in PORTAL_KV.

import { corsHeaders, parseJsonBody, requireStaffAuth } from '../lib/endpoint-guards.js';
import { ghlFetch } from '../lib/ghl.js';
import { STUDIES, STUDY_CALENDAR_ID } from '../lib/studies.js';
import { appointmentEndTime } from '../lib/datetime.js';
import { assertSlotRespectsAppBuffer, fetchAppBufferEvents, filterSlotsByAppBuffer } from '../lib/app-owned-buffer.js';
import { createConfirmedAppointment } from '../lib/ghl-appointment-handoff.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = '7pIO7FHVAyBT1jKGhfQM';
const STUDY_NAME_FIELD_ID = '1xhxStKyEN47shwjOKC0';
// GHL number field contact.study_sessions_done. This is the first completed
// table session; later study sessions advance the same field.
const STUDY_SESSIONS_DONE_FIELD_ID = 'Q9DqX2C4ml2TGW679UlM';
// Intentionally one tag for every table participant. Study Name carries the
// study itself; this tag only distinguishes the table path from flyer signups.
export const FIELD_STUDY_TABLE_TAG = 'field-study-table-participant';
const INDEX_KEY = 'field_study:index:v1';
const MAX_INDEX = 200;
const MAX_TEXT = 500;

// Mirrors the five choices on /field-signup.  Their public labels are short
// and plain; the existing registry names stay in GHL so shared reminders can
// keep using {{contact.study_name}}.
export const FIELD_STUDIES = {
  jaw: { slug: 'tmj', label: 'Jaw', studyName: STUDIES.tmj.shortName },
  foot: { slug: 'runners-lower-leg', label: 'Foot', studyName: STUDIES['runners-lower-leg'].shortName },
  elbow: { slug: 'tennis-elbow', label: 'Elbow', studyName: STUDIES['tennis-elbow'].shortName },
  hand: { slug: 'hand', label: 'Hand', studyName: STUDIES.hand.shortName },
  'upper-back': { slug: 'desk-shoulders', label: 'Upper Back', studyName: STUDIES['desk-shoulders'].shortName },
};

function recordKey(id) {
  return `field_study:${id}`;
}

function cleanText(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function paperLabel(firstName, studyLabel, paperDate) {
  const displayDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${paperDate}T12:00:00Z`));
  return `${firstName} · ${studyLabel} · ${displayDate}`;
}

function score(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded >= 0 && rounded <= 10 ? rounded : null;
}

function validDateRange(startDate, endDate) {
  if (!isValidPaperDate(startDate) || !isValidPaperDate(endDate)) return false;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 32 * 86400000;
}

export function flattenSlots(data) {
  const slots = [];
  for (const date of Object.keys(data || {}).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const values = Array.isArray(data[date]?.slots) ? data[date].slots : [];
    for (const datetime of [...new Set(values)].sort()) {
      const time = String(datetime).split('T')[1] || '';
      const hour = Number.parseInt(time.split(':')[0], 10);
      const minute = Number.parseInt(time.split(':')[1], 10);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
      slots.push({ date, hour, minute, datetime });
    }
  }
  return slots;
}

async function studySlots(context, startDate, endDate, timezone) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`) + 12 * 60 * 60 * 1000;
  // GHL rejects some 31-day windows. Split a long month into two safe lookups.
  const windows = [];
  for (let cursor = start; cursor < end; cursor += 30 * 86400000) windows.push([cursor, Math.min(cursor + 30 * 86400000, end)]);
  const responses = await Promise.all(windows.map(([windowStart, windowEnd]) => ghlFetch(
    context,
    `${GHL_API_BASE}/calendars/${STUDY_CALENDAR_ID}/free-slots?startDate=${windowStart}&endDate=${windowEnd}&timezone=${encodeURIComponent(timezone)}`,
  )));
  const merged = {};
  let succeeded = false;
  for (const response of responses) {
    if (!response.ok) {
      console.error('[staff-field-study] slot lookup error:', response.status, (await response.text()).slice(0, 200));
      continue;
    }
    succeeded = true;
    const data = await response.json();
    for (const [date, value] of Object.entries(data)) {
      if (!merged[date]) merged[date] = { slots: [] };
      for (const slot of (Array.isArray(value?.slots) ? value.slots : [])) if (!merged[date].slots.includes(slot)) merged[date].slots.push(slot);
    }
  }
  if (!succeeded) throw new Error('Could not load available study times.');
  const slots = flattenSlots(merged);
  const events = await fetchAppBufferEvents(context, start, end);
  return filterSlotsByAppBuffer(slots, STUDY_CALENDAR_ID, events);
}

export function isValidPhone(phone) {
  return String(phone).replace(/[^\d+]/g, '').length >= 10;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export function isValidPaperDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export function isFirstSessionCompleted(value) {
  return value === true;
}

function normalizeBaseline(raw, nowIso) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const locations = Array.isArray(value.bodyLocations) ? value.bodyLocations : [];
  const baseline = {
    discomfortNow: score(value.discomfortNow),
    worstPastSevenDays: score(value.worstPastSevenDays),
    easierActivity: cleanText(value.easierActivity),
    activityDifficulty: score(value.activityDifficulty),
    dayLimit: score(value.dayLimit),
    activityAvoidance: score(value.activityAvoidance),
    bodyLocations: locations.slice(0, 3).map((location) => cleanText(location, 120)),
    capturedAt: typeof value.capturedAt === 'string' && !Number.isNaN(Date.parse(value.capturedAt))
      ? new Date(value.capturedAt).toISOString()
      : nowIso,
  };
  return baseline;
}

export function isCompleteBaseline(baseline) {
  return baseline.discomfortNow !== null
    && baseline.worstPastSevenDays !== null
    && Boolean(baseline.easierActivity)
    && baseline.activityDifficulty !== null
    && baseline.dayLimit !== null
    && baseline.activityAvoidance !== null
    && baseline.bodyLocations.some(Boolean);
}

function indexIds(raw) {
  return Array.isArray(raw?.ids) ? raw.ids.filter((id) => typeof id === 'string').slice(0, MAX_INDEX) : [];
}

async function addToIndex(kv, id) {
  const current = await kv.get(INDEX_KEY, 'json');
  const ids = indexIds(current).filter((existing) => existing !== id);
  ids.unshift(id);
  await kv.put(INDEX_KEY, JSON.stringify({ ids: ids.slice(0, MAX_INDEX) }));
}

async function findSameDayDuplicate(kv, { phone, email, fieldStudyKey, paperDate }) {
  const index = await kv.get(INDEX_KEY, 'json');
  const records = await Promise.all(indexIds(index).map((id) => kv.get(recordKey(id), 'json')));
  return records.find((record) => record
    && record.fieldStudyKey === fieldStudyKey
    && record.paperDate === paperDate
    && (record.phone === phone || record.email === email)) || null;
}

export function studyAppointments(rawAppointments) {
  const cancelled = new Set(['cancelled', 'canceled']);
  return (Array.isArray(rawAppointments) ? rawAppointments : [])
    .filter((appointment) => appointment?.calendarId === STUDY_CALENDAR_ID)
    .map((appointment) => ({
      id: String(appointment.id || ''),
      startTime: appointment.startTime || appointment.start_time || '',
      status: String(appointment.appointmentStatus || appointment.status || 'confirmed').toLowerCase(),
    }))
    .filter((appointment) => appointment.id && appointment.startTime && !Number.isNaN(Date.parse(appointment.startTime)) && !cancelled.has(appointment.status))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

async function withStudyAppointments(context, record) {
  if (!record?.contactId) return { ...record, bookedSessions: [], bookingStatus: 'unavailable' };
  try {
    const response = await ghlFetch(context, `${GHL_API_BASE}/contacts/${record.contactId}/appointments`);
    if (!response.ok) {
      console.error('[staff-field-study] appointment lookup error:', response.status);
      return { ...record, bookedSessions: [], bookingStatus: 'unavailable' };
    }
    const data = await response.json();
    return { ...record, bookedSessions: studyAppointments(data.appointments || data.events), bookingStatus: 'loaded' };
  } catch (err) {
    console.error('[staff-field-study] appointment lookup error:', err.message);
    return { ...record, bookedSessions: [], bookingStatus: 'unavailable' };
  }
}

async function enrichBookings(context, records) {
  const result = new Array(records.length);
  let next = 0;
  // Saved records can grow to 200. Keep the live-calendar refresh considerate
  // of GHL's rate limit instead of firing every contact lookup at once.
  await Promise.all(Array.from({ length: Math.min(8, records.length) }, async () => {
    while (next < records.length) {
      const index = next++;
      result[index] = await withStudyAppointments(context, records[index]);
    }
  }));
  return result;
}

function summarize(record) {
  return {
    id: record.id,
    paperId: record.paperId,
    fieldStudyKey: record.fieldStudyKey,
    studyLabel: record.studyLabel,
    studyName: record.studyName,
    firstName: record.firstName,
    createdAt: record.createdAt,
    // Records saved before this choice existed had completed session one.
    firstSessionCompleted: record.firstSessionCompleted !== false,
    afterSessionOnePain: record.afterSessionOnePain,
    baselineCapturedAt: record.baseline?.capturedAt || null,
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('Origin') || '', 'GET, POST, OPTIONS'),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const headers = { ...corsHeaders(request.headers.get('Origin') || '', 'GET, POST, OPTIONS'), 'Content-Type': 'application/json' };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  try {
    const url = new URL(request.url);
    const recordId = url.searchParams.get('recordId');
    const includeBookings = url.searchParams.get('includeBookings') === '1';
    if (recordId) {
      const record = await env.PORTAL_KV.get(recordKey(recordId), 'json');
      return json({ record: record ? await withStudyAppointments(context, record) : null }, 200, headers);
    }
    const index = await env.PORTAL_KV.get(INDEX_KEY, 'json');
    const ids = indexIds(index);
    let records = (await Promise.all(ids.map((id) => env.PORTAL_KV.get(recordKey(id), 'json'))))
      .filter(Boolean)
      .map(summarize);
    // The paper-entry queue stays immediate. The Saved tab opts into live
    // GHL calendar data, so its dates are the actual selected appointments.
    if (includeBookings) records = await enrichBookings(context, records);
    return json({ records }, 200, headers);
  } catch (err) {
    console.error('[staff-field-study] GET error:', err.message);
    return json({ error: 'Internal server error' }, 500, headers);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { ...corsHeaders(request.headers.get('Origin') || '', 'GET, POST, OPTIONS'), 'Content-Type': 'application/json' };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;
  const { body, error: parseError } = await parseJsonBody(request, headers);
  if (parseError) return parseError;

  try {
    if (body.action === 'get-slots') {
      const recordId = cleanText(body.recordId, 80);
      const startDate = cleanText(body.startDate, 10);
      const endDate = cleanText(body.endDate, 10);
      const timezone = cleanText(body.timezone, 80) || 'America/Los_Angeles';
      if (!recordId || !validDateRange(startDate, endDate)) return json({ error: 'Choose a valid calendar month.' }, 400, headers);
      const record = await env.PORTAL_KV.get(recordKey(recordId), 'json');
      if (!record) return json({ error: 'Study record not found.' }, 404, headers);
      return json({ slots: await studySlots(context, startDate, endDate, timezone) }, 200, headers);
    }

    if (body.action === 'book-followup') {
      const recordId = cleanText(body.recordId, 80);
      const startTime = cleanText(body.startTime, 80);
      const timezone = cleanText(body.timezone, 80) || 'America/Los_Angeles';
      const idempotencyKey = cleanText(body.idempotencyKey, 100);
      if (!recordId || !startTime || Number.isNaN(Date.parse(startTime))) return json({ error: 'Choose an available study time.' }, 400, headers);
      const record = await env.PORTAL_KV.get(recordKey(recordId), 'json');
      if (!record) return json({ error: 'Study record not found.' }, 404, headers);

      const cacheKey = idempotencyKey ? `field-study-book:${recordId}:${idempotencyKey}` : null;
      if (cacheKey) {
        const existing = await env.PORTAL_KV.get(cacheKey, 'json');
        if (existing) return json(existing, 200, headers);
      }

      try {
        await assertSlotRespectsAppBuffer(context, startTime, STUDY_CALENDAR_ID);
      } catch {
        return json({ error: 'That time is no longer available. Choose another one.' }, 422, headers);
      }

      let data;
      try {
        data = await createConfirmedAppointment({
          endpoint: `${GHL_API_BASE}/calendars/events/appointments`,
          request: (url, options) => ghlFetch(context, url, options),
          payload: {
            calendarId: STUDY_CALENDAR_ID,
            locationId: GHL_LOCATION_ID,
            contactId: record.contactId,
            startTime,
            endTime: appointmentEndTime(startTime, 15),
            selectedTimezone: timezone,
            title: 'Amari Study 15-Minute Session',
            firstName: record.firstName,
            lastName: record.lastName,
            email: record.email,
            phone: record.phone,
          },
        });
      } catch (err) {
        const detail = String(err?.detail || err?.message || err);
        console.error('[staff-field-study] study booking error:', err?.status || 0, detail.slice(0, 300));
        return json({ error: 'That time is no longer available. Choose another one.' }, 422, headers);
      }
      const result = { appointment: { id: data.id || data.appointment?.id || '', startTime } };
      if (cacheKey) await env.PORTAL_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
      return json(result, 200, headers);
    }

    if (body.action === 'save-baseline') {
      const recordId = cleanText(body.recordId, 80);
      if (!recordId) return json({ error: 'recordId required' }, 400, headers);
      const existing = await env.PORTAL_KV.get(recordKey(recordId), 'json');
      if (!existing) return json({ error: 'Study record not found' }, 404, headers);
      const nowIso = new Date().toISOString();
      const baseline = normalizeBaseline(body.baseline, nowIso);
      if (!isCompleteBaseline(baseline)) return json({ error: 'Enter all 6 answers and at least 1 marked body location before saving.' }, 400, headers);
      const record = { ...existing, baseline, updatedAt: nowIso };
      await env.PORTAL_KV.put(recordKey(recordId), JSON.stringify(record));
      return json({ record }, 200, headers);
    }

    if (body.action !== 'enroll') return json({ error: 'Unknown action' }, 400, headers);

    const fieldStudyKey = cleanText(body.fieldStudyKey, 32);
    const study = FIELD_STUDIES[fieldStudyKey];
    const firstName = cleanText(body.firstName, 100);
    const lastName = cleanText(body.lastName, 100);
    const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    const email = cleanText(body.email, 254).toLowerCase();
    if (typeof body.firstSessionCompleted !== 'boolean') return json({ error: 'Confirm whether they completed their first session.' }, 400, headers);
    const firstSessionCompleted = isFirstSessionCompleted(body.firstSessionCompleted);
    const afterSessionOnePain = score(body.afterSessionOnePain);
    const participantQuote = cleanText(body.participantQuote, 500);
    const paperDate = cleanText(body.paperDate, 10);
    if (!study) return json({ error: 'Choose one of the active field studies.' }, 400, headers);
    if (!firstName || !lastName || !isValidPhone(phone) || !isValidEmail(email)) {
      return json({ error: 'First name, last name, a valid mobile, and a valid email are required.' }, 400, headers);
    }
    if (firstSessionCompleted && afterSessionOnePain === null) return json({ error: 'Record the after-session score before saving.' }, 400, headers);
    if (!isValidPaperDate(paperDate)) return json({ error: 'Could not determine today’s date. Refresh and try again.' }, 400, headers);
    const duplicate = await findSameDayDuplicate(env.PORTAL_KV, { phone, email, fieldStudyKey, paperDate });
    if (duplicate) return json({ error: `${duplicate.paperId} is already saved for this study today. Open that record instead of saving a duplicate.` }, 409, headers);

    const upsert = await ghlFetch(context, `${GHL_API_BASE}/contacts/upsert`, {
      method: 'POST',
      body: JSON.stringify({
        firstName,
        lastName,
        phone,
        email,
        locationId: GHL_LOCATION_ID,
        // Deliberately NOT any flyer study tag: those start the QR flow and
        // would incorrectly ask a table participant to book session one.
        tags: [FIELD_STUDY_TABLE_TAG],
        source: 'Golden Gate Park field table',
        customFields: [
          { id: STUDY_NAME_FIELD_ID, value: study.studyName },
          { id: STUDY_SESSIONS_DONE_FIELD_ID, value: firstSessionCompleted ? 1 : 0 },
        ],
      }),
    });
    if (!upsert.ok) {
      console.error('[staff-field-study] GHL upsert error:', upsert.status, await upsert.text());
      return json({ error: 'Could not save the participant contact.' }, 422, headers);
    }
    const upsertData = await upsert.json();
    const contactId = upsertData.contact?.id;
    if (!contactId) return json({ error: 'Contact was saved but no ID was returned.' }, 422, headers);

    const nowIso = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      // The sheet is matched by first name, study, and date. The UUID above is
      // still the unique record key, so duplicate names cannot collide.
      paperId: paperLabel(firstName, study.label, paperDate),
      paperDate,
      contactId,
      fieldStudyKey,
      studySlug: study.slug,
      studyLabel: study.label,
      studyName: study.studyName,
      source: 'field-table',
      firstSessionCompleted,
      firstName,
      lastName,
      phone,
      email,
      canUseFirstName: body.canUseFirstName === true,
      afterSessionOnePain: firstSessionCompleted ? afterSessionOnePain : null,
      participantQuote,
      baseline: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await env.PORTAL_KV.put(recordKey(record.id), JSON.stringify(record));
    await addToIndex(env.PORTAL_KV, record.id);
    return json({ record }, 200, headers);
  } catch (err) {
    console.error('[staff-field-study] POST error:', err.message);
    return json({ error: 'Internal server error' }, 500, headers);
  }
}
