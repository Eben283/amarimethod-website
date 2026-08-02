// Cloudflare Pages Function: GET /api/cos-health
//
// A protected, synthetic COS readiness probe. It calls OpenRouter with a tiny
// prompt only; it never loads a conversation, accesses GHL, or writes a COS
// action. The Mac cloud-health monitor calls it every 15 minutes.

import { requireOpsReadKey } from "../lib/ops-auth.js";
import { probeOpenRouter, OPENROUTER_MODEL } from "../lib/cos-anthropic.js";
import { writeOpsLastRun, OPS_READY_KEYS } from "../lib/ops-last-run.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

async function record(env, payload) {
  await writeOpsLastRun(env, OPS_READY_KEYS.cos, payload);
}

export async function onRequestGet(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const checkedAt = new Date().toISOString();
  const apiKey = context.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const result = {
      ok: false,
      checkedAt,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      error: "OPENROUTER_API_KEY not configured",
    };
    await record(context.env, result);
    return new Response(JSON.stringify(result), { status: 500, headers: HEADERS });
  }

  try {
    const result = {
      ok: true,
      checkedAt,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
    };
    await probeOpenRouter(apiKey);
    await record(context.env, result);
    return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
  } catch (err) {
    const status = String(err?.message || "").match(/OpenRouter (\d{3})/)?.[1] || null;
    const result = {
      ok: false,
      checkedAt,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      error: status ? `OpenRouter ${status} readiness probe failed` : "OpenRouter readiness probe failed",
    };
    console.error("[cos-health] OpenRouter readiness probe failed", status || "unknown");
    await record(context.env, result);
    return new Response(JSON.stringify(result), { status: 502, headers: HEADERS });
  }
}
