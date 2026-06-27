// Cloudflare Pages Function: POST /api/staff-mark-attended
// Marks an appointment as "showed" and updates session counts in GHL

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";
import { resolveSessionPayment, buildPaymentRecord, writePaymentRecord } from "../lib/session-payment.js";
import { claimDebit, releaseDebit, finalizeDebit, isDebited } from "../lib/attendance-claim.js";
import { NON_JOURNEY_PATTERN, NON_PACKAGE_PATTERN } from "../lib/journey-classification.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

// Custom field IDs (from TECHNICAL-REFERENCE.txt)
const FIELD_IDS = {
  sessions_completed: "TE0udwVH1Km5RsKaN5H0",
  sessions_remaining: "wrQSkx6BhXwDGIn1d0V4",
  session_prepaid: "sgQ5EbJWhvTfGVhStaOO",
};

// Two distinct predicates per the 2026-05-29 session-fields contract
// (see SESSION-FIELDS-AUDIT.md):
//
//   sessions_completed = lifetime journey ("how much real bodywork has the
//     client done with the Amari Method?")
//     Excludes pre-session phone chats only — discovery, consultation,
//     15-min, pain assessment (intake quiz).
//     Includes entrainments AND partner-initials — both are real bodywork,
//     just billed differently (entrainment = $90 separate, partner-init = comp).
//
//   sessions_remaining = prepaid package balance ("when do I need to act?")
//     Excludes everything above PLUS entrainments (billed separately) AND
//     partner-initials (comp perk) — neither draws from a prepaid package.

// Garrett's protocol pairs a follow-up with an immediately-adjacent entrainment.
// When a follow-up is marked showed, the entrainment within ±90 min is auto-flipped.
const ENTRAINMENT_CALENDAR_ID = "B5aGXLoS4kzAjZAMMXxk";
const FOLLOWUP_CALENDAR_IDS = new Set([
  "ZO1jlGfy01rsxVqicoSB", // Follow-up Session — In Person (Package)
  "SKDVOL8wtUN6Ne0ppbC9", // Follow-up Session — In Person
  "oVn77FcecFY16iS2pHyP", // Follow-up Session — Virtual
  "bJFkhVP35Ecwh4tLnSmy", // Follow-up Session — Virtual (Package)
]);
const PAIR_WINDOW_MS = 90 * 60 * 1000;

// Idempotency decision for mark-attended. "Already processed" = the appointment
// is marked AND (it needs no count change, OR the count was already debited).
// The debit flag (per-appointment, in PURCHASE_KV) decouples the count update
// from the appointment status — so a partial failure that left the appt "showed"
// but the count un-applied still gets corrected on a retry instead of being
// permanently stuck. (session-tracking-audit-2026-06-06, risk #2.)
export function isAlreadyProcessed(apptStatus, needsFields, alreadyDebited) {
  const marked = apptStatus === "showed" || apptStatus === "completed";
  if (!marked) return false;          // not marked yet → process
  if (!needsFields) return true;      // marked + nothing to debit → done
  return !!alreadyDebited;            // marked + needs count → done only if debited
}

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

    // Auth check
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }

    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }

    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    // Parse request
    const body = await context.request.json();
    const appointmentId = (body.appointmentId || "").trim();
    const contactId = (body.contactId || "").trim();

    if (!appointmentId) {
      return new Response(JSON.stringify({ error: "Appointment ID required" }), { status: 400, headers });
    }
    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact ID required" }), { status: 400, headers });
    }

    // Fetch contact, appointment details, and field definitions in parallel
    const [contactRes, apptListRes, fieldDefsRes] = await Promise.all([
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
      ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`),
    ]);

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error(`[staff-mark-attended] Contact fetch error: ${contactRes.status} ${errText}`);
      // 404 when the underlying GHL fetch returned 404 (contact doesn't
      // exist or was deleted) — matches the convention in
      // ghl-purchase-webhook.js + ghl-invoice-webhook.js. 422 for other
      // upstream failures (rate limit, server error, etc.).
      const status = contactRes.status === 404 ? 404 : 422;
      return new Response(JSON.stringify({ error: "Failed to load contact" }), { status, headers });
    }

    const contactData = await contactRes.json();
    const contact = contactData.contact;

    // Check current appointment status — if already showed/completed, skip (idempotent)
    let currentApptStatus = null;
    let allAppts = [];
    let thisAppt = null;
    if (apptListRes.ok) {
      const apptListData = await apptListRes.json();
      allAppts = apptListData.appointments || apptListData.events || [];
      thisAppt = allAppts.find((a) => a.id === appointmentId);
      if (thisAppt) {
        currentApptStatus = (thisAppt.appointmentStatus || thisAppt.status || "").toLowerCase();
      }
    }

    // Build field defs map
    let fieldDefs = {};
    if (fieldDefsRes.ok) {
      const fieldDefsData = await fieldDefsRes.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    // Get current session counts
    const currentCompleted = parseInt(getCustomField(contact, "sessions_completed", fieldDefs) ?? "0", 10);
    const currentRemaining = parseInt(getCustomField(contact, "sessions_remaining", fieldDefs) ?? "0", 10);

    // Which fields this appointment touches (session-fields contract). Computed
    // up front because idempotency now depends on whether the COUNT was applied,
    // not just whether the appointment is marked.
    const appointmentTitle = body.appointmentTitle || "";
    const calendarName = body.calendarName || "";
    const titleAndCal = `${appointmentTitle} ${calendarName}`;
    const countsTowardLifetime = !NON_JOURNEY_PATTERN.test(titleAndCal);
    const drawsFromPackage = !NON_PACKAGE_PATTERN.test(titleAndCal);
    const isSession = drawsFromPackage; // back-compat API field
    const needsFields = countsTowardLifetime || drawsFromPackage;

    // Per-appointment debit gate. Set once the count is applied, so a re-trigger
    // (dashboard + SMS) or a retry after a partial failure can't double-apply — and a
    // "showed but never debited" appt re-applies instead of being permanently stuck.
    //
    // Prefer D1 (ATTEND_DB): strongly consistent + an atomic claim at the decrement
    // below, so two concurrent calls can't both decrement. Falls back to the legacy
    // KV flag when the D1 binding isn't set yet (rollout-safe — deploying is a no-op
    // until the binding is added). NOTE: the KV path remains best-effort (eventually
    // consistent), so the race is only fully closed once ATTEND_DB is bound.
    const debitDb = context.env.ATTEND_DB || null;
    const debitKey = `attended-debited:${appointmentId}`;
    let alreadyDebited = false;
    if (needsFields) {
      try {
        if (debitDb) {
          alreadyDebited = await isDebited(debitDb, appointmentId);
        } else if (context.env.PURCHASE_KV) {
          alreadyDebited = !!(await context.env.PURCHASE_KV.get(debitKey));
        }
      } catch (e) {
        console.error(`[staff-mark-attended] debit-flag read failed: ${e.message}`);
      }
    }

    // IDEMPOTENCY: already fully processed → return without changing anything.
    if (isAlreadyProcessed(currentApptStatus, needsFields, alreadyDebited)) {
      return new Response(JSON.stringify({
        success: true,
        alreadyAttended: true,
        appointmentUpdated: false,
        sessionCountUpdated: false,
        isSession,
        sessionsCompleted: currentCompleted,
        sessionsRemaining: currentRemaining,
      }), { status: 200, headers });
    }

    // Mark the appointment "showed" — skip if it already is (this can be a retry
    // after a prior run marked it but failed to apply the count).
    const alreadyShowed = currentApptStatus === "showed" || currentApptStatus === "completed";
    if (!alreadyShowed) {
      const apptRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/events/appointments/${appointmentId}`, {
        method: "PUT",
        body: JSON.stringify({ appointmentStatus: "showed" }),
      });

      if (!apptRes.ok) {
        const errText = await apptRes.text();
        console.error(`[staff-mark-attended] Appointment update error: ${apptRes.status} ${errText}`);
        return new Response(JSON.stringify({ error: "Failed to update appointment" }), { status: 422, headers });
      }
    }

    // Pair-mark: when a follow-up is marked showed, auto-flip a paired entrainment
    // appointment within ±90 min. The pair-mark flips the appointment status only —
    // it does NOT trigger a separate sessions_completed/sessions_remaining update
    // for the entrainment (no second POST). The entrainment will count toward
    // lifetime sessions_completed if/when its own "mark attended" runs (or via
    // the series-reconcile-worker continuous sync).
    // sessions_remaining is never decremented for entrainments — they're billed
    // separately at $90 and don't draw from the prepaid package per the
    // NON_PACKAGE_PATTERNS predicate.
    let pairedEntrainmentId = null;
    if (thisAppt && thisAppt.calendarId && FOLLOWUP_CALENDAR_IDS.has(thisAppt.calendarId)) {
      const thisStartRaw = thisAppt.startTime || thisAppt.start_time;
      const thisStartMs = thisStartRaw ? new Date(thisStartRaw).getTime() : NaN;
      if (Number.isFinite(thisStartMs)) {
        const paired = allAppts.find((a) => {
          if (a.id === appointmentId) return false;
          if (a.calendarId !== ENTRAINMENT_CALENDAR_ID) return false;
          const status = (a.appointmentStatus || a.status || "").toLowerCase();
          if (status !== "confirmed") return false;
          const aStartRaw = a.startTime || a.start_time;
          const aStartMs = aStartRaw ? new Date(aStartRaw).getTime() : NaN;
          return Number.isFinite(aStartMs) && Math.abs(aStartMs - thisStartMs) <= PAIR_WINDOW_MS;
        });
        if (paired) {
          try {
            const pairRes = await ghlFetch(context, `${GHL_API_BASE}/calendars/events/appointments/${paired.id}`, {
              method: "PUT",
              body: JSON.stringify({ appointmentStatus: "showed" }),
            });
            if (pairRes.ok) {
              pairedEntrainmentId = paired.id;
            } else {
              const errText = await pairRes.text();
              console.error(`[staff-mark-attended] Paired entrainment update failed: ${pairRes.status} ${errText}`);
            }
          } catch (err) {
            console.error("[staff-mark-attended] Paired entrainment update error:", err);
          }
        }
      }
    }

    // Predicates (countsTowardLifetime / drawsFromPackage / isSession) + the
    // debit flag were computed up front — see the idempotency block above.

    let newCompleted = currentCompleted;
    let newRemaining = currentRemaining;

    if (countsTowardLifetime || drawsFromPackage) {
      // ── Atomic claim (concurrency gate) ──
      // Before applying the count, atomically claim this appointment. With D1 two
      // concurrent requests race here: exactly one wins the claim and decrements; the
      // loser returns without touching the count — so a dashboard tap + SMS re-trigger
      // (or a double-tap) can't double-decrement a client's prepaid balance.
      if (debitDb) {
        let claimed = true;
        try {
          claimed = await claimDebit(debitDb, appointmentId, contactId);
        } catch (e) {
          // A D1 error is an outage, not a concurrency signal → degrade to the pre-fix
          // behavior (apply the count) rather than silently drop a real attendance.
          console.error(`[staff-mark-attended] debit claim failed, applying anyway: ${e.message}`);
          claimed = true;
        }
        if (!claimed) {
          // Another concurrent request already won the claim and is applying the count.
          return new Response(JSON.stringify({
            success: true,
            alreadyAttended: true,
            appointmentUpdated: !alreadyShowed,
            sessionCountUpdated: false,
            isSession,
            sessionsCompleted: currentCompleted,
            sessionsRemaining: currentRemaining,
          }), { status: 200, headers });
        }
      }

      if (countsTowardLifetime) newCompleted = currentCompleted + 1;
      if (drawsFromPackage) newRemaining = currentRemaining > 0 ? currentRemaining - 1 : 0;

      // Build custom field updates — write whichever fields changed.
      const customFields = [];
      if (countsTowardLifetime) {
        customFields.push({ id: FIELD_IDS.sessions_completed, field_value: String(newCompleted) });
      }
      if (drawsFromPackage) {
        customFields.push({ id: FIELD_IDS.sessions_remaining, field_value: String(newRemaining) });
      }

      // Clear the single-session prepaid flag if this was a non-series session
      if (newRemaining === 0) {
        customFields.push({ id: FIELD_IDS.session_prepaid, field_value: "no" });
      }

      const updateRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        body: JSON.stringify({ customFields }),
      });

      if (!updateRes.ok) {
        // Release the claim so a retry can re-apply — otherwise the appointment is
        // marked "showed" but the count never applied, and the claim would block the
        // retry forever (permanently-stuck class this gate is meant to avoid).
        if (debitDb) {
          try { await releaseDebit(debitDb, appointmentId); }
          catch (e) { console.error(`[staff-mark-attended] debit release failed: ${e.message}`); }
        }
        const errText = await updateRes.text();
        console.error(`[staff-mark-attended] Contact update error: ${updateRes.status} ${errText}`);
        return new Response(JSON.stringify({
          error: "Appointment marked as showed but session count update failed",
          appointmentUpdated: true,
          sessionCountUpdated: false,
          sessionsCompleted: currentCompleted,
          sessionsRemaining: currentRemaining,
        }), { status: 422, headers });
      }

      // Count applied — record the debit so retries / re-triggers don't double-apply.
      // D1: stamp the result onto the claim row we already hold. KV fallback: write
      // the legacy flag.
      if (debitDb) {
        try { await finalizeDebit(debitDb, appointmentId, newCompleted, newRemaining); }
        catch (e) { console.error(`[staff-mark-attended] debit finalize failed: ${e.message}`); }
      } else if (context.env.PURCHASE_KV) {
        try {
          await context.env.PURCHASE_KV.put(
            debitKey,
            JSON.stringify({ at: new Date().toISOString(), completed: newCompleted, remaining: newRemaining }),
            { expirationTtl: 90 * 86400 },
          );
        } catch (e) {
          console.error(`[staff-mark-attended] debit-flag write failed: ${e.message}`);
        }
      }
    }

    // ── Per-session payment capture (NON-BLOCKING) ──
    // Record whether THIS specific session was paid / comped / on-package,
    // keyed by appointmentId in PURCHASE_KV. This must NEVER affect the
    // attendance result — any failure is logged and swallowed. The decision is
    // a pure function (functions/lib/session-payment.js); here we just persist.
    //   - body.paymentStatus / paymentMethod / compNote = Garrett's answer to
    //     "how was this paid?" (UI prompts only for non-package sessions).
    //   - no answer + package covers it → auto "on-package".
    //   - no answer + not covered → nothing recorded (feeds the owed pool).
    let paymentRecorded = false;
    try {
      const capture = resolveSessionPayment({
        contactId,
        appointmentId,
        explicitStatus: (body.paymentStatus || "").trim() || null,
        method: (body.paymentMethod || "").trim() || null,
        note: (body.compNote || "").trim() || null,
        drawsFromPackage,
        currentRemaining,
        // staff-auth issues a token shaped { role, user, exp } — it has no
        // email/sub, so the old read always fell through to "staff" and payment
        // records lost the Garrett-vs-Eben attribution. Use the actual field.
        recordedBy: tokenPayload.user || tokenPayload.email || tokenPayload.sub || "staff",
        at: new Date().toISOString(),
      });
      if (capture && context.env.PURCHASE_KV) {
        const record = buildPaymentRecord(capture);
        await writePaymentRecord(context.env.PURCHASE_KV, record);
        paymentRecorded = true;
        // Backup GHL note for comps / anything carrying a human note, so the
        // reason (e.g. "rare 2nd comp") lands in the contact timeline and
        // survives KV. Routine "on-package"/stripe records skip the note to
        // keep the timeline clean.
        if (record.status === "comped" || record.note) {
          const noteBody = `Payment: ${record.status}${record.method ? ` (${record.method})` : ""}${record.note ? ` — ${record.note}` : ""} [appt ${appointmentId}]`;
          try {
            await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/notes`, {
              method: "POST",
              body: JSON.stringify({ body: noteBody }),
            });
          } catch (noteErr) {
            console.error("[staff-mark-attended] payment note write failed (non-blocking):", noteErr);
          }
        }
      }
    } catch (payErr) {
      console.error("[staff-mark-attended] payment capture failed (non-blocking):", payErr);
    }

    return new Response(JSON.stringify({
      success: true,
      alreadyAttended: false,
      appointmentUpdated: true,
      sessionCountUpdated: isSession,
      isSession,
      sessionsCompleted: newCompleted,
      sessionsRemaining: newRemaining,
      pairedEntrainmentId,
      paymentRecorded,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-mark-attended] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
