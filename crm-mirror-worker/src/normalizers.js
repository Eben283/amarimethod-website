import { classifyCharge } from "../../functions/lib/stripe-charges.js";

const STATUS_MAP = Object.freeze({
  new: "booked",
  booked: "booked",
  scheduled: "booked",
  unconfirmed: "booked",
  pending: "booked",
  confirmed: "confirmed",
  cancelled: "cancelled",
  canceled: "cancelled",
  noshow: "no_show",
  "no-show": "no_show",
  no_show: "no_show",
  missed: "no_show",
  showed: "attended",
  attended: "attended",
});

const PACKAGE_IDS = Object.freeze({
  "4-Session Series": "four-session-series",
  "8-Session Series": "eight-session-series",
  "Initial Session": "single-initial-session",
  "Follow-up Session": "single-follow-up-session",
  "Upgrade Initial→4": "upgrade-initial-to-four",
  "Upgrade Initial→8": "upgrade-initial-to-eight",
  "Upgrade 4→8": "upgrade-four-to-eight",
  Entrainment: "entrainment",
  "Living Practice": "living-practice",
});

function text(value) {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

export function normalizedEmail(value) {
  const email = text(value);
  return email ? email.toLowerCase() : null;
}

export function normalizedPhone(value) {
  const phone = text(value);
  if (!phone) return null;
  const digits = phone.replace(/[^0-9+]/g, "");
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  return phone;
}

function customFieldEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((field) => {
    const key = text(field?.key || field?.id || field?.fieldKey);
    if (!key) return [];
    const value = field?.value ?? field?.field_value ?? null;
    return [[key.replace(/^contact\./, ""), value == null ? null : String(value)]];
  });
}

function localParts(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  return { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
}

function formattedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

// GHL can return a local wall-clock time plus selectedTimezone. Converting it
// here keeps comparisons in UTC and prevents a Pacific appointment from being
// falsely treated as already past by SQLite running in UTC.
export function normalizeProviderDateTime(value, timeZone) {
  const source = text(value);
  if (!source) return null;
  if (/Z$|[+-]\d\d:\d\d$/.test(source)) {
    const parsed = new Date(source);
    return Number.isNaN(parsed.getTime()) ? source : parsed.toISOString();
  }
  const local = localParts(source);
  if (!local || !timeZone) return source;
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let instant = target;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const seen = formattedParts(new Date(instant), timeZone);
      const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
      const difference = target - seenUtc;
      if (difference === 0) break;
      instant += difference;
    }
    return new Date(instant).toISOString();
  } catch {
    // Retain source text rather than fabricating an instant when the provider
    // supplied an invalid or unsupported timezone.
    return source;
  }
}

export function normalizeGhlConsents(raw) {
  const dnd = raw?.dnd === true || String(raw?.dnd || "").toLowerCase() === "true";
  const settings = raw?.dndSettings || {};
  const blocked = (channel) => dnd || String(settings?.[channel]?.status || "").toLowerCase() === "active";
  return [
    { channel: "sms", state: blocked("SMS") ? "revoked" : "unknown" },
    { channel: "email", state: blocked("Email") ? "revoked" : "unknown" },
  ];
}

export function normalizeGhlContact(raw) {
  const id = text(raw?.id);
  if (!id) return null;
  const firstName = text(raw.firstName);
  const lastName = text(raw.lastName);
  const email = normalizedEmail(raw.email);
  const displayName = text([firstName, lastName].filter(Boolean).join(" ")) || email || text(raw.phone) || "Unnamed contact";
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map(text).filter(Boolean))].sort();
  const roles = new Set(["lead"]);
  if (tags.includes("affiliate-partner")) roles.add("affiliate_partner");
  if (tags.includes("affiliate-referral")) roles.add("client");
  return {
    externalId: id,
    firstName,
    lastName,
    displayName,
    email,
    phone: normalizedPhone(raw.phone),
    tags,
    roles: [...roles].sort(),
    attributes: customFieldEntries(raw.customFields),
    consents: normalizeGhlConsents(raw),
    referralSourceLabel: text(raw.source),
  };
}

export function normalizeAppointmentStatus(rawStatus) {
  const raw = text(rawStatus);
  return { raw, status: raw ? STATUS_MAP[raw.toLowerCase()] || "unknown" : "unknown" };
}

export function normalizeGhlAppointment(raw, contactExternalId) {
  const externalId = text(raw?.id || raw?.appointmentId);
  if (!externalId || !contactExternalId) return null;
  const { raw: providerStatusRaw, status } = normalizeAppointmentStatus(
    raw.appointmentStatus || raw.status,
  );
  const timezone = text(raw.selectedTimezone || raw.timezone || raw.calendar?.timezone);
  return {
    externalId,
    contactExternalId,
    calendarId: text(raw.calendarId || raw.calendar?.id),
    providerStatusRaw,
    status,
    startsAt: normalizeProviderDateTime(raw.startTime || raw.startAt || raw.start_time, timezone),
    endsAt: normalizeProviderDateTime(raw.endTime || raw.endAt || raw.end_time, timezone),
    timezone,
  };
}

export function normalizeStripeCharge(raw) {
  const id = text(raw?.id);
  if (!id || raw?.paid !== true || raw?.status !== "succeeded") return null;
  const classification = classifyCharge(raw);
  return {
    externalId: id,
    contactExternalId: text(raw.metadata?.contactId),
    customerExternalId: text(raw.customer),
    billingEmail: normalizedEmail(raw.billing_details?.email || raw.receipt_email),
    providerStatus: raw.refunded ? "refunded" : "succeeded",
    amountCents: Number.isInteger(raw.amount) ? raw.amount : 0,
    amountRefundedCents: Number.isInteger(raw.amount_refunded) ? raw.amount_refunded : 0,
    currency: text(raw.currency)?.toLowerCase() || "usd",
    purchasedAt: Number.isFinite(raw.created) ? new Date(raw.created * 1000).toISOString() : null,
    classification: classification.label || "unclassified",
    packageId: classification.label ? PACKAGE_IDS[classification.label] || null : null,
    stripePaymentIntentId: text(raw.payment_intent),
    ghlInvoiceId: text(raw.metadata?.invoiceId),
    ghlTransactionId: text(raw.metadata?.transactionId),
  };
}
