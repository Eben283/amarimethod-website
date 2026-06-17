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
const COLD_STALE_DAYS = 30;   // cold + quiet longer than this -> park (no endless "send step 2")
const GIFTED_PARTNER_CALENDAR = "lfsnaiGiLNL2z12pLKDP";
const BOOKING_SUPPRESS_DAYS = 21;

// Skip-persistence: honor the Follow-Up app's existing disposition so a contact
// Garrett/Eben "Set Aside" (which writes partner_stage) stays out of the coach too
// — no parallel skip system. Closed/parked stages suppress the coach card.
const CLOSED_STAGES = new Set(["dropped", "future-potential", "session-booked"]);
// GHL custom-field IDs (from staff-partner-prospects.js FIELD_IDS).
const FIELD = {
  stage: "KfPow1mYDxJqiOCS6mDZ",
  lastSignal: "XyUoMtbxadTuZunQwX3Y",
  lastSignalAt: "J0lnfsvtt0vcFOdSbUSf",
  followupAt: "stVYzQB4Xpi29cuyUYnA",
  lastRealActivity: "W7JoyJKPKhPI8hZ5EgUv",
  touchCount: "qKtPT2XZP61emgUDK7fd",
};
const getField = (contact, id) => {
  const f = (contact.customFields || contact.customField || []).find((x) => x.id === id);
  return f ? (f.value ?? f.field_value) : undefined;
};

// ── SHADOW: faithful port of the app's client-side actNowReason (`derive`) so we
// can compute the unified due-set server-side and DIFF it against the coach's
// touch-count model BEFORE touching the front-end. Constants copied verbatim from
// FollowUpPage.tsx. (engine-merge step 1 — shadow only, nothing consumes it yet.)
const VM_FOLLOWUP_DAYS = 3, TALKED_FOLLOWUP_DAYS = 1, LINK_FOLLOWUP_DAYS = 3;
const OFFPLATFORM_FOLLOWUP_DAYS = 3, NOANSWER_RETRY_DAYS = 1, QUIET_NUDGE_DAYS = 3;
const END_OF_ROPE_TOUCHES = 6;
const daysSinceISO = (iso) => { if (!iso) return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY); };

// meta = { stage, lastSignal, lastSignalAt, followupAt, lastActivity, touchCount, sessionBookedTag }
function appDerive(meta) {
  const stage = meta.stage;
  if (meta.sessionBookedTag || stage === "partner" || stage === "session-booked") return { kind: "converted", due: false, action: null, why: "Booked — now a client." };
  if (stage === "dropped") return { kind: "aside", due: false, action: null, why: "Not a fit" };
  if (stage === "future-potential") {
    const due = meta.followupAt ? new Date(meta.followupAt).getTime() <= Date.now() : true;
    return due ? { kind: "act", due: true, action: "reback", why: "Snoozed lead is back — worth another look." }
               : { kind: "aside", due: false, action: null, why: "Snoozed" };
  }
  const a = meta.lastActivity ? new Date(meta.lastActivity).getTime() : 0;
  const b = meta.lastSignalAt ? new Date(meta.lastSignalAt).getTime() : 0;
  const d = (a || b) ? Math.floor((Date.now() - Math.max(a, b)) / DAY) : null;
  const sig = meta.lastSignal;
  const tc = Number(meta.touchCount) || 0;
  const due = (t) => d === null || d >= t;
  const wait = (why) => ({ kind: "waiting", due: false, action: null, why });
  if (!sig && tc === 0) return { kind: "act", due: true, action: "call", why: "New lead — first contact (after your follow-ups)." };
  if (tc >= END_OF_ROPE_TOUCHES) return { kind: "act", due: true, action: "decide", why: `${tc} touches, no traction — keep trying, or set aside?` };
  switch (sig) {
    case "no-answer": return due(NOANSWER_RETRY_DAYS) ? { kind: "act", due: true, action: "call", why: "Called, no answer — give them another call." } : wait("Just called");
    case "voicemail": return due(VM_FOLLOWUP_DAYS) ? { kind: "act", due: true, action: "text", why: "Voicemail — a text here is good." } : wait("Voicemail left, giving it a beat");
    case "talked": return due(TALKED_FOLLOWUP_DAYS) ? { kind: "act", due: true, action: "text", why: "Talked — text them the next step while it's warm." } : wait("Just talked");
    case "link-sent": return due(LINK_FOLLOWUP_DAYS) ? { kind: "act", due: true, action: "text", why: "Sent the link, not booked — a text nudge is good." } : wait("Link just sent");
    case "linkedin-msg": case "linkedin-req": case "instagram-msg": case "in-person":
      return due(OFFPLATFORM_FOLLOWUP_DAYS) ? { kind: "act", due: true, action: "text", why: "Reached out — a text follow-up is good." } : wait("Recently reached out");
    case "not-interested": return { kind: "aside", due: false, action: null, why: "Not interested" };
    default: return due(QUIET_NUDGE_DAYS) ? { kind: "act", due: true, action: "text", why: "Quiet — a text check-in is good." } : wait("Recently touched");
  }
}

// Cadence policy (amari/strategy/outreach-cadence-policy.md): days to wait after
// the nth outbound touch before the next. Widens; the last step is the breakup.
const WAIT_AFTER_TOUCH = [2, 2, 3, 4, 5, 7];
const END_OF_ROPE = 6;
const waitAfter = (n) => WAIT_AFTER_TOUCH[Math.min(n, WAIT_AFTER_TOUCH.length) - 1] ?? 7;

// Named-sequence cadence (design: channel-aware-engine-design-2026-06-15.md).
// Two variants by warmth; the FINAL step is the breakup; once it's sent and they
// stay quiet, the contact auto-exhausts (drops off the worklist, re-opens on a reply).
//   COLD = never replied (no inbound). WARM = talked/replied (has inbound).
// channel = the recommended next move per step; a "call" step is Garrett's Play
// (call → voicemail that tees up the follow-up → the text/email that references it).
const COLD_STEPS = 6;
const WARM_STEPS = 4;
// A call this long (seconds) counts as a real conversation → the contact is warm.
// Below this is a dial-and-miss or a short voicemail (verified: VMs ran ~15-150s,
// real talks ~120s+). Tuned conservative; the transcript is the ground truth when
// we have one, but duration is the live signal the engine has at classify time.
const TALKED_CALL_SEC = 120;
const COLD_CHANNELS = ["call", "text", "call", "email", "call", "text"]; // step 1..6 (6 = breakup)
const WARM_CHANNELS = ["text", "call", "text", "text"];                  // step 1..4 (4 = breakup)
const channelForStep = (variant, step) =>
  (variant === "warm" ? WARM_CHANNELS : COLD_CHANNELS)[step - 1] || "text";

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

// Low-signal inbound detection — an inbound that does NOT mean "a human is waiting
// on us." Two kinds: a courtesy sign-off ("thanks!", "we'll be in touch") and an
// automated reply ("this is X gym, how can we help?"). Conservative by design:
// anything substantive (a question, a real ask) is NOT low-signal and still surfaces.
function isCloser(text) {
  const raw = (text || "").trim();
  if (!raw) return false; // unreadable (e.g. an inbound CALL has no body) — never silence it; surface it
  const low = raw.toLowerCase();
  // A substantive ask is never a closer — keep it (safe direction).
  if (/\?|\bwhen\b|what time|how much|\bavailable\b|can you|could you|do you|are you|let me know|\bquestion\b|interested|sign me up|\bbook\b|how do|how much/.test(low)) return false;
  const t = low.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 12) return false; // too long to be a pure sign-off
  return /\b(ok|okay|kk|thanks|thank you|thx|ty|great|perfect|sounds good|sounds great|will do|got it|gotcha|cool|awesome|likewise|same here|you too|appreciate|no problem|no worries|talk soon|in touch|be in touch|see you|cheers|good luck|best of luck|all the best|take care|glad (?:you|we) connected|nice (?:talking|connecting)|have a (?:good|great))\b/.test(t);
}
function isAutoresponder(text) {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  return /this is .{0,30}\b(gym|fitness|studio|team|clinic|office)\b/.test(t)
    || /we (saw|noticed|received|got)\b.{0,24}(missed|your)\b.{0,12}(call|message|text)/.test(t)
    || /how can we help/.test(t)
    || /thanks for (reaching|contacting|messaging|your message|getting in touch)/.test(t)
    || /we('| wi)?ll (get back|be in touch|respond)\b.{0,24}(soon|shortly|asap|24|business)/.test(t)
    || /\b(auto(matic|-?reply|responder)|currently (closed|unavailable|away)|business hours|out of office)\b/.test(t);
}
const isLowSignalInbound = (ev) => isCloser(ev && ev.text) || isAutoresponder(ev && ev.text);

// Collapse consecutive same-direction touches within SESSION_GAP_MS into one event.
// Carries the latest message's kind+text so the classifier can read what was said.
function collapseEvents(touches) {
  const sorted = [...touches].sort((a, b) => a.ts - b.ts);
  const events = [];
  for (const t of sorted) {
    const last = events[events.length - 1];
    if (last && last.dir === t.dir && t.ts - last.lastTs <= SESSION_GAP_MS) {
      last.lastTs = t.ts;
      if (t.kind) last.kind = t.kind;
      if (t.text) last.text = t.text;
    } else {
      events.push({ ts: t.ts, lastTs: t.ts, dir: t.dir, kind: t.kind, text: t.text });
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
  for (const im of inb) {
    // A "dropped reply" = an inbound with no outbound after it that we should answer.
    // EXCLUDE an unsolicited, contentless inbound when we never reached out (outCount 0)
    // — e.g. a stale missed call from a number we never contacted. That's not a reply
    // to our outreach; counting it makes a phantom reply-waiting. A contentful inbound
    // (a real new lead texting in) and any inbound inside an active thread (prior
    // outbound exists — e.g. a call worth returning) BOTH still count.
    const contentless = !(im.text && im.text.trim());
    const hasPriorOut = out.some((o) => o.ts < im.ts);
    if (contentless && !hasPriorOut) continue;
    if (!out.find((o) => o.ts > im.ts) && !isLowSignalInbound(im)) droppedReplies++;
  }
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
    // A real conversation: a call that lasted long enough to be a talk (not a
    // dial-and-miss or a short voicemail). This is the signal that a contact is
    // WARM even when they never sent an inbound text — they answered and talked on
    // the phone. (Needs call duration in the cache; backfilled on a full reconcile.)
    talkedCall: touches.some((t) => t.kind === "call" && (t.dur || 0) >= TALKED_CALL_SEC),
  };
}

// Port of coach-build.mjs classify() — same states + due logic + the machine-knowable excludes.
function classify(p) {
  const since = p.sinceLastTouchDays;
  const outN = p.outCount;

  // Skip-persistence: a contact explicitly set aside (coach:skip) or parked/closed
  // in the app (partner_stage) stays out — so a human "no" sticks across cycles.
  if (p.skipped) return { state: "skipped", due: false, action: "Set aside (won't resurface until un-skipped)", priority: 0 };
  if (CLOSED_STAGES.has(p.partnerStage)) return { state: "set-aside", due: false, action: `Parked in the app (stage: ${p.partnerStage})`, priority: 0 };

  if (p.hasBooking) return { state: "booked", due: false, action: "Already booked or just attended a session", priority: 0 };
  if (p.hasHumanTouch === false) return { state: "drip-only", due: false, action: "Email/quiz drip only, not a call or text target", priority: 0 };

  if (p.droppedReplies > 0 && since <= DROPPED_MAX_DAYS) {
    return { state: "reply-waiting", due: true, action: "Respond to their reply now", priority: 100 + Math.max(0, 30 - since) };
  }
  if (p.lastDir === "in") {
    return { state: "their-court", due: false, action: "Waiting on them (confirm in thread)", priority: 0 };
  }
  // Named-sequence model: variant by warmth, the next step is outN+1, the final
  // step is the breakup, and once the breakup is sent we auto-exhaust.
  // WARM = they engaged: replied (inbound) OR talked on the phone (a real call).
  // The talkedCall half fixes the big miss — someone who answered a call and talked
  // for minutes but never texted was wrongly treated as a cold one-touch lead.
  const warm = p.inCount > 0 || p.talkedCall;
  const variant = warm ? "warm" : "cold";
  const totalSteps = warm ? WARM_STEPS : COLD_STEPS;
  const nextStep = outN + 1;

  // Cold + never engaged + quiet past the cadence window: the sequence stalled
  // (Garrett never advanced it). Don't keep surfacing "send the next step" months
  // later — park it. Re-opens on a real reply (routes through reply-waiting above).
  if (!warm && since > COLD_STALE_DAYS) {
    return { state: "exhausted", variant: "cold", step: outN, totalSteps: COLD_STEPS, channel: null,
             due: false, action: "Cold and quiet past the cadence window — parked (re-opens on a reply).", priority: 0 };
  }

  // Cadence spent (the breakup / final step is already sent and they stayed quiet).
  // Eben 2026-06-15: NEVER auto-drop a lead who ENGAGED with us.
  if (outN >= totalSteps) {
    if (warm) {
      // They replied/talked/booked at some point — too much intent to silently park.
      // Surface a low-priority human decision instead of dropping them.
      return { state: "warm-stalled", variant, step: outN, totalSteps, channel: "call",
               due: since >= 7, action: "Engaged with you, then went quiet, and the cadence is spent. Your call — one more personal try, or set aside.", priority: 15 };
    }
    // Cold + never engaged: the breakup was the close. Auto-exhaust → drops off the
    // worklist. Reversible: an inbound reply routes through reply-waiting (priority 100).
    return { state: "exhausted", variant, step: outN, totalSteps, channel: null,
             due: false, action: "Cadence finished — breakup sent, no response. Parked (re-opens on a reply).", priority: 0 };
  }

  const wait = waitAfter(outN);
  const due = since >= wait;
  const isBreakup = nextStep === totalSteps;
  const channel = channelForStep(variant, nextStep);
  const state = isBreakup ? "breakup"
              : (outN === 1 ? (warm ? "talked-no-next" : "one-touch-no-reply")
                            : (warm ? "gone-quiet" : "no-reply"));
  const action = due
    ? (isBreakup
        ? `Send the breakup (step ${nextStep} of ${totalSteps}) — light, no blame, door open.`
        : `Send step ${nextStep} of ${totalSteps} now (${channel}; last touch ${since.toFixed(0)}d ago).`)
    : `Not yet — next step in ${(wait - since).toFixed(0)}d`;
  const priority = due ? 60 + Math.min(40, since - wait) : 0;
  return { state, variant, step: nextStep, totalSteps, channel, isBreakup, due, action, priority };
}

// Exported for the regression-test harness (test/cadence.regression.test.mjs).
// Pure functions, no behavior change — they close over the module constants.
export { buildRow, classify, collapseEvents };

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

// Map contactId -> contact meta (disposition + signal fields the app's derive uses).
// Honors the partner-session-booked tag the way the staff app does (tag wins on stage).
//
// Returns { map, complete }. `complete` is the load-bearing flag: if ANY page fails
// after all retries, or we hit the 12-page cap with more to fetch, complete=false and
// the caller MUST NOT write a due-list from this partial map — a missing contact reads
// as partnerStage=undefined, which silently un-gates dropped/booked contacts into the
// due-list (the Steve-Grubbs-floods-coach:due bug, 2026-06-17).
export async function loadContactMeta(env) {
  const map = new Map();
  let after = null, afterId = null;
  let complete = false;
  for (let p = 0; p < 12; p++) {
    let path = `/contacts/?locationId=${LOCATION_ID}&limit=100`;
    if (afterId) path += `&startAfterId=${afterId}&startAfter=${after}`;
    let d;
    try {
      d = await ghlRetry(env, path);
    } catch (e) {
      // A page failed every retry (GHL timeout storm). Do NOT pretend the map is
      // whole — return what we have flagged incomplete so the caller keeps the
      // last-known-good snapshot instead of clobbering it with partial dispositions.
      console.error(`[cadence] loadContactMeta page ${p} failed after retries: ${e?.message || e}`);
      return { map, complete: false };
    }
    const cs = d.contacts || [];
    for (const c of cs) {
      const sessionBookedTag = (c.tags || []).includes("partner-session-booked");
      map.set(c.id, {
        stage: sessionBookedTag ? "session-booked" : getField(c, FIELD.stage),
        sessionBookedTag,
        lastSignal: getField(c, FIELD.lastSignal),
        lastSignalAt: getField(c, FIELD.lastSignalAt),
        followupAt: getField(c, FIELD.followupAt),
        lastActivity: getField(c, FIELD.lastRealActivity),
        touchCount: getField(c, FIELD.touchCount),
      });
    }
    afterId = d.meta?.startAfterId; after = d.meta?.startAfter;
    if (cs.length < 100 || !afterId) { complete = true; break; }
  }
  // complete stays false if we fell out by hitting the 12-page cap (still more to fetch).
  return { map, complete };
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
  const meta = await loadContactMeta(env);
  if (!meta.complete) {
    // Disposition meta is partial (GHL pagination failed after retries). Writing a
    // due-list now would un-gate dropped/booked contacts. Keep last-known-good.
    const summary = {
      ranAt: new Date(start).toISOString(),
      skipped: true,
      reason: "incomplete-contact-meta",
      note: "GHL /contacts pagination failed after retries; kept last-known-good coach:due/cadence (never clobber with partial disposition meta).",
      activeContacts: activeIds.length,
      metaLoaded: meta.map.size,
      durationMs: Date.now() - start,
    };
    await kv.put("ops:coach-cadence:lastRun", JSON.stringify(summary));
    console.error("[cadence] " + summary.note + ` (loaded ${meta.map.size} contacts before failure)`);
    return summary;
  }
  const metaMap = meta.map;
  const skip = (await kv.get("coach:skip", "json")) || {};       // { contactId: {reason, setAt} }
  for (const r of rows) {
    r.hasBooking = booked.has(r.contactId);
    r.partnerStage = metaMap.get(r.contactId)?.stage;
    r.skipped = Boolean(skip[r.contactId]);
  }

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

  // coach:due:shadow — engine-merge step 1. The app's actNowReason (signal-based)
  // computed server-side, eligibility-gated, with the coach's touch-count as a
  // resurfacing input — so we can DIFF the unified model against the live coach
  // due-list before any front-end change. NOTHING consumes this yet (shadow).
  const stateOf = new Map(scored.map((s) => [s.contactId, { state: s.state, due: s.due }]));
  const shadow = [];
  for (const r of prospects) {
    const meta = metaMap.get(r.contactId) || {};
    // Eligibility gate (axis A) wins first — same excludes as the live coach.
    if (r.hasBooking || r.hasHumanTouch === false || r.skipped) continue;
    const app = appDerive({ ...meta, touchCount: meta.touchCount ?? r.outCount });
    if (!app.due) continue;
    const cs = stateOf.get(r.contactId) || {};
    shadow.push({
      contactId: r.contactId, name: r.name,
      action: app.action, why: app.why, kind: app.kind,
      signalBucket: meta.lastSignal || (r.outCount === 0 ? "new" : "quiet"),
      touchCount: Number(meta.touchCount) || r.outCount,
      coachState: cs.state,           // what the touch-count model said, for the diff
      coachDue: Boolean(cs.due),
    });
  }
  // How often do the two models DISAGREE on the contacted set? (the merge's whole point)
  const liveDueIds = new Set(due.map((d) => d.contactId));
  const shadowDueIds = new Set(shadow.map((s) => s.contactId));
  const onlyShadow = [...shadowDueIds].filter((id) => !liveDueIds.has(id)).length;
  const onlyLive = [...liveDueIds].filter((id) => !shadowDueIds.has(id)).length;
  await kv.put("coach:due:shadow", JSON.stringify({
    generatedAt, generatedAtISO, note: "engine-merge step 1 — app actNowReason computed server-side; shadow only, nothing consumes it",
    shadowDue: shadow.length, liveDue: due.length, agreeBoth: shadow.length - onlyShadow,
    onlyShadow, onlyLive, items: shadow,
  }));

  const summary = {
    ranAt: generatedAtISO,
    activeContacts: activeIds.length,
    prospects: prospects.length,
    dueCount: due.length,
    counts,
    bookedSuppressed: rows.filter((r) => r.hasBooking).length,
    dripOnly: scored.filter((s) => s.state === "drip-only").length,
    setAside: scored.filter((s) => s.state === "set-aside").length,
    skipped: scored.filter((s) => s.state === "skipped").length,
    durationMs: Date.now() - start,
  };
  await kv.put("ops:coach-cadence:lastRun", JSON.stringify(summary));
  return summary;
}
