import { describe, expect, it } from "vitest";
import { listStaffCalendarDefinitions } from "./staff-calendar-catalog.js";

describe("Staff calendar registry", () => {
  it("exposes every governed booking calendar through one owned read model", () => {
    const result = listStaffCalendarDefinitions();

    expect(result.source).toBe("owned-registry");
    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.calendars).toHaveLength(16);
    expect(new Set(result.calendars.map((calendar) => calendar.id)).size).toBe(16);
    expect(result.groups).toEqual([
      expect.objectContaining({ id: "sessions", count: 11 }),
      expect.objectContaining({ id: "discovery", count: 4 }),
      expect.objectContaining({ id: "studies", count: 1 }),
    ]);
  });

  it("makes the booking, payment, and cutover boundary explicit", () => {
    const { calendars } = listStaffCalendarDefinitions();
    const assessment = calendars.find((calendar) => calendar.id === "EM6vB2mq7EAdGCbUb3j1");
    const virtualPartner = calendars.find((calendar) => calendar.id === "P7T6M1w8wtuRfwAqzOVw");

    expect(assessment).toMatchObject({
      name: "Amari Assessment — In Person",
      durationMinutes: 50,
      intervalMinutes: 60,
      bufferMinutes: 20,
      bookingOwner: "Amari booking",
      paymentOwner: "Calendar checkout · $29",
      staffBookable: true,
      readiness: "ready",
    });
    expect(virtualPartner).toMatchObject({
      readiness: "attention",
      staffBookable: true,
    });
    expect(virtualPartner.readinessNote).toContain("virtual location");
  });
});
