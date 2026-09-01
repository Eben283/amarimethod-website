import { describe, it, expect, vi, beforeEach } from "vitest";

import worker from "./index.js";
import { fakeD1 } from "./fake-d1.js";

const SECRET = "test-secret-value";
const post = (path, body, auth) =>
  new Request(`https://nurture-engine.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });

const ownedCrmD1 = (tags = []) => ({
  prepare(sql) {
    return {
      bind() { return this; },
      async all() {
        if (/FROM contacts contact/.test(sql)) {
          return { results: [{ id: "owned-1", first_name: "A", email_normalized: "a@example.com" }] };
        }
        if (/FROM contact_tags/.test(sql)) return { results: tags.map((tag) => ({ tag })) };
        throw new Error(`unexpected owned CRM query: ${sql}`);
      },
    };
  },
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

  it("POST /event reads entry guards from owned CRM even when the legacy GHL token cache is bound", async () => {
    env.CRM_DB = ownedCrmD1(["ambassador-prospect"]);
    env.PORTAL_KV = { get: vi.fn(() => { throw new Error("legacy GHL token cache must not be read"); }) };
    const event = {
      type: "showed", recognized: true, status: "showed",
      calendarId: "USgPsktqRcuomdUgpShL", contactId: "ghl-transition-id",
      appointmentId: "appt-1", startAt: "2026-08-31T10:00:00-07:00", modifiedBy: "user",
    };

    const res = await worker.fetch(post("/event", event, SECRET), env);

    expect(res.status).toBe(200);
    expect((await res.json()).actions).toContainEqual(expect.objectContaining({ action: "guard-blocked" }));
    expect(env.NURTURE_DB._enrollments.size).toBe(0);
    expect(env.PORTAL_KV.get).not.toHaveBeenCalled();
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
