// POST /api/ops/monitor-event
//
// Receives a state transition from the independent Mac health monitor.  The
// monitor is deliberately outside Pages: if a critical dependency fails, the
// failure is recorded as an OpsEvent and a durable OpsIncident rather than
// living only in a menu-bar snapshot or a browser error.

import { requireOpsReadKey } from "../../lib/ops-auth.js";
import {
  listOpsEvents,
  recordOpsEvent,
  openOpsIncident,
  resolveOpsIncident,
} from "../../lib/ops-events.js";
import { EXTERNAL_MONITOR_PATH_IDS, registryPath } from "../../lib/ops-registry.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const STATES = new Set(["green", "red", "unknown"]);
const MAX_NOTE_LENGTH = 500;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const EXTERNAL_MONITOR_PATHS = new Set(EXTERNAL_MONITOR_PATH_IDS);

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

function monitorTimestamp(value) {
  const raw = text(value, 64);
  if (!raw) return new Date().toISOString();
  const atMs = Date.parse(raw);
  if (!Number.isFinite(atMs) || atMs > Date.now() + MAX_FUTURE_SKEW_MS) return null;
  return new Date(atMs).toISOString();
}

function persistenceFailure() {
  return new Response(JSON.stringify({ error: "monitor state persistence failed" }), {
    status: 500,
    headers: HEADERS,
  });
}

async function latestMonitorTimestamp(env, pathId) {
  const events = await listOpsEvents(env, { pathId, limit: 20 });
  const latest = events.find(
    (event) => event.hopId === "synthetic_monitor" && event.source === "amari-cloud-health",
  );
  const atMs = latest?.atMs ?? Date.parse(latest?.at || "");
  return Number.isFinite(atMs) ? atMs : null;
}

export async function onRequestPost(context) {
  const denied = requireOpsReadKey(context.request, context.env);
  if (denied) return denied;

  const body = await readBody(context.request);
  const pathId = text(body?.pathId, 100);
  const state = text(body?.state, 20).toLowerCase();
  const note = text(body?.note) || "external health monitor reported no detail";
  const observedAt = monitorTimestamp(body?.observedAt);
  const heartbeat = body?.heartbeat === true && state === "green";
  const path = registryPath(pathId);

  if (!path || !EXTERNAL_MONITOR_PATHS.has(pathId) || !STATES.has(state) || !observedAt) {
    return new Response(JSON.stringify({ error: "invalid monitor event" }), { status: 400, headers: HEADERS });
  }

  const observedAtMs = Date.parse(observedAt);
  const latestAtMs = await latestMonitorTimestamp(context.env, pathId);
  if (latestAtMs != null && observedAtMs < latestAtMs) {
    return new Response(JSON.stringify({ ok: true, action: "ignored_stale" }), {
      status: 202,
      headers: HEADERS,
    });
  }

  const correlationId = `monitor:${pathId}`;
  const failed = state !== "green";
  const event = await recordOpsEvent(context.env, {
    pathId,
    hopId: "synthetic_monitor",
    outcome: failed ? "fail" : "ok",
    reasonCode: failed
      ? (state === "unknown" ? "monitor_unverified" : "monitor_failed")
      : heartbeat ? "monitor_heartbeat" : "monitor_recovered",
    summary: `${path.label} external monitor ${failed ? state : heartbeat ? "heartbeat" : "recovered"}: ${note}`,
    correlationId,
    condition: { expected: "green synthetic health check", observed: state },
    source: "amari-cloud-health",
    at: observedAt,
  });
  if (!event?.recorded) return persistenceFailure();

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
    if (incident?.opened !== true && incident?.attached !== true) return persistenceFailure();
    return new Response(JSON.stringify({ ok: true, action: "opened", event, incident }), {
      status: 200,
      headers: HEADERS,
    });
  }

  const resolution = await resolveOpsIncident(context.env, { pathId, correlationId });
  if (resolution?.reason) return persistenceFailure();
  return new Response(JSON.stringify({ ok: true, action: "resolved", event, resolution }), {
    status: 200,
    headers: HEADERS,
  });
}

export const __test = { STATES, text, readBody, monitorTimestamp, latestMonitorTimestamp };
