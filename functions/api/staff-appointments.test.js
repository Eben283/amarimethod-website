import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("staff appointment management API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../lib/staff-owned-contact-identity.js", () => ({
      resolveOwnedContactIdentity: vi.fn(async (_context, reference) => ({
        ownedContactId: String(reference).startsWith("ghl_") ? "owned_1" : reference,
        providerContactId: String(reference).startsWith("ghl_") ? reference : `ghl_${reference}`,
      })),
      requireProviderContactIdentity: vi.fn((identity) => identity.providerContactId),
    }));
    vi.doMock("../lib/staff-owned-appointment-identity.js", () => ({
      resolveStaffOwnedAppointmentIdentity: vi.fn(async (_context, reference) => ({
        ownedAppointmentId: String(reference).startsWith("owned_") ? reference : `owned_${reference}`,
        ownedContactId: "owned_1",
        providerAppointmentId: String(reference).replace(/^owned_/, ""),
        providerContactId: "ghl_owned_1",
      })),
      requireProviderAppointmentIdentity: vi.fn((identity) => ({
        appointmentId: identity.providerAppointmentId,
        contactId: identity.providerContactId,
      })),
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("returns Garrett's internal availability without calling public free slots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T09:00:00-07:00"));
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "availability", contactId: "owned_1", appointmentId: "appt_1",
          startDate: "2026-08-12", endDate: "2026-08-12",
        },
        error: null,
      })),
    }));
    const ghlFetch = vi.fn(async (_context, url) => {
      const value = String(url);
      if (value.includes("/contacts/ghl_owned_1/appointments")) return new Response(JSON.stringify({ appointments: [{
        id: "appt_1", contactId: "ghl_owned_1", calendarId: "EM6vB2mq7EAdGCbUb3j1",
        title: "Amari Assessment", appointmentStatus: "confirmed",
        startTime: "2026-08-14T13:00:00-07:00", endTime: "2026-08-14T13:50:00-07:00",
      }] }), { status: 200 });
      if (value.includes("/calendars/events?")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    vi.doMock("../lib/ghl.js", () => ({ ghlFetch }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { JWT_SECRET: "test" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.publicRestrictionsApplied).toBe(false);
    expect(body.slots.some((slot) => slot.datetime === "2026-08-12T10:15:00-07:00")).toBe(true);
    expect(ghlFetch.mock.calls.some((call) => String(call[1]).includes("free-slots"))).toBe(false);
  });

  it("rejects browser-authored calendar and status identity", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Eben" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "cancel", contactId: "contact_1", appointmentId: "appt_1",
          idempotencyKey: "cancel-appt-1", appointmentStatus: "cancelled",
        },
        error: null,
      })),
    }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: {},
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Appointment identity and status are controlled by the server." });
  });

  it("passes a cancellation through the durable command boundary with the signed actor", async () => {
    const manageAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "cancel", actor: input.actor,
      appointmentId: input.appointmentId, contactId: input.contactId,
      previousStartTime: "2026-08-14T10:00:00-07:00",
      appointmentStatus: "cancelled", reminderVerification: "pending_event_evidence",
    }));
    const store = { marker: "durable-store" };
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: { action: "cancel", contactId: "owned_1", appointmentId: "appt_1", idempotencyKey: "cancel-appt-1" },
        error: null,
      })),
    }));
    const createOwnedAppointmentManageStore = vi.fn(() => store);
    vi.doMock("../lib/staff-owned-appointment-store.js", () => ({
      createOwnedAppointmentManageStore,
      createOwnedAppointmentScheduleStore: vi.fn(),
    }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), manageAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { ATTEND_DB: {} },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(manageAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({
      actor: "Garrett", action: "cancel", contactId: "owned_1",
      appointmentId: "owned_appt_1", providerAppointmentId: "appt_1", store,
    }));
    expect(createOwnedAppointmentManageStore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: "Garrett", action: "cancel", contactId: "owned_1", appointmentId: "owned_appt_1",
    }));
  });

  it("lists server-owned appointment types without requiring an existing appointment", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Eben" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({ body: { action: "list-types" }, error: null })),
    }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: {},
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.types).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "assessment", label: "Assessment ($29)", durationMinutes: 50 }),
      expect.objectContaining({ id: "followup_package_in_person", durationMinutes: 50 }),
    ]));
  });

  it("passes a new booking through the durable schedule boundary with server-owned service identity", async () => {
    const scheduleAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "schedule", actor: input.actor,
      appointmentId: "appointment_new", contactId: input.contactId,
      newStartTime: input.startTime, appointmentStatus: "confirmed",
      reminderVerification: "pending_event_evidence",
    }));
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "schedule", contactId: "owned_1", sessionType: "assessment",
          startTime: "2026-08-12T10:15:00-07:00", idempotencyKey: "schedule-contact-1",
        },
        error: null,
      })),
    }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), scheduleAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const db = { marker: "booking-operations" };
    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { ATTEND_DB: db },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(scheduleAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({
      actor: "Garrett",
      contactId: "owned_1",
      sessionType: "assessment",
      startTime: "2026-08-12T10:15:00-07:00",
      booking: expect.objectContaining({
        calendarId: "EM6vB2mq7EAdGCbUb3j1",
        title: "Amari Method Assessment",
        durationMinutes: 50,
      }),
    }));
  });

  it("routes Partner Initial scheduling through the owned CRM authority without ATTEND_DB", async () => {
    const ownedStore = { marker: "owned-crm-appointment-store" };
    const createOwnedAppointmentScheduleStore = vi.fn(() => ownedStore);
    const scheduleAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "schedule", actor: input.actor,
      appointmentId: "appt_owned_1", providerAppointmentId: "ghl_appointment_1",
      authority: "owned", contactId: input.contactId, newStartTime: input.startTime,
      appointmentStatus: "confirmed", reminderVerification: "pending_event_evidence",
    }));
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "schedule", contactId: "owned_1", sessionType: "partner_initial",
          startTime: "2026-08-12T10:00:00-07:00", idempotencyKey: "schedule-partner-1",
        },
        error: null,
      })),
    }));
    vi.doMock("../lib/staff-owned-appointment-store.js", () => ({
      createOwnedAppointmentScheduleStore,
      createOwnedAppointmentManageStore: vi.fn(),
    }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), scheduleAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: { WORKER_AUTH_SECRET: "secret" },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(createOwnedAppointmentScheduleStore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: "Garrett", contactId: "owned_1", sessionType: "partner_initial",
      booking: expect.objectContaining({ serviceId: "partner-initial" }),
    }));
    expect(scheduleAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({ store: ownedStore }));
    await expect(response.json()).resolves.toMatchObject({
      appointmentId: "appt_owned_1", providerAppointmentId: "ghl_appointment_1", authority: "owned",
    });
  });

  it.each([
    ["discovery_call", "discovery-call", "USgPsktqRcuomdUgpShL"],
    ["discovery_virtual", "discovery-call-virtual", "ZEIGFHBi17SpZ3Ezi5DR"],
    ["ambassador_discovery", "partnership-discovery", "aVE54Qf4lrbYTB0zFqXy"],
  ])("captures %s in the owned CRM before the unchanged GHL edge", async (sessionType, serviceId, calendarId) => {
    const ownedStore = { marker: `owned-${serviceId}` };
    const createOwnedAppointmentScheduleStore = vi.fn(() => ownedStore);
    const scheduleAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "schedule", actor: input.actor,
      appointmentId: `appt_${serviceId}`, providerAppointmentId: `ghl_${serviceId}`,
      authority: "owned", contactId: input.contactId, newStartTime: input.startTime,
      appointmentStatus: "confirmed", reminderVerification: "pending_event_evidence",
    }));
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "schedule", contactId: "owned_1", sessionType,
          startTime: "2026-09-02T10:00:00-07:00", idempotencyKey: `schedule-${serviceId}`,
        },
        error: null,
      })),
    }));
    vi.doMock("../lib/staff-owned-appointment-store.js", () => ({
      createOwnedAppointmentScheduleStore,
      createOwnedAppointmentManageStore: vi.fn(),
    }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), scheduleAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: {
        WORKER_AUTH_SECRET: "secret",
        STAFF_APPOINTMENT_CALENDAR_PROVIDER: "google_calendar",
      },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(createOwnedAppointmentScheduleStore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: "Garrett", contactId: "owned_1", sessionType,
      booking: expect.objectContaining({ serviceId, calendarId }),
      provider: "ghl", providerCalendarId: calendarId,
    }));
    expect(scheduleAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({
      store: ownedStore,
      provider: expect.objectContaining({ provider: "ghl" }),
    }));
  });

  it("selects the owned Google edge for Partner Initial without requiring a GHL contact crosswalk", async () => {
    vi.doMock("../lib/staff-owned-contact-identity.js", () => ({
      resolveOwnedContactIdentity: vi.fn(async () => ({ ownedContactId: "owned_1", providerContactId: null })),
      requireProviderContactIdentity: vi.fn(() => { throw new Error("GHL identity must not be requested"); }),
    }));
    const ownedStore = { marker: "owned-google-store" };
    const createOwnedAppointmentScheduleStore = vi.fn(() => ownedStore);
    const scheduleAppointmentCommand = vi.fn(async (input) => ({
      status: "completed", action: "schedule", actor: input.actor,
      appointmentId: "owned-appointment-1", providerAppointmentId: "google-event-1",
      authority: "owned", contactId: input.contactId, newStartTime: input.startTime,
      appointmentStatus: "confirmed",
    }));
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Garrett" } })),
      corsHeaders: () => ({}),
      parseJsonBody: vi.fn(async () => ({
        body: {
          action: "schedule", contactId: "owned_1", sessionType: "partner_initial",
          startTime: "2026-09-01T10:00:00-07:00", idempotencyKey: "schedule-google-partner-1",
        },
        error: null,
      })),
    }));
    vi.doMock("../lib/staff-owned-appointment-store.js", () => ({
      createOwnedAppointmentScheduleStore,
      createOwnedAppointmentManageStore: vi.fn(),
    }));
    vi.doMock("../lib/staff-appointment-manage.js", async (importOriginal) => ({
      ...(await importOriginal()), scheduleAppointmentCommand,
    }));
    vi.doMock("../lib/ops-path-emit.js", () => ({ emitPathHop: vi.fn(async () => ({})) }));
    vi.doMock("../lib/ops-alert.js", () => ({ recordOpsError: vi.fn(async () => ({})) }));

    const { onRequestPost } = await import("./staff-appointments.js");
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/staff-appointments", { method: "POST" }),
      env: {
        WORKER_AUTH_SECRET: "secret",
        STAFF_APPOINTMENT_CALENDAR_PROVIDER: "google_calendar",
        STAFF_APPOINTMENT_GOOGLE_CALENDAR_ID: "garrett@group.calendar.google.com",
        STAFF_APPOINTMENT_GOOGLE_USER: "Garrett",
      },
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(scheduleAppointmentCommand).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({ provider: "google_calendar" }),
      store: ownedStore,
    }));
    expect(createOwnedAppointmentScheduleStore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      provider: "google_calendar", providerCalendarId: "garrett@group.calendar.google.com",
    }));
  });
});
