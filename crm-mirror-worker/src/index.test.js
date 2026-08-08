import { describe, expect, it } from "vitest";
import worker, { parseClientDeskLimit, parseContactSearch, parseQueueLimit, parseSyncRequest } from "./index.js";

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

  it("loads the complete mirrored contact index without relaxing queue limits", () => {
    expect(parseClientDeskLimit(null)).toBe(1000);
    expect(parseClientDeskLimit("0")).toBe(1);
    expect(parseClientDeskLimit("1500")).toBe(1000);
    expect(parseQueueLimit("1500")).toBe(50);
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
    const embedHandoff = await worker.fetch(new Request(`${embedBody.url}?embed=1&parent_origin=${encodeURIComponent("https://www.amarimethod.com")}`), env);
    expect(embedHandoff.status).toBe(302);
    expect(embedHandoff.headers.get("Location")).toBe("/?embed=1&parent_origin=https%3A%2F%2Fwww.amarimethod.com");

    const mintedUntrustedEmbed = await worker.fetch(new Request("https://crm.test/dashboard-access-link", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const untrustedEmbedBody = await mintedUntrustedEmbed.json();
    const untrustedEmbedHandoff = await worker.fetch(new Request(`${untrustedEmbedBody.url}?embed=1&parent_origin=${encodeURIComponent("https://example.com")}`), env);
    expect(untrustedEmbedHandoff.headers.get("Location")).toBe("/?embed=1");

    const deskMinted = await worker.fetch(new Request("https://crm.test/dashboard-access-link?view=client-desk", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const deskBody = await deskMinted.json();
    const deskHandoff = await worker.fetch(new Request(`${deskBody.url}?contact=person_123`), env);
    expect(deskHandoff.headers.get("Location")).toBe("/client-desk?contact=person_123");
    const desk = await worker.fetch(new Request("https://crm.test/client-desk", {
      headers: { Cookie: deskHandoff.headers.get("Set-Cookie") },
    }), env);
    expect(desk.headers.get("Content-Security-Policy")).toContain("https://amarimethod-website.pages.dev");
  });

  it("keeps sender readiness behind staff authentication", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret" };
    const denied = await worker.fetch(new Request("https://crm.test/sender/readiness"), env);
    expect(denied.status).toBe(401);

    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/sender/readiness", {
      headers: { Cookie: session.headers.get("Set-Cookie") },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "staff_email", deliveryEnabled: false });
  });

  it("does not expose the former Client Desk email-send route to a staff browser session", async () => {
    const env = { WORKER_AUTH_SECRET: "test-secret" };
    const session = await worker.fetch(new Request("https://crm.test/dashboard-session", {
      method: "POST", headers: { Authorization: "Bearer test-secret" },
    }), env);
    const response = await worker.fetch(new Request("https://crm.test/client-desk/contacts/contact-1/email", {
      method: "POST",
      headers: {
        Cookie: session.headers.get("Set-Cookie"),
        Origin: "https://crm.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subject: "Private test", body: "Must not send" }),
    }), env);
    expect(response.status).toBe(401);
  });

  it("serves aggregate CRM readiness only behind the existing auth boundary", async () => {
    const fresh = new Date().toISOString();
    const results = [
      [{ completed_at: "2026-08-01T12:00:00.000Z", records_seen: 400, known_records: 400, missing_records: 0 }],
      [{ completed_at: "2026-08-01T12:00:00.000Z", records_seen: 55, known_records: 55, missing_records: 0 }],
      [{ status: "partial", finished_at: fresh, failure_detail: null }],
      [{ status: "succeeded", finished_at: fresh, failure_detail: null }],
      [{ count: 396 }], [{ count: 1694 }], [{ count: 0 }],
      [{ result: "ready", checked_at: "2026-07-27T18:10:04.000Z" }],
      [],
    ];
    const env = {
      WORKER_AUTH_SECRET: "test-secret",
      CRM_DB: {
        prepare: (sql) => ({ sql }),
        batch: async (statements) => statements.map((_statement, index) => ({ results: results[index] })),
      },
    };
    const denied = await worker.fetch(new Request("https://crm.test/readiness"), env);
    expect(denied.status).toBe(401);

    const response = await worker.fetch(new Request("https://crm.test/readiness", {
      headers: { Authorization: "Bearer test-secret" },
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      worker: "amari-crm-mirror",
      shadowOnly: true,
      completeness: { ghl: { state: "complete" }, stripe: { state: "complete" } },
      recovery: { result: "ready" },
      currentSyncOverall: "healthy",
    });
  });
});
