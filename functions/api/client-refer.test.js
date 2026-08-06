import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/ghl.js", () => ({
  getGhlToken: vi.fn(),
  ghlHeaders: vi.fn(),
}));

import { onRequestPost } from "./client-refer.js";
import { getGhlToken } from "../lib/ghl.js";

describe("POST /api/client-refer", () => {
  it("retires legacy raw-referrer links without reading credentials or writing to GHL", async () => {
    const response = await onRequestPost({
      request: new Request("https://www.amarimethod.com/api/client-refer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrerId: "legacy-contact-id", referredName: "Test", referredPhone: "5555555555" }),
      }),
      env: {},
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "Client referral links are no longer active." });
    expect(getGhlToken).not.toHaveBeenCalled();
  });
});
