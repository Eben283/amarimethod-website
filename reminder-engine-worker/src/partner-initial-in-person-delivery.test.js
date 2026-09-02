import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  createPartnerInitialManageLinks,
  deliverPartnerInitialInPersonStep,
  partnerInitialInPersonDeliveryEligibility,
  readPartnerInitialDeliveryContext,
} from "./partner-initial-in-person-delivery.js";
import { verifyAppointmentManageToken } from "../../functions/lib/appointment-manage-token.js";
import {
  PARTNER_INITIAL_IN_PERSON,
  PARTNER_INITIAL_IN_PERSON_WORKFLOW,
} from "./partner-initial-in-person-workflow.js";

function d1Database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, display_name TEXT NOT NULL,
      email_normalized TEXT, phone_e164 TEXT, created_at TEXT, updated_at TEXT, archived_at TEXT,
      name_authority TEXT NOT NULL DEFAULT 'provider_mirror', name_revision INTEGER NOT NULL DEFAULT 0,
      email_authority TEXT NOT NULL DEFAULT 'provider_mirror', email_revision INTEGER NOT NULL DEFAULT 0,
      phone_authority TEXT NOT NULL DEFAULT 'provider_mirror', phone_revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT, service_family TEXT);
    CREATE TABLE appointments (
      id TEXT PRIMARY KEY, contact_id TEXT, service_id TEXT, provider_appointment_id TEXT,
      provider_calendar_id TEXT, status TEXT, starts_at TEXT, ends_at TEXT, timezone TEXT,
      meeting_location TEXT, provider_meeting_location TEXT, replaces_appointment_id TEXT,
      authority TEXT, provider_sync_state TEXT, revision INTEGER, updated_at TEXT
    );
    CREATE TABLE contact_attributes (
      contact_id TEXT, source TEXT, attribute_key TEXT, attribute_value TEXT, updated_at TEXT
    );
    CREATE TABLE consents (
      id TEXT, contact_id TEXT, channel TEXT, state TEXT, effective_at TEXT,
      destination_normalized TEXT, destination_sha256 TEXT
    );
    CREATE TABLE external_records (
      id TEXT, provider TEXT, object_type TEXT, external_id TEXT,
      contact_id TEXT, record_type TEXT, record_id TEXT, last_seen_at TEXT
    );
  `);
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return { sqlite, prepare: (sql) => statement(sql) };
}

function seedRescheduledAppointment(db) {
  db.sqlite.exec(`
    INSERT INTO contacts
      (id, first_name, last_name, display_name, email_normalized, phone_e164, created_at, updated_at, archived_at)
    VALUES (
      'contact-owned', 'Avery', 'Partner', 'Avery Partner',
      'avery@example.com', '+14155550123', '2026-09-01', '2026-09-01', NULL
    );
    INSERT INTO services VALUES ('partner-initial', 'In Person Session for Partners', 'partner_session');
    INSERT INTO appointments VALUES (
      'appointment-original', 'contact-owned', 'partner-initial', 'ghl-appointment-original',
      'lfsnaiGiLNL2z12pLKDP', 'cancelled', '2026-09-01T17:00:00.000Z',
      '2026-09-01T18:00:00.000Z', 'America/Los_Angeles', NULL, NULL, NULL,
      'owned', 'synced', 2, '2026-09-01T00:00:00.000Z'
    );
    INSERT INTO appointments VALUES (
      'appointment-replacement', 'contact-owned', 'partner-initial', 'google-event-new',
      'garrett@amarimethod.com', 'confirmed', '2026-09-02T18:00:00.000Z',
      '2026-09-02T19:00:00.000Z', 'America/Los_Angeles', NULL, NULL, 'appointment-original',
      'owned', 'synced', 1, '2026-09-01T01:00:00.000Z'
    );
    INSERT INTO external_records VALUES (
      'external-contact', 'ghl', 'contact', 'ghl-contact', 'contact-owned',
      'contact', 'contact-owned', '2026-09-01T00:00:00.000Z'
    );
    INSERT INTO contact_attributes VALUES (
      'contact-owned', 'owned', 'additional_information', 'Left shoulder and hip',
      '2026-09-01T00:00:00.000Z'
    );
    INSERT INTO consents (id, contact_id, channel, state, effective_at)
      VALUES ('email-consent', 'contact-owned', 'email', 'granted', '2026-09-01T00:00:00.000Z');
    INSERT INTO consents (id, contact_id, channel, state, effective_at)
      VALUES ('sms-consent', 'contact-owned', 'sms', 'granted', '2026-09-01T00:00:00.000Z');
  `);
}

const context = Object.freeze({
  appointmentId: "appointment-owned",
  ownedContactId: "contact-owned",
  serviceId: "partner-initial",
  serviceName: "In Person Session for Partners",
  firstName: "Avery",
  contactName: "Avery Partner",
  clientEmail: "avery@example.com",
  clientPhone: "+14155550123",
  additionalInformation: "Left shoulder and hip",
  startAt: "2026-09-01T17:00:00.000Z",
  endAt: "2026-09-01T18:00:00.000Z",
  timezone: "America/Los_Angeles",
  meetingLocation: "662 8th Ave, San Francisco, CA 94118",
  revision: 2,
  dnd: false,
  emailConsent: "granted",
  smsConsent: "granted",
});

const enrollment = Object.freeze({
  appointmentId: "ghl-appointment-original",
  contactId: "ghl-contact",
  calendarId: "lfsnaiGiLNL2z12pLKDP",
  definitionVersion: 2,
});

const links = Object.freeze({
  rescheduleLink: "https://www.amarimethod.com/manage/reschedule/token",
  cancellationLink: "https://www.amarimethod.com/manage/cancel/token",
  googleCalendarLink: "https://calendar.google.com/calendar/render?action=TEMPLATE",
  icalLink: "https://www.amarimethod.com/calendar/token.ics",
});

function activeFlow(sourceGaps = []) {
  return {
    ...PARTNER_INITIAL_IN_PERSON,
    mode: "active",
    workflowDocument: { ...PARTNER_INITIAL_IN_PERSON_WORKFLOW, sourceGaps },
  };
}

function releaseEnv(patch = {}) {
  return {
    PARTNER_INITIAL_IN_PERSON_BEHAVIOR_RELEASE: "approved",
    PARTNER_INITIAL_IN_PERSON_DELIVERY_RELEASE: "approved",
    CRM_DB: { prepare() {} },
    REMINDER_DB: { prepare() {}, batch() {} },
    APPOINTMENT_MANAGE_LINK_SECRET: "appointment-manage-test-secret-that-is-at-least-32-bytes",
    OWNED_SMS: { fetch: vi.fn() },
    WORKER_AUTH_SECRET: "worker-secret",
    GARRETT_INTERNAL_EMAIL: "garrett@amarimethod.com",
    GARRETT_INTERNAL_PHONE_E164: "+16288777673",
    ...patch,
  };
}

describe("Partner Initial provider-neutral delivery", () => {
  it("cannot activate the canonical hard-shadow document even when every environment gate exists", () => {
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv(), PARTNER_INITIAL_IN_PERSON, { template: "confirmation" }, enrollment,
    )).toEqual({ eligible: false, reason: "workflow-hard-shadow" });
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv(), activeFlow(PARTNER_INITIAL_IN_PERSON_WORKFLOW.sourceGaps), { template: "confirmation" }, enrollment,
    )).toEqual({ eligible: false, reason: "source-gaps-open" });
  });

  it("requires both releases, owned CRM, an owned SMS binding, and internal destinations", () => {
    const flow = activeFlow();
    expect(partnerInitialInPersonDeliveryEligibility({}, flow, { template: "confirmation" }, enrollment).reason)
      .toBe("behavior-release-disabled");
    expect(partnerInitialInPersonDeliveryEligibility(
      { PARTNER_INITIAL_IN_PERSON_BEHAVIOR_RELEASE: "approved" }, flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("delivery-release-disabled");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv({ CRM_DB: null }), flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("owned-crm-unavailable");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv({ REMINDER_DB: null }), flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("delivery-evidence-unavailable");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv({ APPOINTMENT_MANAGE_LINK_SECRET: "" }), flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("owned-manage-links-unavailable");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv({ OWNED_SMS: null }), flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("owned-sms-unavailable");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv({ GARRETT_INTERNAL_PHONE_E164: "provider-contact-id" }), flow, { template: "confirmation" }, enrollment,
    ).reason).toBe("internal-recipient-not-configured");
    expect(partnerInitialInPersonDeliveryEligibility(
      releaseEnv(), flow, { template: "confirmation" }, enrollment,
    )).toEqual({ eligible: true });
  });

  it("resolves a provider replay through owned contact identity to the active rescheduled appointment", async () => {
    const db = d1Database();
    seedRescheduledAppointment(db);
    const resolved = await readPartnerInitialDeliveryContext(db, enrollment);
    expect(resolved).toEqual(expect.objectContaining({
      appointmentId: "appointment-replacement",
      ownedContactId: "contact-owned",
      serviceId: "partner-initial",
      firstName: "Avery",
      clientEmail: "avery@example.com",
      clientPhone: "+14155550123",
      additionalInformation: "Left shoulder and hip",
      startAt: "2026-09-02T18:00:00.000Z",
      endAt: "2026-09-02T19:00:00.000Z",
    }));
  });

  it("does not inherit legacy consent after Staff owns a new communication destination", async () => {
    const db = d1Database();
    seedRescheduledAppointment(db);
    db.sqlite.prepare(
      "UPDATE contacts SET email_authority='owned', email_revision=1 WHERE id='contact-owned'",
    ).run();
    db.sqlite.prepare(
      `INSERT INTO consents
       (id, contact_id, channel, state, effective_at, destination_normalized, destination_sha256)
       VALUES (?, ?, 'email', 'unknown', ?, ?, ?)`,
    ).run(
      "owned-email-consent", "contact-owned", "2026-09-01T01:00:00.000Z",
      "avery@example.com", "a".repeat(64),
    );
    const resolved = await readPartnerInitialDeliveryContext(db, enrollment);
    expect(resolved.emailConsent).toBe("unknown");
    expect(resolved.smsConsent).toBe("granted");
  });

  it("issues bounded owned manage links plus provider-neutral calendar exports", async () => {
    const now = Date.parse("2026-08-31T17:00:00.000Z");
    const generated = await createPartnerInitialManageLinks(releaseEnv(), context, now);
    const reschedule = new URL(generated.rescheduleLink);
    const cancellation = new URL(generated.cancellationLink);
    const ical = new URL(generated.icalLink);
    expect(reschedule.origin).toBe("https://www.amarimethod.com");
    expect(reschedule.pathname).toBe("/appointment/manage");
    expect(reschedule.searchParams.get("action")).toBe("reschedule");
    expect(cancellation.searchParams.get("action")).toBe("cancel");
    expect(ical.pathname).toBe("/api/appointment-calendar");
    expect(generated.googleCalendarLink).toContain("calendar.google.com/calendar/render");
    expect(generated.googleCalendarLink).toContain("20260901T170000Z%2F20260901T180000Z");
    const claims = await verifyAppointmentManageToken(
      releaseEnv().APPOINTMENT_MANAGE_LINK_SECRET,
      reschedule.searchParams.get("token"),
      { nowMs: now + 1, capability: "reschedule" },
    );
    expect(claims).toEqual(expect.objectContaining({
      appointmentId: "appointment-owned",
      contactId: "contact-owned",
      revision: 2,
    }));
    expect(cancellation.searchParams.get("token")).toBe(reschedule.searchParams.get("token"));
    expect(ical.searchParams.get("token")).toBe(reschedule.searchParams.get("token"));
  });

  it("renders the exact confirmation from owned context and requires owned HTTPS manage links", async () => {
    let sent;
    let effect;
    const services = {
      readContext: async () => context,
      manageLinks: async () => links,
      executeEffect: async (_db, candidate, transport) => { effect = candidate; return transport(); },
      sendEmail: async (_env, message) => { sent = message; return { success: true, messageId: "gmail-1" }; },
    };
    const result = await deliverPartnerInitialInPersonStep(
      releaseEnv(), { template: "confirmation", stepIndex: 1 }, enrollment, services,
      PARTNER_INITIAL_IN_PERSON_WORKFLOW,
    );
    expect(result).toEqual(expect.objectContaining({ success: true, recipient: "avery@example.com", messageId: "gmail-1" }));
    expect(sent).toEqual(expect.objectContaining({
      to: "avery@example.com",
      actor: "Eben",
      subject: "Your partner session is confirmed",
      preheader: "See you soon. Here are your session details.",
      idempotencyKey: "partner-initial:appointment-owned:v2:1",
    }));
    expect(effect).toEqual(expect.objectContaining({
      enrollmentId: "partner-initial-in-person:ghl-appointment-original",
      provider: "gmail-eben",
      channel: "email",
      recipient: "avery@example.com",
      idempotencyKey: "partner-initial:appointment-owned:v2:1",
    }));
    expect(sent.text).toContain("Hi Avery,");
    expect(sent.text).toContain("In Person Session for Partners");
    expect(sent.text).toContain(`Reschedule ${links.rescheduleLink} · Cancel ${links.cancellationLink}`);

    const missing = await deliverPartnerInitialInPersonStep(
      releaseEnv(), { template: "confirmation", stepIndex: 1 }, enrollment,
      { ...services, manageLinks: async () => ({}) }, PARTNER_INITIAL_IN_PERSON_WORKFLOW,
    );
    expect(missing).toEqual({ success: false, error: "owned appointment rescheduleLink is unavailable" });
  });

  it("uses E.164 destinations rather than provider contact ids and fails closed on policy", async () => {
    let sent;
    let effect;
    const services = {
      readContext: async () => context,
      executeEffect: async (_db, candidate, transport) => { effect = candidate; return transport(); },
      sendSms: async (message) => { sent = message; return { success: true, messageId: "sms-1" }; },
    };
    const result = await deliverPartnerInitialInPersonStep(
      releaseEnv(), { template: "one-hour-sms", stepIndex: 4 }, enrollment,
      services, PARTNER_INITIAL_IN_PERSON_WORKFLOW,
    );
    expect(result).toEqual(expect.objectContaining({ success: true, recipient: "+14155550123" }));
    expect(sent).toEqual({
      to: "+14155550123",
      text: "Hi Avery, just a friendly reminder that your appointment with Garrett is in one hour.",
      idempotencyKey: "partner-initial:appointment-owned:v2:4",
    });
    expect(effect).toEqual(expect.objectContaining({
      provider: "owned-sms",
      channel: "sms",
      recipient: "+14155550123",
      idempotencyKey: "partner-initial:appointment-owned:v2:4",
    }));

    const blocked = await deliverPartnerInitialInPersonStep(
      releaseEnv(), { template: "one-hour-sms", stepIndex: 4 }, enrollment,
      { ...services, readContext: async () => ({ ...context, dnd: true }) }, PARTNER_INITIAL_IN_PERSON_WORKFLOW,
    );
    expect(blocked).toEqual({ success: false, error: "do_not_disturb" });
    expect(sent).toBeDefined();
  });
});
