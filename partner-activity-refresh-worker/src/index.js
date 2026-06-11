// Partner Activity Refresh Worker
// Runs in chunks via cron + can be triggered on-demand via /run.
//
// SUBREQUEST LIMIT: CF Workers cap subrequests per invocation (50 free, 1000 paid).
// With ~412 partner contacts × ~3-5 subrequests each, we can't process the full
// set in one invocation. So this Worker processes a CHUNK each run, tracking
// progress in KV. Cron fires multiple times per day to chip through the queue.
//
// State in KV:
//   ops:activity-refresh:lastRun        — last run summary (for UI freshness)
//   ops:activity-refresh:queue          — array of contactIds still to process
//   ops:activity-refresh:queueGeneratedAt — when the queue was rebuilt

import {
  fetchAllPartnerContacts,
  findMostRecentMessageDate,
  writeLastActivity,
} from "./ghl.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

const KV_LAST_RUN_KEY = "ops:activity-refresh:lastRun";
const KV_QUEUE_KEY = "ops:activity-refresh:queue";
const KV_QUEUE_GENERATED_KEY = "ops:activity-refresh:queueGeneratedAt";

const SLEEP_MS = 100; // ~10 req/sec, comfortably under GHL's 100/10s limit
const MAX_CONSECUTIVE_FAILURES = 5;

// Subrequests per contact: 1 conversations search + ~1-2 messages fetch + 1 PUT = ~3-4.
// Plus 1 KV read/write each. Plus fetchAllPartnerContacts (~7-10 subrequests for tag pages)
// is amortized when the queue is fresh. Budget ~10 contacts per run on free, ~250 on paid.
// 25 is safe across both — leaves headroom for the queue rebuild on first-of-day runs.
const CHUNK_SIZE = 25;

// Queue is considered stale (rebuild from GHL) when older than this. Means a full
// refresh of all 412 contacts happens once per day, then idle until next day.
const QUEUE_TTL_MS = 22 * 60 * 60 * 1000; // 22h

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env, "cron"));
  },

  async fetch(request, env) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

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

// Get the contact-id queue, rebuilding from GHL if stale or absent.
async function getOrBuildQueue(env) {
  const generatedAt = await env.PORTAL_KV.get(KV_QUEUE_GENERATED_KEY);
  const queue = await env.PORTAL_KV.get(KV_QUEUE_KEY, "json");
  const age = generatedAt ? Date.now() - Number(generatedAt) : Infinity;

  if (queue && Array.isArray(queue) && queue.length > 0 && age < QUEUE_TTL_MS) {
    return { queue, rebuilt: false };
  }

  // Rebuild
  console.log(`[partner-activity-refresh] rebuilding queue (was ${queue?.length || 0} items, age ${Math.round(age/60000)}m)`);
  const contactsById = await fetchAllPartnerContacts(env);
  const newQueue = Array.from(contactsById.keys());
  await env.PORTAL_KV.put(KV_QUEUE_KEY, JSON.stringify(newQueue));
  await env.PORTAL_KV.put(KV_QUEUE_GENERATED_KEY, String(Date.now()));
  console.log(`[partner-activity-refresh] queue rebuilt with ${newQueue.length} contacts`);
  return { queue: newQueue, rebuilt: true };
}

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
  let queueRemaining = 0;
  let queueTotal = 0;

  try {
    const { queue, rebuilt } = await getOrBuildQueue(env);
    queueTotal = queue.length;
    const chunk = queue.slice(0, CHUNK_SIZE);
    const remainingAfter = queue.slice(chunk.length);
    console.log(`[partner-activity-refresh] queue=${queue.length}, processing chunk of ${chunk.length}`);

    for (const id of chunk) {
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
          failures.push({ id, error: String(e.message || e).slice(0, 200) });
        }
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // Stop early but keep the unprocessed tail in the queue
          console.error(`[partner-activity-refresh] ${consecutiveFailures} consecutive failures — stopping chunk`);
          break;
        }
      }
      await sleep(SLEEP_MS);
    }

    // Persist remaining queue (everything we didn't process this run)
    const unprocessed = chunk.slice(processed);
    const newQueue = [...unprocessed, ...remainingAfter];
    await env.PORTAL_KV.put(KV_QUEUE_KEY, JSON.stringify(newQueue));
    queueRemaining = newQueue.length;

    const finishedAt = new Date();
    const summary = {
      trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs,
      status: "ok",
      total: queueTotal,
      processed,
      written,
      skippedNoMessages,
      failed,
      queueRemaining,
      queueRebuilt: rebuilt,
      failures,
    };

    await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    console.log(`[partner-activity-refresh] chunk done: written=${written} failed=${failed} remaining=${queueRemaining} duration=${summary.durationMs}ms`);
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
      queueRemaining,
      failures,
    };
    try {
      await env.PORTAL_KV.put(KV_LAST_RUN_KEY, JSON.stringify(summary));
    } catch (kvErr) {
      console.error("[partner-activity-refresh] failed to write summary to KV:", kvErr);
    }
    console.error("[partner-activity-refresh] FAILED:", summary.error);
    return summary;
  }
}
