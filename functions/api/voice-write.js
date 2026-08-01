// Cloudflare Pages Function: POST /api/voice-write
// The Voice Writer's backend. Thin: it authenticates staff, hands the request to
// the shared voice engine (generate -> audit -> revise until on-brand), stores the
// result in KV history, and returns the finished draft. All the on-brand guarantee
// lives in ../lib/voice-engine.js — this file just wires it to staff auth + KV.

import { requireStaffAuth, corsHeaders, parseJsonBody } from "../lib/endpoint-guards.js";
import { generateOnBrand } from "../lib/voice-engine.js";
import { anthropicUserError, resolveCosLlm } from "../lib/cos-anthropic.js";

const HISTORY_CAP = 25; // keep the last N drafts per user

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin"), "POST, OPTIONS"),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Content-Type": "application/json" };

  try {
    const { error, payload } = await requireStaffAuth(context, headers);
    if (error) return error;

    const llm = resolveCosLlm(context.env);
    if (!llm) {
      return new Response(JSON.stringify({ error: "Writer not configured (missing OPENROUTER_API_KEY)" }), { status: 500, headers });
    }

    const { body, error: parseError } = await parseJsonBody(context.request, headers);
    if (parseError) return parseError;

    // Accept either a single message (with optional prior history for iteration) or
    // a full messages array. Normalize to a messages array for the engine.
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const messages = Array.isArray(body.messages)
      ? body.messages
      : [...history, ...(message ? [{ role: "user", content: message }] : [])];

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers });
    }

    const userName = payload.user || "Garrett";

    const result = await generateOnBrand({ llm, userName, messages });

    // Save to KV history (best-effort — a failed save never blocks the draft).
    const kv = context.env.PORTAL_KV;
    if (kv) {
      try {
        const key = `cos:voice-history:${userName}`;
        const existingRaw = await kv.get(key);
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const entry = {
          request: messages[messages.length - 1]?.content || "",
          copy: result.copy,
          channel: result.channel,
          fixes: result.fixes,
          revisions: result.revisions,
          passedClean: result.passedClean,
          savedAt: Date.now(),
        };
        const next = [entry, ...existing].slice(0, HISTORY_CAP);
        await kv.put(key, JSON.stringify(next), { expirationTtl: 90 * 24 * 60 * 60 });
      } catch (err) {
        console.error("[voice-write] history save failed:", err.message);
      }
    }

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    const mapped = anthropicUserError(err);
    console.error("[voice-write] error:", err.message, "→", mapped.code);
    return new Response(
      JSON.stringify({ error: mapped.message, code: mapped.code }),
      { status: 500, headers },
    );
  }
}

// Fetch this staff user's recent Voice Writer drafts.
export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin, "GET, OPTIONS"), "Content-Type": "application/json" };

  const { error, payload } = await requireStaffAuth(context, headers);
  if (error) return error;

  const kv = context.env.PORTAL_KV;
  if (!kv) return new Response(JSON.stringify({ drafts: [] }), { status: 200, headers });

  const userName = payload.user || "Garrett";
  const raw = await kv.get(`cos:voice-history:${userName}`).catch(() => null);
  return new Response(JSON.stringify({ drafts: raw ? JSON.parse(raw) : [] }), { status: 200, headers });
}
