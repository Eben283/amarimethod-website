// Cloudflare Pages Function: GET /api/staff-owed?contactId=
// Owed status for ONE contact: does this client owe for sessions they've taken?
//
// Compares billable sessions attended (series-calendar visits, comps excluded)
// against sessions paid for, derived from STRIPE (the complete money record) —
// see functions/lib/stripe-charges.js + session-owed.js. Read-only; never duns.
//
// Deliberately single-contact + its own endpoint so the Stripe calls don't pile
// onto the already-heavy staff-contact request. The client page lazy-loads this.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { resolveContactCharges, summarizeCharges, makeStripeClient } from "../lib/stripe-charges.js";
import { countBillableSessionsAttended, computeOwedStatus } from "../lib/session-owed.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

const ALLOWED_ORIGINS = ["https://www.amarimethod.com", "https://amarimethod.com"];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });

    const authHeader = context.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers });
    }
    let tokenPayload;
    try {
      tokenPayload = await verifySessionToken(authHeader.slice(7), JWT_SECRET);
    } catch {
      return new Response(JSON.stringify({ error: "Session expired" }), { status: 401, headers });
    }
    if (tokenPayload.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
    }

    const url = new URL(context.request.url);
    const contactId = (url.searchParams.get("contactId") || "").trim();
    if (!contactId) return new Response(JSON.stringify({ error: "contactId required" }), { status: 400, headers });

    const stripeKey = context.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // No Stripe configured → can't ground owed; report unknown rather than guess.
      return new Response(JSON.stringify({ status: "unavailable", reason: "Stripe not configured" }), { status: 200, headers });
    }

    // Contact (for email fallback) + appointments, in parallel.
    const [contactRes, apptRes] = await Promise.all([
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}`),
      ghlFetch(context, `${GHL_API_BASE}/contacts/${contactId}/appointments`),
    ]);

    let email = null;
    let name = null;
    if (contactRes.ok) {
      const c = await contactRes.json();
      email = c.contact?.email || null;
      const fn = (c.contact?.firstName || "").trim();
      const ln = (c.contact?.lastName || "").trim();
      name = [fn, ln].filter(Boolean).join(" ") || c.contact?.name || null;
    }
    let appointments = [];
    if (apptRes.ok) {
      const a = await apptRes.json();
      appointments = a.appointments || a.events || [];
    }

    const stripe = makeStripeClient(stripeKey);
    const charges = await resolveContactCharges(stripe, { contactId, email });
    const summary = summarizeCharges(charges);
    const attendedBillable = countBillableSessionsAttended(appointments);
    const owed = computeOwedStatus({
      sessionsPurchased: summary.sessionsPurchased,
      unknownCount: summary.unknownCount,
      attendedBillable,
    });

    return new Response(JSON.stringify({
      ...owed,
      name,
      totalPaid: summary.totalPaid,
      sessionsPurchased: summary.sessionsPurchased,
      attendedBillable,
      unknownCount: summary.unknownCount,
      chargeCount: charges.length,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-owed] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
