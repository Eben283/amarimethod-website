// Owned nurture email delivery boundary. Rendering and recipient lookup happen upstream; this
// module owns the immutable sender choice and the independent release gates. It never falls back
// to GHL. All sequence configs remain shadow, and the production environment has neither gate,
// so adding this adapter cannot send until a separately reviewed source + environment cutover.

import { sendGmailEmail } from "../../crm-mirror-worker/src/gmail.js";
import { recordGmailProviderSubmission } from "../../crm-mirror-worker/src/gmail-submission.js";

const KNOWN_SEQUENCES = new Set([
  "flow-1-quiz",
  "flow-2-post-discovery",
  "flow-3-post-initial",
]);
const DELIVERY_KEY = /^[a-z0-9-]+:[A-Za-z0-9_-]{1,100}:v\d+:s\d+$/;

function releaseAllowlist(env) {
  if (env?.NURTURE_EMAIL_DELIVERY_RELEASE !== "approved") return [];
  let parsed;
  try { parsed = JSON.parse(env.NURTURE_EMAIL_SEQUENCE_ALLOWLIST || ""); } catch { return []; }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || !KNOWN_SEQUENCES.has(id))) return [];
  return [...new Set(parsed)];
}

export function nurtureEmailDeliveryReadiness(env, sequenceId) {
  const allowlist = releaseAllowlist(env);
  const known = KNOWN_SEQUENCES.has(sequenceId);
  const sequenceAllowed = known && allowlist.includes(sequenceId);
  return {
    provider: "google-workspace",
    senderActor: "Garrett",
    releaseApproved: env?.NURTURE_EMAIL_DELIVERY_RELEASE === "approved",
    allowlistValid: allowlist.length > 0,
    sequenceAllowed,
    enabled: sequenceAllowed,
    receiptState: "provider_submission_only",
    terminalDeliveryEvidence: false,
  };
}

export async function deliverNurtureEmail(env, message, services = {}) {
  const sequenceId = String(message?.sequenceId || "");
  const readiness = nurtureEmailDeliveryReadiness(env, sequenceId);
  if (!readiness.enabled) {
    return { success: false, error: "owned nurture email delivery is not released", code: "delivery_not_released" };
  }
  if (!DELIVERY_KEY.test(String(message?.deliveryKey || ""))) {
    return { success: false, error: "invalid nurture delivery key", code: "invalid_delivery_key" };
  }
  const send = services.sendGmailEmail || sendGmailEmail;
  const recordSubmission = services.recordSubmission || recordGmailProviderSubmission;
  try {
    const result = await send(env, {
      actor: "Garrett",
      to: message?.recipient?.email,
      subject: message?.subject,
      preheader: message?.preheader,
      text: message?.body,
    });
    if (!result?.id) throw new Error("Google Workspace did not return a submission reference");
    try {
      await recordSubmission(env.CRM_DB, {
        mailboxActor: "Garrett",
        grantOwner: "garrett@amarimethod.com",
        submissionRef: message.deliveryKey,
        contactId: message.recipient.contactId,
        providerMessageId: String(result.id),
        gmailThreadId: result.threadId ? String(result.threadId) : null,
        rfcMessageId: null,
        subject: message.subject,
        body: message.body,
        submittedAt: new Date().toISOString(),
      });
    } catch (evidenceError) {
      // The provider already accepted the message. Never describe this as a failed send or make
      // it retryable: doing so could duplicate the email. Surface an unreconciled submission for
      // Staff intervention while retaining the provider message ID.
      return {
        success: true,
        messageId: String(result.id),
        provider: "google-workspace",
        receiptState: "submission_unreconciled",
        terminal: false,
        evidenceError: String(evidenceError?.message || evidenceError),
      };
    }
    return {
      success: true,
      messageId: String(result.id),
      provider: "google-workspace",
      receiptState: "submitted",
      terminal: false,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error),
      code: "provider_submission_failed",
      retryable: error?.retryable === true,
    };
  }
}
