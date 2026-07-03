// Incremental conversation sync. Pulls only conversations changed since the last
// run (sorted by last_message_date, descending — stop as soon as we pass the
// high-water mark), fetches their messages, and upserts a trimmed per-contact
// touch history into KV. First run backfills BACKFILL_DAYS.
//
// KV written:
//   conv:{contactId}  -> {
//     contactId, name, firstName, lastName, lastMessageDate,
//     touches: [{ts,kind,dir,dur?,text?}],
//     role, business, rundown,     ← GHL custom fields (refreshed every 24h)
//     email,                       ← provenance signal (placeholder = imported phone)
//     lineType,                    ← from contact:linetype map
//     dossierFetchedAt             ← ms of last profile fetch (gates the 24h refresh)
//   }
//   conv:index                    -> { [contactId]: lastMessageDate }
//   conv:sync:lastRun             -> high-water mark (ms)
//   ops:conversation-cache:lastRun-> last-run summary (observability)

import { ghlRetry } from "./ghl.js";

const DAY_MS = 86_400_000;
const BACKFILL_DAYS = 90;          // first run reaches back this far
const TRIM_DAYS = 90;              // keep only the last 90d of touches per contact
const OVERLAP_MS = 30 * 60 * 1000; // re-scan a 30-min overlap so nothing slips the boundary
const PROFILE_TTL = DAY_MS;        // re-fetch contact profile once per 24h per contact
// Profile staleness reconciliation (2026-07-03): the changed-conversation pass only
// re-pulls a profile for contacts with NEW messages, so a GHL rename/correction on a
// QUIET contact never propagates (Mike Jigalin stayed "Jennifer"; Brendan Vu "Brandon").
// Walk the roster on a rotating cursor and re-pull any profile older than the TTL even
// with zero new messages, bounded so the extra GHL fetches never blow the wall-clock.
const PROFILE_REFRESH_TTL = 7 * DAY_MS;   // re-pull an untouched contact's profile weekly
const PROFILE_SCAN_WINDOW = 120;          // # of cached contacts checked per run (rotating)
const PROFILE_REFRESH_CAP = 20;           // # of GHL profile fetches per run (rate-limit bound)

// Pure: from a scanned window of cached records, pick the contacts whose dossier profile is
// older than `ttl` (a never-fetched profile counts as stale), oldest-first, capped, skipping
// any already refreshed by the changed-conversation pass this run. Exported for tests.
export function staleProfileIds(records, alreadyRefreshed, now, ttl = PROFILE_REFRESH_TTL, cap = PROFILE_REFRESH_CAP) {
  const skip = alreadyRefreshed || new Set();
  const due = [];
  for (const r of records || []) {
    if (!r || !r.contactId || skip.has(r.contactId)) continue;
    const age = r.dossierFetchedAt ? now - r.dossierFetchedAt : Infinity;
    if (age > ttl) due.push({ contactId: r.contactId, at: r.dossierFetchedAt || 0 });
  }
  due.sort((a, b) => a.at - b.at); // oldest profile first — drain the backlog over runs
  return due.slice(0, cap).map((d) => d.contactId);
}

// GHL custom-field IDs for partner-prospect dossier (mirrors card-brain-generate.mjs FID).
const DOSSIER_FIELDS = {
  role:     "FGakk9CgiRqeY0tleGQD",
  business: "eYBj61zgMnIFMIesoDR5",
  rundown:  "Yd3lsw6fAxl0HVCxr1cD",
};

// contact:linetype entries are shaped {phone, type, isVoip, carrier, valid,
// checkedAt} (see ops/scripts/classify-line-type.mjs). The AbstractAPI path
// computes isVoip SEPARATELY from type — a number can come back type
// "mobile" with isVoip true (the carrier_type text just didn't literally say
// "voip"). Reading only `.type` silently drops that signal and lets a real
// VoIP number read as textable downstream. isVoip wins when true.
export function resolveLineType(entry) {
  if (!entry) return null;
  if (entry.isVoip) return "voip";
  return entry.type ?? null;
}

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

// Map a fetched GHL contact → the dossier profile persisted on conv:{id}.
// Exported for tests. `email` matters for phone provenance: import-created contacts
// carry *@amari-prospect.placeholder, which tells buildCard the phone on file is
// unverified CSV research (never dial/text it — the 2026-07-02 wrong-number fix).
export function profileFromContact(contact, fetchedAt) {
  const gf = (id) => {
    const f = (contact.customFields || contact.customField || []).find((x) => x.id === id);
    const v = f ? (f.value ?? f.field_value) : null;
    return (v === "" || v == null) ? null : v;
  };
  return {
    firstName:        contact.firstName || "",
    lastName:         contact.lastName  || "",
    email:            contact.email     || null,
    role:             gf(DOSSIER_FIELDS.role),
    business:         gf(DOSSIER_FIELDS.business),
    rundown:          gf(DOSSIER_FIELDS.rundown),
    dossierFetchedAt: fetchedAt,
  };
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
  let hadPaginationError = false;
  for (let page = 0; page < 80; page++) {
    let p = `/conversations/search?limit=100&sortBy=last_message_date&sort=desc`;
    if (startAfterDate) p += `&startAfterDate=${startAfterDate}`;
    let data;
    try { data = await ghlRetry(env, p); } catch (e) { hadPaginationError = true; break; }
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
  // Read line-type map once; used to stamp lineType onto each contact record.
  const lineTypeMap = (await kv.get("contact:linetype", "json")) || {};
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
      if (k === "call") { t.dur = Number(m.meta?.call?.duration) || 0; if (m.id) t.msgId = m.id; }
      else { const b = (m.body || "").trim(); if (b) t.text = b.slice(0, 280); } // last-message text → closer/autoresponder detection in cadence
      fresh.push(t);
    }
    if (!fresh.length) return;

    const key = `conv:${c.contactId}`;
    const existing = (await kv.get(key, "json")) || { contactId: c.contactId, touches: [] };
    // Dedup by ts|kind (NOT dir): the same message is one touch. Keying on dir too
    // meant a corrected direction (e.g. touchDir re-stamping a campaign email
    // out→in) created a DUPLICATE touch instead of replacing the stale one. A fresh
    // fetch is authoritative for dir; preserve dur/text across the merge. Distinct
    // messages don't collide (ms timestamps), so this won't merge a real in/out pair.
    const seen = new Map((existing.touches || []).map((t) => [`${t.ts}|${t.kind}`, t]));
    let added = 0;
    for (const t of fresh) {
      const id = `${t.ts}|${t.kind}`;
      const prev = seen.get(id);
      if (!prev) { seen.set(id, t); added++; }
      else seen.set(id, { ...prev, ...t, dur: t.dur ?? prev.dur, text: t.text ?? prev.text }); // fresh wins on dir; keep dur/text
    }
    const merged = [...seen.values()].filter((t) => t.ts >= trimCutoff).sort((a, b) => a.ts - b.ts);
    const name = c.contactName || c.fullName || existing.name || c.contactId;
    const lastMessageDate = merged.length ? merged[merged.length - 1].ts : (existing.lastMessageDate || 0);

    // Conditionally refresh dossier profile (role, business, rundown, name parts).
    // Only hits GHL when the stored profile is absent or older than PROFILE_TTL (24h).
    const profileAge = existing.dossierFetchedAt ? (start - existing.dossierFetchedAt) : Infinity;
    let profile = {};
    if (profileAge > PROFILE_TTL) {
      try {
        const cd = await ghlRetry(env, `/contacts/${c.contactId}`);
        profile = profileFromContact(cd.contact || cd, start);
      } catch { /* keep existing profile on error; will retry next run */ }
    }

    await kv.put(key, JSON.stringify({
      contactId:        c.contactId,
      name,
      firstName:        profile.firstName        ?? existing.firstName        ?? "",
      lastName:         profile.lastName         ?? existing.lastName         ?? "",
      email:            profile.email            ?? existing.email            ?? null,
      role:             profile.role             ?? existing.role             ?? null,
      business:         profile.business         ?? existing.business         ?? null,
      rundown:          profile.rundown          ?? existing.rundown          ?? null,
      // buildCard expects a plain string — resolveLineType folds in isVoip.
      lineType:         (resolveLineType(lineTypeMap[c.contactId]) || existing.lineType) ?? null,
      dossierFetchedAt: profile.dossierFetchedAt ?? existing.dossierFetchedAt ?? null,
      lastMessageDate,
      touches:          merged,
    }));
    indexUpdates[c.contactId] = lastMessageDate;
    contactsUpdated++;
    newTouches += added;
  });

  // 3. Update the roster index, pruning entries not seen in TRIM_DAYS so it
  // doesn't grow without bound (a contact who drops out of the 90d window
  // would otherwise stay in the index forever and inflate its size).
  if (Object.keys(indexUpdates).length) {
    const index = (await kv.get("conv:index", "json")) || {};
    Object.assign(index, indexUpdates);
    for (const [cid, ts] of Object.entries(index)) {
      if (ts < trimCutoff) delete index[cid];
    }
    await kv.put("conv:index", JSON.stringify(index));
  }

  // 3b. Refresh a bounded, rotating window of UNTOUCHED contacts' dossier profiles on a TTL.
  // The changed-conversation pass above only re-pulls profiles for contacts with new
  // messages, so a GHL rename/correction on a quiet contact stays stale forever. Walk the
  // roster on a persisted cursor so every contact's profile is re-pulled at least weekly,
  // even with zero new messages — bounded GHL fetches (PROFILE_REFRESH_CAP) per run.
  let profilesRefreshed = 0;
  try {
    const roster = (await kv.get("conv:index", "json")) || {};
    const ids = Object.keys(roster).sort();
    if (ids.length) {
      const cursor = Number(await kv.get("conv:profile:cursor")) || 0;
      const window = [];
      for (let k = 0; k < Math.min(PROFILE_SCAN_WINDOW, ids.length); k++) {
        window.push(ids[(cursor + k) % ids.length]);
      }
      const scanned = (await mapLimit(window, 5, async (id) => {
        const rec = await kv.get(`conv:${id}`, "json");
        return rec ? { contactId: id, dossierFetchedAt: rec.dossierFetchedAt, rec } : null;
      })).filter(Boolean);
      const recById = new Map(scanned.map((s) => [s.contactId, s.rec]));
      const stale = staleProfileIds(
        scanned.map(({ contactId, dossierFetchedAt }) => ({ contactId, dossierFetchedAt })),
        new Set(Object.keys(indexUpdates)),
        start,
      );
      await mapLimit(stale, 5, async (id) => {
        const existing = recById.get(id);
        if (!existing) return;
        let profile;
        try {
          const cd = await ghlRetry(env, `/contacts/${id}`);
          profile = profileFromContact(cd.contact || cd, start);
        } catch { return; } // keep existing profile on error; next run retries
        await kv.put(`conv:${id}`, JSON.stringify({
          ...existing,
          firstName:        profile.firstName        ?? existing.firstName        ?? "",
          lastName:         profile.lastName         ?? existing.lastName         ?? "",
          email:            profile.email            ?? existing.email            ?? null,
          role:             profile.role             ?? existing.role             ?? null,
          business:         profile.business         ?? existing.business         ?? null,
          rundown:          profile.rundown          ?? existing.rundown          ?? null,
          dossierFetchedAt: profile.dossierFetchedAt ?? start,
        }));
        profilesRefreshed++;
      });
      await kv.put("conv:profile:cursor", String((cursor + PROFILE_SCAN_WINDOW) % ids.length));
    }
  } catch { /* non-fatal: staleness reconcile is best-effort, never blocks the sync */ }

  // 4. Advance the high-water mark + write the run summary.
  // Only advance if pagination completed without error. A partial pull (pagination broke
  // mid-run) means some conversations in the window were never fetched — advancing would
  // cause the next run to skip them. The weekly full=true reconcile will catch the gap.
  if (!hadPaginationError) {
    await kv.put("conv:sync:lastRun", String(start));
  } else {
    console.warn(`[sync] Pagination error on page scan — NOT advancing watermark. Will re-scan from previous cutoff on next run.`);
  }
  const summary = {
    trigger,
    ranAt: new Date(start).toISOString(),
    firstRun,
    cutoff: new Date(cutoff).toISOString(),
    changedConversations: changed.length,
    contactsUpdated,
    newTouches,
    profilesRefreshed,
    durationMs: Date.now() - start,
  };
  await kv.put("ops:conversation-cache:lastRun", JSON.stringify(summary));
  return summary;
}
