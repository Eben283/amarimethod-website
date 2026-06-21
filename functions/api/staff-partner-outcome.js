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
//   - note            → writes a GHL note only. No stage/signal/touch change —
//                       a standalone note isn't outreach.
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
  partner_touch_count:    "qKtPT2XZP61emgUDK7fd",
};

const VALID_SIGNALS = new Set([
  // Call/SMS outcomes (GHL tracks the call placement but not the outcome).
  "no-answer",
  "voicemail",
  "talked",
  "link-sent",
  // App-sent touches: Garrett composed + sent a text/email from the card. Behave
  // like talked/link-sent — record signal + last_signal_at + touch_count, and
  // promote a no-outreach contact to working (a send is real outreach).
  "texted",
  "emailed",
  "booked",
  "deferred",
  "not-interested",
  // Off-platform touches (GHL doesn't see these at all — we log them as notes).
  "linkedin-msg",
  "linkedin-req",
  "instagram-msg",
  "in-person",
  // Disposition without contact: "we never reached out and we're not going to
  // — wrong geography / wrong category / etc." Different from not-interested
  // (which implies they declined). Sets partner_stage=dropped but does NOT
  // set partner_last_signal, partner_last_signal_at, or increment touch_count
  // — because no outreach actually happened.
  "skip",
  // Note-only: the user typed a note but did NOT record an outcome. Writes a
  // GHL note ("Note: …") and nothing else — no stage change, no signal, no
  // touch_count, no last_signal_at (a note isn't outreach, so it must not
  // pollute the "touched this week" meter). Requires non-empty note text.
  "note",
]);

// Map signal → stage transition (null means "don't change current stage").
// Off-platform touches never auto-change stage — they're just touch records.
const SIGNAL_TO_STAGE = {
  "no-answer":      null,
  "voicemail":      null,
  "talked":         null,
  "link-sent":      null,
  "texted":         null,
  "emailed":        null,
  "booked":         "session-booked",
  "deferred":       "future-potential",
  "not-interested": "dropped",
  "linkedin-msg":   null,
  "linkedin-req":   null,
  "instagram-msg":  null,
  "in-person":      null,
  "skip":           "dropped",
  "note":           null,
};

// Signals that represent off-platform touches (notes prefix differently
// so future queries can filter "all LinkedIn touches" vs "all call outcomes").
const TOUCH_SIGNALS = new Set([
  "linkedin-msg",
  "linkedin-req",
  "instagram-msg",
  "in-person",
]);

// Human-readable signal labels for the note body (so the GHL timeline reads
// "Touch: LinkedIn message" instead of "Touch: linkedin-msg").
const SIGNAL_NOTE_LABEL = {
  "no-answer":      "No answer",
  "voicemail":      "Voicemail",
  "talked":         "Talked",
  "link-sent":      "Sent link",
  "texted":         "Texted",
  "emailed":        "Emailed",
  "booked":         "Booked",
  "deferred":       "Future potential",
  "not-interested": "Not interested",
  "linkedin-msg":   "LinkedIn message",
  "linkedin-req":   "LinkedIn connection request",
  "instagram-msg":  "Instagram message",
  "in-person":      "In-person",
  "skip":           "Skipped — not a fit",
  "note":           "Note",
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
    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers });
    }
    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
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
    if (signal === "note" && (!note || !String(note).trim())) {
      return new Response(JSON.stringify({ error: "note text required when signal === 'note'" }), { status: 400, headers });
    }

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });
    }

    // Read current touch_count + current partner_stage from the same GET. The
    // touch_count is incremented; the stage is used to decide whether the
    // current outcome should promote a no-outreach contact to working (the
    // promote-on-first-contact behavior described in the header comment).
    let currentTouchCount = 0;
    let currentStage = null;
    try {
      const getRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        headers: ghlHeaders(ghlToken),
      });
      if (getRes.ok) {
        const cdata = await getRes.json();
        const contact = cdata.contact || cdata;
        const fields = Array.isArray(contact.customFields) ? contact.customFields : [];
        const tf = fields.find((f) => f.id === FIELD_IDS.partner_touch_count);
        const raw = tf?.value ?? tf?.field_value;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) currentTouchCount = Math.floor(n);
        const sf = fields.find((f) => f.id === FIELD_IDS.partner_stage);
        const rawStage = sf?.value ?? sf?.field_value;
        if (typeof rawStage === "string" && rawStage.length > 0) currentStage = rawStage;
      }
    } catch (err) {
      // Don't fail the outcome record over a contact read error — log and
      // proceed with defaults (touch under-count by 1, stage stays as-is on
      // server side; both fixable by re-backfill).
      console.error("[staff-partner-outcome] contact read failed:", err instanceof Error ? err.message : String(err));
    }

    // Build customFields update array
    const nowIso = new Date().toISOString();
    let newStage = SIGNAL_TO_STAGE[signal];
    // Promote-on-first-contact: any non-skip outcome on a contact currently at
    // no-outreach (or with no stage set) should move them into "working" so
    // they appear in the In Progress tab. Closing outcomes (booked / deferred /
    // not-interested) already have their own stage in SIGNAL_TO_STAGE and win;
    // skip is a deliberate "don't pursue" disposition and stays as dropped.
    if (!newStage && signal !== "skip" && signal !== "note" && (!currentStage || currentStage === "no-outreach")) {
      newStage = "working";
    }
    const customFields = [];
    // "skip" and "note" are dispositions without outreach — no signal, no touch,
    // no meter pollution. "skip" still gets a stage transition (dropped); "note"
    // changes nothing at all (just records a GHL note below). All other signals
    // record signal / signal_at / touch_count as usual.
    if (signal !== "skip" && signal !== "note") {
      customFields.push({ id: FIELD_IDS.partner_last_signal, value: signal });
      customFields.push({ id: FIELD_IDS.partner_last_signal_at, value: nowIso });
      customFields.push({ id: FIELD_IDS.partner_touch_count, value: currentTouchCount + 1 });
    }
    if (newStage) {
      customFields.push({ id: FIELD_IDS.partner_stage, value: newStage });
    }
    if (signal === "deferred" && followupAt) {
      // Normalize date-only ISO strings (e.g. "2026-07-01") to the
      // Pacific local end-of-day so "followups due today" queries don't
      // mis-bucket the entry. Pre-this-fix: a date-only ISO was stored
      // as midnight UTC = 5pm previous day in PDT, off-by-one for any
      // PT-anchored watchdog.
      const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(followupAt);
      const normalizedFollowupAt = dateOnlyMatch
        ? `${followupAt}T16:00:00-08:00` // 4pm Pacific (PST/PDT-tolerant)
        : followupAt;
      customFields.push({ id: FIELD_IDS.partner_followup_at, value: normalizedFollowupAt });
    }

    // PUT /contacts/{id} updates custom fields. A note-only save touches no
    // fields (customFields is empty), so skip the PUT entirely and go straight
    // to writing the note below.
    if (customFields.length > 0) {
      const updateRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
        body: JSON.stringify({ customFields }),
      });
      if (!updateRes.ok) {
        const text = await updateRes.text().catch(() => "");
        throw new Error(`GHL PUT /contacts/${contactId} ${updateRes.status}: ${text.slice(0, 250)}`);
      }
    }

    // Add a GHL note documenting the outcome (always, with optional user text).
    // Prefix differs by kind so we can filter the timeline:
    //   "Note: …"    = standalone note, no outreach recorded
    //   "Touch: …"   = off-platform action (LinkedIn, Instagram, in-person)
    //   "Skip: …"    = decision not to pursue (no outreach happened)
    //   "Outcome: …" = result of a call/SMS attempt or stage change
    // A note-only save is just the user's text under a "Note:" prefix — there's
    // no signal label to prepend.
    const notePrefix =
      signal === "note" ? "Note" :
      signal === "skip" ? "Skip" :
      TOUCH_SIGNALS.has(signal) ? "Touch" :
      "Outcome";
    const noteLabel = SIGNAL_NOTE_LABEL[signal] || signal;
    const noteBody = signal === "note"
      ? `Note: ${String(note).trim()}`
      : `${notePrefix}: ${noteLabel}${note && note.trim() ? ` — ${note.trim()}` : ""}`;
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

    // Purge stale outreach-coach draft — a closed contact must not carry a stale
    // "here's what to pitch" card that could leak through any display path. Fire-and-
    // forget: KV delete failure must never block the outcome record from returning.
    if ((newStage === "dropped" || newStage === "future-potential") && context.env.PORTAL_KV) {
      context.env.PORTAL_KV.delete(`coach:${contactId}`).catch((err) => {
        console.error("[staff-partner-outcome] KV coach delete failed:", err instanceof Error ? err.message : String(err));
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        signal,
        newStage: newStage || null,
        // 'skip' and 'note' don't record signal/touch — return null so the
        // client knows not to update its local state for these fields.
        signalAt: (signal === "skip" || signal === "note") ? null : nowIso,
        followupAt: signal === "deferred" ? followupAt : null,
        touchCount: (signal === "skip" || signal === "note") ? currentTouchCount : currentTouchCount + 1,
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
