// Amari Ops board assembly — registry + open incidents + live infra signals.
// Read path for /api/ops/systems. No Fix actions. Never fake-green unwatched rows.

import { OPS_REGISTRY, registryPath } from "./ops-registry.js";
import {
  countOpenIncidentsByPath,
  listOpsEvents,
  listOpsIncidents,
} from "./ops-events.js";
import { listOpsErrors } from "./ops-alert.js";
import { trailMeta } from "./ops-trail-kv.js";

const HOUR = 3600 * 1000;

function ageHours(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / HOUR;
}

function fmtAge(h) {
  if (h == null) return "unknown time";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function judgeLastRun(rec, { maxAgeH, okPredicate, detail }) {
  if (!rec) return { status: "unknown", note: "no run recorded", lastAt: null, detail: null };
  const at = rec.finishedAt || rec.ranAt || rec.startedAt;
  const age = ageHours(at);
  const stale = age == null || age > maxAgeH;
  const ok = okPredicate(rec);
  const d = detail(rec);
  if (!ok) {
    return { status: "red", note: `failed · ${d || "see log"}`, lastAt: at, detail: rec };
  }
  if (stale) {
    return {
      status: "red",
      note: `stale — last ${fmtAge(age)} (want < ${maxAgeH}h)`,
      lastAt: at,
      detail: rec,
    };
  }
  return {
    status: "green",
    note: `${fmtAge(age)}${d ? ` · ${d}` : ""}`,
    lastAt: at,
    detail: rec,
  };
}

/**
 * Home board rows: paths first, then dependencies.
 * Status: red | green | unknown — never green for unwatched / empty-trail lies.
 */
export async function buildSystemsBoard(env) {
  const [openByPath, infra, meta] = await Promise.all([
    countOpenIncidentsByPath(env),
    readInfraSignals(env),
    trailMeta(env),
  ]);

  // Peek recent trail activity per fully-watched path (for honest notes).
  const pathActivity = {};
  await Promise.all(
    OPS_REGISTRY.filter((r) => r.kind === "path" && r.instrumentation === "full").map(async (reg) => {
      const events = await listOpsEvents(env, { pathId: reg.id, limit: 1 });
      pathActivity[reg.id] = events[0] || null;
    }),
  );

  const systems = OPS_REGISTRY.map((reg) => {
    const openCount = openByPath[reg.id] || 0;
    let status = "unknown";
    let note = null;
    let lastAt = null;
    let why = null;

    if (reg.kind === "dependency") {
      const signal = infra[reg.id];
      if (signal) {
        status = signal.status;
        note = signal.note;
        lastAt = signal.lastAt || null;
        why = signal.why || null;
      } else if (reg.instrumentation === "planned") {
        status = "unknown";
        note = "not instrumented yet";
      } else {
        status = "unknown";
        note = "no signal";
      }
    } else if (openCount > 0) {
      status = "red";
      note = openCount === 1 ? "1 open incident" : `${openCount} open incidents`;
    } else if (reg.instrumentation === "planned") {
      status = "unknown";
      note = "planned — not watching yet";
    } else if (reg.instrumentation === "partial") {
      status = "unknown";
      note = "partial — hops not fully watched";
    } else {
      // full path instrumentation
      const latest = pathActivity[reg.id];
      if (latest) {
        status = latest.outcome === "fail" ? "red" : "green";
        note =
          latest.outcome === "fail"
            ? latest.summary || "latest hop failed"
            : `last hop ${fmtAge(ageHours(latest.at))}`;
        lastAt = latest.at;
        why = latest.summary;
      } else {
        status = "unknown";
        note = "watching — no trail yet";
      }
    }

    return {
      id: reg.id,
      label: reg.label,
      kind: reg.kind,
      severity: reg.severity,
      instrumentation: reg.instrumentation,
      status,
      note,
      why,
      lastAt,
      openIncidentCount: openCount,
      hops: reg.hops,
    };
  });

  systems.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "path" ? -1 : 1;
    if (a.status === "red" && b.status !== "red") return -1;
    if (b.status === "red" && a.status !== "red") return 1;
    return a.label.localeCompare(b.label);
  });

  const reds = systems.filter((s) => s.status === "red").length;
  const watched = systems.filter((s) => s.status !== "unknown");
  const overall = reds ? "red" : watched.length && watched.every((s) => s.status === "green")
    ? "green"
    : "unknown";

  return {
    overall,
    generatedAt: new Date().toISOString(),
    configured: !!env?.AUTOMATION_DB,
    trail: {
      kv: !!(env?.PORTAL_KV || env?.PURCHASE_KV),
      meta,
    },
    systems,
  };
}

/**
 * Path detail: hops + open incidents + short event log (+ infra why for deps).
 */
export async function buildPathDetail(env, pathId) {
  const reg = registryPath(pathId);
  if (!reg) return null;

  if (reg.kind === "dependency") {
    const infra = await readInfraSignals(env);
    const signal = infra[reg.id] || {
      status: reg.instrumentation === "planned" ? "unknown" : "unknown",
      note: "no signal",
      why: null,
      lastAt: null,
      log: [],
    };
    const relatedErrs = await relatedOpsErrors(env, pathId);
    return {
      id: reg.id,
      label: reg.label,
      kind: reg.kind,
      severity: reg.severity,
      instrumentation: reg.instrumentation,
      status: signal.status,
      note: signal.note,
      hops: [],
      incidents: [],
      events: signal.log || [],
      why: signal.why,
      signalDetail: signal.detail || null,
      relatedErrors: relatedErrs,
      generatedAt: new Date().toISOString(),
      configured: !!env?.AUTOMATION_DB,
    };
  }

  const [incidents, events, relatedErrors] = await Promise.all([
    listOpsIncidents(env, { pathId, status: "open", limit: 20 }),
    listOpsEvents(env, { pathId, limit: 40 }),
    relatedOpsErrors(env, pathId),
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
    else if (reg.instrumentation !== "full") state = "unwatched";
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

  let status = "unknown";
  if (incidents.length) status = "red";
  else if (reg.instrumentation !== "full") status = "unknown";
  else if (events.some((e) => e.outcome === "fail")) status = "red";
  else if (events.length) status = "green";

  return {
    id: reg.id,
    label: reg.label,
    kind: reg.kind,
    severity: reg.severity,
    instrumentation: reg.instrumentation,
    laws: reg.laws,
    status,
    note:
      status === "red"
        ? incidents[0]?.title || "failure on path"
        : events.length
          ? `${events.length} recent event${events.length === 1 ? "" : "s"}`
          : "no trail yet — next Assessment purchase will land here",
    hops,
    incidents,
    events,
    relatedErrors,
    generatedAt: new Date().toISOString(),
    configured: !!env?.AUTOMATION_DB,
  };
}

async function relatedOpsErrors(env, pathId) {
  try {
    const all = await listOpsErrors(env, { limit: 40 });
    const needles = {
      assessment_paid_book: ["assessment", "purchase", "book", "ghl-purchase", "checkout"],
      intro_paid_book: ["intro", "purchase", "book"],
      pos_card_fulfill: ["pos", "fulfill", "stripe-pos"],
      ghl_token: ["token", "ghl"],
      series_reconcile: ["reconcile", "series"],
      daily_audit: ["daily-audit", "audit"],
      partner_refresh: ["activity-refresh", "partner"],
      crm_mirror: ["crm", "mirror"],
    }[pathId] || [pathId];
    return all
      .filter((e) => {
        const hay = `${e.source || ""} ${e.summary || ""}`.toLowerCase();
        return needles.some((n) => hay.includes(n));
      })
      .slice(0, 12)
      .map((e) => ({
        at: e.at,
        source: e.source,
        summary: e.summary,
        detail: e.detail || null,
        key: e.key,
      }));
  } catch {
    return [];
  }
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
        out.ghl_token = {
          status: "red",
          note: "token expired or missing",
          why: "ghl_token_expiry in KV is past-due — re-auth or token-refresh worker is down",
          lastAt: null,
          log: [
            {
              id: "ghl_token",
              at: new Date().toISOString(),
              atMs: Date.now(),
              pathId: "ghl_token",
              hopId: "expiry",
              outcome: "fail",
              summary: "GHL token expired or missing in KV",
              condition: { expected: "future expiry", observed: String(expiryRaw) },
            },
          ],
        };
      } else {
        out.ghl_token = {
          status: "green",
          note: `fresh (${hoursLeft.toFixed(0)}h left)`,
          why: `Token expiry in KV · ${hoursLeft.toFixed(1)}h remaining`,
          lastAt: new Date(expiry).toISOString(),
          log: [
            {
              id: "ghl_token",
              at: new Date().toISOString(),
              atMs: Date.now(),
              pathId: "ghl_token",
              hopId: "expiry",
              outcome: "ok",
              summary: `GHL token fresh (${hoursLeft.toFixed(0)}h left)`,
            },
          ],
        };
      }
    } else {
      out.ghl_token = {
        status: "unknown",
        note: "couldn't read token expiry",
        why: "PORTAL_KV has no ghl_token_expiry key",
        lastAt: null,
        log: [],
      };
    }
  } catch {
    out.ghl_token = { status: "unknown", note: "token check failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:series-reconcile:lastRun", "json");
    const judged = judgeLastRun(rec, {
      maxAgeH: 3,
      okPredicate: (x) => x.status === "ok" && !x.orderPassError,
      detail: (x) =>
        x.applied != null
          ? `${x.applied} correction${x.applied === 1 ? "" : "s"} · ${x.ordersScanned ?? "?"} scanned`
          : "ok",
    });
    out.series_reconcile = {
      ...judged,
      why: judged.detail
        ? `status=${judged.detail.status}; applied=${judged.detail.applied ?? 0}; failed=${judged.detail.failed ?? 0}`
        : judged.note,
      log: lastRunAsLog("series_reconcile", judged),
      detail: judged.detail,
    };
  } catch {
    out.series_reconcile = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const now = new Date();
    const beforeCron = now.getUTCHours() < 11;
    const day = new Date(now.getTime() - (beforeCron ? 24 * HOUR : 0));
    const ds = day.toISOString().slice(0, 10);
    const rec = await kv.get(`ops:daily-audit:${ds}`, "json");
    if (!rec) {
      out.daily_audit = {
        status: beforeCron ? "unknown" : "red",
        note: beforeCron ? `pre-11:00 UTC — awaiting ${ds}` : `missing audit for ${ds}`,
        why: beforeCron
          ? "Daily audit cron runs 11:00 UTC; today's key is not expected yet."
          : `No ops:daily-audit:${ds} in KV — cron may be dead.`,
        lastAt: null,
        log: [],
      };
    } else {
      const n = Array.isArray(rec.issues) ? rec.issues.length : 0;
      const critical = Number(rec.summary?.critical || 0);
      out.daily_audit = {
        status: critical > 0 ? "red" : "green",
        note: `${ds} · ${n} issue${n === 1 ? "" : "s"}${critical ? ` · ${critical} critical` : ""}`,
        why: `Audit ran ${fmtAge(ageHours(rec.ranAt))} · ${n} issues (${critical} critical)`,
        lastAt: rec.ranAt || null,
        detail: rec,
        log: (rec.issues || []).slice(0, 20).map((issue, i) => ({
          id: `audit_${i}`,
          at: rec.ranAt || new Date().toISOString(),
          atMs: Date.parse(rec.ranAt || "") || Date.now(),
          pathId: "daily_audit",
          hopId: issue.category || "issue",
          outcome: issue.severity === "critical" ? "fail" : "skip",
          summary: `${issue.contactName || issue.contactId || "—"} · ${issue.rule || issue.message || "issue"}`,
          personLabel: issue.contactName || null,
          condition: {
            expected: issue.expected || null,
            observed: issue.actual || null,
          },
        })),
      };
    }
  } catch {
    out.daily_audit = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:activity-refresh:lastRun", "json");
    const judged = judgeLastRun(rec, {
      maxAgeH: 26,
      okPredicate: (x) => x.status === "ok" && !x.failed,
      detail: (x) => (x.written != null ? `${x.written} written` : "ok"),
    });
    out.partner_refresh = {
      ...judged,
      why: judged.detail
        ? `status=${judged.detail.status}; written=${judged.detail.written ?? 0}; failed=${judged.detail.failed ?? 0}`
        : judged.note,
      log: lastRunAsLog("partner_refresh", judged),
      detail: judged.detail,
    };
  } catch {
    out.partner_refresh = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const mirror =
      (await kv.get("ops:crm-mirror:lastRun", "json")) ||
      (await kv.get("ops:beat:crm-mirror", "json"));
    if (mirror) {
      const at = mirror.finishedAt || mirror.ranAt || mirror.startedAt;
      const ageH = ageHours(at);
      const ok = mirror.ok !== false && mirror.status !== "error" && mirror.status !== "failed";
      if (!ok) {
        out.crm_mirror = {
          status: "red",
          note: "mirror reported error",
          why: mirror.failure_detail || mirror.error || "error status in KV beat",
          lastAt: at,
          log: lastRunAsLog("crm_mirror", { status: "red", lastAt: at, detail: mirror, note: "error" }),
          detail: mirror,
        };
      } else if (ageH != null && ageH > 1) {
        out.crm_mirror = {
          status: "red",
          note: `stale (${ageH.toFixed(1)}h)`,
          why: `Last mirror signal ${fmtAge(ageH)}`,
          lastAt: at,
          log: lastRunAsLog("crm_mirror", { status: "red", lastAt: at, detail: mirror, note: "stale" }),
          detail: mirror,
        };
      } else {
        out.crm_mirror = {
          status: "green",
          note: "recent sync",
          why: `Mirror beat ${fmtAge(ageH)}`,
          lastAt: at,
          log: lastRunAsLog("crm_mirror", { status: "green", lastAt: at, detail: mirror, note: "ok" }),
          detail: mirror,
        };
      }
    }
    // else leave unset → board shows planned/unwatched
  } catch {
    /* leave unwatched */
  }

  return out;
}

function lastRunAsLog(pathId, judged) {
  if (!judged?.lastAt && !judged?.detail) return [];
  const ok = judged.status === "green";
  return [
    {
      id: `${pathId}_lastrun`,
      at: judged.lastAt || new Date().toISOString(),
      atMs: Date.parse(judged.lastAt || "") || Date.now(),
      pathId,
      hopId: "last_run",
      outcome: ok ? "ok" : "fail",
      summary: judged.note || (ok ? "last run ok" : "last run bad"),
      condition: judged.detail
        ? {
            expected: "status ok + fresh",
            observed: judged.detail.status || JSON.stringify(judged.detail).slice(0, 120),
          }
        : null,
    },
  ];
}

export const __test = { readInfraSignals, judgeLastRun, ageHours, fmtAge };
