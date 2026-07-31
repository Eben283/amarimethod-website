// Server-owned session types for staff "Book for someone".
// Never trust a client-supplied calendarId.

export const STAFF_BOOK_TYPES = {
  assessment: {
    calendarId: "EM6vB2mq7EAdGCbUb3j1",
    durationMinutes: 50,
    title: "Amari Method Assessment",
    label: "Assessment ($29)",
  },
  discovery_call: {
    calendarId: "USgPsktqRcuomdUgpShL",
    durationMinutes: 15,
    title: "Amari Method Discovery Call",
    label: "Discovery call (free)",
  },
  followup_package_in_person: {
    calendarId: "ZO1jlGfy01rsxVqicoSB",
    durationMinutes: 50,
    title: "Amari Method Follow-up — In Person",
    label: "Follow-up · package · in person",
  },
  followup_package_virtual: {
    calendarId: "bJFkhVP35Ecwh4tLnSmy",
    durationMinutes: 50,
    title: "Amari Method Follow-up — Virtual",
    label: "Follow-up · package · virtual",
  },
  partner_initial: {
    calendarId: "lfsnaiGiLNL2z12pLKDP",
    durationMinutes: 60,
    title: "Amari Method Partner Initial Session",
    label: "Partner Initial (comp)",
  },
};

export function resolveStaffBookType(sessionType) {
  const key = String(sessionType || "").trim();
  return STAFF_BOOK_TYPES[key] || null;
}

export function listStaffBookTypes() {
  return Object.entries(STAFF_BOOK_TYPES).map(([id, value]) => ({
    id,
    label: value.label,
    durationMinutes: value.durationMinutes,
  }));
}

/** Flatten GHL free-slots map into staff calendar picker rows. */
export function flattenSlots(data) {
  const slots = [];
  for (const date of Object.keys(data || {}).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const values = Array.isArray(data[date]?.slots) ? data[date].slots : [];
    for (const datetime of [...new Set(values)].sort()) {
      const time = String(datetime).split("T")[1] || "";
      const hour = Number.parseInt(time.split(":")[0], 10);
      const minute = Number.parseInt(time.split(":")[1], 10);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
      slots.push({ date, hour, minute, datetime });
    }
  }
  return slots;
}
