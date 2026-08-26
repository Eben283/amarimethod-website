// Shadow-only reliability observer for the GHL-owned missed-appointment counter.
// Importing this module is inert. Even when enabled it never writes to GHL and never
// claims that the retained Math Operation completed; it records one expected obligation.

import {
  NO_SHOW_MISSED_COUNT_FAMILY,
  buildAcceptedLifecycle,
  buildRejectedSource,
  noShowCounterShadowEnabled,
  sha256Hex,
} from "../../functions/lib/reliability-contract.js";
import { acceptLifecycle, rejectSourceEvent } from "../../functions/lib/reliability-store.js";

export const MISSED_APPOINTMENTS_FIELD = Object.freeze({
  id: "e9COM3UBr7m8GnCTPPYG",
  key: "contact.missed_appointments",
  name: "Missed Appointments",
});

export const NO_SHOW_COUNTER_CALENDAR_IDS = Object.freeze([
  "bJFkhVP35Ecwh4tLnSmy", "G7OAnnJuFbMF6nQSlZVQ", "B5aGXLoS4kzAjZAMMXxk", "SKDVOL8wtUN6Ne0ppbC9",
  "ZO1jlGfy01rsxVqicoSB", "lfsnaiGiLNL2z12pLKDP", "oVn77FcecFY16iS2pHyP", "ySmht5hx4uZGEpgZrlCw",
  "P7T6M1w8wtuRfwAqzOVw", "wO5lnu7BOQOHEJ5YQU0f", "waHmG2mHNThPfMVuNJWG",
]);
const CALENDAR_IDS = new Set(NO_SHOW_COUNTER_CALENDAR_IDS);
const SOURCE_VERSION_BINDING = "NO_SHOW_COUNTER_SOURCE_VERSION";

function requiredBinding(env, key) {
  const value = String(env?.[key] || "").trim();
  if (!value) throw new Error(`No Show counter shadow requires ${key}`);
  return value;
}

function statusOf(event) {
  return String(event?.type || event?.status || "").trim().toLowerCase();
}

function kindOf(event) {
  return String(event?.appointmentEventType || "").trim().toLowerCase();
}

export function noShowCounterCompositeIdentityV1({ appointmentId, eventKind, status, effectiveStart, payloadSha256 }) {
  const values = ["ghl", appointmentId, eventKind, status, effectiveStart, payloadSha256]
    .map((value) => String(value || "").trim());
  if (values.some((value) => !value)) throw new TypeError("complete No Show counter composite identity is required");
  return `ghl:no-show-counter:v1:${values.join(":")}`;
}

function normalizedEvidence(event) {
  return {
    appointmentId: event?.appointmentId || null,
    personId: event?.contactId || null,
    calendarId: event?.calendarId || null,
    status: statusOf(event),
    eventKind: kindOf(event),
    effectiveStart: event?.startAt || null,
    observedAtIngest: event?.context?.missedAppointmentsObserved ?? null,
    observedField: MISSED_APPOINTMENTS_FIELD,
    observationLimitation: "The contact value was read during ingest and may be before or after GHL's live Math Operation; it is not increment proof.",
    liveOwner: "No Show — Increment Missed Count",
  };
}

async function rejectedRecord({ event, payloadSha256, nowMs, sourceVersion, runtimeVersion, reason }) {
  return buildRejectedSource({
    provider: "ghl",
    providerEventId: null,
    identityVersion: 1,
    identityKey: ["ghl", "no-show-counter", "v1-rejected", event?.appointmentId || "unknown", kindOf(event) || "unknown", statusOf(event) || "unknown", event?.startAt || "unknown", payloadSha256].join(":"),
    payloadSha256,
    payloadReference: null,
    rawRetentionUntil: null,
    occurredAt: nowMs,
    receivedAt: nowMs,
    authenticationResult: "authenticated",
    normalizationState: "ambiguous",
    normalized: normalizedEvidence(event),
    rejectionReason: reason,
    sourceVersion,
    runtimeVersion,
    exceptionKind: "no_show_counter_identity_ambiguous",
    exceptionFamily: NO_SHOW_MISSED_COUNT_FAMILY,
    accountableOwner: "Eben",
    nextSafeAction: "Inspect the canonical appointment, event type, and observed contact field before replay.",
  });
}

export async function captureNoShowCounterShadow({ env, event, rawPayload, nowMs }) {
  if (!noShowCounterShadowEnabled(env)) return { enabled: false, applicable: false };
  if (!CALENDAR_IDS.has(event?.calendarId)) return { enabled: true, applicable: false };

  const sourceVersion = requiredBinding(env, SOURCE_VERSION_BINDING);
  const sourceRevision = requiredBinding(env, "SOURCE_REVISION");
  const workerVersion = requiredBinding(env, "WORKER_VERSION");
  const runtimeVersion = `${sourceRevision}@${workerVersion}`;
  const payloadSha256 = await sha256Hex(rawPayload);
  const status = statusOf(event);
  const eventKind = kindOf(event);
  const identityComplete = event?.appointmentId && event?.contactId && event?.startAt && status && eventKind;
  const eligible = status === "noshow" && eventKind === "normal";
  const contactObserved = Object.prototype.hasOwnProperty.call(event?.context || {}, "missedAppointmentsObserved");

  if (!identityComplete || !eligible || !contactObserved) {
    const record = await rejectedRecord({
      event, payloadSha256, nowMs, sourceVersion, runtimeVersion,
      reason: !identityComplete
        ? "No Show counter source identity is incomplete"
        : !eligible ? "No Show counter event is outside the Normal No Show contract" : "No Show contact counter observation is unavailable",
    });
    const stored = await rejectSourceEvent(env.REMINDER_DB, record, nowMs);
    return { enabled: true, applicable: true, accepted: false, ...stored };
  }

  const identityKey = noShowCounterCompositeIdentityV1({
    appointmentId: event.appointmentId, eventKind, status, effectiveStart: event.startAt, payloadSha256,
  });
  const record = await buildAcceptedLifecycle({
    provider: "ghl",
    providerEventId: null,
    identityVersion: 1,
    identityKey,
    payloadSha256,
    payloadReference: null,
    rawRetentionUntil: null,
    occurredAt: nowMs,
    receivedAt: nowMs,
    authenticationResult: "authenticated",
    normalizationState: "normalized",
    normalized: normalizedEvidence(event),
    sourceVersion,
    runtimeVersion,
    lifecycle: {
      family: NO_SHOW_MISSED_COUNT_FAMILY,
      scope: "normal-no-show-counter-shadow",
      personId: event.contactId,
      appointmentId: event.appointmentId,
      definitionVersion: 1,
      runtimeVersion,
    },
    obligations: [{
      obligationKey: "increment-missed-appointments",
      kind: "contact_field_increment",
      deadlineAt: nowMs + 5 * 60 * 1000,
      ownerRole: "ghl-retained",
      closer: "No Show — Increment Missed Count",
      initialState: "pending",
    }],
  });
  const stored = await acceptLifecycle(env.REMINDER_DB, record, nowMs);
  return { enabled: true, applicable: true, accepted: true, ...stored };
}
