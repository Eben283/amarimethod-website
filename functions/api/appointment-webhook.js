// GHL appointment/calendar event ingest — reminder-engine migration substrate (brick 3).
//
// Verify secret (constant-time) → parse → normalize → skip or claim idempotently → dispatch.
// The only place webhook transport concerns live; everything downstream sees the typed event.
//
// PREREQUISITE (gx02): no GHL appointment webhook is wired today. To go live (or shadow), configure
// a GHL webhook pointed here with header X-Webhook-Secret, set GHL_APPOINTMENT_WEBHOOK_SECRET in the
// Pages env, and capture one real payload to confirm the normalizer's field aliases.

import { normalizeAppointmentEvent } from "../lib/appointment-event.js";
import { timingSafeEqual } from "../lib/safe-equal.js";
import { claimProcessedEvent } from "../lib/processed-events.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { dispatchAppointmentEvent } from "../lib/appointment-dispatch.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const KEY_TTL_SECONDS = 30 * 24 * 3600; // KV fallback dedupe window

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function alert(context, summary, detail) {
  // fire-and-forget; never block the response on the ops ledger
  if (typeof context.waitUntil === "function") {
    context.waitUntil(recordOpsError(context.env, "appointment-webhook", summary, detail));
  }
}

export async function onRequestPost(context) {
  try {
    // 1–2. secret (fail closed, constant-time). Per-endpoint secret preferred; shared is a fallback
    // for `expected` only, never a second accepted value.
    const expected = context.env.GHL_APPOINTMENT_WEBHOOK_SECRET || context.env.GHL_WEBHOOK_SECRET;
    if (!expected) return json(500, { error: "webhook secret not configured" });
    const provided = context.request.headers.get("X-Webhook-Secret") || "";
    if (!timingSafeEqual(provided, expected)) return json(401, { error: "unauthorized" });

    // 3. body
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    // 4–5. normalize; skip anything we don't recognize (unknown status OR no appointmentId)
    const event = normalizeAppointmentEvent(body);
    if (!event.recognized) {
      return json(200, { success: true, skipped: true, reason: "unrecognized event" });
    }

    // 6. idempotency key on the TYPED status, so alias respellings collapse but real transitions don't
    const key = `appt:${event.appointmentId}:${event.type}`;

    // 7. claim, tiered: D1 → KV → proceed. Never block ingest on the ledger.
    try {
      const claim = await claimProcessedEvent(context.env.ATTEND_DB, key);
      if (claim && claim.duplicate) {
        return json(200, { success: true, duplicate: true });
      }
      if (!claim) {
        // D1 unbound → KV fallback
        const kv = context.env.PURCHASE_KV;
        if (kv) {
          const seen = await kv.get(key);
          if (seen) return json(200, { success: true, duplicate: true });
          await kv.put(key, new Date().toISOString(), { expirationTtl: KEY_TTL_SECONDS });
        } else {
          alert(context, "no idempotency binding", { key });
        }
      }
      // claim.ok === true → proceed
    } catch (err) {
      alert(context, "idempotency claim failed", { key, error: String(err?.message || err) });
      // non-fatal: proceed to dispatch
    }

    // 8. dispatch (contract says it can't throw, but a broken future consumer must not 5xx)
    let result = { ok: true, actions: [], errors: [] };
    try {
      result = await dispatchAppointmentEvent(context, event);
      if (result && result.ok === false) {
        alert(context, "dispatch reported errors", { key, errors: result.errors });
      }
    } catch (err) {
      alert(context, "dispatch threw", { key, error: String(err?.message || err) });
      result = { ok: false, actions: [], errors: [String(err?.message || err)] };
    }

    // 9. success
    return json(200, {
      success: true,
      type: event.type,
      appointmentId: event.appointmentId,
      actions: (result && result.actions) || [],
    });
  } catch (err) {
    alert(context, "unhandled error", { error: String(err?.message || err) });
    return json(500, { error: "internal error" });
  }
}
