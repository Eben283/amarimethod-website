// Cloud port of coach-learning.mjs.
// Joins coach-surfaced contacts → gifted bookings → session sales.
// State lives in KV:
//   coach:surfaced:ledger  — append-only "first surfaced" ledger (JSON object)
//   coach:learning:summary — published result read by /day briefing

import { ghlRetry, LOCATION_ID } from "./ghl.js";

const DAY_MS = 86_400_000;
const TZ = "America/Los_Angeles";
const SESSIONS_PER_PACK = 8;
const WINDOW_DAYS = 180;
const GIFTED_PARTNER_CALENDAR = "lfsnaiGiLNL2z12pLKDP";

const log = (...a) => console.error("[learning]", ...a);
const laDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const today = () => laDate(new Date().toISOString());
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = null; log("warn:", e.message?.slice(0, 80)); }
    }
  });
  await Promise.all(workers);
  return out;
}

const PROSPECT_LABEL = {
  golf: "Golf", tennis: "Tennis", pickleball: "Pickleball",
  "personal-training": "Personal Training", strength: "Strength",
  pilates: "Pilates", yoga: "Yoga", "run-coaching": "Run Coaching",
  "mental-health": "Mental Health",
};
function cohortFromTags(tags = []) {
  for (const t of tags) {
    if (t.endsWith("-prospect")) {
      const d = t.slice(0, -"-prospect".length);
      if (PROSPECT_LABEL[d]) return PROSPECT_LABEL[d];
    }
  }
  if (tags.includes("golf-new-partner")) return "Golf";
  if (tags.includes("tennis-new-partner")) return "Tennis";
  if (tags.includes("trainer-solo")) return "Trainer (solo)";
  if (tags.includes("trainer-facility")) return "Trainer (facility)";
  if (tags.includes("therapist-new-partner") || tags.includes("mental-health-prospect")) return "Mental Health";
  if (tags.some((t) => t.startsWith("trainer"))) return "Trainer (other)";
  return "Direct / untagged";
}

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
  if (a === 1295) return { s: 8, k: "8-pack" };
  if (a === 720)  return { s: 4, k: "4-pack" };
  if (a >= 425 && a <= 500) return { s: 1, k: "initial" };
  if (a >= 180 && a <= 235) return { s: 1, k: "single" };
  return null;
}

async function loadContacts(env) {
  const byId = new Map();
  let afterId = null, after = null;
  for (let p = 0; p < 12; p++) {
    let path = `/contacts/?locationId=${LOCATION_ID}&limit=100`;
    if (afterId) path += `&startAfterId=${afterId}&startAfter=${after}`;
    const d = await ghlRetry(env, path);
    const cs = d.contacts || [];
    for (const c of cs) byId.set(c.id, cohortFromTags(c.tags));
    afterId = d.meta?.startAfterId; after = d.meta?.startAfter;
    if (cs.length < 100 || !afterId) break;
  }
  log(`contacts: ${byId.size}`);
  return byId;
}

async function loadBookings(env, cutoffMs) {
  const futureEnd = Date.now() + 120 * DAY_MS;
  const d = await ghlRetry(env, `/calendars/events?locationId=${LOCATION_ID}&calendarId=${GIFTED_PARTNER_CALENDAR}&startTime=${cutoffMs}&endTime=${futureEnd}`);
  const byId = new Map();
  for (const e of d.events || []) {
    if ((e.appointmentStatus || "") === "invalid" || !e.contactId) continue;
    const bookDate = laDate(e.dateAdded || e.startTime);
    const prev = byId.get(e.contactId);
    if (!prev || bookDate < prev.bookDate) {
      byId.set(e.contactId, { bookDate, showed: (e.appointmentStatus || "") === "showed" });
    }
  }
  log(`gifted bookings: ${byId.size} contacts`);
  return byId;
}

async function loadSales(env) {
  let tx = [];
  for (let off = 0; off < 600; off += 100) {
    const t = await ghlRetry(env, `/payments/transactions?altId=${LOCATION_ID}&altType=location&limit=100&offset=${off}`);
    const a = t.data || t.transactions || [];
    tx.push(...a);
    if (a.length < 100) break;
  }
  const paid = tx.filter((x) => x.status === "succeeded" && Number(x.amount) > 0);
  log(`succeeded transactions: ${paid.length}`);

  const classified = await mapLimit(paid, 3, async (x) => {
    let name = "";
    try {
      if (x.entityType === "invoice") {
        const inv = await ghlRetry(env, `/invoices/${x.entityId}?altId=${LOCATION_ID}&altType=location`);
        name = (inv.invoiceItems || inv.items || []).map((i) => i.name).join("; ");
      } else if (x.entityType === "order") {
        const o = await ghlRetry(env, `/payments/orders/${x.entityId}?altId=${LOCATION_ID}&altType=location`);
        name = (o.items || []).map((i) => i.name || i.price?.name).join("; ");
      }
    } catch { /* amount heuristic */ }
    const cls = classifySale(name, x.amount);
    if (!cls || !x.contactId) return null;
    return { contactId: x.contactId, d: laDate(x.createdAt), s: cls.s, k: cls.k, amount: Number(x.amount) };
  });

  const byId = new Map();
  for (const s of classified.filter(Boolean)) {
    const prev = byId.get(s.contactId);
    if (!prev || s.d < prev.d) byId.set(s.contactId, s);
  }
  log(`session-sales: ${byId.size} contacts`);
  return byId;
}

function updateLedger(ledger, records, categoryOf) {
  const t = today();
  for (const r of records) {
    if (!r.contactId) continue;
    const source = r.source === "personalized" ? "personalized" : "templated";
    const cat = categoryOf(r.contactId);
    const prev = ledger[r.contactId];
    if (prev) {
      ledger[r.contactId] = {
        ...prev, name: r.name || prev.name, lastSurfaced: t,
        timesSurfaced: (prev.timesSurfaced || 1) + (prev.lastSurfaced === t ? 0 : 1),
        source: source === "personalized" ? "personalized" : prev.source,
        bucket: r.bucket || prev.bucket,
        category: cat && cat !== "Direct / untagged" ? cat : prev.category,
      };
    } else {
      ledger[r.contactId] = {
        contactId: r.contactId, name: r.name || r.contactId,
        firstSurfaced: t, lastSurfaced: t, timesSurfaced: 1,
        source, bucket: r.bucket || "", category: cat,
      };
    }
  }
  return ledger;
}

const STAGE = { surfaced: 0, acted: 1, replied: 2, booked: 3, paid: 4 };
const blankAgg = () => ({ surfaced: 0, acted: 0, replied: 0, booked: 0, paid: 0, sessionsSold: 0, dollars: 0 });
function addToAgg(agg, stageName, sale) {
  agg.surfaced++;
  if (STAGE[stageName] >= STAGE.acted)   agg.acted++;
  if (STAGE[stageName] >= STAGE.replied) agg.replied++;
  if (STAGE[stageName] >= STAGE.booked)  agg.booked++;
  if (STAGE[stageName] >= STAGE.paid) {
    agg.paid++;
    if (sale) { agg.sessionsSold += sale.s; agg.dollars += sale.amount; }
  }
}
const pctOf = (n, d) => (d > 0 ? Math.round((100 * n) / d) : 0);

function rollup(ledger, bookings, sales, cadence) {
  const cad = new Map((cadence.prospects || []).map((p) => [p.contactId, p]));
  const totals = blankAgg();
  const byCategory = {}, bySource = { personalized: blankAgg(), templated: blankAgg() };
  const bookedList = [], paidList = [];

  for (const e of Object.values(ledger)) {
    const T = e.firstSurfaced;
    const book = bookings.get(e.contactId);
    const sale = sales.get(e.contactId);
    const cur  = cad.get(e.contactId);

    let stage = "surfaced";
    if (cur && cur.lastTouch && laDate(new Date(cur.lastTouch).toISOString()) >= T) {
      stage = cur.lastDir === "in" ? "replied" : "acted";
    }
    const booked = book && book.bookDate >= T;
    const paid   = sale && sale.d >= T;
    if (booked) stage = "booked";
    if (paid)   stage = "paid";

    const cat = e.category || "Direct / untagged";
    byCategory[cat] = byCategory[cat] || blankAgg();
    const src = e.source === "personalized" ? "personalized" : "templated";

    addToAgg(totals, stage, paid ? sale : null);
    addToAgg(byCategory[cat], stage, paid ? sale : null);
    addToAgg(bySource[src], stage, paid ? sale : null);

    if (booked) bookedList.push({ name: e.name, category: cat, source: src, daysToBook: daysBetween(T, book.bookDate), showed: book.showed });
    if (paid)   paidList.push({ name: e.name, category: cat, source: src, kind: sale.k, sessionsSold: sale.s, dollars: sale.amount });
  }
  return { totals, byCategory, bySource, bookedList, paidList };
}

function headlineFrom(r) {
  const t = r.totals;
  if (t.booked === 0) {
    return `Coach-surfaced: ${t.surfaced} contacts tracked. No bookings attributed yet — the ledger starts now; conversions accrue over the coming weeks.`;
  }
  const packs = (t.sessionsSold / SESSIONS_PER_PACK).toFixed(1);
  const bestCat = Object.entries(r.byCategory)
    .filter(([, a]) => a.surfaced >= 3 && a.booked > 0)
    .sort((a, b) => pctOf(b[1].booked, b[1].surfaced) - pctOf(a[1].booked, a[1].surfaced))[0];
  const p = r.bySource.personalized, m = r.bySource.templated;
  const pRate = pctOf(p.booked, p.surfaced), mRate = pctOf(m.booked, m.surfaced);
  const parts = [`Coach-surfaced: ${t.surfaced} contacts → ${t.booked} booked, ${t.paid} paid`];
  if (t.sessionsSold) parts.push(`${t.sessionsSold} sessions sold (${packs} packs, $${t.dollars.toLocaleString()})`);
  if (bestCat) parts.push(`best category: ${bestCat[0]} (${pctOf(bestCat[1].booked, bestCat[1].surfaced)}% book)`);
  if ((p.booked || m.booked) && p.surfaced >= 3 && m.surfaced >= 3) parts.push(`personalized ${pRate}% vs templated ${mRate}% book-rate`);
  return parts.join(" · ");
}

export async function runLearning(env, records, cadence) {
  const kv = env.PORTAL_KV;
  const cutoffMs = Date.now() - WINDOW_DAYS * DAY_MS;
  log(`window ${WINDOW_DAYS}d, ${records.length} live records`);

  const contacts = await loadContacts(env);
  const categoryOf = (id) => contacts.get(id) || "Direct / untagged";

  const ledger = (await kv.get("coach:surfaced:ledger", "json")) || {};
  updateLedger(ledger, records, categoryOf);

  // Backfill category for older entries now that we have fresh tags.
  for (const e of Object.values(ledger)) {
    const c = categoryOf(e.contactId);
    if ((!e.category || e.category === "Direct / untagged") && c !== "Direct / untagged") e.category = c;
  }
  log(`ledger: ${Object.keys(ledger).length} contacts ever surfaced`);

  const [bookings, sales] = await Promise.all([loadBookings(env, cutoffMs), loadSales(env)]);

  const r = rollup(ledger, bookings, sales, cadence);
  const headline = headlineFrom(r);

  const out = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    headline,
    totals: r.totals,
    byCategory: r.byCategory,
    bySource: r.bySource,
    bookedList: r.bookedList.sort((a, b) => a.daysToBook - b.daysToBook),
    paidList: r.paidList.sort((a, b) => b.dollars - a.dollars),
    caveats: [
      "Small N — read trends, not statistics. The ledger accrues over weeks.",
      "Manual send — Garrett copies/edits the message; exact wording sent isn't proven.",
      "Correlation, not causation — a booking after a coach touch isn't proof it caused it.",
      "Money truth stays the Funnel; this attributes a slice of it to coach-surfaced contacts.",
    ],
  };

  await Promise.all([
    kv.put("coach:surfaced:ledger", JSON.stringify(ledger)),
    kv.put("coach:learning:summary", JSON.stringify(out)),
  ]);

  log(headline);
  return out;
}
