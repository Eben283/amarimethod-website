// Staff-authenticated proxy for Amari-owned dated follow-ups.
//
// The records live in the CRM mirror Worker's D1 database, but this endpoint is
// the only browser-facing boundary. WORKER_AUTH_SECRET remains server-side and
// the authenticated Staff identity is forwarded as the audit actor. No request
// from this module writes to GHL, Stripe, a calendar, or a message provider.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/owned-followups";
const WORKER_TIMEOUT_MS = 15_000;

function responseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin"), "GET, POST, OPTIONS"),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context) });
}

async function proxy(context, method) {
  const headers = responseHeaders(context);
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const secret = context.env.WORKER_AUTH_SECRET;
  if (!secret) return new Response(JSON.stringify({ error: "Owned follow-ups are not configured" }), { status: 422, headers });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const target = method === "GET" ? `${WORKER_URL}?state=open&limit=50` : WORKER_URL;
    const options = {
      method,
      headers: method === "GET"
        ? { Authorization: `Bearer ${secret}` }
        : {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
            "X-Staff-Actor": String(payload?.user || "").slice(0, 80),
          },
      signal: controller.signal,
    };
    if (method === "POST") options.body = await context.request.text();
    const upstream = await fetch(target, options);
    const body = await upstream.text();
    return new Response(body || JSON.stringify({ error: "Empty CRM response" }), { status: upstream.status, headers });
  } catch (error) {
    const message = error?.name === "AbortError" ? "Owned follow-ups timed out" : "Owned follow-ups are unavailable";
    console.error("[staff-followups] proxy failed:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: message }), { status: 422, headers });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(context) {
  return proxy(context, "GET");
}

export async function onRequestPost(context) {
  return proxy(context, "POST");
}
