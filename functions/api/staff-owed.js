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
import { parsePacificWallClock } from "../lib/datetime.js";
import { resolveContactCharges, summarizeCharges, classifyCharge, authoritativeCustomerId, makeStripeClient } from "../lib/stripe-charges.js";
import { countBillableSessionsAttended, computeOwedStatus } from "../lib/session-owed.js";
import { isSettled, settledReason } from "../lib/owed-settled.js";
import { listPaymentRecordsForContact } from "../lib/session-payment.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";


export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


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

    // A failed required read is not an empty payment or attendance history.
    if (!contactRes.ok || !apptRes.ok) {
      return new Response(JSON.stringify({
        status: "unavailable",
        reason: "Contact and attendance evidence could not be verified. Try again.",
      }), { status: 200, headers: { ...headers, "Cache-Control": "no-store" } });
    }

    let email = null;
    let name = null;
    if (contactRes.ok) {
      const c = await contactRes.json();
      if (!c?.contact || typeof c.contact !== "object" || Array.isArray(c.contact) || c.contact.id !== contactId) {
        throw new Error("Contact evidence could not be verified");
      }
      email = c.contact?.email || null;
      const fn = (c.contact?.firstName || "").trim();
      const ln = (c.contact?.lastName || "").trim();
      name = [fn, ln].filter(Boolean).join(" ") || c.contact?.name || null;
    }
    let appointments = [];
    if (apptRes.ok) {
      const a = await apptRes.json();
      const rows = a?.appointments ?? a?.events;
      if (!Array.isArray(rows) || rows.some((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return true;
        const status = row.appointmentStatus || row.status;
        const startsAt = row.startTime || row.start_time;
        return typeof row.id !== "string" || !row.id.trim()
          || typeof row.calendarId !== "string" || !row.calendarId.trim()
          || typeof status !== "string" || !status.trim()
          || typeof startsAt !== "string" || !Number.isFinite(parsePacificWallClock(startsAt));
      })) {
        throw new Error("Attendance evidence could not be verified");
      }
      appointments = rows;
    }

    // The stored Stripe customer id (our contact↔customer key) — lets the
    // resolve hit listChargesByCustomer directly, exact + cheap.
    const KV = context.env.PURCHASE_KV;
    const CUST_KEY = `stripe-cust:${contactId}`;
    let storedCustomerId = null;
    if (KV) { try { storedCustomerId = await KV.get(CUST_KEY); } catch { /* fail-soft */ } }

    const stripe = makeStripeClient(stripeKey);
    const charges = await resolveContactCharges(stripe, { contactId, email, customerId: storedCustomerId || undefined });
    const summary = summarizeCharges(charges);

    // Self-populate the contact↔customer key: if we discovered one and it's not
    // stored yet, remember it. Non-blocking — never affects the response.
    if (KV) {
      try {
        // Only persist a customer PROVEN to belong to this contact (a charge
        // tagged with this contactId) — never an email-matched or shared one.
        const discovered = authoritativeCustomerId(charges, contactId);
        if (discovered && discovered !== storedCustomerId) await KV.put(CUST_KEY, discovered);
      } catch { /* fail-soft */ }
    }

    // Clean purchase history for the client page — each charge as date / label /
    // amount, newest first. Reuses the charges we already resolved (no extra call).
    const purchases = charges
      .map((c) => ({
        date: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : null,
        // Net of refunds — parity with totalPaid/owed math (which all use net).
        // A fully-refunded charge is already dropped by keepCharge; a partial
        // refund shows what the client actually kept paying.
        amount: ((c.amount || 0) - (c.amount_refunded || 0)) / 100,
        label: classifyCharge(c).label || c.description || "Payment",
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    // Comps and explicit non-Stripe payments cover only their own appointment.
    // Require complete records; Stripe coverage is counted through charges only.
    const payRecords = await listPaymentRecordsForContact(context.env.PURCHASE_KV, contactId, { strict: true });
    const coveredAppointmentIds = new Set(
      Object.entries(payRecords)
        .filter(([, r]) => r && (r.status === "comped" || (r.status === "paid" && ["cash", "venmo", "check", "other"].includes(r.method))))
        .map(([apptId]) => apptId),
    );
    const attendedBillable = countBillableSessionsAttended(appointments, Date.now(), coveredAppointmentIds);
    // Comps and off-platform payments leave no Stripe trace, so the owed math
    // can't see them and would false-flag these hand-verified clients. A pinned
    // settled override forces 'square' — see lib/owed-settled.js.
    const owed = isSettled(contactId)
      ? { status: "square", shortBy: 0, settled: true, settledReason: settledReason(contactId) }
      : computeOwedStatus({
          sessionsPurchased: summary.sessionsPurchased,
          unknownCount: summary.unknownCount,
          unknownMax: summary.unknownMax,
          attendedBillable,
        });

    const conflictingPaidEvidence = owed.status === "owed" && appointments.some((appointment) => {
      const record = payRecords[appointment.id];
      return record?.status === "paid"
        && !["cash", "venmo", "check", "other"].includes(record.method)
        && countBillableSessionsAttended([appointment], Date.now()) > 0;
    });
    if (conflictingPaidEvidence) {
      return new Response(JSON.stringify({
        status: "unavailable",
        reason: "A session is recorded as paid, but its payment coverage could not be reconciled. Review the payment evidence.",
      }), { status: 200, headers: { ...headers, "Cache-Control": "no-store" } });
    }

    return new Response(JSON.stringify({
      ...owed,
      name,
      purchases,
      totalPaid: summary.totalPaid,
      sessionsPurchased: summary.sessionsPurchased,
      attendedBillable,
      unknownCount: summary.unknownCount,
      chargeCount: charges.length,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-owed] error:", err);
    return new Response(JSON.stringify({ status: "unavailable", reason: "Payment and attendance evidence could not be verified. Try again." }), { status: 200, headers: { ...headers, "Cache-Control": "no-store" } });
  }
}
