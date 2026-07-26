// GET /api/staff-community — field relationships captured through COS.
// Google Maps remains the prospect universe; this endpoint starts at the first
// real in-person interaction and returns the durable relationship records.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { listFieldPartners } from "../lib/cos-field-visits.js";

const STAGE_RANK = { host: 1, engaged_host: 2, partner: 3, workshop_opportunity: 4 };

function identity(partner) {
  return `${String(partner.business_name || "").trim().toLowerCase()}|${String(partner.location || "").trim().toLowerCase()}`;
}

function preferred(a, b) {
  return String(a.latest_visit_at || "").localeCompare(String(b.latest_visit_at || "")) >= 0 ? a : b;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestGet(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin")), "Content-Type": "application/json" };
  try {
    const { error, payload } = await requireStaffAuth(context, headers);
    if (error) return error;

    // COS historically stored field records under its dedicated Eben identity;
    // the embedded Staff COS may store them under Staff. Read both so the board
    // is continuous while capture moves between those surfaces.
    const users = [...new Set([payload.user, "Eben", "Staff"].filter(Boolean))];
    const lists = await Promise.all(users.map((user) => listFieldPartners(context.env.PORTAL_KV, user, { limit: 500 })));
    const merged = new Map();
    for (const partners of lists) {
      for (const partner of partners) {
        const key = identity(partner);
        const current = merged.get(key);
        if (!current) {
          merged.set(key, partner);
          continue;
        }
        const latest = preferred(current, partner);
        const earlier = latest === current ? partner : current;
        merged.set(key, {
          ...earlier,
          ...latest,
          relationship_stage: STAGE_RANK[latest.relationship_stage] >= STAGE_RANK[earlier.relationship_stage] ? latest.relationship_stage : earlier.relationship_stage,
          workshop_signal: Boolean(latest.workshop_signal || earlier.workshop_signal),
          visit_count: (latest.visit_count || 0) + (earlier.visit_count || 0),
          contact: latest.contact || earlier.contact || null,
          next_visit_on: latest.next_visit_on || earlier.next_visit_on || null,
          event_on: latest.event_on || earlier.event_on || null,
          event_title: latest.event_title || earlier.event_title || null,
          event_details: latest.event_details || earlier.event_details || null,
          image_keys: [...new Set([...(latest.image_keys || []), ...(earlier.image_keys || [])])],
        });
      }
    }

    const partners = [...merged.values()]
      .sort((a, b) => String(a.next_visit_on || "9999-12-31").localeCompare(String(b.next_visit_on || "9999-12-31")) || String(b.latest_visit_at || "").localeCompare(String(a.latest_visit_at || "")));
    return new Response(JSON.stringify({ partners: partners.map((partner) => ({
      ...partner,
      image_count: Array.isArray(partner.image_keys) ? partner.image_keys.length : 0,
      // The keys are internal implementation detail; photos load through the
      // dedicated Staff-authenticated endpoint only when a card is opened.
      image_keys: undefined,
    })) }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-community]", err);
    return new Response(JSON.stringify({ error: "Could not load community relationships" }), { status: 500, headers });
  }
}
