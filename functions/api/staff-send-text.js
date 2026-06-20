// Cloudflare Pages Function: POST /api/staff-send-text
// Sends a staff-composed follow-up SMS to a contact via GHL — the "one tap"
// behind the post-call text on the Follow-Up card (e.g. the "just left you a
// voicemail" nudge). Same send mechanism as staff-send-paylink; the body is the
// pre-written text the staff member chose on the card. Staff-authed + length-
// capped + idempotent + logged. GHL is still the only sender — this just fires
// the message the staff member would otherwise have copy-pasted into the thread.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
// The personalized coach drafts are warm + full (Garrett's voice, "never clipped") and run
// ~480-520 chars; the old 480 cap silently 400'd them ("Message too long" hidden behind a
// generic UI error). 720 ≈ 5 concatenated SMS segments — covers the drafts with headroom
// while still rejecting a runaway paste. (Generator targets ~70 words; tighten it separately.)
const MAX_LEN = 720;
const DEDUPE_TTL_S = 300; // 5 min — kills double-taps + retry-after-timeout dupes

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];

// GHL contact ids are alphanumeric — reject anything else (KV-key / path-segment safety).
const VALID_CONTACT_ID = /^[A-Za-z0-9]+$/;
// Reject C0/C1 control chars (tab/newline/CR excepted) and the Unicode bidi
// overrides — they can spoof the displayed message or inflate SMS segment count.
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E]/;
// US 10-digit normalize (mirrors staff-partner-prospects) — never text a malformed number.
function normalizePhone(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  if (d.length === 10 && /^[2-9]/.test(d)) return d;
  return null;
}
// Small stable hash for the idempotency key (dedup is per-contact + 5-min TTL, so
// collision risk is irrelevant — this just has to be stable for the same text).
function hashKey(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

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
  if (!VALID_CONTACT_ID.test(contactId)) return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
  if (!message) return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers });
  if (message.length > MAX_LEN) return new Response(JSON.stringify({ error: "Message too long" }), { status: 400, headers });
  if (BAD_CHARS.test(message)) return new Response(JSON.stringify({ error: "Message has invalid characters" }), { status: 400, headers });

  // Idempotency: reserve a per-contact + per-message key BEFORE sending so a
  // double-tap, a retry-after-timeout, or two tabs can't fire the same text twice.
  const kv = context.env.PORTAL_KV;
  const dedupeKey = `sent:${contactId}:${hashKey(message)}`;
  if (kv) {
    const seen = await kv.get(dedupeKey);
    if (seen) return new Response(JSON.stringify({ success: true, deduped: true }), { status: 200, headers });
    try { await kv.put(dedupeKey, "1", { expirationTtl: DEDUPE_TTL_S }); } catch { /* non-fatal */ }
  }
  const releaseDedupe = async () => { if (kv) { try { await kv.delete(dedupeKey); } catch { /* ignore */ } } };

  // Confirm the contact exists + has a VALID phone before sending (don't text a
  // malformed/garbage number that GHL might mis-route).
  const contactRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`);
  if (!contactRes.ok) { await releaseDedupe(); return new Response(JSON.stringify({ error: "Contact not found" }), { status: 404, headers }); }
  const contact = (await contactRes.json()).contact;
  const phone = normalizePhone(contact?.phone);
  if (!phone) { await releaseDedupe(); return new Response(JSON.stringify({ error: "Contact has no valid phone number" }), { status: 400, headers }); }

  const smsRes = await ghlFetch(context, `${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    body: JSON.stringify({ type: "SMS", contactId, message }),
  });
  if (!smsRes.ok) {
    await releaseDedupe(); // let the staffer retry a genuinely-failed send
    const errText = await smsRes.text();
    console.error(`[staff-send-text] SMS send failed: ${smsRes.status} ${errText}`);
    return new Response(JSON.stringify({ error: "Failed to send text" }), { status: 422, headers });
  }
  console.log(`[staff-send-text] sent by ${tokenPayload.user || "staff"} to ${contactId} (last4 ${phone.slice(-4)}, ${message.length} chars)`);

  return new Response(JSON.stringify({ success: true, sentTo: `***${phone.slice(-4)}` }), { status: 200, headers });
}
