// Incremental conversation sync. Pulls only conversations changed since the last
// run (sorted by last_message_date, descending — stop as soon as we pass the
// high-water mark), fetches their messages, and upserts a trimmed per-contact
// touch history into KV. First run backfills BACKFILL_DAYS.
//
// KV written:
//   conv:{contactId}              -> { contactId, name, lastMessageDate, touches:[{ts,kind,dir}] }
//   conv:index                    -> { [contactId]: lastMessageDate }   (lightweight roster)
//   conv:sync:lastRun             -> high-water mark (ms) used to bound the next pull
//   ops:conversation-cache:lastRun-> last-run summary (observability)

import { ghlRetry } from "./ghl.js";

const DAY_MS = 86_400_000;
const BACKFILL_DAYS = 90;          // first run reaches back this far
const TRIM_DAYS = 90;              // keep only the last 90d of touches per contact
const OVERLAP_MS = 30 * 60 * 1000; // re-scan a 30-min overlap so nothing slips the boundary

// Message-type codes — mirror outreach-cadence.mjs so the cache and the local
// pipeline classify touches identically.
const CALL = new Set([1, 8, 13, 22]);
const SMS = new Set([2, 7, 14, 20, 4, 6]);
const EMAIL = new Set([3, 9, 21]);
function kind(t) {
  const n = typeof t === "number" ? t : Number(t);
  if (CALL.has(n)) return "call";
  if (SMS.has(n)) return "sms";
  if (EMAIL.has(n)) return "email";
  if (typeof t === "string") {
    const u = t.toUpperCase();
    if (u.includes("CALL")) return "call";
    if (u.includes("SMS")) return "sms";
    if (u.includes("EMAIL")) return "email";
  }
  return "other";
}
const isOut = (m) => m.direction === 0 || m.direction === "outbound";
// GHL OMITS `direction` on outbound campaign emails (it comes back undefined, not
// "inbound"/1). Without this, our OWN cold-batch emails get stored as inbound →
// phantom "replies" → false reply-waiting cards (the 2026-06-17 audit finding).
// Treat a direction-less EMAIL as outbound; SMS/calls always carry a direction.
export function touchDir(m, k) {
  return (isOut(m) || (m.direction == null && k === "email")) ? "out" : "in";
}

// limited-concurrency map (ported from funnel.mjs) — sequential message fetches
// over a 90-day backfill blow the Worker wall-clock; 5-wide keeps it well under.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runSync(env, trigger, full = false) {
  const kv = env.PORTAL_KV;
  const start = Date.now();
  const prevHigh = Number(await kv.get("conv:sync:lastRun")) || 0;
  const firstRun = !prevHigh;
  // `full` (weekly reconcile) ignores the high-water mark and re-scans the whole
  // BACKFILL_DAYS window — cheap insurance against incremental drift (a missed
  // cursor / half-completed run silently leaving the cache wrong). Merge is
  // idempotent (dedupe by ts|kind|dir), so re-scanning only fixes, never harms.
  const cutoff = (firstRun || full) ? start - BACKFILL_DAYS * DAY_MS : prevHigh - OVERLAP_MS;

  // 1. Collect conversations changed since the cutoff (newest first; stop early).
  const changed = [];
  let startAfterDate = null;
  for (let page = 0; page < 80; page++) {
    let p = `/conversations/search?limit=100&sortBy=last_message_date&sort=desc`;
    if (startAfterDate) p += `&startAfterDate=${startAfterDate}`;
    let data;
    try { data = await ghlRetry(env, p); } catch (e) { break; }
    const convs = data.conversations || [];
    if (!convs.length) break;
    let hitCutoff = false;
    for (const c of convs) {
      const lm = new Date(c.lastMessageDate || c.dateUpdated || 0).getTime();
      if (lm < cutoff) { hitCutoff = true; break; }
      changed.push(c);
    }
    if (hitCutoff || convs.length < 100) break;
    const last = convs[convs.length - 1];
    const cursor = last.sort?.[0] || last.lastMessageDate || last.dateUpdated;
    if (!cursor) break;
    startAfterDate = typeof cursor === "number" ? cursor : new Date(cursor).getTime();
  }

  // 2. For each changed conversation, fetch messages and merge into its contact
  //    cache — 5-wide so the backfill fits the Worker wall-clock.
  const trimCutoff = start - TRIM_DAYS * DAY_MS;
  const indexUpdates = {};
  let contactsUpdated = 0;
  let newTouches = 0;
  await mapLimit(changed, 5, async (c) => {
    if (!c.contactId) return;
    let md;
    try { md = await ghlRetry(env, `/conversations/${c.id}/messages?limit=100`); } catch { return; }
    const msgs = md.messages?.messages || md.messages || [];
    const fresh = [];
    for (const m of msgs) {
      const ts = new Date(m.dateAdded || m.date || 0).getTime();
      if (!ts) continue;
      const k = kind(m.messageType || m.type);
      if (k === "other") continue;
      // Capture call duration (seconds) — the free signal that distinguishes a
      // no-answer (short) from a voicemail left (medium) from a real talk (long),
      // which both the cadence variant (talked → warm) and the truthful copy
      // ("tried to reach" vs "left a voicemail" vs "talked") key off.
      const t = { ts, kind: k, dir: touchDir(m, k) };
      if (k === "call") t.dur = Number(m.meta?.call?.duration) || 0;
      else { const b = (m.body || "").trim(); if (b) t.text = b.slice(0, 280); } // last-message text → closer/autoresponder detection in cadence
      fresh.push(t);
    }
    if (!fresh.length) return;

    const key = `conv:${c.contactId}`;
    const existing = (await kv.get(key, "json")) || { contactId: c.contactId, touches: [] };
    const seen = new Map((existing.touches || []).map((t) => [`${t.ts}|${t.kind}|${t.dir}`, t]));
    let added = 0;
    for (const t of fresh) {
      const id = `${t.ts}|${t.kind}|${t.dir}`;
      const prev = seen.get(id);
      if (!prev) { seen.set(id, t); added++; }
      else {
        // Backfill newer fields (dur, text) onto already-cached touches stored
        // before we captured them, on a re-sync/reconcile.
        const patch = {};
        if (t.dur != null && prev.dur == null) patch.dur = t.dur;
        if (t.text != null && prev.text == null) patch.text = t.text;
        if (Object.keys(patch).length) seen.set(id, { ...prev, ...patch });
      }
    }
    const merged = [...seen.values()].filter((t) => t.ts >= trimCutoff).sort((a, b) => a.ts - b.ts);
    const name = c.contactName || c.fullName || existing.name || c.contactId;
    const lastMessageDate = merged.length ? merged[merged.length - 1].ts : (existing.lastMessageDate || 0);
    await kv.put(key, JSON.stringify({ contactId: c.contactId, name, lastMessageDate, touches: merged }));
    indexUpdates[c.contactId] = lastMessageDate;
    contactsUpdated++;
    newTouches += added;
  });

  // 3. Update the roster index.
  if (Object.keys(indexUpdates).length) {
    const index = (await kv.get("conv:index", "json")) || {};
    Object.assign(index, indexUpdates);
    await kv.put("conv:index", JSON.stringify(index));
  }

  // 4. Advance the high-water mark + write the run summary.
  await kv.put("conv:sync:lastRun", String(start));
  const summary = {
    trigger,
    ranAt: new Date(start).toISOString(),
    firstRun,
    cutoff: new Date(cutoff).toISOString(),
    changedConversations: changed.length,
    contactsUpdated,
    newTouches,
    durationMs: Date.now() - start,
  };
  await kv.put("ops:conversation-cache:lastRun", JSON.stringify(summary));
  return summary;
}
