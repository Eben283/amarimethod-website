// GET /api/ops/systems — Amari Ops board (click-to-view, no PIN).
//   ?pathId=assessment_paid_book → path detail (hops + incidents + log)

import { corsHeaders } from "../../lib/endpoint-guards.js";
import { buildPathDetail, buildSystemsBoard } from "../../lib/ops-board.js";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin") || "", "GET, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = {
    ...corsHeaders(origin, "GET, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };

  const url = new URL(context.request.url);
  const pathId = url.searchParams.get("pathId");

  try {
    if (pathId) {
      const detail = await buildPathDetail(context.env, pathId);
      if (!detail) {
        return new Response(JSON.stringify({ error: "Unknown path" }), { status: 404, headers });
      }
      return new Response(JSON.stringify(detail), { status: 200, headers });
    }

    const board = await buildSystemsBoard(context.env);
    return new Response(JSON.stringify(board), { status: 200, headers });
  } catch (err) {
    console.error(`[api/ops/systems] ${err && err.message}`);
    return new Response(JSON.stringify({ error: "Failed to load systems" }), {
      status: 500,
      headers,
    });
  }
}
