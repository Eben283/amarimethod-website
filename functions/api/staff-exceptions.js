// Cloudflare Pages Function: GET/POST /api/staff-exceptions
// Staff triage inbox — drains durable ops:err entries into plain-language
// cards with Open client / Open GHL / Mark handled. No AI.

import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { listOpsErrors, clearOpsError } from "../lib/ops-alert.js";
import { humanizeOpsError, isOpsErrKey } from "../lib/staff-exceptions.js";

const METHODS = "GET, POST, OPTIONS";

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
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const errors = await listOpsErrors(context.env, { limit: 100 });
  // Newest first for the morning list.
  const items = errors
    .map(humanizeOpsError)
    .filter((item) => item.id)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  return new Response(
    JSON.stringify({
      items,
      count: items.length,
      generatedAt: new Date().toISOString(),
    }),
    { status: 200, headers },
  );
}

export async function onRequestPost(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const { body, error: parseError } = await parseJsonBody(context.request, headers);
  if (parseError) return parseError;

  const action = body?.action;
  const key = typeof body?.key === "string" ? body.key.trim() : "";

  if (action !== "dismiss") {
    return new Response(JSON.stringify({ error: "Unsupported action" }), { status: 400, headers });
  }
  if (!isOpsErrKey(key)) {
    return new Response(JSON.stringify({ error: "Invalid exception key" }), { status: 400, headers });
  }

  await clearOpsError(context.env, key);
  return new Response(JSON.stringify({ ok: true, key }), { status: 200, headers });
}
