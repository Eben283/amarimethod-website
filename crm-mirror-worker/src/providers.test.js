import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests } from "../../functions/lib/ghl-worker-token.js";
import { fetchGhlAppointmentsForContact, fetchGhlContactsPage } from "./providers.js";

const env = {
  GHL_LOCATION_ID: "location_1",
  PORTAL_KV: {
    get: vi.fn(async (key) => (key === "ghl_access_token" ? "token" : String(Date.now() + 3_600_000))),
  },
};

describe("GHL contact pagination", () => {
  beforeEach(() => {
    _resetForTests();
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

  it("accepts GHL appointment responses in their events shape", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [{ id: "appointment_1" }] }),
    });
    await expect(fetchGhlAppointmentsForContact(env, "contact_1")).resolves.toEqual([{ id: "appointment_1" }]);
  });
});
