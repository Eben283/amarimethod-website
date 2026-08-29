import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireProviderContactIdentity, resolveOwnedContactIdentity } from "./staff-owned-contact-identity.js";

function context(secret = "worker-secret") {
  return { env: secret ? { WORKER_AUTH_SECRET: secret } : {} };
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("Staff owned contact identity", () => {
  it("resolves the stable owned ID while retaining the provider crosswalk server-side", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ contacts: [
      { id: "owned_1", provider_contact_id: "ghl_1", display_name: "Garrett" },
    ] }), { status: 200 }));

    await expect(resolveOwnedContactIdentity(context(), "owned_1")).resolves.toEqual({
      ownedContactId: "owned_1",
      providerContactId: "ghl_1",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://amari-crm-mirror.eben-fa2.workers.dev/contacts?limit=20&query=owned_1",
      expect.objectContaining({ headers: { Authorization: "Bearer worker-secret" } }),
    );
  });

  it("accepts an older provider reference but returns owned command identity", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ contacts: [
      { id: "owned_1", provider_contact_id: "ghl_1" },
    ] }), { status: 200 }));

    await expect(resolveOwnedContactIdentity(context(), "ghl_1")).resolves.toEqual({
      ownedContactId: "owned_1",
      providerContactId: "ghl_1",
    });
  });

  it("fails closed when the owned CRM is unavailable or the exact person is absent", async () => {
    await expect(resolveOwnedContactIdentity(context(""), "owned_1")).rejects.toMatchObject({
      code: "owned_identity_unavailable", status: 503,
    });
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ contacts: [] }), { status: 200 }));
    await expect(resolveOwnedContactIdentity(context(), "owned_1")).rejects.toMatchObject({
      code: "owned_contact_not_found", status: 404,
    });
  });

  it("rejects a reference that exactly identifies more than one owned person", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ contacts: [
      { id: "collision", provider_contact_id: "ghl_1" },
      { id: "owned_2", provider_contact_id: "collision" },
    ] }), { status: 200 }));
    await expect(resolveOwnedContactIdentity(context(), "collision")).rejects.toMatchObject({
      code: "owned_identity_ambiguous", status: 409,
    });
  });

  it("keeps provider absence distinct from owned-person absence", () => {
    try {
      requireProviderContactIdentity({ ownedContactId: "owned_1", providerContactId: null });
      throw new Error("expected provider identity failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "provider_identity_missing", status: 409 });
    }
    expect(requireProviderContactIdentity({ ownedContactId: "owned_1", providerContactId: "ghl_1" }))
      .toBe("ghl_1");
  });
});
