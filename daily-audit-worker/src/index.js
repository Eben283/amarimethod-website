// Daily Audit Worker — runs at 4 AM Pacific via cron trigger.
// Executes all 5 QA audit rule sets against GHL data and caches results in KV.
// Results are read by /api/daily-audit Pages Function → consumed by /day skill.

import { ghlFetch, fetchAppointmentsForDate, todayPacific, LOCATION_ID, ContactCache } from "./ghl.js";
import { auditAppointments, auditPurchases, auditTagConsistency, auditSeriesTypeDrops, auditCommunications, auditStateMismatches } from "./rules.js";

const AUDIT_KV_PREFIX = "ops:daily-audit:";
const AUDIT_HOURS = 48;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAudit(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__scheduled" || url.pathname === "/run") {
      const result = await runAudit(env);
      return jsonResponse(result);
    }

    if (url.pathname === "/latest") {
      const date = url.searchParams.get("date") || todayPacific();
      const data = await env.PORTAL_KV.get(`${AUDIT_KV_PREFIX}${date}`, "json");
      if (!data) return jsonResponse({ error: "No audit for this date" }, 404);
      return jsonResponse(data);
    }

    return new Response("Not found", { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runAudit(env) {
  const today = todayPacific();
  const auditEnd = Date.now();
  const auditStart = auditEnd - AUDIT_HOURS * 60 * 60 * 1000;

  console.log(`[daily-audit] Starting audit for ${today} (${AUDIT_HOURS}h lookback)`);

  // Determine dates to scan
  const dates = new Set();
  for (
    let d = new Date(auditStart);
    d <= new Date(auditEnd);
    d.setDate(d.getDate() + 1)
  ) {
    dates.add(d.toISOString().split("T")[0]);
  }

  // Fetch all appointments
  let allAppointments = [];
  for (const dateStr of dates) {
    try {
      const appts = await fetchAppointmentsForDate(env, dateStr);
      allAppointments = [...allAppointments, ...appts];
    } catch (err) {
      console.error(`[daily-audit] Appointments for ${dateStr}: ${err.message}`);
    }
  }

  // Deduplicate by appointment ID
  const seen = new Set();
  allAppointments = allAppointments.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Pre-warm contact cache with appointment contacts
  const cache = new ContactCache(env);
  for (const appt of allAppointments) {
    if (appt.contactId) await cache.getContact(appt.contactId);
  }

  const ctx = { env, cache, appointments: allAppointments, auditStart, auditEnd };

  // Run all rule sets sequentially (they share the cache and may make API calls)
  const apptIssues = await auditAppointments(ctx);
  const purchaseResult = await auditPurchases(ctx);
  const consistencyIssues = await auditTagConsistency(ctx);
  const seriesDropIssues = await auditSeriesTypeDrops(ctx);
  const commIssues = await auditCommunications(ctx);
  const mismatchIssues = await auditStateMismatches(ctx);

  // Watchdog: flag if the partner-activity-refresh sister Worker hasn't run
  // recently. Silent-failure defense — surfaces in the /day briefing within
  // ~24h of the refresh job dying so we notice before the Outreach data goes
  // weeks stale.
  const refreshWatchdogIssues = await checkPartnerActivityRefresh(env);

  // Same pattern for series-reconcile sister Worker (hourly cron, catches
  // orphan paid package purchases that bypass the C-series GHL workflow).
  // Stale here means uncaught orphans accumulate silently.
  const seriesReconcileWatchdogIssues = await checkSeriesReconcile(env);

  const allIssues = [
    ...apptIssues,
    ...purchaseResult.issues,
    ...consistencyIssues,
    ...seriesDropIssues,
    ...commIssues,
    ...mismatchIssues,
    ...refreshWatchdogIssues,
    ...seriesReconcileWatchdogIssues,
  ];

  const result = {
    auditPeriod: {
      start: new Date(auditStart).toISOString(),
      end: new Date(auditEnd).toISOString(),
    },
    summary: {
      contactsAudited: cache.contacts.size,
      appointmentsChecked: allAppointments.length,
      purchasesChecked: purchaseResult.purchasesChecked,
      issuesFound: allIssues.length,
      critical: allIssues.filter((i) => i.severity === "critical").length,
      warnings: allIssues.filter((i) => i.severity === "warning").length,
      info: allIssues.filter((i) => i.severity === "info").length,
    },
    ranAt: new Date().toISOString(),
    issues: allIssues,
  };

  // Write to KV with 7-day TTL
  await env.PORTAL_KV.put(
    `${AUDIT_KV_PREFIX}${today}`,
    JSON.stringify(result),
    { expirationTtl: 7 * 86400 }
  );

  console.log(
    `[daily-audit] Done: ${allIssues.length} issues (${result.summary.critical} critical, ${result.summary.warnings} warnings)`
  );

  return result;
}

// Read the partner-activity-refresh Worker's lastRun summary from KV. Flag any of:
//   - Never run (KV key absent)
//   - Last run >36h ago (cron skipped, schedule may be broken)
//   - Last run reported status="error" (worker errored)
//   - Last run failed >5 contacts (transient GHL issues — info, not warning)
async function checkPartnerActivityRefresh(env) {
  const issues = [];
  const KEY = "ops:activity-refresh:lastRun";
  let raw;
  try {
    raw = await env.PORTAL_KV.get(KEY);
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "partner-activity-refresh-kv-unreadable",
      message: `partner-activity-refresh KV read failed: ${err.message}`,
    });
    return issues;
  }

  if (!raw) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "partner-activity-refresh-never-ran",
      message: "partner-activity-refresh Worker has never written a lastRun summary. Either it was deployed without running, or the KV namespace binding is wrong.",
    });
    return issues;
  }

  let summary;
  try { summary = JSON.parse(raw); }
  catch {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "partner-activity-refresh-corrupt",
      message: `partner-activity-refresh lastRun KV value is not valid JSON.`,
    });
    return issues;
  }

  const finishedAt = summary.finishedAt ? new Date(summary.finishedAt).getTime() : null;
  const ageH = finishedAt ? (Date.now() - finishedAt) / 3_600_000 : null;

  if (ageH === null || ageH > 36) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "partner-activity-refresh-stale",
      message: `partner-activity-refresh last ran ${ageH ? Math.round(ageH) + 'h ago' : 'unknown'}. Cron may be broken. Investigate at Cloudflare Dashboard → Workers → partner-activity-refresh.`,
      lastRun: summary.finishedAt,
    });
  }

  if (summary.status === "error") {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "partner-activity-refresh-errored",
      message: `partner-activity-refresh last run errored: ${summary.error || 'unknown error'}. ${summary.processed || 0} contacts processed, ${summary.written || 0} written, ${summary.failed || 0} failed.`,
      lastRun: summary.finishedAt,
    });
  } else if (summary.failed > 5) {
    issues.push({
      severity: "info",
      area: "infra",
      kind: "partner-activity-refresh-partial-failures",
      message: `partner-activity-refresh had ${summary.failed} per-contact failures on its last run. Check the Worker logs.`,
      lastRun: summary.finishedAt,
    });
  }

  return issues;
}

// Read the series-reconcile Worker's lastRun summary from KV. Flag any of:
//   - Never run (KV key absent)
//   - Last run >6h ago (Worker is hourly — even allowing for hiccups, >6h means broken)
//   - Last run reported status="error" (worker errored fully)
//   - Last run had >0 errored orders (per-order failures — paid clients not getting their packages applied)
//   - Last run applied >0 orphans (info — surface so we can investigate why they fell through)
async function checkSeriesReconcile(env) {
  const issues = [];
  const KEY = "ops:series-reconcile:lastRun";
  let raw;
  try {
    raw = await env.PORTAL_KV.get(KEY);
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-kv-unreadable",
      message: `series-reconcile KV read failed: ${err.message}`,
    });
    return issues;
  }

  if (!raw) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-never-ran",
      message: "series-reconcile Worker has never written a lastRun summary. Either it was deployed without running, or the KV binding is wrong.",
    });
    return issues;
  }

  let summary;
  try { summary = JSON.parse(raw); }
  catch {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-corrupt",
      message: "series-reconcile lastRun KV value is not valid JSON.",
    });
    return issues;
  }

  const finishedAt = summary.finishedAt ? new Date(summary.finishedAt).getTime() : null;
  const ageH = finishedAt ? (Date.now() - finishedAt) / 3_600_000 : null;

  if (ageH === null || ageH > 6) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-stale",
      message: `series-reconcile last ran ${ageH ? Math.round(ageH) + 'h ago' : 'unknown'}. Hourly cron may be broken — orphan package purchases would accumulate. Investigate at Cloudflare Dashboard → Workers → series-reconcile.`,
      lastRun: summary.finishedAt,
    });
  }

  if (summary.status === "error") {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-errored",
      message: `series-reconcile last run errored: ${summary.error || 'unknown error'}. ${summary.applied || 0} applied, ${summary.failed || 0} failed.`,
      lastRun: summary.finishedAt,
    });
  } else if (summary.failed > 0) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-per-order-failures",
      message: `series-reconcile had ${summary.failed} per-order failure(s) on its last run — paid clients may not have their packages applied. Check Worker logs.`,
      lastRun: summary.finishedAt,
    });
  }

  // Info-level surface: if we successfully reconciled orphans, that means the
  // GHL "Order Submitted" trigger missed them — worth knowing in the briefing.
  if (summary.applied > 0) {
    const detail = (summary.appliedDetail || [])
      .map((a) => `${a.contactName || a.contactId} (${a.package})`)
      .join(", ");
    issues.push({
      severity: "info",
      area: "infra",
      kind: "series-reconcile-applied-orphans",
      message: `series-reconcile auto-fixed ${summary.applied} orphan package purchase(s) on its last run: ${detail}. Workflow trigger silently missed these — confirm clients got expected onboarding.`,
      lastRun: summary.finishedAt,
    });
  }

  // Surface the "needs-review" queue — contacts whose session-field drift
  // was too large (>2 on either field) for the worker to auto-correct.
  // Read directly from KV by prefix.
  try {
    const list = await env.PORTAL_KV.list({ prefix: "field-sync:needsReview:" });
    if (list.keys.length > 0) {
      const items = await Promise.all(
        list.keys.slice(0, 10).map(async (k) => env.PORTAL_KV.get(k.name, "json"))
      );
      const names = items
        .filter(Boolean)
        .map((i) => `${i.contactName || i.contactId} (Δr=${i.delta?.sessions_remaining}, Δc=${i.delta?.sessions_completed})`)
        .join("; ");
      issues.push({
        severity: "warning",
        area: "data",
        kind: "session-fields-needs-review",
        message: `${list.keys.length} contact(s) have session-field drift too large to auto-correct — needs human review: ${names}`,
      });
    }
  } catch (err) {
    // Don't fail the watchdog if the KV scan errors.
    console.warn("[daily-audit] needs-review scan failed:", err.message);
  }

  return issues;
}
