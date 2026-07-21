// Cloudflare Pages Function: GET/POST /api/staff-field-study
//
// The table flow intentionally has its own record and GHL tag.  A person who
// has already had their first session at the table must not enter the flyer
// journey (which asks them to book that first session).  Contact details and
// the calendar-facing study name live in GHL; the baseline answers and body
// map stay in PORTAL_KV.

import { corsHeaders, parseJsonBody, requireStaffAuth } from '../lib/endpoint-guards.js';
import { ghlFetch } from '../lib/ghl.js';
import { STUDIES } from '../lib/studies.js';

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

export function isValidPhone(phone) {
  return String(phone).replace(/[^\d+]/g, '').length >= 10;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export function isValidPaperDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
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

function summarize(record) {
  return {
    id: record.id,
    paperId: record.paperId,
    fieldStudyKey: record.fieldStudyKey,
    studyLabel: record.studyLabel,
    studyName: record.studyName,
    firstName: record.firstName,
    createdAt: record.createdAt,
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
    if (recordId) {
      const record = await env.PORTAL_KV.get(recordKey(recordId), 'json');
      return json({ record: record || null }, 200, headers);
    }
    const index = await env.PORTAL_KV.get(INDEX_KEY, 'json');
    const ids = indexIds(index);
    const records = (await Promise.all(ids.map((id) => env.PORTAL_KV.get(recordKey(id), 'json'))))
      .filter(Boolean)
      .map(summarize);
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
    const afterSessionOnePain = score(body.afterSessionOnePain);
    const paperDate = cleanText(body.paperDate, 10);
    if (!study) return json({ error: 'Choose one of the active field studies.' }, 400, headers);
    if (!firstName || !lastName || !isValidPhone(phone) || !isValidEmail(email)) {
      return json({ error: 'First name, last name, a valid mobile, and a valid email are required.' }, 400, headers);
    }
    if (afterSessionOnePain === null) return json({ error: 'Record the after-session score before saving.' }, 400, headers);
    if (!isValidPaperDate(paperDate)) return json({ error: 'Choose the date on the paper form.' }, 400, headers);
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
          { id: STUDY_SESSIONS_DONE_FIELD_ID, value: 1 },
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
      firstName,
      lastName,
      phone,
      email,
      canUseFirstName: body.canUseFirstName === true,
      afterSessionOnePain,
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
