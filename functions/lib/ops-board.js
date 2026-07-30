// Amari Ops board assembly — registry + open incidents (+ light infra signals).
// Read path for /api/ops/systems. No Fix actions.

import { OPS_REGISTRY, registryPath } from "./ops-registry.js";
import {
  countOpenIncidentsByPath,
  listOpsEvents,
  listOpsIncidents,
} from "./ops-events.js";

const HOUR = 3600 * 1000;

/**
 * Home board rows: paths first, then dependencies.
 * Status: red | green | unknown
 */
export async function buildSystemsBoard(env) {
  const openByPath = await countOpenIncidentsByPath(env);
  const infra = await readInfraSignals(env);

  const systems = OPS_REGISTRY.map((reg) => {
    const openCount = openByPath[reg.id] || 0;
    let status = "green";
    let note = null;

    if (reg.kind === "dependency") {
      const signal = infra[reg.id];
      if (signal) {
        status = signal.status;
        note = signal.note;
      } else if (reg.instrumentation === "planned") {
        status = "unknown";
        note = "not instrumented yet";
      }
    } else if (openCount > 0) {
      status = "red";
      note = openCount === 1 ? "1 open incident" : `${openCount} open incidents`;
    } else if (reg.instrumentation === "planned") {
      status = "unknown";
      note = "planned — not watching yet";
    } else if (reg.instrumentation === "partial") {
      status = "green";
      note = "partial watch";
    } else {
      status = "green";
      note = "watching";
    }

    return {
      id: reg.id,
      label: reg.label,
      kind: reg.kind,
      severity: reg.severity,
      instrumentation: reg.instrumentation,
      status,
      note,
      openIncidentCount: openCount,
      hops: reg.hops,
    };
  });

  // Paths first, then dependencies (brief recommendation).
  systems.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "path" ? -1 : 1;
    if (a.status === "red" && b.status !== "red") return -1;
    if (b.status === "red" && a.status !== "red") return 1;
    return a.label.localeCompare(b.label);
  });

  const reds = systems.filter((s) => s.status === "red").length;
  const unknowns = systems.filter((s) => s.status === "unknown").length;
  const overall = reds ? "red" : unknowns === systems.length ? "unknown" : "green";

  return {
    overall,
    generatedAt: new Date().toISOString(),
    configured: !!env?.AUTOMATION_DB,
    systems,
  };
}

/**
 * Path detail: hops + open incidents + short event log.
 */
export async function buildPathDetail(env, pathId) {
  const reg = registryPath(pathId);
  if (!reg) return null;

  const [incidents, events] = await Promise.all([
    listOpsIncidents(env, { pathId, status: "open", limit: 20 }),
    listOpsEvents(env, { pathId, limit: 40 }),
  ]);

  const failedHopId = incidents[0]?.failedHopId || null;
  const latestByHop = {};
  for (const e of events) {
    if (!latestByHop[e.hopId]) latestByHop[e.hopId] = e;
  }

  const hops = (reg.hops || []).map((h) => {
    const latest = latestByHop[h.id] || null;
    let state = "idle";
    if (failedHopId && h.id === failedHopId) state = "red";
    else if (latest?.outcome === "fail") state = "red";
    else if (latest?.outcome === "skip") state = "skip";
    else if (latest?.outcome === "ok") state = "ok";
    else if (reg.instrumentation === "planned") state = "unwatched";
    return {
      id: h.id,
      label: h.label,
      state,
      latest: latest
        ? {
            outcome: latest.outcome,
            summary: latest.summary,
            at: latest.at,
            condition: latest.condition,
          }
        : null,
    };
  });

  return {
    id: reg.id,
    label: reg.label,
    kind: reg.kind,
    severity: reg.severity,
    instrumentation: reg.instrumentation,
    laws: reg.laws,
    status: incidents.length ? "red" : reg.instrumentation === "planned" ? "unknown" : "green",
    hops,
    incidents,
    events,
    generatedAt: new Date().toISOString(),
  };
}

async function readInfraSignals(env) {
  const out = {};
  const kv = env?.PORTAL_KV;
  if (!kv) return out;

  try {
    const expiryRaw = await kv.get("ghl_token_expiry");
    if (expiryRaw != null) {
      const expiry = Number(expiryRaw);
      const hoursLeft = (expiry - Date.now()) / HOUR;
      if (!expiry || hoursLeft <= 0) {
        out.ghl_token = { status: "red", note: "token expired or missing" };
      } else {
        out.ghl_token = { status: "green", note: `fresh (${hoursLeft.toFixed(0)}h left)` };
      }
    } else {
      out.ghl_token = { status: "unknown", note: "couldn't read token expiry" };
    }
  } catch {
    out.ghl_token = { status: "unknown", note: "token check failed" };
  }

  try {
    // Mirror readiness beat if present; otherwise leave unknown (planned).
    const mirror =
      (await kv.get("ops:crm-mirror:lastRun", "json")) ||
      (await kv.get("ops:beat:crm-mirror", "json"));
    if (mirror) {
      const at = mirror.finishedAt || mirror.ranAt || mirror.startedAt;
      const ageH = at ? (Date.now() - Date.parse(at)) / HOUR : null;
      const ok = mirror.ok !== false && mirror.status !== "error";
      if (!ok) out.crm_mirror = { status: "red", note: "mirror reported error" };
      else if (ageH != null && ageH > 1) out.crm_mirror = { status: "red", note: `stale (${ageH.toFixed(1)}h)` };
      else out.crm_mirror = { status: "green", note: "recent sync" };
    }
  } catch {
    /* leave unwatched */
  }

  return out;
}

export const __test = { readInfraSignals };
