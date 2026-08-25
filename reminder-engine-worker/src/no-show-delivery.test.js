import { describe, expect, it } from "vitest";
import { deliverNoShowStep, noShowDeliveryEligibility } from "./no-show-delivery.js";
import { NO_SHOW_RECOVERY_RELEASE_WORKFLOW } from "./no-show-recovery-workflow.js";

const env = { NO_SHOW_DELIVERY_RELEASE: "approved" };
const flow = {
  flowKey: "no-show-recovery",
  mode: "active",
  calendarIds: NO_SHOW_RECOVERY_RELEASE_WORKFLOW.trigger.calendarIds,
  workflowDocument: NO_SHOW_RECOVERY_RELEASE_WORKFLOW,
};
const enrollment = {
  calendarId: "SKDVOL8wtUN6Ne0ppbC9",
  appointmentId: "appointment-1",
  contactId: "contact-1",
};
const appointment = { appointment: { rescheduleLink: "https://example.test/reschedule" } };
const contact = { contact: { firstName: "Avery", email: "avery@example.test" } };
const services = (capture) => ({
  read: async (_env, path) => path.includes("appointments") ? appointment : contact,
  sendEmail: async (_env, message) => { capture?.(message); return { success: true, messageId: "email-1" }; },
  sendSms: async (message) => { capture?.(message); return { success: true, messageId: "sms-1" }; },
});

describe("No Show delivery release gate", () => {
  it("requires the exact release, active document, calendar, and owned node", () => {
    expect(noShowDeliveryEligibility({}, flow, { template: "reschedule-sms" }, enrollment))
      .toEqual({ eligible: false, reason: "no-show-delivery-disabled" });
    expect(noShowDeliveryEligibility(env, { ...flow, mode: "shadow" }, { template: "reschedule-sms" }, enrollment))
      .toEqual({ eligible: false, reason: "workflow-not-active" });
    expect(noShowDeliveryEligibility(env, flow, { template: "unknown" }, enrollment))
      .toEqual({ eligible: false, reason: "not-owned-step" });
    expect(noShowDeliveryEligibility(env, flow, { template: "reschedule-sms" }, enrollment))
      .toEqual({ eligible: true });
  });

  it("renders the affiliate SMS from the canonical workflow", async () => {
    let sent;
    const result = await deliverNoShowStep(env, { template: "affiliate-soft-sms" }, enrollment, services((message) => { sent = message; }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "contact-1" });
    expect(sent.message).toBe("Hi Avery, looks like we missed each other today. No worries at all. Just reply here or text me to find another time. - Garrett");
  });

  it("renders the appointment-specific reschedule link in the regular SMS", async () => {
    let sent;
    const result = await deliverNoShowStep(env, { template: "reschedule-sms" }, enrollment, services((message) => { sent = message; }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "contact-1" });
    expect(sent.message).toContain("https://example.test/reschedule");
  });

  it("sends both emails from the verified Garrett identity with exact metadata", async () => {
    let sent;
    const result = await deliverNoShowStep(env, { template: "one-day-follow-up" }, enrollment, services((message) => { sent = message; }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent).toMatchObject({ actor: "Garrett", subject: "About your missed session", preheader: "Here's how to reschedule" });
    expect(sent.text).toContain("https://example.test/reschedule");
  });

  it("fails closed when the source reschedule link or client email is unavailable", async () => {
    const noLink = { ...services(), read: async (_env, path) => path.includes("appointments") ? { appointment: {} } : contact };
    expect(await deliverNoShowStep(env, { template: "reschedule-sms" }, enrollment, noLink, NO_SHOW_RECOVERY_RELEASE_WORKFLOW))
      .toEqual({ success: false, error: "appointment reschedule link is unavailable" });
    const noEmail = { ...services(), read: async (_env, path) => path.includes("appointments") ? appointment : { contact: { firstName: "Avery" } } };
    expect(await deliverNoShowStep(env, { template: "two-day-follow-up" }, enrollment, noEmail, NO_SHOW_RECOVERY_RELEASE_WORKFLOW))
      .toEqual({ success: false, error: "recipient email is unavailable" });
  });
});
