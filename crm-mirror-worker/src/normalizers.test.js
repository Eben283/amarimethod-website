import { describe, expect, it } from "vitest";
import {
  normalizeGhlAppointment,
  normalizeGhlContact,
  normalizeGhlConversation,
  normalizeGhlMessage,
  normalizeGhlNote,
  normalizeGhlTask,
  nativeBookingConsentObservations,
  normalizeStripeCharge,
  normalizeStripeInvoice,
  normalizedPhone,
} from "./normalizers.js";

describe("CRM mirror normalizers", () => {
  it("normalizes GHL inbox threads and strips markup for the owned timeline", () => {
    expect(normalizeGhlConversation({
      id: "thread_1", contactId: "contact_1", lastMessageType: "TYPE_EMAIL", lastMessageBody: "<p>Hello <strong>there</strong></p>",
      lastMessageDirection: "inbound", lastMessageDate: 1_700_000_000_000, unreadCount: 2,
    })).toMatchObject({ externalId: "thread_1", contactExternalId: "contact_1", channel: "email", lastPreview: "Hello there", lastDirection: "inbound", unreadInboundCount: 2 });
    expect(normalizeGhlMessage({ id: "message_1", type: 2, direction: 1, status: "received", body: "<b>Can we reschedule?</b>", dateAdded: "2026-08-02T10:00:00Z" }, "thread_1", "contact_1"))
      .toMatchObject({ externalId: "message_1", channel: "sms", direction: "inbound", body: "Can we reschedule?" });
  });

  it("normalizes a GHL contact without treating the pipeline as data", () => {
    expect(normalizeGhlContact({
      id: "ghl_1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: " ADA@example.com ",
      phone: "415 555 0100",
      tags: ["affiliate-partner", "affiliate-partner", " custom "],
      customFields: [{ key: "contact.study_name", value: "Elbow" }],
      source: "Referral",
      opportunities: [{ pipelineStageId: "stale" }],
    })).toEqual({
      externalId: "ghl_1",
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+14155550100",
      tags: ["affiliate-partner", "custom"],
      roles: ["affiliate_partner", "lead"],
      attributes: [["study_name", "Elbow"]],
      referralSourceLabel: "Referral",
    });
  });

  it("preserves source DND and follower state without treating it as consent", () => {
    expect(normalizeGhlContact({
      id: "ghl_2", firstName: "Ada", dndSettings: { Email: { status: "active" }, SMS: { status: "inactive" } }, followers: [],
    }).attributes).toEqual([["system.dnd", "email: on · sms: off"], ["system.followers", "None"]]);
  });

  it("normalizes appointment aliases and keeps unknown statuses visible", () => {
    expect(normalizeGhlAppointment({
      appointmentId: "appt_1",
      calendar: { id: "calendar_1" },
      status: "No-show",
      startAt: "2026-08-01T17:00:00.000Z",
      endAt: "2026-08-01T17:50:00.000Z",
      selectedTimezone: "America/Los_Angeles",
    }, "ghl_1")).toMatchObject({
      externalId: "appt_1",
      contactExternalId: "ghl_1",
      calendarId: "calendar_1",
      status: "no_show",
    });
  });

  it("normalizes notes and tasks into durable client-record shapes", () => {
    expect(normalizeGhlNote({ id: "note_1", body: "<p>Prefers afternoon appointments.</p>", userName: "Garrett", dateAdded: 1_700_000_000_000 }))
      .toMatchObject({ externalId: "note_1", body: "Prefers afternoon appointments.", authoredBy: "Garrett" });
    expect(normalizeGhlTask({ taskId: "task_1", title: "Call before next session", status: "completed", dueDate: "2026-08-05T17:00:00Z", completedAt: "2026-08-04T17:00:00Z" }))
      .toMatchObject({ externalId: "task_1", title: "Call before next session", status: "completed", dueAt: "2026-08-05T17:00:00Z" });
  });

  it("extracts only explicit native-booking communications choices", () => {
    expect(nativeBookingConsentObservations({ externalId: "note_1", createdAt: "2026-08-04T10:00:00Z", body: "Native booking flow\nCommunications consent: yes" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ channel: "email", state: "granted", source: "ghl_native_booking_note", evidenceRef: "note_1" }), expect.objectContaining({ channel: "sms", state: "granted", source: "ghl_native_booking_note", evidenceRef: "note_1" })]));
    expect(nativeBookingConsentObservations({ externalId: "note_2", body: "Native booking flow\nCommunications consent: no (optional, declined)" }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ channel: "email", state: "revoked" }), expect.objectContaining({ channel: "sms", state: "revoked" })]));
    expect(nativeBookingConsentObservations({ externalId: "note_3", body: "A client has an email address." })).toEqual([]);
  });

  it("imports only settled Stripe charges and never guesses unknown packages", () => {
    expect(normalizeStripeCharge({
      id: "ch_1", paid: true, status: "succeeded", amount: 72000, amount_refunded: 0,
      currency: "usd", description: "4-Session Series", customer: "cus_1", created: 1,
      billing_details: { email: " ADA@example.com " },
      metadata: { contactId: "ghl_1" },
    })).toMatchObject({
      externalId: "ch_1",
      contactExternalId: "ghl_1",
      billingEmail: "ada@example.com",
      packageId: "four-session-series",
      classification: "4-Session Series",
    });
    expect(normalizeStripeCharge({ id: "ch_2", paid: false, status: "failed" })).toBeNull();
    expect(normalizedPhone("not a phone")).toBe("not a phone");
  });

  it("normalizes Stripe invoices as record context without treating them as payments", () => {
    expect(normalizeStripeInvoice({
      id: "in_1", customer: "cus_1", payment_intent: "pi_1", number: "AMARI-001",
      description: "Practice membership", status: "open", collection_method: "send_invoice",
      amount_due: 34700, amount_paid: 0, amount_remaining: 34700, currency: "usd",
      created: 1_700_000_000, due_date: 1_700_086_400, metadata: { contactId: "ghl_1" },
    })).toMatchObject({
      externalId: "in_1", contactExternalId: "ghl_1", customerExternalId: "cus_1",
      paymentIntentExternalId: "pi_1", invoiceNumber: "AMARI-001", providerStatus: "open",
      amountDueCents: 34700, amountPaidCents: 0, amountRemainingCents: 34700,
    });
  });
});
