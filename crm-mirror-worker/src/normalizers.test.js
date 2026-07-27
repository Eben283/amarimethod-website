import { describe, expect, it } from "vitest";
import {
  normalizeGhlAppointment,
  normalizeGhlConsents,
  normalizeGhlContact,
  normalizeProviderDateTime,
  normalizeStripeCharge,
  normalizedPhone,
} from "./normalizers.js";

describe("CRM mirror normalizers", () => {
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
      consents: [
        { channel: "sms", state: "unknown" },
        { channel: "email", state: "unknown" },
      ],
      referralSourceLabel: "Referral",
    });
  });

  it("normalizes a local GHL appointment timestamp and records DND without inferring opt-in", () => {
    expect(normalizeProviderDateTime("2026-07-27 13:00:00", "America/Los_Angeles")).toBe("2026-07-27T20:00:00.000Z");
    expect(normalizeGhlConsents({ dndSettings: { SMS: { status: "active" } } })).toEqual([
      { channel: "sms", state: "revoked" },
      { channel: "email", state: "unknown" },
    ]);
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
});
