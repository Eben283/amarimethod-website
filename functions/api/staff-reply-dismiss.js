// POST /api/staff-reply-dismiss
// Persists a "no reply needed" dismissal for a conversation so it survives
// page reloads. Stored as a single KV JSON map { [contactId]: lastMessageDate }
// so a new inbound message from the same contact automatically un-dismisses
// (lastMessageDate will no longer match the stored value).

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";

const KV_KEY = "reply:dismissed";

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || "", "POST, OPTIONS"),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Content-Type": "application/json" };

  const { error } = await requireStaffAuth(request, env, headers);
  if (error) return error;

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const { contactId, lastMessageDate } = body;
  if (!contactId || typeof contactId !== "string") {
    return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
  }

  try {
    const current = (await env.PORTAL_KV.get(KV_KEY, "json")) || {};
    current[contactId] = lastMessageDate || null;
    await env.PORTAL_KV.put(KV_KEY, JSON.stringify(current), { expirationTtl: 30 * 86400 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
  }
}
