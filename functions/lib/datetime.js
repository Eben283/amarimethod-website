// Date/time helpers for GHL appointment booking.
//
// GHL appointment slots are wall-clock times carrying an explicit offset, e.g.
// "2026-05-21T10:00:00-07:00". GHL rejects appointments whose startTime/endTime
// offset is stripped, so the offset must be preserved on the computed endTime.
//
// The subtle bug this replaces: the old call sites did
//   new Date(endMs).toISOString().replace("Z", offset)
// which takes the UTC clock of the end instant (e.g. "18:00") and tacks the
// offset on ("18:00-07:00") — claiming 18:00 local when the true end is 11:00
// local. The instant was never shifted into the offset, so endTime read ~7h
// late. GHL tolerated it, but it's wrong and fragile.

/**
 * Format an epoch-ms instant as an ISO-8601 string at a fixed numeric offset,
 * to seconds precision (no milliseconds — matching GHL's slot format).
 *
 *   formatIsoAtOffset(t, "-07:00") => "2026-05-21T11:00:00-07:00"
 *   formatIsoAtOffset(t, "+05:30") => "2026-05-21T11:00:00+05:30"
 *   formatIsoAtOffset(t, "")       => "2026-05-21T18:00:00Z"  (UTC)
 *
 * @param {number} ms - epoch milliseconds
 * @param {string} offset - "+HH:MM" / "-HH:MM" / "Z" / "" (empty or Z → UTC)
 * @returns {string}
 */
export function formatIsoAtOffset(ms, offset) {
  if (!offset || offset === "Z") {
    return `${new Date(ms).toISOString().slice(0, 19)}Z`;
  }
  const sign = offset[0] === "-" ? -1 : 1;
  const oh = parseInt(offset.slice(1, 3), 10);
  const om = parseInt(offset.slice(4, 6), 10);
  const offsetMs = sign * (oh * 60 + om) * 60 * 1000;
  // Shift the instant by the offset so the UTC-formatted wall clock reads as the
  // local-at-offset clock, then stamp the offset suffix back on.
  const localClock = new Date(ms + offsetMs).toISOString().slice(0, 19);
  return `${localClock}${offset}`;
}

/**
 * Compute a GHL appointment endTime that preserves BOTH the start slot's instant
 * (start + duration) AND its timezone offset, so the end reads as the correct
 * wall-clock time in that offset.
 *
 * @param {string} startTime - ISO start with optional "+HH:MM"/"-HH:MM"/"Z" suffix
 * @param {number} durationMinutes
 * @returns {string} end time string in the same offset as startTime (UTC if none)
 * @throws if startTime is not a parseable date
 */
export function appointmentEndTime(startTime, durationMinutes) {
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid startTime: ${startTime}`);
  }
  const endMs = startMs + durationMinutes * 60 * 1000;
  const offsetMatch = String(startTime).match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = offsetMatch ? offsetMatch[1] : "";
  return formatIsoAtOffset(endMs, offset);
}
