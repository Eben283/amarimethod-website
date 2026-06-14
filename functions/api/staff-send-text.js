// Cloudflare Pages Function: POST /api/staff-send-text
// Sends a staff-composed follow-up SMS to a contact via GHL — the "one tap"
// behind the post-call text on the Follow-Up card (e.g. the "just left you a
// voicemail" nudge). Same send mechanism as staff-send-paylink; the body is the
// pre-written text the staff member chose on the card. Staff-authed + length-
// capped + logged. GHL is still the only sender — this just fires the message
// the staff member would otherwise have copy-pasted into the GHL thread.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const MAX_LEN = 480; // ~3 SMS segments; a follow-up nudge is far shorter

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };

  const JWT_SECRET = context.env.JWT_SECRET;
  if (!JWT_SECRET) return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });

  const auth = context.request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
  let tokenPayload;
  try {
    tokenPayload = await verifySessionToken(auth.slice(7), JWT_SECRET);
  } catch {
    return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
  }
  if (tokenPayload.role !== "staff") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });

  let body;
  try { body = await context.request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const contactId = (body.contactId || "").trim();
  const message = (body.message || "").trim();
  if (!contactId) return new Response(JSON.stringify({ error: "contactId is required" }), { status: 400, headers });
  if (!message) return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers });
  if (message.length > MAX_LEN) return new Response(JSON.stringify({ error: "Message too long" }), { status: 400, headers });

  // Confirm the contact exists + has a phone before sending (clear error vs a
  // cryptic GHL failure).
  const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`);
  if (!contactRes.ok) return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers });
  const contact = (await contactRes.json()).contact;
  if (!contact?.phone) return new Response(JSON.stringify({ error: "Contact has no phone number" }), { status: 400, headers });

  const smsRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    body: JSON.stringify({ type: "SMS", contactId, message }),
  });
  if (!smsRes.ok) {
    const errText = await smsRes.text();
    console.error(`[staff-send-text] SMS send failed: ${smsRes.status} ${errText}`);
    return new Response(JSON.stringify({ error: "Failed to send text" }), { status: 422, headers });
  }
  console.log(`[staff-send-text] sent by ${tokenPayload.user || "staff"} to ${contactId} (${message.length} chars)`);

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
