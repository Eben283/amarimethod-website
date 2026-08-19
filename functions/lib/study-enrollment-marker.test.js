import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ghl.js", () => ({
  applyTagDelta: vi.fn(),
  ghlFetch: vi.fn(),
}));

import { applyTagDelta, ghlFetch } from "./ghl.js";
import {
  STUDY_BOOKING_CONFIRMED_MARKER,
  contactHasStudyBookingConfirmedMarker,
  ensureStudyBookingConfirmedMarker,
} from "./study-enrollment-marker.js";

const jsonResponse = (body = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  applyTagDelta.mockResolvedValue({ added: [STUDY_BOOKING_CONFIRMED_MARKER], removed: [] });
});

describe("post-confirm study enrollment marker", () => {
  it("adds the exact marker and requires provider readback before succeeding", async () => {
    const order = [];
    applyTagDelta.mockImplementation(async () => {
      order.push("add");
      return { added: [STUDY_BOOKING_CONFIRMED_MARKER], removed: [] };
    });
    ghlFetch.mockImplementation(async () => {
      order.push("read");
      return jsonResponse({ contact: { tags: [STUDY_BOOKING_CONFIRMED_MARKER] } });
    });

    await expect(ensureStudyBookingConfirmedMarker({ env: {} }, "contact-1"))
      .resolves.toEqual({ tag: STUDY_BOOKING_CONFIRMED_MARKER, verified: true });
    expect(order).toEqual(["add", "read"]);
    expect(applyTagDelta).toHaveBeenCalledWith(
      expect.anything(),
      "contact-1",
      { add: ["study-booking-confirmed-before-enrollment"] },
    );
    expect(ghlFetch.mock.calls[0][1]).toBe(
      "https://services.leadconnectorhq.com/contacts/contact-1",
    );
  });

  it("accepts provider tag objects but never fuzzy tag names", () => {
    expect(contactHasStudyBookingConfirmedMarker({
      contact: { tags: [{ name: STUDY_BOOKING_CONFIRMED_MARKER }] },
    })).toBe(true);
    expect(contactHasStudyBookingConfirmedMarker({
      contact: { tags: [STUDY_BOOKING_CONFIRMED_MARKER + "-old"] },
    })).toBe(false);
  });

  it("fails closed when readback fails or the marker is absent", async () => {
    ghlFetch.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 500));
    await expect(ensureStudyBookingConfirmedMarker({ env: {} }, "contact-1"))
      .rejects.toThrow("marker readback failed (500)");

    ghlFetch.mockResolvedValueOnce(jsonResponse({ contact: { tags: [] } }));
    await expect(ensureStudyBookingConfirmedMarker({ env: {} }, "contact-1"))
      .rejects.toThrow("marker was not present in provider readback");
  });
});
