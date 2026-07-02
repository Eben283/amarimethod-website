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

// ── GHL naive-Pacific timestamps ────────────────────────────────────────────
//
// GHL's /contacts/{id}/appointments returns startTime as a NAIVE wall-clock
// string in the location's timezone ("2026-07-02T15:00:00", no Z/offset —
// verified in troubleshooting-log.md, Albert Yang 2026-07-01). Parsing that
// with new Date() interprets it in the RUNTIME's zone: UTC in Workers (the
// instant lands 7-8h early — day-of sessions "vanished" from the portal from
// ~8am), the browser's zone client-side (a New York client's calendar export
// landed 3h early). These helpers pin the interpretation to Pacific.

const PACIFIC_TZ = "America/Los_Angeles";
const OFFSET_OR_Z = /([+-]\d{2}:?\d{2}|Z)$/i;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

// The Pacific wall-clock at instant `ms`, re-encoded as a UTC timestamp so it
// can be compared arithmetically against Date.UTC of a naive string.
function pacificWallClockAsUtc(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

function parseNaivePacific(value) {
  const m = NAIVE_DATETIME.exec(value);
  if (!m) return null;
  const naiveAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  // Find the instant whose Pacific wall-clock equals the naive string:
  // t = naiveAsUtc − offset(t), iterated twice to stabilize across DST edges.
  let ms = naiveAsUtc - (pacificWallClockAsUtc(naiveAsUtc) - naiveAsUtc);
  ms = naiveAsUtc - (pacificWallClockAsUtc(ms) - ms);
  return { ms, offsetMs: naiveAsUtc - ms };
}

/**
 * Epoch ms for a GHL timestamp. Naive strings are interpreted as Pacific
 * wall-clock; offset-qualified / Z strings parse as-is. NaN on garbage.
 */
export function parsePacificWallClock(value) {
  if (typeof value !== "string" || !value) return NaN;
  if (OFFSET_OR_Z.test(value)) return new Date(value).getTime();
  const parsed = parseNaivePacific(value);
  return parsed ? parsed.ms : NaN;
}

/**
 * Normalize a GHL timestamp for clients: naive Pacific strings gain their
 * real numeric offset ("2026-07-02T15:00:00" → "2026-07-02T15:00:00-07:00")
 * so browsers and calendar exports parse the correct instant everywhere.
 * Already-qualified or unparseable values pass through unchanged.
 */
export function normalizeGhlTimestamp(value) {
  if (typeof value !== "string" || !value) return value;
  if (OFFSET_OR_Z.test(value)) return value;
  const parsed = parseNaivePacific(value);
  if (!parsed || !Number.isFinite(parsed.ms)) return value;
  const totalMin = Math.round(parsed.offsetMs / 60000);
  const sign = totalMin < 0 ? "-" : "+";
  const abs = Math.abs(totalMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return formatIsoAtOffset(parsed.ms, offset);
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
