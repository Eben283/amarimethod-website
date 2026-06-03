// Daily Audit Worker — runs at 4 AM Pacific via cron trigger.
// Executes all 5 QA audit rule sets against GHL data and caches results in KV.
// Results are read by /api/daily-audit Pages Function → consumed by /day skill.

import { ghlFetch, fetchAppointmentsForDate, todayPacific, LOCATION_ID, FIELD_IDS, ContactCache, getAccessToken } from "./ghl.js";
import { auditAppointments, auditPurchases, auditTagConsistency, auditSeriesTypeDrops, auditCommunications, auditStateMismatches } from "./rules.js";
import { deriveLedger } from "../../functions/lib/session-ledger.js";
import { hydrateOrders } from "../../functions/lib/ghl-orders.js";

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

  // Same pattern for ghl-token-refresh sister Worker (12h cron, refreshes
  // GHL OAuth tokens). Silent death = cascade 401s across every handler
  // that talks to GHL. No other watchdog covers this.
  const tokenRefreshWatchdogIssues = await checkTokenRefresh(env);

  // Walk every contact with an active series and run the same derivation
  // the read endpoints use. Surface anyone whose displayed value diverges
  // from the derived value (low-confidence-fallback or active manual lock)
  // or whose derivation has ambiguities. This is the visibility piece —
  // the Jenn Kadri 2026-06-03 silent bug sat invisible for weeks because
  // nothing surfaced the ambiguity array a human could read.
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
    ...ledgerDriftIssues,
    ...streamHealthIssues,
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

  if (summary.status === "error") {
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
async function checkSessionLedgerDrift(env) {
  const issues = [];

  // Pre-fetch the existing field-sync needs-review queue. The
  // series-reconcile-worker writes to `field-sync:needsReview:${contactId}`
  // when a contact's drift is too large to auto-apply (delta > MAX_AUTO_DELTA).
  // The `checkSeriesReconcile` watchdog above already surfaces those. Skip
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
      if (!res.ok) break;
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
    return issues;
  }

  if (hitPageCap) {
    issues.push({
      severity: "warning",
      area: "infra",
      kind: "ledger-drift-pagination-cap-hit",
      message: `Drift check hit the ${PAGE_CAP * 100}-contact pagination cap. Contacts past that are silently uninspected — raise PAGE_CAP in daily-audit-worker/src/index.js checkSessionLedgerDrift.`,
    });
  }

  // Build a field-defs map once.
  let fieldDefs = {};
  try {
    const data = await ghlFetch(env, `/locations/${LOCATION_ID}/customFields`);
    for (const f of data.customFields || []) {
      const shortKey = (f.fieldKey || f.key || "").replace(/^contact\./, "");
      if (shortKey) fieldDefs[shortKey] = f.id;
    }
  } catch {
    // fieldDefs stays empty; deriveLedger falls back to id-based matching
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

        if (ledger.confidence === "low" && ledger.ambiguities.length > 0) {
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
        } else if (ledger.manualLock) {
          lockedContacts.push({ contactId, name, derived: ledger.remaining, field: ledger.display.remaining });
        }
      } catch (err) {
        // Per-contact failure doesn't block the rest of the audit.
        console.warn(`[daily-audit] ledger drift check failed for ${contactId}: ${err.message}`);
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
    console.warn(`[daily-audit] locked-count compare failed: ${err.message}`);
  }

  return [...issues, ...detailedIssues];
}
