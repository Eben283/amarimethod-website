// GET  /api/ops/fix?pathId=… — fix job status
// POST /api/ops/fix { pathId, action: "request"|"sweep" }
//   request — queue a fix (public; worker launches)
//   sweep   — run fixer now (requires WORKER_AUTH_SECRET / Bearer)

import { corsHeaders } from "../../lib/endpoint-guards.js";
import { requireWorkerAuth } from "../../lib/worker-auth.js";
import { buildSystemsBoard, buildPathDetail } from "../../lib/ops-board.js";
import {
  isAutoFixable,
  launchFixForPath,
  queueFixRequest,
  readFixJob,
  runOpsFixSweep,
} from "../../lib/ops-fix.js";

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request.headers.get("Origin") || "", "GET, POST, OPTIONS"),
  });
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = {
    ...corsHeaders(origin, "GET, POST, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const pathId = new URL(context.request.url).searchParams.get("pathId");
  if (!pathId) return json({ error: "pathId required" }, 400, headers);
  const job = await readFixJob(context.env, pathId);
  return json(
    {
      pathId,
      autoFix: isAutoFixable(pathId),
      fixMode: String(context.env.OPS_FIX_MODE || "shadow").toLowerCase(),
      job,
    },
    200,
    headers,
  );
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = {
    ...corsHeaders(origin, "GET, POST, OPTIONS"),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const action = String(body.action || "request").toLowerCase();
  const pathId = body.pathId;

  if (action === "sweep") {
    const denied = requireWorkerAuth(context.request, context.env);
    if (denied) return denied;
    const summary = await runOpsFixSweep(context.env, { buildSystemsBoard });
    return json(summary, 200, headers);
  }

  if (action === "launch") {
    // Immediate launch — worker auth only (keeps CURSOR_API_KEY off the public board).
    const denied = requireWorkerAuth(context.request, context.env);
    if (denied) return denied;
    if (!pathId) return json({ error: "pathId required" }, 400, headers);
    const detail = await buildPathDetail(context.env, pathId);
    if (!detail) return json({ error: "Unknown path" }, 404, headers);
    const result = await launchFixForPath(context.env, detail, {
      requested: true,
      force: !!body.force,
    });
    return json(result, result.ok ? 200 : 409, headers);
  }

  // Default: queue a request the cron/sweep will pick up.
  if (!pathId) return json({ error: "pathId required" }, 400, headers);
  const result = await queueFixRequest(context.env, pathId, { reason: "manual" });
  if (!result.queued) {
    return json(result, result.reason === "unknown-path" ? 404 : 409, headers);
  }
  return json(result, 200, headers);
}
