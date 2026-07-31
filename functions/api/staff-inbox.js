// GET /api/staff-inbox — Staff Conversations list/thread from conversation-cache KV.
// No live GHL on open. Optional ?contactId= returns one thread and marks it seen.

import { requireStaffAuth, corsHeaders } from "../lib/endpoint-guards.js";
import { getInboxThread, listInboxThreads } from "../lib/conv-cache.js";

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
    const { error } = await requireStaffAuth(context, headers);
    if (error) return error;

    const kv = context.env.PORTAL_KV;
    if (!kv) {
      return new Response(JSON.stringify({ error: "Inbox cache is not configured" }), { status: 500, headers });
    }

    const url = new URL(context.request.url);
    const contactId = (url.searchParams.get("contactId") || "").trim();
    if (contactId) {
      const thread = await getInboxThread(kv, contactId, { markSeen: true });
      if (!thread) {
        return new Response(JSON.stringify({ error: "Thread not found in cache" }), { status: 404, headers });
      }
      return new Response(JSON.stringify({ success: true, thread }), { status: 200, headers });
    }

    const filterParam = (url.searchParams.get("filter") || "active").toLowerCase();
    const filter = ["active", "all", "needs_reply"].includes(filterParam) ? filterParam : "active";
    const limitParam = parseInt(url.searchParams.get("limit") || "80", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 80;
    const threads = await listInboxThreads(kv, { filter, limit });
    return new Response(JSON.stringify({ success: true, filter, count: threads.length, threads }), {
      status: 200,
      headers,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[staff-inbox] failed:", detail);
    return new Response(JSON.stringify({ error: `Failed to load inbox: ${detail}` }), { status: 500, headers });
  }
}
