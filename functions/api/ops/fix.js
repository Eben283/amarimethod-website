// GET  /api/ops/fix?pathId=… — fix job status
// POST /api/ops/fix { pathId, action: "fix"|"request"|"sweep"|"launch" }
//   fix     — authenticated Staff Fix button: launch now (or return copy-paste prompt)
//   request — authenticated Staff queue-only request for cron
//   sweep / launch — worker auth only

import { corsHeaders, requireStaffAuth } from "../../lib/endpoint-guards.js";
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
  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  const pathId = new URL(context.request.url).searchParams.get("pathId");
  if (!pathId) return json({ error: "pathId required" }, 400, headers);
  const job = await readFixJob(context.env, pathId);
  return json(
    {
      pathId,
      autoFix: isAutoFixable(pathId),
      fixMode: String(context.env.OPS_FIX_MODE || "shadow").toLowerCase(),
      hasCursorKey: !!context.env.CURSOR_API_KEY,
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
  const action = String(body.action || "fix").toLowerCase();
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

  const { error } = await requireStaffAuth(context, headers);
  if (error) return error;

  if (action === "request") {
    // Queue only — cron may pick up later (when OPS_FIX_MODE=auto).
    if (!pathId) return json({ error: "pathId required" }, 400, headers);
    const result = await queueFixRequest(context.env, pathId, { reason: "manual" });
    if (!result.queued) {
      return json(result, result.reason === "unknown-path" ? 404 : 409, headers);
    }
    return json(result, 200, headers);
  }

  // Default / action "fix": Fix button — launch now or return copy-paste prompt.
  if (!pathId) return json({ error: "pathId required" }, 400, headers);
  if (!isAutoFixable(pathId)) {
    return json({ ok: false, error: "not-fixable" }, 409, headers);
  }
  const detail = await buildPathDetail(context.env, pathId);
  if (!detail) return json({ error: "Unknown path" }, 404, headers);
  const result = await launchFixForPath(context.env, detail, {
    requested: true,
    manual: true,
    force: false,
  });
  return json(
    {
      ...result,
      hasCursorKey: !!context.env.CURSOR_API_KEY,
    },
    result.ok ? 200 : 409,
    headers,
  );
}
