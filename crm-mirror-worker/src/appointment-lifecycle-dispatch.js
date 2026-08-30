const DEFAULT_LIMIT = 10;
const DEFAULT_LEASE_MS = 120_000;
const MANUAL_REVIEW_AFTER = 24;
const LIFECYCLE_CONTRACTS = Object.freeze({
  "partner-initial": Object.freeze({
    flowKey: "partner-initial-in-person",
    ghlCalendarId: "lfsnaiGiLNL2z12pLKDP",
    googleCalendarAllowed: true,
  }),
  "discovery-call": Object.freeze({
    flowKey: "discovery-call",
    ghlCalendarId: "USgPsktqRcuomdUgpShL",
    googleCalendarAllowed: false,
  }),
  "discovery-call-virtual": Object.freeze({
    flowKey: "discovery-call",
    ghlCalendarId: "ZEIGFHBi17SpZ3Ezi5DR",
    googleCalendarAllowed: false,
  }),
});

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownedAppointmentLifecycleEvent(row) {
  const contract = ownedAppointmentLifecycleContract(row?.service_id);
  if (!row?.command_id || !row?.appointment_id || !row?.contact_id || !row?.service_id ||
      !contract ||
      !new Set(["ghl", "google_calendar"]).has(row?.provider) ||
      (row.provider === "ghl" && !row?.provider_contact_id) ||
      (row.provider === "ghl" && row.provider_calendar_id !== contract.ghlCalendarId) ||
      (row.provider === "google_calendar" && !contract.googleCalendarAllowed) ||
      !row?.provider_appointment_id || !row?.provider_calendar_id || !row?.start_at ||
      !new Set(["confirmed", "cancelled"]).has(row?.event_type)) {
    throw new TypeError("complete owned appointment lifecycle identity required");
  }
  return {
    type: row.event_type,
    recognized: true,
    status: row.event_type,
    calendarId: row.provider_calendar_id,
    contactId: row.contact_id,
    appointmentId: row.appointment_id,
    startAt: row.start_at,
    modifiedBy: "user",
    context: {
      source: "owned_crm",
      commandId: row.command_id,
      ownedAppointmentId: row.appointment_id,
      ownedContactId: row.contact_id,
      serviceId: row.service_id,
      provider: row.provider,
      providerAppointmentId: row.provider_appointment_id,
      providerCalendarId: row.provider_calendar_id,
      providerContactId: row.provider_contact_id || null,
    },
  };
}

export function ownedAppointmentLifecycleContract(serviceId) {
  return LIFECYCLE_CONTRACTS[String(serviceId || "")] || null;
}

export async function ownedAppointmentLifecyclePayload(row) {
  const event = ownedAppointmentLifecycleEvent(row);
  const canonicalJson = JSON.stringify(event);
  return { event, canonicalJson, payloadSha256: await sha256(canonicalJson) };
}

async function claimDispatch(db, candidate, nowMs, leaseMs) {
  const updatedAt = new Date(nowMs).toISOString();
  const updated = await db.prepare(
    `UPDATE appointment_lifecycle_dispatches
        SET state = 'executing', attempts = attempts + 1, lease_until = ?,
            last_error = NULL, updated_at = ?
      WHERE id = ?
        AND (state IN ('pending', 'retryable') OR (state = 'executing' AND lease_until <= ?))`,
  ).bind(nowMs + leaseMs, updatedAt, candidate.id, nowMs).run();
  if (changes(updated) !== 1) return null;
  return db.prepare("SELECT * FROM appointment_lifecycle_dispatches WHERE id = ?")
    .bind(candidate.id).first();
}

async function finishDispatch(db, row, engineResult, nowMs) {
  const now = new Date(nowMs).toISOString();
  const result = JSON.stringify({ actions: engineResult.actions || [] });
  const updated = await db.prepare(
    `UPDATE appointment_lifecycle_dispatches
        SET state = 'dispatched', lease_until = 0, engine_result_json = ?,
            last_error = NULL, dispatched_at = ?, updated_at = ?
      WHERE id = ? AND state = 'executing'`,
  ).bind(result, now, now, row.id).run();
  if (changes(updated) !== 1) throw new Error("appointment lifecycle dispatch checkpoint changed");
}

async function failDispatch(db, row, error, nowMs, manualReview = false) {
  const now = new Date(nowMs).toISOString();
  const state = manualReview || Number(row.attempts) >= MANUAL_REVIEW_AFTER ? "manual_review" : "retryable";
  await db.prepare(
    `UPDATE appointment_lifecycle_dispatches
        SET state = ?, lease_until = 0, last_error = ?, updated_at = ?
      WHERE id = ? AND state = 'executing'`,
  ).bind(state, String(error || "appointment lifecycle dispatch failed").slice(0, 1000), now, row.id).run();
  return state;
}

function acceptedLifecycleAction(actions, serviceId) {
  const flowKey = ownedAppointmentLifecycleContract(serviceId)?.flowKey;
  if (!flowKey) return false;
  return (actions || []).some((action) => action?.engine === "reminder"
    && new Set(["enroll", "enroll-noop", "reschedule", "cancel"]).has(action?.action)
    && action?.detail?.flowKey === flowKey);
}

/**
 * Deliver completed owned appointment lifecycles to the existing shadow-only
 * reminder engine. The service binding is mandatory: same-account workers.dev
 * subrequests are intentionally not a supported fallback.
 */
export async function dispatchOwnedAppointmentLifecycles(env, nowMs = Date.now(), limit = DEFAULT_LIMIT) {
  const db = env?.CRM_DB;
  if (!db) throw new Error("CRM_DB is required for appointment lifecycle dispatch");
  const bounded = Math.max(1, Math.min(50, Number(limit) || DEFAULT_LIMIT));
  const pending = await db.prepare(
    `SELECT * FROM appointment_lifecycle_dispatches
      WHERE state IN ('pending', 'retryable')
         OR (state = 'executing' AND lease_until <= ?)
      ORDER BY datetime(updated_at), id
      LIMIT ?`,
  ).bind(nowMs, bounded).all();
  const summary = { status: "succeeded", considered: (pending.results || []).length, dispatched: 0, retryable: 0, manualReview: 0 };

  for (const candidate of pending.results || []) {
    const row = await claimDispatch(db, candidate, nowMs, DEFAULT_LEASE_MS);
    if (!row) continue;
    try {
      const payload = await ownedAppointmentLifecyclePayload(row);
      if (payload.payloadSha256 !== row.payload_sha256) {
        await failDispatch(db, row, "appointment lifecycle payload digest mismatch", nowMs, true);
        summary.manualReview += 1;
        continue;
      }
      if (!env.REMINDER?.fetch || !env.WORKER_AUTH_SECRET) {
        throw new Error("reminder service binding or authentication is unavailable");
      }
      const response = await env.REMINDER.fetch("https://reminder-engine/event", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`,
          "Content-Type": "application/json",
        },
        body: payload.canonicalJson,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`reminder engine responded ${response.status}`);
      if (!acceptedLifecycleAction(body.actions, row.service_id)) {
        await failDispatch(db, row, "reminder engine did not acknowledge the exact owned appointment lifecycle", nowMs, true);
        summary.manualReview += 1;
        continue;
      }
      await finishDispatch(db, row, body, nowMs);
      summary.dispatched += 1;
    } catch (error) {
      const state = await failDispatch(db, row, error instanceof Error ? error.message : String(error), nowMs);
      summary[state === "manual_review" ? "manualReview" : "retryable"] += 1;
    }
  }
  if (summary.retryable || summary.manualReview) summary.status = "attention";
  return summary;
}

export async function appointmentLifecycleDispatchReadiness(db) {
  if (!db) return { configured: false, state: "unavailable", reason: "CRM_DB is unavailable" };
  try {
    const result = await db.prepare(
      `SELECT state, COUNT(*) AS count
         FROM appointment_lifecycle_dispatches
        GROUP BY state`,
    ).all();
    const counts = Object.fromEntries(["pending", "executing", "retryable", "dispatched", "manual_review"]
      .map((state) => [state, 0]));
    for (const row of result.results || []) counts[row.state] = Number(row.count || 0);
    const blocking = counts.pending + counts.executing + counts.retryable + counts.manual_review;
    return {
      configured: true,
      state: counts.manual_review ? "attention" : blocking ? "pending" : "ready",
      blocking,
      counts,
      shadowOnly: true,
      deliveryEnabled: false,
    };
  } catch (error) {
    return {
      configured: false,
      state: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
