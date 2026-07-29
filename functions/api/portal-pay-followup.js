/**
 * POST /api/portal-pay-followup
 *
 * Authenticated portal clients with no prepaid balance: save the Amari-calendar
 * slot onto the contact (requested_session_*), then return the EXISTING $190
 * Single Follow-up GHL payment link. After payment, ghl-purchase-webhook books
 * the appointment on the requested calendar (same path as public native checkout).
 *
 * No new GHL product or calendar — reuses:
 *   product 6998ace59dfde469ecb2aab6
 *   payment-link/6998ad0288a3f09db4845d26
 *   calendars SKDVOL8… (in person) / oVn77… (virtual)
 */

import { ghlFetch } from "../lib/ghl.js";
import { requireOwner } from "../lib/owned-access.js";

const allowedOrigin = "https://www.amarimethod.com";
const PAYMENT_LINK_URL = "https://link.amarimethod.com/payment-link/6998ad0288a3f09db4845d26";

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

  // Persist the picked slot for the purchase webhook (same fields as /book/create-checkout).
  const updateRes = await ghlFetch(
    context,
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        customFields: [
          { key: "requested_session_slot", field_value: startTime },
          { key: "requested_session_slot_iso", field_value: startTime },
          { key: "requested_session_calendar", field_value: calendarId },
          { key: "requested_session_type", field_value: sessionType },
        ],
      }),
    },
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error(`[portal-pay-followup] contact update ${updateRes.status}: ${errText}`);
    return json({ error: "Could not save your selected time. Please try again." }, 422, origin);
  }

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

  const paymentUrl = new URL(PAYMENT_LINK_URL);
  // Contact-scoped links help GHL attach the order to the right person when possible.
  paymentUrl.searchParams.set("contact_id", contactId);

  return json({
    success: true,
    paymentUrl: paymentUrl.toString(),
    calendarId,
    amountCents: 19000,
  }, 200, origin);
}
