import { describe, it, expect } from "vitest";
import { toNurtureEvent, eventMatches } from "./events.js";

// The nurture engine consumes FOUR event sources (per acquisition-nurture.md):
// appointment events (from the substrate normalizer, via the dispatch seam), quiz submissions
// (send-to-ghl.js), purchases (ghl-purchase-webhook.js), and tag-added events (transition bridge
// + the engine's own onEnter). toNurtureEvent normalizes all of them to one shape; eventMatches
// is the single matcher entry/exits run through.

describe("toNurtureEvent — appointment events (substrate shape)", () => {
  const appt = {
    type: "showed", recognized: true, status: "showed",
    calendarId: "USgPsktqRcuomdUgpShL", contactId: "cont_1",
    appointmentId: "appt_1", startAt: "2026-07-20T15:00:00-07:00", modifiedBy: "user",
  };

  it("wraps a recognized appointment event as kind=appointment", () => {
    const e = toNurtureEvent(appt);
    expect(e).toEqual({
      kind: "appointment", type: "showed", calendarId: "USgPsktqRcuomdUgpShL",
      contactId: "cont_1", appointmentId: "appt_1", modifiedBy: "user",
    });
  });

  it("rejects an unrecognized appointment event", () => {
    expect(toNurtureEvent({ ...appt, recognized: false, type: "unknown" })).toBeNull();
  });

  it("does not mutate the raw event", () => {
    const raw = { ...appt };
    toNurtureEvent(raw);
    expect(raw).toEqual(appt);
  });
});

describe("toNurtureEvent — kinded events", () => {
  it("passes through quiz.submitted", () => {
    expect(toNurtureEvent({ kind: "quiz.submitted", contactId: "c1" }))
      .toEqual({ kind: "quiz.submitted", contactId: "c1" });
  });

  it("passes through purchase with productId", () => {
    expect(toNurtureEvent({ kind: "purchase", contactId: "c1", productId: "p1" }))
      .toEqual({ kind: "purchase", contactId: "c1", productId: "p1" });
  });

  it("passes through tag.added with tag", () => {
    expect(toNurtureEvent({ kind: "tag.added", contactId: "c1", tag: "discovery call attended" }))
      .toEqual({ kind: "tag.added", contactId: "c1", tag: "discovery call attended" });
  });

  it("rejects events missing a contactId (nothing to enroll/exit)", () => {
    expect(toNurtureEvent({ kind: "quiz.submitted" })).toBeNull();
    expect(toNurtureEvent({ kind: "purchase", productId: "p1" })).toBeNull();
  });

  it("rejects unknown kinds, null, and junk", () => {
    expect(toNurtureEvent({ kind: "invoice.paid", contactId: "c1" })).toBeNull();
    expect(toNurtureEvent(null)).toBeNull();
    expect(toNurtureEvent("quiz.submitted")).toBeNull();
    expect(toNurtureEvent({})).toBeNull();
  });
});

describe("eventMatches — the one matcher entry and exits run through", () => {
  const showedDiscovery = {
    kind: "appointment", type: "showed", calendarId: "USgPsktqRcuomdUgpShL",
    contactId: "c1", appointmentId: "a1", modifiedBy: "customer",
  };

  it("matches quiz.submitted spec only against quiz.submitted events", () => {
    const spec = { kind: "quiz.submitted" };
    expect(eventMatches(spec, { kind: "quiz.submitted", contactId: "c1" })).toBe(true);
    expect(eventMatches(spec, showedDiscovery)).toBe(false);
  });

  it("matches appointment spec on status AND calendar", () => {
    const spec = { kind: "appointment", statuses: ["showed"], calendarIds: ["USgPsktqRcuomdUgpShL"] };
    expect(eventMatches(spec, showedDiscovery)).toBe(true);
    expect(eventMatches(spec, { ...showedDiscovery, type: "booked" })).toBe(false);
    expect(eventMatches(spec, { ...showedDiscovery, calendarId: "other" })).toBe(false);
  });

  it("appointment spec with modifiedBy filter only matches that actor (the User-confirm exit)", () => {
    const spec = {
      kind: "appointment", statuses: ["confirmed"],
      calendarIds: ["USgPsktqRcuomdUgpShL"], modifiedBy: ["user"],
    };
    const confirmed = { ...showedDiscovery, type: "confirmed" };
    expect(eventMatches(spec, { ...confirmed, modifiedBy: "user" })).toBe(true);
    // a client self-confirmation must NOT fire the manual-confirm path
    expect(eventMatches(spec, { ...confirmed, modifiedBy: "customer" })).toBe(false);
    expect(eventMatches(spec, { ...confirmed, modifiedBy: null })).toBe(false);
  });

  it("matches purchase spec on productId membership", () => {
    const spec = { kind: "purchase", productIds: ["69986faa724ecd2343ebaa6e", "69987357c839790426996114"] };
    expect(eventMatches(spec, { kind: "purchase", contactId: "c1", productId: "69986faa724ecd2343ebaa6e" })).toBe(true);
    expect(eventMatches(spec, { kind: "purchase", contactId: "c1", productId: "not-a-series-product" })).toBe(false);
  });

  it("matches tag spec on tag membership", () => {
    const spec = { kind: "tag.added", tags: ["workflow 3 (customer attended 1st session)"] };
    expect(eventMatches(spec, { kind: "tag.added", contactId: "c1", tag: "workflow 3 (customer attended 1st session)" })).toBe(true);
    expect(eventMatches(spec, { kind: "tag.added", contactId: "c1", tag: "quiz submitted" })).toBe(false);
  });

  it("never matches across kinds", () => {
    expect(eventMatches({ kind: "purchase", productIds: ["p"] }, showedDiscovery)).toBe(false);
    expect(eventMatches({ kind: "tag.added", tags: ["t"] }, { kind: "purchase", contactId: "c", productId: "p" })).toBe(false);
  });
});
