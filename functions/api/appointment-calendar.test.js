import { describe, expect, it, vi } from "vitest";

const resolve = vi.fn();
vi.mock("../lib/client-appointment-manage.js", () => ({
  resolveClientAppointmentManageContext: resolve,
}));

const { onRequestGet } = await import("./appointment-calendar.js");

describe("appointment calendar endpoint", () => {
  it("serves a no-store owned calendar after exact bearer verification", async () => {
    resolve.mockResolvedValueOnce({ identity: {
      ownedAppointmentId: "owned-appointment",
      serviceName: "Partner Initial Session",
      startsAt: "2026-09-10T10:00:00-07:00",
      endsAt: "2026-09-10T11:00:00-07:00",
      revision: 3,
    } });
    const context = {
      request: new Request("https://www.amarimethod.com/api/appointment-calendar?token=signed-token"),
      env: {},
    };
    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toContain("UID:owned-appointment@amarimethod.com");
    expect(resolve).toHaveBeenCalledWith(context, "signed-token", "calendar");
  });

  it("returns no appointment detail for an invalid bearer", async () => {
    resolve.mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 401 }));
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/api/appointment-calendar?token=bad"),
      env: {},
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("This appointment calendar link is unavailable.");
  });
});
