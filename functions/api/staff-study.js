// Cloudflare Pages Function: GET/POST /api/staff-study
// Per-participant capture for any Amari study (elbow, jaw, foot, hand, …).
// Garrett records intake + before/after 0–10 pain for each of 3 sessions.
//
// Lives in PORTAL_KV (own-infra), NOT GHL custom fields. Elbow data keeps the
// legacy key `elbow_study:{contactId}`; other studies use `study:{slug}:{id}`.
//
// GET  ?contactId=xxx&studySlug=tmj  → { record }  (null when nothing yet)
// POST { contactId, studySlug, record } → normalizes, writes, echoes back
//
// The older /api/staff-elbow-study endpoint still works for elbow-only clients.

import { corsHeaders, requireStaffAuth, parseJsonBody } from "../lib/endpoint-guards.js";
import { ghlFetch } from "../lib/ghl.js";
import {
  normalizeRecord,
  kvKey,
  isKnownStudySlug,
  sessionsDoneCount,
  STUDY_SESSIONS_DONE_FIELD_ID,
} from "../lib/study-capture.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

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

  const url = new URL(request.url);
  const contactId = url.searchParams.get("contactId");
  const studySlug = url.searchParams.get("studySlug");
  if (!contactId) {
    return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
  }
  if (!isKnownStudySlug(studySlug)) {
    return new Response(JSON.stringify({ error: "valid studySlug required" }), { status: 400, headers });
  }

  try {
    const record = (await env.PORTAL_KV.get(kvKey(studySlug, contactId), "json")) || null;
    return new Response(JSON.stringify({ record }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-study] GET error:", err.message);
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

  const { contactId, studySlug, record } = body;
  if (!contactId || typeof contactId !== "string") {
    return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });
  }
  if (!isKnownStudySlug(studySlug)) {
    return new Response(JSON.stringify({ error: "valid studySlug required" }), { status: 400, headers });
  }

  const nowIso = new Date().toISOString();
  const normalized = normalizeRecord(record, nowIso);

  try {
    await env.PORTAL_KV.put(kvKey(studySlug, contactId), JSON.stringify(normalized));

    // Mirror completed-session count to GHL (shared field across studies).
    // Best-effort: never fail the capture save if GHL is unreachable.
    const sessionsDone = sessionsDoneCount(normalized);
    try {
      await ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`, {
        method: "PUT",
        body: JSON.stringify({
          customFields: [{ id: STUDY_SESSIONS_DONE_FIELD_ID, value: sessionsDone }],
        }),
      });
    } catch (ghlErr) {
      console.error("[staff-study] GHL sessions-done sync failed:", ghlErr.message);
    }

    return new Response(JSON.stringify({ record: normalized }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-study] POST error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
