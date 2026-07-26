import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));
vi.mock("../../functions/lib/ghl-worker-token.js", () => ({ getAccessToken: vi.fn().mockResolvedValue("tok") }));

import { handleGhlEvent } from "./ghl-events.js";

const SECRET = "s3cret";
const req = (body, secret = SECRET) =>
  new Request("https://reminder-engine.example/ghl-event", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-Webhook-Secret": secret } : {}) },
    body: JSON.stringify(body),
  });

// Fake D1 covering the purchase-cluster tables + automation_events (same SQL as the libs).
function fakeD1() {
  const timers = new Map();
  const confirms = new Map();
  const lp = new Map();
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO upgrade_offer_timers/.test(sql)) {
        if (timers.has(a[0])) return { meta: { changes: 0 } };
        timers.set(a[0], { contact_id: a[0], due_at: a[2], status: a[3] });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE upgrade_offer_timers SET status = 'cancelled'/.test(sql)) {
        const t = timers.get(a[0]);
        if (t && t.status === "pending") { t.status = "cancelled"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (/INSERT INTO purchase_confirmations/.test(sql)) {
        if (confirms.has(a[0])) return { meta: { changes: 0 } };
        confirms.set(a[0], { ref: a[0], status: a[3] });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO lp_onboarding_sends/.test(sql)) {
        if (lp.has(a[0])) return { meta: { changes: 0 } };
        lp.set(a[0], { contact_id: a[0], status: a[1] });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) { events.push(a); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    },
    async all() { return { results: [] }; },
  });
  return { prepare, _timers: timers, _confirms: confirms, _lp: lp, _events: events };
}

function ghlResponses({ orders, contact } = {}) {
  return vi.fn().mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("/payments/orders")) return new Response(JSON.stringify({ data: orders || [] }), { status: 200 });
    if (u.includes("/contacts/")) return new Response(JSON.stringify({ contact: contact || {} }), { status: 200 });
    if (u.includes("/event")) return new Response(JSON.stringify({ success: true, actions: [{ engine: "nurture", action: "exit" }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

let env, fetchMock;
beforeEach(() => {
  fetchMock = ghlResponses();
  vi.stubGlobal("fetch", fetchMock);
  env = {
    REMINDER_DB: fakeD1(),
    GHL_WEBHOOK_SECRET: SECRET,
    PORTAL_KV: {},
    WORKER_AUTH_SECRET: "bearer",
    NURTURE_ENGINE_URL: "https://nurture-engine.example.workers.dev",
    NURTURE: { fetch: (u, i) => fetchMock(u, i) },
  };
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("handleGhlEvent — auth + validation", () => {
  it("401s a wrong secret; 400s missing contact_id or unknown event type", async () => {
    expect((await handleGhlEvent(req({ contact_id: "c", event: "order" }, "wrong"), env, Date.now())).status).toBe(401);
    expect((await handleGhlEvent(req({ event: "order" }), env, Date.now())).status).toBe(400);
    expect((await handleGhlEvent(req({ contact_id: "c", event: "nope" }), env, Date.now())).status).toBe(400);
  });
});

describe("event: order — payment-link purchase shadow without the Pages push", () => {
  const seriesOrder = {
    _id: "ord_1", status: "completed",
    items: [{ product: { _id: "69986faa724ecd2343ebaa6e" }, price: { _id: "x" } }], // 4-Session Series
  };

  it("resolves the product from the contact's recent orders, forwards the purchase to nurture, and runs the seam", async () => {
    fetchMock = ghlResponses({ orders: [seriesOrder] });
    vi.stubGlobal("fetch", fetchMock);
    env.NURTURE = { fetch: (u, i) => fetchMock(u, i) };
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "order" }), env, Date.now());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actions).toContainEqual(expect.objectContaining({ engine: "nurture", action: "exit" }));
    // the seam recorded a would_send confirmation keyed on the order
    expect(env.REMINDER_DB._confirms.has("order:ord_1")).toBe(true);
    // replay is idempotent
    const res2 = await handleGhlEvent(req({ contact_id: "cont_1", event: "order" }), env, Date.now());
    expect((await res2.json()).seam.confirmation).toBe("duplicate");
  });

  it("no creditable order → captured, 200, nothing recorded", async () => {
    fetchMock = ghlResponses({ orders: [{ _id: "o", items: [{ product: { _id: "not-a-product" } }] }] });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "order" }), env, Date.now());
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("no-creditable-order");
    expect(env.REMINDER_DB._events.some((e) => e[6] === "ghl_event_unmatched")).toBe(true);
  });
});

describe("event: sessions_completed — upgrade-offer timer without the Pages hooks", () => {
  it("schedules the 3-day timer for an eligible contact", async () => {
    fetchMock = ghlResponses({ contact: { tags: ["quiz submitted"], customFields: [{ id: "3i93lTkmuAV49s9nh0q8", value: "" }] } });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "sessions_completed" }), env, Date.now());
    expect(res.status).toBe(200);
    expect((await res.json()).scheduled).toBe(true);
    expect(env.REMINDER_DB._timers.get("cont_1").status).toBe("pending");
  });

  it("guard-ineligible contact (series holder / partner track) → no timer, logged", async () => {
    fetchMock = ghlResponses({ contact: { tags: ["ambassador-prospect"], customFields: [] } });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "sessions_completed" }), env, Date.now());
    expect((await res.json()).scheduled).toBe(false);
    expect(env.REMINDER_DB._timers.size).toBe(0);
  });
});

describe("event: sessions_remaining — LP onboarding without the Pages hooks", () => {
  it("8-session contact at 2 remaining → would_send once", async () => {
    fetchMock = ghlResponses({
      contact: { tags: [], customFields: [{ id: "3i93lTkmuAV49s9nh0q8", value: "8-session" }, { id: "wrQSkx6BhXwDGIn1d0V4", value: "2" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "sessions_remaining" }), env, Date.now());
    expect((await res.json()).lp).toBe("would_send");
    expect(env.REMINDER_DB._lp.has("cont_1")).toBe(true);
  });

  it("non-matching transition → skip", async () => {
    fetchMock = ghlResponses({
      contact: { tags: [], customFields: [{ id: "3i93lTkmuAV49s9nh0q8", value: "4-session" }, { id: "wrQSkx6BhXwDGIn1d0V4", value: "2" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "sessions_remaining" }), env, Date.now());
    expect((await res.json()).lp).toBe("skip");
  });
});

describe("failure containment", () => {
  it("a GHL lookup failure is captured and answered 200 (no retry storm)", async () => {
    fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGhlEvent(req({ contact_id: "cont_1", event: "sessions_completed" }), env, Date.now());
    expect(res.status).toBe(200);
    expect(env.REMINDER_DB._events.some((e) => e[6] === "ghl_event_error")).toBe(true);
  });
});
