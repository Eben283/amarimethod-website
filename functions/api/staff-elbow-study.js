// Cloudflare Pages Function: GET/POST /api/staff-elbow-study
// Legacy elbow-only capture endpoint. New code should use /api/staff-study with
// studySlug=tennis-elbow. Kept so existing staff-app builds keep working and
// existing KV keys (`elbow_study:{contactId}`) stay readable.
//
// GET  ?contactId=xxx  → { record }  (record is null when nothing captured yet)
// POST { contactId, record }         → normalizes server-side, writes, echoes back

import { corsHeaders, requireStaffAuth, parseJsonBody } from "../lib/endpoint-guards.js";
import { ghlFetch } from "../lib/ghl.js";
import {
  normalizeRecord,
  kvKey,
  sessionsDoneCount,
  STUDY_SESSIONS_DONE_FIELD_ID,
} from "../lib/study-capture.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const STUDY_SLUG = "tennis-elbow";

export { normalizeRecord };

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin") || "", "GET, POST, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json" };

  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const contactId = new URL(request.url).searchParams.get("contactId");
  if (!contactId) {
    return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
  }

  try {
    const record = (await env.PORTAL_KV.get(kvKey(STUDY_SLUG, contactId), "json")) || null;
    return new Response(JSON.stringify({ record }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-elbow-study] GET error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, POST, OPTIONS"), "Content-Type": "application/json" };

  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const { body, error: parseError } = await parseJsonBody(request, headers);
  if (parseError) return parseError;

  const { contactId, record } = body;
  if (!contactId || typeof contactId !== "string") {
    return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
  }

  const nowIso = new Date().toISOString();
  const normalized = normalizeRecord(record, nowIso);

  try {
    await env.PORTAL_KV.put(kvKey(STUDY_SLUG, contactId), JSON.stringify(normalized));

    const sessionsDone = sessionsDoneCount(normalized);
    try {
      await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        body: JSON.stringify({
          customFields: [{ id: STUDY_SESSIONS_DONE_FIELD_ID, value: sessionsDone }],
        }),
      });
    } catch (ghlErr) {
      console.error("[staff-elbow-study] GHL sessions-done sync failed:", ghlErr.message);
    }

    return new Response(JSON.stringify({ record: normalized }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-elbow-study] POST error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
