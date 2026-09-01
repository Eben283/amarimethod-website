// Aggregate-only visibility for the owned nurture delivery boundary. No contact, recipient,
// subject, body, provider ID, or delivery key leaves this projection.

import { SEQUENCES } from "./config.js";
import { nurtureEmailDeliveryReadiness } from "./email-delivery.js";

const MAX_EVIDENCE_ROWS = 100;

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function placeholders(count) { return Array.from({ length: count }, () => "?").join(","); }

export async function ownedNurtureDeliveryReadiness(nurtureDb, crmDb, env = {}) {
  const release = SEQUENCES.map((sequence) => ({
    sequenceId: sequence.sequenceId,
    sourceMode: sequence.mode,
    ...nurtureEmailDeliveryReadiness(env, sequence.sequenceId),
  }));
  if (!nurtureDb || !crmDb) {
    return { state: "unavailable", release, reason: "delivery evidence bindings unavailable" };
  }
  try {
    const statusRows = (await nurtureDb.prepare(
      "SELECT status, COUNT(*) AS count FROM nurture_steps GROUP BY status ORDER BY status",
    ).all()).results || [];
    const stepCounts = Object.fromEntries(statusRows.map((row) => [String(row.status), number(row.count)]));
    const events = (await nurtureDb.prepare(
      `SELECT ts, outcome, message_ref, detail
         FROM automation_events
        WHERE engine = 'nurture' AND outcome IN ('submitted', 'submission_unreconciled')
        ORDER BY ts DESC LIMIT ?`,
    ).bind(MAX_EVIDENCE_ROWS).all()).results || [];
    const observed = events.map((event) => {
      let detail;
      try { detail = JSON.parse(event.detail || "{}"); } catch { detail = {}; }
      return {
        outcome: event.outcome,
        messageRef: event.message_ref || null,
        deliveryKey: typeof detail.deliveryKey === "string" ? detail.deliveryKey : null,
      };
    });
    const keys = [...new Set(observed.map((event) => event.deliveryKey).filter(Boolean))];
    let submissions = [];
    let outcomes = [];
    if (keys.length) {
      submissions = (await crmDb.prepare(
        `SELECT submission_ref, provider_message_id
           FROM gmail_provider_submissions
          WHERE grant_owner = ? AND submission_ref IN (${placeholders(keys.length)})`,
      ).bind("garrett@amarimethod.com", ...keys).all()).results || [];
      outcomes = (await crmDb.prepare(
        `SELECT submission_ref, outcome, occurred_at
           FROM gmail_provider_events
          WHERE grant_owner = ? AND submission_ref IN (${placeholders(keys.length)})
          ORDER BY occurred_at DESC`,
      ).bind("garrett@amarimethod.com", ...keys).all()).results || [];
    }
    const submissionByKey = new Map(submissions.map((row) => [row.submission_ref, row]));
    const latestOutcomeByKey = new Map();
    for (const row of outcomes) if (!latestOutcomeByKey.has(row.submission_ref)) latestOutcomeByKey.set(row.submission_ref, row.outcome);
    const exact = observed.filter((event) => {
      const submission = submissionByKey.get(event.deliveryKey);
      return submission && submission.provider_message_id === event.messageRef;
    });
    const missingSubmissionEvidence = observed.length - exact.length;
    const terminalFailures = exact.filter((event) => ["failed", "bounced"].includes(latestOutcomeByKey.get(event.deliveryKey))).length;
    const acceptedOutcomes = exact.filter((event) => latestOutcomeByKey.get(event.deliveryKey) === "accepted").length;
    const providerOutcomeMissing = exact.filter((event) => !latestOutcomeByKey.has(event.deliveryKey)).length;
    const stuckDispatchClaims = stepCounts.dispatching || 0;
    const unreconciledStepCount = stepCounts.submission_unreconciled || 0;
    const anyReleaseEnabled = release.some((item) => item.sourceMode === "active" && item.enabled);
    const attention = stuckDispatchClaims + unreconciledStepCount + missingSubmissionEvidence + terminalFailures;
    return {
      state: attention > 0 ? "attention" : observed.length > 0 ? "incomplete" : "empty",
      release,
      deliveryEnabled: anyReleaseEnabled,
      stepCounts,
      evidenceWindow: {
        limit: MAX_EVIDENCE_ROWS,
        observedSubmissions: observed.length,
        exactProviderSubmissions: exact.length,
        missingSubmissionEvidence,
        providerOutcomeMissing,
        acceptedOutcomes,
        terminalFailures,
        terminalSuccessProven: 0,
      },
      exceptions: {
        stuckDispatchClaims,
        unreconciledStepCount,
        missingSubmissionEvidence,
        terminalFailures,
      },
      terminalSuccessModel: "not_available_from_gmail_submission",
    };
  } catch {
    return { state: "unavailable", release, reason: "delivery evidence schema unavailable" };
  }
}
