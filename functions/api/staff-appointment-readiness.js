// Staff-authenticated, read-only proxy to the owned appointment shadow.
// The Staff calendar keeps using its direct provider schedule if this is slow,
// unavailable, or not migrated.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";

const WORKER_URL = "https://amari-crm-mirror.eben-fa2.workers.dev/appointments/readiness";
const TIMEOUT_MS = 10_000;
const METHODS = "GET, OPTIONS";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), METHODS),
  });
}

export async function onRequestGet(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;
  const secret = context.env.WORKER_AUTH_SECRET;
  if (!secret) return new Response(JSON.stringify({ error: "Appointment shadow is not configured." }), { status: 422, headers });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(WORKER_URL, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Appointment shadow could not be read.", upstreamStatus: response.status }), { status: 422, headers });
    }
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "AbortError"
      ? "Appointment shadow timed out."
      : "Appointment shadow could not be reached.";
    return new Response(JSON.stringify({ error: message }), { status: 422, headers });
  } finally {
    clearTimeout(timer);
  }
}
