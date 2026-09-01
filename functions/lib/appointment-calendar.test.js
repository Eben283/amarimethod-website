import { describe, expect, it } from "vitest";
import { renderOwnedAppointmentCalendar } from "./appointment-calendar.js";

describe("owned appointment calendar", () => {
  it("renders an exact revisioned calendar without provider identity", () => {
    const calendar = renderOwnedAppointmentCalendar({
      ownedAppointmentId: "owned-appointment",
      serviceName: "Partner Initial Session",
      startsAt: "2026-09-10T10:00:00-07:00",
      endsAt: "2026-09-10T11:00:00-07:00",
      meetingLocation: "662 8th Ave, San Francisco, CA",
      revision: 3,
    }, Date.parse("2026-09-01T16:00:00.000Z"));
    expect(calendar).toContain("UID:owned-appointment@amarimethod.com\r\n");
    expect(calendar).toContain("DTSTART:20260910T170000Z\r\n");
    expect(calendar).toContain("DTEND:20260910T180000Z\r\n");
    expect(calendar).toContain("SEQUENCE:3\r\n");
    expect(calendar).toContain("LOCATION:662 8th Ave\\, San Francisco\\, CA");
    expect(calendar).not.toContain("provider");
  });
});
