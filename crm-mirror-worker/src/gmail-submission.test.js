import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { recordGmailProviderSubmission } from "./gmail-submission.js";

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const name of [
    "0001_initial_schema.sql",
    "0006_staff_communications.sql",
    "0010_owned_sender_foundation.sql",
    "0015_owned_communication_commands.sql",
    "0016_gmail_provider_evidence.sql",
  ]) {
    raw.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const now = "2026-09-01T18:00:00.000Z";
  raw.prepare(
    "INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("contact-1", "A Lead", "lead@example.test", now, now);
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => raw.prepare(sql).get(...args) || null,
    run: async () => {
      const result = raw.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  });
  return { raw, db: { prepare: (sql) => statement(sql) }, now };
}

const submission = (overrides = {}) => ({
  mailboxActor: "Garrett",
  grantOwner: "garrett@amarimethod.com",
  submissionRef: "flow-1-quiz:contact-1:v2:s0",
  contactId: "contact-1",
  providerMessageId: "gmail-message-1",
  gmailThreadId: "gmail-thread-1",
  rfcMessageId: null,
  subject: "A subject",
  body: "Private exact body",
  submittedAt: "2026-09-01T17:59:00.000Z",
  ...overrides,
});

describe("recordGmailProviderSubmission", () => {
  it("appends exact contact-attributed provider submission evidence", async () => {
    const { raw, db, now } = fixture();
    const result = await recordGmailProviderSubmission(db, submission(), now);

    expect(result).toEqual(expect.objectContaining({
      contactId: "contact-1", providerMessageId: "gmail-message-1", deduped: false,
    }));
    expect(raw.prepare(
      "SELECT mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id, gmail_thread_id FROM gmail_provider_submissions",
    ).get()).toEqual({
      mailbox_actor: "Garrett",
      grant_owner: "garrett@amarimethod.com",
      submission_ref: "flow-1-quiz:contact-1:v2:s0",
      contact_id: "contact-1",
      provider_message_id: "gmail-message-1",
      gmail_thread_id: "gmail-thread-1",
    });
  });

  it("dedupes an exact replay and rejects changed evidence under the same reference", async () => {
    const { raw, db, now } = fixture();
    await recordGmailProviderSubmission(db, submission(), now);
    await expect(recordGmailProviderSubmission(db, submission(), now)).resolves.toEqual(expect.objectContaining({ deduped: true }));
    await expect(recordGmailProviderSubmission(db, submission({ providerMessageId: "gmail-message-2" }), now))
      .rejects.toThrow("reused for different evidence");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_provider_submissions").get().count).toBe(1);
  });

  it("accepts either exact owned mailbox, rejects crossed identity, and requires a real owned contact", async () => {
    const { raw, db, now } = fixture();
    await expect(recordGmailProviderSubmission(db, submission({
      mailboxActor: "Eben",
      grantOwner: "eben@amarimethod.com",
      submissionRef: "desk:contact-1:email:one",
      providerMessageId: "gmail-message-eben",
    }), now)).resolves.toMatchObject({ providerMessageId: "gmail-message-eben" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_provider_submissions").get().count).toBe(1);
    await expect(recordGmailProviderSubmission(db, submission({ mailboxActor: "Eben" }), now))
      .rejects.toThrow("exact owned Amari mailbox");
    await expect(recordGmailProviderSubmission(db, submission({ contactId: "missing-contact" }), now))
      .rejects.toThrow();
  });

  it("rejects unknown fields before storage", async () => {
    const { db, now } = fixture();
    await expect(recordGmailProviderSubmission(db, { ...submission(), forged: true }, now))
      .rejects.toThrow("unsupported Gmail submission fields");
  });
});
