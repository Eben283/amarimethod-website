// Versioned, per-staff communication preference foundation.
//
// Important: this module records intent only. No sender, worker, cron, or
// external automation reads these records yet. The audited route catalog is
// returned beside preferences so the Staff UI cannot imply that saving changes
// live delivery.

export const TEAM_COMMUNICATION_PREFERENCES_VERSION = 1;
export const TEAM_COMMUNICATION_DEFAULT_TIMEZONE = "America/Los_Angeles";

const STAFF_USERS = Object.freeze(["Eben", "Garrett"]);
const CHANNELS = Object.freeze(["in_app", "email", "sms"]);
const CADENCES = Object.freeze(["immediate", "digest"]);

const CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "morning_agenda",
    label: "Morning agenda",
    description: "The prepare and staff-meeting summaries timed from the first appointment.",
    currentOwner: "Morning summary worker",
  }),
  Object.freeze({
    id: "money_booking_incidents",
    label: "Money and booking incidents",
    description: "New operational incidents that can affect a payment or booking path.",
    currentOwner: "Operations incident alerts",
  }),
  Object.freeze({
    id: "wrong_message_incidents",
    label: "Wrong-message incidents",
    description: "New evidence that a member may have received the wrong automated message.",
    currentOwner: "Operations incident alerts",
  }),
  Object.freeze({
    id: "system_incidents",
    label: "System incidents",
    description: "New infrastructure or owned-system incidents that need staff attention.",
    currentOwner: "Operations incident alerts",
  }),
]);

const EXTERNAL_ROUTES = Object.freeze([
  Object.freeze({
    id: "appointment_workflow_notices",
    label: "Appointment and practice workflow notices",
    currentRoute: "Managed in external automations and commonly sent to the assigned practitioner or a configured internal recipient.",
    controlStatus: "external",
  }),
  Object.freeze({
    id: "website_inquiry_handoff",
    label: "Website inquiry handoff",
    currentRoute: "Managed by the existing contact-form handoff automation after the website tag is applied.",
    controlStatus: "external",
  }),
]);

const CURRENT_CHANNELS = Object.freeze({
  Eben: Object.freeze({
    morning_agenda: Object.freeze(["sms"]),
    money_booking_incidents: Object.freeze(["sms", "email"]),
    wrong_message_incidents: Object.freeze(["sms"]),
    system_incidents: Object.freeze(["sms"]),
  }),
  Garrett: Object.freeze({
    morning_agenda: Object.freeze(["sms"]),
    money_booking_incidents: Object.freeze([]),
    wrong_message_incidents: Object.freeze([]),
    system_incidents: Object.freeze([]),
  }),
});

const CURRENT_CADENCE = Object.freeze({
  morning_agenda: "digest",
  money_booking_incidents: "immediate",
  wrong_message_incidents: "immediate",
  system_incidents: "immediate",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeStaffPreferenceUser(value) {
  const match = STAFF_USERS.find((staff) => staff.toLowerCase() === String(value || "").trim().toLowerCase());
  return match || null;
}

export function preferenceKey(user) {
  const normalized = normalizeStaffPreferenceUser(user);
  if (!normalized) throw new Error("Unsupported staff user");
  return `staff:communication-preferences:v${TEAM_COMMUNICATION_PREFERENCES_VERSION}:${normalized.toLowerCase()}`;
}

function channelStatus(user, categoryId, channel) {
  const current = CURRENT_CHANNELS[user]?.[categoryId] || [];
  if (current.includes(channel)) return "live";
  if (channel === "in_app" && categoryId !== "morning_agenda") return "surface_only";
  return "not_wired";
}

export function currentRouteCatalog(userValue) {
  const user = normalizeStaffPreferenceUser(userValue);
  if (!user) throw new Error("Unsupported staff user");
  return CATEGORY_DEFINITIONS.map((category) => {
    const channels = Object.fromEntries(CHANNELS.map((channel) => [channel, channelStatus(user, category.id, channel)]));
    const liveChannels = CURRENT_CHANNELS[user][category.id];
    return {
      ...category,
      channels,
      currentCadence: CURRENT_CADENCE[category.id],
      currentRoute: liveChannels.length
        ? `${liveChannels.map((channel) => channel === "sms" ? "SMS" : "Email").join(" + ")} to ${user}`
        : `No owned ${user} delivery`,
    };
  });
}

export function defaultTeamCommunicationPreferences(userValue) {
  const user = normalizeStaffPreferenceUser(userValue);
  if (!user) throw new Error("Unsupported staff user");
  const categories = {};
  for (const category of CATEGORY_DEFINITIONS) {
    const liveChannels = CURRENT_CHANNELS[user][category.id];
    categories[category.id] = {
      enabled: liveChannels.length > 0,
      cadence: CURRENT_CADENCE[category.id],
      channels: Object.fromEntries(CHANNELS.map((channel) => [channel, liveChannels.includes(channel)])),
    };
  }
  return {
    version: TEAM_COMMUNICATION_PREFERENCES_VERSION,
    timezone: TEAM_COMMUNICATION_DEFAULT_TIMEZONE,
    quietHours: { enabled: false, start: "21:00", end: "07:00" },
    categories,
    escalation: {
      enabled: false,
      afterMinutes: 30,
      fallbackChannel: null,
      fallbackStaff: null,
    },
  };
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validClockTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false`);
  return value;
}

export function normalizeTeamCommunicationPreferences(input, userValue) {
  const user = normalizeStaffPreferenceUser(userValue);
  if (!user) throw new Error("Unsupported staff user");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Preferences must be an object");

  const defaults = defaultTeamCommunicationPreferences(user);
  const timezone = input.timezone ?? defaults.timezone;
  if (!validTimeZone(timezone)) throw new Error("Choose a valid IANA timezone");

  const quietInput = input.quietHours ?? defaults.quietHours;
  if (!quietInput || typeof quietInput !== "object" || Array.isArray(quietInput)) throw new Error("Quiet hours must be an object");
  if (!validClockTime(quietInput.start) || !validClockTime(quietInput.end)) throw new Error("Quiet hours must use 24-hour HH:MM times");

  const incomingCategories = input.categories ?? {};
  if (!incomingCategories || typeof incomingCategories !== "object" || Array.isArray(incomingCategories)) throw new Error("Categories must be an object");
  const knownIds = new Set(CATEGORY_DEFINITIONS.map((category) => category.id));
  for (const id of Object.keys(incomingCategories)) {
    if (!knownIds.has(id)) throw new Error(`Unknown event category: ${id}`);
  }

  const categories = {};
  for (const category of CATEGORY_DEFINITIONS) {
    const fallback = defaults.categories[category.id];
    const incoming = incomingCategories[category.id] ?? fallback;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error(`${category.label} must be an object`);
    const cadence = incoming.cadence ?? fallback.cadence;
    if (!CADENCES.includes(cadence)) throw new Error(`${category.label} cadence must be immediate or digest`);
    const incomingChannels = incoming.channels ?? fallback.channels;
    if (!incomingChannels || typeof incomingChannels !== "object" || Array.isArray(incomingChannels)) throw new Error(`${category.label} channels must be an object`);
    for (const channel of Object.keys(incomingChannels)) {
      if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
    }
    categories[category.id] = {
      enabled: requireBoolean(incoming.enabled ?? fallback.enabled, `${category.label} enabled`),
      cadence,
      channels: Object.fromEntries(CHANNELS.map((channel) => [
        channel,
        requireBoolean(incomingChannels[channel] ?? fallback.channels[channel], `${category.label} ${channel}`),
      ])),
    };
  }

  const escalationInput = input.escalation ?? defaults.escalation;
  if (!escalationInput || typeof escalationInput !== "object" || Array.isArray(escalationInput)) throw new Error("Escalation must be an object");
  const afterMinutes = Number(escalationInput.afterMinutes ?? defaults.escalation.afterMinutes);
  if (!Number.isInteger(afterMinutes) || afterMinutes < 5 || afterMinutes > 1440) throw new Error("Escalation delay must be between 5 and 1440 minutes");
  const fallbackChannel = escalationInput.fallbackChannel ?? null;
  if (fallbackChannel !== null && !["sms", "email"].includes(fallbackChannel)) throw new Error("Fallback channel must be SMS, email, or none");
  const fallbackStaff = escalationInput.fallbackStaff == null ? null : normalizeStaffPreferenceUser(escalationInput.fallbackStaff);
  if (escalationInput.fallbackStaff != null && !fallbackStaff) throw new Error("Fallback staff member must be Eben, Garrett, or none");
  if (fallbackStaff === user) throw new Error("Fallback staff member must be someone else");

  return {
    version: TEAM_COMMUNICATION_PREFERENCES_VERSION,
    timezone,
    quietHours: {
      enabled: requireBoolean(quietInput.enabled ?? defaults.quietHours.enabled, "Quiet hours enabled"),
      start: quietInput.start,
      end: quietInput.end,
    },
    categories,
    escalation: {
      enabled: requireBoolean(escalationInput.enabled ?? defaults.escalation.enabled, "Escalation enabled"),
      afterMinutes,
      fallbackChannel,
      fallbackStaff,
    },
  };
}

export function communicationPreferencesView({ user, preferences, saved, storageAvailable, updatedAt = null }) {
  return {
    success: true,
    user,
    preferences: clone(preferences),
    saved,
    storageAvailable,
    updatedAt,
    appliedToDelivery: false,
    deliveryControlStatus: "foundation_only",
    currentRoutes: currentRouteCatalog(user),
    externalRoutes: clone(EXTERNAL_ROUTES),
  };
}

export const __test = {
  CATEGORY_DEFINITIONS,
  CURRENT_CHANNELS,
  EXTERNAL_ROUTES,
};
