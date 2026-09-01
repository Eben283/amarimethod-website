// Append-only proof that Gmail accepted one server-owned outbound submission. This module does
// no OAuth or network I/O. It is called only after sendGmailEmail returns a provider message ID,
// giving reply/outcome reconciliation an exact contact + stable command attribution boundary.

const FIELDS = new Set([
  "mailboxActor", "grantOwner", "submissionRef", "contactId", "providerMessageId",
  "gmailThreadId", "rfcMessageId", "subject", "body", "submittedAt",
]);
const IDENTIFIER = /^[A-Za-z0-9@._:+<>\/-]{1,512}$/;
const OWNED_MAILBOXES = Object.freeze({
  Eben: "eben@amarimethod.com",
  Garrett: "garrett@amarimethod.com",
});

function exact(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Gmail submission evidence is required");
  const extra = Object.keys(input).filter((key) => !FIELDS.has(key));
  if (extra.length) throw new Error(`unsupported Gmail submission fields: ${extra.join(", ")}`);
}

function text(value, label, max, required = true) {
  const clean = String(value ?? "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
  if (required && !clean) throw new Error(`${label} is required`);
  if (clean.length > max) throw new Error(`${label} is too long`);
  return clean || null;
}

function identifier(value, label, required = true) {
  const clean = text(value, label, 512, required);
  if (clean && !IDENTIFIER.test(clean)) throw new Error(`${label} is invalid`);
  return clean;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordGmailProviderSubmission(db, input, now = new Date().toISOString()) {
  if (!db) throw new Error("Gmail submission evidence storage is unavailable");
  exact(input);
  const mailboxActor = text(input.mailboxActor, "mailboxActor", 40);
  const grantOwner = text(input.grantOwner, "grantOwner", 320).toLowerCase();
  if (!Object.hasOwn(OWNED_MAILBOXES, mailboxActor) || grantOwner !== OWNED_MAILBOXES[mailboxActor]) {
    throw new Error("Gmail submission must use the actor's exact owned Amari mailbox");
  }
  const submissionRef = identifier(input.submissionRef, "submissionRef");
  const contactId = identifier(input.contactId, "contactId");
  const providerMessageId = identifier(input.providerMessageId, "providerMessageId");
  const gmailThreadId = identifier(input.gmailThreadId, "gmailThreadId", false);
  const rfcMessageId = identifier(input.rfcMessageId, "rfcMessageId", false);
  const subject = text(input.subject, "subject", 160);
  const body = text(input.body, "body", 20_000);
  const submittedAt = new Date(input.submittedAt).toISOString();
  const createdAt = new Date(now).toISOString();
  const id = `ghs_${(await sha256(`${grantOwner}\n${submissionRef}`)).slice(0, 32)}`;

  const result = await db.prepare(
    `INSERT OR IGNORE INTO gmail_provider_submissions
     (id, mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id, gmail_thread_id,
      rfc_message_id, subject_clean, body_clean, submitted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, mailboxActor, grantOwner, submissionRef, contactId, providerMessageId, gmailThreadId,
    rfcMessageId, subject, body, submittedAt, createdAt).run();

  const stored = await db.prepare(
    `SELECT id, contact_id, provider_message_id, gmail_thread_id, rfc_message_id, subject_clean, body_clean, submitted_at
       FROM gmail_provider_submissions WHERE grant_owner = ? AND submission_ref = ?`,
  ).bind(grantOwner, submissionRef).first();
  if (!stored) throw new Error("Gmail submission evidence was not recorded");
  const expected = {
    contact_id: contactId,
    provider_message_id: providerMessageId,
    gmail_thread_id: gmailThreadId,
    rfc_message_id: rfcMessageId,
    subject_clean: subject,
    body_clean: body,
    submitted_at: submittedAt,
  };
  if (Object.entries(expected).some(([key, value]) => (stored[key] ?? null) !== (value ?? null))) {
    throw new Error("Gmail submission reference was reused for different evidence");
  }
  return {
    submissionId: stored.id,
    submissionRef,
    contactId,
    providerMessageId,
    deduped: Number(result?.meta?.changes || 0) === 0,
  };
}
