import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/owned-access.js", () => ({
  loadOwnedContact: vi.fn(),
}));

vi.mock("../lib/ghl.js", () => ({
  ghlHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  getGhlToken: vi.fn(),
}));

import { onRequestPost } from "./affiliate-refer.js";
import { loadOwnedContact } from "../lib/owned-access.js";
import { getGhlToken } from "../lib/ghl.js";

function context(body, headers = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/affiliate-refer", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env: { JWT_SECRET: "test-secret" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/affiliate-refer", () => {
  it("requires the existing Partner Portal ownership gate before any GHL credential access", async () => {
    loadOwnedContact.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    });

    const response = await onRequestPost(context({
      affiliateRef: "forged-partner",
      clientFirstName: "Test",
      clientPhone: "5555555555",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
    expect(loadOwnedContact).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      audience: "partner",
      requireTag: "affiliate-partner",
    });
    expect(getGhlToken).not.toHaveBeenCalled();
  });

  it("derives the referral identity and payout attribution from the signed-in partner, not the request body", async () => {
    loadOwnedContact.mockResolvedValue({
      tokenPayload: { type: "partner", contactId: "partner-contact", email: "garrett@example.test" },
      contactId: "partner-contact",
      contact: { firstName: "Garrett", email: "garrett@example.test", tags: ["affiliate-partner"] },
      ghlToken: "test-ghl-token",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ contact: { id: "referred-contact" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost(context({
      affiliateRef: "Forged Identity",
      affiliateName: "Forged Identity",
      affiliateEmail: "forged@example.test",
      clientFirstName: "Referred",
      clientPhone: "5555555555",
    }, { Authorization: "Bearer partner-session" }));

    expect(response.status).toBe(200);
    const upsert = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(upsert.source).toBe("Affiliate Referral - Garrett");
    expect(upsert.customFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_value: "partner-contact" }),
      expect.objectContaining({ field_value: "Garrett" }),
    ]));
    expect(JSON.stringify(upsert)).not.toContain("Forged Identity");
  });
});
