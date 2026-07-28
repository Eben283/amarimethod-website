/**
 * Dynamic look-busy for booking slot lists.
 *
 * GHL's built-in lookBusy hides a fixed ~55% of free slots forever (same times
 * always disappear). That blocked a promised Assessment time and feels static.
 * We turn GHL lookBusy off and thin slots here instead:
 *
 * - Stable within a calendar week (same visitor, same day → same options)
 * - Rotates weekly so which gaps appear changes over time
 * - Day-to-day hide rate wobbles (~40–65%) so some days look fuller
 * - Always keeps the first slot of each availability cluster (gap > 45 min),
 *   so promised first-of-day and first-after-lunch opens survive
 * - Never empties a day that had real availability (keeps at least two when possible)
 */

const DEFAULT_BASE_PERCENT = 55;

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
 * Hide rate for one day: base ± wobble from the date, clamped.
 * @param {string} dateStr
 * @param {number} basePercent
 */
export function hidePercentForDate(dateStr, basePercent = DEFAULT_BASE_PERCENT) {
  const wobble = (hash32(`busy-rate|${dateStr}`) % 21) - 10; // -10 … +10
  return Math.max(35, Math.min(70, basePercent + wobble));
}

/**
 * Filter a flat slot array ({ date, datetime, ... }) with dynamic look-busy.
 * Slots without date/datetime are passed through unchanged.
 *
 * @param {Array<{date?: string, datetime?: string}>} slots
 * @param {{ calendarId: string, hidePercent?: number }} opts
 */
export function applyLookBusy(slots, opts) {
  if (!Array.isArray(slots) || slots.length === 0) return slots;
  const calendarId = opts && opts.calendarId;
  if (!calendarId) return slots;
  const basePercent =
    typeof opts.hidePercent === "number" ? opts.hidePercent : DEFAULT_BASE_PERCENT;

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

    const hidePercent = hidePercentForDate(date, basePercent);
    const keepTarget = Math.max(
      2,
      Math.ceil((sorted.length * (100 - hidePercent)) / 100),
    );

    // Always keep the first slot of each availability cluster (gap > 45 min).
    // That protects promised first-of-day times and first-after-lunch opens
    // (e.g. Assessment Aug 4 11:00, Aug 21 14:30) from thinning.
    const week = isoWeekKey(date);
    const mustKeep = new Set();
    let prevMs = null;
    for (const slot of sorted) {
      const ms = Date.parse(slot.datetime);
      if (prevMs == null || !Number.isFinite(ms) || ms - prevMs > 45 * 60 * 1000) {
        mustKeep.add(slot.datetime);
      }
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
