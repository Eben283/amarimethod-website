import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve = vi.fn();
const availability = vi.fn();
const execute = vi.fn();
const resolveRecovery = vi.fn();
const executeRecovery = vi.fn();

vi.mock("../lib/client-appointment-manage.js", () => ({
  resolveClientAppointmentManageContext: resolve,
  clientAppointmentAvailability: availability,
  executeClientAppointmentManage: execute,
}));
vi.mock("../lib/client-no-show-recovery.js", () => ({
  resolveClientNoShowRecoveryContext: resolveRecovery,
  executeClientNoShowRecoveryRequest: executeRecovery,
}));

const { onRequestGet, onRequestPost } = await import("./manage.js");

const identity = Object.freeze({
  serviceName: "Partner Initial Session",
  startsAt: "2026-09-10T10:00:00-07:00",
  endsAt: "2026-09-10T11:00:00-07:00",
  timezone: "America/Los_Angeles",
  meetingLocation: "662 8th Ave",
});
beforeEach(() => {
  resolve.mockReset().mockResolvedValue({ identity });
  availability.mockReset().mockResolvedValue({
    timezone: "America/Los_Angeles",
    slots: [{ datetime: "2026-09-11T10:00:00-07:00" }],
  });
  execute.mockReset().mockResolvedValue({ action: "cancel", appointmentStatus: "cancelled" });
  resolveRecovery.mockReset().mockResolvedValue({ identity });
  executeRecovery.mockReset().mockResolvedValue({ requestId: "recovery-1", state: "pending_review" });
});

describe("public appointment manage page", () => {
  it("keeps GET read-only and renders a separate cancellation confirmation", async () => {
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/appointment/manage?action=cancel&token=signed-token"),
      env: {},
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Nothing changes until you confirm");
    expect(html).toContain('method="post"');
    expect(html).toContain('value="signed-token"');
    expect(execute).not.toHaveBeenCalled();
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("renders only server-computed reschedule choices", async () => {
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/appointment/manage?action=reschedule&token=signed-token"),
      env: {},
    });
    const html = await response.text();
    expect(html).toContain("Choose a new time");
    expect(html).toContain('value="2026-09-11T10:00:00-07:00"');
    expect(resolve).toHaveBeenCalledWith(expect.anything(), "signed-token", "reschedule");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps recovery GET read-only and states the review-only contract", async () => {
    const response = await onRequestGet({
      request: new Request("https://www.amarimethod.com/appointment/manage?action=recovery&token=signed-token"),
      env: {},
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Request a reschedule review");
    expect(html).toContain("does not book a time, grant a session, charge a payment, or guarantee approval");
    expect(resolveRecovery).toHaveBeenCalledWith(expect.anything(), "signed-token");
    expect(executeRecovery).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects cross-origin posts before executing a command", async () => {
    const body = new URLSearchParams({ token: "signed-token", action: "cancel" });
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/appointment/manage", {
        method: "POST",
        headers: { Origin: "https://attacker.example", "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
      env: {},
    });
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes an exact same-origin confirmed command", async () => {
    const body = new URLSearchParams({ token: "signed-token", action: "cancel" });
    const context = {
      request: new Request("https://www.amarimethod.com/appointment/manage", {
        method: "POST",
        headers: { Origin: "https://www.amarimethod.com", "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
      env: {},
    };
    const response = await onRequestPost(context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Your appointment is cancelled");
    expect(execute).toHaveBeenCalledWith(context, "signed-token", "cancel", "");
  });

  it("records a same-origin recovery review without invoking appointment management", async () => {
    const body = new URLSearchParams({ token: "signed-token", action: "recovery" });
    const context = {
      request: new Request("https://www.amarimethod.com/appointment/manage", {
        method: "POST",
        headers: { Origin: "https://www.amarimethod.com", "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
      env: {},
    };
    const response = await onRequestPost(context);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Your request is recorded");
    expect(html).toContain("No appointment, session credit, charge, or automatic message was created");
    expect(executeRecovery).toHaveBeenCalledWith(context, "signed-token");
    expect(execute).not.toHaveBeenCalled();
  });
});
