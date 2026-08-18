// Compatibility surface for cached pre-cutover study bookers.
//
// GET remains available so a stale page can render its calendar. POST is
// deliberately non-mutating: the richer single-entry contract lives only at
// /api/study-book-v2, so an atomic rollback makes a new open tab fail closed.
export { onRequestGet, onRequestOptions } from "./study-book-v2.js";

const ORIGINS = new Set(["https://www.amarimethod.com", "https://amarimethod.com"]);

function responseHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://www.amarimethod.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export async function onRequestPost({ request }) {
  const origin = request.headers.get("Origin") || "";
  return new Response(JSON.stringify({
    error: "Study booking now includes choosing the study and qualifications in one entry. Refresh this page.",
    bookingUrl: "/book/study",
    refreshRequired: true,
  }), {
    status: 409,
    headers: responseHeaders(origin),
  });
}
