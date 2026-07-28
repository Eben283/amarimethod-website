/**
 * Dynamic look-busy for booking slot lists.
 *
 * GHL's built-in lookBusy hides a fixed ~55% of free slots forever (same times
 * always disappear). That blocked a promised Assessment time and feels static.
 * We turn GHL lookBusy off and thin slots here instead:
 *
 * - Scarcer near today, opener further out (natural booking matrix)
 * - Stable within a calendar week (same visitor, same day → same options)
 * - Rotates weekly so which gaps appear changes over time
 * - Day-to-day hide rate wobbles slightly so days don't look cloned
 * - Always keeps the first slot of each availability cluster (gap > 45 min)
 * - Explicitly keeps pinned promised times (Assessment Aug 4 11:00, Aug 21 14:30)
 * - Never empties a day that had real availability (keeps at least two when possible)
 */

const DEFAULT_BASE_PERCENT = 55;

/** Pacific calendar date YYYY-MM-DD for an instant (Amari is SF-local). */
export function pacificDateKey(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Whole days from asOfDate → dateStr (both YYYY-MM-DD). Negative if past. */
export function daysFromAsOf(dateStr, asOfDate) {
  const [y1, m1, d1] = asOfDate.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

/**
 * Horizon bias: hide more when close, less when far.
 * 0–3d ≈ +22, 4–7d ≈ +12, 8–14d ≈ 0, 15–28d ≈ −15, 29+ ≈ −28
 */
export function horizonHideBias(daysOut) {
  if (daysOut <= 3) return 22;
  if (daysOut <= 7) return 12;
  if (daysOut <= 14) return 0;
  if (daysOut <= 28) return -15;
  return -28;
}

/**
 * Promised Assessment opens that must survive thinning.
 * Match on date + HH:MM so DST offset in the ISO string cannot drop them.
 */
export const PINNED_SLOT_TIMES = Object.freeze([
  { date: "2026-08-04", time: "11:00" },
  { date: "2026-08-21", time: "14:30" },
]);

function slotTimeKey(slot) {
  if (slot.time && /^\d{2}:\d{2}$/.test(slot.time)) return slot.time;
  const timePart = String(slot.datetime || "").split("T")[1] || "";
  const hh = timePart.slice(0, 2);
  const mm = timePart.slice(3, 5);
  if (/^\d{2}$/.test(hh) && /^\d{2}$/.test(mm)) return `${hh}:${mm}`;
  return "";
}

export function isPinnedSlot(slot) {
  if (!slot || !slot.date) return false;
  const time = slotTimeKey(slot);
  return PINNED_SLOT_TIMES.some((p) => p.date === slot.date && p.time === time);
}

/** FNV-1a 32-bit — fast, deterministic, no crypto dependency. */
export function hash32(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** ISO week key (YYYY-Www) in UTC from a YYYY-MM-DD date string. */
export function isoWeekKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  // Thursday of this week determines the ISO week-year.
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Hide rate for one day: horizon bias + small date wobble, clamped.
 * Near dates look scarce; further-out dates open up.
 *
 * @param {string} dateStr
 * @param {number} [basePercent]
 * @param {string} [asOfDate] YYYY-MM-DD (defaults to today Pacific)
 */
export function hidePercentForDate(
  dateStr,
  basePercent = DEFAULT_BASE_PERCENT,
  asOfDate = pacificDateKey(),
) {
  const daysOut = daysFromAsOf(dateStr, asOfDate);
  // Past / same-day booking windows: still scarce if somehow present.
  const bias = daysOut < 0 ? 22 : horizonHideBias(daysOut);
  const wobble = (hash32(`busy-rate|${dateStr}`) % 11) - 5; // -5 … +5
  return Math.max(15, Math.min(85, basePercent + bias + wobble));
}

/**
 * Filter a flat slot array ({ date, datetime, ... }) with dynamic look-busy.
 * Slots without date/datetime are passed through unchanged.
 *
 * @param {Array<{date?: string, datetime?: string, time?: string}>} slots
 * @param {{ calendarId: string, hidePercent?: number, asOfDate?: string }} opts
 */
export function applyLookBusy(slots, opts) {
  if (!Array.isArray(slots) || slots.length === 0) return slots;
  const calendarId = opts && opts.calendarId;
  if (!calendarId) return slots;
  const basePercent =
    typeof opts.hidePercent === "number" ? opts.hidePercent : DEFAULT_BASE_PERCENT;
  const asOfDate =
    opts && typeof opts.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.asOfDate)
      ? opts.asOfDate
      : pacificDateKey();

  const byDate = new Map();
  const passthrough = [];
  for (const slot of slots) {
    if (!slot || !slot.date || !slot.datetime) {
      passthrough.push(slot);
      continue;
    }
    if (!byDate.has(slot.date)) byDate.set(slot.date, []);
    byDate.get(slot.date).push(slot);
  }

  const kept = [];
  for (const [date, daySlots] of byDate) {
    const sorted = daySlots
      .slice()
      .sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
    if (sorted.length <= 2) {
      kept.push(...sorted);
      continue;
    }

    const hidePercent = hidePercentForDate(date, basePercent, asOfDate);
    const keepTarget = Math.max(
      2,
      Math.ceil((sorted.length * (100 - hidePercent)) / 100),
    );

    // Always keep the first slot of each availability cluster (gap > 45 min)
    // plus any explicitly pinned promised times.
    const week = isoWeekKey(date);
    const mustKeep = new Set();
    let prevMs = null;
    for (const slot of sorted) {
      const ms = Date.parse(slot.datetime);
      if (prevMs == null || !Number.isFinite(ms) || ms - prevMs > 45 * 60 * 1000) {
        mustKeep.add(slot.datetime);
      }
      if (isPinnedSlot(slot)) mustKeep.add(slot.datetime);
      if (Number.isFinite(ms)) prevMs = ms;
    }

    const rest = sorted
      .filter((slot) => !mustKeep.has(slot.datetime))
      .map((slot) => ({
        slot,
        score: hash32(`${calendarId}|${week}|${slot.datetime}`),
      }));
    rest.sort((a, b) => b.score - a.score);

    const selected = sorted.filter((slot) => mustKeep.has(slot.datetime));
    for (const { slot } of rest) {
      if (selected.length >= keepTarget) break;
      selected.push(slot);
    }
    selected.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
    kept.push(...selected);
  }

  kept.sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return da.localeCompare(db);
    return String(a.datetime || "").localeCompare(String(b.datetime || ""));
  });
  return passthrough.length ? [...kept, ...passthrough] : kept;
}
