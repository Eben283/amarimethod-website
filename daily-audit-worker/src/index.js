// Daily Audit Worker — runs at 4 AM Pacific via cron trigger.
// Executes all 5 QA audit rule sets against GHL data and caches results in KV.
// Results are read by /api/daily-audit Pages Function → consumed by /day skill.

import { ghlFetch, fetchAppointmentsForDate, todayPacific, LOCATION_ID, ContactCache } from "./ghl.js";
import { auditAppointments, auditPurchases, auditTagConsistency, auditCommunications, auditStateMismatches } from "./rules.js";

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

  // Run all 5 rule sets sequentially (they share the cache and may make API calls)
  const apptIssues = await auditAppointments(ctx);
  const purchaseResult = await auditPurchases(ctx);
  const consistencyIssues = await auditTagConsistency(ctx);
  const commIssues = await auditCommunications(ctx);
  const mismatchIssues = await auditStateMismatches(ctx);

  const allIssues = [
    ...apptIssues,
    ...purchaseResult.issues,
    ...consistencyIssues,
    ...commIssues,
    ...mismatchIssues,
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
