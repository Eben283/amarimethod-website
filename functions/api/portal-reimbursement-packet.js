// Cloudflare Pages Function: GET /api/portal-reimbursement-packet
// Returns a print-ready HTML document the client can save as a PDF: a cover
// letter, a Letter of Medical Services, and their itemized paid invoices.
// Mirrors the manual packet format (see Blumrich packet). v1 renders to PDF via
// the browser's print/save. Forward-compatible with Cloudflare Browser
// Rendering later — the HTML this returns is the same input.
//
// Auth + data patterns copied from portal-data.js. HTML template lives in
// ../lib/reimbursement-template.js so it can be previewed/tested standalone.

import { ghlHeaders, getGhlToken } from "../lib/ghl.js";
import { requireOwner } from "../lib/owned-access.js";
import { renderPacket, formatDate, formatPhone } from "../lib/reimbursement-template.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// A paid invoice = status "paid" OR money actually received. GHL marks fully
// paid invoices status="paid" (confirmed against live data 2026-06-08); the
// amountPaid>=total clause is a guard in case the status string ever differs.
function isPaid(inv) {
  const status = String(inv.status || "").toLowerCase();
  const paid = Number(inv.amountPaid) || 0;
  const total = Number(inv.total) || 0;
  return status === "paid" || (paid > 0 && paid >= total);
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const baseHeaders = corsHeaders(origin);

  const jsonError = (status, message) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...baseHeaders, "Content-Type": "application/json" },
    });

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    const GHL_API_KEY = await getGhlToken(context);
    if (!JWT_SECRET || !GHL_API_KEY) {
      console.error("[reimbursement-packet] Missing env vars");
      return jsonError(500, "Server configuration error");
    }

    // Ownership gate: Bearer + verify + per-contact revoke, centralized in
    // lib/owned-access.js. contactId comes from the verified JWT, never the
    // request — the invoices fetched below are only ever the caller's own. The
    // gate's error body matches jsonError's shape (same headers + JSON error).
    const gate = await requireOwner(context, {
      ...baseHeaders,
      "Content-Type": "application/json",
    });
    if (gate.error) return gate.error;
    const { contactId } = gate;

    const [contactResponse, invoicesResponse] = await Promise.all([
      fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        headers: ghlHeaders(GHL_API_KEY),
      }),
      fetch(
        `${GHL_API_BASE}/invoices/?altId=${GHL_LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`,
        { headers: ghlHeaders(GHL_API_KEY) },
      ),
    ]);

    if (!contactResponse.ok) {
      console.error(`[reimbursement-packet] contact fetch ${contactResponse.status}`);
      return jsonError(422, "Unable to load your data. Please try again.");
    }
    const contact = (await contactResponse.json()).contact || {};

    let invoices = [];
    if (invoicesResponse.ok) {
      invoices = (await invoicesResponse.json()).invoices || [];
    }

    // Optional date-range filter (?from=YYYY-MM-DD&to=YYYY-MM-DD) so the client
    // generates a packet for just the period they're claiming.
    const url = new URL(context.request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const fromMs = fromParam ? Date.parse(`${fromParam}T00:00:00Z`) : NaN;
    const toMs = toParam ? Date.parse(`${toParam}T23:59:59.999Z`) : NaN;

    const paidInvoices = invoices
      .filter(isPaid)
      .filter((inv) => {
        const t = new Date(inv.issueDate).getTime();
        if (!Number.isNaN(fromMs) && t < fromMs) return false;
        if (!Number.isNaN(toMs) && t > toMs) return false;
        return true;
      })
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

    if (paidInvoices.length === 0) {
      return jsonError(
        422,
        fromParam || toParam
          ? "No paid sessions found in that date range. Try widening the dates."
          : "No paid sessions found yet. Once you've paid for a session, your reimbursement packet will be available here.",
      );
    }

    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
    const patientName =
      `${cap(contact.firstName || "")} ${cap(contact.lastName || "")}`.trim() || "Patient";
    const patientPhone = formatPhone(contact.phone);
    const datesOfService = paidInvoices.map((inv) => formatDate(inv.issueDate)).filter(Boolean);
    const today = formatDate(new Date().toISOString());

    const html = renderPacket({ patientName, patientPhone, datesOfService, paidInvoices, today });

    return new Response(html, {
      status: 200,
      headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("[reimbursement-packet] Unexpected error:", err);
    return jsonError(500, "Internal server error");
  }
}
