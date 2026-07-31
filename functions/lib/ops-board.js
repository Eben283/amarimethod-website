// Amari Ops board assembly — registry + open incidents + live infra signals.
// Read path for /api/ops/systems. No Fix actions. Never fake-green unwatched rows.
//
// Row roles (ops-board-meta): hot = pay/book early warning; quiet = messaging;
// map = blast-radius. States: healthy | sick | stuck | idle | blind | map_ok | map_bad.

import { OPS_ERR_PATH_SOURCES, OPS_REGISTRY, registryPath } from "./ops-registry.js";
import {
  countOpenIncidentsByPath,
  listOpsEvents,
  listOpsIncidents,
} from "./ops-events.js";
import { listOpsErrors } from "./ops-alert.js";
import { trailMeta } from "./ops-trail-kv.js";
import {
  boardMetaFor,
  isAttentionState,
  OPS_BOARD_ROLE,
  OPS_ROW_STATE,
} from "./ops-board-meta.js";
import { OPS_LAST_RUN_KEYS, OPS_READY_KEYS } from "./ops-last-run.js";

const HOUR = 3600 * 1000;
const ERR_LOOKBACK_H = 72;
const HOT_HEALTHY_MAX_AGE_H = 72;
const STUCK_REASON_CODES = new Set([
  "book_failed",
  "no_appointment_silent",
  "slot_missing",
  "stuck_hop",
]);

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

function eventLooksStuck(evt) {
  if (!evt) return false;
  if (evt.outcome === "fail" && STUCK_REASON_CODES.has(evt.reasonCode)) return true;
  if (evt.hopId === "create_appointment" && evt.outcome === "fail") return true;
  return false;
}

function mapInfraToRowState(signalStatus) {
  if (signalStatus === "red") return OPS_ROW_STATE.MAP_BAD;
  if (signalStatus === "green") return OPS_ROW_STATE.MAP_OK;
  return OPS_ROW_STATE.IDLE;
}

function judgePathRow(reg, { openCount, latest, errs }) {
  const meta = boardMetaFor(reg.id);
  const role = meta.role;

  if (openCount > 0) {
    const stuck =
      latest && eventLooksStuck(latest)
        ? OPS_ROW_STATE.STUCK
        : OPS_ROW_STATE.SICK;
    return {
      state: stuck,
      note:
        openCount === 1
          ? stuck === OPS_ROW_STATE.STUCK
            ? "1 stuck journey"
            : "1 open incident"
          : `${openCount} open incidents`,
      why: latest?.summary || null,
      lastAt: latest?.at || null,
    };
  }

  if (reg.instrumentation === "planned") {
    return {
      state: role === OPS_BOARD_ROLE.QUIET ? OPS_ROW_STATE.IDLE : OPS_ROW_STATE.BLIND,
      note:
        role === OPS_BOARD_ROLE.QUIET
          ? "quiet · no collision signal"
          : "map only · not owned yet",
      why: null,
      lastAt: null,
    };
  }

  if (reg.instrumentation === "partial") {
    if (errs?.length) {
      return {
        state: OPS_ROW_STATE.SICK,
        note: `${errs.length} recent failure${errs.length === 1 ? "" : "s"}`,
        why: errs[0].summary,
        lastAt: errs[0].at,
      };
    }
    return {
      state: OPS_ROW_STATE.IDLE,
      note: "quiet · watching for failures",
      why: null,
      lastAt: null,
    };
  }

  // full
  if (latest) {
    if (latest.outcome === "fail") {
      const stuck = eventLooksStuck(latest);
      return {
        state: stuck ? OPS_ROW_STATE.STUCK : OPS_ROW_STATE.SICK,
        note: latest.summary || (stuck ? "stuck hop" : "latest hop failed"),
        why: latest.summary,
        lastAt: latest.at,
      };
    }
    const age = ageHours(latest.at);
    if (role === OPS_BOARD_ROLE.HOT && age != null && age > HOT_HEALTHY_MAX_AGE_H) {
      return {
        state: OPS_ROW_STATE.IDLE,
        note: `quiet · last ${fmtAge(age)}`,
        why: latest.summary,
        lastAt: latest.at,
      };
    }
    if (role === OPS_BOARD_ROLE.QUIET) {
      return {
        state: OPS_ROW_STATE.HEALTHY,
        note: `quiet · last ${fmtAge(age)}`,
        why: latest.summary,
        lastAt: latest.at,
      };
    }
    return {
      state: OPS_ROW_STATE.HEALTHY,
      note: `last hop ${fmtAge(age)}`,
      why: latest.summary,
      lastAt: latest.at,
    };
  }

  if (role === OPS_BOARD_ROLE.QUIET) {
    return {
      state: OPS_ROW_STATE.IDLE,
      note: "quiet · watching",
      why: null,
      lastAt: null,
    };
  }
  if (role === OPS_BOARD_ROLE.HOT) {
    return {
      state: OPS_ROW_STATE.IDLE,
      note: "watching — no trail yet",
      why: null,
      lastAt: null,
    };
  }
  return {
    state: OPS_ROW_STATE.IDLE,
    note: "on map",
    why: null,
    lastAt: null,
  };
}

function buildHotStrip(systems, openIncidentsSample) {
  const hot = systems.filter((s) => s.boardRole === OPS_BOARD_ROLE.HOT);
  const sick = hot.filter((s) => s.state === OPS_ROW_STATE.SICK);
  const stuck = hot.filter((s) => s.state === OPS_ROW_STATE.STUCK);
  const healthy = hot.filter((s) => s.state === OPS_ROW_STATE.HEALTHY);
  const people = (openIncidentsSample || [])
    .filter((i) => i.personLabel || i.contactId || i.correlationId)
    .slice(0, 5)
    .map((i) => ({
      personLabel: i.personLabel || null,
      contactId: i.contactId || null,
      correlationId: i.correlationId || null,
      pathId: i.pathId,
      title: i.title,
      failedHopId: i.failedHopId || null,
    }));

  let headline = "Pay → book → confirm quiet";
  let tone = "healthy";
  if (stuck.length || sick.length) {
    tone = stuck.length ? "stuck" : "sick";
    const bits = [];
    if (stuck.length) bits.push(`${stuck.length} stuck`);
    if (sick.length) bits.push(`${sick.length} failing`);
    headline = bits.join(" · ");
  } else if (healthy.length) {
    headline = `${healthy.length} hot path${healthy.length === 1 ? "" : "s"} healthy`;
  }

  return {
    tone,
    headline,
    checkout: sick.find((s) => s.id === "discovery_free_book" || s.id === "assessment_paid_book")
      ? "fail"
      : healthy.length
        ? "ok"
        : "idle",
    payment: healthy.length || stuck.length ? "ok" : "idle",
    paidToBook: stuck.length ? "stuck" : sick.length ? "fail" : healthy.length ? "ok" : "idle",
    people,
  };
}

/**
 * Home board rows: paths first, then messaging, then infra.
 * States: healthy | sick | stuck | idle | blind | map_ok | map_bad
 */
export async function buildSystemsBoard(env) {
  const [openByPath, infra, meta, errIndex, openIncidents] = await Promise.all([
    countOpenIncidentsByPath(env),
    readInfraSignals(env),
    trailMeta(env),
    indexRecentOpsErrors(env),
    listOpsIncidents(env, { status: "open", limit: 30 }),
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
    const metaRow = boardMetaFor(reg.id);
    let state = OPS_ROW_STATE.IDLE;
    let note = null;
    let lastAt = null;
    let why = null;
    // legacy status for older clients / alerts: red|green|unknown
    let status = "unknown";

    if (reg.kind === "dependency") {
      const signal = infra[reg.id];
      if (signal) {
        state = mapInfraToRowState(signal.status);
        note = signal.note;
        lastAt = signal.lastAt || null;
        why = signal.why || null;
        status = signal.status;
      } else if (reg.instrumentation === "planned") {
        state = OPS_ROW_STATE.BLIND;
        note = "map only · not owned yet";
        status = "unknown";
      } else {
        state = OPS_ROW_STATE.IDLE;
        note = "on map · no signal yet";
        status = "unknown";
      }
    } else {
      const judged = judgePathRow(reg, {
        openCount,
        latest: pathActivity[reg.id],
        errs: errIndex.byPath[reg.id] || [],
      });
      state = judged.state;
      note = judged.note;
      why = judged.why;
      lastAt = judged.lastAt;
      status =
        state === OPS_ROW_STATE.SICK || state === OPS_ROW_STATE.STUCK
          ? "red"
          : state === OPS_ROW_STATE.HEALTHY
            ? "green"
            : "unknown";
    }

    return {
      id: reg.id,
      label: reg.label,
      kind: reg.kind,
      severity: reg.severity,
      group: reg.group || (reg.kind === "path" ? "paths" : "infra"),
      instrumentation: reg.instrumentation,
      boardRole: metaRow.role,
      state,
      status, // legacy
      note,
      why,
      lastAt,
      openIncidentCount: openCount,
      hops: reg.hops,
      changeSurface: metaRow.changeSurface,
    };
  });

  const groupRank = { paths: 0, messaging: 1, infra: 2 };
  const stateRank = {
    [OPS_ROW_STATE.SICK]: 0,
    [OPS_ROW_STATE.STUCK]: 1,
    [OPS_ROW_STATE.MAP_BAD]: 2,
    [OPS_ROW_STATE.HEALTHY]: 3,
    [OPS_ROW_STATE.MAP_OK]: 4,
    [OPS_ROW_STATE.IDLE]: 5,
    [OPS_ROW_STATE.BLIND]: 6,
  };
  systems.sort((a, b) => {
    const ga = groupRank[a.group] ?? 9;
    const gb = groupRank[b.group] ?? 9;
    if (ga !== gb) return ga - gb;
    const sa = stateRank[a.state] ?? 9;
    const sb = stateRank[b.state] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label);
  });

  const attention = systems.filter((s) => isAttentionState(s.state));
  const overall = attention.length
    ? "red"
    : systems.some((s) => s.state === OPS_ROW_STATE.HEALTHY || s.state === OPS_ROW_STATE.MAP_OK)
      ? "green"
      : "unknown";

  return {
    overall,
    attentionCount: attention.length,
    hotStrip: buildHotStrip(systems, openIncidents),
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
 * Includes people[] for opening person timelines from this path.
 */
export async function buildPathDetail(env, pathId) {
  const reg = registryPath(pathId);
  if (!reg) return null;
  const metaRow = boardMetaFor(pathId);

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
    const state = mapInfraToRowState(signal.status);
    return {
      id: reg.id,
      label: reg.label,
      kind: reg.kind,
      severity: reg.severity,
      group: reg.group || "infra",
      instrumentation: reg.instrumentation,
      boardRole: metaRow.role,
      state,
      status: signal.status,
      note: signal.note,
      hops: [],
      incidents: [],
      people: [],
      events: signal.log || [],
      why: signal.why,
      signalDetail: signal.detail || null,
      relatedErrors: relatedErrs,
      changeSurface: metaRow.changeSurface,
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
    let hopState = "idle";
    if (failedHopId && h.id === failedHopId) {
      hopState = eventLooksStuck(latest) || h.id === "create_appointment" ? "stuck" : "fail";
    } else if (latest?.outcome === "fail") {
      hopState = eventLooksStuck(latest) ? "stuck" : "fail";
    } else if (latest?.outcome === "skip") hopState = "skip";
    else if (latest?.outcome === "ok") hopState = "ok";
    else if (reg.instrumentation !== "full") hopState = "unwatched";
    return {
      id: h.id,
      label: h.label,
      state: hopState,
      latest: latest
        ? {
            outcome: latest.outcome,
            summary: latest.summary,
            at: latest.at,
            condition: latest.condition,
            reasonCode: latest.reasonCode || null,
          }
        : null,
    };
  });

  const latest = events[0] || null;
  const judged = judgePathRow(reg, {
    openCount: incidents.length,
    latest,
    errs: relatedErrors,
  });

  const people = [];
  const seen = new Set();
  for (const inc of incidents) {
    const key = inc.contactId || inc.correlationId || inc.personLabel;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    people.push({
      personLabel: inc.personLabel || null,
      contactId: inc.contactId || null,
      correlationId: inc.correlationId || null,
      title: inc.title,
      failedHopId: inc.failedHopId || null,
      openedAt: inc.openedAt || null,
      pill: eventLooksStuck({ outcome: "fail", hopId: inc.failedHopId, reasonCode: "stuck_hop" })
        ? "stuck hop"
        : "incident",
    });
  }
  for (const e of events) {
    const key = e.contactId || e.correlationId || e.personLabel;
    if (!key || seen.has(key)) continue;
    if (!e.personLabel && !e.contactId) continue;
    seen.add(key);
    people.push({
      personLabel: e.personLabel || null,
      contactId: e.contactId || null,
      correlationId: e.correlationId || null,
      title: e.summary,
      failedHopId: e.outcome === "fail" ? e.hopId : null,
      openedAt: e.at || null,
      pill: eventLooksStuck(e) ? "stuck hop" : e.outcome === "fail" ? "fail" : "ok",
    });
    if (people.length >= 12) break;
  }

  return {
    id: reg.id,
    label: reg.label,
    kind: reg.kind,
    severity: reg.severity,
    group: reg.group || "paths",
    instrumentation: reg.instrumentation,
    boardRole: metaRow.role,
    laws: reg.laws,
    state: judged.state,
    status:
      judged.state === OPS_ROW_STATE.SICK || judged.state === OPS_ROW_STATE.STUCK
        ? "red"
        : judged.state === OPS_ROW_STATE.HEALTHY
          ? "green"
          : "unknown",
    note: judged.note,
    why: judged.why,
    hops,
    incidents,
    people,
    events,
    relatedErrors,
    changeSurface: metaRow.changeSurface,
    generatedAt: new Date().toISOString(),
    configured: !!env?.AUTOMATION_DB,
  };
}

/**
 * Person timeline for a path journey — Sean / Holly shaped.
 * Query: pathId + (contactId | correlationId)
 */
export async function buildPersonTimeline(env, { pathId, contactId, correlationId } = {}) {
  const reg = registryPath(pathId);
  if (!reg) return null;
  if (!contactId && !correlationId) return null;
  const metaRow = boardMetaFor(pathId);

  const [events, incidents] = await Promise.all([
    listOpsEvents(env, { pathId, contactId: contactId || undefined, correlationId: correlationId || undefined, limit: 60 }),
    listOpsIncidents(env, { pathId, status: "open", limit: 20 }),
  ]);

  const mine = incidents.filter(
    (i) =>
      (contactId && i.contactId === contactId) ||
      (correlationId && i.correlationId === correlationId),
  );

  const personLabel =
    mine[0]?.personLabel ||
    events.find((e) => e.personLabel)?.personLabel ||
    null;

  const siteHops = [];
  const automationHops = [];
  for (const e of [...events].reverse()) {
    const hopStatus =
      e.outcome === "ok"
        ? "ok"
        : e.outcome === "skip"
          ? "skip"
          : eventLooksStuck(e)
            ? "stuck"
            : "fail";
    const entry = {
      hopId: e.hopId,
      label: (reg.hops || []).find((h) => h.id === e.hopId)?.label || e.hopId,
      status: hopStatus,
      detail: e.summary,
      at: e.at,
      condition: e.condition || null,
      reasonCode: e.reasonCode || null,
      message: e.message || null,
    };
    // Site vs automation: first owned "create_checkout" / "submit" / "staff_book" / "pay_followup" / "auth" = site;
    // payment/webhook/send/guard = automation. Simple split.
    if (
      ["create_checkout", "submit", "staff_book", "pay_followup", "auth", "ledger_gate"].includes(
        e.hopId,
      )
    ) {
      siteHops.push(entry);
    } else {
      automationHops.push(entry);
    }
  }

  // Pending confirmation when book stuck
  const bookStuck = automationHops.some(
    (h) => h.hopId === "create_appointment" && (h.status === "stuck" || h.status === "fail"),
  );
  if (bookStuck && !automationHops.some((h) => /confirm/i.test(h.label))) {
    automationHops.push({
      hopId: "confirmation",
      label: "Confirmation",
      status: "pending",
      detail: "Waiting on appointment — client may never get it",
      at: null,
      condition: null,
      reasonCode: "pending_confirmation",
      message: null,
    });
  }

  const failOrStuck =
    [...siteHops, ...automationHops].find((h) => h.status === "stuck" || h.status === "fail") ||
    null;

  let why = null;
  let nextIfUnchanged = null;
  if (failOrStuck) {
    if (failOrStuck.status === "stuck" || failOrStuck.hopId === "create_appointment") {
      why =
        failOrStuck.condition?.observed
          ? `Stuck at paid → book. Expected ${failOrStuck.condition.expected}; saw ${failOrStuck.condition.observed}.`
          : "Stuck at paid → book. Data present; hop didn’t connect to appointment create.";
      nextIfUnchanged = "Client never gets confirmation.";
    } else if (pathId === "partner_welcome_message" || /welcome|please.book/i.test(failOrStuck.detail || "")) {
      why = "Welcome flow didn’t know they’d already booked.";
      nextIfUnchanged = "Remaining welcome steps may still be queued.";
    } else {
      why = failOrStuck.detail || "Hop failed.";
      nextIfUnchanged = "Journey stays broken until this hop is fixed.";
    }
  }

  const pill =
    failOrStuck?.status === "stuck"
      ? "stuck hop"
      : failOrStuck
        ? pathId === "partner_welcome_message"
          ? "collision"
          : "fail"
        : "ok";

  return {
    view: "person",
    pathId: reg.id,
    pathLabel: reg.label,
    personLabel,
    contactId: contactId || mine[0]?.contactId || events[0]?.contactId || null,
    correlationId: correlationId || mine[0]?.correlationId || events[0]?.correlationId || null,
    pill,
    severity: reg.severity,
    boardRole: metaRow.role,
    site: siteHops,
    automation: automationHops,
    why,
    nextIfUnchanged,
    changeSurface: metaRow.changeSurface,
    incidents: mine,
    generatedAt: new Date().toISOString(),
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

  // ── Apps / auth / availability / Stripe ───────────────────────────────
  try {
    const rec = await kv.get(OPS_LAST_RUN_KEYS.morningSms, "json");
    out.morning_sms = signalFromJudged(
      "morning_sms",
      judgeLastRun(rec, {
        maxAgeH: 26,
        okPredicate: (x) => x.status === "ok" || (x.status == null && !(x.errors?.length)),
        detail: (x) => {
          const sends = Array.isArray(x.sends) ? x.sends.length : x.sendCount;
          const errs = Array.isArray(x.errors) ? x.errors.length : x.errorCount;
          const bits = [];
          if (x.mode) bits.push(x.mode);
          if (sends != null) bits.push(`${sends} send${sends === 1 ? "" : "s"}`);
          if (errs) bits.push(`${errs} err`);
          if (x.schedule?.reason) bits.push(x.schedule.reason);
          return bits.join(" · ") || "ok";
        },
      }),
    );
  } catch {
    out.morning_sms = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    out.chief_of_staff = await judgeChiefOfStaff(kv);
  } catch {
    out.chief_of_staff = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    out.staff_auth = signalFromJudged(
      "staff_auth",
      judgeInteractiveOk(await kv.get(OPS_LAST_RUN_KEYS.staffAuth, "json"), {
        label: "staff login",
      }),
    );
  } catch {
    out.staff_auth = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const [auth, verify] = await Promise.all([
      kv.get(OPS_LAST_RUN_KEYS.portalAuth, "json"),
      kv.get(OPS_LAST_RUN_KEYS.portalVerify, "json"),
    ]);
    out.portal_auth = signalFromJudged("portal_auth", judgePortalAuth(auth, verify));
  } catch {
    out.portal_auth = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    const rec = await kv.get(OPS_LAST_RUN_KEYS.publicSlots, "json");
    out.public_slots = signalFromJudged(
      "public_slots",
      judgeLastRun(rec, {
        maxAgeH: 24,
        okPredicate: (x) => x.status === "ok",
        detail: (x) =>
          x.slotCount != null
            ? `${x.slotCount} slots · ${x.calendarId || "cal"}`
            : "ok",
      }),
    );
  } catch {
    out.public_slots = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  try {
    out.stripe = await judgeStripe(kv);
  } catch {
    out.stripe = { status: "unknown", note: "read failed", why: null, lastAt: null, log: [] };
  }

  return out;
}

/** Interactive apps: green on last ok (no stale-red), idle if never, red on error. */
function judgeInteractiveOk(rec, { label }) {
  if (!rec) {
    return {
      status: "unknown",
      note: "no login signal yet",
      lastAt: null,
      detail: null,
    };
  }
  const at = rec.finishedAt || rec.ranAt || rec.checkedAt;
  const age = ageHours(at);
  if (rec.status === "error" || rec.ok === false) {
    return {
      status: "red",
      note: rec.error || `${label} failed`,
      lastAt: at,
      detail: rec,
    };
  }
  return {
    status: "green",
    note: `last ok · ${fmtAge(age)}`,
    lastAt: at,
    detail: rec,
  };
}

function judgePortalAuth(auth, verify) {
  const latest = [auth, verify]
    .filter(Boolean)
    .sort((a, b) => {
      const ta = Date.parse(a.finishedAt || a.ranAt || "") || 0;
      const tb = Date.parse(b.finishedAt || b.ranAt || "") || 0;
      return tb - ta;
    })[0];
  if (!latest) {
    return { status: "unknown", note: "no portal auth signal yet", lastAt: null, detail: null };
  }
  const at = latest.finishedAt || latest.ranAt;
  if (latest.status === "error" || latest.ok === false) {
    return {
      status: "red",
      note: latest.error || "portal auth failed",
      lastAt: at,
      detail: { auth, verify },
    };
  }
  const bits = [];
  if (auth?.status === "ok") bits.push("link sent");
  if (verify?.status === "ok") bits.push("verified");
  return {
    status: "green",
    note: `${bits.join(" · ") || "ok"} · ${fmtAge(ageHours(at))}`,
    lastAt: at,
    detail: { auth, verify },
  };
}

async function judgeChiefOfStaff(kv) {
  const [ready, auth, chat] = await Promise.all([
    kv.get(OPS_READY_KEYS.cos, "json"),
    kv.get(OPS_LAST_RUN_KEYS.cosAuth, "json"),
    kv.get(OPS_LAST_RUN_KEYS.cosChat, "json"),
  ]);
  const readyAt = ready?.checkedAt || ready?.finishedAt;
  const authAt = auth?.finishedAt || auth?.ranAt;
  const chatAt = chat?.finishedAt || chat?.ranAt;
  const lastAt = [readyAt, authAt, chatAt]
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] || null;

  if (ready && ready.ok === false) {
    return {
      status: "red",
      note: ready.error || "chat not configured",
      why: ready.error || "cos:status:ready ok=false — ANTHROPIC_API_KEY or probe failed",
      lastAt: readyAt || lastAt,
      detail: { ready, auth, chat },
      log: lastRunAsLog("chief_of_staff", {
        status: "red",
        lastAt: readyAt,
        detail: ready,
        note: "not ready",
      }),
    };
  }
  if (chat && (chat.status === "error" || chat.ok === false)) {
    return {
      status: "red",
      note: chat.error || "last chat failed",
      why: chat.error || "ops:cos-chat:lastRun reported error",
      lastAt: chatAt || lastAt,
      detail: { ready, auth, chat },
      log: lastRunAsLog("chief_of_staff", {
        status: "red",
        lastAt: chatAt,
        detail: chat,
        note: "chat error",
      }),
    };
  }
  if (ready?.ok || auth?.status === "ok" || chat?.status === "ok") {
    const bits = [];
    if (ready?.ok) bits.push("Anthropic ready");
    if (auth?.status === "ok") bits.push(`login ${fmtAge(ageHours(authAt))}`);
    if (chat?.status === "ok") bits.push(`chat ${fmtAge(ageHours(chatAt))}`);
    return {
      status: "green",
      note: bits.join(" · ") || "ok",
      why: bits.join(" · "),
      lastAt,
      detail: { ready, auth, chat },
      log: lastRunAsLog("chief_of_staff", {
        status: "green",
        lastAt,
        detail: { ready, auth, chat },
        note: "ok",
      }),
    };
  }
  return {
    status: "unknown",
    note: "no CoS signal yet",
    why: "No cos:status:ready / login / chat heartbeat in KV — open /cos once to seed.",
    lastAt: null,
    detail: { ready, auth, chat },
    log: [],
  };
}

async function judgeStripe(kv) {
  const [ready, webhook] = await Promise.all([
    kv.get(OPS_READY_KEYS.stripe, "json"),
    kv.get(OPS_LAST_RUN_KEYS.stripeWebhook, "json"),
  ]);
  const readyAt = ready?.checkedAt || ready?.finishedAt;
  const hookAt = webhook?.finishedAt || webhook?.ranAt;
  const lastAt = [readyAt, hookAt]
    .filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] || null;

  if (ready && ready.ok === false) {
    return {
      status: "red",
      note: ready.error || "Stripe not configured",
      why: ready.error || "stripe:status:ready ok=false",
      lastAt: readyAt || lastAt,
      detail: { ready, webhook },
      log: lastRunAsLog("stripe", { status: "red", lastAt: readyAt, detail: ready, note: "not ready" }),
    };
  }
  if (webhook && (webhook.status === "error" || webhook.ok === false)) {
    return {
      status: "red",
      note: webhook.error || "POS webhook failed",
      why: webhook.error || "ops:stripe-pos-webhook:lastRun error",
      lastAt: hookAt || lastAt,
      detail: { ready, webhook },
      log: lastRunAsLog("stripe", { status: "red", lastAt: hookAt, detail: webhook, note: "webhook error" }),
    };
  }
  if (ready?.ok || webhook?.status === "ok") {
    const bits = [];
    if (ready?.ok) bits.push(`API ${fmtAge(ageHours(readyAt))}`);
    if (webhook?.status === "ok") bits.push(`webhook ${fmtAge(ageHours(hookAt))}`);
    // Webhook can be quiet for days — don't stale-red if API readiness is ok.
    // If only webhook and it's >7d, soft idle.
    if (!ready?.ok && hookAt && ageHours(hookAt) > 7 * 24) {
      return {
        status: "unknown",
        note: `quiet · last webhook ${fmtAge(ageHours(hookAt))}`,
        why: "No recent Stripe API probe; last POS webhook is old.",
        lastAt: hookAt,
        detail: { ready, webhook },
        log: [],
      };
    }
    return {
      status: "green",
      note: bits.join(" · ") || "ok",
      why: bits.join(" · "),
      lastAt,
      detail: { ready, webhook },
      log: lastRunAsLog("stripe", { status: "green", lastAt, detail: { ready, webhook }, note: "ok" }),
    };
  }
  return {
    status: "unknown",
    note: "no Stripe signal yet",
    why: "No stripe:status:ready or POS webhook lastRun — use Staff POS / cards once to seed.",
    lastAt: null,
    detail: { ready, webhook },
    log: [],
  };
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
  eventLooksStuck,
  judgePathRow,
  buildHotStrip,
  mapInfraToRowState,
  judgeInteractiveOk,
  judgePortalAuth,
  judgeChiefOfStaff,
  judgeStripe,
};
