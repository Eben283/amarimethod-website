// Cloudflare Pages Function: POST /api/staff-partner-verify
// The verification flywheel (2026-06-19). When Garrett runs a discovery call and finds
// the real decision-maker, this records it: tags the contact `dm-verified` (so the
// play-decision flips it from a discovery card → a pitch) and optionally updates the
// record to the real person (name / direct line). Writes an audit note.
//
// Body: { contactId: string, dmFirstName?: string, dmLastName?: string, dmPhone?: string }
// Auth: JWT bearer (staff).

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];
const VERIFIED_TAG = "dm-verified";
// GHL search index has a lag updating tags, so we also write the outreach_verified
// custom field — it's read from the contact record directly and has no lag.
const OUTREACH_VERIFIED_FIELD_ID = "PVftrxrmNRPmfdlQAwzl";

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
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    let payload;
    try { payload = await verifySessionToken(authHeader.slice(7), JWT_SECRET); }
    catch { return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), { status: 401, headers }); }
    if (payload.role !== "staff") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });

    const body = await context.request.json().catch(() => null);
    if (!body || !body.contactId) return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
    const contactId = String(body.contactId);
    const dmFirstName = (body.dmFirstName || "").trim();
    const dmLastName = (body.dmLastName || "").trim();
    const dmPhone = (body.dmPhone || "").trim();
    if (dmPhone && dmPhone.replace(/\D/g, "").length < 10) return new Response(JSON.stringify({ error: "Phone must be 10+ digits" }), { status: 400, headers });

    const ghlToken = await getGhlToken(context);
    if (!ghlToken) return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers });

    // Read the current name (for the audit note — what the record was before).
    let wasName = "";
    try {
      const r = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, { headers: ghlHeaders(ghlToken) });
      if (r.ok) { const d = await r.json(); const c = d.contact || d; wasName = c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" "); }
    } catch { /* non-fatal */ }

    // 1) Tag dm-verified (the flag the play-decision trusts → flips discovery to pitch).
    const tagRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
      method: "POST", headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify({ tags: [VERIFIED_TAG] }),
    });
    if (!tagRes.ok) { const t = await tagRes.text(); console.error("[verify] tag failed", tagRes.status, t); return new Response(JSON.stringify({ error: "Failed to tag contact" }), { status: 422, headers }); }

    // 2) Repoint the record to the real person (name / direct line) and set the
    //    outreach_verified custom field. The field is a reliable fallback because
    //    GHL's search index can lag minutes before a newly-added tag appears in
    //    search results — the custom field is on the contact record directly.
    const update = {
      customFields: [{ id: OUTREACH_VERIFIED_FIELD_ID, value: "true" }],
    };
    if (dmFirstName) update.firstName = dmFirstName;
    if (dmLastName) update.lastName = dmLastName;
    if (dmPhone) update.phone = dmPhone;
    const upRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "PUT", headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!upRes.ok) console.error("[verify] update failed", upRes.status, await upRes.text());

    // 3) Audit note.
    const dmName = [dmFirstName, dmLastName].filter(Boolean).join(" ");
    const noteBody = `Discovery verified ${new Date().toISOString().slice(0, 10)}: decision-maker confirmed${dmName ? ` — ${dmName}` : ""}${dmPhone ? ` (${dmPhone})` : ""}.${wasName && dmName && wasName !== dmName ? ` Was: ${wasName}.` : ""}`;
    try {
      await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
        method: "POST", headers: { ...ghlHeaders(ghlToken), "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody, userId: payload.user || undefined }),
      });
    } catch { /* note is best-effort */ }

    return new Response(JSON.stringify({ success: true, verified: true }), { status: 200, headers });
  } catch (err) {
    console.error("[verify] error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers });
  }
}
