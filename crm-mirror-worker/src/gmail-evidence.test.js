import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gmailEvidenceReadModel, recordGmailEvidence as ingestGmailEvidence } from "./gmail-evidence.js";

const MIGRATIONS = [
  "../migrations/0001_initial_schema.sql",
  "../migrations/0006_staff_communications.sql",
  "../migrations/0010_owned_sender_foundation.sql",
  "../migrations/0015_owned_communication_commands.sql",
  "../migrations/0016_gmail_provider_evidence.sql",
  "../migrations/0017_gmail_sync_gap_evidence.sql",
];

function d1(raw) {
  function statement(sql, values = []) {
    return {
      sql,
      values,
      bind(...next) { return statement(sql, next); },
      async first() { return raw.prepare(sql).get(...values) || null; },
      async all() { return { results: raw.prepare(sql).all(...values) }; },
      async run() {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes || 0) } };
      },
    };
  }
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const relative of MIGRATIONS) raw.exec(readFileSync(new URL(relative, import.meta.url), "utf8"));
  const now = "2026-08-08T18:00:00.000Z";
  raw.prepare(
    "INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("contact-1", "Surrina", "surrina@example.test", now, now);
  raw.prepare(
    `INSERT INTO outbound_delivery_attempts
     (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at,
      idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("cmd-1", "contact-1", "Eben", "email", "unassigned", "unknown", "eligible", "a".repeat(64), now,
    "desk:contact-1:email:one", "msg-1", "Checking in", "Private body", "off", "su***@example.test", "not_sent_delivery_unavailable");
  return { raw, db: d1(raw), now };
}

function seedProviderSubmission(raw, overrides = {}) {
  const submission = {
    id: "gmail-submission-1",
    mailboxActor: "Eben",
    grantOwner: "eben@amarimethod.com",
    submissionRef: "submission-1",
    contactId: "contact-1",
    providerMessageId: "gmail-message-1",
    gmailThreadId: "gmail-thread-1",
    rfcMessageId: "<outbound-1@amarimethod.com>",
    subject: "Checking in",
    body: "Private body",
    submittedAt: "2026-08-08T17:59:00.000Z",
    ...overrides,
  };
  raw.prepare(
    `INSERT INTO gmail_provider_submissions
     (id, mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id, gmail_thread_id,
      rfc_message_id, subject_clean, body_clean, submitted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(submission.id, submission.mailboxActor, submission.grantOwner, submission.submissionRef,
    submission.contactId, submission.providerMessageId, submission.gmailThreadId, submission.rfcMessageId,
    submission.subject, submission.body, submission.submittedAt, submission.submittedAt);
}

function providerEvidence(overrides = {}) {
  return {
    kind: "provider_outcome",
    mailboxActor: "Eben",
    grantOwner: "eben@amarimethod.com",
    providerEventId: "gmail-event-1",
    outcome: "accepted",
    providerMessageId: "gmail-message-1",
    gmailThreadId: "gmail-thread-1",
    rfcMessageId: "<outbound-1@amarimethod.com>",
    submissionRef: "submission-1",
    occurredAt: "2026-08-08T18:00:00.000Z",
    ...overrides,
  };
}

function inboundEvidence(overrides = {}) {
  return {
    kind: "inbound_message",
    mailboxActor: "Eben",
    grantOwner: "eben@amarimethod.com",
    providerMessageId: "gmail-inbound-1",
    gmailThreadId: "gmail-thread-1",
    rfcMessageId: "<inbound-1@example.test>",
    inReplyTo: "<outbound-1@amarimethod.com>",
    references: ["<older@amarimethod.com>", "<outbound-1@amarimethod.com>"],
    mailboxAddress: "eben@amarimethod.com",
    fromAddress: "surrina@example.test",
    toAddresses: ["eben@amarimethod.com"],
    subject: "Re: Checking in",
    body: "Thanks — I can make that time.",
    historyId: "900719925474099312345",
    receivedAt: "2026-08-08T18:05:00.000Z",
    ...overrides,
  };
}

// Tests model the future route boundary by extracting signed Staff/grant
// identity before handing the remaining provider evidence to the repository.
function recordGmailEvidence(db, input, now) {
  const { mailboxActor, grantOwner, ...evidence } = input;
  return ingestGmailEvidence(db, { mailboxActor, grantOwner }, evidence, now);
}

afterEach(() => vi.unstubAllGlobals());

describe("Gmail provider evidence", () => {
  it("records an exactly attributed acceptance without duplicating the submitted message in Communication", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network must stay disconnected"); }));

    await expect(recordGmailEvidence(db, providerEvidence(), now)).resolves.toEqual({
      kind: "provider_outcome",
      outcome: "accepted",
      contactId: "contact-1",
      attribution: "exact",
      deduped: false,
    });

    expect(raw.prepare("SELECT mailbox_actor, grant_owner, outcome, provider_message_id, gmail_thread_id, rfc_message_id, contact_id FROM gmail_provider_events").get())
      .toEqual({ mailbox_actor: "Eben", grant_owner: "eben@amarimethod.com", outcome: "accepted", provider_message_id: "gmail-message-1", gmail_thread_id: "gmail-thread-1", rfc_message_id: "<outbound-1@amarimethod.com>", contact_id: "contact-1" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not promote provider outcome history metadata to an inbox checkpoint", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);

    await recordGmailEvidence(db, providerEvidence({ historyId: "900719925474099312345" }), now);

    expect(raw.prepare("SELECT history_id FROM gmail_provider_events").get().history_id)
      .toBe("900719925474099312345");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(0);
  });

  it("records a missing provider message as idempotent append-only sync-gap review evidence", async () => {
    const { raw, db, now } = fixture();
    const context = { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" };
    const evidence = {
      kind: "gmail_message_missing",
      mailboxAddress: "eben@amarimethod.com",
      providerMessageId: "deleted-message-1",
      historyId: "900719925474099312345",
      reason: "provider_message_missing",
      observedAt: now,
    };

    await expect(ingestGmailEvidence(db, context, evidence, now)).resolves.toMatchObject({
      kind: "gmail_message_missing",
      providerMessageId: "deleted-message-1",
      historyId: "900719925474099312345",
      reason: "provider_message_missing",
      deduped: false,
    });
    await expect(ingestGmailEvidence(db, context, evidence, now)).resolves.toMatchObject({ deduped: true });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_sync_gap_reviews").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(0);
  });

  it("deduplicates identical provider evidence and rejects conflicting reuse", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence(), now);

    await expect(recordGmailEvidence(db, providerEvidence(), now)).resolves.toMatchObject({ deduped: true });
    await expect(recordGmailEvidence(db, providerEvidence({ outcome: "bounced" }), now))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_provider_events").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });

  it.each(["failed", "bounced"])("preserves the %s provider outcome as separate append-only evidence", async (outcome) => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence({
      providerEventId: `gmail-event-${outcome}`,
      outcome,
      failureCode: "provider_rejected",
      failureDetail: "Sanitized provider detail",
    }), now);

    expect(raw.prepare("SELECT outcome, failure_code, failure_detail_clean FROM gmail_provider_events").get())
      .toEqual({ outcome, failure_code: "provider_rejected", failure_detail_clean: "Sanitized provider detail" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });

  it("never treats the current not-sent command ledger as proof of Gmail submission", async () => {
    const { raw, db, now } = fixture();
    const batch = vi.spyOn(db, "batch");
    const result = await recordGmailEvidence(db, providerEvidence({
      providerEventId: "gmail-event-unmatched",
      submissionRef: "msg-1",
    }), now);

    expect(result).toMatchObject({ contactId: null, attribution: "review", deduped: false });
    expect(raw.prepare("SELECT reason FROM gmail_evidence_reviews").get().reason).toBe("unmatched_provider_submission_ref");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("routes provider identifiers that conflict with a submission proof to review", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    const result = await recordGmailEvidence(db, providerEvidence({ providerMessageId: "different-message" }), now);

    expect(result).toMatchObject({ contactId: null, attribution: "review" });
    expect(raw.prepare("SELECT reason FROM gmail_evidence_reviews").get().reason).toBe("conflicting_submission_evidence");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });

  it("attributes an inbound reply without promoting its history ID to an authoritative checkpoint", async () => {
    const { raw, db, now } = fixture();
    const batch = vi.spyOn(db, "batch");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network must stay disconnected"); }));
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence(), now);

    await expect(recordGmailEvidence(db, inboundEvidence(), now)).resolves.toEqual({
      kind: "inbound_message",
      contactId: "contact-1",
      attribution: "rfc_reply",
      deduped: false,
    });
    expect(raw.prepare(
      `SELECT mailbox_actor, grant_owner, provider_message_id, gmail_thread_id, rfc_message_id,
              in_reply_to, references_json, history_id, contact_id, attribution_basis
         FROM gmail_inbound_messages`,
    ).get()).toEqual({
      mailbox_actor: "Eben",
      grant_owner: "eben@amarimethod.com",
      provider_message_id: "gmail-inbound-1",
      gmail_thread_id: "gmail-thread-1",
      rfc_message_id: "<inbound-1@example.test>",
      in_reply_to: "<outbound-1@amarimethod.com>",
      references_json: JSON.stringify(["<older@amarimethod.com>", "<outbound-1@amarimethod.com>"]),
      history_id: "900719925474099312345",
      contact_id: "contact-1",
      attribution_basis: "rfc_reply",
    });
    expect(raw.prepare("SELECT provider_thread_id, unread_inbound_count FROM communication_threads WHERE provider = 'gmail'").get())
      .toEqual({ provider_thread_id: "eben@amarimethod.com:gmail-thread-1", unread_inbound_count: 1 });
    expect(raw.prepare("SELECT direction, provider_event_id FROM communication_events WHERE provider = 'gmail' AND direction = 'inbound'").get())
      .toEqual({ direction: "inbound", provider_event_id: "eben@amarimethod.com:gmail-inbound-1" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1][0]).toHaveLength(3);
  });

  it("attributes an early reply from immutable submission proof before outcome ingestion", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);

    await expect(recordGmailEvidence(db, inboundEvidence(), now)).resolves.toMatchObject({
      contactId: "contact-1",
      attribution: "rfc_reply",
    });
  });

  it("deduplicates identical inbound messages and rejects conflicting provider-message reuse", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence(), now);
    await recordGmailEvidence(db, inboundEvidence(), now);

    await expect(recordGmailEvidence(db, inboundEvidence(), now)).resolves.toMatchObject({ deduped: true });
    await expect(recordGmailEvidence(db, inboundEvidence({ body: "Different body" }), now))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_inbound_messages").get().count).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail' AND direction = 'inbound'").get().count).toBe(1);
  });

  it("uses a unique normalized sender only when no stronger reply or thread evidence exists", async () => {
    const { raw, db, now } = fixture();
    const result = await recordGmailEvidence(db, inboundEvidence({
      gmailThreadId: "brand-new-thread",
      inReplyTo: null,
      references: [],
      fromAddress: "Surrina <surrina@example.test>",
    }), now);

    expect(result).toMatchObject({ contactId: "contact-1", attribution: "unique_sender" });
    expect(raw.prepare("SELECT from_address, attribution_basis FROM gmail_inbound_messages").get())
      .toEqual({ from_address: "surrina@example.test", attribution_basis: "unique_sender" });
  });

  it("keeps an ambiguous sender in review and out of Communication", async () => {
    const { raw, db, now } = fixture();
    raw.prepare("INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("contact-2", "Other Surrina", "surrina@example.test", now, now);

    const result = await recordGmailEvidence(db, inboundEvidence({
      gmailThreadId: "brand-new-thread",
      inReplyTo: null,
      references: [],
    }), now);

    expect(result).toMatchObject({ contactId: null, attribution: "review" });
    expect(raw.prepare("SELECT reason, candidate_contact_ids_json FROM gmail_evidence_reviews").get())
      .toEqual({ reason: "ambiguous_contact", candidate_contact_ids_json: JSON.stringify(["contact-1", "contact-2"]) });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });

  it("keeps conflicting RFC and thread evidence in review", async () => {
    const { raw, db, now } = fixture();
    raw.prepare("INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("contact-2", "Second client", "second@example.test", now, now);
    raw.prepare(
      `INSERT INTO outbound_delivery_attempts
       (id, contact_id, actor, channel, provider, consent_state, policy_state, content_sha256, created_at,
        idempotency_key, message_ref, subject_clean, body_clean, dnd_state, destination_masked, delivery_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("cmd-2", "contact-2", "Eben", "email", "unassigned", "unknown", "eligible", "b".repeat(64), now,
      "desk:contact-2:email:two", "msg-2", "Other", "Other body", "off", "se***@example.test", "not_sent_delivery_unavailable");
    seedProviderSubmission(raw);
    seedProviderSubmission(raw, {
      id: "gmail-submission-2",
      submissionRef: "submission-2",
      contactId: "contact-2",
      providerMessageId: "gmail-message-2",
      rfcMessageId: "<outbound-2@amarimethod.com>",
      subject: "Other",
      body: "Other body",
    });
    await recordGmailEvidence(db, providerEvidence(), now);
    await recordGmailEvidence(db, providerEvidence({
      providerEventId: "gmail-event-2",
      providerMessageId: "gmail-message-2",
      rfcMessageId: "<outbound-2@amarimethod.com>",
      submissionRef: "submission-2",
    }), now);

    const result = await recordGmailEvidence(db, inboundEvidence({
      inReplyTo: "<outbound-2@amarimethod.com>",
      references: ["<outbound-2@amarimethod.com>"],
    }), now);

    expect(result).toMatchObject({ contactId: null, attribution: "review" });
    expect(raw.prepare("SELECT reason FROM gmail_evidence_reviews").get().reason).toBe("conflicting_thread_evidence");
  });

  it("keeps a unique sender that conflicts with RFC evidence in review", async () => {
    const { raw, db, now } = fixture();
    raw.prepare("INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("contact-2", "Second client", "second@example.test", now, now);
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence(), now);

    const result = await recordGmailEvidence(db, inboundEvidence({ fromAddress: "second@example.test" }), now);

    expect(result).toMatchObject({ contactId: null, attribution: "review" });
    expect(raw.prepare("SELECT reason, candidate_contact_ids_json FROM gmail_evidence_reviews").get())
      .toEqual({ reason: "conflicting_thread_evidence", candidate_contact_ids_json: JSON.stringify(["contact-1", "contact-2"]) });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });

  it("scopes provider IDs, message IDs, and history cursors by grant owner", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    seedProviderSubmission(raw, {
      id: "gmail-submission-garrett",
      mailboxActor: "Garrett",
      grantOwner: "garrett@amarimethod.com",
    });
    await recordGmailEvidence(db, providerEvidence(), now);
    await recordGmailEvidence(db, providerEvidence({ mailboxActor: "Garrett", grantOwner: "garrett@amarimethod.com" }), now);
    await recordGmailEvidence(db, {
      kind: "history_observation", mailboxActor: "Eben", grantOwner: "eben@amarimethod.com",
      mailboxAddress: "eben@amarimethod.com", historyId: "999", observedAt: now,
    }, now);
    await recordGmailEvidence(db, {
      kind: "history_observation", mailboxActor: "Garrett", grantOwner: "garrett@amarimethod.com",
      mailboxAddress: "garrett@amarimethod.com", historyId: "999", observedAt: now,
    }, now);

    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_provider_events").get().count).toBe(2);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(2);
  });

  it("returns a bounded evidence read model with the exact latest big-integer cursor per mailbox", async () => {
    const { raw, db, now } = fixture();
    seedProviderSubmission(raw);
    await recordGmailEvidence(db, providerEvidence(), now);
    for (const cursor of ["9", "100", "900719925474099312345"]) {
      await recordGmailEvidence(db, {
        kind: "history_observation", mailboxActor: "Eben", grantOwner: "eben@amarimethod.com",
        mailboxAddress: "eben@amarimethod.com", historyId: cursor, observedAt: now,
      }, now);
    }

    const model = await gmailEvidenceReadModel(db, { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com", limit: 999 });
    expect(model.limit).toBe(50);
    expect(model.providerEvents).toHaveLength(1);
    expect(model.latestHistory).toEqual([
      expect.objectContaining({ mailbox_actor: "Eben", grant_owner: "eben@amarimethod.com", history_id: "900719925474099312345" }),
    ]);
  });

  it("rejects caller-supplied attribution and credential-like fields", async () => {
    const { db, now } = fixture();
    await expect(recordGmailEvidence(db, { ...inboundEvidence(), contactId: "contact-1" }, now))
      .rejects.toMatchObject({ code: "unsupported_fields" });
    await expect(recordGmailEvidence(db, { ...providerEvidence(), accessToken: "secret" }, now))
      .rejects.toMatchObject({ code: "unsupported_fields" });
    const { mailboxActor, grantOwner, ...provider } = providerEvidence();
    await expect(ingestGmailEvidence(db, { mailboxActor, grantOwner }, { ...provider, mailboxActor }, now))
      .rejects.toMatchObject({ code: "unsupported_fields" });
  });

  it("rejects cross-wired actors, grant owners, and mailbox addresses", async () => {
    const { db, now } = fixture();
    await expect(recordGmailEvidence(db, providerEvidence({
      mailboxActor: "Eben",
      grantOwner: "garrett@amarimethod.com",
    }), now)).rejects.toThrow(/do not match/);
    await expect(recordGmailEvidence(db, inboundEvidence({
      mailboxAddress: "garrett@amarimethod.com",
    }), now)).rejects.toThrow(/must equal grantOwner/);
  });
});
