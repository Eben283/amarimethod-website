import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginSyncRun: vi.fn(async () => "run_1"),
  finishSyncRun: vi.fn(async () => {}),
  findContactIdByGhlId: vi.fn(),
  getSyncCursor: vi.fn(async () => null),
  listGhlContactExternalIds: vi.fn(async () => ["contact_1", "contact_2"]),
  setSyncCursor: vi.fn(async () => {}),
  upsertGhlAppointment: vi.fn(),
  upsertGhlContact: vi.fn(async (_db, contact) => `owned_${contact.externalId}`),
  upsertClientNote: vi.fn(async () => {}),
  upsertClientTask: vi.fn(async () => {}),
  recordConsentObservation: vi.fn(async () => ({ inserted: true })),
  backfillNativeBookingConsents: vi.fn(async () => ({ recordsRead: 0, recordsWritten: 0 })),
  upsertStripeCharge: vi.fn(),
  upsertStripeInvoice: vi.fn(async () => ({ linked: true })),
  upsertCommunicationEvent: vi.fn(),
  upsertCommunicationThread: vi.fn(),
  upsertGhlCommunicationSourceRecord: vi.fn(async () => true),
  listUnprojectedGhlCommunicationSourceRecords: vi.fn(async () => []),
  projectHistoricalGhlCommunicationEvent: vi.fn(async () => "thread_1"),
  ensureCommunicationThread: vi.fn(),
  deleteGhlEmailContainerEvent: vi.fn(async () => 0),
  fetchGhlAppointmentsForContact: vi.fn(),
  fetchGhlContact: vi.fn(async (_env, id) => ({ externalId: id })),
  fetchGhlContactNotes: vi.fn(async (_env, id) => id === "contact_1" ? [{ externalId: "note_1" }] : [{ externalId: "note_2" }]),
  fetchGhlContactTasks: vi.fn(async (_env, id) => id === "contact_1" ? [{ externalId: "task_1" }] : []),
  fetchGhlContactsPage: vi.fn(),
  fetchGhlConversationMessages: vi.fn(),
  fetchGhlConversationsPage: vi.fn(),
  fetchGhlEmail: vi.fn(),
  fetchGhlMessage: vi.fn(),
  fetchGhlMessageExport: vi.fn(),
  fetchStripeChargesPage: vi.fn(),
  fetchStripeInvoicesPage: vi.fn(async () => ({ invoices: [{ externalId: "in_1" }], nextCursor: null })),
  fetchStripeCustomer: vi.fn(),
  writeOpsLastRun: vi.fn(),
  dispatchOwnedAppointmentLifecycles: vi.fn(async () => ({ status: "succeeded", considered: 0, dispatched: 0, retryable: 0, manualReview: 0 })),
  dispatchOwnedQuizNurture: vi.fn(async () => ({ status: "succeeded", considered: 0, dispatched: 0, retryable: 0, manualReview: 0 })),
  dispatchOwnedEmails: vi.fn(async () => ({ status: "disabled", considered: 0, submitted: 0, retryable: 0, manualReview: 0 })),
}));

vi.mock("./repository.js", () => ({
  beginSyncRun: mocks.beginSyncRun, finishSyncRun: mocks.finishSyncRun,
  findContactIdByGhlId: mocks.findContactIdByGhlId, getSyncCursor: mocks.getSyncCursor,
  listGhlContactExternalIds: mocks.listGhlContactExternalIds, setSyncCursor: mocks.setSyncCursor,
  upsertGhlAppointment: mocks.upsertGhlAppointment, upsertGhlContact: mocks.upsertGhlContact,
  upsertClientNote: mocks.upsertClientNote, upsertClientTask: mocks.upsertClientTask,
  recordConsentObservation: mocks.recordConsentObservation, backfillNativeBookingConsents: mocks.backfillNativeBookingConsents,
  upsertStripeCharge: mocks.upsertStripeCharge, upsertStripeInvoice: mocks.upsertStripeInvoice, upsertCommunicationEvent: mocks.upsertCommunicationEvent,
  upsertCommunicationThread: mocks.upsertCommunicationThread, ensureCommunicationThread: mocks.ensureCommunicationThread,
  upsertGhlCommunicationSourceRecord: mocks.upsertGhlCommunicationSourceRecord,
  listUnprojectedGhlCommunicationSourceRecords: mocks.listUnprojectedGhlCommunicationSourceRecords,
  projectHistoricalGhlCommunicationEvent: mocks.projectHistoricalGhlCommunicationEvent,
  deleteGhlEmailContainerEvent: mocks.deleteGhlEmailContainerEvent,
}));
vi.mock("./providers.js", () => ({
  fetchGhlAppointmentsForContact: mocks.fetchGhlAppointmentsForContact, fetchGhlContact: mocks.fetchGhlContact,
  fetchGhlContactNotes: mocks.fetchGhlContactNotes, fetchGhlContactTasks: mocks.fetchGhlContactTasks,
  fetchGhlContactsPage: mocks.fetchGhlContactsPage, fetchGhlConversationMessages: mocks.fetchGhlConversationMessages,
  fetchGhlConversationsPage: mocks.fetchGhlConversationsPage, fetchGhlEmail: mocks.fetchGhlEmail, fetchGhlMessage: mocks.fetchGhlMessage, fetchGhlMessageExport: mocks.fetchGhlMessageExport,
  fetchStripeChargesPage: mocks.fetchStripeChargesPage, fetchStripeInvoicesPage: mocks.fetchStripeInvoicesPage, fetchStripeCustomer: mocks.fetchStripeCustomer,
}));
vi.mock("./normalizers.js", () => ({
  normalizeGhlAppointment: (value) => value, normalizeGhlContact: (value) => value,
  normalizeGhlConversation: (value) => value, normalizeGhlMessage: (value) => value?.type === "TYPE_INSTAGRAM" ? null : value,
  normalizeGhlNote: (value) => value, normalizeGhlTask: (value) => value, nativeBookingConsentObservations: () => [],
  normalizeStripeCharge: (value) => value, normalizeStripeInvoice: (value) => value, normalizedEmail: (value) => value,
}));
vi.mock("../../functions/lib/ops-last-run.js", () => ({
  writeOpsLastRun: mocks.writeOpsLastRun, OPS_LAST_RUN_KEYS: { crmMirror: "crm" },
}));
vi.mock("./appointment-lifecycle-dispatch.js", () => ({
  dispatchOwnedAppointmentLifecycles: mocks.dispatchOwnedAppointmentLifecycles,
}));
vi.mock("./quiz-nurture-dispatch.js", () => ({
  dispatchOwnedQuizNurture: mocks.dispatchOwnedQuizNurture,
}));
vi.mock("./owned-email-dispatch.js", () => ({
  dispatchOwnedEmails: mocks.dispatchOwnedEmails,
}));

import { backfillGhlClientRecords, backfillGhlMessageExport, projectGhlMessageArchive, runScheduledSync, SCHEDULED_SYNC_LANES, syncGhlConversations, syncRecentGhlConversations, syncStripeInvoices } from "./sync.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSyncCursor.mockReset().mockResolvedValue(null);
  mocks.fetchGhlMessageExport.mockReset();
  mocks.listUnprojectedGhlCommunicationSourceRecords.mockReset().mockResolvedValue([]);
});

describe("scheduled provider fairness", () => {
  it("rotates bounded lanes while retaining recent communication freshness", () => {
    expect(SCHEDULED_SYNC_LANES).toEqual([
      ["owned-appointment-lifecycles", "owned-quiz-nurture", "owned-email-dispatch", "ghl-conversations-recent", "ghl", "consents"],
      ["owned-appointment-lifecycles", "owned-quiz-nurture", "owned-email-dispatch", "ghl-conversations-recent", "stripe", "stripe-invoices", "ghl-message-export", "consents"],
      ["owned-appointment-lifecycles", "owned-quiz-nurture", "owned-email-dispatch", "ghl-conversations-recent", "ghl-message-projection", "ghl-conversations", "ghl-client-records", "consents"],
    ]);
  });

  it("keeps each cron pass inside its selected provider lane", async () => {
    const calls = [];
    mocks.fetchGhlContactsPage.mockImplementation(async () => {
      calls.push("ghl");
      return { contacts: [], nextCursor: null };
    });
    mocks.fetchStripeChargesPage.mockImplementation(async () => {
      calls.push("stripe");
      return { charges: [], nextCursor: null };
    });
    mocks.fetchStripeInvoicesPage.mockImplementation(async () => {
      calls.push("stripe-invoices");
      return { invoices: [], nextCursor: null };
    });
    mocks.fetchGhlConversationsPage.mockImplementation(async (_env, cursor) => {
      calls.push(cursor == null ? "ghl-conversations-recent" : "ghl-conversations");
      return { conversations: [], nextCursor: null };
    });
    mocks.fetchGhlMessageExport.mockImplementation(async (_env, options) => {
      calls.push(options.channel === "Email" ? "ghl-message-export-email" : "ghl-message-export-non-email");
      return { messages: [], nextCursor: null };
    });
    // Give the paginated conversation sweep a durable non-null cursor so the
    // test can distinguish it from the deliberately fresh recent window.
    mocks.getSyncCursor.mockImplementation(async (_db, key) => key === "ghl-conversations" ? "2026-08-20T00:00:00.000Z" : null);

    await runScheduledSync({ CRM_DB: {}, AUTOMATION_DB: {} }, "2026-08-29T08:15:00.000Z");
    expect(calls).toEqual(["ghl-conversations-recent", "ghl"]);

    calls.length = 0;
    await runScheduledSync({ CRM_DB: {}, AUTOMATION_DB: {} }, "2026-08-29T08:20:00.000Z");
    expect(calls).toEqual(["ghl-conversations-recent", "stripe", "stripe-invoices", "ghl-message-export-non-email", "ghl-message-export-email"]);

    calls.length = 0;
    await runScheduledSync({ CRM_DB: {}, AUTOMATION_DB: {} }, "2026-08-29T08:25:00.000Z");
    expect(calls).toEqual(["ghl-conversations-recent", "ghl-conversations"]);

    mocks.fetchGhlContactsPage.mockReset();
    mocks.fetchStripeChargesPage.mockReset();
    mocks.fetchStripeInvoicesPage.mockReset().mockResolvedValue({ invoices: [{ externalId: "in_1" }], nextCursor: null });
    mocks.fetchGhlConversationsPage.mockReset();
    mocks.getSyncCursor.mockReset().mockResolvedValue(null);

  });
});

describe("GHL source archive projection", () => {
  it("projects supported archived history without changing provider state", async () => {
    mocks.listUnprojectedGhlCommunicationSourceRecords.mockResolvedValue([
      { id: "email_1", conversationId: "thread_1", threadExternalId: "thread_1", contactId: "contact_1", contactExternalId: "contact_1", channel: "email", type: "TYPE_EMAIL", dateAdded: "2026-08-01T12:00:00.000Z", occurredAt: "2026-08-01T12:00:00.000Z", body: "Archived workflow email" },
    ]);
    mocks.findContactIdByGhlId.mockResolvedValue("owned_contact_1");

    await expect(projectGhlMessageArchive({ CRM_DB: {} }, 50, "2026-09-18T18:20:00.000Z"))
      .resolves.toMatchObject({ status: "succeeded", recordsRead: 1, recordsWritten: 1, recordsSkipped: 0 });
    expect(mocks.projectHistoricalGhlCommunicationEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: "email_1", conversationId: "thread_1", contactId: "contact_1" }),
      "owned_contact_1",
      "2026-09-18T18:20:00.000Z",
    );
    expect(mocks.fetchGhlMessageExport).not.toHaveBeenCalled();
  });

  it("leaves an unmatched contact retryable instead of inventing a Staff record", async () => {
    mocks.listUnprojectedGhlCommunicationSourceRecords.mockResolvedValue([
      { id: "sms_1", conversationId: "thread_1", threadExternalId: "thread_1", contactId: "unknown_contact", contactExternalId: "unknown_contact", channel: "sms", type: "TYPE_SMS", dateAdded: "2026-08-01T12:00:00.000Z", occurredAt: "2026-08-01T12:00:00.000Z", body: "Unknown" },
    ]);
    mocks.findContactIdByGhlId.mockResolvedValue(null);

    await expect(projectGhlMessageArchive({ CRM_DB: {} }, 50, "2026-09-18T18:20:00.000Z"))
      .resolves.toMatchObject({ status: "succeeded", recordsRead: 1, recordsWritten: 0, recordsSkipped: 1 });
    expect(mocks.projectHistoricalGhlCommunicationEvent).not.toHaveBeenCalled();
  });
});

describe("resumable GHL message export backfill", () => {
  it("walks separate non-email and email windows backward without persisting GHL's expiring cursor", async () => {
    mocks.getSyncCursor.mockImplementation(async (_db, key) => key === "ghl-message-export:non-email"
      ? JSON.stringify({ endDate: "2026-09-01T00:00:00.000Z" })
      : JSON.stringify({ endDate: "2026-08-15T00:00:00.000Z" }));
    mocks.fetchGhlMessageExport
      .mockResolvedValueOnce({ messages: [{ id: "sms_1", messageType: "TYPE_SMS", dateAdded: "2026-08-20T12:00:00.000Z" }], nextCursor: null })
      .mockResolvedValueOnce({ messages: [{ id: "email_1", messageType: "TYPE_EMAIL", dateAdded: "2026-08-02T12:00:00.000Z" }], nextCursor: null });

    const outcome = await backfillGhlMessageExport({ CRM_DB: {} }, { pages: 4, pageSize: 50 }, "2026-09-18T17:30:00.000Z");

    expect(mocks.fetchGhlMessageExport).toHaveBeenNthCalledWith(1, { CRM_DB: {} }, expect.objectContaining({
      channel: null,
      startDate: "2026-08-02T00:00:00.000Z",
      endDate: "2026-09-01T00:00:00.000Z",
      cursor: null,
    }));
    expect(mocks.fetchGhlMessageExport).toHaveBeenNthCalledWith(2, { CRM_DB: {} }, expect.objectContaining({
      channel: "Email",
      startDate: "2026-07-16T00:00:00.000Z",
      endDate: "2026-08-15T00:00:00.000Z",
      cursor: null,
    }));
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-message-export:non-email", JSON.stringify({ endDate: "2026-08-02T00:00:00.000Z" }), "2026-09-18T17:30:00.000Z");
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-message-export:email", JSON.stringify({ endDate: "2026-07-16T00:00:00.000Z" }), "2026-09-18T17:30:00.000Z");
    expect(mocks.upsertGhlCommunicationSourceRecord).toHaveBeenCalledTimes(2);
    expect(mocks.upsertCommunicationEvent).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "partial", recordsRead: 2, recordsWritten: 2 });
  });

  it("continues below the oldest archived row when a bounded window still has another page", async () => {
    mocks.getSyncCursor.mockImplementation(async (_db, key) => key === "ghl-message-export:email" ? "done" : null);
    mocks.fetchGhlMessageExport.mockResolvedValueOnce({
      messages: [
        { id: "sms_1", messageType: "TYPE_SMS", dateAdded: "2026-09-18T16:00:00.000Z" },
        { id: "sms_2", messageType: "TYPE_SMS", dateAdded: "2026-09-17T12:00:00.000Z" },
      ],
      nextCursor: "expires-soon",
    });

    const outcome = await backfillGhlMessageExport({ CRM_DB: {} }, { pages: 1, pageSize: 50 }, "2026-09-18T17:30:00.000Z");

    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-message-export:non-email", JSON.stringify({ endDate: "2026-09-17T12:00:00.001Z" }), "2026-09-18T17:30:00.000Z");
    expect(outcome.status).toBe("partial");
  });

  it("fails closed instead of skipping rows when a capped export cannot move below its saved boundary", async () => {
    mocks.getSyncCursor.mockImplementation(async (_db, key) => key === "ghl-message-export:email"
      ? "done"
      : JSON.stringify({ endDate: "2026-09-17T12:00:00.001Z" }));
    mocks.fetchGhlMessageExport.mockResolvedValueOnce({
      messages: [{ id: "sms_same_time", messageType: "TYPE_SMS", dateAdded: "2026-09-17T12:00:00.000Z" }],
      nextCursor: "expires-soon",
    });

    await expect(backfillGhlMessageExport({ CRM_DB: {} }, { pages: 1, pageSize: 50 }, "2026-09-18T17:30:00.000Z"))
      .rejects.toThrow("non-email message export did not advance");
    expect(mocks.setSyncCursor).not.toHaveBeenCalled();
  });

  it("marks both streams complete after their final floor-bounded windows", async () => {
    mocks.getSyncCursor.mockResolvedValue(JSON.stringify({ endDate: "2020-01-15T00:00:00.000Z" }));
    mocks.fetchGhlMessageExport.mockResolvedValue({ messages: [], nextCursor: null });

    const outcome = await backfillGhlMessageExport({ CRM_DB: {} }, { pages: 4, pageSize: 50 }, "2026-09-18T17:30:00.000Z");

    expect(mocks.fetchGhlMessageExport).toHaveBeenCalledTimes(2);
    expect(mocks.fetchGhlMessageExport).toHaveBeenNthCalledWith(1, { CRM_DB: {} }, expect.objectContaining({
      startDate: "2020-01-01T00:00:00.000Z",
      endDate: "2020-01-15T00:00:00.000Z",
    }));
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-message-export:non-email", "done", "2026-09-18T17:30:00.000Z");
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-message-export:email", "done", "2026-09-18T17:30:00.000Z");
    expect(outcome).toMatchObject({ status: "succeeded", cursorAfter: ["done", "done"] });
  });
});

describe("GHL conversation mirror cursor", () => {
  it("passes the durable GHL sort cursor through and persists the returned cursor", async () => {
    mocks.getSyncCursor.mockResolvedValueOnce("2026-07-17T18:03:00.000Z");
    mocks.fetchGhlConversationsPage.mockResolvedValueOnce({ conversations: [], nextCursor: null });

    const outcome = await syncGhlConversations({ CRM_DB: {} }, 50, "2026-08-20T22:15:00.000Z");

    expect(mocks.fetchGhlConversationsPage).toHaveBeenCalledWith({ CRM_DB: {} }, "2026-07-17T18:03:00.000Z", 50);
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-conversations", null, "2026-08-20T22:15:00.000Z");
    expect(outcome).toMatchObject({ status: "succeeded", cursorAfter: null });
  });
});

describe("recent GHL conversation freshness", () => {
  it("hydrates the newest provider message before writing the Staff timeline", async () => {
    mocks.fetchGhlConversationsPage.mockResolvedValueOnce({
      conversations: [{ externalId: "thread_1", contactExternalId: "contact_1" }], nextCursor: null,
    });
    mocks.findContactIdByGhlId.mockResolvedValueOnce("owned_contact_1");
    mocks.upsertCommunicationThread.mockResolvedValueOnce("owned_thread_1");
    const stale = { id: "message_1", externalId: "message_1", dateAdded: "2026-08-25T18:28:00.000Z", body: "stale body" };
    mocks.fetchGhlConversationMessages.mockResolvedValueOnce([stale]);
    mocks.fetchGhlMessage.mockResolvedValueOnce({ ...stale, body: "authoritative reply" });

    const outcome = await syncRecentGhlConversations({ CRM_DB: {} }, 10, "2026-08-25T19:00:00.000Z");

    expect(mocks.fetchGhlConversationsPage).toHaveBeenCalledWith({ CRM_DB: {} }, null, 10);
    expect(mocks.fetchGhlConversationMessages).toHaveBeenCalledWith({ CRM_DB: {} }, "thread_1", 20);
    expect(mocks.fetchGhlMessage).toHaveBeenCalledWith({ CRM_DB: {} }, "message_1");
    expect(mocks.upsertGhlCommunicationSourceRecord).toHaveBeenCalledWith({}, expect.objectContaining({ body: "authoritative reply" }), "2026-08-25T19:00:00.000Z", { threadExternalId: "thread_1", contactExternalId: "contact_1" });
    expect(mocks.upsertCommunicationEvent).toHaveBeenCalledWith({}, expect.objectContaining({ body: "authoritative reply" }), "owned_thread_1", "owned_contact_1", "2026-08-25T19:00:00.000Z");
    expect(outcome.status).toBe("succeeded");
  });

  it("archives an unsupported GHL message even when Staff cannot project it", async () => {
    mocks.fetchGhlConversationsPage.mockResolvedValueOnce({
      conversations: [{ externalId: "thread_1", contactExternalId: "contact_1" }], nextCursor: null,
    });
    mocks.findContactIdByGhlId.mockResolvedValueOnce("owned_contact_1");
    mocks.upsertCommunicationThread.mockResolvedValueOnce("owned_thread_1");
    const social = { id: "instagram_1", type: "TYPE_INSTAGRAM", conversationId: "thread_1", contactId: "contact_1" };
    mocks.fetchGhlConversationMessages.mockResolvedValueOnce([social]);
    mocks.fetchGhlMessage.mockResolvedValueOnce(social);

    await syncRecentGhlConversations({ CRM_DB: {} }, 10, "2026-09-18T10:00:00.000Z");

    expect(mocks.upsertGhlCommunicationSourceRecord).toHaveBeenCalledWith({}, social, "2026-09-18T10:00:00.000Z", { threadExternalId: "thread_1", contactExternalId: "contact_1" });
    expect(mocks.upsertCommunicationEvent).not.toHaveBeenCalled();
  });

  it("archives source messages before requiring an owned contact match", async () => {
    mocks.fetchGhlConversationsPage.mockResolvedValueOnce({
      conversations: [{ externalId: "thread_unmatched", contactExternalId: "contact_unmatched" }], nextCursor: null,
    });
    mocks.findContactIdByGhlId.mockResolvedValueOnce(null);
    const source = { id: "message_unmatched", type: "TYPE_SMS", conversationId: "thread_unmatched", contactId: "contact_unmatched" };
    mocks.fetchGhlConversationMessages.mockResolvedValueOnce([source]);
    mocks.fetchGhlMessage.mockResolvedValueOnce(source);

    await syncRecentGhlConversations({ CRM_DB: {} }, 10, "2026-09-18T10:00:00.000Z");

    expect(mocks.upsertGhlCommunicationSourceRecord).toHaveBeenCalledWith({}, source, "2026-09-18T10:00:00.000Z", { threadExternalId: "thread_unmatched", contactExternalId: "contact_unmatched" });
    expect(mocks.upsertCommunicationThread).not.toHaveBeenCalled();
    expect(mocks.upsertCommunicationEvent).not.toHaveBeenCalled();
  });

  it("expands a mutable GHL email container into immutable email revisions", async () => {
    mocks.fetchGhlConversationsPage.mockResolvedValueOnce({
      conversations: [{ externalId: "thread_1", contactExternalId: "contact_1" }], nextCursor: null,
    });
    mocks.findContactIdByGhlId.mockResolvedValueOnce("owned_contact_1");
    mocks.upsertCommunicationThread.mockResolvedValueOnce("owned_thread_1");
    mocks.fetchGhlConversationMessages.mockResolvedValueOnce([{
      id: "mutable_thread_message", type: "TYPE_EMAIL", dateAdded: "2026-08-25T20:20:00.000Z",
      meta: { email: { messageIds: ["email_inbound_1", "email_outbound_2"] } },
    }]);
    mocks.fetchGhlEmail
      .mockResolvedValueOnce({ id: "email_inbound_1", direction: "inbound", body: "Thanks, I found it.", dateAdded: "2026-08-25T18:28:00.000Z" })
      .mockResolvedValueOnce({ id: "email_outbound_2", direction: "outbound", body: "I will look into it.", dateAdded: "2026-08-25T20:20:00.000Z" });

    const outcome = await syncRecentGhlConversations({ CRM_DB: {} }, 10, "2026-08-25T21:00:00.000Z");

    expect(mocks.fetchGhlEmail).toHaveBeenNthCalledWith(1, { CRM_DB: {} }, "email_inbound_1");
    expect(mocks.fetchGhlEmail).toHaveBeenNthCalledWith(2, { CRM_DB: {} }, "email_outbound_2");
    expect(mocks.deleteGhlEmailContainerEvent).toHaveBeenCalledWith({}, "mutable_thread_message");
    expect(mocks.fetchGhlMessage).not.toHaveBeenCalledWith({ CRM_DB: {} }, "mutable_thread_message");
    expect(mocks.upsertCommunicationEvent).toHaveBeenCalledTimes(2);
    expect(mocks.upsertCommunicationEvent).toHaveBeenCalledWith({}, expect.objectContaining({ id: "email_inbound_1", body: "Thanks, I found it." }), "owned_thread_1", "owned_contact_1", "2026-08-25T21:00:00.000Z");
    expect(outcome.status).toBe("succeeded");
  });
});

describe("historic GHL client-record backfill", () => {
  it("refreshes source state and projects notes/tasks in a bounded resumable page", async () => {
    const outcome = await backfillGhlClientRecords({ CRM_DB: {} }, 50, "2026-08-02T19:00:00.000Z");
    expect(mocks.listGhlContactExternalIds).toHaveBeenCalledWith({}, null, 10);
    expect(mocks.fetchGhlContact).toHaveBeenCalledTimes(2);
    expect(mocks.fetchGhlContactNotes).toHaveBeenCalledTimes(2);
    expect(mocks.fetchGhlContactTasks).toHaveBeenCalledTimes(2);
    expect(mocks.upsertGhlContact).toHaveBeenCalledTimes(2);
    expect(mocks.upsertClientNote).toHaveBeenCalledTimes(2);
    expect(mocks.upsertClientTask).toHaveBeenCalledTimes(1);
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "ghl-client-records", "done", "2026-08-02T19:00:00.000Z");
    expect(outcome).toMatchObject({ status: "succeeded", recordsRead: 5, recordsWritten: 5, cursorAfter: "done" });
  });
});

describe("Stripe invoice mirror", () => {
  it("walks the independent invoice cursor and writes only owned invoice observations", async () => {
    const outcome = await syncStripeInvoices({ CRM_DB: {} }, 25, "2026-08-03T08:30:00.000Z");
    expect(mocks.fetchStripeInvoicesPage).toHaveBeenCalledWith({ CRM_DB: {} }, null, 25);
    expect(mocks.upsertStripeInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.setSyncCursor).toHaveBeenCalledWith({}, "stripe-invoices", null, "2026-08-03T08:30:00.000Z");
    expect(outcome).toMatchObject({ status: "succeeded", recordsRead: 1, recordsWritten: 1, recordsSkipped: 0 });
  });
});
