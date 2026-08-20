import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import {
  _resetGhlProviderGateForTests,
  _setGhlProviderTimingForTests,
  fetchGhlAppointmentsForContact,
  fetchGhlContact,
  fetchGhlContactExists,
  fetchGhlContactNotes,
  fetchGhlContactTasks,
  fetchGhlContactsPage,
  fetchGhlConversationsPage,
  fetchStripeCustomer,
  fetchStripeInvoicesPage,
} from "./providers.js";

const env = {
  GHL_LOCATION_ID: "location_1",
  PORTAL_KV: {
    get: vi.fn(async (key) => (key === "ghl_access_token" ? "token" : String(Date.now() + 3_600_000))),
  },
};

describe("GHL contact pagination", () => {
  beforeEach(() => {
    _resetForTests();
    _resetGhlProviderGateForTests();
    _setGhlProviderTimingForTests({ minIntervalMs: 0, sleep: async () => {}, random: () => 0 });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        contacts: [{ id: "contact_1" }, { id: "contact_2" }],
        meta: { startAfterId: "cursor_id_1", startAfter: 1720000000000 },
      }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetForTests();
    _resetGhlProviderGateForTests();
  });

  it("persists and replays GHL's paired pagination cursor", async () => {
    const first = await fetchGhlContactsPage(env, null, 2);
    expect(first.nextCursor).toBe('{"afterId":"cursor_id_1","after":1720000000000}');

    await fetchGhlContactsPage(env, first.nextCursor, 2);
    const secondUrl = new URL(fetch.mock.calls[1][0]);
    expect(secondUrl.searchParams.get("startAfterId")).toBe("cursor_id_1");
    expect(secondUrl.searchParams.get("startAfter")).toBe("1720000000000");
  });

  it("restarts once rather than using the legacy id-only cursor", async () => {
    await fetchGhlContactsPage(env, "legacy-contact-id", 2);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.has("startAfterId")).toBe(false);
    expect(url.searchParams.has("startAfter")).toBe(false);
  });

  it("uses GHL's conversation sort cursor instead of an unsupported page number", async () => {
    fetch.mockResolvedValueOnce(Response.json({
      conversations: [
        { id: "thread_1", lastMessageDate: 1_721_000_000_000 },
        { id: "thread_2", lastMessageDate: 1_720_000_000_000 },
      ],
    }));

    const first = await fetchGhlConversationsPage(env, null, 2);
    expect(first.nextCursor).toBe("1720000000000");
    let url = new URL(fetch.mock.calls.at(-1)[0]);
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("startAfterDate")).toBe(false);

    fetch.mockResolvedValueOnce(Response.json({ conversations: [] }));
    await fetchGhlConversationsPage(env, first.nextCursor, 2);
    url = new URL(fetch.mock.calls.at(-1)[0]);
    expect(url.searchParams.get("startAfterDate")).toBe(first.nextCursor);
  });

  it("restarts instead of sending a legacy synthetic page number to GHL", async () => {
    fetch.mockResolvedValueOnce(Response.json({ conversations: [] }));

    await fetchGhlConversationsPage(env, "1041", 50);

    const url = new URL(fetch.mock.calls.at(-1)[0]);
    expect(url.searchParams.has("startAfterDate")).toBe(false);
  });

  it("accepts GHL appointment responses in their events shape", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [{ id: "appointment_1" }] }),
    });
    await expect(fetchGhlAppointmentsForContact(env, "contact_1")).resolves.toEqual([{ id: "appointment_1" }]);
  });

  it("reads contact notes and tasks without injecting a location parameter", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ notes: [{ id: "note_1" }] }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [{ id: "task_1" }] }) });
    await expect(fetchGhlContactNotes(env, "contact_1")).resolves.toEqual([{ id: "note_1" }]);
    await expect(fetchGhlContactTasks(env, "contact_1")).resolves.toEqual([{ id: "task_1" }]);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has("locationId")).toBe(false);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.has("locationId")).toBe(false);
  });

  it("treats deleted GHL contacts as absent for completeness cleanup", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "Contact not found for id:gone", statusCode: 400 }),
    });
    await expect(fetchGhlContactExists(env, "gone")).resolves.toBe(false);

    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ contact: { id: "alive" } }) });
    await expect(fetchGhlContactExists(env, "alive")).resolves.toBe(true);
  });

  it("reads a Stripe customer only when a source charge needs identity evidence", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cus_1", email: "ada@example.com" }) });
    await expect(fetchStripeCustomer({ STRIPE_SECRET_KEY: "sk_test" }, "cus_1"))
      .resolves.toMatchObject({ id: "cus_1", email: "ada@example.com" });
    expect(fetch.mock.calls[0][0]).toContain("/customers/cus_1");
  });

  it("paginates Stripe invoices independently from settled charges", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "in_1" }], has_more: true }) });
    const page = await fetchStripeInvoicesPage({ STRIPE_SECRET_KEY: "sk_test" }, null, 25);
    expect(page).toEqual({ invoices: [{ id: "in_1" }], nextCursor: "in_1" });
    expect(fetch.mock.calls[0][0]).toContain("/invoices?");
  });

  it("retries a 429 using Retry-After before returning the same GHL read", async () => {
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      sleep: async (ms) => waits.push(ms),
      random: () => 0,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "1" },
      }))
      .mockResolvedValueOnce(Response.json({ contacts: [{ id: "contact_1" }] }));

    const page = await fetchGhlContactsPage(env, null, 50);

    expect(page.contacts).toEqual([{ id: "contact_1" }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    expect(waits).toEqual([1_000]);
  });

  it("supports HTTP-date Retry-After and the GHL interval header fallback", async () => {
    const now = Date.parse("2026-08-05T17:00:00Z");
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      now: () => now,
      sleep: async (ms) => waits.push(ms),
      random: () => 0,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": new Date(now + 2_000).toUTCString() },
      }))
      .mockResolvedValueOnce(Response.json({ contacts: [] }));

    await fetchGhlContactsPage(env, null, 50);
    expect(waits).toEqual([2_000]);

    _resetGhlProviderGateForTests();
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      now: () => now,
      sleep: async (ms) => waits.push(ms),
      random: () => 0,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "X-RateLimit-Interval-Milliseconds": "750" },
      }))
      .mockResolvedValueOnce(Response.json({ contacts: [] }));

    await fetchGhlContactsPage(env, null, 50);
    expect(waits).toEqual([2_000, 750]);
  });

  it("allows the documented ten-second server window before adding bounded jitter", async () => {
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      sleep: async (ms) => waits.push(ms),
      random: () => 0.5,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "10" },
      }))
      .mockResolvedValueOnce(Response.json({ contacts: [] }));

    await fetchGhlContactsPage(env, null, 50);
    expect(waits).toEqual([10_050]);
    expect(fetch).toHaveBeenCalledTimes(2);

    _resetGhlProviderGateForTests();
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      sleep: async (ms) => waits.push(ms),
      random: () => 0.5,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "X-RateLimit-Interval-Milliseconds": "10000" },
      }))
      .mockResolvedValueOnce(Response.json({ contacts: [] }));

    await fetchGhlContactsPage(env, null, 50);
    expect(waits).toEqual([10_050, 10_050]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses bounded full jitter when GHL sends no retry timing", async () => {
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      sleep: async (ms) => waits.push(ms),
      random: () => 0.5,
    });
    fetch
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ contacts: [] }));

    await fetchGhlContactsPage(env, null, 50);
    expect(waits).toEqual([125]);
  });

  it("defers to the next sync instead of waiting beyond the invocation cap", async () => {
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      maxRetryDelayMs: 500,
      sleep: async (ms) => waits.push(ms),
      random: () => 0,
    });
    fetch.mockResolvedValue(new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "2" },
    }));

    await expect(fetchGhlContactsPage(env, null, 50))
      .rejects.toThrow("retryAfterMs=2000");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("stops after three 429 attempts and exposes only sanitized rate metadata", async () => {
    const waits = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 0,
      sleep: async (ms) => waits.push(ms),
      random: () => 0,
    });
    fetch.mockResolvedValue(new Response("private response body", {
      status: 429,
      headers: {
        "Retry-After": "0.25",
        "X-RateLimit-Max": "100",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Daily-Remaining": "199000",
      },
    }));

    const error = await fetchGhlAppointmentsForContact(env, "private-contact-id")
      .then(() => null, (caught) => caught);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([250, 250]);
    expect(error.message).toContain("GHL read failed (429");
    expect(error.message).toContain("max=100");
    expect(error.message).toContain("remaining=0");
    expect(error.message).not.toContain("private-contact-id");
    expect(error.message).not.toContain("private response body");
  });

  it("does not retry non-429 client errors", async () => {
    fetch.mockResolvedValue(new Response("bad request", { status: 400 }));

    await expect(fetchGhlContactsPage(env, null, 50)).rejects.toThrow("GHL read failed (400)");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the same 429 retry boundary for contact-existence probes", async () => {
    fetch
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "0" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(fetchGhlContactExists(env, "contact_1")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent GHL reads through one paced provider gate", async () => {
    let now = 1_000;
    const startedAt = [];
    _setGhlProviderTimingForTests({
      minIntervalMs: 200,
      now: () => now,
      sleep: async (ms) => { now += ms; },
      random: () => 0,
    });
    fetch.mockImplementation(async () => {
      startedAt.push(now);
      return Response.json({ contact: { id: "contact_1" }, notes: [], tasks: [] });
    });

    await Promise.all([
      fetchGhlContact(env, "contact_1"),
      fetchGhlContactNotes(env, "contact_1"),
      fetchGhlContactTasks(env, "contact_1"),
    ]);

    expect(startedAt).toEqual([1_000, 1_200, 1_400]);
  });
});
