import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("staff-data calendar loading", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("loads calendar summaries in parallel without contact-ledger enrichment", async () => {
    let releaseFirstCalendar;
    let eventCalls = 0;
    const ghlFetch = vi.fn(async (_context, url) => {
      const value = String(url);
      if (value.includes("/calendars/?")) {
        return jsonResponse({
          calendars: [
            { id: "cal-1", name: "Assessment" },
            { id: "cal-2", name: "Follow-up" },
          ],
        });
      }
      if (value.includes("/calendars/events?")) {
        eventCalls += 1;
        if (value.includes("calendarId=cal-1")) {
          return new Promise((resolve) => {
            releaseFirstCalendar = () => resolve(jsonResponse({
              events: [{
                id: "appt-1",
                contactId: "contact-1",
                title: "Surrina",
                startTime: "2026-08-08T11:00:00-07:00",
                endTime: "2026-08-08T12:00:00-07:00",
                appointmentStatus: "confirmed",
              }],
            }));
          });
        }
        releaseFirstCalendar?.();
        return jsonResponse({ events: [] });
      }
      throw new Error(`summary request should not fetch ${value}`);
    });

    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "Eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    }));
    vi.doMock("../lib/ghl.js", () => ({
      getGhlToken: vi.fn(async () => "token"),
      ghlFetch,
      ghlHeaders: vi.fn(),
    }));

    const { onRequestGet } = await import("./staff-data.js");
    const request = onRequestGet({
      request: new Request("https://www.amarimethod.com/api/staff-data?date=2026-08-03&endDate=2026-08-09&summary=1"),
      env: {},
    });
    const response = await Promise.race([
      request,
      new Promise((_, reject) => setTimeout(() => reject(new Error("calendar requests were serialized")), 100)),
    ]);

    expect(response.status).toBe(200);
    expect(eventCalls).toBe(2);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "appt-1",
        contactId: "contact-1",
        contactName: "Surrina",
        startTime: "2026-08-08T11:00:00-07:00",
      }),
    ]);
    expect(ghlFetch.mock.calls.some(([, url]) => String(url).includes("/contacts/"))).toBe(false);
  });
});
