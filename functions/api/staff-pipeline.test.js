import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "Eben" } })),
  corsHeaders: vi.fn(() => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" })),
}));
vi.mock("../lib/ghl.js", () => ({
  getGhlToken: vi.fn(async () => "synthetic-token"),
  ghlHeaders: vi.fn(() => ({})),
}));

import { onRequestGet } from "./staff-pipeline.js";

const context = (stripeKey = "sk_synthetic") => ({
  request: new Request("https://www.amarimethod.com/api/staff-pipeline", {
    headers: { Origin: "https://www.amarimethod.com" },
  }),
  env: {
    STRIPE_SECRET_KEY: stripeKey,
    PORTAL_KV: { get: vi.fn(async () => null) },
  },
});

function successfulFetch() {
  return vi.fn(async (url) => {
    if (String(url).includes("/contacts/search")) {
      return new Response(JSON.stringify({
        contacts: [{
          id: "contact-1",
          firstName: "Ada",
          lastName: "Example",
          email: "ada@example.test",
          tags: ["partner-prospect"],
          dateUpdated: new Date().toISOString(),
          customFields: [{ id: "qKtPT2XZP61emgUDK7fd", value: "1" }],
        }],
      }));
    }
    if (String(url).includes("/calendars/events")) {
      return new Response(JSON.stringify({ events: [] }));
    }
    if (String(url).includes("api.stripe.com/v1/charges")) {
      return new Response(JSON.stringify({ data: [], has_more: false }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

beforeEach(() => vi.stubGlobal("fetch", successfulFetch()));
afterEach(() => vi.unstubAllGlobals());

describe("staff pipeline complete reads", () => {
  it("builds outreach columns from one contact search instead of per-tag searches", async () => {
    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.columns["touch-1"]).toHaveLength(1);
    expect(payload.columns["touch-1"][0].name).toBe("Ada Example");
    expect(payload.cohortMetrics).toBeNull();

    const calls = vi.mocked(fetch).mock.calls;
    const contactCalls = calls.filter(([url]) => String(url).includes("/contacts/search"));
    expect(contactCalls).toHaveLength(1);
    expect(JSON.parse(contactCalls[0][1].body)).toEqual({
      locationId: "7pIO7FHVAyBT1jKGhfQM",
      pageLimit: 100,
      page: 1,
    });
    expect(calls).toHaveLength(14);
  });

  it("returns an honest unavailable state when a required GHL read fails", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("/contacts/search")) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ events: [] }));
    });
    const response = await onRequestGet(context());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Pipeline sources are unavailable. Nothing incomplete was shown. Try again.",
    });
  });

  it("does not show an empty purchase history when Stripe is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("/contacts/search")) return new Response(JSON.stringify({ contacts: [] }));
      if (String(url).includes("/calendars/events")) return new Response(JSON.stringify({ events: [] }));
      if (String(url).includes("api.stripe.com")) return new Response("{}", { status: 503 });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const response = await onRequestGet(context());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("Nothing incomplete was shown");
  });

  it("reports a bounded timeout without returning partial columns", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.mocked(fetch).mockRejectedValue(abort);
    const response = await onRequestGet(context());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Pipeline sources timed out. Nothing incomplete was shown. Try again.",
    });
  });
});
