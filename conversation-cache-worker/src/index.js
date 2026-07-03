// Conversation Cache Worker
// Maintains an incremental cache of GHL conversation history in KV so downstream
// consumers (the outreach coach's cadence step, learning, etc.) read the cache
// instead of each re-pulling 60 days of conversations from GHL every day.
//
// "Pull once, then only what changed." First run backfills ~90 days; every run
// after pulls only conversations whose last_message_date moved past the
// high-water mark (conv:sync:lastRun), with a 30-min overlap for safety.
//
// Routes (gated by WORKER_AUTH_SECRET):
//   /sync                 — run the incremental sync now (awaited), return summary
//   /status               — last-run summary
//   /conversations?contactId=  — read one contact's cached touch history
//   /index                — the roster { contactId: lastMessageDate }
//   /reconcile            — verify the due-list vs GHL, purge deleted ghost cards
//
// Cron: every 3 hours (see wrangler.toml). Each run: sync → derive → reconcile
//       ghost cards → transcribe a bounded batch of new call recordings.

import { runSync } from "./sync.js";
import { deriveCadence } from "./cadence.js";
import { reconcileDeletions } from "./reconcile.js";
import { getAccessToken, LOCATION_ID, ghlRetry } from "./ghl.js";
import { requireWorkerAuth } from "../../functions/lib/worker-auth.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const isCallType = (t) => {
  const u = String(t || "").toUpperCase();
  return u.includes("CALL") || t === 1;
};

// Download a call recording from GHL and transcribe it with Workers AI Whisper.
// Returns { ok, text?, status?, bytes? }. Cloud-only — no local whisper, no Mac.
async function transcribeRecording(env, messageId) {
  const token = await getAccessToken(env);
  const res = await fetch(`${GHL_BASE}/conversations/messages/${messageId}/locations/${LOCATION_ID}/recording`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "audio/x-wav" },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1000) return { ok: false, status: "empty" };
  // base64 in chunks (no 3M-element spread — that blows the Worker CPU) and use
  // the turbo model, which takes a base64 string instead of a number[] array.
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const audio = btoa(bin);
  const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio });
  return { ok: true, text: (out && out.text) || "", bytes: buf.byteLength };
}

// Ongoing auto-transcribe: scan recent conversations, transcribe any call we
// haven't done yet (bounded per run), and store the transcript linked to the
// contact. Idempotent — `transcript:{messageId}` marks done (incl. noRecording so
// dead calls aren't retried forever). Cron-friendly: `limit` keeps it under the
// worker wall-clock + the Workers-AI free allotment; it catches up over runs.
async function transcribePending(env, limit = 8) {
  const kv = env.PORTAL_KV;
  // Pull recent conversations (newest first); recordings only exist for recent
  // calls anyway, so a shallow scan keeps current without re-enumerating history.
  const seen = [];
  let startAfterDate = null;
  for (let page = 0; page < 2; page++) {
    let p = `/conversations/search?limit=100&sortBy=last_message_date&sort=desc`;
    if (startAfterDate) p += `&startAfterDate=${startAfterDate}`;
    let data;
    try { data = await ghlRetry(env, p); } catch { break; }
    const convs = data.conversations || [];
    if (!convs.length) break;
    seen.push(...convs);
    const last = convs[convs.length - 1];
    const cursor = last.sort?.[0] || last.lastMessageDate || last.dateUpdated;
    if (!cursor || convs.length < 100) break;
    startAfterDate = typeof cursor === "number" ? cursor : new Date(cursor).getTime();
  }
  let transcribed = 0, noRec = 0, skipped = 0, scanned = 0;
  for (const c of seen) {
    if (transcribed >= limit) break;
    if (!c.id) continue;
    let md;
    try { md = await ghlRetry(env, `/conversations/${c.id}/messages?limit=100`); } catch { continue; }
    const msgs = md.messages?.messages || md.messages || [];
    for (const m of msgs) {
      if (transcribed >= limit) break;
      if (!isCallType(m.messageType || m.type)) continue;
      const dur = Number(m.meta?.call?.duration) || 0;
      if (dur < 8) continue;                                   // dead-air / no-answer, nothing to transcribe
      scanned++;
      const key = `transcript:${m.id}`;
      if (await kv.get(key)) { skipped++; continue; }          // already done (or marked no-recording)
      const r = await transcribeRecording(env, m.id);
      if (!r.ok) {
        // mark no-recording so we don't retry every run; keep a light record.
        await kv.put(key, JSON.stringify({ messageId: m.id, contactId: m.contactId || c.contactId, noRecording: true, status: r.status }));
        noRec++;
        continue;
      }
      await kv.put(key, JSON.stringify({
        messageId: m.id, contactId: m.contactId || c.contactId,
        name: c.contactName || c.fullName || null,
        direction: m.direction === 0 || m.direction === "outbound" ? "outbound" : "inbound",
        durationSec: dur, date: m.dateAdded || m.date, text: r.text,
      }));
      transcribed++;
    }
  }
  return { transcribed, noRecording: noRec, skipped, callsScanned: scanned, convsScanned: seen.length };
}

export default {
  async scheduled(event, env, ctx) {
    // The Monday weekly cron does a FULL reconcile (drift insurance); the 3-hourly
    // cron does the cheap incremental sync. Both then derive the due-list.
    // Checked against the incremental cron (not the weekly one) so a future change
    // to the weekly schedule's exact time can't silently disable the full reconcile
    // again — see wrangler.toml [triggers].crons for the two schedules.
    const full = event.cron !== "0 */3 * * *";
    // Sync + derive, then transcribe a bounded batch of new call recordings
    // (catches up the backlog over runs, then stays current with new calls).
    ctx.waitUntil(
      runSync(env, full ? "cron-full" : "cron", full)
        .then(() => deriveCadence(env))
        // Reconcile ghost cards: verify a bounded batch of the just-written due-list
        // against GHL and purge any confirmed-deleted (404/410) contacts. Runs every
        // cron so a deleted contact drops off within one cycle (~3h), never the ~day
        // it took a human on 2026-07-02. Isolated so a reconcile hiccup can't abort
        // the transcribe step (and vice-versa).
        .then(() => reconcileDeletions(env).catch((e) => console.error("[cron] reconcile failed:", e.message)))
        .then(() => transcribePending(env, full ? 20 : 8))
        .catch((e) => console.error("[cron] transcribe failed:", e.message))
    );
  },

  async fetch(request, env, ctx) {
    const denied = requireWorkerAuth(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === "/sync" || url.pathname === "/__scheduled") {
      // Awaited inline (not ctx.waitUntil): the message fetches are I/O-bound and
      // can run tens of seconds; the caller waits for the summary.
      // ?full=1 forces a full reconcile (re-scan the whole window).
      const full = url.searchParams.get("full") === "1";
      const sync = await runSync(env, full ? "manual-full" : "manual", full);
      const cadence = await deriveCadence(env);
      return json({ sync, cadence });
    }

    if (url.pathname === "/cadence") {
      // Re-derive the due-list from the existing cache (no GHL conversation pull).
      const cadence = await deriveCadence(env);
      return json(cadence);
    }

    if (url.pathname === "/reconcile") {
      // Verify the current due-list against GHL and purge confirmed-deleted (404/410)
      // ghost cards now. ?batch=N overrides the per-run cap (default 40).
      const batch = Number(url.searchParams.get("batch")) || undefined;
      const result = await reconcileDeletions(env, batch ? { batch } : {});
      return json(result);
    }

    if (url.pathname === "/due") {
      const data = await env.PORTAL_KV.get("coach:due:latest", "json");
      return data ? json(data) : json({ error: "Never derived" }, 404);
    }

    // Proof-of-concept: transcribe one recording via Workers AI Whisper.
    // /transcribe-test?messageId=XXX  — confirms the cloud-Whisper path before
    // wiring it into the sync loop.
    if (url.pathname === "/transcribe-test") {
      const messageId = url.searchParams.get("messageId");
      if (!messageId) return json({ error: "messageId required" }, 400);
      const r = await transcribeRecording(env, messageId);
      return json(r, r.ok ? 200 : 422);
    }

    // Manual run of the auto-transcribe loop (also runs on the cron).
    // /transcribe-pending?limit=N
    if (url.pathname === "/transcribe-pending") {
      const limit = Math.min(40, Number(url.searchParams.get("limit")) || 8);
      const r = await transcribePending(env, limit);
      return json(r);
    }

    if (url.pathname === "/status") {
      const data = await env.PORTAL_KV.get("ops:conversation-cache:lastRun", "json");
      return data ? json(data) : json({ error: "Never run" }, 404);
    }

    if (url.pathname === "/conversations") {
      const id = url.searchParams.get("contactId");
      if (!id) return json({ error: "contactId required" }, 400);
      const data = await env.PORTAL_KV.get(`conv:${id}`, "json");
      return data ? json(data) : json({ contactId: id, cached: null }, 404);
    }

    if (url.pathname === "/index") {
      const data = (await env.PORTAL_KV.get("conv:index", "json")) || {};
      return json({ count: Object.keys(data).length, index: data });
    }

    return new Response("Not found. Use /sync, /cadence, /reconcile, /status, /conversations?contactId=, or /index.", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
