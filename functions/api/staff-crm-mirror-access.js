// POST /api/staff-crm-mirror-access
// Mints a one-time CRM mirror dashboard access URL for an Eben staff session.
//
// Auth: Eben-only staff JWT at THIS layer. The CRM mirror Worker's bearer gate
// is satisfied server-side with WORKER_AUTH_SECRET — the browser never sees it.
// The returned URL is an opaque /dashboard-access/:code handoff that expires in
// five minutes and sets an HttpOnly dashboard session cookie.

import { requireEbenStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/dashboard-access-link";
const WORKER_TIMEOUT_MS = 15_000;

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
    const { error } = await requireEbenStaffAuth(context, headers);
    if (error) return error;

    const secret = context.env.WORKER_AUTH_SECRET;
    if (!secret) {
      return new Response(
        JSON.stringify({ error: "CRM mirror access is not configured" }),
        { status: 500, headers },
      );
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WORKER_TIMEOUT_MS);
    let body;
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: ac.signal,
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        return new Response(
          JSON.stringify({ error: `CRM mirror returned ${res.status}`, detail: body }),
          { status: 422, headers },
        );
      }
    } catch (err) {
      const aborted = err && err.name === "AbortError";
      const detail = aborted ? "CRM mirror access timed out" : (err.message || String(err));
      console.error("[staff-crm-mirror-access] worker fetch error:", detail);
      return new Response(JSON.stringify({ error: detail }), { status: 422, headers });
    } finally {
      clearTimeout(timer);
    }

    return new Response(
      JSON.stringify({
        url: body.url,
        expiresInSeconds: body.expiresInSeconds ?? 300,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-crm-mirror-access] failed:", detail);
    return new Response(
      JSON.stringify({ error: `Failed to open CRM mirror: ${detail}` }),
      { status: 500, headers },
    );
  }
}
