import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  verifySessionToken: vi.fn(async (token) => token === "staff-token" ? { role: "staff", user: "Eben" } : { role: "portal" }),
}));

import { onRequestGet } from "./staff-calendars.js";

function context(token = null) {
  return {
    request: new Request("https://www.amarimethod.com/api/staff-calendars", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
    env: { JWT_SECRET: "secret" },
  };
}

describe("GET /api/staff-calendars", () => {
  it("keeps the calendar registry staff-authenticated", async () => {
    expect((await onRequestGet(context())).status).toBe(401);
    const response = await onRequestGet(context("staff-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ source: "owned-registry", editable: false });
  });
});
