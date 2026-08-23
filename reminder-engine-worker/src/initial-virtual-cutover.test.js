import { describe, expect, it } from "vitest";
import { deliverInitialVirtualStep, initialVirtualCutoverEligibility } from "./initial-virtual-cutover.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";

const env = { INITIAL_VIRTUAL_CUTOVER: "enabled", GARRETT_INTERNAL_EMAIL: "garrett@amarimethod.com", GARRETT_INTERNAL_CONTACT_ID: "lYgxJtvpRzWO2UvDh9ju" };
const flow = { flowKey: "initial-virtual", calendarIds: INITIAL_VIRTUAL_WORKFLOW.trigger.calendarIds, workflowDocument: INITIAL_VIRTUAL_WORKFLOW };
const enrollment = { calendarId: "ySmht5hx4uZGEpgZrlCw", appointmentId: "appointment_1", contactId: "client_1", startAt: "2026-08-10T17:00:00.000Z" };

describe("initialVirtualCutoverEligibility", () => {
  it("remains disabled until its own explicit gate and internal-recipient requirements exist", () => {
    expect(initialVirtualCutoverEligibility({}, flow, { template: "welcome" }, enrollment).reason).toBe("cutover-disabled");
    expect(initialVirtualCutoverEligibility({ INITIAL_VIRTUAL_CUTOVER: "enabled" }, flow, { template: "welcome" }, enrollment).reason).toBe("internal-recipient-not-configured");
    expect(initialVirtualCutoverEligibility(env, flow, { template: "welcome" }, enrollment)).toEqual({ eligible: true });
  });

  it("admits only its six source-verified steps plus the owned reschedule notice on the Initial Session — Virtual calendar", () => {
    for (const template of ["booked-internal", "welcome", "reschedule-confirmation", "day-before", "one-hour-email", "one-hour-sms", "one-hour-internal"]) {
      expect(initialVirtualCutoverEligibility(env, flow, { template }, enrollment).eligible).toBe(true);
    }
    expect(initialVirtualCutoverEligibility(env, flow, { template: "welcome" }, { ...enrollment, calendarId: "other" }).eligible).toBe(false);
    expect(initialVirtualCutoverEligibility(env, flow, { template: "unknown" }, enrollment).eligible).toBe(false);
  });
});

describe("deliverInitialVirtualStep", () => {
  const appointment = { appointment: {
    calendarName: "Initial Session — Virtual", startTime: "2026-08-10T17:00:00.000Z", meetingLocation: "https://meet.google.test/room",
    addToGoogleCalendar: "https://calendar.google.test/add", addToIcalOutlook: "https://calendar.google.test/ical",
    rescheduleLink: "https://amari.test/reschedule", cancellationLink: "https://amari.test/cancel",
  } };
  const contact = { contact: { firstName: "Avery", name: "Avery Client", email: "avery@example.test", customFields: [{ key: "additional_information", value: "right shoulder" }] } };
  const services = (capture) => ({
    read: async (_env, path) => path.includes("appointments") ? appointment : contact,
    sendEmail: async (_env, message) => { capture?.(message); return { success: true, messageId: `email:${message.to}` }; },
    sendSms: async (message) => { capture?.(message); return { success: true, messageId: `sms:${message.contactId}` }; },
  });

  it("renders Google Meet details from the canonical workflow, not a hard-coded studio address", async () => {
    let sent;
    const result = await deliverInitialVirtualStep(env, { template: "welcome" }, enrollment, services((message) => { sent = message; }), INITIAL_VIRTUAL_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent.text).toContain("https://meet.google.test/room");
    expect(sent.text).not.toContain("662 8th Ave");
  });

  it("uses the client and Garrett contact records for the two SMS steps", async () => {
    expect(await deliverInitialVirtualStep(env, { template: "one-hour-sms" }, enrollment, services(), INITIAL_VIRTUAL_WORKFLOW)).toMatchObject({ success: true, recipient: "client_1" });
    expect(await deliverInitialVirtualStep(env, { template: "one-hour-internal" }, enrollment, services(), INITIAL_VIRTUAL_WORKFLOW)).toMatchObject({ success: true, recipient: "lYgxJtvpRzWO2UvDh9ju" });
  });

  it("fails closed rather than sending a virtual message with no meeting link", async () => {
    const result = await deliverInitialVirtualStep(env, { template: "welcome" }, enrollment, {
      ...services(), read: async (_env, path) => path.includes("appointments") ? { appointment: { ...appointment.appointment, meetingLocation: "" } } : contact,
    }, INITIAL_VIRTUAL_WORKFLOW);
    expect(result).toEqual({ success: false, error: "virtual meeting link is unavailable" });
  });

  it("sends one concise updated confirmation with the new time and Google Meet link", async () => {
    let sent;
    const result = await deliverInitialVirtualStep(env, { template: "reschedule-confirmation" }, enrollment, services((message) => { sent = message; }), INITIAL_VIRTUAL_WORKFLOW);

    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent.subject).toBe("Your virtual appointment time has been updated");
    expect(sent.text).toContain("Monday, August 10 at 10:00 AM PDT");
    expect(sent.text).toContain("Google Meet: https://meet.google.test/room");
    expect(sent.text).not.toContain("Equipment");
  });

  it("uses the current reschedule notice for an older pinned virtual enrollment", async () => {
    const pinnedV3 = {
      ...INITIAL_VIRTUAL_WORKFLOW,
      version: 3,
      nodes: INITIAL_VIRTUAL_WORKFLOW.nodes.filter((node) => node.at !== "reschedule"),
    };

    expect(await deliverInitialVirtualStep(env, { template: "reschedule-confirmation" }, enrollment, services(), pinnedV3))
      .toMatchObject({ success: true, recipient: "avery@example.test" });
  });
});
