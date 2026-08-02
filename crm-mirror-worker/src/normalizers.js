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

function cleanMessage(value) {
  const source = text(value);
  return source ? source.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null : null;
}

function messageChannel(value) {
  const type = String(value || "").toUpperCase();
  if (type.includes("EMAIL") || type === "3") return "email";
  if (type.includes("SMS") || type === "2") return "sms";
  return null;
}

function messageDirection(raw) {
  if (raw?.direction === 1 || raw?.direction === "1" || raw?.direction === "inbound" || raw?.status === "received") return "inbound";
  if (raw?.direction === 2 || raw?.direction === "2" || raw?.direction === "outbound" || raw?.status === "sent" || raw?.status === "delivered") return "outbound";
  return "outbound";
}

export function normalizeGhlConversation(raw) {
  const externalId = text(raw?.id);
  const contactExternalId = text(raw?.contactId);
  if (!externalId || !contactExternalId) return null;
  const channel = messageChannel(raw.lastMessageType || raw.type) || "mixed";
  const occurredAt = raw.lastMessageDate || raw.dateUpdated || raw.dateAdded || null;
  return {
    externalId,
    contactExternalId,
    channel,
    lastOccurredAt: typeof occurredAt === "number" ? new Date(occurredAt).toISOString() : text(occurredAt),
    lastPreview: cleanMessage(raw.lastMessageBody || raw.lastMessage?.body),
    lastDirection: messageDirection({ direction: raw.lastMessageDirection ?? raw.lastMessage?.direction }),
    unreadInboundCount: Math.max(0, Number(raw.unreadCount || 0) || 0),
  };
}

export function normalizeGhlMessage(raw, threadExternalId, contactExternalId) {
  const externalId = text(raw?.id || raw?.messageId || raw?.emailMessageId);
  const channel = messageChannel(raw?.messageType || raw?.type);
  const occurredAt = raw?.dateAdded || raw?.createdAt || raw?.date;
  if (!externalId || !channel || !threadExternalId || !contactExternalId || !occurredAt) return null;
  return {
    externalId,
    threadExternalId,
    contactExternalId,
    channel,
    direction: messageDirection(raw),
    deliveryStatus: text(raw.status),
    subject: text(raw.subject),
    body: cleanMessage(raw.body || raw.message),
    occurredAt: typeof occurredAt === "number" ? new Date(occurredAt).toISOString() : text(occurredAt),
    senderLabel: text(raw.fromName || raw.userName),
  };
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

function dndSummary(raw) {
  if (raw?.dnd === true) return "on";
  if (raw?.dnd === false) return "off";
  const settings = raw?.dndSettings;
  if (!settings || typeof settings !== "object") return null;
  const channels = Object.entries(settings)
    .filter(([, setting]) => setting && typeof setting === "object" && typeof setting.status === "string")
    .map(([channel, setting]) => `${channel.toLowerCase()}: ${String(setting.status).toLowerCase() === "active" ? "on" : "off"}`);
  return channels.length ? channels.join(" · ") : null;
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
  const attributes = customFieldEntries(raw.customFields);
  const management = [
    ["system.dnd", dndSummary(raw)],
    ["system.owner", text(raw.assignedToName || raw.assignedTo?.name || raw.assignedTo)],
    ["system.followers", Array.isArray(raw.followers) ? raw.followers.map((follower) => text(follower?.name || follower)).filter(Boolean).join(", ") || "None" : null],
  ].filter(([, value]) => value != null);
  return {
    externalId: id,
    firstName,
    lastName,
    displayName,
    email,
    phone: normalizedPhone(raw.phone),
    tags,
    roles: [...roles].sort(),
    attributes: [...attributes, ...management],
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
  return {
    externalId,
    contactExternalId,
    calendarId: text(raw.calendarId || raw.calendar?.id),
    providerStatusRaw,
    status,
    startsAt: text(raw.startTime || raw.startAt || raw.start_time),
    endsAt: text(raw.endTime || raw.endAt || raw.end_time),
    timezone: text(raw.selectedTimezone || raw.timezone),
  };
}

export function normalizeGhlNote(raw) {
  const externalId = text(raw?.id || raw?.noteId);
  const body = cleanMessage(raw?.body || raw?.content || raw?.note);
  if (!externalId || !body) return null;
  const createdAt = raw?.dateAdded || raw?.createdAt || raw?.created_at || raw?.date;
  return {
    externalId,
    body,
    authoredBy: text(raw?.userName || raw?.authorName || raw?.author || raw?.userId),
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : text(createdAt),
  };
}

export function normalizeGhlTask(raw) {
  const externalId = text(raw?.id || raw?.taskId);
  const title = cleanMessage(raw?.title || raw?.name || raw?.body || raw?.description);
  if (!externalId || !title) return null;
  const status = text(raw?.status)?.toLowerCase() || (raw?.completed ? "completed" : "open");
  const createdAt = raw?.dateAdded || raw?.createdAt || raw?.created_at || raw?.date;
  const dueAt = raw?.dueDate || raw?.dueAt || raw?.due_at || null;
  const completedAt = raw?.completedAt || raw?.completed_at || (status === "completed" ? raw?.dateUpdated || raw?.updatedAt : null);
  return {
    externalId,
    title,
    status,
    dueAt: typeof dueAt === "number" ? new Date(dueAt).toISOString() : text(dueAt),
    completedAt: typeof completedAt === "number" ? new Date(completedAt).toISOString() : text(completedAt),
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : text(createdAt),
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
  };
}
