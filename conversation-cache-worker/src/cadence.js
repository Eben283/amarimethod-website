// Cloud cadence + due derivation. Reads the conversation cache (conv:*) and the
// gifted-session calendar, then computes the same per-contact state + "is a touch
// due today" that the local outreach-cadence.mjs + coach-build.mjs produced — but
// in the cloud, off the cache, so the coach no longer re-pulls 60 days of GHL.
//
// Writes KV `coach:due:latest` (same shape as the local coach-due.json):
//   { generatedAt, generatedAtISO, due:[{contactId,name,state,action,priority,...}], counts }

import { ghlRetry, LOCATION_ID } from "./ghl.js";

const DAY = 86_400_000;
const SESSION_GAP_MS = 2 * 3_600_000;   // touches within 2h = one event
const HIGH_VOLUME = 10;                  // 10+ outbound events = active client/hot thread, reviewed separately
const ACTIVE_DAYS = 65;                  // only consider contacts touched this recently
const DROPPED_MAX_DAYS = 30;
const GIFTED_PARTNER_CALENDAR = "lfsnaiGiLNL2z12pLKDP";
const BOOKING_SUPPRESS_DAYS = 21;

// Cadence policy (amari/strategy/outreach-cadence-policy.md): days to wait after
// the nth outbound touch before the next. Widens; 6 is end-of-rope.
const WAIT_AFTER_TOUCH = [2, 2, 3, 4, 5, 7];
const END_OF_ROPE = 6;
const waitAfter = (n) => WAIT_AFTER_TOUCH[Math.min(n, WAIT_AFTER_TOUCH.length) - 1] ?? 7;

const INTERNAL = new Set(["garrett@amarimethod.com", "eben metivier", "eben", "garrett"]);
const isInternal = (name) => {
  const n = (name || "").trim().toLowerCase();
  return INTERNAL.has(n) || n.includes("amarimethod.com");
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  }));
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Collapse consecutive same-direction touches within SESSION_GAP_MS into one event.
function collapseEvents(touches) {
  const sorted = [...touches].sort((a, b) => a.ts - b.ts);
  const events = [];
  for (const t of sorted) {
    const last = events[events.length - 1];
    if (last && last.dir === t.dir && t.ts - last.lastTs <= SESSION_GAP_MS) {
      last.lastTs = t.ts;
    } else {
      events.push({ ts: t.ts, lastTs: t.ts, dir: t.dir });
    }
  }
  return events;
}

function buildRow(contactId, name, touches) {
  const events = collapseEvents(touches);
  const out = events.filter((e) => e.dir === "out");
  const inb = events.filter((e) => e.dir === "in");
  const outGaps = [];
  for (let i = 1; i < out.length; i++) outGaps.push(out[i].ts - out[i - 1].ts);
  let droppedReplies = 0;
  for (const im of inb) { if (!out.find((o) => o.ts > im.ts)) droppedReplies++; }
  const last = events[events.length - 1];
  const medGap = median(outGaps);
  return {
    contactId,
    name,
    internal: isInternal(name),
    outCount: out.length,
    inCount: inb.length,
    firstTouch: events[0].ts,
    lastTouch: last.ts,
    lastDir: last.dir,
    sinceLastTouchDays: (Date.now() - last.ts) / DAY,
    // In DAYS (the local outreach-cadence.mjs stored raw ms here — the bug B flagged).
    medianOutGapDays: medGap == null ? null : medGap / DAY,
    droppedReplies,
    highVolume: out.length >= HIGH_VOLUME,
    hasHumanTouch: touches.some((t) => t.dir === "out" && (t.kind === "call" || t.kind === "sms")),
  };
}

// Port of coach-build.mjs classify() — same states + due logic + the machine-knowable excludes.
function classify(p) {
  const since = p.sinceLastTouchDays;
  const outN = p.outCount;

  if (p.hasBooking) return { state: "booked", due: false, action: "Already booked or just attended a session", priority: 0 };
  if (p.hasHumanTouch === false) return { state: "drip-only", due: false, action: "Email/quiz drip only, not a call or text target", priority: 0 };

  if (p.droppedReplies > 0 && since <= DROPPED_MAX_DAYS) {
    return { state: "reply-waiting", due: true, action: "Respond to their reply now", priority: 100 + Math.max(0, 30 - since) };
  }
  if (p.lastDir === "in") {
    return { state: "their-court", due: false, action: "Waiting on them (confirm in thread)", priority: 0 };
  }
  if (outN >= END_OF_ROPE) {
    return { state: "end-of-rope", due: since >= 14, action: `Touch #${outN} already sent. One last try or set aside.`, priority: since >= 14 ? 20 : 0 };
  }
  const wait = waitAfter(outN);
  const due = since >= wait;
  const state = outN === 1 ? (p.inCount > 0 ? "talked-no-next" : "one-touch-no-reply")
                           : (p.inCount > 0 ? "gone-quiet" : "no-reply");
  const nextTouch = outN + 1;
  const action = due
    ? `Send touch #${nextTouch} now (last touch ${since.toFixed(0)}d ago, cadence says by ${wait}d)`
    : `Not yet — next touch in ${(wait - since).toFixed(0)}d`;
  const priority = due ? 60 + Math.min(40, since - wait) : 0;
  return { state, due, action, priority };
}

// Contacts with a gifted session upcoming or attended in the last 21d.
async function loadBookedSet(env) {
  const set = new Set();
  try {
    const start = Date.now() - BOOKING_SUPPRESS_DAYS * DAY;
    const end = Date.now() + 120 * DAY;
    const d = await ghlRetry(env, `/calendars/events?locationId=${LOCATION_ID}&calendarId=${GIFTED_PARTNER_CALENDAR}&startTime=${start}&endTime=${end}`);
    for (const e of d.events || []) {
      const status = (e.appointmentStatus || "").toLowerCase();
      if (status === "cancelled" || status === "invalid" || status === "noshow") continue;
      if (e.contactId) set.add(e.contactId);
    }
  } catch { /* no suppression this run */ }
  return set;
}

export async function deriveCadence(env) {
  const kv = env.PORTAL_KV;
  const start = Date.now();
  const index = (await kv.get("conv:index", "json")) || {};
  const activeCutoff = start - ACTIVE_DAYS * DAY;
  const activeIds = Object.entries(index)
    .filter(([, lastMs]) => Number(lastMs) >= activeCutoff)
    .map(([id]) => id);

  // Read each active contact's cached touches and build a row.
  const rows = (await mapLimit(activeIds, 10, async (id) => {
    const rec = await kv.get(`conv:${id}`, "json");
    if (!rec || !rec.touches?.length) return null;
    return buildRow(id, rec.name, rec.touches);
  })).filter(Boolean);

  const booked = await loadBookedSet(env);
  for (const r of rows) r.hasBooking = booked.has(r.contactId);

  const prospects = rows.filter((r) => !r.internal && !r.highVolume);
  const scored = prospects.map((p) => ({ ...p, ...classify(p) }));
  const due = scored.filter((s) => s.due).sort((a, b) => b.priority - a.priority);

  const counts = {};
  for (const d of due) counts[d.state] = (counts[d.state] || 0) + 1;

  const generatedAt = new Date(start).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const generatedAtISO = new Date(start).toISOString();

  // coach:due:latest — the due-list (same shape as the local coach-due.json).
  await kv.put("coach:due:latest", JSON.stringify({
    generatedAt, generatedAtISO, activeContacts: activeIds.length, prospects: prospects.length, due, counts,
  }));

  // coach:cadence:latest — the FULL prospects snapshot (replaces outreach-cadence.json
  // for the downstream coach-outcomes + coach-learning steps, and the Sharpen
  // instance's read-only analysis). Strip the internal-only `internal` flag.
  await kv.put("coach:cadence:latest", JSON.stringify({
    generatedAt, generatedAtISO, windowDays: 90,
    prospects: scored.map(({ internal, ...p }) => p),
  }));

  const summary = {
    ranAt: generatedAtISO,
    activeContacts: activeIds.length,
    prospects: prospects.length,
    dueCount: due.length,
    counts,
    bookedSuppressed: rows.filter((r) => r.hasBooking).length,
    dripOnly: scored.filter((s) => s.state === "drip-only").length,
    durationMs: Date.now() - start,
  };
  await kv.put("ops:coach-cadence:lastRun", JSON.stringify(summary));
  return summary;
}
