import { describe, expect, it } from "vitest";
import { dashboardSessionCookie, hasDashboardSession, hasReviewSession, reviewSessionCookie } from "./dashboard-session.js";

const env = { WORKER_AUTH_SECRET: "test-secret" };

describe("CRM mirror dashboard sessions", () => {
  it("issues a signed, HttpOnly read-only session cookie", async () => {
    const cookie = await dashboardSessionCookie(env, 1_000);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    await expect(hasDashboardSession(new Request("https://example.test", { headers: { Cookie: cookie } }), env, 1_001))
      .resolves.toBe(true);
  });

  it("rejects expired or tampered sessions", async () => {
    const cookie = await dashboardSessionCookie(env, 1_000);
    await expect(hasDashboardSession(new Request("https://example.test", { headers: { Cookie: cookie } }), env, 1_000 + 8 * 60 * 60))
      .resolves.toBe(false);
    await expect(hasDashboardSession(new Request("https://example.test", { headers: { Cookie: cookie.replace("a", "b") } }), env, 1_001))
      .resolves.toBe(false);
  });

  it("keeps a short review session separate from the dashboard session", async () => {
    const cookie = await reviewSessionCookie(env, 1_000);
    const request = new Request("https://example.test", { headers: { Cookie: cookie } });
    await expect(hasReviewSession(request, env, 1_001)).resolves.toBe(true);
    await expect(hasDashboardSession(request, env, 1_001)).resolves.toBe(false);
    await expect(hasReviewSession(request, env, 1_000 + 15 * 60)).resolves.toBe(false);
  });
});
