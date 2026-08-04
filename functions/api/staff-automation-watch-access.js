// POST /api/staff-automation-watch-access
// Mints a one-time Automation Watch URL for the authenticated Staff session.
// The browser never receives the Worker bearer secret or the dashboard key.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://reminder-engine.eben-fa2.workers.dev/dashboard-access-link";
const WORKER_TIMEOUT_MS = 15_000;

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin") || ""), "Content-Type": "application/json" };
  try {
    const { error, payload } = await requireStaffAuth(context, headers);
    if (error) return error;
    const secret = context.env.WORKER_AUTH_SECRET;
    if (!secret) return new Response(JSON.stringify({ error: "Automation Watch access is not configured" }), { status: 500, headers });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    try {
      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "X-Staff-Actor": String(payload?.user || "").slice(0, 80) },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.url) {
        return new Response(JSON.stringify({ error: `Automation Watch returned ${response.status}` }), { status: 422, headers });
      }
      return new Response(JSON.stringify({ url: body.url, expiresInSeconds: body.expiresInSeconds ?? 300 }), { status: 200, headers });
    } catch (err) {
      const message = err?.name === "AbortError" ? "Automation Watch access timed out" : String(err?.message || err);
      console.error("[staff-automation-watch-access] worker fetch error:", message);
      return new Response(JSON.stringify({ error: message }), { status: 422, headers });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = String(err?.message || err);
    console.error("[staff-automation-watch-access] failed:", message);
    return new Response(JSON.stringify({ error: `Failed to open Automation Watch: ${message}` }), { status: 500, headers });
  }
}
