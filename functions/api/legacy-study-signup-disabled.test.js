import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ghl.js", () => ({
  ghlFetch: vi.fn(),
  applyTagDelta: vi.fn(),
}));

import { ghlFetch } from "../lib/ghl.js";
import { onRequestPost as elbow } from "./elbow-study-signup.js";
import { onRequestPost as jaw } from "./jaw-study-signup.js";
import { onRequestPost as hand } from "./hand-study-signup.js";
import { onRequestPost as foot } from "./foot-study-signup.js";
import { onRequestPost as shoulder } from "./shoulder-study-signup.js";
import { onRequestPost as legacyBook } from "./study-book.js";

const endpoints = [
  ["tennis-elbow", elbow],
  ["tmj", jaw],
  ["hand", hand],
  ["runners-lower-leg", foot],
  ["desk-shoulders", shoulder],
];

function context() {
  return {
    request: new Request("https://www.amarimethod.com/api/legacy-study", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.amarimethod.com",
      },
      body: JSON.stringify({
        name: "Cached Page",
        phone: "4155550100",
        email: "cached@example.com",
      }),
    }),
    env: {
      PORTAL_KV: {
        get: vi.fn(async () => "0"),
        put: vi.fn(async () => undefined),
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("cached legacy study signup cutoff", () => {
  it.each(endpoints)(
    "keeps %s endpoint non-mutating and points the stale page to canonical booking",
    async (slug, handler) => {
      const response = await handler(context());
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toEqual({
        error: expect.stringContaining("/book/study?study=" + slug),
        bookingUrl: "/book/study?study=" + slug,
        refreshRequired: true,
      });
      expect(ghlFetch).not.toHaveBeenCalled();
    },
  );

  it("keeps the pre-v2 study-book POST non-mutating while allowing a refresh to the canonical page", async () => {
    const response = await legacyBook(context());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: expect.stringContaining("Refresh this page"),
      bookingUrl: "/book/study",
      refreshRequired: true,
    });
    expect(ghlFetch).not.toHaveBeenCalled();
  });
});
