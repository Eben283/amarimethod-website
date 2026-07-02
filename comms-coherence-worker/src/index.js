// Comms Coherence Worker — runs daily, after conversation-cache-worker's sync.
//
// For every contact with cross-channel activity in the lookback window, reads
// the already-cached conv:{contactId} touch history (no live GHL calls needed)
// and asks Claude (src/coherence.js) to flag what a deterministic side-effect
// check can't: redundant messaging across channels, contradictions, confusion
// signals (a client re-asking something already sent), and bad timing/spacing.
//
// This is additive to — not a replacement for — qa-audit.js, which already
// catches missing reminders/automations and exact-duplicate sends
// deterministically. This worker only handles the semantic judgment qa-audit's
// regex/exact-match logic structurally can't do.
//
// KV written:
//   comms:flags:{contactId}   — latest assessment for that contact
//   comms:flags:ledger        — small append-only history (capped), so
//                                patterns across time become visible later
//   comms:flags:summary       — today's flagged contacts, for /day to read
//   comms:flags:status:lastRun
//
// Wired into /day (2026-07-01) via functions/api/comms-summary.js →
// claude-config/ghl-mcp/day-payload.js's commsSummary section.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import { evaluateContact, windowTouches } from "./coherence.js";

const KV_FLAGS_PREFIX = "comms:flags:";        // comms:flags:{contactId}
const KV_SUMMARY = "comms:flags:summary";
const KV_LEDGER = "comms:flags:ledger";
const KV_LAST_RUN = "comms:flags:status:lastRun";
const FLAG_TTL_S = 30 * 86_400;                // 30-day retention, mirrors call-coach
const LEDGER_MAX_ENTRIES = 500;                // cap growth — append-only history, not unbounded

const DEFAULT_WINDOW_DAYS = 3;
const MAX_CONTACTS = 60;                       // bound one run's Anthropic spend
const CONCURRENCY = 5;                         // mirrors conversation-cache-worker's mapLimit

// Limited-concurrency map — ported from conversation-cache-worker/src/sync.js.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (err) { out[idx] = { error: err.message }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCoherence(env, { nowMs: Date.now() }));
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    // /run[?windowDays=N&contactId=X] — run now. Fire-and-return via
    // ctx.waitUntil for a full sweep (mirrors call-coach's /run); a single
    // contactId runs synchronously so it can double as "re-check this one".
    if (url.pathname === "/run") {
      const windowDays = Number(url.searchParams.get("windowDays")) || DEFAULT_WINDOW_DAYS;
      const contactId = url.searchParams.get("contactId");
      if (contactId) {
        const result = await evaluateOne(env, contactId, { nowMs: Date.now(), windowDays });
        return json(result, result.error ? 422 : 200);
      }
      ctx.waitUntil(runCoherence(env, { nowMs: Date.now(), windowDays }));
      return json({ started: true, windowDays, message: "Coherence run started — check /status or /summary." }, 202);
    }

    if (url.pathname === "/status") {
      const last = await env.PORTAL_KV.get(KV_LAST_RUN, "json");
      return json(last || { error: "never run" });
    }

    if (url.pathname === "/summary") {
      const summary = await env.PORTAL_KV.get(KV_SUMMARY, "json");
      return summary ? json(summary) : json({ error: "no summary yet" }, 404);
    }

    if (url.pathname === "/flags") {
      const contactId = url.searchParams.get("contactId");
      if (!contactId) return json({ error: "contactId required" }, 400);
      const flags = await env.PORTAL_KV.get(`${KV_FLAGS_PREFIX}${contactId}`, "json");
      return flags ? json(flags) : json({ contactId, flags: null }, 404);
    }

    return new Response("Not found. Use /run, /status, /summary, or /flags?contactId=.", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safePut(env, key, value, ttl) {
  try {
    const opts = ttl ? { expirationTtl: ttl } : undefined;
    await env.PORTAL_KV.put(key, JSON.stringify(value), opts);
  } catch (err) {
    console.warn(`[comms-coherence] KV put failed for ${key}: ${err.message}`);
  }
}

// Evaluate exactly one contact and persist its result (used by both the batch
// run and the single-contact /run?contactId= path). Returns the persisted record.
async function evaluateOne(env, contactId, { nowMs, windowDays }) {
  const conv = await env.PORTAL_KV.get(`conv:${contactId}`, "json");
  if (!conv) return { contactId, error: "no cached conversation for this contact" };

  const { result, error, rawText } = await evaluateContact(env, {
    contactId,
    contactName: conv.name || [conv.firstName, conv.lastName].filter(Boolean).join(" ") || contactId,
    touches: conv.touches || [],
    nowMs,
    windowDays,
  });

  if (error) return { contactId, error, rawText };

  const record = {
    contactId,
    contactName: conv.name || contactId,
    generatedAt: new Date(nowMs).toISOString(),
    windowDays,
    ...result,
  };

  if (record.flags.length) {
    await safePut(env, `${KV_FLAGS_PREFIX}${contactId}`, record, FLAG_TTL_S);
    await appendLedger(env, record);
  } else {
    // A clean re-evaluation must CLEAR any prior flag — otherwise a resolved
    // contradiction kept surfacing for its full 30-day TTL.
    try { await env.PORTAL_KV.delete(`${KV_FLAGS_PREFIX}${contactId}`); }
    catch { /* best-effort — TTL still bounds a stale flag */ }
  }

  return record;
}

async function appendLedger(env, record) {
  const ledger = (await env.PORTAL_KV.get(KV_LEDGER, "json")) || [];
  ledger.push({
    ts: record.generatedAt,
    contactId: record.contactId,
    contactName: record.contactName,
    flags: record.flags,
  });
  const trimmed = ledger.slice(-LEDGER_MAX_ENTRIES);
  await safePut(env, KV_LEDGER, trimmed);
}

export async function runCoherence(env, { nowMs, windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const startedAt = new Date(nowMs).toISOString();
  console.log(`[comms-coherence] Run starting, window=${windowDays}d`);

  const lastRun = {
    startedAt,
    windowDays,
    status: "running",
    candidates: 0,
    evaluated: 0,
    flagged: 0,
    skipped: 0,
    failed: 0,
  };

  const index = (await env.PORTAL_KV.get("conv:index", "json")) || {};
  const cutoffMs = nowMs - windowDays * 86_400_000;
  // Sort by recency before capping — the unsorted slice depended on JSON key
  // order, so with >MAX_CONTACTS active the same tail could be silently
  // excluded forever. Record the truncation so /status can't hide it.
  const eligible = Object.entries(index)
    .filter(([, lastMessageDate]) => Number(lastMessageDate) >= cutoffMs)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const candidates = eligible.slice(0, MAX_CONTACTS).map(([contactId]) => contactId);
  lastRun.candidates = candidates.length;
  lastRun.truncated = Math.max(0, eligible.length - candidates.length);

  const summaryItems = [];
  await mapLimit(candidates, CONCURRENCY, async (contactId) => {
    const conv = await env.PORTAL_KV.get(`conv:${contactId}`, "json");
    if (!conv) { lastRun.skipped++; return; }
    if (windowTouches(conv.touches || [], nowMs, windowDays).length < 2) { lastRun.skipped++; return; }

    const record = await evaluateOne(env, contactId, { nowMs, windowDays });
    if (record.error) {
      // "nothing to evaluate" is a normal skip, not a failure.
      if (!record.error.startsWith("nothing to evaluate")) lastRun.failed++;
      else lastRun.skipped++;
      return;
    }
    lastRun.evaluated++;
    if (record.flags.length) {
      lastRun.flagged++;
      summaryItems.push({
        contactId: record.contactId,
        contactName: record.contactName,
        topFlag: record.flags[0],
        flagCount: record.flags.length,
      });
    }
  });

  const summary = {
    date: startedAt.slice(0, 10),
    generatedAt: new Date().toISOString(),
    windowDays,
    count: summaryItems.length,
    items: summaryItems,
  };
  await safePut(env, KV_SUMMARY, summary, FLAG_TTL_S);

  lastRun.status = "ok";
  lastRun.finishedAt = new Date().toISOString();
  await safePut(env, KV_LAST_RUN, lastRun);

  console.log(
    `[comms-coherence] Done: candidates=${lastRun.candidates} evaluated=${lastRun.evaluated} ` +
    `flagged=${lastRun.flagged} skipped=${lastRun.skipped} failed=${lastRun.failed}`
  );
  return { ...lastRun, summary };
}
