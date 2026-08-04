import { describe, expect, it, vi } from "vitest";

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
  ensureCommunicationThread: vi.fn(),
  fetchGhlAppointmentsForContact: vi.fn(),
  fetchGhlContact: vi.fn(async (_env, id) => ({ externalId: id })),
  fetchGhlContactNotes: vi.fn(async (_env, id) => id === "contact_1" ? [{ externalId: "note_1" }] : [{ externalId: "note_2" }]),
  fetchGhlContactTasks: vi.fn(async (_env, id) => id === "contact_1" ? [{ externalId: "task_1" }] : []),
  fetchGhlContactsPage: vi.fn(),
  fetchGhlConversationMessages: vi.fn(),
  fetchGhlConversationsPage: vi.fn(),
  fetchGhlMessageExport: vi.fn(),
  fetchStripeChargesPage: vi.fn(),
  fetchStripeInvoicesPage: vi.fn(async () => ({ invoices: [{ externalId: "in_1" }], nextCursor: null })),
  fetchStripeCustomer: vi.fn(),
  writeOpsLastRun: vi.fn(),
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
}));
vi.mock("./providers.js", () => ({
  fetchGhlAppointmentsForContact: mocks.fetchGhlAppointmentsForContact, fetchGhlContact: mocks.fetchGhlContact,
  fetchGhlContactNotes: mocks.fetchGhlContactNotes, fetchGhlContactTasks: mocks.fetchGhlContactTasks,
  fetchGhlContactsPage: mocks.fetchGhlContactsPage, fetchGhlConversationMessages: mocks.fetchGhlConversationMessages,
  fetchGhlConversationsPage: mocks.fetchGhlConversationsPage, fetchGhlMessageExport: mocks.fetchGhlMessageExport,
  fetchStripeChargesPage: mocks.fetchStripeChargesPage, fetchStripeInvoicesPage: mocks.fetchStripeInvoicesPage, fetchStripeCustomer: mocks.fetchStripeCustomer,
}));
vi.mock("./normalizers.js", () => ({
  normalizeGhlAppointment: (value) => value, normalizeGhlContact: (value) => value,
  normalizeGhlConversation: (value) => value, normalizeGhlMessage: (value) => value,
  normalizeGhlNote: (value) => value, normalizeGhlTask: (value) => value, nativeBookingConsentObservations: () => [],
  normalizeStripeCharge: (value) => value, normalizeStripeInvoice: (value) => value, normalizedEmail: (value) => value,
}));
vi.mock("../../functions/lib/ops-last-run.js", () => ({
  writeOpsLastRun: mocks.writeOpsLastRun, OPS_LAST_RUN_KEYS: { crmMirror: "crm" },
}));

import { backfillGhlClientRecords, syncStripeInvoices } from "./sync.js";

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
