// Staff-authenticated, read-only proxy for the private CRM design pilot.
// The Worker credential stays server-side and this endpoint exposes no commands.

import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";

const WORKER_ORIGIN = "https://amari-crm-mirror.eben-fa2.workers.dev";
const TIMEOUT_MS = 15_000;
const METHODS = "GET, OPTIONS";
const CONTACT_ID = /^[A-Za-z0-9_-]{1,80}$/;

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function boundedLimit(value, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

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
  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;

  const secret = context.env.WORKER_AUTH_SECRET;
  if (!secret) return json(422, { error: "The private CRM pilot is not connected." }, headers);

  const requestUrl = new URL(context.request.url);
  const view = requestUrl.searchParams.get("view") || "inbox";
  let workerUrl;

  if (view === "inbox") {
    const params = new URLSearchParams({
      limit: String(boundedLimit(requestUrl.searchParams.get("limit"), 1000, 1000)),
    });
    const query = String(requestUrl.searchParams.get("query") || "").trim();
    if (query.length >= 2) params.set("query", query.slice(0, 100));
    workerUrl = `${WORKER_ORIGIN}/communications/inbox?${params}`;
  } else if (view === "contact") {
    const contactId = String(requestUrl.searchParams.get("id") || "");
    if (!CONTACT_ID.test(contactId)) return json(400, { error: "A valid contact is required." }, headers);
    const limit = boundedLimit(requestUrl.searchParams.get("limit"), 250, 250);
    workerUrl = `${WORKER_ORIGIN}/client-desk/contacts/${encodeURIComponent(contactId)}?limit=${limit}`;
  } else {
    return json(400, { error: "Unknown CRM pilot view." }, headers);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(workerUrl, {
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-Staff-Actor": String(payload?.user || "Staff").slice(0, 80),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(422, { error: "The private CRM pilot data could not be read.", upstreamStatus: response.status }, headers);
    }
    return json(200, body, headers);
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "AbortError";
    return json(422, { error: timedOut ? "The private CRM pilot data timed out." : "The private CRM pilot data could not be reached." }, headers);
  } finally {
    clearTimeout(timer);
  }
}
