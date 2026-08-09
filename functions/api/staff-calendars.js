import { corsHeaders, requireStaffAuth } from "../lib/endpoint-guards.js";
import { listStaffCalendarDefinitions } from "../lib/staff-calendar-catalog.js";

const METHODS = "GET, OPTIONS";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), METHODS),
  });
}

export async function onRequestGet(context) {
  const headers = {
    ...corsHeaders(context.request.headers.get("Origin"), METHODS),
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  };
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  return new Response(JSON.stringify(listStaffCalendarDefinitions()), { status: 200, headers });
}
