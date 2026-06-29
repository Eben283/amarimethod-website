// Coach Daily Worker — cloud replacement for coach-daily.sh + launchd.
// Runs at 0 15 * * * UTC (7am PST / 8am PDT).
//
// Pipeline (fail-soft: each step is isolated; one failure doesn't block the rest):
//   1. Pull cadence + due-list from KV  (built by conversation-cache cron)
//   2. Refresh call-coach cards         (HTTP to call-coach worker for due contacts)
//   3. Detect link stalls               (GHL tag search → link-sent stall flags)
//   4. Detect price objections          (KV transcript scan for due contacts)
//   5. Template reconciliation          (write/delete coach:{contactId} KV cards)
//   6. Outcomes                         (acted/replied stats → KV)
//   7. Learning                         (GHL join → ledger → KV)
//
// Secrets: GHL_CLIENT_ID, GHL_CLIENT_SECRET, WORKER_AUTH_SECRET
// KV read:  coach:cadence:latest, coach:due:latest, coach:records:snapshot,
//           coach:personalized, coach:surfaced:ledger, conv:{id}, transcript:{id}
// KV write: coach:{contactId}, coach:records:snapshot, coach:outcomes:summary,
//           coach:learning:summary, coach:surfaced:ledger, coach:daily:lastRun

import { detectLinkStalls } from "./link-stalls.js";
import { detectPriceObjections } from "./price-objections.js";
import { runTemplate } from "./template.js";
import { runOutcomes } from "./outcomes.js";
import { runLearning } from "./learning.js";

const CALL_COACH_WORKER = "https://call-coach.eben-fa2.workers.dev";
const REFRESH_CONCURRENCY = 5;
const REFRESH_MAX = 40;
const REFRESH_TIMEOUT_MS = 35_000;

async function refreshOne(contactId, auth) {
  const url = `${CALL_COACH_WORKER}/coach-one?contactId=${encodeURIComponent(contactId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${auth}` }, signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function refreshCallCards(env, due) {
  const auth = env.WORKER_AUTH_SECRET;
  if (!auth) { console.error("[refresh-cards] no WORKER_AUTH_SECRET — skipping"); return; }

  const contacts = [...new Set(due.map((d) => d.contactId).filter(Boolean))].slice(0, REFRESH_MAX);
  console.error(`[refresh-cards] refreshing ${contacts.length} contacts`);

  let ok = 0, failed = 0;
  for (let i = 0; i < contacts.length; i += REFRESH_CONCURRENCY) {
    const batch = contacts.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.all(batch.map((id) => refreshOne(id, auth)));
    for (const r of results) r ? ok++ : failed++;
  }
  console.error(`[refresh-cards] done: ${ok} ok, ${failed} failed`);
}

async function runCron(env) {
  const log = (msg) => console.error(`[coach-daily] ${msg}`);
  const start = Date.now();
  log("starting daily run");

  // Step 1: Pull cadence + due-list.
  const [cadence, dueSnapshot] = await Promise.all([
    env.PORTAL_KV.get("coach:cadence:latest", "json"),
    env.PORTAL_KV.get("coach:due:latest", "json"),
  ]);
  if (!cadence || !dueSnapshot) {
    log("ABORT: coach:cadence:latest or coach:due:latest missing from KV");
    return;
  }
  const due = dueSnapshot.due || [];
  const dueMap = new Map(due.map((d) => [d.contactId, d]));
  const dueIds = new Set(due.map((d) => d.contactId).filter(Boolean));
  log(`cadence: ${(cadence.prospects || []).length} prospects, due: ${due.length}`);

  // Step 2: Refresh call-coach cards.
  try { await refreshCallCards(env, due); }
  catch (e) { log(`refresh-cards error (non-fatal): ${e.message?.slice(0, 100)}`); }

  // Step 3: Link stalls.
  let linkStalls = new Map();
  try { linkStalls = await detectLinkStalls(env, dueMap); }
  catch (e) { log(`link-stalls error (non-fatal): ${e.message?.slice(0, 100)}`); }

  // Step 4: Price objections.
  let priceFlags = new Set();
  try { priceFlags = await detectPriceObjections(env, dueIds); }
  catch (e) { log(`price-objections error (non-fatal): ${e.message?.slice(0, 100)}`); }

  // Step 5: Template reconciliation.
  let records = [];
  try {
    records = await runTemplate(env, due, priceFlags, linkStalls);
    log(`template: ${records.length} cards`);
  } catch (e) {
    log(`template error (non-fatal): ${e.message?.slice(0, 100)}`);
    records = (await env.PORTAL_KV.get("coach:records:snapshot", "json")) || [];
  }

  // Step 6: Outcomes.
  try {
    const summary = await runOutcomes(env, records, cadence);
    log(`outcomes: surfaced ${summary.surfaced}, acted ${summary.acted}, replied ${summary.replied}`);
  } catch (e) { log(`outcomes error (non-fatal): ${e.message?.slice(0, 100)}`); }

  // Step 7: Learning.
  try {
    const learning = await runLearning(env, records, cadence);
    log(`learning: ${learning.headline}`);
  } catch (e) { log(`learning error (non-fatal): ${e.message?.slice(0, 100)}`); }

  const elapsed = Math.round((Date.now() - start) / 1000);
  const lastRun = { completedAt: new Date().toISOString(), elapsedSec: elapsed, dueCount: due.length };
  await env.PORTAL_KV.put("coach:daily:lastRun", JSON.stringify(lastRun));
  log(`done in ${elapsed}s`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },

  // /status — last-run summary (gated by WORKER_AUTH_SECRET).
  async fetch(request, env) {
    const auth = request.headers.get("Authorization");
    if (!env.WORKER_AUTH_SECRET || auth !== `Bearer ${env.WORKER_AUTH_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get("coach:daily:lastRun", "json");
      return new Response(JSON.stringify(data || { note: "No runs yet" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/run") {
      // Manual trigger for testing (awaited, not waitUntil so we can see errors).
      await runCron(env);
      const data = await env.PORTAL_KV.get("coach:daily:lastRun", "json");
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
