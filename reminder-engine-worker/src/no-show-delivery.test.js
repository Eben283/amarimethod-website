import { describe, expect, it } from "vitest";
import {
  deliverNoShowStep, noShowDeliveryEligibility, noShowDeliveryReadiness,
  ownedNoShowRecoveryUrl, readNoShowDeliveryContext,
} from "./no-show-delivery.js";
import { NO_SHOW_RECOVERY_RELEASE_WORKFLOW } from "./no-show-recovery-workflow.js";

const db = { prepare() {}, batch() {} };
const env = {
  NO_SHOW_DELIVERY_RELEASE: "approved",
  NO_SHOW_RECOVERY_URL: "https://www.amarimethod.com/appointment/recovery",
  WORKER_AUTH_SECRET: "proof-secret",
  CRM_DB: db,
  REMINDER_DB: db,
  PORTAL_KV: {},
  AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "client",
  AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  OWNED_SMS: { fetch() {} },
};
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
  definitionVersion: 4,
};
const contactContext = {
  appointmentId: "owned-appointment-1",
  ownedContactId: "owned-contact-1",
  firstName: "Avery",
  clientEmail: "avery@example.test",
  clientPhone: "+14155550123",
  dnd: false,
  emailConsent: "granted",
  smsConsent: "granted",
};
const services = (capture, over = {}) => ({
  readContext: async () => ({ ...contactContext, ...(over.context || {}) }),
  recoveryUrl: async () => over.recoveryUrl === undefined
    ? "https://www.amarimethod.com/appointment/recovery"
    : over.recoveryUrl,
  executeEffect: async (_db, effect, transport) => { capture?.({ effect }); return transport(); },
  sendEmail: async (_env, message) => { capture?.({ message }); return { success: true, messageId: "email-1" }; },
  sendSms: async (message) => { capture?.({ message }); return { success: true, messageId: "sms-1" }; },
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
    expect(noShowDeliveryReadiness({ ...env, OWNED_SMS: undefined }))
      .toEqual({ eligible: false, reason: "owned-sms-unavailable" });
    expect(noShowDeliveryReadiness({ ...env, NO_SHOW_RECOVERY_URL: "https://evil.test/rebook" }))
      .toEqual({ eligible: false, reason: "owned-recovery-link-unavailable" });
    expect(ownedNoShowRecoveryUrl("https://www.amarimethod.com/api/private")).toBeNull();
  });

  it("renders the affiliate SMS to an E.164 destination with durable owned identity", async () => {
    let sent;
    let effect;
    const result = await deliverNoShowStep(env, { template: "affiliate-soft-sms", stepIndex: 0 }, enrollment, services((capture) => {
      if (capture.message) sent = capture.message;
      if (capture.effect) effect = capture.effect;
    }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "+14155550123" });
    expect(sent).toEqual({
      to: "+14155550123",
      text: "Hi Avery, looks like we missed each other today. No worries at all. Just reply here or text me to find another time. - Garrett",
      idempotencyKey: "no-show-recovery:owned-appointment-1:v4:0",
    });
    expect(effect).toMatchObject({ provider: "owned-sms", recipient: "+14155550123", channel: "sms" });
  });

  it("renders only the same-origin owned recovery link in the regular SMS", async () => {
    let sent;
    const result = await deliverNoShowStep(env, { template: "reschedule-sms", stepIndex: 0 }, enrollment, services((capture) => {
      if (capture.message) sent = capture.message;
    }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "+14155550123" });
    expect(sent.text).toContain("https://www.amarimethod.com/appointment/recovery");
  });

  it("sends both emails from the verified Garrett identity with exact metadata", async () => {
    let sent;
    const result = await deliverNoShowStep(env, { template: "one-day-follow-up", stepIndex: 1 }, enrollment, services((capture) => {
      if (capture.message) sent = capture.message;
    }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW);
    expect(result).toMatchObject({ success: true, recipient: "avery@example.test" });
    expect(sent).toMatchObject({ actor: "Garrett", subject: "About your missed session", preheader: "Here's how to reschedule" });
    expect(sent.text).toContain("https://www.amarimethod.com/appointment/recovery");
    expect(sent.idempotencyKey).toBe("no-show-recovery:owned-appointment-1:v4:1");
  });

  it("fails closed on missing recovery, contact policy, or provider-neutral destination", async () => {
    expect(await deliverNoShowStep(env, { template: "reschedule-sms", stepIndex: 0 }, enrollment,
      services(null, { recoveryUrl: "https://evil.test/reschedule" }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW))
      .toEqual({ success: false, error: "owned no-show recovery link is unavailable" });
    expect(await deliverNoShowStep(env, { template: "two-day-follow-up", stepIndex: 2 }, enrollment,
      services(null, { context: { clientEmail: "" } }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW))
      .toEqual({ success: false, error: "recipient email is unavailable", recipient: "" });
    expect(await deliverNoShowStep(env, { template: "affiliate-soft-sms", stepIndex: 0 }, enrollment,
      services(null, { context: { dnd: true } }), NO_SHOW_RECOVERY_RELEASE_WORKFLOW))
      .toEqual({ success: false, error: "do_not_disturb" });
  });

  it("reads the missed appointment and exact legacy contact alias only from owned CRM", async () => {
    const calls = [];
    const rows = [{
      appointment_id: "owned-appointment-1", contact_id: "owned-contact-1",
      provider_appointment_id: "appointment-1", provider_calendar_id: enrollment.calendarId,
      status: "no_show", first_name: "Avery", display_name: "Avery Example",
      email_normalized: "avery@example.test", phone_e164: "+14155550123",
      archived_at: null, dnd_state: "off", email_consent_state: "granted", sms_consent_state: "granted",
    }];
    const ownedDb = {
      prepare(sql) {
        calls.push(sql);
        return {
          bind() { return this; },
          async all() { return { results: calls.length === 1 ? rows : [{ external_id: "contact-1" }] }; },
        };
      },
    };
    await expect(readNoShowDeliveryContext(ownedDb, enrollment)).resolves.toEqual(contactContext);
    expect(calls[0]).toContain("appointment.status = 'no_show'");
    expect(calls[1]).toContain("provider = 'ghl'");
  });
});
