import { WORK_HOURS, policyForCalendarId } from "./booking-slot-policy.js";
import { STAFF_BOOK_TYPES } from "./staff-book-calendars.js";

const GROUPS = Object.freeze([
  { id: "sessions", label: "Sessions" },
  { id: "discovery", label: "Discovery & intake" },
  { id: "studies", label: "Studies" },
]);

const DEFINITIONS = Object.freeze([
  {
    id: "B5aGXLoS4kzAjZAMMXxk", key: "entrainment", name: "Entrainment", group: "sessions",
    location: "Studio", paymentOwner: "Staff POS or existing arrangement", bookingOwner: "Staff booking",
  },
  {
    id: "G7OAnnJuFbMF6nQSlZVQ", key: "initial-in-person", name: "Initial Session — In Person", group: "sessions",
    location: "Studio", paymentOwner: "Legacy calendar checkout", bookingOwner: "Legacy booking path", lifecycle: "legacy",
  },
  {
    id: "SKDVOL8wtUN6Ne0ppbC9", key: "followup-in-person", name: "Follow-up Session — In Person", group: "sessions",
    location: "Studio", paymentOwner: "Existing client payment path", bookingOwner: "Client portal",
  },
  {
    id: "ZO1jlGfy01rsxVqicoSB", key: "followup-package-in-person", name: "Follow-up Session — In Person (Package)", group: "sessions",
    location: "Studio", paymentOwner: "Prepaid package", bookingOwner: "Amari booking",
  },
  {
    id: "bJFkhVP35Ecwh4tLnSmy", key: "followup-package-virtual", name: "Follow-up Session — Virtual (Package)", group: "sessions",
    location: "Google Meet", paymentOwner: "Prepaid package", bookingOwner: "Amari booking",
  },
  {
    id: "lfsnaiGiLNL2z12pLKDP", key: "partner-initial", name: "Partner Initial Session", group: "sessions",
    location: "Studio", paymentOwner: "Complimentary", bookingOwner: "Amari booking",
  },
  {
    id: "oVn77FcecFY16iS2pHyP", key: "followup-virtual", name: "Follow-up Session — Virtual", group: "sessions",
    location: "Google Meet", paymentOwner: "Existing client payment path", bookingOwner: "Client portal",
  },
  {
    id: "uUDFD0ZQEWtzGLS9aLq7", key: "initial-paid-at-partner", name: "Initial Session — Paid at Partner", group: "sessions",
    location: "Studio", paymentOwner: "Partner-collected", bookingOwner: "Legacy booking path", lifecycle: "legacy",
  },
  {
    id: "ySmht5hx4uZGEpgZrlCw", key: "initial-virtual", name: "Initial Session — Virtual", group: "sessions",
    location: "Virtual", paymentOwner: "Legacy calendar checkout", bookingOwner: "Legacy booking path", lifecycle: "legacy",
    readiness: "attention", readinessNote: "The recorded virtual calendar still needs its virtual location and booking copy verified before reuse.",
  },
  {
    id: "P7T6M1w8wtuRfwAqzOVw", key: "partner-initial-virtual", name: "Partner Initial Session — Virtual", group: "sessions",
    location: "Virtual", paymentOwner: "Complimentary", bookingOwner: "Amari booking",
    readiness: "attention", readinessNote: "Verify the virtual location, intake form, and in-person copy before sharing this calendar.",
  },
  {
    id: "EM6vB2mq7EAdGCbUb3j1", key: "assessment", name: "Amari Assessment — In Person", group: "sessions",
    location: "Studio", paymentOwner: "Calendar checkout · $29", bookingOwner: "Amari booking", publicPath: "/assessment-booking",
  },
  {
    id: "USgPsktqRcuomdUgpShL", key: "discovery-call", name: "Your Free Discovery Call", group: "discovery",
    location: "Phone", paymentOwner: "No payment", bookingOwner: "Amari booking", publicPath: "/assessment-booking?type=discovery_call",
  },
  {
    id: "ZEIGFHBi17SpZ3Ezi5DR", key: "discovery-virtual", name: "Discovery Call — Virtual", group: "discovery",
    location: "Google Meet", paymentOwner: "No payment", bookingOwner: "Amari booking", publicPath: "/assessment-booking?type=discovery_virtual",
  },
  {
    id: "aVE54Qf4lrbYTB0zFqXy", key: "partnership-discovery", name: "Partnership Discovery Call", group: "discovery",
    location: "Phone", paymentOwner: "No payment", bookingOwner: "Amari booking", publicPath: "/assessment-booking?type=ambassador_discovery",
  },
  {
    id: "wO5lnu7BOQOHEJ5YQU0f", key: "entrainment-20", name: "Entrainment — 20 Minutes", group: "discovery",
    location: "Studio", paymentOwner: "Staff POS", bookingOwner: "Staff booking",
  },
  {
    id: "J1N09B6bRYPOGNyVAfmX", key: "study-session", name: "Amari Study 15-Minute Session", group: "studies",
    location: "Studio", paymentOwner: "No payment", bookingOwner: "Field Studies", lifecycle: "specialist",
  },
]);

const STAFF_BOOKABLE_IDS = new Set(Object.values(STAFF_BOOK_TYPES).map((entry) => entry.calendarId));

function displayTime(value) {
  const [hourValue, minute] = String(value || "").split(":");
  const hour = Number(hourValue);
  if (!Number.isInteger(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute || "00"} ${suffix}`;
}

function shapeCalendar(definition) {
  const policy = policyForCalendarId(definition.id);
  const lifecycle = definition.lifecycle || "current";
  const readiness = definition.readiness || (lifecycle === "legacy" ? "legacy" : lifecycle === "specialist" ? "specialist" : "ready");
  return {
    ...definition,
    lifecycle,
    readiness,
    readinessNote: definition.readinessNote || (
      lifecycle === "legacy"
        ? "Retained for existing historical paths. Do not publish as a current offer."
        : lifecycle === "specialist"
          ? "Used only by the Field Studies workflow."
          : "Available through its current Amari booking path."
    ),
    durationMinutes: policy?.durationMinutes ?? null,
    intervalMinutes: policy?.intervalMinutes ?? null,
    bufferMinutes: policy?.bufferMinutes ?? null,
    staffBookable: STAFF_BOOKABLE_IDS.has(definition.id),
    timezone: "America/Los_Angeles",
    appointmentStore: "Current provider mirror",
    remindersOwner: "Current appointment workflows",
  };
}

export function listStaffCalendarDefinitions() {
  const calendars = DEFINITIONS.map(shapeCalendar);
  return {
    source: "owned-registry",
    timezone: "America/Los_Angeles",
    editable: false,
    editingBoundary: "Calendar definitions remain read-only until booking, payment, reminder, cancellation, and reschedule ownership move together.",
    groups: GROUPS.map((group) => ({
      ...group,
      count: calendars.filter((calendar) => calendar.group === group.id).length,
    })),
    calendars,
    workHours: {
      timezone: WORK_HOURS.timezone,
      weekdays: WORK_HOURS.weekdays.map((day) => day[0].toUpperCase() + day.slice(1)),
      openFrom: displayTime(WORK_HOURS.openFrom),
      openTo: displayTime(WORK_HOURS.openTo),
      firstSessionStart: displayTime(WORK_HOURS.firstSessionStart),
      lastSessionStart: displayTime(WORK_HOURS.lastSessionStart),
    },
  };
}
