// Daily Audit Worker — runs at 4 AM Pacific via cron trigger.
// Executes all 5 QA audit rule sets against GHL data and caches results in KV.
// Results are read by /api/daily-audit Pages Function → consumed by /day skill.

import { ghlFetch, fetchAppointmentsForDate, todayPacific, LOCATION_ID, FIELD_IDS, ContactCache, getAccessToken } from "./ghl.js";
import { auditAppointments, auditPurchases, auditTagConsistency, auditSeriesTypeDrops, auditCommunications, auditStateMismatches } from "./rules.js";
import { deriveLedger } from "../../functions/lib/session-ledger.js";
import { hydrateOrders } from "../../functions/lib/ghl-orders.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

const AUDIT_KV_PREFIX = "ops:daily-audit:";
const AUDIT_HOURS = 48;

// The session-ledger drift scan needs its OWN Cloudflare per-invocation
// subrequest budget — sharing the main audit's invocation blew the free-tier
// 50-subrequest cap (the drift walk ≈ 7 active-package contacts × ~5 GHL calls
// + paginated enumeration ≈ 50 subrequests tipped the cumulative count over and
// threw, emitting ZERO session-fields issues every run — verified 2026-06-03).
// We can't give it a second cron (account is at the 5-cron free-tier limit), so
// scheduled() self-fetches /run-drift to run it in a separate invocation.
// runLedgerDriftScan writes its findings to this key; checkSessionLedgerDrift
// (called inline by the main audit) just reads it — one cheap KV read instead
// of ~50 GHL subrequests.
const LEDGER_DRIFT_FINDINGS_KEY = "ops:ledger-drift:findings";
// Stale-findings guard: if the drift cron hasn't refreshed within this window,
// the main audit emits a watchdog warning (silent-failure defense, same shape
// as checkSeriesReconcile / checkPartnerActivityRefresh).
const LEDGER_DRIFT_STALE_MS = 26 * 60 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledAudit(env));
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    // /run = main audit only (reads existing drift findings from KV).
    // /__scheduled = the full cron path (refresh drift findings, then audit),
    // so the production trigger can be exercised end-to-end.
    if (url.pathname === "/run") {
      const result = await runAudit(env);
      return jsonResponse(result);
    }
    if (url.pathname === "/__scheduled") {
      const result = await runScheduledAudit(env);
      return jsonResponse(result);
    }

    // Run the ledger-drift scan: enumerate active-series contacts, derive each,
    // and persist findings to KV for the main audit to read. Invoked by
    // runScheduledAudit via the SELF service binding (fresh subrequest budget);
    // also hit manually to re-check after a contact's fields are fixed.
    if (url.pathname === "/run-drift") {
      const result = await runLedgerDriftScan(env);
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

// Cron entrypoint. Refresh the session-ledger drift findings FIRST — in a
// separate invocation with its own subrequest budget — via the SELF service
// binding (the heavy contact-walk blows the main audit's 50-cap inline; we can't
// add a second cron at the 5-cron free-tier limit; and a plain self-fetch of the
// worker's own URL 404s). The service binding dispatches /run-drift as a fresh
// invocation. We await it so findings are current before runAudit reads them; on
// failure runAudit's reader emits a stale/missing watchdog — never silent.
async function runScheduledAudit(env) {
  try {
    if (env.SELF) {
      // The /run-drift route is auth-gated (requireWorkerAuth). This self-call
      // must present the same secret, or the drift refresh 401s once the gate
      // is active. env.WORKER_AUTH_SECRET is undefined until the secret is set,
      // in which case the gate is a no-op and the empty header is fine.
      const headers = env.WORKER_AUTH_SECRET
        ? { Authorization: `Bearer ${env.WORKER_AUTH_SECRET}` }
        : undefined;
      const res = await env.SELF.fetch("https://daily-audit.internal/run-drift", { headers });
      await res.text();
      console.log(`[daily-audit] drift refresh (SELF binding) → ${res.status}`);
    } else {
      console.warn("[daily-audit] SELF binding missing — skipping drift refresh");
    }
  } catch (err) {
    console.warn(`[daily-audit] drift refresh failed: ${err.message}`);
  }
  return runAudit(env);
}

async function runAudit(env) {
  const today = todayPacific();
  const auditEnd = Date.now();
  const auditStart = auditEnd - AUDIT_HOURS * 60 * 60 * 1000;

  console.log(`[daily-audit] Starting audit for ${today} (${AUDIT_HOURS}h lookback)`);

  // Run the Stream-signing liveness probe FIRST — it's one cheap, independent
  // subrequest, and running it before the appointment/contact/ledger fetches
  // guarantees it isn't starved by Cloudflare's per-invocation subrequest cap.
  // Hits the production /api/stream-health (which exercises the real
  // CF_STREAM_TOKEN Pages env var). Catches a stale signing token within ~24h
  // instead of via a customer "the videos won't play" complaint (2026-06-02).
  const streamHealthIssues = await checkStreamSigningHealth(env);

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
  const appointmentFetchFailures = [];
  for (const dateStr of dates) {
    try {
      const { appointments: appts, failedCalendars } = await fetchAppointmentsForDate(env, dateStr);
      allAppointments = [...allAppointments, ...appts];
      if (failedCalendars.length > 0) {
        appointmentFetchFailures.push({ dateStr, failedCalendars });
      }
    } catch (err) {
      console.error(`[daily-audit] Appointments for ${dateStr}: ${err.message}`);
      appointmentFetchFailures.push({ dateStr, failedCalendars: [{ calendarId: "*", name: "all", error: err.message }] });
    }
  }

  // Deduplicate by appointment ID
  const seen = new Set();
  allAppointments = allAppointments.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Surface appointment-fetch failures as a real issue — an empty appointment
  // list from a GHL blip must read as "uninspected", never as "clean".
  const appointmentFetchIssues = [];
  if (appointmentFetchFailures.length > 0) {
    const detail = appointmentFetchFailures
      .map((f) => `${f.dateStr}: ${f.failedCalendars.map((c) => c.name || c.calendarId).join(", ")}`)
      .join(" | ");
    appointmentFetchIssues.push({
      severity: "warning",
      area: "infra",
      kind: "appointment-fetch-partial-failure",
      message: `Some calendars could not be fetched for the audit window (${detail}) — appointment-side rules ran with partial coverage.`,
    });
  }

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

  // Same pattern for ghl-token-refresh sister Worker (12h cron, refreshes
  // GHL OAuth tokens). Silent death = cascade 401s across every handler
  // that talks to GHL. No other watchdog covers this.
  const tokenRefreshWatchdogIssues = await checkTokenRefresh(env);

  // Same pattern for the call-coach sister Worker (daily coaching digest) —
  // previously unwatched; a mid-batch death left status "running" silently.
  const callCoachWatchdogIssues = await checkCallCoach(env);

  // Read the session-ledger drift findings produced by the separate drift cron
  // (runLedgerDriftScan, fired ~10 min earlier in its own invocation so the
  // heavy contact-walk doesn't compete for this invocation's subrequest cap).
  // One cheap KV read. Emits a watchdog warning if the findings are stale/missing.
  // This is the visibility piece — the Jenn Kadri 2026-06-03 silent bug sat
  // invisible for weeks because nothing surfaced the ambiguity array a human
  // could read.
  const ledgerDriftIssues = await checkSessionLedgerDrift(env);

  const allIssues = [
    ...apptIssues,
    ...purchaseResult.issues,
    ...consistencyIssues,
    ...seriesDropIssues,
    ...commIssues,
    ...mismatchIssues,
    ...refreshWatchdogIssues,
    ...seriesReconcileWatchdogIssues,
    ...tokenRefreshWatchdogIssues,
    ...callCoachWatchdogIssues,
    ...ledgerDriftIssues,
    ...streamHealthIssues,
    ...appointmentFetchIssues,
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

// Probe Cloudflare Stream signing via the production /api/stream-health
// endpoint, which mints a token using the real CF_STREAM_TOKEN Pages env var.
// token-invalid → CRITICAL (Living Practice videos are down). test-video-missing
// → info (the probe's UID needs updating, not the token). Unreachable/odd
// response → warning. See functions/api/stream-health.js + memory
// reference-cloudflare-stream-token.
async function checkStreamSigningHealth(env) {
  const issues = [];
  const URL = "https://www.amarimethod.com/api/stream-health";
  let res, json;
  try {
    res = await fetch(URL, { headers: { "Cache-Control": "no-store" } });
    json = await res.json().catch(() => null);
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "stream-health-unreachable",
      message: `Stream signing health probe could not reach ${URL}: ${err.message}`,
    });
    return issues;
  }

  if (!json || typeof json.healthy !== "boolean") {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "stream-health-bad-response",
      message: `Stream signing health probe returned an unexpected response (HTTP ${res.status}).`,
    });
    return issues;
  }

  if (!json.healthy) {
    if (json.reason === "test-video-missing") {
      issues.push({
        severity: "info",
        area: "infra",
        kind: "stream-health-test-video-missing",
        message: `Stream signing probe's test video (${json.testUid}) no longer exists. Update TEST_UID in functions/api/stream-health.js — the token itself is fine.`,
      });
    } else {
      issues.push({
        severity: "critical",
        area: "infra",
        kind: `stream-signing-${json.reason || "fail"}`,
        message: `Living Practice video signing is FAILING (reason=${json.reason}, HTTP ${json.status}${json.detail ? `: ${json.detail}` : ""}). CF_STREAM_TOKEN is likely stale/revoked — videos will not play. Roll the Stream token + update the Pages env var + retrigger deploy (memory: reference-cloudflare-stream-token).`,
      });
    }
  }

  return issues;
}

// Read the partner-activity-refresh Worker's lastRun summary from KV. Flag any of:
//   - Never run (KV key absent)
//   - Last run >36h ago (cron skipped, schedule may be broken)
//   - Last run reported status="error" (worker errored)
//   - Last run failed >5 contacts (transient GHL issues — info, not warning)
// Watchdog for the call-coach sister Worker (daily 11:07 cron). Two failure
// shapes: never/stale lastRun (cron dead), and status stuck at "running"
// (an invocation died mid-batch-chain — the 2026-07-02 audit's silent
// half-death). No other watchdog covered this worker.
async function checkCallCoach(env) {
  const issues = [];
  const KEY = "call-coach:status:lastRun";
  let summary;
  try {
    summary = await env.PORTAL_KV.get(KEY, "json");
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "call-coach-kv-unreadable",
      message: `call-coach lastRun KV read failed: ${err.message}`,
    });
    return issues;
  }
  if (!summary) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "call-coach-never-ran",
      message: "call-coach Worker has never written a lastRun summary — cron may be dead or the KV binding wrong.",
    });
    return issues;
  }
  const ts = summary.finishedAt || summary.startedAt || null;
  const ageH = ts ? (Date.now() - new Date(ts).getTime()) / 3_600_000 : null;
  if (ageH === null || ageH > 30) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "call-coach-stale",
      message: `call-coach last ran ${ageH ? Math.round(ageH) + "h ago" : "at an unknown time"} — the daily 11:07 UTC cron may be broken.`,
    });
  }
  if (summary.status === "running" && summary.startedAt) {
    const runH = (Date.now() - new Date(summary.startedAt).getTime()) / 3_600_000;
    if (runH > 3) {
      issues.push({
        severity: "warning",
        area: "infra",
        kind: "call-coach-stuck-running",
        message: `call-coach status has been "running" for ${Math.round(runH)}h — an invocation likely died mid-batch; digest for that day never built. Re-trigger via /run?date=...`,
      });
    }
  }
  return issues;
}

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
//   - Last run set orderPassError (order pass failed but the sweep still ran)
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
  } else if (summary.orderPassError) {
    // The order pass now fails independently of the field-sync sweep (so a flaky
    // orders-LIST fetch no longer skips the sweep). That resilience means the run
    // reports status="partial-errors" with failed=0 — surface the order-pass
    // failure here so it isn't silently buried in the summary.
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "series-reconcile-order-pass-failed",
      message: `series-reconcile order pass failed: ${summary.orderPassError}. The field-sync sweep still ran, but orphan package purchases in the window were NOT scanned — orphans would accumulate if this persists. Check Worker logs.`,
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

// ghl-token-refresh sister Worker (12h cron, refreshes GHL OAuth tokens
// into KV). Without this watchdog, a silent worker death would only
// surface when every other handler that talks to GHL started returning
// 401 simultaneously — i.e. a customer-facing incident. With the
// watchdog, we hear about it in the morning briefing instead.
//
// Adopts the same shape as checkPartnerActivityRefresh + checkSeriesReconcile.
// The token worker writes ops:ghl-token-refresh:lastRun on every run
// (success or fail) so we can distinguish "never ran" from "ran and failed."
async function checkTokenRefresh(env) {
  const issues = [];
  const KEY = "ops:ghl-token-refresh:lastRun";
  let raw;
  try {
    raw = await env.PORTAL_KV.get(KEY);
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ghl-token-refresh-kv-unreadable",
      message: `ghl-token-refresh KV read failed: ${err.message}`,
    });
    return issues;
  }

  // ghl_token_expiry is independent — read it too so we can warn if the
  // current token is close to expiring even if the refresh worker hasn't
  // crashed (e.g. it's running fine but GHL keeps rejecting the refresh).
  let tokenExpiryMs = null;
  try {
    const expStr = await env.PORTAL_KV.get("ghl_token_expiry");
    if (expStr) tokenExpiryMs = parseInt(expStr, 10);
  } catch {
    // Non-fatal — fall through.
  }

  if (!raw) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ghl-token-refresh-never-ran",
      message: "ghl-token-refresh Worker has never written a lastRun summary. Either it was deployed without running, or PORTAL_KV binding is wrong.",
    });
    return issues;
  }

  let summary;
  try { summary = JSON.parse(raw); }
  catch {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ghl-token-refresh-corrupt",
      message: "ghl-token-refresh lastRun KV value is not valid JSON.",
    });
    return issues;
  }

  const finishedAt = summary.finishedAt ? new Date(summary.finishedAt).getTime() : null;
  const ageH = finishedAt ? (Date.now() - finishedAt) / 3_600_000 : null;

  // Cron runs every 12h. >18h stale = cron skipped at least once.
  if (ageH === null || ageH > 18) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ghl-token-refresh-stale",
      message: `ghl-token-refresh last ran ${ageH ? Math.round(ageH) + 'h ago' : 'unknown'}. 12h cron may be broken — GHL handlers will start returning 401 within 24h if token isn't refreshed. Investigate at Cloudflare Dashboard → Workers → ghl-token-refresh.`,
      lastRun: summary.finishedAt,
    });
  }

  // Latched token-lost marker — checked SEPARATELY from lastRun because
  // lastRun is overwritten every cron: a token-lost event followed by a
  // routine failed attempt would otherwise downgrade to a generic error
  // before this audit reads it. The token worker clears the latch only on a
  // fully-persisted successful refresh.
  let tokenLostLatch = null;
  try {
    const latchRaw = await env.PORTAL_KV.get("ops:ghl-token-refresh:tokenLost");
    if (latchRaw) { try { tokenLostLatch = JSON.parse(latchRaw); } catch { tokenLostLatch = { at: "unknown" }; } }
  } catch { /* non-fatal — the summary.tokenLost branch below still covers the freshest run */ }

  if (tokenLostLatch || summary.tokenLost) {
    // Distinct from a routine failed attempt: the rotation SUCCEEDED at GHL
    // but the result was never persisted, so the stored refresh token is
    // likely dead and every GHL consumer bricks at the next refresh. This
    // needs a human (manual re-auth per reference-ghl-authclass-location-token),
    // not a wait-for-next-cron.
    issues.push({
      severity: "critical",
      area: "infra",
      kind: "ghl-token-refresh-token-lost",
      message: `ghl-token-refresh reported TOKEN-LOST${tokenLostLatch?.at ? ` at ${tokenLostLatch.at}` : ""}: ${summary.error || tokenLostLatch?.detail || "rotation succeeded but KV persist failed"}. The stored refresh token is likely dead — manual GHL re-auth will be required.`,
      lastRun: summary.finishedAt,
    });
  } else if (summary.status === "error") {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ghl-token-refresh-errored",
      message: `ghl-token-refresh last run errored: ${summary.error || 'unknown error'}.`,
      lastRun: summary.finishedAt,
    });
  }

  // Warn if the token itself is close to expiring (separate signal from
  // worker health — the worker might be running fine but the refresh
  // itself failing repeatedly).
  if (tokenExpiryMs !== null) {
    const hoursUntilExpiry = (tokenExpiryMs - Date.now()) / 3_600_000;
    if (hoursUntilExpiry < 4) {
      issues.push({
        severity: "warning",
        area: "infra",
        kind: "ghl-token-near-expiry",
        message: `GHL access token expires in ${hoursUntilExpiry.toFixed(1)}h. Next refresh cron may not run in time — manual refresh recommended via Cloudflare Dashboard → Workers → ghl-token-refresh → trigger.`,
        tokenExpiry: new Date(tokenExpiryMs).toISOString(),
      });
    }
  }

  return issues;
}

// Drift detector — runs the same deriveLedger every read endpoint uses
// against every contact with an active series, and surfaces:
//
//   - WARNING: derivation has ambiguities (confidence="low"). Worker skips
//     writes here, lock-or-fallback displays the field value instead of
//     derived. Garrett sees the right number in the app — but the
//     underlying disagreement should be investigated and either fixed
//     (correct the field, set the lock, adjust the cutoff logic) or
//     accepted (set lock if intentional).
//
//   - INFO: display.source !== "derived" — i.e. the contact is on a
//     manual lock or low-confidence fallback. Not necessarily wrong, but
//     worth knowing about so locks don't silently accumulate.
//
// Cost: one /contacts/search pass + per-contact (contact + orders +
// invoices + appointments + hydration). At ~10 active package contacts
// in steady state, ~50 GHL calls / run. Well under the 1000-subrequest
// paid cap.
// Inline reader called by runAudit. The heavy contact-walk now happens in the
// separate drift cron (runLedgerDriftScan) so it gets its own subrequest budget.
// Here we just read the findings it persisted — one cheap KV read — and surface
// a watchdog warning if those findings are missing or stale (same silent-failure
// defense as checkSeriesReconcile / checkPartnerActivityRefresh).
async function checkSessionLedgerDrift(env) {
  let findings;
  try {
    findings = await env.PORTAL_KV.get(LEDGER_DRIFT_FINDINGS_KEY, "json");
  } catch (err) {
    return [{
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-findings-read-failed",
      message: `Could not read ledger-drift findings from KV (${LEDGER_DRIFT_FINDINGS_KEY}): ${err.message}`,
    }];
  }

  if (!findings || !findings.generatedAt) {
    return [{
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-findings-missing",
      message: `No ledger-drift findings in KV. The drift scan (self-fetched /run-drift from runScheduledAudit) may not have run yet or is failing — check the daily-audit worker logs.`,
    }];
  }

  const ageMs = Date.now() - new Date(findings.generatedAt).getTime();
  if (ageMs > LEDGER_DRIFT_STALE_MS) {
    const hours = Math.round(ageMs / 3.6e6);
    return [{
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-findings-stale",
      message: `Ledger-drift findings are ${hours}h old (last run ${findings.generatedAt}). The drift scan (self-fetched /run-drift from runScheduledAudit) likely stopped running or is erroring.`,
    }];
  }

  return findings.issues || [];
}

// The heavy walk: enumerate every active-series contact, run deriveLedger, and
// persist drift findings to KV. Reached via the /run-drift route (self-fetched
// by runScheduledAudit, or hit manually), so the ~50-subrequest scan runs in its
// own invocation and never competes with the main audit's budget.
async function runLedgerDriftScan(env) {
  const issues = [];

  // Always persist a findings doc (success OR failure) so the main audit's
  // reader always sees a fresh signal rather than going silent.
  const persist = async (candidateCount) => {
    const doc = {
      generatedAt: new Date().toISOString(),
      candidateCount,
      issues,
    };
    try {
      await env.PORTAL_KV.put(LEDGER_DRIFT_FINDINGS_KEY, JSON.stringify(doc));
    } catch (err) {
      console.warn(`[ledger-drift] failed to persist findings: ${err.message}`);
    }
    return doc;
  };

  // Pre-fetch the existing field-sync needs-review queue. The
  // series-reconcile-worker writes to `field-sync:needsReview:${contactId}`
  // when a contact's drift is too large to auto-apply (delta > MAX_AUTO_DELTA).
  // The `checkSeriesReconcile` watchdog already surfaces those. Skip
  // any contact already in that queue so the briefing doesn't double-flag.
  const alreadyFlaggedForReview = new Set();
  try {
    const list = await env.PORTAL_KV.list({ prefix: "field-sync:needsReview:" });
    for (const k of list.keys) {
      alreadyFlaggedForReview.add(k.name.replace("field-sync:needsReview:", ""));
    }
  } catch {
    // Non-fatal — proceed without dedup.
  }

  // Find candidate contacts via /contacts/search. Has to be paginated.
  // Pagination cap is 1000 (10 pages × 100); surface a warning if we hit it
  // so we know to widen the scan when the contact base grows past that.
  const candidates = [];
  const PAGE_CAP = 10;
  let hitPageCap = false;
  let lastPageHadFullBatch = false;
  let token;
  try {
    token = await getAccessToken(env);
    for (let page = 1; page <= PAGE_CAP; page++) {
      const res = await fetch(`https://services.leadconnectorhq.com/contacts/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
        },
        body: JSON.stringify({ locationId: LOCATION_ID, pageLimit: 100, page }),
      });
      if (!res.ok) {
        // A non-ok response is a FAILED scan, not the end of the data. The old
        // `break` here fell through with a truncated (page 1 failure: empty)
        // candidate list, persisted a FRESH findings doc with zero issues, and
        // the main audit read it as "all clean" — a 429 at 4am defeated the
        // exact false-negative this watchdog exists to catch. Mirror the
        // thrown-error path: surface + abort (also skips the locked-count
        // persist, which the empty run used to reset to 0).
        issues.push({
          severity: "warning",
          area: "infra",
          kind: "ledger-drift-candidate-scan-failed",
          message: `Contact enumeration for ledger drift check failed on page ${page}: HTTP ${res.status}. Candidates scanned so far (${candidates.length}) were NOT evaluated — treat this run as no-coverage, not clean.`,
        });
        return persist(candidates.length);
      }
      const data = await res.json();
      const contacts = data.contacts || [];
      if (contacts.length === 0) break;
      for (const c of contacts) {
        const cf = c.customFields || [];
        const seriesType = cf.find((f) => f.id === FIELD_IDS.series_type)?.value || "none";
        const remaining = parseInt(cf.find((f) => f.id === FIELD_IDS.sessions_remaining)?.value ?? "0", 10) || 0;
        // Include session_prepaid="yes" contacts — deriveLedger flags
        // prepaidOverride-without-orders as an ambiguity, and that's
        // exactly the kind of drift this watchdog exists to surface.
        // Filter previously missed these (staff-balances.js:128-134 has
        // the inclusive filter; copy that pattern here for consistency).
        const sessionPrepaid = (cf.find((f) => f.id === "sgQ5EbJWhvTfGVhStaOO")?.value || "").toString().toLowerCase() === "yes";
        if (seriesType !== "none" || remaining > 0 || sessionPrepaid) {
          candidates.push(c.id);
        }
      }
      lastPageHadFullBatch = contacts.length === 100;
      if (contacts.length < 100) break;
      if (page === PAGE_CAP && lastPageHadFullBatch) hitPageCap = true;
    }
  } catch (err) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-candidate-scan-failed",
      message: `Could not enumerate contacts for ledger drift check: ${err.message}`,
    });
    return persist(0);
  }

  if (hitPageCap) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-pagination-cap-hit",
      message: `Drift check hit the ${PAGE_CAP * 100}-contact pagination cap. Contacts past that are silently uninspected — raise PAGE_CAP in daily-audit-worker/src/index.js checkSessionLedgerDrift.`,
    });
  }

  // Build a field-defs map once. IMPORTANT: use a raw fetch, NOT ghlFetch —
  // ghlFetch injects `?locationId=` into the path, and the customFields endpoint
  // (which already has the location in its path) rejects that with a 422. A failed
  // build leaves fieldDefs empty, and with empty fieldDefs deriveLedger can't read
  // the custom-field VALUES (sessions_remaining, sessions_remaining_locked, ...),
  // so it never detects field-vs-derived drift and reports everyone "clean" — a
  // silent false-negative that defeats the entire watchdog (the 2026-06-03 bug).
  let fieldDefs = {};
  try {
    const fdRes = await fetch(`https://services.leadconnectorhq.com/locations/${LOCATION_ID}/customFields`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json" },
    });
    if (!fdRes.ok) throw new Error(`customFields ${fdRes.status}`);
    const data = await fdRes.json();
    for (const f of data.customFields || []) {
      const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
      if (shortKey) fieldDefs[shortKey] = f.id;
    }
  } catch (err) {
    // Don't silently proceed with empty fieldDefs — that produces false "clean"
    // results. Surface it and abort the scan so the briefing shows a real problem.
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-fielddefs-failed",
      message: `Could not build custom-field map for ledger drift check (${err.message}); skipping per-contact derivation to avoid false-negatives.`,
    });
    return persist(candidates.length);
  }
  if (Object.keys(fieldDefs).length === 0) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-fielddefs-empty",
      message: `Custom-field map came back empty for ledger drift check; skipping per-contact derivation to avoid false-negatives.`,
    });
    return persist(candidates.length);
  }

  // Process candidates in chunks of 3 — each one does 4-5 GHL calls.
  // 3 × 5 = 15 concurrent; well under the 1000-subrequest cap.
  const CHUNK = 3;
  const detailedIssues = [];
  const lockedContacts = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (contactId) => {
      // Already in the field-sync needs-review queue → checkSeriesReconcile
      // above surfaces it. Skip so the briefing doesn't double-flag.
      if (alreadyFlaggedForReview.has(contactId)) return;

      try {
        const [contactRes, ordersRes, invoicesRes, apptRes] = await Promise.all([
          ghlFetch(env, `/contacts/${contactId}`),
          ghlFetch(env, `/payments/orders?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100`),
          ghlFetch(env, `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=100&offset=0`),
          ghlFetch(env, `/contacts/${contactId}/appointments`),
        ]);

        const contact = contactRes.contact || {};
        const ordersList = ordersRes.data || ordersRes.orders || [];
        const invoices = invoicesRes.invoices || [];
        const appointments = apptRes.appointments || apptRes.events || [];

        // Same hydration the read endpoints use.
        const orders = await hydrateOrders(async (orderId) => {
          return ghlFetch(env, `/payments/orders/${orderId}?altId=${LOCATION_ID}&altType=location`);
        }, ordersList);

        const ledger = deriveLedger({ contact, orders, invoices, appointments, fieldDefs });
        const name = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email || contactId;

        // Check manualLock FIRST. A locked contact's field-vs-derived divergence
        // is INTENTIONAL (that's what the lock is for), so it belongs in the
        // once-only locked rollup, not the daily ambiguity warning — otherwise an
        // intentional lock nags in every briefing. Only NON-locked low-confidence
        // contacts are real drift that needs a human (e.g. Danny: field 6 vs
        // derived 5, no lock = genuine unexplained mismatch).
        if (ledger.manualLock) {
          lockedContacts.push({ contactId, name, derived: ledger.remaining, field: ledger.display.remaining });
        } else if (ledger.confidence === "low" && ledger.ambiguities.length > 0) {
          detailedIssues.push({
            severity: "warning",
            area: "session-fields",
            kind: "ledger-ambiguity",
            contactId,
            contactName: name,
            message: `${name}: ledger ambiguity — ${ledger.ambiguities.join("; ")}`,
            displaying: ledger.display.remaining,
            derived: ledger.remaining,
            displaySource: ledger.display.source,
          });
        }
      } catch (err) {
        // Per-contact failure doesn't block the rest of the scan — but DON'T
        // swallow it silently. A swallowed error (e.g. subrequest-cap hit
        // mid-loop) reads as "clean" when it's actually "uninspected", which is
        // exactly the false-negative the watchdog must never produce. Surface it.
        console.warn(`[ledger-drift] check failed for ${contactId}: ${err.message}`);
        detailedIssues.push({
          severity: "warning",
          area: "infra",
          kind: "ledger-drift-contact-check-failed",
          contactId,
          message: `Ledger drift check could not evaluate ${contactId}: ${err.message}`,
        });
      }
    }));
  }

  // Locked-rollup INFO — emit only when the locked count CHANGED since the
  // last run. Without this guard, Albert's permanent lock would generate
  // a daily INFO entry that just inflates the briefing (per Eben's
  // 2026-05-26 todo-discipline rule — no cosmetic noise). The previous
  // count lives in KV so we have something to compare against.
  const LOCKED_COUNT_KEY = "ops:ledger-drift:lastLockedCount";
  try {
    const prevRaw = await env.PORTAL_KV.get(LOCKED_COUNT_KEY);
    const prevCount = prevRaw === null ? null : parseInt(prevRaw, 10);
    const currentCount = lockedContacts.length;

    if (prevCount === null && currentCount > 0) {
      // First-ever run with locked contacts — emit once so the baseline is
      // visible.
      const summary = lockedContacts
        .map((l) => `${l.name} (showing ${l.field}, derived ${l.derived})`)
        .join("; ");
      issues.push({
        severity: "info",
        area: "session-fields",
        kind: "ledger-locked-baseline",
        message: `Baseline: ${currentCount} contact(s) on sessions_remaining_locked: ${summary}. (Future runs will report only when count changes.)`,
      });
    } else if (prevCount !== null && currentCount !== prevCount) {
      const direction = currentCount > prevCount ? "increased" : "decreased";
      const summary = lockedContacts
        .map((l) => `${l.name} (showing ${l.field}, derived ${l.derived})`)
        .join("; ");
      issues.push({
        severity: "info",
        area: "session-fields",
        kind: "ledger-locked-count-changed",
        message: `Locked-contact count ${direction} from ${prevCount} to ${currentCount}. Now: ${summary || "none"}`,
      });
    }
    // Persist for next run regardless.
    await env.PORTAL_KV.put(LOCKED_COUNT_KEY, String(currentCount));
  } catch (err) {
    // KV failure shouldn't kill the watchdog — fall back to emitting nothing
    // for the locked rollup (rather than the noisy unconditional path).
    console.warn(`[ledger-drift] locked-count compare failed: ${err.message}`);
  }

  // Fold the per-contact findings into the issue list and persist everything.
  issues.push(...detailedIssues);
  return persist(candidates.length);
}
