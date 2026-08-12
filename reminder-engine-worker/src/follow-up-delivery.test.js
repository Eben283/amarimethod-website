import { describe, expect, it } from "vitest";
import { deliverFollowUpStep, followUpDeliveryEligibility, removeFromGhlWorkflow } from "./follow-up-delivery.js";
import { FOLLOW_UP_WORKFLOW } from "./follow-up-workflow.js";

const env = { FOLLOW_UP_DELIVERY_RELEASE: "approved", FOLLOW_UP_ASSIGNED_USER_DELIVERY: "approved", GARRETT_INTERNAL_EMAIL: "garrett@amarimethod.com", GARRETT_ASSIGNED_USER_ID: "garrett-user", GARRETT_INTERNAL_CONTACT_ID: "garrett-contact" };
const flow = { flowKey: "follow-up-session-reminders", mode: "active", calendarIds: FOLLOW_UP_WORKFLOW.trigger.calendarIds, workflowDocument: FOLLOW_UP_WORKFLOW };
const enrollment = { calendarId: "SKDVOL8wtUN6Ne0ppbC9", appointmentId: "appointment-1", contactId: "contact-1", startAt: "2026-08-20T10:00:00-07:00" };

const appointment = { appointment: {
  calendarName: "Follow-up Session — Virtual", startTime: "2026-08-20T17:00:00.000Z", meetingLocation: "https://meet.google.test/unique-room",
  rescheduleLink: "https://example.test/reschedule", cancellationLink: "https://example.test/cancel", addToGoogleCalendar: "https://example.test/google", addToIcalOutlook: "https://example.test/ical",
  assignedUser: { id: "garrett-user", email: "garrett@amarimethod.com" },
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

  it("keeps the entire flow disabled until the GHL Assigned User route is proven", () => {
    expect(followUpDeliveryEligibility({ ...env, FOLLOW_UP_ASSIGNED_USER_DELIVERY: undefined }, flow, { template: "confirmation" }, enrollment)).toEqual({ eligible: false, reason: "assigned-user-delivery-unverified" });
  });

  it("never lets the release flag turn a shadow document into a sender", () => {
    expect(followUpDeliveryEligibility(env, { ...flow, mode: "shadow" }, { template: "confirmation" }, enrollment)).toEqual({ eligible: false, reason: "workflow-not-active" });
  });

  it("renders the appointment-specific connection value from the authoritative appointment", async () => {
    let sent;
    const result = await deliverFollowUpStep(env, { template: "confirmation" }, enrollment, services(async (_env, message) => { sent = message; return { success: true, messageId: "email-1" }; }), FOLLOW_UP_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent.text).toContain("https://meet.google.test/unique-room");
    expect(sent.text).not.toContain("static");
    expect(sent.actor).toBe("Eben");
    expect(sent.preheader).toBe("See you soon. Here are your session details.");
  });

  it("fails closed when appointment connection details cannot be read", async () => {
    const result = await deliverFollowUpStep(env, { template: "confirmation" }, enrollment, {
      ...services(), read: async (_env, path) => path.includes("appointments") ? { appointment: { ...appointment.appointment, meetingLocation: "" } } : contact,
    }, FOLLOW_UP_WORKFLOW);
    expect(result).toEqual({ success: false, error: "appointment connection details are unavailable" });
  });

  it("resolves internal email from the appointment's actual Assigned User", async () => {
    let sent;
    const result = await deliverFollowUpStep(env, { template: "booked-internal" }, enrollment, services(async (_env, message) => { sent = message; return { success: true, messageId: "email-internal" }; }), FOLLOW_UP_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "garrett@amarimethod.com" });
    expect(sent.to).toBe("garrett@amarimethod.com");
  });

  it("routes the assigned Garrett notification through the proven owned recipient", async () => {
    let sent;
    const result = await deliverFollowUpStep(env, { template: "one-hour-internal" }, enrollment, {
      ...services(), sendSms: async (message) => { sent = message; return { success: true, messageId: "sms-internal" }; },
    }, FOLLOW_UP_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "garrett-contact" });
    expect(sent.contactId).toBe("garrett-contact");
  });

  it("fails closed when the appointment is assigned to someone without an owned SMS recipient", async () => {
    const result = await deliverFollowUpStep(env, { template: "one-hour-internal" }, enrollment, {
      ...services(), read: async (_env, path) => path.includes("appointments") ? { appointment: { ...appointment.appointment, assignedUser: { id: "another-user" } } } : contact,
    }, FOLLOW_UP_WORKFLOW);
    expect(result).toEqual({ success: false, error: "assigned user does not have a configured owned SMS recipient" });
  });

  it("removes the rebooking from the still-GHL-owned no-show queue through its exact endpoint", async () => {
    let path;
    const result = await removeFromGhlWorkflow(env, "ghl:0e9a4b98-1ab5-4681-8371-027953a7ad15", "contact-1", {
      request: async (value) => { path = value; return { ok: true, status: 204 }; },
    });
    expect(path).toBe("/contacts/contact-1/workflow/0e9a4b98-1ab5-4681-8371-027953a7ad15");
    expect(result).toEqual({ provider: "ghl", workflowId: "0e9a4b98-1ab5-4681-8371-027953a7ad15", removed: true });
  });

  it("cannot mutate an arbitrary external workflow", async () => {
    await expect(removeFromGhlWorkflow(env, "ghl:not-the-no-show-workflow", "contact-1", {
      request: async () => ({ ok: true }),
    })).rejects.toThrow("unexpected GHL workflow exit target");
  });
});
