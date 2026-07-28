/**
 * Dynamic look-busy for booking slot lists.
 *
 * GHL's built-in lookBusy hides a fixed % forever. We thin here instead with a
 * natural horizon matrix (scarce near-term → opener further out):
 *
 * | Days out | Looks ~full | Shown of a typical 12-slot day |
 * |----------|-------------|-------------------------------|
 * | 0–5      | 75%         | ~3                            |
 * | 6–13     | 55%         | ~5–6                          |
 * | 14–27    | 30%         | ~8–9                          |
 * | 28+      | ~0%         | up to 12 (hard cap)           |
 *
 * Also: weekly-rotating which gaps appear, cluster/pinned must-keeps
 * (Assessment Aug 4 11:00, Aug 21 14:30), never empties a real day.
 */

/** Hard ceiling on how many slots one day can show, even far out. */
export const MAX_SLOTS_PER_DAY = 12;

/** Minimum slots to leave on a day that had real availability. */
const MIN_SLOTS_PER_DAY = 2;

/**
 * Target "looks full" % by days from today (Pacific).
 * 75% full ⇒ hide 75% of free slots ⇒ show 25%.
 */
export function targetFullPercent(daysOut) {
  if (daysOut < 0) return 75;
  if (daysOut <= 5) return 75;
  if (daysOut <= 13) return 55;
  if (daysOut <= 27) return 30;
  return 0; // many weeks out: show everything, capped at MAX_SLOTS_PER_DAY
}

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

/** @deprecated use targetFullPercent — kept as alias for older tests/imports */
export function horizonHideBias(daysOut) {
  return targetFullPercent(daysOut) - 75;
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
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Hide/"looks full" % for one day: horizon target + tiny wobble (±3).
 *
 * @param {string} dateStr
 * @param {number} [_ignoredBase] unused — horizon targets are absolute
 * @param {string} [asOfDate] YYYY-MM-DD (defaults to today Pacific)
 */
export function hidePercentForDate(dateStr, _ignoredBase, asOfDate = pacificDateKey()) {
  const daysOut = daysFromAsOf(dateStr, asOfDate);
  const target = targetFullPercent(daysOut);
  const wobble = (hash32(`busy-rate|${dateStr}`) % 7) - 3; // -3 … +3
  return Math.max(5, Math.min(85, target + wobble));
}

/**
 * How many slots to show for a day given underlying count and hide %.
 * Always ≥ MIN, always ≤ MAX_SLOTS_PER_DAY.
 */
export function keepTargetForDay(slotCount, hidePercent) {
  if (slotCount <= MIN_SLOTS_PER_DAY) return slotCount;
  const fromPercent = Math.ceil((slotCount * (100 - hidePercent)) / 100);
  return Math.min(
    MAX_SLOTS_PER_DAY,
    Math.max(MIN_SLOTS_PER_DAY, fromPercent),
  );
}

/**
 * Filter a flat slot array ({ date, datetime, ... }) with dynamic look-busy.
 *
 * @param {Array<{date?: string, datetime?: string, time?: string}>} slots
 * @param {{ calendarId: string, hidePercent?: number, asOfDate?: string }} opts
 */
export function applyLookBusy(slots, opts) {
  if (!Array.isArray(slots) || slots.length === 0) return slots;
  const calendarId = opts && opts.calendarId;
  if (!calendarId) return slots;
  const asOfDate =
    opts && typeof opts.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.asOfDate)
      ? opts.asOfDate
      : pacificDateKey();
  // Optional override: force one hide % for tests (skips horizon).
  const forcedHide =
    opts && typeof opts.hidePercent === "number" ? opts.hidePercent : null;

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
    if (sorted.length <= MIN_SLOTS_PER_DAY) {
      kept.push(...sorted);
      continue;
    }

    const hidePercent =
      forcedHide != null ? forcedHide : hidePercentForDate(date, undefined, asOfDate);
    const keepTarget = keepTargetForDay(sorted.length, hidePercent);

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
    // Cap even must-keep-heavy days at MAX, but never drop pinned/cluster seeds
    // below what's already selected if under the cap — must-keeps win if few.
    if (selected.length > MAX_SLOTS_PER_DAY) {
      const pinned = selected.filter(isPinnedSlot);
      const seeds = selected.filter((s) => mustKeep.has(s.datetime) && !isPinnedSlot(s));
      const others = selected.filter((s) => !mustKeep.has(s.datetime));
      const capped = [...pinned, ...seeds].slice(0, MAX_SLOTS_PER_DAY);
      for (const s of others) {
        if (capped.length >= MAX_SLOTS_PER_DAY) break;
        capped.push(s);
      }
      capped.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
      kept.push(...capped);
    } else {
      selected.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
      kept.push(...selected);
    }
  }

  kept.sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return da.localeCompare(db);
    return String(a.datetime || "").localeCompare(String(b.datetime || ""));
  });
  return passthrough.length ? [...kept, ...passthrough] : kept;
}
