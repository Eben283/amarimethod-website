// funnel.js — Worker port of ~/.claude/ghl-mcp/funnel.mjs (v2).
//
// Faithful port of the local funnel snapshot builder. Pulls live GHL event data
// (contacts, conversations + per-conversation messages, gifted-session calendar
// events, payment transactions/invoices/orders), classifies calls / cohorts /
// sales (valued in SESSIONS SOLD), and computes frozen monthly targets.
//
// Output JSON shape is byte-compatible with /tmp/funnel-latest.json: same
// top-level keys (v, generatedAt, windowDays, goal, calls, sessions, sales,
// trailing90, targets, paceLine). The staff frontend + staff-funnel.js depend on
// this exact shape.
//
// Differences from funnel.mjs (intentional, environment-only):
//   - ghlRetry takes `env` (Worker token lives in KV, not a local file).
//   - Monthly targets freeze in KV (`funnel:targets` key) instead of the local
//     funnel-targets.json — the Worker has no filesystem.

import { ghlRetry, LOCATION_ID } from "./ghl.js";

const GIFTED_PARTNER_CALENDAR = "lfsnaiGiLNL2z12pLKDP"; // "Partner Initial Session"
const GOAL_PACKS_PER_MONTH = 8;
const SESSIONS_PER_PACK = 8;
// Call outcome tiers (ground-truthed against recordings 2026-06-11):
//   <20s  = hung up at voicemail / no answer → "none"
//   <120s = scripted voicemail left          → "vm"
//   ≥120s = live conversation                → "talk"
const CALL_TIER = { noneUnderSec: 20, voicemailUnderSec: 120 };
const DAY_MS = 86_400_000;
const TZ = "America/Los_Angeles";

export const KV_TARGETS_KEY = "funnel:targets";

// ---- targets ------------------------------------------------------------

// Monthly per-stage targets to land GOAL_PACKS_PER_MONTH, derived from the
// trailing-90 conversion chain (calls→talk, talk→book, book→show) + calls-per-pack
// efficiency. Falls back to a sensible default chain when the sample is too thin.
function computeTargets({ calls90, talk90, booked90, showed90, callsPerEquiv }) {
  const FALLBACK = { calls: 300, talk: 40, booked: 23, showed: 10, sales: GOAL_PACKS_PER_MONTH, source: "default" };
  if (!callsPerEquiv || calls90 < 30 || talk90 < 5 || booked90 < 3) return FALLBACK;
  const talkR = talk90 / calls90;
  const bookR = booked90 / talk90;
  const showR = booked90 ? showed90 / booked90 : 0;
  const calls = Math.round(GOAL_PACKS_PER_MONTH * callsPerEquiv);
  const talk = Math.max(1, Math.round(calls * talkR));
  const booked = Math.max(1, Math.round(talk * bookR));
  const showed = Math.max(1, Math.round(booked * showR));
  return { calls, talk, booked, showed, sales: GOAL_PACKS_PER_MONTH, source: "measured" };
}

// Freeze targets for the calendar month in KV; only recompute when the month
// rolls over. Mirrors funnel.mjs resolveMonthlyTargets but uses KV, not a file.
async function resolveMonthlyTargets(env, month, stats) {
  try {
    const saved = await env.PORTAL_KV.get(KV_TARGETS_KEY, "json");
    if (saved && saved.month === month && saved.targets) {
      return { ...saved.targets, asOf: saved.asOf };
    }
  } catch { /* recompute */ }
  const targets = computeTargets(stats);
  const asOf = new Date().toISOString();
  try {
    await env.PORTAL_KV.put(KV_TARGETS_KEY, JSON.stringify({ month, asOf, targets }));
  } catch { /* non-fatal */ }
  return { ...targets, asOf };
}

// ---- helpers ------------------------------------------------------------

// Local-date string (YYYY-MM-DD, Pacific) — UTC slicing would put a 5pm PT
// call on the next day.
const laDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

// Discipline cohort labels for the {discipline}-prospect tag scheme (2026-06-12).
const PROSPECT_LABEL = {
  golf: "Golf",
  tennis: "Tennis",
  pickleball: "Pickleball",
  "personal-training": "Personal Training",
  strength: "Strength",
  pilates: "Pilates",
  yoga: "Yoga",
  "run-coaching": "Run Coaching",
  "mental-health": "Mental Health",
};
function cohortFromTags(tags = []) {
  // New {discipline}-prospect scheme. Match an explicit discipline list so we
  // never mis-bucket ambassador-prospect (a different flow) as a discipline cohort.
  for (const t of tags) {
    if (t.endsWith("-prospect")) {
      const d = t.slice(0, -"-prospect".length);
      if (PROSPECT_LABEL[d]) return PROSPECT_LABEL[d];
    }
  }
  // Legacy tags (pre-2026-06-12) — kept so old contacts still bucket correctly.
  if (tags.includes("golf-new-partner")) return "Golf";
  if (tags.includes("tennis-new-partner")) return "Tennis";
  if (tags.includes("trainer-solo")) return "Trainer (solo)";
  if (tags.includes("trainer-facility")) return "Trainer (facility)";
  if (tags.some((t) => t.startsWith("trainer"))) return "Trainer (other)";
  return "Direct / untagged";
}

// limited-concurrency map so we don't hammer the API
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = null; console.warn("  warn:", e.message?.slice(0, 80)); }
    }
  });
  await Promise.all(workers);
  return out;
}

// Sale → sessions sold. Returns null for non-session products.
function classifySale(name, amt) {
  const n = (name || "").toLowerCase();
  const a = Number(amt);
  if (/gift card|living practice|balanced for life/.test(n)) return null;
  if (/entrainment/.test(n)) return null;
  if (/12.?week|care plan/.test(n)) return null;
  if (/upgrade/.test(n)) {
    if (/4.?session.*8.?session/.test(n)) return { s: 4, k: "upgrade 4→8" };
    if (/initial.*8/.test(n)) return { s: 7, k: "upgrade →8" };
    if (/initial.*4/.test(n)) return { s: 3, k: "upgrade →4" };
    return { s: 4, k: "upgrade" };
  }
  if (/8.?session|8.?series/.test(n)) return { s: 8, k: "8-pack" };
  if (/4.?session|4.?series/.test(n)) return { s: 4, k: "4-pack" };
  if (/follow.?up/.test(n)) return { s: 1, k: "single" };
  if (/initial|intro/.test(n)) return { s: 1, k: "initial" };
  // No usable name (e.g. calendar-billed) → amount heuristic from the catalog
  if (a === 1295) return { s: 8, k: "8-pack" };
  if (a === 720) return { s: 4, k: "4-pack" };
  if (a >= 425 && a <= 500) return { s: 1, k: "initial" };
  if (a >= 180 && a <= 235) return { s: 1, k: "single" };
  if (a === 90) return null; // entrainment price point
  return null;
}

// ---- loaders ------------------------------------------------------------

async function loadContacts(env, lid) {
  const byId = new Map();
  let after = null, afterId = null;
  for (let p = 0; p < 12; p++) {
    let path = `/contacts/?locationId=${lid}&limit=100`;
    if (afterId) path += `&startAfterId=${afterId}&startAfter=${after}`;
    const d = await ghlRetry(env, path);
    const cs = d.contacts || [];
    for (const c of cs) {
      byId.set(c.id, {
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        cohort: cohortFromTags(c.tags),
      });
    }
    afterId = d.meta?.startAfterId; after = d.meta?.startAfter;
    if (cs.length < 100 || !afterId) break;
  }
  console.log(`contacts: ${byId.size}`);
  return byId;
}

async function loadCalls(env, lid, cutoffMs, cohortOf) {
  const convs = new Map();
  let cursorDate = null, cursorId = null;
  for (let p = 0; p < 10; p++) {
    let path = `/conversations/search?locationId=${lid}&limit=100&sortBy=last_message_date&sort=desc`;
    if (cursorDate) path += `&startAfterDate=${encodeURIComponent(cursorDate)}&startAfter=${cursorId}`;
    const d = await ghlRetry(env, path);
    const cs = d.conversations || [];
    let advanced = false;
    for (const c of cs) if (!convs.has(c.id)) { convs.set(c.id, c); advanced = true; }
    const last = cs[cs.length - 1];
    if (!last || cs.length < 100 || !advanced) break;
    if (last.lastMessageDate && new Date(last.lastMessageDate).getTime() < cutoffMs) break;
    cursorDate = last.lastMessageDate; cursorId = last.id;
  }
  const inWindow = [...convs.values()].filter(
    (c) => !c.lastMessageDate || new Date(c.lastMessageDate).getTime() >= cutoffMs
  );
  console.log(`conversations in window: ${inWindow.length} (of ${convs.size} pulled)`);

  const raw = [];
  await mapLimit(inWindow, 3, async (c) => {
    const m = await ghlRetry(env, `/conversations/${c.id}/messages`);
    const msgs = m.messages?.messages || m.messages || [];
    for (const x of msgs) {
      if (!String(x.messageType || x.type || "").toUpperCase().includes("CALL")) continue;
      if ((x.direction || "").toLowerCase() !== "outbound") continue; // outreach only
      const ts = new Date(x.dateAdded).getTime();
      if (ts < cutoffMs) continue;
      const dur = x.meta?.call?.duration ?? 0;
      const status = (x.meta?.call?.status || x.status || "").toLowerCase();
      let o = "none";
      if (status === "completed" && dur >= CALL_TIER.voicemailUnderSec) o = "talk";
      else if (status === "completed" && dur >= CALL_TIER.noneUnderSec) o = "vm";
      raw.push({ d: laDate(x.dateAdded), o, c: cohortOf(x.contactId), contactId: x.contactId });
    }
  });
  // Collapse REDIALS — one call per contact per day, keeping the best outcome
  // (talked > voicemail > no-answer).
  const RANK = { talk: 3, vm: 2, none: 1 };
  const dedup = new Map();
  for (const r of raw) {
    const key = `${r.d}|${r.contactId || "?"}`;
    const prev = dedup.get(key);
    if (!prev || (RANK[r.o] || 0) > (RANK[prev.o] || 0)) dedup.set(key, r);
  }
  const calls = [...dedup.values()].map(({ contactId, ...rest }) => rest);
  console.log(`outbound calls in window: ${calls.length} unique (from ${raw.length} attempts)`);
  return calls;
}

async function loadGifted(env, lid, cutoffMs, cohortOf) {
  // Fetch FUTURE bookings too (was endTime=now, which silently dropped every
  // session scheduled for a future date).
  const futureEnd = Date.now() + 120 * 24 * 60 * 60 * 1000;
  const d = await ghlRetry(
    env,
    `/calendars/events?locationId=${lid}&calendarId=${GIFTED_PARTNER_CALENDAR}&startTime=${cutoffMs}&endTime=${futureEnd}`
  );
  const out = (d.events || []).map((e) => ({
    // Bucket by BOOKING date (dateAdded), not the session date.
    d: laDate(e.dateAdded || e.startTime),
    sessionDate: laDate(e.startTime || e.dateAdded),
    showed: (e.appointmentStatus || "") === "showed",
    invalid: (e.appointmentStatus || "") === "invalid",
    c: cohortOf(e.contactId),
  })).filter((e) => !e.invalid).map(({ invalid, ...rest }) => rest);
  console.log(`gifted sessions in window: ${out.length}`);
  return out;
}

// Transactions catch order + invoice + app + calendar sales.
async function loadSales(env, lid, contacts) {
  let tx = [];
  for (let off = 0; off < 600; off += 100) {
    const t = await ghlRetry(env, `/payments/transactions?altId=${lid}&altType=location&limit=100&offset=${off}`);
    const a = t.data || t.transactions || [];
    tx.push(...a);
    if (a.length < 100) break;
  }
  const paid = tx.filter((x) => x.status === "succeeded" && Number(x.amount) > 0);
  console.log(`succeeded transactions: ${paid.length}`);

  const classified = await mapLimit(paid, 3, async (x) => {
    let name = "";
    try {
      if (x.entityType === "invoice") {
        const inv = await ghlRetry(env, `/invoices/${x.entityId}?altId=${lid}&altType=location`);
        name = (inv.invoiceItems || inv.items || []).map((i) => i.name).join("; ");
      } else if (x.entityType === "order") {
        const o = await ghlRetry(env, `/payments/orders/${x.entityId}?altId=${lid}&altType=location`);
        name = (o.items || []).map((i) => i.name || i.price?.name).join("; ");
      }
    } catch { /* fall through to amount heuristic */ }
    const cls = classifySale(name, x.amount);
    if (!cls) return null;
    return {
      d: laDate(x.createdAt),
      s: cls.s,
      k: cls.k,
      c: contacts.get(x.contactId)?.cohort || "Direct / untagged",
      contactId: x.contactId,
      who: x.contactName || "",
    };
  });

  // Repeat flag: contact had an earlier classified sale
  const sales = classified.filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1));
  const seen = new Set();
  for (const s of sales) {
    s.r = seen.has(s.contactId);
    seen.add(s.contactId);
    delete s.contactId;
  }
  console.log(`session-sales classified: ${sales.length}`);
  return sales;
}

// ---- main ---------------------------------------------------------------

// Port of funnel.mjs main(). Returns the snapshot object (does not write KV —
// the caller decides which key to write, so we can target the TEST key).
export async function buildFunnelSnapshot(env, windowDays = 180) {
  const lid = LOCATION_ID;
  const cutoffMs = Date.now() - windowDays * DAY_MS;
  console.log(`\nBuilding funnel snapshot v2 — window ${windowDays}d, location ${lid}`);

  const contacts = await loadContacts(env, lid);
  const cohortOf = (id) => contacts.get(id)?.cohort || "Direct / untagged";

  const [calls, sessions, sales] = await Promise.all([
    loadCalls(env, lid, cutoffMs, cohortOf),
    loadGifted(env, lid, cutoffMs, cohortOf),
    loadSales(env, lid, contacts),
  ]);

  // trailing-90 calls-per-pack-equivalent → drives "need ~N calls/day"
  const cut90 = laDate(new Date(Date.now() - 90 * DAY_MS).toISOString());
  const calls90 = calls.filter((c) => c.d >= cut90).length;
  const equivs90 = sales.filter((s) => s.d >= cut90).reduce((t, s) => t + s.s, 0) / SESSIONS_PER_PACK;
  const callsPerEquiv = equivs90 >= 0.5 ? calls90 / equivs90 : null;

  // pace line for the current calendar month (Pacific)
  const todayStr = laDate(new Date().toISOString());
  const [yy, mm] = todayStr.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const dayOfMonth = Number(todayStr.slice(8, 10));
  const daysLeft = daysInMonth - dayOfMonth + 1;
  const monthPrefix = todayStr.slice(0, 7);

  // Per-stage monthly targets (frozen for the month).
  const sess90 = sessions.filter((s) => s.d >= cut90);
  const targets = await resolveMonthlyTargets(env, monthPrefix, {
    calls90,
    talk90: calls.filter((c) => c.d >= cut90 && c.o === "talk").length,
    booked90: sess90.length,
    showed90: sess90.filter((s) => s.showed).length,
    callsPerEquiv,
  });

  const equivsMonth = sales.filter((s) => s.d.startsWith(monthPrefix)).reduce((t, s) => t + s.s, 0) / SESSIONS_PER_PACK;
  const remaining = Math.max(0, GOAL_PACKS_PER_MONTH - equivsMonth);
  const needCalls = callsPerEquiv && remaining > 0 ? Math.round((remaining * callsPerEquiv) / daysLeft) : null;
  const paceLine =
    `Funnel: ${equivsMonth.toFixed(1)} of ${GOAL_PACKS_PER_MONTH} packs this month · ` +
    `${remaining.toFixed(1)} to go · ${daysLeft}d left` +
    (needCalls ? ` · ~${needCalls} calls/day` : "");

  const result = {
    v: 2,
    generatedAt: new Date().toISOString(),
    windowDays,
    goal: { packsPerMonth: GOAL_PACKS_PER_MONTH, sessionsPerPack: SESSIONS_PER_PACK },
    calls,      // [{d, o: "none"|"vm"|"talk", c: cohort}]
    sessions,   // [{d, showed, c}]
    sales,      // [{d, s: sessionsSold, k: kind, c, r: repeat, who}]
    trailing90: { calls: calls90, equivs: Number(equivs90.toFixed(2)), callsPerEquiv: callsPerEquiv ? Math.round(callsPerEquiv) : null },
    targets,    // { calls, talk, booked, showed, sales, source, asOf } — monthly, frozen
    paceLine,
  };

  console.log(paceLine);
  console.log(`calls ${calls.length} (talk ${calls.filter(c => c.o === "talk").length}, vm ${calls.filter(c => c.o === "vm").length}) · sessions ${sessions.length} (showed ${sessions.filter(s => s.showed).length}) · sales ${sales.length} = ${sales.reduce((t, s) => t + s.s, 0)} sessions sold`);

  return result;
}
