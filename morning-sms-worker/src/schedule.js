// Pure schedule helpers for the morning SMS smoke test.
//
// First text ("Good morning, time to prepare for the day."):
//   - Default 08:00 America/Los_Angeles
//   - If today's first appointment is earlier than 10:00, fire at firstAppt − 2h
//     (so an 8:00 session prep text lands at 6:00).
// Second text ("Staff meeting"): always firstAt + 90 minutes
//   (default 09:30 when firstAt is 08:00).

export const COPY = Object.freeze({
  prepare: "Good morning, time to prepare for the day.",
  meeting: "Staff meeting",
});

export const DEFAULT_FIRST_MINUTES = 8 * 60; // 08:00
export const SECOND_OFFSET_MS = 90 * 60 * 1000;
export const PREP_LEAD_MS = 2 * 60 * 60 * 1000;
export const SEND_GRACE_MS = 20 * 60 * 1000; // cron is */5; allow late catch-up

/**
 * Pacific calendar date YYYY-MM-DD for an instant.
 * @param {number|Date} now
 * @param {string} timeZone
 */
export function dateKeyInZone(now, timeZone = "America/Los_Angeles") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

/**
 * Instant (ms) of local HH:MM on a Pacific YYYY-MM-DD date.
 * Handles DST by probing noon UTC offset for that civil day.
 */
export function zonedTimeToUtcMs(dateKey, minutesFromMidnight, timeZone = "America/Los_Angeles") {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const hh = Math.floor(minutesFromMidnight / 60);
  const mm = minutesFromMidnight % 60;
  // Guess UTC, then correct using the zone's offset at that civil time.
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtc - guess;
  return guess - offset;
}

/**
 * @param {{ nowMs: number, firstAppointmentMs?: number|null, timeZone?: string }} opts
 * @returns {{ dateKey: string, firstAtMs: number, secondAtMs: number, reason: string }}
 */
export function computeMorningTimes({ nowMs, firstAppointmentMs = null, timeZone = "America/Los_Angeles" }) {
  const dateKey = dateKeyInZone(nowMs, timeZone);
  const eightAm = zonedTimeToUtcMs(dateKey, DEFAULT_FIRST_MINUTES, timeZone);
  let firstAtMs = eightAm;
  let reason = "default-08:00";

  if (typeof firstAppointmentMs === "number" && Number.isFinite(firstAppointmentMs)) {
    const candidate = firstAppointmentMs - PREP_LEAD_MS;
    // Only pull earlier than 08:00 when the appointment requires it.
    if (candidate < eightAm) {
      firstAtMs = candidate;
      reason = "two-hours-before-first-appt";
    } else {
      reason = "default-08:00-appt-later";
    }
  }

  return {
    dateKey,
    firstAtMs,
    secondAtMs: firstAtMs + SECOND_OFFSET_MS,
    reason,
  };
}

/**
 * Which named sends are due right now (idempotency is the caller's job).
 * @returns {Array<'prepare'|'meeting'>}
 */
export function dueKinds(nowMs, firstAtMs, secondAtMs, graceMs = SEND_GRACE_MS) {
  const due = [];
  if (nowMs >= firstAtMs && nowMs < firstAtMs + graceMs) due.push("prepare");
  if (nowMs >= secondAtMs && nowMs < secondAtMs + graceMs) due.push("meeting");
  return due;
}

function agendaTime(startMs, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startMs));
}

function appointmentLabel(appointment) {
  const name = String(appointment?.contactName || "").trim();
  const detail = String(appointment?.calendarName || appointment?.title || "Appointment").trim();
  if (!name) return detail;
  if (detail.toLowerCase().includes(name.toLowerCase())) return detail;
  return `${name} · ${detail}`;
}

/** A compact internal SMS agenda. A null agenda means GHL was unavailable. */
export function formatDailyAgenda(appointments, timeZone = "America/Los_Angeles") {
  if (appointments == null) {
    return `${COPY.prepare} Today's appointment list could not be loaded.`;
  }
  if (appointments.length === 0) return "Good morning — no appointments today.";

  const lines = appointments.map((appointment) => (
    `${agendaTime(appointment.startMs, timeZone)} — ${appointmentLabel(appointment)}`
  ));
  return `Today's appointments:\n${lines.join("\n")}\n\nTime to prepare for the day.`;
}

export function messageForKind(kind, appointments, timeZone) {
  if (kind === "prepare") return formatDailyAgenda(appointments, timeZone);
  if (kind === "meeting") return COPY.meeting;
  return null;
}
