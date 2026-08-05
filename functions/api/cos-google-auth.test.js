import { describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./cos-google-auth.js";

async function token(payload, secret = "test-secret") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

function context({ request, env = {} } = {}) {
  return {
    request: request || new Request("https://www.amarimethod.com/api/cos-google-auth", { method: "POST" }),
    env: {
      JWT_SECRET: "test-secret",
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      PORTAL_KV: { put: vi.fn() },
      ...env,
    },
  };
}

describe("POST /api/cos-google-auth", () => {
  it("creates a signed-in Eben-only, one-time Google Workspace consent URL", async () => {
    const auth = await token({ role: "cos", user: "Eben", exp: Date.now() + 60_000 });
    const ctx = context({
      request: new Request("https://www.amarimethod.com/api/cos-google-auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, Origin: "https://www.amarimethod.com" },
      }),
    });

    const response = await onRequestPost(ctx);
    expect(response.status).toBe(200);
    const { authorizationUrl } = await response.json();
    const url = new URL(authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.amarimethod.com/api/cos-google-callback");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic");
    expect(url.searchParams.get("state")).toHaveLength(64);
    expect(ctx.env.PORTAL_KV.put).toHaveBeenCalledWith(
      `cos:google-oauth:${url.searchParams.get("state")}`,
      expect.stringContaining('"user":"Eben"'),
      { expirationTtl: 600 },
    );
  });

  it("rejects a non-Eben COS session", async () => {
    const auth = await token({ role: "cos", user: "Garrett", exp: Date.now() + 60_000 });
    const response = await onRequestPost(context({
      request: new Request("https://www.amarimethod.com/api/cos-google-auth", { method: "POST", headers: { Authorization: `Bearer ${auth}` } }),
    }));
    expect(response.status).toBe(401);
  });
});
