/**
 * POST /api/portal-pay-followup
 *
 * Authenticated portal clients with no prepaid balance: save the Amari-calendar
 * slot onto the contact (requested_session_*), then return the correct
 * à-la-carte single-session GHL payment link:
 *   - default / new clients → $285 Single Session
 *   - founders-circle tag → legacy $190 Single Follow-up
 * After payment, ghl-purchase-webhook books the appointment on the requested
 * calendar (same path as public native checkout).
 *
 * Calendars: SKDVOL8… (in person) / oVn77… (virtual)
 */

import { ghlFetch } from "../lib/ghl.js";
import { requireOwner } from "../lib/owned-access.js";
import { FIELD_IDS as GHL_FIELD_IDS } from "../lib/ghl-fields.js";
import { emitPathHop } from "../lib/ops-path-emit.js";
import { recordOpsError } from "../lib/ops-alert.js";
import { singleSessionOfferFor } from "../lib/session-pricing.js";

const allowedOrigin = "https://www.amarimethod.com";

export const PAID_FOLLOWUP_CALENDARS = {
  "in-person": "SKDVOL8wtUN6Ne0ppbC9",
  virtual: "oVn77FcecFY16iS2pHyP",
};

function cors(requestOrigin) {
  const origin = requestOrigin === allowedOrigin ? allowedOrigin : "";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status = 200, requestOrigin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(requestOrigin), "Content-Type": "application/json" },
  });
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: cors(origin) });
}

export async function onRequestPost(context) {
  const { request } = context;
  const origin = request.headers.get("Origin") || "";
  const gateHeaders = { ...cors(origin), "Content-Type": "application/json" };
  const gate = await requireOwner(context, gateHeaders, {
    messages: { notAuthenticated: "Unauthorized", invalidToken: "Unauthorized" },
  });
  if (gate.error) return gate.error;
  const { contactId } = gate;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const { startTime, timezone, sessionType } = body || {};
  if (!startTime || typeof startTime !== "string") {
    return json({ error: "startTime is required" }, 400, origin);
  }
  if (!timezone || typeof timezone !== "string") {
    return json({ error: "timezone is required" }, 400, origin);
  }
  const calendarId = PAID_FOLLOWUP_CALENDARS[sessionType];
  if (!calendarId) {
    return json({ error: "sessionType must be in-person or virtual" }, 400, origin);
  }

  // Resolve dual-price offer from the live contact tags (Founder's Circle → $190).
  const contactRes = await ghlFetch(
    context,
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
  );
  if (!contactRes.ok) {
    return json({ error: "Contact not found" }, 404, origin);
  }
  const contactPayload = await contactRes.json();
  const contact = contactPayload.contact || contactPayload;
  const offer = singleSessionOfferFor({ tags: contact.tags || [] });

  // Persist the picked slot for the purchase webhook (same fields as /book/create-checkout).
  // DATE field gets YYYY-MM-DD only; TEXT iso keeps the full offset time.
  const dateOnly = String(startTime).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || startTime;
  const updateRes = await ghlFetch(
    context,
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        customFields: [
          { id: GHL_FIELD_IDS.requested_session_slot, field_value: dateOnly },
          { id: GHL_FIELD_IDS.requested_session_slot_iso, field_value: startTime },
          { id: GHL_FIELD_IDS.requested_session_calendar, field_value: calendarId },
          { id: GHL_FIELD_IDS.requested_session_type, field_value: sessionType },
        ],
      }),
    },
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error(`[portal-pay-followup] contact update ${updateRes.status}: ${errText}`);
    context.waitUntil?.(
      recordOpsError(context.env, "portal-pay-followup", "Could not save portal follow-up slot", {
        contactId,
        status: updateRes.status,
        error: String(errText).slice(0, 300),
      }),
    );
    return json({ error: "Could not save your selected time. Please try again." }, 422, origin);
  }

  context.waitUntil?.(
    emitPathHop(context.env, {
      pathId: "portal_followup_paid_book",
      hopId: "pay_followup",
      outcome: "ok",
      summary: `Portal ${offer.priceLabel} slot saved; payment link returned`,
      source: "portal-pay-followup",
      contactId,
      condition: {
        expected: "requested_session_slot_iso set",
        observed: String(startTime),
      },
      money: { product: offer.name, amountCents: offer.amountCents },
    }),
  );

  try {
    await ghlFetch(
      context,
      `https://services.leadconnectorhq.com/contacts/${contactId}/tags`,
      {
        method: "POST",
        body: JSON.stringify({ tags: ["native-booking-started", "portal-payg-followup"] }),
      },
    );
  } catch (err) {
    console.warn("[portal-pay-followup] tag add failed:", err);
  }

  const paymentUrl = new URL(offer.paymentLinkUrl);
  // Contact-scoped links help GHL attach the order to the right person when possible.
  paymentUrl.searchParams.set("contact_id", contactId);

  return json({
    success: true,
    paymentUrl: paymentUrl.toString(),
    calendarId,
    amountCents: offer.amountCents,
    priceLabel: offer.priceLabel,
    productId: offer.productId,
  }, 200, origin);
}
