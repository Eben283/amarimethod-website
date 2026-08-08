import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "./cos-actions.js";

const JWT_SECRET = "test-jwt-secret";

async function tokenFor(user) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ role: "cos", user, exp: Date.now() + 60_000 }));
  const bytes = new TextEncoder().encode(`${header}.${payload}`);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return `${header}.${payload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

function kvWith(actionsByKey = {}) {
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    kv: {
      get: async (key) => { reads.push(key); return actionsByKey[key] || null; },
      put: async (key, value) => { writes.push([key, value]); },
    },
  };
}

function context(path, { token, serviceKey, kv, body } = {}) {
  const headers = new Headers({ Origin: "https://www.amarimethod.com" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (serviceKey) headers.set("X-Service-Key", serviceKey);
  if (body) headers.set("Content-Type", "application/json");
  return {
    request: new Request(`https://www.amarimethod.com/api/cos-actions${path}`, {
      method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined,
    }),
    env: { JWT_SECRET, COS_SERVICE_KEY: "service-secret", PORTAL_KV: kv },
  };
}

describe("CoS action queue authorization", () => {
  it("allows a signed CoS user to read only their own queue", async () => {
    const store = kvWith({ "cos:actions:Garrett:pending": JSON.stringify([{ id: "g-1" }]) });
    const response = await onRequestGet(context("", { token: await tokenFor("Garrett"), kv: store.kv }));

    expect(response.status).toBe(200);
    expect(store.reads).toEqual(["cos:actions:Garrett:pending"]);
    expect(await response.json()).toEqual({ actions: [{ id: "g-1" }] });
  });

  it("rejects a cross-user browser GET before storage access", async () => {
    const store = kvWith();
    const response = await onRequestGet(context("?user=Eben", { token: await tokenFor("Garrett"), kv: store.kv }));

    expect(response.status).toBe(403);
    expect(store.reads).toEqual([]);
  });

  it("rejects a cross-user browser POST before storage mutation", async () => {
    const store = kvWith();
    const response = await onRequestPost(context("", {
      token: await tokenFor("Garrett"), kv: store.kv,
      body: { user: "Eben", actionId: "e-1", status: "completed" },
    }));

    expect(response.status).toBe(403);
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it("permits the inbox service to name a documented queue only", async () => {
    const store = kvWith({ "cos:actions:Eben:pending": JSON.stringify([{ id: "e-1" }]) });
    const allowed = await onRequestGet(context("?user=Eben", { serviceKey: "service-secret", kv: store.kv }));
    const denied = await onRequestGet(context("?user=other", { serviceKey: "service-secret", kv: store.kv }));

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ actions: [{ id: "e-1" }] });
    expect(denied.status).toBe(403);
    expect(store.reads).toEqual(["cos:actions:Eben:pending"]);
  });
});
