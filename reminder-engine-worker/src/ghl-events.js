// GHL field/order event ingest — closes the last shadow gaps WITHOUT the Pages push
// (Eben, 2026-07-12: "I'll build whatever we need"). The production Pages functions predate
// the emitter hooks on this branch, so GHL webhook workflows post the bare {contact_id} here
// and the worker enriches from the GHL API (read-only), same pattern as /webhook enrichment.
//
//   POST /ghl-event  { contact_id, event: "order" | "sessions_completed" | "sessions_remaining" }
//
//   order              → resolve the contact's most recent creditable order (payments API,
//                        productIdForAnyId handles price-id aliases) → forward {kind:purchase}
//                        to the nurture engine (Flow 3 exits) + run recordSeriesPurchase
//                        (upgrade-offer cancel + confirmation, both shadow-gated).
//   sessions_completed → the Post-Initial Upgrade Offer trigger: guard-check the contact
//                        (series_type empty, no partner tags) and schedule the 3-day timer.
//                        Evidence Contact-Changed fires on API field writes: GHL's own offer
//                        workflow has real enrollments and its field is only ever written by
//                        the staff app + reconcile worker.
//   sessions_remaining → the Living Practice Onboarding listener (8-session at exactly 2).
//
// Every handler is non-fatal: after auth + parse the answer is always 200, failures are
// captured on automation_events. All sends stay behind the libs' shadow gates.

import { verifyGhlWebhookSecret } from "../../functions/lib/ghl-webhook-auth.js";
import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { PURCHASE_CREDIT_MAP, productIdForAnyId } from "../../functions/lib/ghl-products.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../../functions/lib/ghl-fields.js";
import { recordSeriesPurchase } from "../../functions/lib/purchase-confirmations.js";
import { shouldScheduleUpgradeOffer, scheduleUpgradeOffer, appendAutomationEvent } from "../../functions/lib/upgrade-offer.js";
import { maybeSendLpOnboarding } from "../../functions/lib/lp-onboarding.js";
import { forwardEventToEngine } from "../../functions/lib/engine-forward.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const EVENTS = new Set(["order", "sessions_completed", "sessions_remaining"]);

// The libs write to context.env.AUTOMATION_DB; this worker's binding for the SAME database
// is REMINDER_DB — bridge it once here.
const libCtx = (env) => ({ env: { ...env, AUTOMATION_DB: env.REMINDER_DB } });

async function ghlGet(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
  });
  if (!res.ok) throw new Error(`GHL GET ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

function fieldValue(contact, fieldId) {
  const cf = (contact.customFields || []).find((x) => x.id === fieldId);
  return cf ? (cf.value ?? cf.field_value ?? null) : null;
}

async function fetchContact(env, contactId) {
  const data = await ghlGet(env, `/contacts/${contactId}`);
  return data.contact || data;
}

/** The contact's most recent completed order carrying a creditable product, or null. */
async function findCreditableOrder(env, contactId) {
  const data = await ghlGet(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=10`);
  const orders = data.data || data.orders || [];
  for (const order of orders) {
    if (order.status && String(order.status).toLowerCase() !== "completed") continue;
    for (const item of order.items || []) {
      for (const anyId of [item.product && item.product._id, item.price && item.price._id, item.productId, item.priceId]) {
        const productId = anyId && productIdForAnyId(anyId);
        if (productId && PURCHASE_CREDIT_MAP[productId]) {
          return { orderId: order._id || order.id, productId, pkg: PURCHASE_CREDIT_MAP[productId] };
        }
      }
    }
  }
  return null;
}

export async function handleGhlEvent(request, env, nowMs) {
  const provided = request.headers.get("X-Webhook-Secret") || "";
  const auth = verifyGhlWebhookSecret(env, provided, "GHL_APPOINTMENT_WEBHOOK_SECRET");
  if (!auth.configured) return json(503, { error: "webhook secret not configured" });
  if (!auth.valid) return json(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const contactId = String(body.contact_id || body.contactId || "").trim();
  const event = String(body.event || "").trim();
  if (!contactId || !EVENTS.has(event)) return json(400, { error: "contact_id and a known event required" });

  const db = env.REMINDER_DB;

  try {
    if (event === "order") {
      const match = await findCreditableOrder(env, contactId);
      if (!match) {
        await appendAutomationEvent(db, {
          ts: nowMs, engine: "ingest", contactId,
          action: "ghl_event_unmatched", outcome: "skipped", detail: { event },
        });
        return json(200, { success: true, skipped: "no-creditable-order" });
      }
      const actions = [];
      const fwd = await forwardEventToEngine(env, {
        urlVar: "NURTURE_ENGINE_URL",
        event: { kind: "purchase", contactId, productId: match.productId },
        fetcher: env.NURTURE ? env.NURTURE.fetch.bind(env.NURTURE) : undefined,
      });
      if (fwd.ok && !fwd.skipped) actions.push(...(fwd.actions || []));
      const seam = await recordSeriesPurchase(libCtx(env), {
        contactId,
        seriesType: match.pkg.seriesType,
        classification: match.pkg.classification,
        ref: `order:${match.orderId}`,
        source: "ghl-event-webhook",
      }, nowMs);
      return json(200, { success: true, productId: match.productId, actions, seam });
    }

    if (event === "sessions_completed") {
      const contact = await fetchContact(env, contactId);
      const eligible = shouldScheduleUpgradeOffer({
        seriesType: fieldValue(contact, GHL_FIELD_IDS.series_type),
        tags: contact.tags || [],
      });
      if (!eligible) {
        await appendAutomationEvent(db, {
          ts: nowMs, engine: "purchase", flowKey: "upgrade-offer", contactId,
          action: "scheduled", outcome: "skipped", detail: { reason: "guard-ineligible-at-trigger" },
        });
        return json(200, { success: true, scheduled: false });
      }
      const { created } = await scheduleUpgradeOffer(db, contactId, nowMs);
      if (created) {
        await appendAutomationEvent(db, {
          ts: nowMs, engine: "purchase", flowKey: "upgrade-offer", contactId,
          action: "scheduled", outcome: "scheduled", detail: { via: "ghl-event-webhook" },
        });
      }
      return json(200, { success: true, scheduled: created });
    }

    // sessions_remaining
    const contact = await fetchContact(env, contactId);
    const result = await maybeSendLpOnboarding(libCtx(env), {
      contactId,
      seriesType: fieldValue(contact, GHL_FIELD_IDS.series_type),
      newRemaining: Number(fieldValue(contact, GHL_FIELD_IDS.sessions_remaining)),
    }, nowMs);
    return json(200, { success: true, lp: result.outcome });
  } catch (err) {
    await appendAutomationEvent(db, {
      ts: nowMs, engine: "ingest", contactId,
      action: "ghl_event_error", outcome: "error",
      detail: { event, error: String((err && err.message) || err) },
    }).catch(() => {});
    return json(200, { success: false, error: "lookup failed, captured" });
  }
}
