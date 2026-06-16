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

import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";
import {
  fetchRelationshipBundles,
  fetchRecording,
  fetchStoredTranscription,
  dateToRange,
  yesterdayPacific,
  todayPacific,
} from "./ghl.js";
import { coachInteraction } from "./coach.js";

const KV_CALL_PREFIX = "call-coach:";              // call-coach:{date}:{contactId}
const KV_DAILY_PREFIX = "call-coach:daily:";       // call-coach:daily:{date}
const KV_LAST_RUN = "call-coach:status:lastRun";
const RESULT_TTL_S = 30 * 86400;                   // 30-day retention

// Cap how many contacts/calls we process per run so one heavy day can't blow the
// subrequest budget or the Whisper quota. Tune as volume grows.
const MAX_CONTACTS = 40;
const MAX_CALLS_PER_CONTACT = 3;
const WHISPER_MODEL = "@cf/openai/whisper";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCoach(env, yesterdayPacific()));
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    // /run?date=YYYY-MM-DD — coach a given Pacific date (defaults to yesterday).
    // Fire-and-return: running inline exceeds the fetch request limit and gets cut
    // before writing the digest/status. waitUntil lets it finish in the background
    // (same as the cron). Poll /status or /latest after.
    if (url.pathname === "/run") {
      const date = url.searchParams.get("date") || yesterdayPacific();
      ctx.waitUntil(runCoach(env, date));
      return json({ started: true, date, message: "Coaching run started — check /status or /latest." }, 202);
    }

    // /latest?date=YYYY-MM-DD — read the daily digest (defaults to yesterday).
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

    return new Response("Not found", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Transcribe one recording via Workers AI Whisper. Tries GHL's stored
// transcription first (free), then Whisper. Returns { transcript, source } or
// { transcript: null, source, error }.
async function transcribeCall(env, messageId) {
  // 1) GHL stored transcription (cheap if present — usually absent here).
  try {
    const stored = await fetchStoredTranscription(env, messageId);
    if (stored) return { transcript: stored, source: "ghl-stored" };
  } catch {
    // fall through to audio
  }

  // 2) Download recording + Whisper.
  const rec = await fetchRecording(env, messageId);
  if (!rec) return { transcript: null, source: "none", error: "no recording" };

  try {
    // @cf/openai/whisper expects an array of bytes (Uint8Array → [...]).
    const bytes = [...new Uint8Array(rec.buffer)];
    const out = await env.AI.run(WHISPER_MODEL, { audio: bytes });
    const text = (out?.text || "").trim();
    if (!text) return { transcript: null, source: "whisper", error: "empty transcript", bytes: rec.bytes };
    return { transcript: text, source: "whisper", bytes: rec.bytes };
  } catch (err) {
    return { transcript: null, source: "whisper", error: `whisper failed: ${err.message}`, bytes: rec.bytes };
  }
}

async function runCoach(env, dateStr) {
  const startedAt = new Date().toISOString();
  console.log(`[call-coach] Coaching ${dateStr}`);

  const lastRun = {
    date: dateStr,
    startedAt,
    status: "running",
    contactsProcessed: 0,
    callsTranscribed: 0,
    callsNoRecording: 0,
    coached: 0,
    failed: 0,
  };

  let bundles;
  try {
    const { startMs, endMs } = dateToRange(dateStr);
    bundles = await fetchRelationshipBundles(env, startMs, endMs);
  } catch (err) {
    lastRun.status = "error";
    lastRun.error = `enumerate failed: ${err.message}`;
    lastRun.finishedAt = new Date().toISOString();
    await safePut(env, KV_LAST_RUN, lastRun);
    return lastRun;
  }

  bundles = bundles.slice(0, MAX_CONTACTS);
  const digestItems = [];

  for (const bundle of bundles) {
    try {
      // Assemble call content for the WHOLE relationship (chronological).
      // Prior calls: read the cached transcript:{messageId} the conversation-cache
      // pipeline already produced (free). Fresh in-window calls without a cache
      // yet: transcribe live (bounded). Either way the coach sees earlier calls.
      let freshTranscribed = 0;
      const transcriptParts = [];
      let anyAudio = false;
      for (const call of bundle.calls) {
        let text = null;
        let source = null;
        const cached = await env.PORTAL_KV.get(`transcript:${call.messageId}`, "json");
        if (cached?.text) {
          text = cached.text;
          source = "cached";
        } else if (call.isTrigger && freshTranscribed < MAX_CALLS_PER_CONTACT) {
          const r = await transcribeCall(env, call.messageId);
          if (r.transcript) { text = r.transcript; source = r.source; freshTranscribed++; }
          else if (r.error === "no recording") lastRun.callsNoRecording++;
        }
        if (text) {
          anyAudio = true;
          if (source !== "cached") lastRun.callsTranscribed++;
          transcriptParts.push(
            `[call ${call.date} · ${call.direction} · ${call.duration}s · via ${source}]\n${text}`
          );
        } else {
          // Still tell the coach the call happened — it's relationship context
          // even without a transcript (e.g. a never-recorded earlier call).
          transcriptParts.push(
            `[call ${call.date} · ${call.direction} · ${call.duration}s · (no transcript on record)]`
          );
        }
      }

      const transcript = transcriptParts.length ? transcriptParts.join("\n\n") : null;

      const { coaching, error: coachErr } = await coachInteraction(env, {
        contactName: bundle.contactName,
        transcript,
        thread: bundle.thread,
      });

      if (coachErr) {
        // Nothing-to-coach is a normal skip, not a failure.
        if (!coachErr.startsWith("nothing to coach")) lastRun.failed++;
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
      lastRun.coached++;
      digestItems.push({
        contactId: bundle.contactId,
        contactName: bundle.contactName,
        hasAudio: anyAudio,
        summary: coaching.summary,
        nextStep: coaching.nextStep,
        signal: coaching.signal,
        topImprovement: coaching.whatToImprove?.[0] || null,
      });
    } catch (err) {
      lastRun.failed++;
      console.warn(`[call-coach] ${bundle.contactId} failed: ${err.message}`);
    }
    lastRun.contactsProcessed++;
  }

  // Daily digest.
  const digest = {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    count: digestItems.length,
    items: digestItems,
  };
  await safePut(env, `${KV_DAILY_PREFIX}${dateStr}`, digest, RESULT_TTL_S);

  lastRun.status = "ok";
  lastRun.finishedAt = new Date().toISOString();
  await safePut(env, KV_LAST_RUN, lastRun);

  console.log(
    `[call-coach] Done ${dateStr}: coached=${lastRun.coached} transcribed=${lastRun.callsTranscribed} ` +
    `noRecording=${lastRun.callsNoRecording} failed=${lastRun.failed}`
  );
  return { ...lastRun, digest };
}

async function safePut(env, key, value, ttl) {
  try {
    const opts = ttl ? { expirationTtl: ttl } : undefined;
    await env.PORTAL_KV.put(key, JSON.stringify(value), opts);
  } catch (err) {
    console.warn(`[call-coach] KV put failed for ${key}: ${err.message}`);
  }
}
