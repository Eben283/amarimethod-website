import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalendarEventAt, getGoogleToken } from "./google-api.js";

afterEach(() => vi.restoreAllMocks());

describe("scheduled Google Calendar events", () => {
  it("refreshes Garrett's governed calendar grant with the Amari-internal client", async () => {
    const store = new Map([
      ["google:garrett:refresh_token", "garrett-refresh"],
      ["google:garrett:token_expiry", "0"],
    ]);
    const context = {
      env: {
        AMARI_MAIL_GOOGLE_OAUTH_CLIENT_ID: "amari-internal-client",
        AMARI_MAIL_GOOGLE_OAUTH_CLIENT_SECRET: "amari-internal-secret",
        GOOGLE_OAUTH_CLIENT_ID: "personal-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "personal-secret",
        PORTAL_KV: {
          get: vi.fn(async (key) => store.get(key) || null),
          put: vi.fn(async (key, value) => store.set(key, value)),
        },
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "fresh-garrett-access",
      expires_in: 3600,
    }), { status: 200 }));

    await expect(getGoogleToken(context, "Garrett")).resolves.toBe("fresh-garrett-access");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("client_id")).toBe("amari-internal-client");
    expect(body.get("client_secret")).toBe("amari-internal-secret");
    expect(body.get("refresh_token")).toBe("garrett-refresh");
    expect(store.get("google:garrett:access_token")).toBe("fresh-garrett-access");
  });

  it("creates a Pacific parking event at the requested time with its requested warning", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "parking-event-id",
      summary: "Move car — 727 10th Ave",
      start: { dateTime: "2026-08-16T09:00:00-07:00" },
    }), { status: 200 }));
    const context = {
      env: {
        PORTAL_KV: {
          get: vi.fn(async key => key === "google:eben:access_token" ? "test-access-token" : String(Date.now() + 60 * 60 * 1000)),
        },
      },
    };

    await expect(createCalendarEventAt(
      context,
      "Eben",
      "Move car — 727 10th Ave",
      "2026-08-16T09:00:00",
      0,
      "Street sweeping: 1st and 3rd Monday, 8am–10am — east side (SF Public Works)",
    )).resolves.toMatchObject({ id: "parking-event-id" });

    const [, request] = fetchMock.mock.calls[0];
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toMatchObject({
      summary: "Move car — 727 10th Ave",
      start: { dateTime: "2026-08-16T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-08-16T09:15:00-07:00", timeZone: "America/Los_Angeles" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    });
  });
});
