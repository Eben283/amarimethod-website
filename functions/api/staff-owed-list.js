// Cloudflare Pages Function: GET /api/staff-owed-list
// Lightweight ACTIVE-CLIENT ROSTER for the owed overview — people who've
// attended a series session in the last ~18 months (about a dozen).
//
// This endpoint does NOT resolve Stripe (that's expensive per client and the
// whole roster won't fit in one request's subrequest budget). It only scans the
// 6 series calendars once (~6 subrequests) to return each client's id, name,
// and attended-session count. The Balances page then resolves each client's
// owed status through /api/staff-owed (the accurate, email-grounded per-client
// endpoint) as separate requests — each within its own budget. Read-only.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { SERIES_CALENDAR_IDS } from "../lib/session-ledger.js";
import { clientNameFromTitle } from "../lib/owed-list.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const ROSTER_WINDOW_DAYS = 540; // ~18 months
const ATTENDED = new Set(["showed", "completed"]);

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

    const now = Date.now();
    const since = now - ROSTER_WINDOW_DAYS * 24 * 3600 * 1000;

    const byContact = new Map(); // contactId -> { name, attended, lastMs }
    for (const calId of SERIES_CALENDAR_IDS) {
      const res = await ghlFetch(context, `${GHL_API_BASE}/calendars/events?calendarId=${calId}&startTime=${since}&endTime=${now}`);
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || data.appointments || [];
      for (const e of events) {
        const cid = e.contactId;
        if (!cid) continue;
        const startMs = new Date(e.startTime || e.start_time || 0).getTime();
        const status = (e.appointmentStatus || e.status || "").toLowerCase();
        const cur = byContact.get(cid) || { name: null, attended: 0, lastMs: 0 };
        if (ATTENDED.has(status) && Number.isFinite(startMs) && startMs < now) cur.attended += 1;
        if (Number.isFinite(startMs) && startMs > cur.lastMs) cur.lastMs = startMs;
        if (!cur.name) cur.name = clientNameFromTitle(e.title);
        byContact.set(cid, cur);
      }
    }

    const roster = [...byContact.entries()]
      .filter(([, v]) => v.attended > 0)
      .sort((a, b) => b[1].lastMs - a[1].lastMs)
      .map(([contactId, v]) => ({ contactId, name: v.name || contactId, attendedBillable: v.attended, lastSessionMs: v.lastMs }));

    return new Response(JSON.stringify({ roster, rosterSize: roster.length, windowDays: ROSTER_WINDOW_DAYS }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-owed-list] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
