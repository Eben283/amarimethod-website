import { describe, expect, it } from "vitest";
import { initialInPersonCutoverEligibility, deliverInitialInPersonStep } from "./initial-in-person-cutover.js";

const env = { INITIAL_IN_PERSON_CUTOVER: "enabled", GARRETT_INTERNAL_EMAIL: "garrett@amarimethod.com", GARRETT_INTERNAL_CONTACT_ID: "lYgxJtvpRzWO2UvDh9ju" };
const flow = { flowKey: "initial-in-person" };
const enrollment = { calendarId: "EM6vB2mq7EAdGCbUb3j1" };

describe("initialInPersonCutoverEligibility", () => {
  it("stays off until all explicit production and internal-recipient gates exist", () => {
    expect(initialInPersonCutoverEligibility({}, flow, { template: "confirmation" }, enrollment).eligible).toBe(false);
    expect(initialInPersonCutoverEligibility({ INITIAL_IN_PERSON_CUTOVER: "enabled" }, flow, { template: "confirmation" }, enrollment).reason).toBe("internal-recipient-not-configured");
    expect(initialInPersonCutoverEligibility(env, flow, { template: "confirmation" }, enrollment)).toEqual({ eligible: true });
  });

  it("limits production handling to the six documented in-person steps and its two calendars", () => {
    for (const template of ["booked-internal", "confirmation", "day-before", "one-hour-sms", "starting-soon", "one-hour-internal"]) {
      expect(initialInPersonCutoverEligibility(env, flow, { template }, enrollment).eligible).toBe(true);
    }
    expect(initialInPersonCutoverEligibility(env, { flowKey: "discovery-call" }, { template: "confirmation" }, enrollment).eligible).toBe(false);
    expect(initialInPersonCutoverEligibility(env, flow, { template: "confirmation" }, { calendarId: "other" }).eligible).toBe(false);
    expect(initialInPersonCutoverEligibility(env, flow, { template: "anything" }, enrollment).eligible).toBe(false);
  });
});

describe("deliverInitialInPersonStep", () => {
  const appointment = {
    appointment: {
      calendarName: "Amari Assessment — In Person",
      startTime: "2026-08-10T17:00:00.000Z",
      addToGoogleCalendar: "https://calendar.google.test/add",
      addToIcalOutlook: "https://calendar.google.test/ical",
      rescheduleLink: "https://amari.test/reschedule",
      cancellationLink: "https://amari.test/cancel",
    },
  };
  const contact = {
    contact: {
      firstName: "Avery",
      name: "Avery Client",
      email: "avery@example.test",
      customFields: [{ key: "additional_information", value: "right shoulder" }],
    },
  };
  const enrollment = { appointmentId: "appointment_1", contactId: "client_1", startAt: "2026-08-10T17:00:00.000Z" };
  const services = () => ({
    read: async (_env, path) => path.includes("appointments") ? appointment : contact,
    sendEmail: async (_env, message) => ({ success: true, messageId: `email:${message.to}` }),
    sendSms: async (message) => ({ success: true, messageId: `sms:${message.contactId}` }),
  });

  it("renders each owned email with the documented timing and the intended recipient", async () => {
    const internal = await deliverInitialInPersonStep(env, { template: "booked-internal" }, enrollment, services());
    expect(internal).toMatchObject({ success: true, recipient: "garrett@amarimethod.com" });

    const confirmation = await deliverInitialInPersonStep(env, { template: "confirmation" }, enrollment, services());
    expect(confirmation).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(confirmation.messageId).toBe("email:avery@example.test");

    const dayBefore = await deliverInitialInPersonStep(env, { template: "day-before" }, enrollment, services());
    expect(dayBefore).toMatchObject({ success: true, recipient: "avery@example.test" });

    const startingSoon = await deliverInitialInPersonStep(env, { template: "starting-soon" }, enrollment, services());
    expect(startingSoon).toMatchObject({ success: true, recipient: "avery@example.test" });
  });

  it("sends the two SMS steps through the client and Garrett contact records", async () => {
    const client = await deliverInitialInPersonStep(env, { template: "one-hour-sms" }, enrollment, services());
    expect(client).toMatchObject({ success: true, recipient: "client_1", messageId: "sms:client_1" });

    const internal = await deliverInitialInPersonStep(env, { template: "one-hour-internal" }, enrollment, services());
    expect(internal).toMatchObject({ success: true, recipient: "lYgxJtvpRzWO2UvDh9ju", messageId: "sms:lYgxJtvpRzWO2UvDh9ju" });
  });

  it("fails closed when a client email is missing", async () => {
    const missingEmail = { contact: { ...contact.contact, email: "" } };
    const result = await deliverInitialInPersonStep(env, { template: "confirmation" }, enrollment, {
      ...services(),
      read: async (_env, path) => path.includes("appointments") ? appointment : missingEmail,
    });
    expect(result).toMatchObject({ success: false, error: "recipient email is unavailable", recipient: "" });
  });
});
