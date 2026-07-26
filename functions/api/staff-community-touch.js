// POST /api/staff-community-touch — log one real follow-up to a community relationship.
// This intentionally writes to the same COS field-visit record used on the road;
// Community is a useful relationship desk, not a second system of record.

import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { listFieldPartners, recordFieldVisit } from "../lib/cos-field-visits.js";

const STAGES = new Set(["host", "engaged_host", "partner", "workshop_opportunity"]);

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function date(value) {
  const valueText = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : "";
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin"), "POST, OPTIONS") });
}

export async function onRequestPost(context) {
  const headers = { ...corsHeaders(context.request.headers.get("Origin"), "POST, OPTIONS"), "Content-Type": "application/json" };
  try {
    const { error, payload } = await requireStaffAuth(context, headers);
    if (error) return error;
    const { body, error: bodyError } = await parseJsonBody(context.request, headers);
    if (bodyError) return bodyError;

    const relationship = body.relationship && typeof body.relationship === "object" ? body.relationship : {};
    const businessName = text(relationship.business_name, 180);
    const relationshipId = text(relationship.id, 300);
    const notes = text(body.notes, 2000);
    if (!businessName) return new Response(JSON.stringify({ error: "Business name required" }), { status: 400, headers });
    if (!notes) return new Response(JSON.stringify({ error: "A short touch note is required" }), { status: 400, headers });

    const requestedStage = text(body.relationship_stage, 80);
    const stage = STAGES.has(requestedStage) ? requestedStage : "host";
    // Existing relationships may have begun in the standalone COS under Eben.
    // Update that same owner record when possible so notes and card photos stay
    // attached to one relationship instead of creating a shadow Staff record.
    const users = [...new Set([payload.user, "Eben", "Staff"].filter(Boolean))];
    const ownerLists = await Promise.all(users.map(async (user) => ({ user, partners: await listFieldPartners(context.env.PORTAL_KV, user, { limit: 500 }) })));
    const owner = ownerLists.find(({ partners }) => partners.some((partner) => partner.id === relationshipId))?.user || payload.user || "Staff";
    const { partner } = await recordFieldVisit(context.env.PORTAL_KV, owner, {
      business_name: businessName,
      location: text(relationship.location, 280),
      study: text(relationship.study, 160),
      flyer_location: text(relationship.flyer_location, 280),
      contact: relationship.contact && typeof relationship.contact === "object" ? relationship.contact : {},
      relationship_stage: stage,
      workshop_signal: Boolean(body.workshop_signal),
      notes,
      next_visit_on: date(body.next_visit_on),
      event_on: date(body.event_on),
      event_title: text(body.event_title, 240),
      event_details: text(body.event_details, 1200),
    });
    return new Response(JSON.stringify({ partner: { ...partner, image_keys: undefined } }), { status: 200, headers });
  } catch (err) {
    console.error("[staff-community-touch]", err);
    return new Response(JSON.stringify({ error: "Could not save this relationship touch" }), { status: 500, headers });
  }
}
