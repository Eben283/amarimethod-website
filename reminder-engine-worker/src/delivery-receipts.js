import { getAccessToken } from "../../functions/lib/ghl-worker-token.js";
import { appendDeliveryReceiptEvent, loadDeliveryReceiptCandidates } from "./store.js";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const RECEIPT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const RECEIPT_FLOW_KEYS = Object.freeze([
  "initial-in-person",
  "initial-virtual",
  "follow-up-session-reminders",
  "no-show-recovery",
]);

const deliveredStatuses = new Set(["delivered", "read", "completed"]);
const failedStatuses = new Set(["failed", "undelivered", "error", "canceled", "cancelled"]);
const bouncedStatuses = new Set(["bounced", "bounce"]);

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeGhlReceipt(payload) {
  const message = payload?.message || payload || {};
  const providerStatus = clean(message.status) || "unknown";
  if (deliveredStatuses.has(providerStatus)) return { terminal: true, outcome: "delivered", providerStatus };
  if (bouncedStatuses.has(providerStatus)) return { terminal: true, outcome: "bounced", providerStatus };
  if (failedStatuses.has(providerStatus)) return { terminal: true, outcome: "failed", providerStatus };
  return { terminal: false, outcome: null, providerStatus };
}

export async function readGhlMessage(env, messageRef, accessToken = null) {
  const token = accessToken || await getAccessToken(env);
  const response = await fetch(`${GHL_API_BASE}/conversations/messages/${encodeURIComponent(messageRef)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Version: "v3",
    },
  });
  if (!response.ok) throw new Error(`GHL message receipt read failed (${response.status})`);
  return response.json();
}

export async function reconcileDeliveryReceipts(env, nowMs, dependencies = {}) {
  const loadCandidates = dependencies.loadCandidates
    || ((db, cutoff, batchLimit, page, flowKey) => loadDeliveryReceiptCandidates(db, cutoff, batchLimit, page, flowKey));
  const readMessage = dependencies.readGhlMessage || readGhlMessage;
  const appendReceipt = dependencies.appendReceipt || appendDeliveryReceiptEvent;
  const limit = dependencies.limit || 50;
  const flowKeys = dependencies.flowKeys || RECEIPT_FLOW_KEYS;
  const counts = { checked: 0, recorded: 0, pending: 0, errors: 0 };
  const byFlow = {};
  let candidates = [];

  for (const flowKey of flowKeys) {
    const flowCounts = { checked: 0, recorded: 0, pending: 0, errors: 0 };
    byFlow[flowKey] = flowCounts;
    try {
      const flowCandidates = await loadCandidates(
        env.REMINDER_DB,
        nowMs - RECEIPT_LOOKBACK_MS,
        limit,
        Math.floor(nowMs / (5 * 60 * 1000)),
        flowKey,
      );
      candidates.push(...flowCandidates.map((event) => ({ ...event, _receiptFlowKey: flowKey })));
    } catch (error) {
      counts.errors += 1;
      flowCounts.errors += 1;
      console.error(JSON.stringify({ message: "delivery receipt candidate load failed", flowKey, error: String(error?.message || error) }));
    }
  }

  let accessToken = null;
  if (candidates.length && !dependencies.readGhlMessage) {
    try {
      accessToken = await getAccessToken(env);
    } catch (error) {
      counts.errors += 1;
      candidates = [];
      console.error(JSON.stringify({ message: "delivery receipt provider authentication failed", error: String(error?.message || error) }));
    }
  }

  for (const event of candidates) {
    const flowCounts = byFlow[event._receiptFlowKey || event.flow_key] || counts;
    counts.checked += 1;
    flowCounts.checked += 1;
    try {
      const receipt = normalizeGhlReceipt(await readMessage(env, event.message_ref, accessToken));
      if (!receipt.terminal) {
        counts.pending += 1;
        flowCounts.pending += 1;
        continue;
      }
      const inserted = await appendReceipt(env.REMINDER_DB, {
        ts: nowMs,
        engine: event.engine,
        flowKey: event.flow_key,
        definitionVersion: event.definition_version,
        contactId: event.contact_id,
        appointmentId: event.appointment_id,
        stepIndex: event.step_index,
        action: "delivery_status",
        outcome: receipt.outcome,
        channel: event.channel,
        message_ref: event.message_ref,
        detail: {
          provider: "ghl",
          providerStatus: receipt.providerStatus,
          sourceEventId: event.id,
        },
      });
      if (inserted) counts.recorded += 1;
      if (inserted) flowCounts.recorded += 1;
    } catch (error) {
      counts.errors += 1;
      flowCounts.errors += 1;
      console.error(JSON.stringify({
        message: "delivery receipt reconciliation failed",
        provider: "ghl",
        messageRef: event.message_ref,
        error: String(error?.message || error),
      }));
    }
  }
  if (env.PORTAL_KV) {
    for (const flowKey of flowKeys) {
      const health = {
        flowKey,
        capability: "terminal_status_reconciled",
        status: byFlow[flowKey].errors ? "degraded" : "healthy",
        checkedAt: new Date(nowMs).toISOString(),
        lookbackDays: 30,
        batchLimit: limit,
        ...byFlow[flowKey],
      };
      try {
        await env.PORTAL_KV.put(`reminder:delivery-receipts:${flowKey}`, JSON.stringify(health));
      } catch (error) {
        console.error(JSON.stringify({ message: "delivery receipt health persistence failed", flowKey, error: String(error?.message || error) }));
      }
    }
  }
  return counts;
}
