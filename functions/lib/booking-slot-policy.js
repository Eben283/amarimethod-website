/**
 * Canonical booking slot policy (duration · interval · buffer).
 *
 * Priority: Follow-up (50 min) starts on the hour (interval 60, buffer 10).
 * Intro paths (Assessment / Discovery) keep denser lattices so off-hour fills
 * like 10:40 remain offerable — look-busy already hides plenty.
 * GHL remains availability truth; Amari ranks/filters what to show.
 * See amari-method-docs/ops/memory/decision_booking_slot_model.md
 *
 * Knobs:
 *   durationMinutes — client session length (appointment endTime)
 *   bufferMinutes   — post-session turnover (occupied block = duration + buffer)
 *   intervalMinutes — candidate start lattice (NOT "match duration")
 */

/** Main-session rhythm (Follow-up / Initial): on the hour. */
export const STUDIO_INTERVAL_MINUTES = 60;

/** Assessment intro lattice — denser; allows 10:40-style starts from a 10:00 open. */
export const INTRO_ASSESSMENT_INTERVAL_MINUTES = 40;

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
    bufferMinutes: 10,
    intervalMinutes: STUDIO_INTERVAL_MINUTES,
    lattice: "studio",
    priority: true,
    preferOnHour: true,
  },
  initial: {
    id: "initial",
    label: "Initial Session",
    calendarIds: [
      "G7OAnnJuFbMF6nQSlZVQ", // IP
      "ySmht5hx4uZGEpgZrlCw", // virtual
      "uUDFD0ZQEWtzGLS9aLq7", // paid at partner
      "lfsnaiGiLNL2z12pLKDP", // partner IP
      "P7T6M1w8wtuRfwAqzOVw", // partner virtual
    ],
    durationMinutes: 60,
    bufferMinutes: 0,
    intervalMinutes: STUDIO_INTERVAL_MINUTES,
    lattice: "studio",
    preferOnHour: true,
  },
  assessment: {
    id: "assessment",
    label: "Amari Assessment",
    calendarIds: ["EM6vB2mq7EAdGCbUb3j1"],
    durationMinutes: 40,
    bufferMinutes: 10,
    // Keep denser intro grid (10:00, 10:40, 11:20…) — off-hour fills OK.
    intervalMinutes: INTRO_ASSESSMENT_INTERVAL_MINUTES,
    lattice: "intro",
    preferOnHour: false,
  },
  discovery_call: {
    id: "discovery_call",
    label: "Discovery Call (phone)",
    calendarIds: ["USgPsktqRcuomdUgpShL"],
    durationMinutes: 15,
    bufferMinutes: 15,
    intervalMinutes: 15,
    lattice: "phone",
    preferOnHour: false,
  },
  discovery_virtual: {
    id: "discovery_virtual",
    label: "Discovery Call (virtual)",
    calendarIds: ["ZEIGFHBi17SpZ3Ezi5DR"],
    durationMinutes: 15,
    bufferMinutes: 0,
    intervalMinutes: 15,
    lattice: "phone",
    preferOnHour: false,
  },
  entrainment: {
    id: "entrainment",
    label: "Entrainment",
    calendarIds: ["B5aGXLoS4kzAjZAMMXxk"],
    durationMinutes: 30,
    bufferMinutes: 0,
    intervalMinutes: 15,
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
 * Compare live GHL calendar fields to policy. Returns drift rows.
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
  if (Number(live.slotBuffer ?? 0) !== policy.bufferMinutes) {
    drifts.push({
      field: "slotBuffer",
      live: Number(live.slotBuffer ?? 0),
      policy: policy.bufferMinutes,
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
