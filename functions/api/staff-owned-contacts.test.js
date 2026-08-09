import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.amarimethod.com" }),
}));

import { requireStaffAuth } from "../lib/endpoint-guards.js";
import { onRequestGet } from "./staff-owned-contacts.js";

function context(query = "Eben", env = { WORKER_AUTH_SECRET: "worker-secret" }) {
  return {
    env,
    request: new Request(`https://www.amarimethod.com/api/staff-owned-contacts?query=${encodeURIComponent(query)}`, {
      headers: { Origin: "https://www.amarimethod.com" },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  requireStaffAuth.mockResolvedValue({ payload: { role: "staff", user: "Eben" } });
});

describe("Staff owned contact search", () => {
  it("returns owned identity plus the provider crosswalk without calling GHL", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ contacts: [{
      id: "contact_1", display_name: "Eben", email_normalized: "eben@example.test",
      phone_e164: "+14155550100", provider_contact_id: "ghl_1",
    }] }), { status: 200 }));

    const response = await onRequestGet(context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{
      id: "contact_1", providerContactId: "ghl_1", name: "Eben",
      email: "eben@example.test", phone: "+14155550100",
    }]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/contacts?limit=20&query=Eben",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret" } }),
    );
  });

  it("fails closed without the Worker credential", async () => {
    const response = await onRequestGet(context("Eben", {}));
    expect(response.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not query storage for a one-character search", async () => {
    const response = await onRequestGet(context("E"));
    expect(await response.json()).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
