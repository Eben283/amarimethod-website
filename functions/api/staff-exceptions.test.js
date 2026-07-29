import { describe, it, expect, vi, beforeEach } from "vitest";
import { humanizeOpsError, isOpsErrKey } from "../lib/staff-exceptions.js";

describe("humanizeOpsError", () => {
  it("turns paid-without-book into a plain sentence with client actions", () => {
    const item = humanizeOpsError({
      key: "ops:err:2026-07-29T10:00:00.000Z-abc",
      source: "ghl-purchase-webhook",
      summary: "Assessment payment received, but appointment did not auto-book",
      detail: { contactId: "c1", product: "Amari Assessment" },
      at: "2026-07-29T10:00:00.000Z",
    });
    expect(item.kind).toBe("break");
    expect(item.title).toMatch(/Paid for Amari Assessment/i);
    expect(item.title).toMatch(/no appointment/i);
    expect(item.contactId).toBe("c1");
    expect(item.actions).toContain("open_client");
    expect(item.actions).toContain("open_ghl");
    expect(item.actions).toContain("dismiss");
  });

  it("flags balance update failures as money with balances action", () => {
    const item = humanizeOpsError({
      key: "ops:err:x",
      source: "ghl-purchase-webhook",
      summary: "GHL field update failed — payment received, sessions_remaining NOT updated",
      detail: { contactId: "c2", product: "8-Pack" },
    });
    expect(item.kind).toBe("money");
    expect(item.actions).toContain("open_balances");
  });

  it("always allows dismiss even without a contactId", () => {
    const item = humanizeOpsError({
      key: "ops:err:y",
      source: "appointment-webhook",
      summary: "Unhandled boom",
      detail: {},
    });
    expect(item.contactId).toBeNull();
    expect(item.actions).toEqual(["dismiss"]);
  });
});

describe("isOpsErrKey", () => {
  it("only accepts ops:err keys", () => {
    expect(isOpsErrKey("ops:err:2026-07-29T10:00:00.000Z-abc")).toBe(true);
    expect(isOpsErrKey("staff:garrett-tasks")).toBe(false);
    expect(isOpsErrKey("")).toBe(false);
  });
});

describe("staff-exceptions API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns newest-first humanized items for staff", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
      parseJsonBody: vi.fn(),
    }));
    vi.doMock("../lib/ops-alert.js", () => ({
      listOpsErrors: vi.fn(async () => ([
        {
          key: "ops:err:2026-07-29T09:00:00.000Z-old",
          source: "ghl-purchase-webhook",
          summary: "Assessment payment received, but appointment did not auto-book",
          detail: { contactId: "old", product: "Assessment" },
          at: "2026-07-29T09:00:00.000Z",
        },
        {
          key: "ops:err:2026-07-29T11:00:00.000Z-new",
          source: "ghl-purchase-webhook",
          summary: "Assessment payment received, but appointment did not auto-book",
          detail: { contactId: "new", product: "Assessment" },
          at: "2026-07-29T11:00:00.000Z",
        },
      ])),
      clearOpsError: vi.fn(),
    }));

    const { onRequestGet } = await import("./staff-exceptions.js");
    const res = await onRequestGet({
      request: new Request("https://example.com/api/staff-exceptions"),
      env: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.items[0].contactId).toBe("new");
    expect(body.items[0].title).toMatch(/no appointment/i);
  });

  it("POST dismiss clears a valid ops:err key", async () => {
    const clearOpsError = vi.fn(async () => {});
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
      parseJsonBody: vi.fn(async () => ({
        body: { action: "dismiss", key: "ops:err:2026-07-29T11:00:00.000Z-new" },
        error: null,
      })),
    }));
    vi.doMock("../lib/ops-alert.js", () => ({
      listOpsErrors: vi.fn(),
      clearOpsError,
    }));

    const { onRequestPost } = await import("./staff-exceptions.js");
    const res = await onRequestPost({
      request: new Request("https://example.com/api/staff-exceptions", { method: "POST" }),
      env: { PORTAL_KV: {} },
    });
    expect(res.status).toBe(200);
    expect(clearOpsError).toHaveBeenCalledWith(
      { PORTAL_KV: {} },
      "ops:err:2026-07-29T11:00:00.000Z-new",
    );
  });

  it("POST rejects non-ops keys", async () => {
    vi.doMock("../lib/endpoint-guards.js", () => ({
      requireStaffAuth: vi.fn(async () => ({ error: null, payload: { user: "eben" } })),
      corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
      parseJsonBody: vi.fn(async () => ({
        body: { action: "dismiss", key: "staff:garrett-tasks" },
        error: null,
      })),
    }));
    vi.doMock("../lib/ops-alert.js", () => ({
      listOpsErrors: vi.fn(),
      clearOpsError: vi.fn(),
    }));

    const { onRequestPost } = await import("./staff-exceptions.js");
    const res = await onRequestPost({
      request: new Request("https://example.com/api/staff-exceptions", { method: "POST" }),
      env: {},
    });
    expect(res.status).toBe(400);
  });
});
