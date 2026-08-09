// Staff automations read API (DASHBOARD-PLAN v1 backend) — the per-contact automation
// timeline and the failures table, read from the shared amari-automation D1 spine.
//
//   GET /api/staff-automations?view=activity[&sinceHours=48]   — today/yesterday feed, all contacts
//   GET /api/staff-automations?view=contact&contactId=<id>
//   GET /api/staff-automations?view=failures[&sinceHours=168]
//   GET /api/staff-automations?view=registry
//   GET /api/staff-automations?view=automation&engine=<reminder|nurture>&key=<key>
//
// Staff-JWT gated like every staff endpoint. Read-only: no writes, no GHL calls. Until the
// shared D1 exists (AUTOMATION_DB binding), returns 200 { configured: false } so the future
// staff tab can render an honest empty state instead of erroring.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import {
  contactAutomationView,
  failuresView,
  activityView,
  automationExecutionView,
  automationFamilyExecutionView,
} from "../lib/automation-views.js";
import {
  REGISTRY_VERSION,
  automationDefinitions,
  findAutomationDefinition,
  registryEvidence,
} from "../lib/automation-registry.js";
import {
  automationFamilies,
  automationFamily,
  automationInventorySummary,
  familyRegistryEvidence,
} from "../lib/automation-families.js";

const VALID_CONTACT_ID = /^[A-Za-z0-9]{1,50}$/;
const VALID_AUTOMATION_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VALID_FAMILY_KEY = VALID_AUTOMATION_KEY;
const VALID_ENGINES = new Set(["reminder", "nurture"]);
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

  const url = new URL(context.request.url);
  const view = url.searchParams.get("view");
  const db = context.env.AUTOMATION_DB;
  const evidence = registryEvidence({ executionStoreConfigured: !!db });
  const familyEvidence = familyRegistryEvidence();

  try {
    if (view === "registry") {
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        definitions: automationDefinitions(),
        evidence,
      }), { status: 200, headers });
    }

    if (view === "families") {
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        summary: automationInventorySummary(),
        families: automationFamilies(),
        evidence: {
          ...evidence,
          gaps: [...familyEvidence.gaps, ...evidence.gaps],
        },
      }), { status: 200, headers });
    }

    if (view === "family") {
      const key = (url.searchParams.get("key") || "").trim();
      if (!VALID_FAMILY_KEY.test(key)) {
        return new Response(JSON.stringify({ error: "Invalid automation family key" }), { status: 400, headers });
      }
      const family = automationFamily(key);
      if (!family) {
        return new Response(JSON.stringify({ error: "Automation family not found" }), { status: 404, headers });
      }
      const execution = db
        ? await automationFamilyExecutionView(db, family)
        : { enrollments: [], events: [], coverage: { enrollmentsTruncated: false, eventsTruncated: false } };
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        family,
        ...execution,
        evidence: {
          ...evidence,
          gaps: [...family.evidence.gaps, ...evidence.gaps],
        },
      }), { status: 200, headers });
    }

    if (view === "automation") {
      const engine = (url.searchParams.get("engine") || "").trim();
      const key = (url.searchParams.get("key") || "").trim();
      if (!VALID_ENGINES.has(engine) || !VALID_AUTOMATION_KEY.test(key)) {
        return new Response(JSON.stringify({ error: "Invalid automation engine or key" }), { status: 400, headers });
      }
      const definition = findAutomationDefinition(engine, key);
      if (!definition) {
        return new Response(JSON.stringify({ error: "Automation definition not found" }), { status: 404, headers });
      }
      const execution = db
        ? await automationExecutionView(db, { engine, key })
        : { enrollments: [], events: [], coverage: { enrollmentsTruncated: false, eventsTruncated: false } };
      return new Response(JSON.stringify({
        success: true,
        configured: !!db,
        registryVersion: REGISTRY_VERSION,
        definition,
        ...execution,
        evidence,
      }), { status: 200, headers });
    }

    if (view === "contact") {
      const contactId = (url.searchParams.get("contactId") || "").trim();
      if (!VALID_CONTACT_ID.test(contactId)) {
        return new Response(JSON.stringify({ error: "Invalid contactId" }), { status: 400, headers });
      }
      if (!db) {
        return new Response(JSON.stringify({
          success: true,
          configured: false,
          contactId,
          enrollments: [],
          events: [],
          upgradeOffer: null,
          confirmations: [],
          lpOnboarding: null,
          coverage: { eventLimit: 200, eventsTruncated: false },
          evidence,
        }), { status: 200, headers });
      }
      const data = await contactAutomationView(db, contactId);
      return new Response(JSON.stringify({ success: true, configured: true, ...data, evidence }), { status: 200, headers });
    }

    if (view === "activity") {
      const sinceHours = windowHours(url, DEFAULT_ACTIVITY_WINDOW_HOURS);
      const events = db ? await activityView(db, { sinceMs: Date.now() - sinceHours * 3600000 }) : [];
      return new Response(JSON.stringify({ success: true, configured: !!db, sinceHours, events, evidence }), { status: 200, headers });
    }

    if (view === "failures") {
      const sinceHours = windowHours(url, DEFAULT_FAILURE_WINDOW_HOURS);
      const failures = db ? await failuresView(db, { sinceMs: Date.now() - sinceHours * 3600000 }) : [];
      return new Response(JSON.stringify({ success: true, configured: !!db, sinceHours, failures, evidence }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Unknown view (use families, family, registry, automation, activity, contact, or failures)" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Query failed: ${String((err && err.message) || err)}` }), { status: 500, headers });
  }
}
