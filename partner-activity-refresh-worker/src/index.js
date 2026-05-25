// Partner Activity Refresh Worker
// Runs nightly via cron + can be triggered on-demand via /run.
// For every partner-tagged GHL contact: computes the most-recent message date
// from /conversations and writes it to the partner_last_real_activity custom field.
// Records the last-run summary at KV key `ops:activity-refresh:lastRun`.

import {
  fetchAllPartnerContacts,
  findMostRecentMessageDate,
  writeLastActivity,
} from "./ghl.js";

const KV_LAST_RUN_KEY = "ops:activity-refresh:lastRun";
const SLEEP_MS = 100; // ~10 req/sec, comfortably under GHL's 100/10s limit
const MAX_CONSECUTIVE_FAILURES = 10;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env, "cron"));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/run" || url.pathname === "/__scheduled") {
      // Manual / on-demand trigger. Run inline (not waitUntil) so the response
      // contains the summary — the staff app's Refresh-now button waits for it.
      const result = await runRefresh(env, "manual");
      return jsonResponse(result);
    }

    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get(KV_LAST_RUN_KEY, "json");
      if (!data) return jsonResponse({ error: "Never run" }, 404);
      return jsonResponse(data);
    }

    return new Response("Not found. Use /run or /status.", { status: 404 });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRefresh(env, trigger) {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  console.log(`[partner-activity-refresh] starting (trigger=${trigger})`);

  let processed = 0;
  let written = 0;
  let skippedNoMessages = 0;
  let failed = 0;
  const failures = [];
  let consecutiveFailures = 0;

  try {
    const contactsById = await fetchAllPartnerContacts(env);
    const total = contactsById.size;
    console.log(`[partner-activity-refresh] found ${total} partner contacts`);

    for (const [id, contact] of contactsById) {
      processed += 1;
      try {
        const date = await findMostRecentMessageDate(env, id);
        if (!date) {
          skippedNoMessages += 1;
        } else {
          await sleep(SLEEP_MS);
          await writeLastActivity(env, id, date);
          written += 1;
          consecutiveFailures = 0;
        }
      } catch (e) {
        failed += 1;
        consecutiveFailures += 1;
        if (failures.length < 20) {
          failures.push({
            id,
            name: contact.contactName || contact.firstName || "(no name)",
            error: String(e.message || e).slice(0, 200),
          });
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`Aborted after ${consecutiveFailures} consecutive failures`);
        }
      }
      // Cron-safe pacing
      await sleep(SLEEP_MS);
    }

    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "ok",
      total,
      processed,
      written,
      skippedNoMessages,
      failed,
      failures, // first 20
    };

    await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    console.log(`[partner-activity-refresh] done: written=${written} failed=${failed} duration=${summary.durationMs}ms`);
    return summary;
  } catch (e) {
    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "error",
      error: String(e.message || e).slice(0, 500),
      processed,
      written,
      skippedNoMessages,
      failed,
      failures,
    };
    // Still write the error summary so the watchdog + UI can see it
    try {
      await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    } catch (kvErr) {
      console.error("[partner-activity-refresh] failed to write summary to KV:", kvErr);
    }
    console.error("[partner-activity-refresh] FAILED:", summary.error);
    return summary;
  }
}
