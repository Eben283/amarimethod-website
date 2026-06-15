// Cloudflare Pages Function: POST /api/staff-send-email
// Sends a staff-composed (custom, personalized) follow-up EMAIL to a contact via GHL —
// the email twin of staff-send-text. Same principle: GHL is the only sender, so the email
// goes out from garrett@ AND is logged on the contact's conversation timeline (traceable,
// exit-on-reply works). Staff-authed + length-capped + idempotent + logged.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const MAX_SUBJECT = 200;
const MAX_BODY = 8000; // an email body, generous but bounded
const DEDUPE_TTL_S = 300;

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];
const VALID_CONTACT_ID = /^[A-Za-z0-9]+$/;
// Block C0/C1 control chars (tab/newline/CR excepted) + Unicode bidi overrides.
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E]/; // control + bidi (tab/newline ok)
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function hashKey(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function maskEmail(e) { const [u, d] = String(e).split("@"); return `${u.slice(0, 2)}***@${d || ""}`; }

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
  try { tokenPayload = await verifySessionToken(auth.slice(7), JWT_SECRET); }
  catch { return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers }); }
  if (tokenPayload.role !== "staff") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });

  let body;
  try { body = await context.request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const contactId = (body.contactId || "").trim();
  const subject = (body.subject || "").trim();
  const html = (body.html || "").trim();
  if (!contactId || !VALID_CONTACT_ID.test(contactId)) return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
  if (!subject) return new Response(JSON.stringify({ error: "subject is required" }), { status: 400, headers });
  if (!html) return new Response(JSON.stringify({ error: "body is required" }), { status: 400, headers });
  if (subject.length > MAX_SUBJECT || html.length > MAX_BODY) return new Response(JSON.stringify({ error: "Email too long" }), { status: 400, headers });
  if (BAD_CHARS.test(subject) || BAD_CHARS.test(html)) return new Response(JSON.stringify({ error: "Email has invalid characters" }), { status: 400, headers });

  const kv = context.env.PORTAL_KV;
  const dedupeKey = `sentmail:${contactId}:${hashKey(subject + html)}`;
  if (kv) {
    if (await kv.get(dedupeKey)) return new Response(JSON.stringify({ success: true, deduped: true }), { status: 200, headers });
    try { await kv.put(dedupeKey, "1", { expirationTtl: DEDUPE_TTL_S }); } catch { /* non-fatal */ }
  }
  const releaseDedupe = async () => { if (kv) { try { await kv.delete(dedupeKey); } catch { /* ignore */ } } };

  // Confirm the contact exists + has a valid email before sending.
  const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`);
  if (!contactRes.ok) { await releaseDedupe(); return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers }); }
  const contact = (await contactRes.json()).contact;
  const email = (contact?.email || "").trim();
  if (!email || !VALID_EMAIL.test(email)) { await releaseDedupe(); return new Response(JSON.stringify({ error: "Contact has no valid email" }), { status: 400, headers }); }

  const sendRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    body: JSON.stringify({ type: "Email", contactId, subject, html }),
  });
  if (!sendRes.ok) {
    await releaseDedupe();
    const errText = await sendRes.text();
    console.error(`[staff-send-email] send failed: ${sendRes.status} ${errText}`);
    return new Response(JSON.stringify({ error: "Failed to send email" }), { status: 422, headers });
  }
  console.log(`[staff-send-email] sent by ${tokenPayload.user || "staff"} to ${contactId} (${maskEmail(email)}, subj ${subject.length}c, body ${html.length}c)`);

  return new Response(JSON.stringify({ success: true, sentTo: maskEmail(email) }), { status: 200, headers });
}
