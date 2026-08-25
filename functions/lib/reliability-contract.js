const SOURCE_STATES = new Set(["accepted", "rejected"]);
const OBLIGATION_STATES = new Set(["pending", "leased", "satisfied", "skipped", "cancelled", "overdue_exception"]);

export const RELIABILITY_SCHEMA_VERSION = 1;
export const FOLLOW_UP_FAMILY = "follow-up-session-reminders";
export const RELIABILITY_FEATURE_FLAG = "FOLLOW_UP_RELIABILITY_SPINE_ENABLED";
export const FOLLOW_UP_RELIABILITY_ROUTE = Object.freeze({
  accepted: Object.freeze([
    Object.freeze({ id: "durable-receipt", transition: "received", label: "Record durable source receipt", detail: "Amari stores the authenticated GHL event identity and immutable payload hash before enrollment can continue." }),
    Object.freeze({ id: "authenticate-source", transition: "authenticated", label: "Verify source authenticity", detail: "Amari records that the event passed the authenticated webhook boundary before its contents can control a lifecycle." }),
    Object.freeze({ id: "normalize-identity", transition: "normalized", label: "Normalize and bind identity", detail: "Amari requires the exact appointment, person, start time, confirmed status, and Normal event type. Incomplete or ineligible events leave the reminder route." }),
    Object.freeze({ id: "lifecycle-obligations", transition: "accepted", label: "Create lifecycle and obligations", detail: "One atomic D1 transaction creates the lifecycle instance and every expected reminder obligation from the published definition." }),
    Object.freeze({ id: "dispatch-definition", transition: "dispatched", label: "Dispatch the published reminder definition", detail: "Only a durably accepted lifecycle with obligations can enter the existing Follow-Up reminder engine." }),
  ]),
  rejected: Object.freeze({ id: "reliability-exception", transition: "rejected", label: "Open Staff reliability exception", detail: "Rejected or ambiguous events stop before reminder enrollment and enter the named Staff exception queue for resolution." }),
});
export const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const NORMALIZED_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

export function reliabilityEnabled(env = {}) {
  return env[RELIABILITY_FEATURE_FLAG] === "enabled";
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

export async function buildAcceptedLifecycle(input) {
  const provider = requireString(input.provider, "provider");
  const identityKey = requireString(input.identityKey, "identityKey");
  const payloadSha256 = requireString(input.payloadSha256, "payloadSha256");
  const receivedAt = requireInteger(input.receivedAt, "receivedAt");
  const occurredAt = requireInteger(input.occurredAt, "occurredAt");
  const rawRetentionUntil = input.rawRetentionUntil ?? null;
  if (rawRetentionUntil !== null && (!Number.isInteger(rawRetentionUntil) || rawRetentionUntil > receivedAt + RAW_RETENTION_MS)) {
    throw new TypeError("raw payload retention may not exceed 30 days");
  }
  if (input.authenticationResult !== "authenticated") throw new TypeError("source event must be authenticated");
  if (input.normalizationState !== "normalized") throw new TypeError("source event must be normalized");
  if (!input.lifecycle || !Array.isArray(input.obligations) || input.obligations.length === 0) {
    throw new TypeError("accepted source event requires a lifecycle and initial obligations");
  }

  const identityVersion = requireInteger(input.identityVersion, "identityVersion");
  const sourceDigest = await sha256Hex(`${provider}\u0000${identityVersion}\u0000${identityKey}`);
  const sourceEventId = `src_${sourceDigest}`;
  const lifecycleInstanceId = `life_${sourceDigest}`;
  const obligationKeys = new Set();
  const obligations = [];
  for (const item of input.obligations) {
    const obligationKey = requireString(item.obligationKey, "obligationKey");
    if (obligationKeys.has(obligationKey)) throw new TypeError(`duplicate obligationKey: ${obligationKey}`);
    obligationKeys.add(obligationKey);
    obligations.push({
      obligationId: `obl_${await sha256Hex(`${lifecycleInstanceId}\u0000${obligationKey}`)}`,
      obligationKey,
      kind: requireString(item.kind, "obligation kind"),
      deadlineAt: requireInteger(item.deadlineAt, "obligation deadlineAt"),
      ownerRole: requireString(item.ownerRole, "obligation ownerRole"),
      closer: requireString(item.closer, "obligation closer"),
      initialState: item.initialState === "skipped" ? "skipped" : "pending",
      retentionUntil: receivedAt + NORMALIZED_RETENTION_MS,
    });
  }

  return {
    sourceEvent: {
      sourceEventId,
      provider,
      family: requireString(input.lifecycle.family, "lifecycle family"),
      providerEventId: input.providerEventId ? requireString(input.providerEventId, "providerEventId") : null,
      identityVersion,
      identityKey,
      payloadSha256,
      payloadReference: input.payloadReference || null,
      rawRetentionUntil,
      normalizedRetentionUntil: receivedAt + NORMALIZED_RETENTION_MS,
      occurredAt,
      receivedAt,
      authenticationResult: "authenticated",
      normalizationState: "normalized",
      normalizedJson: JSON.stringify(input.normalized || {}),
      sourceVersion: requireString(input.sourceVersion, "sourceVersion"),
      runtimeVersion: requireString(input.runtimeVersion, "runtimeVersion"),
    },
    lifecycle: {
      lifecycleInstanceId,
      family: requireString(input.lifecycle.family, "lifecycle family"),
      scope: requireString(input.lifecycle.scope, "lifecycle scope"),
      personId: requireString(input.lifecycle.personId, "lifecycle personId"),
      appointmentId: requireString(input.lifecycle.appointmentId, "lifecycle appointmentId"),
      definitionVersion: requireInteger(input.lifecycle.definitionVersion, "lifecycle definitionVersion"),
      runtimeVersion: requireString(input.lifecycle.runtimeVersion, "lifecycle runtimeVersion"),
      retentionUntil: receivedAt + NORMALIZED_RETENTION_MS,
    },
    obligations,
  };
}

export async function buildRejectedSource(input) {
  const provider = requireString(input.provider, "provider");
  const identityKey = requireString(input.identityKey, "identityKey");
  const identityVersion = requireInteger(input.identityVersion, "identityVersion");
  const sourceDigest = await sha256Hex(`${provider}\u0000${identityVersion}\u0000${identityKey}`);
  const sourceEventId = `src_${sourceDigest}`;
  const reason = requireString(input.rejectionReason, "rejectionReason");
  const exceptionId = `exc_${await sha256Hex(`${sourceEventId}\u0000${reason}`)}`;
  return {
    sourceEvent: {
      sourceEventId,
      provider,
      family: requireString(input.exceptionFamily, "exceptionFamily"),
      providerEventId: input.providerEventId || null,
      identityVersion,
      identityKey,
      payloadSha256: requireString(input.payloadSha256, "payloadSha256"),
      payloadReference: input.payloadReference || null,
      rawRetentionUntil: input.rawRetentionUntil ?? null,
      normalizedRetentionUntil: requireInteger(input.receivedAt, "receivedAt") + NORMALIZED_RETENTION_MS,
      occurredAt: requireInteger(input.occurredAt, "occurredAt"),
      receivedAt: requireInteger(input.receivedAt, "receivedAt"),
      authenticationResult: input.authenticationResult === "authenticated" ? "authenticated" : "rejected",
      normalizationState: input.normalizationState === "ambiguous" ? "ambiguous" : "rejected",
      normalizedJson: input.normalized ? JSON.stringify(input.normalized) : null,
      rejectionReason: reason,
      sourceVersion: requireString(input.sourceVersion, "sourceVersion"),
      runtimeVersion: requireString(input.runtimeVersion, "runtimeVersion"),
    },
    exception: {
      exceptionId,
      family: requireString(input.exceptionFamily, "exceptionFamily"),
      kind: input.exceptionKind || "source_event_rejected",
      severity: input.severity || "warning",
      accountableOwner: input.accountableOwner || "Eben",
      nextSafeAction: requireString(input.nextSafeAction, "nextSafeAction"),
      retentionUntil: requireInteger(input.receivedAt, "receivedAt") + NORMALIZED_RETENTION_MS,
    },
  };
}

export function assertSourceState(value) {
  if (!SOURCE_STATES.has(value)) throw new TypeError(`invalid source state: ${value}`);
  return value;
}

export function assertObligationState(value) {
  if (!OBLIGATION_STATES.has(value)) throw new TypeError(`invalid obligation state: ${value}`);
  return value;
}
