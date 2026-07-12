import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { handleWebhook } from "./webhook.js";

// Same stateful fake D1 shape as engine.test.js — reminder tables + automation_events.
function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO reminder_enrollments/.test(sql)) {
        if (enrollments.has(a[0])) return { meta: { changes: 0 } };
        enrollments.set(a[0], { enrollment_id: a[0], status: a[8] });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO reminder_steps/.test(sql)) { steps.push({ enrollment_id: a[0] }); return { meta: { changes: 1 } }; }
      if (/INSERT INTO automation_events/.test(sql)) {
        const [ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail] = a;
        events.push({ ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
    async all() { return { results: [] }; },
  });
  return { prepare, _enrollments: enrollments, _steps: steps, _events: events };
}

const SECRET = "webhook-secret-value";
// A realistic GHL workflow custom-webhook payload (alias-walker shapes).
const rawPayload = () => ({
  contact_id: "cont_live1",
  appointment: {
    id: "appt_live1",
    calendarId: "G7OAnnJuFbMF6nQSlZVQ",
    appointmentStatus: "confirmed",
    startTime: "2026-07-20T15:00:00-07:00",
  },
  modified_by: "customer",
});

const req = (body, secret, raw = false) =>
  new Request("https://reminder-engine.example/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-Webhook-Secret": secret } : {}) },
    body: raw ? body : JSON.stringify(body),
  });

let env, fetchMock;
beforeEach(() => {
  env = {
    REMINDER_DB: fakeD1(),
    GHL_WEBHOOK_SECRET: SECRET,
    NURTURE_ENGINE_URL: "https://nurture-engine.example.workers.dev",
    WORKER_AUTH_SECRET: "bearer-secret",
  };
  fetchMock = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({ success: true, actions: [{ engine: "nurture", action: "exit" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("handleWebhook — the GHL appointment ingest on the worker (no Pages needed)", () => {
  it("fails closed when no webhook secret is configured", async () => {
    const res = await handleWebhook(req(rawPayload(), SECRET), { REMINDER_DB: fakeD1() }, Date.now());
    expect(res.status).toBe(503);
  });

  it("rejects a missing or wrong X-Webhook-Secret before any state change", async () => {
    for (const r of [req(rawPayload(), null), req(rawPayload(), "wrong")]) {
      const res = await handleWebhook(r, env, Date.now());
      expect(res.status).toBe(401);
    }
    expect(env.REMINDER_DB._enrollments.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s bad JSON", async () => {
    expect((await handleWebhook(req("{not json", SECRET, true), env, Date.now())).status).toBe(400);
  });

  it("a recognized event enrolls locally AND forwards to the nurture engine", async () => {
    const now = Date.parse("2026-07-18T10:00:00-07:00");
    const res = await handleWebhook(req(rawPayload(), SECRET), env, now);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.actions).toContainEqual(expect.objectContaining({ engine: "reminder", action: "enroll" }));
    expect(body.actions).toContainEqual(expect.objectContaining({ engine: "nurture", action: "exit" }));
    expect(env.REMINDER_DB._enrollments.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://nurture-engine.example.workers.dev/event");
  });

  it("an unrecognized payload is captured to automation_events (the gx02 alias check) and skipped", async () => {
    const res = await handleWebhook(req({ some: "unrelated", shape: true }, SECRET), env, Date.now());
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unrecognized");
    const cap = env.REMINDER_DB._events.find((e) => e.action === "ingest_unrecognized");
    expect(cap).toBeDefined();
    expect(JSON.parse(cap.detail).raw).toEqual({ some: "unrelated", shape: true });
    expect(env.REMINDER_DB._enrollments.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a recognized event MISSING key fields still captures the raw payload for alias debugging", async () => {
    const partial = { appointment: { id: "appt_x", appointmentStatus: "confirmed" } }; // no contact/calendar/start
    const res = await handleWebhook(req(partial, SECRET), env, Date.now());
    expect(res.status).toBe(200);
    expect(env.REMINDER_DB._events.some((e) => e.action === "ingest_deficient")).toBe(true);
  });

  it("uses the NURTURE service binding when bound (same-account workers.dev fetches are blocked)", async () => {
    const bindingFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, actions: [] }), { status: 200 }),
    );
    const res = await handleWebhook(req(rawPayload(), SECRET), { ...env, NURTURE: { fetch: bindingFetch } }, Date.now());
    expect(res.status).toBe(200);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled(); // global fetch bypassed
  });

  it("a nurture-forward failure never fails the webhook (GHL must not retry-storm)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const res = await handleWebhook(req(rawPayload(), SECRET), env, Date.now());
    expect(res.status).toBe(200);
    expect((await res.json()).errors).toEqual(["nurture: engine responded 500"]);
  });
});
