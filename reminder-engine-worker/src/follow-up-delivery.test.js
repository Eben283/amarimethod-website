import { describe, expect, it } from "vitest";
import { deliverFollowUpStep, followUpDeliveryEligibility } from "./follow-up-delivery.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";

const env = { FOLLOW_UP_DELIVERY_RELEASE: "approved", GARRETT_INTERNAL_EMAIL: "garrett@amarimethod.com", GARRETT_INTERNAL_CONTACT_ID: "garrett-contact" };
const flow = { flowKey: "follow-up-session-reminders", calendarIds: FOLLOW_UP_WORKFLOW.trigger.calendarIds, workflowDocument: FOLLOW_UP_WORKFLOW };
const enrollment = { calendarId: "SKDVOL8wtUN6Ne0ppbC9", appointmentId: "appointment-1", contactId: "contact-1", startAt: "2026-08-20T10:00:00-07:00" };

const appointment = { appointment: {
  calendarName: "Follow-up Session — Virtual", startTime: "2026-08-20T17:00:00.000Z", meetingLocation: "https://meet.google.test/unique-room",
  rescheduleLink: "https://example.test/reschedule", cancellationLink: "https://example.test/cancel", addToGoogleCalendar: "https://example.test/google", addToIcalOutlook: "https://example.test/ical",
} };
const contact = { contact: { firstName: "Avery", name: "Avery Client", email: "avery@example.test" } };
const services = (sendEmail = async () => ({ success: true, messageId: "email-1" })) => ({
  read: async (_env, path) => path.includes("appointments") ? appointment : contact,
  sendEmail,
  sendSms: async () => ({ success: true, messageId: "sms-1" }),
});

describe("Follow-Up delivery release gate", () => {
  it("is fail-closed unless the separate behavior release is present", () => {
    expect(followUpDeliveryEligibility({}, flow, { template: "confirmation" }, enrollment)).toEqual({ eligible: false, reason: "follow-up-delivery-disabled" });
    expect(followUpDeliveryEligibility(env, flow, { template: "confirmation" }, enrollment)).toEqual({ eligible: true });
  });

  it("renders the appointment-specific connection value from the authoritative appointment", async () => {
    let sent;
    const result = await deliverFollowUpStep(env, { template: "confirmation" }, enrollment, services(async (_env, message) => { sent = message; return { success: true, messageId: "email-1" }; }), FOLLOW_UP_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent.text).toContain("https://meet.google.test/unique-room");
    expect(sent.text).not.toContain("static");
  });

  it("fails closed when appointment connection details cannot be read", async () => {
    const result = await deliverFollowUpStep(env, { template: "confirmation" }, enrollment, {
      ...services(), read: async (_env, path) => path.includes("appointments") ? { appointment: { ...appointment.appointment, meetingLocation: "" } } : contact,
    }, FOLLOW_UP_WORKFLOW);
    expect(result).toEqual({ success: false, error: "appointment connection details are unavailable" });
  });
});
