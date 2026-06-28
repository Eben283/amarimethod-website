// Call-Coach Worker — runs daily at 11:00 UTC (after daily-audit).
//
// For yesterday's outreach activity it:
//   1. Lists contacts with recent calls + outgoing texts (src/ghl.js).
//   2. For each call: downloads the GHL recording (audio/x-wav — spike-confirmed
//      reachable 2026-06-13), transcribes it via Workers AI @cf/openai/whisper.
//      (Tries GHL's stored transcription first; usually absent, so Whisper.)
//   3. Calls Claude (src/coach.js) over the transcript + recent outgoing texts
//      → constructive coaching pointers.
//   4. Writes per-call results + a daily digest + a lastRun status to KV.
//
// Surfaced by the Pages Function /api/call-coach (reads KV) on the Follow-Up
// card + /day digest.
//
// AUDIO STATUS: live. Spike 0 confirmed recordings download as real WAV. If a
// given call has no recording (never recorded / too short), that call is still
// coached on text only and flagged audio:false — no audio is NOT a global
// fallback, it's per-call.
//
// CHUNKING: Whisper + Claude per-contact is I/O-heavy. On a full day the
// sequential loop can exceed Cloudflare's CPU budget before finishing. We split
// the work into batches of BATCH_SIZE contacts per invocation. The first batch
// enumerates all contacts for the day and saves the list to KV; subsequent
// batches read the list and fetch each contact individually. Each batch
// self-requeues via ctx.waitUntil so no contact is skipped.

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import {
  fetchRelationshipBundles,
  fetchContactRelationship,
  fetchRecording,
  fetchStoredTranscription,
  dateToRange,
  yesterdayPacific,
} from "./ghl.js";
import { coachInteraction } from "./coach.js";

const KV_CALL_PREFIX   = "call-coach:";          // call-coach:{date}:{contactId}
const KV_DAILY_PREFIX  = "call-coach:daily:";    // call-coach:daily:{date}
const KV_LATEST_PREFIX = "call-coach:latest:";   // call-coach:latest:{contactId}
const KV_QUEUE_PREFIX  = "call-coach:queue:";    // call-coach:queue:{date} → [contactId, ...]
const KV_LAST_RUN      = "call-coach:status:lastRun";
const RESULT_TTL_S     = 30 * 86400;
const LATEST_TTL_S     = 180 * 86400;

// How many contacts to process per Worker invocation. Each contact does a
// recording download + Whisper + Claude call — keep this small so we stay
// within the 30-second CPU budget even on heavy outreach days.
const BATCH_SIZE = 8;
const MAX_CALLS_PER_CONTACT = 3;
const WHISPER_MODEL = "@cf/openai/whisper";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCoach(env, ctx, yesterdayPacific(), 0));
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    // /run?date=YYYY-MM-DD[&offset=N] — coach a given Pacific date.
    // Fire-and-return; actual work runs in background via waitUntil.
    if (url.pathname === "/run") {
      const date = url.searchParams.get("date") || yesterdayPacific();
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      ctx.waitUntil(runCoach(env, ctx, date, offset));
      return json({ started: true, date, offset, message: "Coaching run started — check /status or /latest." }, 202);
    }

    // /coach-one?contactId=X[&date=YYYY-MM-DD] — coach ONE contact synchronously.
    if (url.pathname === "/coach-one") {
      const contactId = url.searchParams.get("contactId");
      if (!contactId) return json({ error: "contactId required" }, 400);
      const date = url.searchParams.get("date") || yesterdayPacific();
      try {
        const bundle = await fetchContactRelationship(env, contactId);
        const { transcript, anyAudio } = await assembleCallTranscript(env, bundle.calls, null);
        const { coaching, error, rawText } = await coachInteraction(env, {
          contactName: bundle.contactName,
          transcript,
          thread: bundle.thread,
        });
        if (error) return json({ contactId, contactName: bundle.contactName, error, rawText, callCount: bundle.calls.length, threadCount: bundle.thread.length }, 200);
        const record = {
          contactId,
          contactName: bundle.contactName,
          date,
          generatedAt: new Date().toISOString(),
          hasAudio: anyAudio,
          callCount: bundle.calls.length,
          threadCount: bundle.thread.length,
          coaching,
        };
        await safePut(env, `${KV_CALL_PREFIX}${date}:${contactId}`, record, RESULT_TTL_S);
        await safePut(env, `${KV_LATEST_PREFIX}${contactId}`, record, LATEST_TTL_S);
        return json(record);
      } catch (err) {
        return json({ contactId, error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    // /rebuild-digest?date=YYYY-MM-DD — reconstruct the daily digest from per-contact records.
    if (url.pathname === "/rebuild-digest") {
      const date = url.searchParams.get("date") || yesterdayPacific();
      const digest = await buildDigest(env, date);
      return json(digest);
    }

    // /latest?date=YYYY-MM-DD — read the daily digest.
    if (url.pathname === "/latest") {
      const date = url.searchParams.get("date") || yesterdayPacific();
      const digest = await env.PORTAL_KV.get(`${KV_DAILY_PREFIX}${date}`, "json");
      if (!digest) return json({ error: "No coaching digest for this date", date }, 404);
      return json(digest);
    }

    if (url.pathname === "/status") {
      const last = await env.PORTAL_KV.get(KV_LAST_RUN, "json");
      return json(last || { error: "never run" });
    }

    // /backfill-latest — populate call-coach:latest:{contactId} from existing dated records.
    if (url.pathname === "/backfill-latest") {
      const listed = await env.PORTAL_KV.list({ prefix: KV_CALL_PREFIX });
      const dateRe = /^call-coach:(\d{4}-\d{2}-\d{2}):(.+)$/;
      const newest = {};
      for (const k of listed.keys) {
        const m = k.name.match(dateRe);
        if (!m) continue;
        const [, d, cid] = m;
        if (!newest[cid] || d > newest[cid].d) newest[cid] = { d, key: k.name };
      }
      let written = 0;
      for (const cid of Object.keys(newest)) {
        const rec = await env.PORTAL_KV.get(newest[cid].key, "json");
        if (rec?.coaching) { await safePut(env, `${KV_LATEST_PREFIX}${cid}`, rec, LATEST_TTL_S); written++; }
      }
      return json({ backfilled: written, contacts: Object.keys(newest).length, listComplete: listed.list_complete });
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Batch entry point ─────────────────────────────────────────────────────────
//
// offset=0: enumerate today's contacts via the GHL fan-out, save the list to
// KV, process the first BATCH_SIZE from the already-fetched bundles.
//
// offset>0: load the contact ID list from KV, fetch each contact individually
// (fetchContactRelationship — same as /coach-one), process the next BATCH_SIZE.
//
// After every batch: if more contacts remain, ctx.waitUntil chains the next
// batch; when done, the final batch rebuilds the digest.
async function runCoach(env, ctx, dateStr, offset) {
  const queueKey = `${KV_QUEUE_PREFIX}${dateStr}`;

  // ── Load or build the queue ──
  let allIds;
  let firstBatchBundles = null; // pre-fetched on offset=0 — avoid re-fetching

  if (offset === 0) {
    console.log(`[call-coach] Starting ${dateStr} — enumerating contacts`);
    let bundles;
    try {
      const { startMs, endMs } = dateToRange(dateStr);
      bundles = await fetchRelationshipBundles(env, startMs, endMs);
    } catch (err) {
      const status = { date: dateStr, startedAt: new Date().toISOString(), status: "error", error: `enumerate failed: ${err.message}`, finishedAt: new Date().toISOString() };
      await safePut(env, KV_LAST_RUN, status);
      return;
    }
    allIds = bundles.map((b) => b.contactId);
    await safePut(env, queueKey, allIds, RESULT_TTL_S);
    // Initialise accumulated stats in KV so subsequent batches can update them.
    const initial = {
      date: dateStr, startedAt: new Date().toISOString(), status: "running",
      total: allIds.length, batchSize: BATCH_SIZE,
      contactsProcessed: 0, coached: 0, failed: 0,
      callsTranscribed: 0, callsNoRecording: 0,
    };
    await safePut(env, KV_LAST_RUN, initial);
    firstBatchBundles = bundles.slice(0, BATCH_SIZE);
    console.log(`[call-coach] ${allIds.length} contacts queued; processing batch 0..${BATCH_SIZE - 1}`);
  } else {
    allIds = await env.PORTAL_KV.get(queueKey, "json");
    if (!allIds) {
      console.error(`[call-coach] Queue missing for ${dateStr} at offset ${offset} — aborting`);
      return;
    }
    console.log(`[call-coach] Continuing ${dateStr} at offset ${offset}/${allIds.length}`);
  }

  // ── Fetch bundles for this batch (if not already fetched) ──
  let bundles;
  if (firstBatchBundles) {
    bundles = firstBatchBundles;
  } else {
    const batchIds = allIds.slice(offset, offset + BATCH_SIZE);
    bundles = (
      await Promise.all(batchIds.map((id) => fetchContactRelationship(env, id).catch(() => null)))
    ).filter(Boolean);
  }

  // ── Process this batch ──
  const stats = { coached: 0, failed: 0, callsTranscribed: 0, callsNoRecording: 0 };
  for (const bundle of bundles) {
    try {
      const { transcript, anyAudio } = await assembleCallTranscript(env, bundle.calls, stats);
      const { coaching, error: coachErr } = await coachInteraction(env, {
        contactName: bundle.contactName,
        transcript,
        thread: bundle.thread,
      });
      if (coachErr) {
        if (!coachErr.startsWith("nothing to coach")) stats.failed++;
        console.log(`[call-coach] ${bundle.contactId}: skip — ${coachErr}`);
        continue;
      }
      const record = {
        contactId: bundle.contactId,
        contactName: bundle.contactName,
        date: dateStr,
        generatedAt: new Date().toISOString(),
        hasAudio: anyAudio,
        callCount: bundle.calls.length,
        threadCount: bundle.thread.length,
        coaching,
      };
      await safePut(env, `${KV_CALL_PREFIX}${dateStr}:${bundle.contactId}`, record, RESULT_TTL_S);
      await safePut(env, `${KV_LATEST_PREFIX}${bundle.contactId}`, record, LATEST_TTL_S);
      stats.coached++;
    } catch (err) {
      stats.failed++;
      console.warn(`[call-coach] ${bundle.contactId} failed: ${err.message}`);
    }
  }

  // ── Accumulate stats in KV ──
  const lastRun = (await env.PORTAL_KV.get(KV_LAST_RUN, "json")) || {};
  lastRun.contactsProcessed = (lastRun.contactsProcessed || 0) + bundles.length;
  lastRun.coached            = (lastRun.coached || 0)            + stats.coached;
  lastRun.failed             = (lastRun.failed || 0)             + stats.failed;
  lastRun.callsTranscribed   = (lastRun.callsTranscribed || 0)   + stats.callsTranscribed;
  lastRun.callsNoRecording   = (lastRun.callsNoRecording || 0)   + stats.callsNoRecording;

  const nextOffset = offset + BATCH_SIZE;
  if (nextOffset < allIds.length) {
    // More batches to go — chain next batch and update status.
    lastRun.offset = nextOffset;
    await safePut(env, KV_LAST_RUN, lastRun);
    console.log(`[call-coach] Batch done (offset ${offset}); queuing next at ${nextOffset}`);
    ctx.waitUntil(runCoach(env, ctx, dateStr, nextOffset));
  } else {
    // All batches done — rebuild digest and finalise status.
    lastRun.status = "ok";
    lastRun.finishedAt = new Date().toISOString();
    await safePut(env, KV_LAST_RUN, lastRun);
    await buildDigest(env, dateStr);
    console.log(
      `[call-coach] Done ${dateStr}: coached=${lastRun.coached} transcribed=${lastRun.callsTranscribed} ` +
      `noRecording=${lastRun.callsNoRecording} failed=${lastRun.failed}`,
    );
  }
}

// Build (or rebuild) the daily digest from the per-contact call-coach records.
async function buildDigest(env, date) {
  const prefix = `${KV_CALL_PREFIX}${date}:`;
  const listed = await env.PORTAL_KV.list({ prefix });
  const items = [];
  for (const k of listed.keys) {
    const rec = await env.PORTAL_KV.get(k.name, "json");
    if (!rec?.coaching) continue;
    items.push({
      contactId: rec.contactId,
      contactName: rec.contactName,
      hasAudio: rec.hasAudio,
      summary: rec.coaching.summary,
      nextStep: rec.coaching.nextStep,
      signal: rec.coaching.signal,
      topImprovement: rec.coaching.whatToImprove?.[0] || null,
    });
  }
  const digest = { date, generatedAt: new Date().toISOString(), count: items.length, items };
  await safePut(env, `${KV_DAILY_PREFIX}${date}`, digest, RESULT_TTL_S);
  return digest;
}

// Transcribe one recording via Workers AI Whisper.
async function transcribeCall(env, messageId) {
  try {
    const stored = await fetchStoredTranscription(env, messageId);
    if (stored) return { transcript: stored, source: "ghl-stored" };
  } catch {
    // fall through to audio
  }
  const rec = await fetchRecording(env, messageId);
  if (!rec) return { transcript: null, source: "none", error: "no recording" };
  try {
    const bytes = [...new Uint8Array(rec.buffer)];
    const out = await env.AI.run(WHISPER_MODEL, { audio: bytes });
    const text = (out?.text || "").trim();
    if (!text) return { transcript: null, source: "whisper", error: "empty transcript", bytes: rec.bytes };
    return { transcript: text, source: "whisper", bytes: rec.bytes };
  } catch (err) {
    return { transcript: null, source: "whisper", error: `whisper failed: ${err.message}`, bytes: rec.bytes };
  }
}

// Assemble the chronological call-transcript text for a relationship bundle.
// stats is optional (only updated from the cron batch path, not /coach-one).
async function assembleCallTranscript(env, calls, stats) {
  let freshTranscribed = 0;
  let anyAudio = false;
  const parts = [];
  for (const call of calls) {
    let text = null;
    let source = null;
    const cached = await env.PORTAL_KV.get(`transcript:${call.messageId}`, "json");
    if (cached?.text) {
      text = cached.text;
      source = "cached";
    } else if (call.isTrigger && freshTranscribed < MAX_CALLS_PER_CONTACT) {
      const r = await transcribeCall(env, call.messageId);
      if (r.transcript) {
        text = r.transcript;
        source = r.source;
        freshTranscribed++;
      } else if (r.error === "no recording" && stats) {
        stats.callsNoRecording++;
      }
    }
    if (text) {
      anyAudio = true;
      if (source !== "cached" && stats) stats.callsTranscribed++;
      parts.push(`[call ${call.date} · ${call.direction} · ${call.duration}s · via ${source}]\n${text}`);
    } else {
      parts.push(`[call ${call.date} · ${call.direction} · ${call.duration}s · (no transcript on record)]`);
    }
  }
  return { transcript: parts.length ? parts.join("\n\n") : null, anyAudio };
}

async function safePut(env, key, value, ttl) {
  try {
    const opts = ttl ? { expirationTtl: ttl } : undefined;
    await env.PORTAL_KV.put(key, JSON.stringify(value), opts);
  } catch (err) {
    console.warn(`[call-coach] KV put failed for ${key}: ${err.message}`);
  }
}
