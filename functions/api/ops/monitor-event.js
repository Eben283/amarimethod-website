// POST /api/ops/monitor-event
//
// Receives a state transition from the independent Mac health monitor.  The
// monitor is deliberately outside Pages: if a critical dependency fails, the
// failure is recorded as an OpsEvent and a durable OpsIncident rather than
// living only in a menu-bar snapshot or a browser error.

import { requireOpsReadKey } from "../../lib/ops-auth.js";
import { recordOpsEvent, openOpsIncident, resolveOpsIncident } from "../../lib/ops-events.js";
import { registryPath } from "../../lib/ops-registry.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const STATES = new Set(["green", "red", "unknown"]);
const MAX_NOTE_LENGTH = 500;

function text(value, max = MAX_NOTE_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const body = await readBody(context.request);
  const pathId = text(body?.pathId, 100);
  const state = text(body?.state, 20).toLowerCase();
  const note = text(body?.note) || "external health monitor reported no detail";
  const observedAt = text(body?.observedAt, 64) || new Date().toISOString();
  const path = registryPath(pathId);

  if (!path || !STATES.has(state)) {
    return new Response(JSON.stringify({ error: "invalid monitor event" }), { status: 400, headers: HEADERS });
  }

  const correlationId = `monitor:${pathId}`;
  const failed = state !== "green";
  const event = await recordOpsEvent(context.env, {
    pathId,
    hopId: "synthetic_monitor",
    outcome: failed ? "fail" : "ok",
    reasonCode: failed ? (state === "unknown" ? "monitor_unverified" : "monitor_failed") : "monitor_recovered",
    summary: `${path.label} external monitor ${failed ? state : "recovered"}: ${note}`,
    correlationId,
    condition: { expected: "green synthetic health check", observed: state },
    source: "amari-cloud-health",
    at: observedAt,
  });

  if (failed) {
    const incident = await openOpsIncident(
      context.env,
      {
        pathId,
        severity: path.severity,
        title: `${path.label} monitor ${state}`,
        correlationId,
        failedHopId: "synthetic_monitor",
        eventIds: event.id ? [event.id] : [],
      },
      { context, alert: true },
    );
    return new Response(JSON.stringify({ ok: true, action: "opened", event, incident }), {
      status: 200,
      headers: HEADERS,
    });
  }

  const resolution = await resolveOpsIncident(context.env, { pathId, correlationId });
  return new Response(JSON.stringify({ ok: true, action: "resolved", event, resolution }), {
    status: 200,
    headers: HEADERS,
  });
}

export const __test = { STATES, text, readBody };
