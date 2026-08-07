import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveParkingReminderPlan, formatSfSweepForModel, lookupSfSweep } from "./cos-parking.js";

afterEach(() => vi.restoreAllMocks());

function parkingEnv(rows) {
  return {
    PORTAL_KV: {
      get: async (key) => key === "cos:sf-sweep-index"
        ? JSON.stringify({ rows, count: rows.length, updated_at: "2026-08-06T00:00:00.000Z" })
        : null,
    },
  };
}

describe("SF sweeping lookup", () => {
  it("plans a day-before parking calendar event for a sweep that is multiple days away", () => {
    expect(deriveParkingReminderPlan({
      location: "727 10th Ave, Inner Richmond, SF",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    })).toEqual({
      starts_at: "2026-08-16T09:00:00",
      reminder_minutes: 0,
      move_by_label: "Sunday, August 16",
    });
  });

  it("plans a 30-minute warning on the sweep morning when it is the next day", () => {
    expect(deriveParkingReminderPlan({
      location: "727 10th Ave, Inner Richmond, SF",
      parked_at: "2026-08-16T23:08:00.000Z",
      rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    })).toEqual({
      starts_at: "2026-08-17T08:00:00",
      reminder_minutes: 30,
      move_by_label: "Monday, August 17",
    });
  });

  it("uses a recorded non-sweeping deadline when a stored rule supplies one", () => {
    expect(deriveParkingReminderPlan({
      location: "5th & Clement",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "time_limit",
      rule_detail: "2-hour limit",
      deadline_iso: "2026-08-07T18:08:00.000Z",
    })).toEqual({
      starts_at: "2026-08-07T11:08:00",
      reminder_minutes: 30,
      move_by_label: "Friday, August 7",
    });
  });

  it("calculates a known hourly parking limit without relying on the chat model", () => {
    expect(deriveParkingReminderPlan({
      location: "5th & Clement",
      parked_at: "2026-08-06T23:08:00.000Z",
      rule_type: "time_limit",
      rule_detail: "2-hour limit",
    })).toEqual({
      starts_at: "2026-08-06T18:08:00",
      reminder_minutes: 30,
      move_by_label: "Thursday, August 6",
    });
  });

  it("uses today's sweep when the car is parked before that sweep starts", () => {
    expect(deriveParkingReminderPlan({
      location: "727 10th Ave, Inner Richmond, SF",
      parked_at: "2026-08-17T14:00:00.000Z",
      rule_type: "street_sweeping",
      rule_detail: "1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    })).toEqual({
      starts_at: "2026-08-17T08:00:00",
      reminder_minutes: 30,
      move_by_label: "Monday, August 17",
    });
  });

  it("does not present an unavailable City index as an unregulated block", () => {
    expect(formatSfSweepForModel({ available: false, matches: [] }))
      .toBe("SF Public Works sweep schedule is currently unavailable; this does not mean the block has no restrictions.");
  });

  it("finds City rules when a normal address spells out street types", async () => {
    const result = await lookupSfSweep(parkingEnv([{
      s: "10th Ave",
      l: "Cabrillo St  -  Fulton St",
      b: "West",
      d: "Wed 1st & 3rd",
      fh: 8,
      th: 10,
      w: [1, 3],
      h: 0,
    }]), "10th Avenue between Cabrillo and Fulton", 6);

    expect(result).toMatchObject({
      available: true,
      match_count: 1,
      matches: [{
        corridor: "10th Ave",
        limits: "Cabrillo St  -  Fulton St",
        side: "West",
        schedule: "Wed 1st & 3rd 8am–10am",
        weeks: [1, 3],
        sweeps_on_holidays: false,
      }],
    });
  });

  it("uses the City's address and segment records to resolve the exact block side", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cnn: "123" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lf_fadd: "700",
        lf_toadd: "798",
        rt_fadd: "701",
        rt_toadd: "799",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        cnn: "123",
        corridor: "10th Ave",
        limits: "Cabrillo St  -  Fulton St",
        cnnrightleft: "R",
        blockside: "West",
        fullname: "Wed 1st & 3rd",
        fromhour: "8",
        tohour: "10",
        week1: "1",
        week3: "1",
        holidays: "0",
      }]), { status: 200 }));

    const result = await lookupSfSweep(parkingEnv([
      {
        s: "10th Ave",
        l: "Cabrillo St  -  Fulton St",
        b: "West",
        c: "123",
        r: "R",
        d: "Wed 1st & 3rd",
        fh: 8,
        th: 10,
        w: [1, 3],
        h: 0,
      },
      {
        s: "10th Ave",
        l: "Cabrillo St  -  Fulton St",
        b: "East",
        c: "123",
        r: "L",
        d: "Mon 1st & 3rd",
        fh: 8,
        th: 10,
        w: [1, 3],
        h: 0,
      },
      {
        s: "10th Ave",
        l: "Balboa St  -  Cabrillo St",
        b: "West",
        c: "456",
        r: "L",
        d: "Wed 1st & 3rd",
        fh: 8,
        th: 10,
        w: [1, 3],
        h: 0,
      },
    ]), "I parked at 763 10th Avenue, San Francisco", 6);

    expect(result).toMatchObject({
      available: true,
      resolution: "exact",
      match_count: 1,
      matches: [{
        limits: "Cabrillo St  -  Fulton St",
        side: "West",
      }],
    });
  });

  it("uses the live City schedule instead of a stale cached exact match", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cnn: "468000" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lf_fadd: "700",
        lf_toadd: "798",
        rt_fadd: "701",
        rt_toadd: "799",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          cnn: "468000",
          corridor: "10th Ave",
          limits: "Cabrillo St  -  Fulton St",
          cnnrightleft: "L",
          blockside: "East",
          fullname: "Mon 1st & 3rd",
          fromhour: "8",
          tohour: "10",
          week1: "1",
          week3: "1",
          holidays: "0",
        },
        {
          cnn: "468000",
          corridor: "10th Ave",
          limits: "Cabrillo St  -  Fulton St",
          cnnrightleft: "R",
          blockside: "West",
          fullname: "Wed 1st & 3rd",
          fromhour: "8",
          tohour: "10",
          week1: "1",
          week3: "1",
          holidays: "0",
        },
      ]), { status: 200 }));

    const result = await lookupSfSweep(parkingEnv([{
      c: "468000",
      r: "R",
      s: "10th Ave",
      l: "Cabrillo St  -  Fulton St",
      b: "West",
      d: "Mon 1st & 3rd",
      fh: 8,
      th: 10,
    }]), "763 10th Avenue", 6);

    expect(result).toMatchObject({
      resolution: "exact",
      match_count: 1,
      matches: [{ side: "West", schedule: "Wed 1st & 3rd 8am–10am", weeks: [1, 3] }],
    });
  });

  it("accepts a natural-language address and safely queries a street with an apostrophe", async () => {
    const cityFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cnn: "777" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lf_fadd: "1000", lf_toadd: "1098", rt_fadd: "1001", rt_toadd: "1099",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        cnn: "777", corridor: "O'Farrell St", limits: "Larkin St  -  Polk St",
        cnnrightleft: "L", blockside: "North", fullname: "Tue 2nd & 4th",
        fromhour: "9", tohour: "11", week2: "1", week4: "1", holidays: "0",
      }]), { status: 200 }));

    const result = await lookupSfSweep(parkingEnv([]), "I parked at 1000 O’Farrell Street, San Francisco", 6);

    expect(new URL(cityFetch.mock.calls[0][0]).searchParams.get("$where"))
      .toBe("address_number=1000 AND street_full_street_name='O''FARRELL ST'");
    expect(result).toMatchObject({
      available: true,
      resolution: "exact",
      matches: [{ corridor: "O'Farrell St", side: "North", weeks: [2, 4] }],
    });
  });

  it("uses the live City schedule when the cache is missing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cnn: "468000" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lf_fadd: "700", lf_toadd: "798", rt_fadd: "701", rt_toadd: "799",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        cnn: "468000", corridor: "10th Ave", limits: "Cabrillo St  -  Fulton St",
        cnnrightleft: "R", blockside: "West", fullname: "Wed 1st & 3rd",
        fromhour: "8", tohour: "10", week1: "1", week3: "1", holidays: "0",
      }]), { status: 200 }));

    const result = await lookupSfSweep({ PORTAL_KV: { get: async () => null } }, "763 10th Avenue", 6);

    expect(result).toMatchObject({
      available: true,
      resolution: "exact",
      matches: [{ side: "West", weeks: [1, 3] }],
    });
  });

  it("does not substitute a cached candidate when the live City schedule has no match", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ cnn: "468000" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lf_fadd: "700", lf_toadd: "798", rt_fadd: "701", rt_toadd: "799",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const result = await lookupSfSweep(parkingEnv([{
      c: "468000", r: "R", s: "10th Ave", l: "Cabrillo St  -  Fulton St",
      b: "West", d: "Wed 1st & 3rd", fh: 8, th: 10, w: [1, 3], h: 0,
    }]), "763 10th Avenue", 6);

    expect(result).toMatchObject({ available: true, resolution: "none", match_count: 0, matches: [] });
  });
});
