import { afterEach, describe, expect, it, vi } from "vitest";
import { issueAppointmentManageToken } from "./appointment-manage-token.js";
import {
  clientAppointmentAvailability,
  executeClientAppointmentManage,
  resolveClientAppointmentManageContext,
} from "./client-appointment-manage.js";

const SECRET = "appointment-manage-link-secret-at-least-32-characters";
const NOW = Date.parse("2026-09-01T09:00:00-07:00");

async function token(revision = 3) {
  return issueAppointmentManageToken(SECRET, {
    appointmentId: "owned-appointment",
    contactId: "owned-contact",
    revision,
    capabilities: ["cancel", "reschedule", "calendar"],
    iat: NOW,
    exp: NOW + 7 * 86_400_000,
  }, NOW);
}

function identity(overrides = {}) {
  return {
    ownedAppointmentId: "owned-appointment",
    ownedContactId: "owned-contact",
    providerAppointmentId: "provider-appointment",
    providerContactId: "provider-contact",
    provider: "ghl",
    providerCalendarId: "lfsnaiGiLNL2z12pLKDP",
    serviceId: "partner-initial",
    serviceName: "Partner Initial Session",
    status: "confirmed",
    startsAt: "2026-09-10T10:00:00-07:00",
    endsAt: "2026-09-10T11:00:00-07:00",
    timezone: "America/Los_Angeles",
    meetingLocation: "662 8th Ave",
    authority: "owned",
    providerSyncState: "synced",
    revision: 3,
    ...overrides,
  };
}

function providerAppointment(status = "confirmed") {
  return {
    id: "provider-appointment",
    contactId: "provider-contact",
    calendarId: "lfsnaiGiLNL2z12pLKDP",
    serviceId: "partner-initial",
    title: "Partner Initial Session",
    appointmentStatus: status,
    startTime: "2026-09-10T10:00:00-07:00",
    endTime: "2026-09-10T11:00:00-07:00",
  };
}

function workerFetch(identityBody = identity(), appointment = providerAppointment()) {
  return vi.fn(async (url, options = {}) => {
    if (String(url).includes("/appointments/owned-appointment/identity")) {
      return new Response(JSON.stringify({ identity: identityBody }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/contacts/provider-contact/appointments")) {
      return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/calendars/events?")) {
      return new Response(JSON.stringify({ events: [appointment] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/appointments/commands")) {
      const body = JSON.parse(options.body);
      if (body.action === "manage") return new Response(JSON.stringify({ command: { commandId: "command-id" } }), { status: 201 });
      if (body.action === "claim") return new Response(JSON.stringify({ state: "acquired", execution: {} }), { status: 200 });
      if (body.action === "complete") return new Response(JSON.stringify({ execution: { result: body.result } }), { status: 200 });
      return new Response(JSON.stringify({ execution: {} }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("client appointment manage boundary", () => {
  it("distinguishes missing server custody from an invalid bearer", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(resolveClientAppointmentManageContext({ env: {
      WORKER_AUTH_SECRET: "worker-secret",
    } }, await token(), "cancel", NOW)).rejects.toMatchObject({
      code: "appointment_manage_secret_unavailable",
      status: 503,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds the bearer token to exact owned appointment revision and provider readback", async () => {
    vi.stubGlobal("fetch", workerFetch());
    const resolved = await resolveClientAppointmentManageContext({ env: {
      APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
      WORKER_AUTH_SECRET: "worker-secret",
      GHL_API_KEY: "provider-secret",
    } }, await token(), "cancel", NOW);
    expect(resolved.identity).toMatchObject({ ownedAppointmentId: "owned-appointment", revision: 3, provider: "ghl" });
    expect(resolved.appointment.id).toBe("provider-appointment");
  });

  it("rejects stale links before provider access", async () => {
    const fetch = workerFetch(identity({ revision: 4 }));
    vi.stubGlobal("fetch", fetch);
    await expect(resolveClientAppointmentManageContext({ env: {
      APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
      WORKER_AUTH_SECRET: "worker-secret",
      GHL_API_KEY: "provider-secret",
    } }, await token(), "cancel", NOW)).rejects.toMatchObject({ code: "appointment_manage_link_stale" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses provider time drift rather than showing stale owned truth", async () => {
    vi.stubGlobal("fetch", workerFetch(identity(), {
      ...providerAppointment(),
      startTime: "2026-09-10T11:00:00-07:00",
      endTime: "2026-09-10T12:00:00-07:00",
    }));
    await expect(resolveClientAppointmentManageContext({ env: {
      APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
      WORKER_AUTH_SECRET: "worker-secret",
      GHL_API_KEY: "provider-secret",
    } }, await token(), "cancel", NOW)).rejects.toMatchObject({ code: "provider_appointment_time_drift" });
  });

  it("shows only the governed public lattice while excluding the current appointment", async () => {
    vi.stubGlobal("fetch", workerFetch());
    const resolved = await resolveClientAppointmentManageContext({ env: {
      APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
      WORKER_AUTH_SECRET: "worker-secret",
      GHL_API_KEY: "provider-secret",
    } }, await token(), "reschedule", NOW);
    const availability = await clientAppointmentAvailability(resolved, NOW, 2);
    expect(availability.slots.length).toBeGreaterThan(0);
    expect(availability.slots.every((slot) => slot.minute === 0)).toBe(true);
    expect(availability.slots.map((slot) => slot.datetime)).not.toContain("2026-09-10T10:00:00-07:00");
  });

  it("records a client cancellation through the same owned command owner", async () => {
    let appointment = providerAppointment();
    const requests = [];
    const fetch = workerFetch();
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/contacts/provider-contact/appointments")) {
        return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("/calendars/events/appointments/provider-appointment") && options.method === "PUT") {
        appointment = { ...appointment, appointmentStatus: "cancelled" };
        return new Response("{}", { status: 200 });
      }
      if (String(url).includes("/appointments/commands")) requests.push(JSON.parse(options.body));
      return fetch(url, options);
    }));
    const result = await executeClientAppointmentManage({ env: {
      APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
      WORKER_AUTH_SECRET: "worker-secret",
      GHL_API_KEY: "provider-secret",
    } }, await token(), "cancel", "", NOW);
    expect(result).toMatchObject({ actor: "Client", action: "cancel", appointmentStatus: "cancelled" });
    expect(requests[0]).toMatchObject({ action: "manage", manageAction: "cancel", appointmentId: "owned-appointment" });
  });
});
