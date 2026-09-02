import { afterEach, describe, expect, it, vi } from "vitest";
import { issueAppointmentManageToken } from "./appointment-manage-token.js";
import {
  executeClientNoShowRecoveryRequest,
  resolveClientNoShowRecoveryContext,
} from "./client-no-show-recovery.js";

const SECRET = "appointment-manage-link-secret-at-least-32-characters";
const NOW = Date.parse("2026-09-01T20:00:00.000Z");

async function token(overrides = {}) {
  return issueAppointmentManageToken(SECRET, {
    appointmentId: "owned-appointment",
    contactId: "owned-contact",
    revision: 3,
    capabilities: ["recovery"],
    iat: NOW,
    exp: NOW + 7 * 86_400_000,
    ...overrides,
  }, NOW);
}

function identity(overrides = {}) {
  return {
    ownedAppointmentId: "owned-appointment",
    ownedContactId: "owned-contact",
    providerAppointmentId: "provider-appointment",
    provider: "ghl",
    providerContactId: "provider-contact",
    providerCalendarId: "lfsnaiGiLNL2z12pLKDP",
    serviceId: "partner-initial",
    serviceName: "Partner Initial Session",
    status: "no_show",
    startsAt: "2026-09-01T18:00:00.000Z",
    endsAt: "2026-09-01T19:00:00.000Z",
    timezone: "America/Los_Angeles",
    authority: "provider_mirror",
    providerSyncState: "synced",
    revision: 3,
    ...overrides,
  };
}

function workerFetch(identityBody = identity()) {
  return vi.fn(async (url) => {
    if (String(url).includes("/appointments/owned-appointment/identity")) {
      return Response.json({ identity: identityBody });
    }
    if (String(url).endsWith("/appointments/recovery-requests")) {
      return Response.json({
        request: {
          requestId: "recovery-1",
          appointmentId: "owned-appointment",
          contactId: "owned-contact",
          appointmentRevision: 3,
          state: "pending_review",
          requestedAt: "2026-09-01T20:00:00.000Z",
          deduped: false,
        },
      }, { status: 201 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const context = () => ({ env: {
  APPOINTMENT_MANAGE_LINK_SECRET: SECRET,
  WORKER_AUTH_SECRET: "worker-secret",
} });

afterEach(() => vi.unstubAllGlobals());

describe("client no-show recovery boundary", () => {
  it("validates the signed exact missed revision without reading or changing a provider", async () => {
    const fetch = workerFetch();
    vi.stubGlobal("fetch", fetch);
    const resolved = await resolveClientNoShowRecoveryContext(context(), await token(), NOW);
    expect(resolved.identity).toMatchObject({
      ownedAppointmentId: "owned-appointment", status: "no_show", authority: "provider_mirror", revision: 3,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/identity");
  });

  it("captures only the exact recovery-review identity through the authenticated CRM boundary", async () => {
    const fetch = workerFetch();
    vi.stubGlobal("fetch", fetch);
    await expect(executeClientNoShowRecoveryRequest(context(), await token(), NOW)).resolves.toMatchObject({
      requestId: "recovery-1", state: "pending_review", appointmentRevision: 3,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, options] = fetch.mock.calls[1];
    expect(options.headers).toMatchObject({ Authorization: "Bearer worker-secret", "X-Staff-Actor": "Client" });
    expect(JSON.parse(options.body)).toEqual({
      appointmentId: "owned-appointment",
      contactId: "owned-contact",
      appointmentRevision: 3,
    });
  });

  it("rejects stale, non-missed, future, or unready identity before request capture", async () => {
    for (const [overrides, code] of [
      [{ revision: 4 }, "appointment_recovery_link_stale"],
      [{ status: "confirmed" }, "appointment_recovery_not_missed"],
      [{ startsAt: "2026-09-02T18:00:00.000Z" }, "appointment_recovery_time_invalid"],
      [{ providerSyncState: "pending" }, "appointment_recovery_authority_unavailable"],
    ]) {
      const fetch = workerFetch(identity(overrides));
      vi.stubGlobal("fetch", fetch);
      await expect(executeClientNoShowRecoveryRequest(context(), await token(), NOW)).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("does not accept a cancellation link as a recovery capability", async () => {
    const fetch = workerFetch();
    vi.stubGlobal("fetch", fetch);
    await expect(resolveClientNoShowRecoveryContext(context(), await token({ capabilities: ["cancel"] }), NOW))
      .rejects.toMatchObject({ code: "appointment_recovery_link_invalid", status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
