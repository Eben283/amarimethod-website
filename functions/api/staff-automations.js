// Staff automations read API (DASHBOARD-PLAN v1 backend) — the per-contact automation
// timeline and the failures table, read from the shared amari-automation D1 spine.
//
//   GET /api/staff-automations?view=activity[&sinceHours=48]   — today/yesterday feed, all contacts
//   GET /api/staff-automations?view=contact&contactId=<id>
//   GET /api/staff-automations?view=failures[&sinceHours=168]
//
// Staff-JWT gated like every staff endpoint. Read-only: no writes, no GHL calls. Until the
// shared D1 exists (AUTOMATION_DB binding), returns 200 { configured: false } so the future
// staff tab can render an honest empty state instead of erroring.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { contactAutomationView, failuresView, activityView } from "../lib/automation-views.js";

const VALID_CONTACT_ID = /^[A-Za-z0-9]{1,50}$/;
const DEFAULT_FAILURE_WINDOW_HOURS = 168; // one week
const DEFAULT_ACTIVITY_WINDOW_HOURS = 48; // today + yesterday

function windowHours(url, fallback) {
  return Math.min(
    Math.max(parseInt(url.searchParams.get("sinceHours") || String(fallback), 10) || fallback, 1),
    24 * 90,
  );
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS") });
}

export async function onRequestGet(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), "GET, OPTIONS"),
    "Content-Type": "application/json",
  };

  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const db = context.env.AUTOMATION_DB;
  if (!db) {
    return new Response(JSON.stringify({ success: true, configured: false }), { status: 200, headers });
  }

  const url = new URL(context.request.url);
  const view = url.searchParams.get("view");

  try {
    if (view === "contact") {
      const contactId = (url.searchParams.get("contactId") || "").trim();
      if (!VALID_CONTACT_ID.test(contactId)) {
        return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
      }
      const data = await contactAutomationView(db, contactId);
      return new Response(JSON.stringify({ success: true, configured: true, ...data }), { status: 200, headers });
    }

    if (view === "activity") {
      const sinceHours = windowHours(url, DEFAULT_ACTIVITY_WINDOW_HOURS);
      const events = await activityView(db, { sinceMs: Date.now() - sinceHours * 3600000 });
      return new Response(JSON.stringify({ success: true, configured: true, sinceHours, events }), { status: 200, headers });
    }

    if (view === "failures") {
      const sinceHours = windowHours(url, DEFAULT_FAILURE_WINDOW_HOURS);
      const failures = await failuresView(db, { sinceMs: Date.now() - sinceHours * 3600000 });
      return new Response(JSON.stringify({ success: true, configured: true, sinceHours, failures }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown view (use activity, contact, or failures)" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Query failed: ${String((err && err.message) || err)}` }), { status: 500, headers });
  }
}
