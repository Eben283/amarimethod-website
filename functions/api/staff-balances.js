// Cloudflare Pages Function: GET /api/staff-balances
// Returns every contact with an outstanding prepaid session balance.
// Source-of-truth calculation lives in functions/lib/session-ledger.js
// (built by concurrent session). This endpoint uses it when available and
// falls back to reading custom fields directly.

import { ghlFetch } from "../lib/ghl.js";
import { verifySessionToken } from "../lib/auth.js";
import { requireOpsReadKey } from "../lib/ops-auth.js";
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

    // Internal service calls (e.g. /day skill) may authenticate with the ops read key
    // instead of a staff JWT — same key used by /api/daily-audit and /api/ecosystem-scan.
    const hasServiceKey = !!context.request.headers.get("X-Service-Key");
    if (hasServiceKey) {
      const denied = requireOpsReadKey(context.request, context.env);
      if (denied) return denied;
    } else {
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

    // Enrich each candidate with ledger data.
    // Concurrency 2 (was 5) — each candidate triggers 4 base GHL fetches
    // PLUS hydrateOrders fan-out (~5 more per contact for POS orders).
    // At 5 contacts × 9 calls = 45 concurrent outbound to GHL, which
    // exceeds Cloudflare's per-Worker connection limit (~6) and produced
    // "Response closed due to connection limit" / "Too many subrequests"
    // errors that cached for the full 5-min TTL. 2026-06-03 incident.
    // Wall time tradeoff: ~30s for 7 contacts vs the previous ~10s, but
    // cached for 5 min so users only feel it on cache miss.
    const CONCURRENCY = 2;
    const rows = [];

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (c) => {
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
              // Only adopt the computed ledger when it actually has source
              // data behind it. computeSessionLedger's error paths return
              // emptyLedger() which has source="empty" — spreading that
              // over the field-based fallback would destroy correct values
              // (2026-06-03 incident: transient GHL hiccup at 13:17 UTC
              // produced empty results for every contact, which then
              // overwrote correct field values and cached zeros for 30+
              // minutes). When computed.source==="empty", keep the
              // field-based fallback and surface the error as ambiguity
              // so the briefing can flag it.
              if (computed && computed.source !== "empty") {
                ledger = { ...ledger, ...computed };
              } else if (computed && computed.source === "empty") {
                ledger.ambiguities = [
                  ...ledger.ambiguities,
                  ...(computed.ambiguities || ["ledger compute returned empty"]),
                ];
              }
            } catch (err) {
              console.error(`[staff-balances] ledger error for ${c.id}: ${err.message}`);
              ledger.ambiguities = [...ledger.ambiguities, `ledger error: ${err.message}`];
            }
          }

          // Display values from deriveLedger — falls back to field on
          // lock or low confidence. See session-ledger.js display block.
          // Fallback chain if .display is missing (e.g. session-ledger
          // import failed and fallback ledger above is in play).
          const displaySeriesType = ledger.display?.seriesType ?? fallbackSeriesType;
          const displayRemaining = ledger.display?.remaining ?? fallbackRemaining;
          // attended is the back-computed display value so the
          // BalancesPage "N/X" text stays consistent with the
          // "remaining" column (the same display.attended portal-data.js
          // exposes for the progress bar). Falls back to derived when
          // display is unavailable.
          const displayAttended = ledger.display?.attended ?? ledger.attended;

          return {
            id: c.id,
            name,
            email: c.email || "",
            phone: c.phone || "",
            seriesType: displaySeriesType,
            purchased: ledger.purchased,
            attended: displayAttended,
            remaining: displayRemaining,
            lastSessionDate: ledger.lastSessionDate,
            prepaidOverride: ledger.prepaidOverride,
            source: ledger.source,
            displaySource: ledger.display?.source,
            confidence: ledger.confidence,
            ambiguities: ledger.ambiguities,
            manualLock: ledger.manualLock,
          };
        })
      );
      rows.push(...chunkResults);
    }

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
