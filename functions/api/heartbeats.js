// Cloudflare Pages Function: /api/heartbeats
//
// GET  → judged beats for every registered overnight job (green/red/unknown),
//        same {overall, checks} shape as /api/system-health. Read by the /day
//        aggregator (day-payload.js) so the briefing surfaces any job that didn't
//        run or produced nothing. Gated by OPS_READ_KEY (same as system-health).
//
// POST → write one beat: { job, producedN, ok }. For overnight jobs that reach KV
//        from OUTSIDE the Pages/Workers native binding (ghl-mcp / launchd scripts).
//        WEB workers should call writeBeat() on their native env.PORTAL_KV instead
//        and never hit this endpoint. Gated by the same OPS_READ_KEY: the local
//        /day machine already holds it, a beat is non-sensitive observability data,
//        and writes are restricted to the registered job namespace, so blast radius
//        is nil. (No new secret to provision — deliberately lean.)

import { requireOpsReadKey } from "../lib/ops-auth.js";
import { writeBeat, readAndJudgeBeats, isRegisteredJob, HEARTBEAT_JOBS } from "../lib/heartbeat.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export async function onRequestGet(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: JSON_HEADERS });
  }
  const result = await readAndJudgeBeats(kv);
  return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
}

export async function onRequestPost(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const kv = context.env.PORTAL_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: JSON_HEADERS });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: JSON_HEADERS });
  }

  const job = typeof body?.job === "string" ? body.job : "";
  if (!isRegisteredJob(job)) {
    return new Response(
      JSON.stringify({ error: `unknown job '${job}'`, registered: HEARTBEAT_JOBS.map((j) => j.job) }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const producedN = Number(body.producedN);
  const beat = await writeBeat(kv, job, {
    producedN: Number.isFinite(producedN) ? producedN : 0,
    ok: body.ok !== false,
  });
  return new Response(JSON.stringify({ ok: true, beat }), { status: 200, headers: JSON_HEADERS });
}
