// Read-only Staff boundary for local Gmail reply-sync evidence.
// It never contacts Gmail and exposes neither Worker credentials nor message bodies.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/gmail/reply-readiness";
const WORKER_TIMEOUT_MS = 10_000;
const STAFF_ACTORS = new Set(["Eben", "Garrett"]);

function responseHeaders(context) {
  return {
    ...corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS"),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: responseHeaders(context) });
}

export async function onRequestGet(context) {
  const headers = responseHeaders(context);
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;
  const actor = String(payload?.user || "");
  if (!STAFF_ACTORS.has(actor)) {
    return new Response(JSON.stringify({ error: "An owned Amari mailbox is required" }), { status: 403, headers });
  }
  const secret = context.env.WORKER_AUTH_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "Reply evidence is not configured" }), { status: 422, headers });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({ actor, limit: "8" });
    const upstream = await fetch(`${WORKER_URL}?${query}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const body = await upstream.text();
    return new Response(body || JSON.stringify({ error: "Empty reply evidence response" }), {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("[staff-gmail-reply-readiness] proxy failed:", error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: "Reply evidence is unavailable" }), { status: 422, headers });
  } finally {
    clearTimeout(timer);
  }
}
