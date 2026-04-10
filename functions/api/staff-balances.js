// Cloudflare Pages Function: GET /api/staff-balances
// Returns every contact with an outstanding prepaid session balance.
// Source-of-truth calculation lives in functions/lib/session-ledger.js
// (built by concurrent session). This endpoint uses it when available and
// falls back to reading custom fields directly.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { getCustomField } from "./portal-data.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_LOCATION_ID = "7pIO7FHVAyBT1jKGhfQM";
const CACHE_KEY = "staff:balances:v1";
const CACHE_TTL_SECONDS = 300;
const MAX_CONTACT_PAGES = 10;
const PAGE_SIZE = 100;

const ALLOWED_ORIGINS = [
  "https://www.amarimethod.com",
  "https://amarimethod.com",
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin")),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    const JWT_SECRET = context.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers });
    }

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
    const forceRefresh = url.searchParams.get("refresh") === "1";

    // KV cache
    if (!forceRefresh && context.env.PORTAL_KV) {
      try {
        const cached = await context.env.PORTAL_KV.get(CACHE_KEY);
        if (cached) {
          return new Response(cached, { status: 200, headers: { ...headers, "X-Cache": "HIT" } });
        }
      } catch (err) {
        console.error(`[staff-balances] KV read error: ${err.message}`);
      }
    }

    // Load custom field definitions once
    const fieldDefsRes = await ghlFetch(context, `${GHL_API_BASE}/locations/${GHL_LOCATION_ID}/customFields`);
    const fieldDefs = {};
    if (fieldDefsRes.ok) {
      const fieldDefsData = await fieldDefsRes.json();
      for (const f of (fieldDefsData.customFields || [])) {
        const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
        if (shortKey) fieldDefs[shortKey] = f.id;
      }
    }

    // Attempt to load shared session ledger (built by concurrent session).
    // If missing, we gracefully fall back to inline custom-field reads.
    let computeLedger = null;
    try {
      const mod = await import("../lib/session-ledger.js");
      computeLedger = mod.computeSessionLedger || mod.default || null;
    } catch {
      computeLedger = null;
    }

    // Paginate through contacts via POST /contacts/search
    const allContacts = [];
    let page = 1;
    while (page <= MAX_CONTACT_PAGES) {
      const searchRes = await ghlFetch(context, `${GHL_API_BASE}/contacts/search`, {
        method: "POST",
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          pageLimit: PAGE_SIZE,
          page,
        }),
      });

      if (!searchRes.ok) {
        console.error(`[staff-balances] contacts/search page ${page} error: ${searchRes.status}`);
        break;
      }

      const data = await searchRes.json();
      const pageContacts = data.contacts || [];
      if (pageContacts.length === 0) break;
      allContacts.push(...pageContacts);
      if (pageContacts.length < PAGE_SIZE) break;
      page += 1;
    }

    // Client-side filter: only contacts with any kind of prepaid balance
    const candidates = allContacts.filter((c) => {
      const seriesType = (getCustomField(c, "series_type", fieldDefs) || "none").toLowerCase();
      const remaining = parseInt(getCustomField(c, "sessions_remaining", fieldDefs) ?? "0", 10);
      const prepaidOverride = (getCustomField(c, "session_prepaid", fieldDefs) || "").toLowerCase() === "yes";
      return seriesType !== "none" || remaining > 0 || prepaidOverride;
    });

    // Enrich each candidate with ledger data
    const rows = await Promise.all(
      candidates.map(async (c) => {
        const capitalize = (s) =>
          s ? s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") : "";
        const firstName = capitalize(c.firstName || "");
        const lastName = capitalize(c.lastName || "");
        const name = [firstName, lastName].filter(Boolean).join(" ") || c.email || "Unknown";

        const fallbackSeriesType = getCustomField(c, "series_type", fieldDefs) || "none";
        const fallbackRemaining = parseInt(getCustomField(c, "sessions_remaining", fieldDefs) ?? "0", 10);
        const fallbackCompleted = parseInt(getCustomField(c, "sessions_completed", fieldDefs) ?? "0", 10);
        const fallbackPrepaidOverride = (getCustomField(c, "session_prepaid", fieldDefs) || "").toLowerCase() === "yes";

        let ledger = {
          seriesType: fallbackSeriesType,
          purchased: null,
          attended: fallbackCompleted,
          remaining: fallbackRemaining,
          lastSessionDate: null,
          source: "custom-field",
          confidence: "low",
          ambiguities: ["session-ledger not available — reading custom fields directly"],
          prepaidOverride: fallbackPrepaidOverride,
        };

        if (computeLedger) {
          try {
            const computed = await computeLedger(context, c.id, { fieldDefs });
            if (computed) {
              ledger = { ...ledger, ...computed };
            }
          } catch (err) {
            console.error(`[staff-balances] ledger error for ${c.id}: ${err.message}`);
            ledger.ambiguities = [...ledger.ambiguities, `ledger error: ${err.message}`];
          }
        }

        return {
          id: c.id,
          name,
          email: c.email || "",
          phone: c.phone || "",
          seriesType: ledger.seriesType,
          purchased: ledger.purchased,
          attended: ledger.attended,
          remaining: ledger.remaining,
          lastSessionDate: ledger.lastSessionDate,
          prepaidOverride: ledger.prepaidOverride,
          source: ledger.source,
          confidence: ledger.confidence,
          ambiguities: ledger.ambiguities,
        };
      })
    );

    // Sort: highest remaining first, then most recent session
    const sorted = [...rows].sort((a, b) => {
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      const aDate = a.lastSessionDate ? new Date(a.lastSessionDate).getTime() : 0;
      const bDate = b.lastSessionDate ? new Date(b.lastSessionDate).getTime() : 0;
      return bDate - aDate;
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      count: sorted.length,
      totalRemaining: sorted.reduce((sum, r) => sum + (r.remaining || 0), 0),
      ledgerSource: computeLedger ? "session-ledger" : "custom-field-fallback",
      rows: sorted,
    };

    const body = JSON.stringify(payload);

    if (context.env.PORTAL_KV) {
      try {
        await context.env.PORTAL_KV.put(CACHE_KEY, body, { expirationTtl: CACHE_TTL_SECONDS });
      } catch (err) {
        console.error(`[staff-balances] KV write error: ${err.message}`);
      }
    }

    return new Response(body, { status: 200, headers: { ...headers, "X-Cache": "MISS" } });
  } catch (err) {
    console.error("[staff-balances] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
}
