// Cloudflare Pages Function: POST /api/staff-partner-outcome
//
// Records a manual outcome for a partner contact. Updates GHL custom fields
// and optionally adds a GHL note. Some outcomes also transition partner_stage:
//   - booked          → partner_stage = session-booked
//   - deferred        → partner_stage = future-potential (requires followupAt)
//   - not-interested  → partner_stage = dropped
//   - others (no-answer / voicemail / talked / link-sent)
//                     → partner_stage stays as-is (still working) or promotes from
//                       no-outreach → working on first contact
//
// Request body:
//   {
//     contactId: string,
//     signal: 'no-answer' | 'voicemail' | 'talked' | 'link-sent' |
//             'booked' | 'deferred' | 'not-interested',
//     note?: string,
//     followupAt?: string  // ISO date — required if signal === 'deferred'
//   }
//
// Auth: JWT bearer.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

const FIELD_IDS = {
  partner_stage:          "KfPow1mYDxJqiOCS6mDZ",
  partner_last_signal:    "XyUoMtbxadTuZunQwX3Y",
  partner_last_signal_at: "J0lnfsvtt0vcFOdSbUSf",
  partner_followup_at:    "stVYzQB4Xpi29cuyUYnA",
};

const VALID_SIGNALS = new Set([
  "no-answer",
  "voicemail",
  "talked",
  "link-sent",
  "booked",
  "deferred",
  "not-interested",
]);

// Map signal → stage transition (null means "don't change current stage").
const SIGNAL_TO_STAGE = {
  "no-answer":      null,
  "voicemail":      null,
  "talked":         null,
  "link-sent":      null,
  "booked":         "session-booked",
  "deferred":       "future-potential",
  "not-interested": "dropped",
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
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
    // Auth
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }
    try {
      await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }

    // Parse + validate
    const payload = await context.request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
    }
    const { contactId, signal, note, followupAt } = payload;
    if (!contactId || typeof contactId !== "string") {
      return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    }
    if (!VALID_SIGNALS.has(signal)) {
      return new Response(
        JSON.stringify({ error: `Invalid signal: ${signal}. Must be one of: ${Array.from(VALID_SIGNALS).join(", ")}` }),
        { status: 400, headers },
      );
    }
    if (signal === "deferred" && !followupAt) {
      return new Response(JSON.stringify({ error: "followupAt required when signal === 'deferred'" }), { status: 400, headers });
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
    }

    // Build customFields update array
    const nowIso = new Date().toISOString();
    const customFields = [
      { id: FIELD_IDS.partner_last_signal, value: signal },
      { id: FIELD_IDS.partner_last_signal_at, value: nowIso },
    ];
    const newStage = SIGNAL_TO_STAGE[signal];
    if (newStage) {
      customFields.push({ id: FIELD_IDS.partner_stage, value: newStage });
    }
    if (signal === "deferred" && followupAt) {
      customFields.push({ id: FIELD_IDS.partner_followup_at, value: followupAt });
    }

    // PUT /contacts/{id} updates custom fields
    const updateRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({ customFields }),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => "");
      throw new Error(`GHL PUT /contacts/${contactId} ${updateRes.status}: ${text.slice(0, 250)}`);
    }

    // Add a GHL note documenting the outcome (always, with optional user text)
    const noteBody = `Outcome: ${signal}${note && note.trim() ? ` — ${note.trim()}` : ""}`;
    const noteRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteBody }),
    });
    if (!noteRes.ok) {
      // Note failure isn't fatal — log it but don't fail the request
      const text = await noteRes.text().catch(() => "");
      console.error(`[staff-partner-outcome] note write failed: ${noteRes.status} ${text.slice(0, 200)}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        signal,
        newStage: newStage || null,
        signalAt: nowIso,
        followupAt: signal === "deferred" ? followupAt : null,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-partner-outcome] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to record outcome: ${detail}` }),
      { status: 500, headers },
    );
  }
}
