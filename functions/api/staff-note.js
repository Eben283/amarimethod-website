// Cloudflare Pages Function: retired POST/PUT /api/staff-note boundary.
// Provider notes remain readable in Member Record, but all Staff-authored note
// writes now belong to the provider-neutral CRM Client Desk.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";

import { retiredStaffNoteResponse } from "../lib/staff-note-retirement.js";
export { RETIRED_STAFF_NOTE, retiredStaffNoteResponse } from "../lib/staff-note-retirement.js";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), "POST, PUT, OPTIONS"),
  });
}

async function rejectRetiredStaffNote(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
  const { error } = await requireStaffAuth(context, headers);
  return error || retiredStaffNoteResponse(headers);
}

export const onRequestPost = rejectRetiredStaffNote;
export const onRequestPut = rejectRetiredStaffNote;
