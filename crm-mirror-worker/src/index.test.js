import { describe, expect, it } from "vitest";
import worker, { parseContactSearch, parseQueueLimit, parseSyncRequest } from "./index.js";

describe("CRM mirror request validation", () => {
  it("uses bounded, read-only defaults", () => {
    expect(parseSyncRequest({})).toEqual({ sources: ["ghl", "stripe", "stripe-invoices"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["stripe", "stripe"], limit: 999 })).toEqual({
      sources: ["stripe"], limit: 50, pages: 8,
    });
  });

  it("rejects an empty or unsupported source set", () => {
    expect(() => parseSyncRequest({ sources: ["gmail"] })).toThrow("sources must contain ghl, ghl-conversations, ghl-message-export, ghl-client-records, stripe, and/or stripe-invoices");
    expect(parseSyncRequest({ sources: ["ghl-conversations"] })).toEqual({ sources: ["ghl-conversations"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-message-export"], pages: 99 })).toEqual({ sources: ["ghl-message-export"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["ghl-client-records"] })).toEqual({ sources: ["ghl-client-records"], limit: 25, pages: 8 });
    expect(parseSyncRequest({ sources: ["stripe-invoices"] })).toEqual({ sources: ["stripe-invoices"], limit: 25, pages: 8 });
  });

  it("does not make reconciliation a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation"] })).toThrow("sources must contain ghl, ghl-conversations, ghl-message-export, ghl-client-records, stripe, and/or stripe-invoices");
  });

  it("bounds the protected reconciliation review queue", () => {
    expect(parseQueueLimit(null)).toBe(25);
    expect(parseQueueLimit("0")).toBe(1);
    expect(parseQueueLimit("99")).toBe(50);
  });

  it("requires a bounded contact search term", () => {
    expect(parseContactSearch(null)).toBeNull();
    expect(() => parseContactSearch("x")).toThrow("search needs at least 2 characters");
    expect(parseContactSearch("  Eben  ")).toBe("Eben");
    expect(parseContactSearch("a".repeat(120))).toHaveLength(100);
  });

  it("does not make approval actions a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation-review"] })).toThrow("sources must contain ghl, ghl-conversations, ghl-message-export, ghl-client-records, stripe, and/or stripe-invoices");
  });
});

describe("CRM mirror dashboard access handoff", () => {
  it("exchanges an opaque one-time link for an HttpOnly dashboard session without exposing the bearer secret", async () => {
    const values = new Map();
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      PORTAL_KV: {
        put: async (key, value) => values.set(key, value),
        get: async (key) => values.get(key) || null,
        delete: async (key) => values.delete(key),
      },
    };
    const minted = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret", "X-Staff-Actor": "Garrett" },
    }), env);
    expect(minted.status).toBe(200);
    const body = await minted.json();
    expect(body.url).toContain("/dashboard-access/");
    expect(body.url).not.toContain("test-secret");
    const handoff = await worker.fetch(new Request(body.url), env);
    expect(handoff.status).toBe(302);
    expect(handoff.headers.get("Location")).toBe("/");
    expect(handoff.headers.get("Set-Cookie")).toContain("HttpOnly");
    const replay = await worker.fetch(new Request(body.url), env);
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain("expired");

    const mintedEmbed = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const embedBody = await mintedEmbed.json();
    const embedHandoff = await worker.fetch(new Request(`${embedBody.url}?embed=1`), env);
    expect(embedHandoff.status).toBe(302);
    expect(embedHandoff.headers.get("Location")).toBe("/?embed=1");

    const deskMinted = await worker.fetch(new Request("https://crm.test/dashboard-access-link?view=client-desk", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const deskBody = await deskMinted.json();
    const deskHandoff = await worker.fetch(new Request(deskBody.url), env);
    expect(deskHandoff.headers.get("Location")).toBe("/client-desk");
  });
});
