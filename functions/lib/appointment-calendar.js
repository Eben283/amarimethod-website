function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function utcTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("valid appointment calendar time required");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = "";
  for (const character of line) {
    const candidate = `${current}${character}`;
    if (new TextEncoder().encode(candidate).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = ` ${character}`;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

export function renderOwnedAppointmentCalendar(identity, generatedAt = Date.now()) {
  if (!identity?.ownedAppointmentId || !identity?.startsAt || !identity?.endsAt) {
    throw new TypeError("complete owned appointment calendar identity required");
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Amari Method//Owned Appointment//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(identity.ownedAppointmentId)}@amarimethod.com`,
    `DTSTAMP:${utcTimestamp(generatedAt)}`,
    `DTSTART:${utcTimestamp(identity.startsAt)}`,
    `DTEND:${utcTimestamp(identity.endsAt)}`,
    `SEQUENCE:${Number(identity.revision || 1)}`,
    "STATUS:CONFIRMED",
    `SUMMARY:${escapeIcs(identity.serviceName || "Amari Method Session")}`,
    `LOCATION:${escapeIcs(identity.meetingLocation || "662 8th Ave, San Francisco, CA 94118")}`,
    "DESCRIPTION:Your Amari partner session with Garrett.",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
