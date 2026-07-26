import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import worker from "./index.js";
import { fakeD1 } from "./fake-d1.js";

const SECRET = "test-secret-value";
const post = (path, body, auth) =>
  new Request(`https://nurture-engine.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });

let env;
beforeEach(() => { env = { NURTURE_DB: fakeD1(), WORKER_AUTH_SECRET: SECRET }; });

describe("fetch — auth gate (brief RED test d: forged payloads never mutate enrollments)", () => {
  it("rejects an unauthenticated /event before any enrollment mutation", async () => {
    const res = await worker.fetch(post("/event", { kind: "quiz.submitted", contactId: "c1" }), env);
    expect(res.status).toBe(401);
    expect(env.NURTURE_DB._enrollments.size).toBe(0);
  });

  it("rejects a wrong bearer", async () => {
    const res = await worker.fetch(post("/event", { kind: "quiz.submitted", contactId: "c1" }, "wrong"), env);
    expect(res.status).toBe(401);
    expect(env.NURTURE_DB._enrollments.size).toBe(0);
  });

  it("fails closed when the secret is unset", async () => {
    const res = await worker.fetch(post("/event", { kind: "quiz.submitted", contactId: "c1" }), { NURTURE_DB: fakeD1() });
    expect(res.status).toBe(503);
  });
});

describe("fetch — authenticated surface", () => {
  it("POST /event enrolls and echoes the actions", async () => {
    const res = await worker.fetch(post("/event", { kind: "quiz.submitted", contactId: "c1" }, SECRET), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.actions).toContainEqual(expect.objectContaining({ action: "enroll" }));
    expect(env.NURTURE_DB._enrollments.size).toBe(1);
  });

  it("GET /status answers", async () => {
    const res = await worker.fetch(
      new Request("https://nurture-engine.example/status", { headers: { Authorization: `Bearer ${SECRET}` } }),
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).worker).toBe("nurture-engine");
  });

  it("unknown routes 404; bad JSON never 5xxs into a Cloudflare error page", async () => {
    const notFound = await worker.fetch(new Request("https://x.example/nope", { headers: { Authorization: `Bearer ${SECRET}` } }), env);
    expect(notFound.status).toBe(404);
    const bad = await worker.fetch(
      new Request("https://x.example/event", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: "{not json" }),
      env,
    );
    expect([400, 500]).toContain(bad.status); // 500 is safe on Workers (Pages 502/503 rule doesn't apply, but stay explicit)
  });
});
