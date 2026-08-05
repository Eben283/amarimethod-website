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
import { requireOwner } from "../lib/owned-access.js";
import { computeSessionLedger } from "../lib/session-ledger.js";
import { getCustomField } from "../lib/portal-helpers.js";
import { appointmentEndTime } from "../lib/datetime.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { assertSlotRespectsAppBuffer } from "../lib/app-owned-buffer.js";
import { createConfirmedAppointment } from "../lib/ghl-appointment-handoff.js";

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

const SESSIONS_REMAINING_FIELD_ID = GHL_FIELD_IDS.sessions_remaining;

// Block a follow-up booking when the package balance is clearly exhausted
// (sessions_remaining <= 0). Fails OPEN when the field is missing/unparseable —
// the calendar allowlist is the primary guard, and we don't want to block a
// legitimate client over a field we can't read.
// Booking gate on the DERIVED ledger — the same number the dashboard shows
// (ledger.display.remaining). Gating on the raw field alone (the old
// behavior, kept below as portalBalanceExhausted) blocked clients whose
// dashboard said "2 left" whenever the cached field lagged at 0 — and since
// the reschedule flow books first, it blocked rescheduling too. Field-only
// fallback when the ledger has no data at all (transient fetch failure).
export function portalBookingBlocked(ledger, contact) {
  if (!ledger || ledger.source === 'empty') return portalBalanceExhausted(contact);
  // Low-confidence derivation with a NEVER-WRITTEN field means the balance is
  // genuinely underivable (off-platform history, staff-booked package client
  // with no orders). The old gate failed open there by design — keep that,
  // or such a client can't even RESCHEDULE (the modal books first).
  const raw = getCustomField(contact, 'sessions_remaining', {
    sessions_remaining: SESSIONS_REMAINING_FIELD_ID,
  });
  const fieldWritten = !(raw === null || raw === undefined || String(raw).trim() === '');
  if (ledger.confidence !== 'high' && !fieldWritten) return false;
  const remaining = Number(ledger.display?.remaining);
  return Number.isFinite(remaining) ? remaining <= 0 : portalBalanceExhausted(contact);
}

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

  // Ownership gate: Bearer + verify + per-contact revoke, centralized in
  // lib/owned-access.js. contactId comes from the verified JWT, never the
  // request body — booking is one of the two highest-stakes actions. The
  // "Unauthorized" wording for missing/invalid tokens is preserved via override;
  // the error body matches this endpoint's json() helper (cors + JSON error).
  const gateHeaders = { ...cors(origin), 'Content-Type': 'application/json' };
  const gate = await requireOwner(context, gateHeaders, {
    messages: { notAuthenticated: 'Unauthorized', invalidToken: 'Unauthorized' },
  });
  if (gate.error) return gate.error;
  const { tokenPayload, contactId } = gate;
  const email = tokenPayload.email;

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
  // Gate on the derived ledger (what the dashboard displays), not the raw
  // cached field — see portalBookingBlocked.
  const ledger = await computeSessionLedger(context, contactId);
  if (portalBookingBlocked(ledger, contact)) {
    context.waitUntil?.(
      emitPathHop(env, {
        pathId: "portal_package_book",
        hopId: "ledger_gate",
        outcome: "fail",
        summary: "Portal book blocked — no sessions remaining",
        source: "portal-book",
        contactId,
        reasonCode: "no_sessions",
        condition: {
          expected: "sessions remaining > 0",
          observed: String(ledger?.remaining ?? "blocked"),
        },
      }),
    );
    return json(
      { error: 'No sessions remaining in your package. Please purchase a new series to book another session.' },
      403,
      origin,
    );
  }

  context.waitUntil?.(
    emitPathHop(env, {
      pathId: "portal_package_book",
      hopId: "auth",
      outcome: "ok",
      summary: "Portal owner auth + ledger gate passed",
      source: "portal-book",
      contactId,
    }),
  );

  // Create the appointment title
  const title = sessionType === 'virtual'
    ? 'Follow-up Session (Virtual)'
    : 'Follow-up Session (In Person)';

  // GHL requires the timezone offset to be present in startTime/endTime
  // (e.g. "2026-03-15T10:00:00-07:00"); stripping it makes GHL reject the slot
  // as "not available". appointmentEndTime preserves both the instant
  // (start + 50 min, handling midnight crossings) and the offset.
  const endTime = appointmentEndTime(startTime, 50);

  try {
    await assertSlotRespectsAppBuffer(context, startTime, calendarId);
  } catch {
    return json({ error: 'That time is no longer available. Choose another one.' }, 422, origin);
  }

  // Build the appointment payload
  const appointmentPayload = {
    calendarId,
    locationId: env.GHL_LOCATION_ID || '7pIO7FHVAyBT1jKGhfQM',
    contactId,
    startTime,   // pass through as-is, with offset intact
    endTime,
    selectedTimezone: timezone,
    title,
    // Pre-fill contact details
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    email: contact?.email || email,
    phone: contact?.phone || '',
  };

  try {
    const apptData = await createConfirmedAppointment({
      endpoint: 'https://services.leadconnectorhq.com/calendars/events/appointments',
      request: (url, options) => fetch(url, { ...options, headers: ghlHeaders(GHL_API_KEY) }),
      payload: appointmentPayload,
    });

    const result = {
      success: true,
      appointment: {
        id: apptData.id,
        title,
        startTime,
        sessionType,
      },
    };

    context.waitUntil?.(
      emitPathHop(env, {
        pathId: "portal_package_book",
        hopId: "create_appointment",
        outcome: "ok",
        summary: `Portal follow-up booked (${apptData.id || "ok"})`,
        source: "portal-book",
        contactId,
        condition: {
          expected: "GHL appointment created",
          observed: startTime ? String(startTime) : "null",
        },
      }),
    );

    // Cache the successful result so duplicate confirms return the same
    // appointment instead of creating a second one.
    if (kvKey && context.env.PORTAL_KV) {
      await context.env.PORTAL_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 3600 }).catch(() => {});
    }

    return json(result, 200, origin);
  } catch (err) {
    const detail = String(err?.detail || err?.message || err);
    console.error('GHL booking error:', err?.status || 0, detail);
    context.waitUntil?.(
      recordOpsError(env, "portal-book", "Portal package book failed", {
        contactId,
        status: err?.status || 0,
        error: detail.slice(0, 300),
      }),
    );
    context.waitUntil?.(
      emitPathHop(env, {
        pathId: "portal_package_book",
        hopId: "create_appointment",
        outcome: "fail",
        summary: "Portal prepaid follow-up book failed",
        source: "portal-book",
        contactId,
        reasonCode: "book_failed",
        condition: {
          expected: "GHL appointment created and transitioned to confirmed",
          observed: `${err?.status || 0}: ${detail.slice(0, 80)}`,
        },
      }),
    );
    return json({ error: 'That time is no longer available. Choose another one.' }, 422, origin);
  }
}
