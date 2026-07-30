// Amari Ops board assembly — registry + open incidents + live infra signals.
// Read path for /api/ops/systems. No Fix actions. Never fake-green unwatched rows.

import { OPS_ERR_PATH_SOURCES, OPS_REGISTRY, registryPath } from "./ops-registry.js";
import {
  countOpenIncidentsByPath,
  listOpsEvents,
  listOpsIncidents,
} from "./ops-events.js";
import { listOpsErrors } from "./ops-alert.js";
import { trailMeta } from "./ops-trail-kv.js";

const HOUR = 3600 * 1000;
const ERR_LOOKBACK_H = 72;

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
  const at = rec.finishedAt || rec.ranAt || rec.startedAt || rec.refreshedAt;
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

function signalFromJudged(id, judged, why) {
  return {
    ...judged,
    why: why || judged.note,
    log: lastRunAsLog(id, judged),
    detail: judged.detail,
  };
}

/**
 * Home board rows: paths first, then messaging, then infra.
 * Status: red | green | unknown — never green for unwatched / empty-trail lies.
 */
export async function buildSystemsBoard(env) {
  const [openByPath, infra, meta, errIndex] = await Promise.all([
    countOpenIncidentsByPath(env),
    readInfraSignals(env),
    trailMeta(env),
    indexRecentOpsErrors(env),
  ]);

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
      const errs = errIndex.byPath[reg.id] || [];
      if (errs.length) {
        status = "red";
        note = `${errs.length} recent failure${errs.length === 1 ? "" : "s"}`;
        why = errs[0].summary;
        lastAt = errs[0].at;
      } else {
        status = "unknown";
        note = "partial — fail sink only";
      }
    } else {
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
      group: reg.group || (reg.kind === "path" ? "paths" : "infra"),
      instrumentation: reg.instrumentation,
      status,
      note,
      why,
      lastAt,
      openIncidentCount: openCount,
      hops: reg.hops,
    };
  });

  const groupRank = { paths: 0, messaging: 1, infra: 2 };
  systems.sort((a, b) => {
    const ga = groupRank[a.group] ?? 9;
    const gb = groupRank[b.group] ?? 9;
    if (ga !== gb) return ga - gb;
    if (a.status === "red" && b.status !== "red") return -1;
    if (b.status === "red" && a.status !== "red") return 1;
    return a.label.localeCompare(b.label);
  });

  const reds = systems.filter((s) => s.status === "red").length;
  const watched = systems.filter((s) => s.status !== "unknown");
  const overall = reds
    ? "red"
    : watched.length && watched.every((s) => s.status === "green")
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
      status: "unknown",
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
      group: reg.group || "infra",
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
  else if (events.some((e) => e.outcome === "fail")) status = "red";
  else if (relatedErrors.length && reg.instrumentation !== "full") status = "red";
  else if (reg.instrumentation === "full" && events.length) status = "green";
  else if (reg.instrumentation === "planned") status = "unknown";

  const emptyNote =
    reg.instrumentation === "full"
      ? "no trail yet — next Assessment purchase will land here"
      : reg.instrumentation === "partial"
        ? "partial watch — failures land in ops:err until hop emitters exist"
        : "planned — not watching yet";

  return {
    id: reg.id,
    label: reg.label,
    kind: reg.kind,
    severity: reg.severity,
    group: reg.group || "paths",
    instrumentation: reg.instrumentation,
    laws: reg.laws,
    status,
    note:
      status === "red"
        ? incidents[0]?.title || relatedErrors[0]?.summary || "failure on path"
        : events.length
          ? `${events.length} recent event${events.length === 1 ? "" : "s"}`
          : emptyNote,
    hops,
    incidents,
    events,
    relatedErrors,
    generatedAt: new Date().toISOString(),
    configured: !!env?.AUTOMATION_DB,
  };
}

async function indexRecentOpsErrors(env) {
  const byPath = {};
  try {
    const all = await listOpsErrors(env, { limit: 100 });
    for (const e of all) {
      const age = ageHours(e.at);
      if (age != null && age > ERR_LOOKBACK_H) continue;
      const pathId = OPS_ERR_PATH_SOURCES[e.source];
      if (!pathId) continue;
      if (!byPath[pathId]) byPath[pathId] = [];
      byPath[pathId].push(e);
    }
  } catch {
    /* empty */
  }
  return { byPath };
}

async function relatedOpsErrors(env, pathId) {
  try {
    const all = await listOpsErrors(env, { limit: 80 });
    const sourceForPath = Object.entries(OPS_ERR_PATH_SOURCES)
      .filter(([, id]) => id === pathId)
      .map(([src]) => src);
    const needles = {
      assessment_paid_book: ["assessment", "ghl-purchase", "checkout"],
      intro_paid_book: ["intro", "purchase"],
      portal_followup_paid_book: ["followup", "follow-up", "portal-pay"],
      order_package_credit: ["ghl-purchase-webhook"],
      invoice_package_credit: ["ghl-invoice-webhook"],
      pos_card_fulfill: ["staff-pos-fulfill", "stripe-pos", "pos"],
      discovery_free_book: ["book/create-checkout", "discovery"],
      portal_package_book: ["portal-book"],
      appointment_webhook: ["appointment-webhook"],
      staff_book: ["staff-book"],
      ghl_token: ["token", "ghl"],
      series_reconcile: ["reconcile", "series"],
      ledger_drift: ["ledger", "drift"],
      daily_audit: ["daily-audit", "audit"],
      partner_refresh: ["activity-refresh", "partner"],
      conversation_cache: ["conversation-cache", "conv"],
      coach_cadence: ["coach-cadence", "cadence"],
      coach_reconcile: ["coach-reconcile"],
      funnel_refresh: ["funnel"],
      call_coach: ["call-coach"],
      field_id_check: ["field-id"],
      ecosystem_scan: ["ecosystem"],
      crm_mirror: ["crm", "mirror"],
      comms_coherence: ["comms"],
      reminder_engine: ["reminder"],
      nurture_engine: ["nurture"],
    }[pathId] || [pathId];

    return all
      .filter((e) => {
        if (sourceForPath.includes(e.source)) return true;
        const hay = `${e.source || ""} ${e.summary || ""}`.toLowerCase();
        return needles.some((n) => hay.includes(String(n).toLowerCase()));
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

  // GHL token (expiry is the money-critical signal; refresh lastRun is secondary).
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
    out.series_reconcile = signalFromJudged(
      "series_reconcile",
      judged,
      judged.detail
        ? `status=${judged.detail.status}; applied=${judged.detail.applied ?? 0}; failed=${judged.detail.failed ?? 0}`
        : judged.note,
    );
  } catch {
    out.series_reconcile = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const findings = await kv.get("ops:ledger-drift:findings", "json");
    if (!findings) {
      out.ledger_drift = {
        status: "unknown",
        note: "no findings snapshot",
        why: "ops:ledger-drift:findings missing — daily audit may not have run",
        lastAt: null,
        log: [],
      };
    } else {
      const issues = Array.isArray(findings.issues) ? findings.issues : [];
      const at = findings.generatedAt || null;
      const age = ageHours(at);
      const stale = age == null || age > 30;
      out.ledger_drift = {
        status: issues.length || stale ? "red" : "green",
        note: stale
          ? `stale snapshot · ${fmtAge(age)}`
          : issues.length
            ? `${issues.length} drift issue${issues.length === 1 ? "" : "s"}`
            : `clean · ${findings.candidateCount ?? 0} checked`,
        why: stale
          ? `Ledger drift findings older than 30h (${fmtAge(age)})`
          : issues.length
            ? issues[0].message || issues[0].rule || "drift detected"
            : `No drift issues · generated ${fmtAge(age)}`,
        lastAt: at,
        detail: findings,
        log: (issues.length ? issues : [{ message: "no drift issues" }]).slice(0, 20).map((issue, i) => ({
          id: `drift_${i}`,
          at: at || new Date().toISOString(),
          atMs: Date.parse(at || "") || Date.now(),
          pathId: "ledger_drift",
          hopId: "scan",
          outcome: issues.length ? "fail" : "ok",
          summary: issue.message || issue.rule || issue.contactName || "ledger drift",
          personLabel: issue.contactName || null,
        })),
      };
    }
  } catch {
    out.ledger_drift = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
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
    out.partner_refresh = signalFromJudged(
      "partner_refresh",
      judgeLastRun(rec, {
        maxAgeH: 26,
        okPredicate: (x) => x.status === "ok" && !x.failed,
        detail: (x) => (x.written != null ? `${x.written} written` : "ok"),
      }),
    );
  } catch {
    out.partner_refresh = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:conversation-cache:lastRun", "json");
    out.conversation_cache = signalFromJudged(
      "conversation_cache",
      judgeLastRun(rec, {
        maxAgeH: 4,
        okPredicate: (x) => x && !x.error,
        detail: (x) =>
          x.contactsUpdated != null
            ? `${x.contactsUpdated} contacts · ${x.newTouches ?? 0} touches`
            : "ok",
      }),
    );
  } catch {
    out.conversation_cache = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:coach-cadence:lastRun", "json");
    out.coach_cadence = signalFromJudged(
      "coach_cadence",
      judgeLastRun(rec, {
        maxAgeH: 4,
        okPredicate: (x) => x && !x.error,
        detail: (x) => (x.dueCount != null ? `${x.dueCount} due · ${x.activeContacts ?? "?"} active` : "ok"),
      }),
    );
  } catch {
    out.coach_cadence = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:coach-reconcile:lastRun", "json");
    out.coach_reconcile = signalFromJudged(
      "coach_reconcile",
      judgeLastRun(rec, {
        maxAgeH: 4,
        okPredicate: (x) => x && !(x.errorCount > 0),
        detail: (x) =>
          x.checked != null ? `${x.checked} checked · ${x.deletedCount ?? 0} deleted` : "ok",
      }),
    );
  } catch {
    out.coach_reconcile = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:funnel-refresh:lastRun", "json");
    out.funnel_refresh = signalFromJudged(
      "funnel_refresh",
      judgeLastRun(rec, {
        maxAgeH: 3,
        okPredicate: (x) => x.status === "ok",
        detail: (x) =>
          x.sales != null ? `${x.sales} sales · ${x.sessionsSold ?? "?"} sessions sold` : "ok",
      }),
    );
  } catch {
    out.funnel_refresh = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    // Call coach is on-demand (Whisper + LLM). Board watches readiness
    // ("if we want it, will it run?"), not lastRun freshness.
    const [ready, last] = await Promise.all([
      kv.get("call-coach:status:ready", "json"),
      kv.get("call-coach:status:lastRun", "json"),
    ]);
    out.call_coach = judgeCallCoachReadiness(ready, last);
  } catch {
    out.call_coach = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("comms:flags:status:lastRun", "json");
    out.comms_coherence = signalFromJudged(
      "comms_coherence",
      judgeLastRun(rec, {
        maxAgeH: 30,
        okPredicate: (x) => x.status === "ok" && !(x.failed > 0 && x.evaluated === 0),
        detail: (x) =>
          x.flagged != null
            ? `${x.flagged} flagged · ${x.evaluated ?? 0} evaluated · ${x.failed ?? 0} failed`
            : "ok",
      }),
    );
  } catch {
    out.comms_coherence = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:reminder-engine:lastRun", "json");
    out.reminder_engine = signalFromJudged(
      "reminder_engine",
      judgeLastRun(rec, {
        maxAgeH: 1,
        okPredicate: (x) => x.status === "ok" || x.status == null,
        detail: (x) => {
          const bits = [];
          if (x.due != null) bits.push(`${x.due} due`);
          if (x.would_send != null) bits.push(`${x.would_send} would_send`);
          if (x.sent != null) bits.push(`${x.sent} sent`);
          if (x.failed) bits.push(`${x.failed} failed`);
          return bits.join(" · ") || "ok";
        },
      }),
    );
  } catch {
    out.reminder_engine = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get("ops:nurture-engine:lastRun", "json");
    out.nurture_engine = signalFromJudged(
      "nurture_engine",
      judgeLastRun(rec, {
        maxAgeH: 1,
        okPredicate: (x) => x.status === "ok" || x.status == null,
        detail: (x) => {
          const bits = [];
          if (x.due != null) bits.push(`${x.due} due`);
          if (x.would_send != null) bits.push(`${x.would_send} would_send`);
          if (x.sent != null) bits.push(`${x.sent} sent`);
          if (x.failed) bits.push(`${x.failed} failed`);
          return bits.join(" · ") || "ok";
        },
      }),
    );
  } catch {
    out.nurture_engine = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const beat = await kv.get("ops:beat:field-id-check", "json");
    out.field_id_check = signalFromJudged(
      "field_id_check",
      judgeLastRun(beat, {
        maxAgeH: 30,
        okPredicate: (x) => x.ok !== false,
        detail: (x) => (x.producedN != null ? `${x.producedN} files scanned` : "ok"),
      }),
    );
  } catch {
    out.field_id_check = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const now = new Date();
    const ds = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * HOUR).toISOString().slice(0, 10);
    const rec =
      (await kv.get(`ops:ecosystem-scan:${ds}`, "json")) ||
      (await kv.get(`ops:ecosystem-scan:${yesterday}`, "json"));
    out.ecosystem_scan = signalFromJudged(
      "ecosystem_scan",
      judgeLastRun(rec, {
        maxAgeH: 30,
        okPredicate: (x) => !!x && !x.error,
        detail: (x) => {
          const n = Array.isArray(x.updates) ? x.updates.length : 0;
          return `${n} update${n === 1 ? "" : "s"} · ${x.scanDate || "?"}`;
        },
      }),
    );
    if (rec?.updates?.length) {
      out.ecosystem_scan.log = rec.updates.slice(0, 15).map((u, i) => ({
        id: `eco_${i}`,
        at: rec.ranAt || new Date().toISOString(),
        atMs: Date.parse(rec.ranAt || "") || Date.now(),
        pathId: "ecosystem_scan",
        hopId: u.source || "update",
        outcome: "ok",
        summary: `${u.repo || u.title || "update"}${u.summary ? ` — ${String(u.summary).slice(0, 80)}` : ""}`,
      }));
    }
  } catch {
    out.ecosystem_scan = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
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
  } catch {
    /* leave planned/unwatched */
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

/**
 * Call coach = on-demand. Green when OpenRouter + GHL look ready (fresh probe).
 * lastRun is informational only (does not go red for "stale / never ran").
 */
function judgeCallCoachReadiness(ready, last, { maxAgeH = 36 } = {}) {
  const lastNote =
    last && (last.finishedAt || last.startedAt)
      ? last.status === "error" || (last.failed > 0 && last.coached === 0 && last.contactsProcessed > 0)
        ? ` · last run failed ${fmtAge(ageHours(last.finishedAt || last.startedAt))}`
        : last.status === "running"
          ? ` · run in progress`
          : last.contactsProcessed != null
            ? ` · last ${last.coached ?? 0}/${last.contactsProcessed} ${fmtAge(ageHours(last.finishedAt || last.startedAt))}`
            : ` · last run ${fmtAge(ageHours(last.finishedAt || last.startedAt))}`
      : " · no coaching run yet";

  if (!ready) {
    return {
      status: "unknown",
      note: `no readiness probe${lastNote}`,
      why: "Call coach has not written call-coach:status:ready yet — cron /ready may be down.",
      lastAt: last?.finishedAt || last?.startedAt || null,
      detail: { ready: null, lastRun: last || null, mode: "on-demand" },
      log: lastRunAsLog("call_coach", {
        status: "unknown",
        lastAt: last?.finishedAt || last?.startedAt || null,
        detail: last,
        note: "no readiness probe",
      }),
    };
  }

  const at = ready.checkedAt || null;
  const age = ageHours(at);
  const stale = age == null || age > maxAgeH;
  const baseDetail = { ready, lastRun: last || null, mode: "on-demand" };

  if (!ready.ok) {
    const note = `not ready · ${ready.error || "OpenRouter or GHL token"}${lastNote}`;
    return {
      status: "red",
      note,
      why: note,
      lastAt: at,
      detail: baseDetail,
      log: lastRunAsLog("call_coach", { status: "red", lastAt: at, detail: ready, note }),
    };
  }
  if (stale) {
    const note = `readiness stale — last ${fmtAge(age)} (want < ${maxAgeH}h)${lastNote}`;
    return {
      status: "red",
      note,
      why: note,
      lastAt: at,
      detail: baseDetail,
      log: lastRunAsLog("call_coach", { status: "red", lastAt: at, detail: ready, note }),
    };
  }

  const modelBit = ready.model ? ` · ${ready.model}` : "";
  const note = `ready · on-demand${modelBit}${lastNote}`;
  return {
    status: "green",
    note,
    why: note,
    lastAt: at,
    detail: baseDetail,
    log: lastRunAsLog("call_coach", { status: "green", lastAt: at, detail: ready, note }),
  };
}

export const __test = {
  readInfraSignals,
  judgeLastRun,
  judgeCallCoachReadiness,
  ageHours,
  fmtAge,
  indexRecentOpsErrors,
};
