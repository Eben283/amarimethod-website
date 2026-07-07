// Cloudflare Pages Function: GET/POST /api/staff-elbow-study
// Per-participant record for the Elbow Reset Study. Garrett captures the intake
// (which arm, weeks of pain, how it affects their game) at session 1, plus a
// before/after 0-10 pain score for each of the 3 sessions.
//
// Lives in PORTAL_KV (own-infra), NOT GHL custom fields: this is study-specific
// data with no native home in GHL, and it mirrors the course-progress pattern
// in portal-progress.js. Keyed per contact so a later sweep can assemble the
// published case series.
//
// GET  ?contactId=xxx  → { record }  (record is null when nothing captured yet)
// POST { contactId, record }         → normalizes server-side, writes, echoes back

import { corsHeaders, requireStaffAuth, parseJsonBody } from "../lib/endpoint-guards.js";

const SESSION_COUNT = 3;
const ARM_VALUES = new Set(["left", "right", "both"]);
const MAX_TEXT = 1000;
const MAX_WEEKS = 520; // ~10 years — a sane upper bound, not a real limit
// Validated-survey guards. We don't duplicate the instrument's item list here
// (that lives in the staff app's data/studies.ts); we clamp shape only. The
// longest instrument in the program is ~20 items, so 40 keys is generous.
const MAX_INSTRUMENT_ITEMS = 40;
const MAX_ITEM_ID = 16;
const ITEM_ID_RE = /^[a-z0-9_-]+$/i;

function kvKey(contactId) {
  return `elbow_study:${contactId}`;
}

// Coerce to an integer pain score in [0,10], else null. Never trust the client.
function normPain(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 0 || i > 10) return null;
  return i;
}

function normWeeks(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 0 || i > MAX_WEEKS) return null;
  return i;
}

function normText(v) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, MAX_TEXT);
}

function normAt(v) {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normSession(raw, nowIso) {
  const s = raw && typeof raw === "object" ? raw : {};
  const before = normPain(s.before);
  const after = normPain(s.after);
  const notes = normText(s.notes);
  // Stamp `at` when there's real data and none was provided, so we know when a
  // session was recorded without trusting a client clock for existing values.
  const hasData = before !== null || after !== null || notes !== "";
  const at = normAt(s.at) || (hasData ? nowIso : null);
  return { before, after, notes, at };
}

// Coerce a client responses map into a clean {itemId: 0-10} object. Drops any
// key that isn't a short id-shaped string or whose value isn't a valid 0-10
// score, and caps the total item count. Whitelisting exact item ids is the
// staff app's job (it only renders real instrument items); here we clamp shape.
function normResponses(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  let count = 0;
  for (const key of Object.keys(v)) {
    if (count >= MAX_INSTRUMENT_ITEMS) break;
    if (typeof key !== "string" || key.length > MAX_ITEM_ID || !ITEM_ID_RE.test(key)) continue;
    const score = normPain(v[key]);
    if (score === null) continue; // unanswered items are simply absent
    out[key] = score;
    count += 1;
  }
  return out;
}

// One survey filling (baseline or final). Stamps `at` when there's real data
// and none was provided, mirroring normSession.
function normSnapshot(raw, nowIso) {
  const s = raw && typeof raw === "object" ? raw : {};
  const responses = normResponses(s.responses);
  const hasData = Object.keys(responses).length > 0;
  const at = normAt(s.at) || (hasData ? nowIso : null);
  return { responses, at };
}

// Pure: builds a fresh, fully-validated record from arbitrary client input.
// Returns a new object every call (no mutation of the input).
export function normalizeRecord(input, nowIso) {
  const src = input && typeof input === "object" ? input : {};
  const arm = ARM_VALUES.has(src.arm) ? src.arm : null;
  const painWeeks = normWeeks(src.painWeeks);
  const gameImpact = normText(src.gameImpact);
  const baseline = normSnapshot(src.baseline, nowIso);
  const final = normSnapshot(src.final, nowIso);

  const rawSessions = Array.isArray(src.sessions) ? src.sessions : [];
  const sessions = Array.from({ length: SESSION_COUNT }, (_, i) =>
    normSession(rawSessions[i], nowIso)
  );

  return { arm, painWeeks, gameImpact, baseline, final, sessions, updatedAt: nowIso };
}

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
    const record = (await env.PORTAL_KV.get(kvKey(contactId), "json")) || null;
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
    await env.PORTAL_KV.put(kvKey(contactId), JSON.stringify(normalized));
    return new Response(JSON.stringify({ record: normalized }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-elbow-study] POST error:", err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
