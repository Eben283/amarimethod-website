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
import { parsePacificWallClock } from "../lib/datetime.js";
import { SERIES_CALENDAR_IDS } from "../lib/session-ledger.js";
import { clientNameFromTitle } from "../lib/owed-list.js";
import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const ROSTER_WINDOW_DAYS = 540; // ~18 months
const ATTENDED = new Set(["showed", "completed"]);


export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { error, payload: tokenPayload } = await requireStaffAuth(context, headers);
    if (error) return error;


    const now = Date.now();
    const since = now - ROSTER_WINDOW_DAYS * 24 * 3600 * 1000;

    const byContact = new Map(); // contactId -> { name, attended, lastMs }
    for (const calId of SERIES_CALENDAR_IDS) {
      // GHL v2 /calendars/events REQUIRES locationId (matches staff-data.js) —
      // without it the request fails and the roster comes back empty.
      const params = new URLSearchParams({
        locationId: GHL_LOCATION_ID,
        calendarId: calId,
        startTime: String(since),
        endTime: String(now),
      });
      const res = await ghlFetch(context, `${GHL_API_BASE}/calendars/events?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || data.appointments || [];
      for (const e of events) {
        const cid = e.contactId;
        if (!cid) continue;
        // Naive-Pacific parse (2026-07-02 audit) — raw UTC parse shifted
        // same-day sessions into the past from ~8am PT.
        const startMs = parsePacificWallClock(e.startTime || e.start_time || "");
        const status = (e.appointmentStatus || e.status || "").toLowerCase();
        const cur = byContact.get(cid) || { name: null, attended: 0, lastMs: 0 };
        // A roster's "last session" must be a completed, past visit. Future
        // bookings and cancellations are not session history and would put a
        // member in the wrong position in the default Staff list.
        if (ATTENDED.has(status) && Number.isFinite(startMs) && startMs < now) {
          cur.attended += 1;
          if (startMs > cur.lastMs) cur.lastMs = startMs;
        }
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
