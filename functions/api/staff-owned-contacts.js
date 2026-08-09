// Staff-authenticated contact search backed by Amari's owned CRM mirror.
// Provider IDs are returned only as migration/execution crosswalk evidence;
// the stable `id` used by Staff-owned records is the owned contact ID.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/contacts";
const TIMEOUT_MS = 10_000;

function headers(origin) {
  return {
    ...corsHeaders(origin, "GET, OPTIONS"),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: headers(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const responseHeaders = headers(context.request.headers.get("Origin"));
  const { error } = await requireStaffAuth(context, responseHeaders);
  if (error) return error;
  if (!context.env.WORKER_AUTH_SECRET) {
    return new Response(JSON.stringify({ error: "Owned contact search is not configured" }), { status: 422, headers: responseHeaders });
  }

  const query = (new URL(context.request.url).searchParams.get("query") || "").trim();
  if (query.length < 2 || query.length > 120) return new Response(JSON.stringify([]), { status: 200, headers: responseHeaders });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${WORKER_URL}?limit=20&query=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${context.env.WORKER_AUTH_SECRET}` },
      signal: controller.signal,
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "Owned contact search is unavailable" }), { status: 422, headers: responseHeaders });
    }
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    return new Response(JSON.stringify(contacts.map((contact) => ({
      id: String(contact.id || ""),
      providerContactId: contact.provider_contact_id ? String(contact.provider_contact_id) : null,
      name: String(contact.display_name || "Unknown"),
      email: String(contact.email_normalized || ""),
      phone: String(contact.phone_e164 || ""),
    })).filter((contact) => contact.id)), { status: 200, headers: responseHeaders });
  } catch (cause) {
    const errorMessage = cause instanceof Error && cause.name === "AbortError"
      ? "Owned contact search timed out"
      : "Owned contact search is unavailable";
    return new Response(JSON.stringify({ error: errorMessage }), { status: 422, headers: responseHeaders });
  } finally {
    clearTimeout(timer);
  }
}
