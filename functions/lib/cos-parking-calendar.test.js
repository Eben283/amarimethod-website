import { describe, expect, it, vi } from "vitest";
import { replaceParkingCalendarReminder } from "./cos-parking-calendar.js";

describe("parking Calendar replacement", () => {
  it("creates the new parking reminder and then removes the previously tracked one", async () => {
    const kv = {
      get: vi.fn(async () => JSON.stringify({ id: "old-parking-event" })),
      put: vi.fn(async () => {}),
    };
    const createEvent = vi.fn(async () => ({ id: "new-parking-event" }));
    const deleteEvent = vi.fn(async () => true);

    await expect(replaceParkingCalendarReminder({ kv, createEvent, deleteEvent }, "Eben", {
      location: "727 10th Ave, Inner Richmond, SF",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    })).resolves.toMatchObject({
      scheduled: true,
      event_id: "new-parking-event",
      move_by_label: "Sunday, August 16",
    });

    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move car — 727 10th Ave, Inner Richmond, SF",
      starts_at: "2026-08-16T09:00:00",
      reminder_minutes: 0,
    }));
    expect(deleteEvent).toHaveBeenCalledWith("old-parking-event");
    const [, stored] = kv.put.mock.calls[0];
    expect(kv.put.mock.calls[0][0]).toBe("cos:active-parking-reminder:Eben");
    expect(JSON.parse(stored)).toMatchObject({ id: "new-parking-event" });
  });

  it("keeps a failed prior deletion tracked so the next parking entry retries it", async () => {
    const kv = {
      get: vi.fn(async () => JSON.stringify({ id: "old-parking-event" })),
      put: vi.fn(async () => {}),
    };
    const deleteEvent = vi.fn(async () => ({ ok: false, status: 503 }));

    await expect(replaceParkingCalendarReminder({
      kv,
      createEvent: vi.fn(async () => ({ id: "new-parking-event" })),
      deleteEvent,
    }, "Eben", {
      location: "727 10th Ave, Inner Richmond, SF",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    })).resolves.toMatchObject({
      scheduled: true,
      stale_event_ids: ["old-parking-event"],
    });

    const [, stored] = kv.put.mock.calls[0];
    expect(JSON.parse(stored)).toMatchObject({
      id: "new-parking-event",
      pending_delete_ids: ["old-parking-event"],
    });
  });

  it("retires the old parking event when the new block has no calculable deadline", async () => {
    const kv = {
      get: vi.fn(async () => JSON.stringify({ id: "old-parking-event" })),
      delete: vi.fn(async () => {}),
    };
    const createEvent = vi.fn();
    const deleteEvent = vi.fn(async () => ({ ok: true }));

    await expect(replaceParkingCalendarReminder({ kv, createEvent, deleteEvent }, "Eben", {
      location: "Unknown block",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "unknown",
    })).resolves.toMatchObject({ scheduled: false, stale_event_ids: [] });

    expect(createEvent).not.toHaveBeenCalled();
    expect(deleteEvent).toHaveBeenCalledWith("old-parking-event");
    expect(kv.delete).toHaveBeenCalledWith("cos:active-parking-reminder:Eben");
  });
});
