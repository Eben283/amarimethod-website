import { gmailEvidenceReadModel } from "./gmail-evidence.js";

const MAILBOXES = Object.freeze({
  Eben: "eben@amarimethod.com",
  Garrett: "garrett@amarimethod.com",
});

export class GmailReplyReadinessError extends Error {
  constructor(message, code = "invalid_request") {
    super(message);
    this.name = "GmailReplyReadinessError";
    this.code = code;
  }
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 20)) : 8;
}

export async function gmailReplyReadiness(db, options = {}) {
  const actor = String(options.actor || "").trim();
  const mailbox = MAILBOXES[actor];
  if (!mailbox) throw new GmailReplyReadinessError("Owned Staff mailbox required", "invalid_actor");

  const evidence = await gmailEvidenceReadModel(db, {
    mailboxActor: actor,
    grantOwner: mailbox,
    limit: boundedLimit(options.limit),
  });
  const latest = evidence.latestHistory?.[0] || null;
  const syncGaps = (evidence.syncGaps || []).map((gap) => ({
    messageId: gap.provider_message_id,
    historyId: gap.history_id,
    reason: gap.reason,
    observedAt: gap.observed_at,
  }));

  return {
    actor,
    mailbox,
    state: syncGaps.length ? "review" : latest ? "quiet" : "no_baseline",
    replySyncEnabled: false,
    checkpoint: latest ? { historyId: latest.history_id, observedAt: latest.observed_at } : null,
    syncGaps,
  };
}
