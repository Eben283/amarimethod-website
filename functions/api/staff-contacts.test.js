import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/endpoint-guards.js", () => ({
  requireStaffAuth: vi.fn(async () => ({ error: null, payload: { role: "staff", user: "Eben" } })),
  corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

const ghlFetch = vi.fn();
vi.mock("../lib/ghl.js", () => ({ ghlFetch: (...args) => ghlFetch(...args) }));
vi.mock("../lib/portal-helpers.js", () => ({
  getCustomField: () => null,
}));

describe("staff-contacts search strategies", () => {
  beforeEach(() => {
    vi.resetModules();
    ghlFetch.mockReset();
  });

  it("falls back to GET /contacts/ list when POST query fails", async () => {
    ghlFetch.mockImplementation(async (_ctx, url, opts = {}) => {
      if (String(url).includes("/contacts/search") && opts.method === "POST") {
        return { ok: false, status: 422, text: async () => "bad query body" };
      }
      if (String(url).includes("/contacts/?locationId=")) {
        return {
          ok: true,
          json: async () => ({
            contacts: [{ id: "c1", firstName: "Eben", lastName: "F", email: "e@x.com", phone: "", tags: [] }],
          }),
        };
      }
      if (String(url).includes("/customFields")) {
        return { ok: true, json: async () => ({ customFields: [] }) };
      }
      return { ok: false, status: 500, text: async () => "no" };
    });

    const { onRequestGet } = await import("./staff-contacts.js");
    const res = await onRequestGet({
      request: new Request("https://example.com/api/staff-contacts?query=Eben"),
      env: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      expect.objectContaining({ id: "c1", name: "Eben F", email: "e@x.com" }),
    ]);
  });

  it("uses POST query results when available", async () => {
    ghlFetch.mockImplementation(async (_ctx, url, opts = {}) => {
      if (String(url).includes("/contacts/search") && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        expect(body.query).toBe("Holly");
        return {
          ok: true,
          json: async () => ({
            contacts: [{ id: "c2", firstName: "Holly", lastName: "B", email: "", phone: "", tags: [] }],
          }),
        };
      }
      if (String(url).includes("/customFields")) {
        return { ok: true, json: async () => ({ customFields: [] }) };
      }
      return { ok: false, status: 500, text: async () => "no" };
    });

    const { onRequestGet } = await import("./staff-contacts.js");
    const res = await onRequestGet({
      request: new Request("https://example.com/api/staff-contacts?query=Holly"),
      env: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].name).toBe("Holly B");
  });
});
