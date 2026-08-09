import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { gmailEvidenceReadModel, recordGmailEvidence } from "./gmail-evidence.js";
import { syncGmailReplies } from "./gmail-reply-sync.js";

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
    `INSERT INTO gmail_provider_submissions
     (id, mailbox_actor, grant_owner, submission_ref, contact_id, provider_message_id, gmail_thread_id,
      rfc_message_id, subject_clean, body_clean, submitted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("submission-row-1", "Eben", "eben@amarimethod.com", "submission-1", "contact-1",
    "outbound-provider-1", "thread-1", "<outbound-1@amarimethod.com>", "Checking in", "Hello", now, now);
  return { raw, db: d1(raw), now };
}

async function checkpoint(db, historyId, now) {
  return recordGmailEvidence(db, { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" }, {
    kind: "history_observation",
    mailboxAddress: "eben@amarimethod.com",
    historyId,
    observedAt: now,
  }, now);
}

function gmailMessage(overrides = {}) {
  return {
    id: "inbound-1",
    threadId: "thread-1",
    labelIds: ["INBOX", "UNREAD"],
    internalDate: "1786212300000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Surrina <surrina@example.test>" },
        { name: "To", value: "Eben <eben@amarimethod.com>" },
        { name: "Subject", value: "Re: Checking in" },
        { name: "Message-ID", value: "<inbound-1@example.test>" },
        { name: "In-Reply-To", value: "<outbound-1@amarimethod.com>" },
        { name: "References", value: "<older@amarimethod.com> <outbound-1@amarimethod.com>" },
      ],
      body: { data: Buffer.from("Thanks, I can make that time.").toString("base64url") },
    },
    ...overrides,
  };
}

function provider(overrides = {}) {
  return {
    mailboxContext: { mailboxActor: "Eben", grantOwner: "eben@amarimethod.com" },
    listHistoryPage: vi.fn().mockResolvedValue({
      history: [{ id: "101", messagesAdded: [{ message: { id: "inbound-1" } }] }],
    }),
    getMessage: vi.fn().mockResolvedValue(gmailMessage()),
    ...overrides,
  };
}

describe("Gmail reply synchronization", () => {
  it("requires an explicit baseline before it reads Gmail history", async () => {
    const { db, now } = fixture();
    const gmail = provider();

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toEqual({
      status: "baseline_required",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: null,
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
    });
    expect(gmail.listHistoryPage).not.toHaveBeenCalled();
    expect(gmail.getMessage).not.toHaveBeenCalled();
  });

  it("reports an expired Gmail history cursor without moving the checkpoint", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider({
      listHistoryPage: vi.fn().mockRejectedValue(Object.assign(
        new Error("Gmail history cursor expired"), { code: "history_cursor_expired", retryable: false },
      )),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toEqual({
      status: "recovery_required",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: "100",
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      error: { code: "history_cursor_expired", message: "Gmail history cursor expired" },
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(1);
  });

  it("checkpoints the terminal Gmail high-water when the filtered history response is empty", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [], historyId: "150" }),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toEqual({
      status: "succeeded",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: "150",
      counts: { historyRecords: 0, messages: 0, accepted: 0, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
    });
    expect(gmail.getMessage).not.toHaveBeenCalled();
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("150");
  });

  it("advances to the terminal Gmail high-water after the last returned record succeeds", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({
        history: [{ id: "101", messagesAdded: [{ message: { id: "inbound-1" } }] }],
        historyId: "150",
      }),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "150",
      counts: { historyRecords: 1, messages: 1, accepted: 1 },
    });
    expect(raw.prepare("SELECT history_id FROM gmail_inbound_messages").get().history_id).toBe("101");
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("150");
  });

  it("durably reviews a message deleted between history and get, then advances after later replies", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [{
        id: "101",
        messagesAdded: [{ message: { id: "deleted-1" } }, { message: { id: "inbound-1" } }],
      }] }),
      getMessage: vi.fn(async (id) => {
        if (id === "deleted-1") {
          throw Object.assign(new Error("Gmail message no longer exists"), { code: "gmail_message_missing" });
        }
        return gmailMessage();
      }),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "101",
      counts: { historyRecords: 1, messages: 2, accepted: 1, reviewed: 1, skipped: 1 },
    });
    expect(raw.prepare(
      `SELECT mailbox_actor, grant_owner, mailbox_address, provider_message_id, history_id, reason
         FROM gmail_sync_gap_reviews`,
    ).get()).toEqual({
      mailbox_actor: "Eben",
      grant_owner: "eben@amarimethod.com",
      mailbox_address: "eben@amarimethod.com",
      provider_message_id: "deleted-1",
      history_id: "101",
      reason: "provider_message_missing",
    });
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("101");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_inbound_messages").get().count).toBe(1);
  });

  it("records one exact reply and checkpoints its complete history record", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider();

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toEqual({
      status: "succeeded",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: "101",
      counts: { historyRecords: 1, messages: 1, accepted: 1, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
    });

    expect(gmail.listHistoryPage).toHaveBeenCalledWith({ startHistoryId: "100", pageToken: null, maxResults: 50 });
    expect(gmail.getMessage).toHaveBeenCalledWith("inbound-1");
    expect(raw.prepare("SELECT contact_id, history_id FROM gmail_inbound_messages").get())
      .toEqual({ contact_id: "contact-1", history_id: "101" });
    expect(raw.prepare(
      "SELECT history_id FROM gmail_history_observations ORDER BY length(history_id) DESC, history_id DESC LIMIT 1",
    ).get().history_id).toBe("101");
  });

  it("paginates, orders decimal history IDs above 2^53, and de-duplicates repeated records and messages", async () => {
    const { raw, db, now } = fixture();
    const start = "900719925474099300000";
    const first = "900719925474099300001";
    const second = "900719925474099300010";
    const third = "900719925474099400000";
    await checkpoint(db, start, now);
    const secondMessage = gmailMessage({ id: "inbound-2" });
    secondMessage.payload.headers = secondMessage.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-2@example.test>" } : header);
    const listHistoryPage = vi.fn()
      .mockResolvedValueOnce({
        history: [
          { id: second, messagesAdded: [{ message: { id: "inbound-1" } }] },
          { id: first, messagesAdded: [{ message: { id: "inbound-1" } }] },
          { id: first, messagesAdded: [{ message: { id: "inbound-1" } }] },
        ],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        history: [
          { id: third, messagesAdded: [{ message: { id: "inbound-2" } }] },
          { id: second, messagesAdded: [{ message: { id: "inbound-1" } }] },
        ],
      });
    const gmail = provider({
      listHistoryPage,
      getMessage: vi.fn(async (id) => id === "inbound-1" ? gmailMessage() : secondMessage),
    });

    await expect(syncGmailReplies({ db, provider: gmail, maxHistoryRecords: 10, now })).resolves.toEqual({
      status: "succeeded",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: third,
      counts: { historyRecords: 3, messages: 2, accepted: 2, reviewed: 0, skipped: 0, ignored: 0, deduped: 3 },
    });
    expect(listHistoryPage).toHaveBeenNthCalledWith(1, { startHistoryId: start, pageToken: null, maxResults: 10 });
    expect(listHistoryPage).toHaveBeenNthCalledWith(2, { startHistoryId: start, pageToken: "page-2", maxResults: 10 });
    expect(gmail.getMessage).toHaveBeenCalledTimes(2);
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe(third);
  });

  it("returns partial only between history records when the history bound is reached", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const second = gmailMessage({ id: "inbound-2" });
    second.payload.headers = second.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-2@example.test>" } : header);
    const third = gmailMessage({ id: "inbound-3" });
    third.payload.headers = third.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-3@example.test>" } : header);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [
        { id: "101", messagesAdded: [{ message: { id: "inbound-1" } }] },
        { id: "102", messagesAdded: [{ message: { id: "inbound-2" } }] },
        { id: "103", messagesAdded: [{ message: { id: "inbound-3" } }] },
      ], historyId: "999" }),
      getMessage: vi.fn(async (id) => ({ "inbound-1": gmailMessage(), "inbound-2": second, "inbound-3": third })[id]),
    });

    await expect(syncGmailReplies({ db, provider: gmail, maxHistoryRecords: 2, now })).resolves.toMatchObject({
      status: "partial",
      cursor: "102",
      counts: { historyRecords: 2, messages: 2, accepted: 2 },
    });
    expect(gmail.getMessage).toHaveBeenCalledTimes(2);
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("102");
  });

  it("finishes one bounded history record atomically before applying the message bound", async () => {
    const { db, now } = fixture();
    await checkpoint(db, "100", now);
    const second = gmailMessage({ id: "inbound-2" });
    second.payload.headers = second.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-2@example.test>" } : header);
    const third = gmailMessage({ id: "inbound-3" });
    third.payload.headers = third.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-3@example.test>" } : header);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [
        { id: "101", messagesAdded: [{ message: { id: "inbound-1" } }, { message: { id: "inbound-2" } }] },
        { id: "102", messagesAdded: [{ message: { id: "inbound-3" } }] },
      ] }),
      getMessage: vi.fn(async (id) => ({ "inbound-1": gmailMessage(), "inbound-2": second, "inbound-3": third })[id]),
    });

    await expect(syncGmailReplies({ db, provider: gmail, maxMessages: 1, now })).resolves.toMatchObject({
      status: "partial",
      cursor: "101",
      counts: { historyRecords: 1, messages: 2, accepted: 2 },
    });
    expect(gmail.getMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores DRAFT, SENT, and self-originated messages while checkpointing the complete record", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const draft = gmailMessage({ id: "draft-1", labelIds: ["DRAFT"] });
    const sent = gmailMessage({ id: "sent-1", labelIds: ["SENT"] });
    const own = gmailMessage({ id: "own-1", labelIds: ["INBOX"] });
    own.payload.headers = own.payload.headers.map((header) =>
      header.name.toLowerCase() === "from" ? { ...header, value: "Eben <EBEN@AMARIMETHOD.COM>" } : header);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [{
        id: "101",
        messagesAdded: [
          { message: { id: "draft-1" } }, { message: { id: "sent-1" } }, { message: { id: "own-1" } },
        ],
      }] }),
      getMessage: vi.fn(async (id) => ({ "draft-1": draft, "sent-1": sent, "own-1": own })[id]),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "101",
      counts: { historyRecords: 1, messages: 3, accepted: 0, reviewed: 0, ignored: 3, deduped: 0 },
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_inbound_messages").get().count).toBe(0);
  });

  it("normalizes case-insensitive headers, To and Cc address lists, and nested MIME text without inventing time", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const body = "Thanks — yes, that works.";
    const message = {
      id: "inbound-mime",
      threadId: "thread-1",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "fRoM", value: "\"Surrina, Client\" <surrina@example.test>" },
          { name: "TO", value: "\"Forrest, Eben\" <eben@amarimethod.com>, Other <other@example.test>" },
          { name: "cC", value: "Garrett <garrett@amarimethod.com>" },
          { name: "SUBJECT", value: "Re: Checking in" },
          { name: "message-ID", value: "<mime@example.test>" },
          { name: "IN-reply-TO", value: "<outbound-1@amarimethod.com>" },
          { name: "references", value: "<old@example.test>\r\n\t<outbound-1@amarimethod.com>" },
          { name: "DATE", value: "Sat, 08 Aug 2026 11:05:00 -0700" },
        ],
        parts: [
          { mimeType: "text/html", body: { data: Buffer.from("<p>Wrong body</p>").toString("base64url") } },
          { mimeType: "multipart/mixed", parts: [
            { mimeType: "text/plain", body: { data: Buffer.from(body).toString("base64url") } },
          ] },
        ],
      },
    };

    await expect(syncGmailReplies({ db, provider: provider({
      getMessage: vi.fn().mockResolvedValue(message),
    }), now })).resolves.toMatchObject({ status: "succeeded", cursor: "101" });

    expect(raw.prepare(
      `SELECT from_address, to_addresses_json, rfc_message_id, in_reply_to, references_json,
              body_clean, received_at FROM gmail_inbound_messages`,
    ).get()).toEqual({
      from_address: "surrina@example.test",
      to_addresses_json: JSON.stringify(["eben@amarimethod.com", "other@example.test", "garrett@amarimethod.com"]),
      rfc_message_id: "<mime@example.test>",
      in_reply_to: "<outbound-1@amarimethod.com>",
      references_json: JSON.stringify(["<old@example.test>", "<outbound-1@amarimethod.com>"]),
      body_clean: body,
      received_at: "2026-08-08T18:05:00.000Z",
    });
  });

  it("uses a bounded clean Gmail snippet when no inline text body exists and ignores attachments", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const message = gmailMessage({ snippet: `  Short\n\t fallback ${"x".repeat(5000)}` });
    message.payload.mimeType = "multipart/mixed";
    message.payload.body = {};
    message.payload.parts = [
      { mimeType: "text/html", body: { data: Buffer.from("<p>HTML only</p>").toString("base64url") } },
      { mimeType: "application/pdf", filename: "private.pdf", body: { attachmentId: "attachment-1" } },
    ];

    await expect(syncGmailReplies({ db, provider: provider({
      getMessage: vi.fn().mockResolvedValue(message),
    }), now })).resolves.toMatchObject({ status: "succeeded", cursor: "101" });

    const stored = raw.prepare("SELECT body_clean FROM gmail_inbound_messages").get().body_clean;
    expect(stored.startsWith("Short fallback ")).toBe(true);
    expect(stored).toHaveLength(4000);
    expect(stored).not.toContain("private.pdf");
    expect(stored).not.toContain("attachment-1");
  });

  it("bounds oversized inline text, records a visible truncation review, and advances the cursor", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const message = gmailMessage();
    message.payload.body.data = Buffer.from("a".repeat(50050)).toString("base64url");
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({
        history: [{ id: "101", messagesAdded: [{ message: { id: "inbound-1" } }] }],
        historyId: "150",
      }),
      getMessage: vi.fn().mockResolvedValue(message),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "150",
      counts: { historyRecords: 1, messages: 1, accepted: 1, reviewed: 1, skipped: 0 },
    });
    expect(raw.prepare("SELECT length(body_clean) AS length FROM gmail_inbound_messages").get().length).toBe(50000);
    expect((await gmailEvidenceReadModel(db, {
      mailboxActor: "Eben", grantOwner: "eben@amarimethod.com", limit: 10,
    })).syncGaps).toEqual([
      expect.objectContaining({
        provider_message_id: "inbound-1",
        history_id: "101",
        reason: "body_truncated",
      }),
    ]);
  });

  it("requires trustworthy Gmail time metadata and leaves the record uncheckpointed when it is absent", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const missingTime = gmailMessage({ internalDate: undefined });

    await expect(syncGmailReplies({ db, provider: provider({
      getMessage: vi.fn().mockResolvedValue(missingTime),
    }), now })).resolves.toMatchObject({
      status: "recovery_required",
      cursor: "100",
      counts: { historyRecords: 0, messages: 1 },
      error: { code: "missing_received_at", messageId: "inbound-1", historyId: "101" },
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_inbound_messages").get().count).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(1);
  });

  it("returns recovery before fetching or checkpointing an oversized history record", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({ history: [{
        id: "101",
        messagesAdded: Array.from({ length: 501 }, (_, index) => ({ message: { id: `message-${index}` } })),
      }] }),
    });

    await expect(syncGmailReplies({ db, provider: gmail, maxMessages: 1, now })).resolves.toMatchObject({
      status: "recovery_required",
      cursor: "100",
      counts: { historyRecords: 0, messages: 0 },
      error: { code: "history_record_too_large", historyId: "101" },
    });
    expect(gmail.getMessage).not.toHaveBeenCalled();
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_history_observations").get().count).toBe(1);
  });

  it("rejects a cross-wired actor and mailbox owner before any Gmail read", async () => {
    const { db, now } = fixture();
    const gmail = provider({
      mailboxContext: { mailboxActor: "Eben", grantOwner: "garrett@amarimethod.com" },
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).rejects.toThrow(/identity is invalid/);
    expect(gmail.listHistoryPage).not.toHaveBeenCalled();
    expect(gmail.getMessage).not.toHaveBeenCalled();
  });

  it("stays dormant and imports no provider adapter, send path, or GHL integration", () => {
    const source = readFileSync(new URL("./gmail-reply-sync.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(?:gmail-reply-provider|\/gmail\.js|ghl)[^"']*["']/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("leaves a failed multi-message record uncheckpointed and replays it idempotently", async () => {
    const { raw, db, now } = fixture();
    await checkpoint(db, "100", now);
    const second = gmailMessage({ id: "inbound-2" });
    second.payload.headers = second.payload.headers.map((header) =>
      header.name.toLowerCase() === "message-id" ? { ...header, value: "<inbound-2@example.test>" } : header);
    const gmail = provider({
      listHistoryPage: vi.fn().mockResolvedValue({
        history: [{ id: "101", messagesAdded: [
          { message: { id: "inbound-1" } }, { message: { id: "inbound-2" } },
        ] }],
      }),
      getMessage: vi.fn()
        .mockResolvedValueOnce(gmailMessage())
        .mockRejectedValueOnce(Object.assign(new Error("temporary Gmail read failure"), { code: "gmail_unavailable" }))
        .mockResolvedValueOnce(gmailMessage())
        .mockResolvedValueOnce(second),
    });

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toEqual({
      status: "recovery_required",
      actor: "Eben",
      owner: "eben@amarimethod.com",
      cursor: "100",
      counts: { historyRecords: 0, messages: 1, accepted: 1, reviewed: 0, skipped: 0, ignored: 0, deduped: 0 },
      error: { code: "gmail_unavailable", message: "temporary Gmail read failure", messageId: "inbound-2", historyId: "101" },
    });
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("100");

    await expect(syncGmailReplies({ db, provider: gmail, now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "101",
      counts: { historyRecords: 1, messages: 2, accepted: 2, reviewed: 0, ignored: 0, deduped: 1 },
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM gmail_inbound_messages").get().count).toBe(2);
    expect(raw.prepare("SELECT history_id FROM gmail_history_observations ORDER BY rowid DESC LIMIT 1").get().history_id)
      .toBe("101");
  });

  it("routes ambiguous inbound evidence to review and still checkpoints the complete record", async () => {
    const { raw, db, now } = fixture();
    raw.prepare("INSERT INTO contacts (id, display_name, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("contact-2", "Other Surrina", "surrina@example.test", now, now);
    await checkpoint(db, "100", now);
    const ambiguous = gmailMessage({ threadId: "new-thread" });
    ambiguous.payload.headers = ambiguous.payload.headers.filter((header) =>
      !["in-reply-to", "references"].includes(header.name.toLowerCase()));

    await expect(syncGmailReplies({ db, provider: provider({
      getMessage: vi.fn().mockResolvedValue(ambiguous),
    }), now })).resolves.toMatchObject({
      status: "succeeded",
      cursor: "101",
      counts: { historyRecords: 1, messages: 1, accepted: 0, reviewed: 1, ignored: 0, deduped: 0 },
    });
    expect(raw.prepare("SELECT reason FROM gmail_evidence_reviews").get().reason).toBe("ambiguous_contact");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM communication_events WHERE provider = 'gmail'").get().count).toBe(0);
  });
});
