// GHL→code tag bridge — the transition-window piece that lets the nurture watch run fully
// WITHOUT the Pages push (2026-07-12). While GHL still owns tag writes, a GHL workflow
// ("Nurture Tag Events → Code Webhook": Contact Tag Added triggers) POSTs {contact_id} here;
// GHL can't reliably tell us WHICH tag fired (merge tags proved unusable on the appointment
// webhook), so the bridge reads the contact's CURRENT tags from the GHL API (read-only) and
// feeds every watched tag through the engine. The engine's idempotency (one enrollment per
// contact per sequence; exits no-op without an active enrollment) makes re-fires harmless —
// has-tag is a safe superset of tag-added for these signals.
//
// Watched signals:
//   "quiz submitted"                                → {kind: quiz.submitted}  (Flow 1 entry —
//        stands in for the send-to-ghl.js emitter until the Pages side deploys)
//   "booked discovery call - workflow 2"            → tag.added  (Flow 1 exit)
//   "workflow 3 (customer attended 1st session)"    → tag.added  (Flow 1 + Flow 2 exits)

import { timingSafeEqual } from "../../functions/lib/safe-equal.js";
import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { handleEvent } from "./engine.js";
import { appendEvent } from "./store.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const QUIZ_TAG = "quiz submitted";
const EXIT_TAGS = ["booked discovery call - workflow 2", "workflow 3 (customer attended 1st session)"];

/**
 * Read a contact's tags from the GHL API. Exported so /event can reuse it for entry-guard
 * reads (removes guardUnchecked noise from the shadow log).
 */
export async function fetchContactTags(env, contactId) {
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!res.ok) throw new Error(`contact lookup ${res.status}`);
  const data = await res.json();
  const contact = data.contact || data;
  return Array.isArray(contact.tags) ? contact.tags : [];
}

export async function handleTagWebhook(request, env, nowMs) {
  const expected = env.GHL_TAG_WEBHOOK_SECRET || env.GHL_WEBHOOK_SECRET;
  if (!expected) return json(503, { error: "webhook secret not configured" });
  const provided = request.headers.get("X-Webhook-Secret") || "";
  if (!timingSafeEqual(provided, expected)) return json(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const contactId = String(body.contact_id || body.contactId || "").trim();
  if (!contactId) return json(400, { error: "contact_id required" });

  const db = env.NURTURE_DB;
  let tags;
  try {
    tags = await fetchContactTags(env, contactId);
  } catch (err) {
    await appendEvent(db, {
      ts: nowMs, engine: "ingest", contactId,
      action: "tag_bridge_error", outcome: "error",
      detail: { error: String((err && err.message) || err), retry: "next tag event" },
    });
    return json(200, { success: false, error: "contact lookup failed" });
  }

  const lower = tags.map((t) => String(t).toLowerCase());
  const deps = { getContactTags: async () => tags };
  const actions = [];

  if (lower.includes(QUIZ_TAG)) {
    const r = await handleEvent(env, { kind: "quiz.submitted", contactId }, nowMs, deps);
    actions.push(...r.actions);
  }
  for (const tag of EXIT_TAGS) {
    if (lower.includes(tag.toLowerCase())) {
      const r = await handleEvent(env, { kind: "tag.added", contactId, tag }, nowMs, deps);
      actions.push(...r.actions);
    }
  }

  return json(200, { success: true, tags: tags.length, actions });
}
