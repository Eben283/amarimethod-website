// Cloudflare Pages Function: GET /api/cos-health
//
// A protected, synthetic COS readiness probe. It calls OpenRouter with a tiny
// prompt only; it never loads a conversation, accesses GHL, or writes a COS
// action. The Mac cloud-health monitor calls it every 15 minutes.

import { requireOpsReadKey } from "../lib/ops-auth.js";
import { probeOpenRouter, OPENROUTER_MODEL } from "../lib/cos-anthropic.js";
import { getGoogleToken } from "../lib/google-api.js";
import { writeOpsLastRun, OPS_READY_KEYS } from "../lib/ops-last-run.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

async function record(env, payload) {
  await writeOpsLastRun(env, OPS_READY_KEYS.cos, payload);
}

async function probeGoogleCalendar(context) {
  const token = await getGoogleToken(context, "Eben");
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Google Calendar ${response.status} readiness probe failed`);
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
    await probeGoogleCalendar(context);
    await record(context.env, result);
    return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
  } catch (err) {
    const message = String(err?.message || "");
    const status = message.match(/(OpenRouter|Google Calendar) (\d{3})/)?.[2] || null;
    const calendarFailure = /Google Calendar|Google token|Google refresh/i.test(message);
    const result = {
      ok: false,
      checkedAt,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      error: calendarFailure
        ? (status ? `Google Calendar ${status} readiness probe failed` : "Google Calendar readiness probe failed")
        : (status ? `OpenRouter ${status} readiness probe failed` : "OpenRouter readiness probe failed"),
    };
    console.error("[cos-health] readiness probe failed", status || "unknown");
    await record(context.env, result);
    // Pages may replace 502/503 bodies with Cloudflare HTML, which would hide
    // the actionable provider state from the monitor. 422 preserves the JSON.
    return new Response(JSON.stringify(result), { status: 422, headers: HEADERS });
  }
}
