/**
 * Canonical booking slot policy (duration · interval · buffer).
 *
 * GHL supplies the raw availability; Amari owns post-session buffers and the
 * displayed slot shape. GHL slotBuffer remains zero on every calendar.
 * See amari-method-docs/ops/memory/decision_booking_slot_model.md
 *
 * Knobs:
 *   durationMinutes — client session length (appointment endTime)
 *   bufferMinutes   — Amari-owned post-session turnover (occupied block = duration + buffer)
 *   intervalMinutes — candidate start lattice (NOT "match duration")
 */

/** Main bodywork rhythm (Assessment / Follow-up / paid Initial): on the hour. */
export const STUDIO_INTERVAL_MINUTES = 60;

/**
 * Garrett Work Hours (GHL schedule WIPAUCHQ5WW18vLJ49Gk).
 * Open 10:00–19:00 Mon–Fri so the last session can START at 18:00 with a 60-min block.
 */
export const WORK_HOURS = Object.freeze({
  scheduleId: "WIPAUCHQ5WW18vLJ49Gk",
  timezone: "America/Los_Angeles",
  openFrom: "10:00",
  openTo: "19:00",
  firstSessionStart: "10:00",
  lastSessionStart: "18:00",
  weekdays: Object.freeze([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ]),
});

/** Hourly session starts from first through last (inclusive). */
export function studioSessionStarts() {
  return startLattice(10, 0, STUDIO_INTERVAL_MINUTES, 9);
}

/**
 * @typedef {object} SlotPolicy
 * @property {string} id
 * @property {string} label
 * @property {string[]} calendarIds
 * @property {number} durationMinutes
 * @property {number} bufferMinutes
 * @property {number} intervalMinutes
 * @property {'studio'|'intro'|'phone'|'short'} lattice
 * @property {boolean} [priority]
 * @property {boolean} [preferOnHour] when Amari ranks/thins show-list
 */

/** @type {Record<string, SlotPolicy>} */
export const SLOT_POLICIES = {
  followup: {
    id: "followup",
    label: "Follow-up Session",
    calendarIds: [
      "SKDVOL8wtUN6Ne0ppbC9", // in person
      "oVn77FcecFY16iS2pHyP", // virtual
      "ZO1jlGfy01rsxVqicoSB", // package IP
      "bJFkhVP35Ecwh4tLnSmy", // package virtual
    ],
    durationMinutes: 50,
    bufferMinutes: 20,
    intervalMinutes: STUDIO_INTERVAL_MINUTES,
    lattice: "studio",
    priority: true,
    preferOnHour: true,
  },
  initial: {
    id: "initial",
    label: "Initial Session / Partner Initial",
    calendarIds: [
      "G7OAnnJuFbMF6nQSlZVQ", // paid Initial IP (legacy path; public first visit is Assessment)
      "ySmht5hx4uZGEpgZrlCw", // paid Initial virtual
      "uUDFD0ZQEWtzGLS9aLq7", // paid at partner
      "lfsnaiGiLNL2z12pLKDP", // partner IP — keep 60
      "P7T6M1w8wtuRfwAqzOVw", // partner virtual — keep 60
    ],
    durationMinutes: 60, // Partner Initial stays 60; legacy paid Initial calendars still 60 in GHL
    bufferMinutes: 20,
    intervalMinutes: STUDIO_INTERVAL_MINUTES,
    lattice: "studio",
    preferOnHour: true,
  },
  assessment: {
    id: "assessment",
    label: "Amari Assessment",
    calendarIds: ["EM6vB2mq7EAdGCbUb3j1"],
    durationMinutes: 50, // was 40 — public first visit
    bufferMinutes: 20,
    intervalMinutes: STUDIO_INTERVAL_MINUTES,
    lattice: "studio",
    preferOnHour: true,
  },
  discovery_call: {
    id: "discovery_call",
    label: "Discovery Call (phone)",
    calendarIds: ["USgPsktqRcuomdUgpShL"],
    durationMinutes: 15,
    bufferMinutes: 10,
    intervalMinutes: 15,
    lattice: "phone",
    preferOnHour: false,
  },
  discovery_virtual: {
    id: "discovery_virtual",
    label: "Discovery Call (virtual)",
    calendarIds: ["ZEIGFHBi17SpZ3Ezi5DR"],
    durationMinutes: 15,
    bufferMinutes: 10,
    intervalMinutes: 15,
    lattice: "phone",
    preferOnHour: false,
  },
  entrainment: {
    id: "entrainment",
    label: "Entrainment",
    calendarIds: ["B5aGXLoS4kzAjZAMMXxk"],
    durationMinutes: 30,
    bufferMinutes: 20,
    intervalMinutes: 15,
    lattice: "short",
    preferOnHour: false,
  },
  partnership_discovery: {
    id: "partnership_discovery",
    label: "Partnership Discovery Call",
    calendarIds: ["aVE54Qf4lrbYTB0zFqXy"],
    durationMinutes: 15,
    bufferMinutes: 10,
    intervalMinutes: 20,
    lattice: "phone",
    preferOnHour: false,
  },
  study: {
    id: "study",
    label: "Amari Study Session",
    calendarIds: ["J1N09B6bRYPOGNyVAfmX"],
    durationMinutes: 15,
    bufferMinutes: 20,
    intervalMinutes: 30,
    lattice: "short",
    preferOnHour: false,
  },
};

/** True when Amari show-layer should keep/prefer :00 starts for this calendar. */
export function preferOnHourForCalendar(calendarId) {
  const policy = policyForCalendarId(calendarId);
  return !!(policy && policy.preferOnHour);
}

/** Occupied calendar block in minutes (session + post buffer). */
export function blockMinutes(policy) {
  return Number(policy.durationMinutes || 0) + Number(policy.bufferMinutes || 0);
}

/**
 * Candidate start times as HH:MM from an open time.
 * @param {number} openHour
 * @param {number} openMinute
 * @param {number} intervalMinutes
 * @param {number} [count=12]
 * @returns {string[]}
 */
export function startLattice(openHour, openMinute, intervalMinutes, count = 12) {
  const interval = Number(intervalMinutes);
  if (!Number.isFinite(interval) || interval <= 0) return [];
  const starts = [];
  let minutes = openHour * 60 + openMinute;
  for (let i = 0; i < count; i++) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    starts.push(`${hh}:${mm}`);
    minutes += interval;
  }
  return starts;
}

/** True when every start in the lattice (from on-hour open) ends with :00. */
export function isHourlyLattice(intervalMinutes) {
  return Number(intervalMinutes) === 60;
}

export function policyForCalendarId(calendarId) {
  const id = String(calendarId || "");
  for (const policy of Object.values(SLOT_POLICIES)) {
    if (policy.calendarIds.includes(id)) return policy;
  }
  return null;
}

/**
 * Compare live GHL calendar fields to the underlying GHL policy. Buffers are
 * deliberately app-owned, so every GHL slotBuffer must remain zero.
 * @param {{ id: string, slotDuration?: number, slotInterval?: number, slotBuffer?: number }} live
 */
export function driftAgainstPolicy(live) {
  const policy = policyForCalendarId(live?.id);
  if (!policy) return null;
  const drifts = [];
  if (Number(live.slotDuration) !== policy.durationMinutes) {
    drifts.push({
      field: "slotDuration",
      live: Number(live.slotDuration),
      policy: policy.durationMinutes,
    });
  }
  if (Number(live.slotInterval) !== policy.intervalMinutes) {
    drifts.push({
      field: "slotInterval",
      live: Number(live.slotInterval),
      policy: policy.intervalMinutes,
    });
  }
  if (Number(live.slotBuffer ?? 0) !== 0) {
    drifts.push({
      field: "slotBuffer",
      live: Number(live.slotBuffer ?? 0),
      policy: 0,
    });
  }
  return {
    policyId: policy.id,
    label: policy.label,
    priority: !!policy.priority,
    drifts,
    ok: drifts.length === 0,
  };
}

/** Priority Follow-up policy (on-the-hour). */
export function followupPolicy() {
  return SLOT_POLICIES.followup;
}

function slotHourMinute(slot) {
  if (slot && Number.isInteger(slot.hour) && Number.isInteger(slot.minute)) {
    return { hour: slot.hour, minute: slot.minute };
  }
  const time = String(slot?.time || "");
  if (/^\d{2}:\d{2}$/.test(time)) {
    return {
      hour: Number(time.slice(0, 2)),
      minute: Number(time.slice(3, 5)),
    };
  }
  const timePart = String(slot?.datetime || "").split("T")[1] || "";
  const hour = Number.parseInt(timePart.slice(0, 2), 10);
  const minute = Number.parseInt(timePart.slice(3, 5), 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { hour, minute };
}

/**
 * True when [start, start+block) overlaps a later on-the-hour instant.
 * Example: Assessment 10:40 with block 50 occupies until 11:30 → smashes 11:00.
 * Assessment 10:00 with block 50 frees at 10:50 → preserves 11:00.
 */
export function smashesNextOnHour(hour, minute, blockMinutes) {
  const block = Number(blockMinutes);
  if (!Number.isFinite(block) || block <= 0) return false;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  const startMin = hour * 60 + minute;
  const endMin = startMin + block;
  // First :00 strictly after the start.
  const nextHour = Math.ceil((startMin + 1) / 60) * 60;
  return nextHour < endMin;
}

export function slotPreservesNextOnHour(slot, blockMinutes) {
  const hm = slotHourMinute(slot);
  if (!hm) return true;
  return !smashesNextOnHour(hm.hour, hm.minute, blockMinutes);
}

/**
 * Show-layer preference on top of GHL free-slots (same safety model as look-busy):
 * - Main sessions (Assessment / Follow-up / Initial): keep :00 starts only.
 * - Phone / short: if a day has any slot that leaves the next Follow-up hour free,
 *   drop the ones that smash it.
 * Never invents times; never empties a day that only had smashing slots.
 *
 * @param {Array<{date?: string, time?: string, hour?: number, minute?: number, datetime?: string}>} slots
 * @param {{ calendarId: string }} opts
 */
export function applyHourPackPreference(slots, opts) {
  if (!Array.isArray(slots) || slots.length === 0) return slots;
  const policy = policyForCalendarId(opts && opts.calendarId);
  if (!policy) return slots;

  if (policy.preferOnHour) {
    return slots.filter((slot) => {
      const hm = slotHourMinute(slot);
      return hm ? hm.minute === 0 : true;
    });
  }

  if (policy.lattice !== "phone" && policy.lattice !== "short") {
    return slots;
  }

  const block = blockMinutes(policy);
  const byDate = new Map();
  const passthrough = [];
  for (const slot of slots) {
    if (!slot || !slot.date) {
      passthrough.push(slot);
      continue;
    }
    if (!byDate.has(slot.date)) byDate.set(slot.date, []);
    byDate.get(slot.date).push(slot);
  }

  const out = [];
  for (const [, daySlots] of byDate) {
    const preserving = [];
    const smashing = [];
    for (const slot of daySlots) {
      if (slotPreservesNextOnHour(slot, block)) preserving.push(slot);
      else smashing.push(slot);
    }
    // Prefer non-smashing when any exist; otherwise keep smashing so the day
    // still has something bookable (GHL said they were free).
    out.push(...(preserving.length ? preserving : smashing));
  }

  out.sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return da.localeCompare(db);
    return String(a.datetime || a.time || "").localeCompare(
      String(b.datetime || b.time || ""),
    );
  });
  return passthrough.length ? [...out, ...passthrough] : out;
}
