import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../functions/lib/ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));
vi.mock("../../functions/lib/ghl-worker-token.js", () => ({ getAccessToken: vi.fn().mockResolvedValue("tok") }));

import { handleTagWebhook } from "./tag-bridge.js";
import { fakeD1 } from "./fake-d1.js";

const SECRET = "tag-secret";
const req = (body, secret) =>
  new Request("https://nurture-engine.example/tag-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "X-Webhook-Secret": secret } : {}) },
    body: JSON.stringify(body),
  });

let env, fetchMock;
function contactWith(tags) {
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ contact: { id: "cont_1", tags } }), { status: 200 }),
  );
}
beforeEach(() => {
  env = { NURTURE_DB: fakeD1(), GHL_WEBHOOK_SECRET: SECRET, PORTAL_KV: {} };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("handleTagWebhook — the GHL→code tag bridge (transition window)", () => {
  it("rejects a missing/wrong secret before any read or state change", async () => {
    for (const r of [req({ contact_id: "cont_1" }, null), req({ contact_id: "cont_1" }, "wrong")]) {
      expect((await handleTagWebhook(r, env, Date.now())).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s a body without a contact id", async () => {
    expect((await handleTagWebhook(req({}, SECRET), env, Date.now())).status).toBe(400);
  });

  it("the quiz-submitted tag enrolls Flow 1 (the tag IS the entry signal until the Pages push)", async () => {
    contactWith(["quiz submitted", "pain-severity-moderate"]);
    const res = await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actions).toContainEqual(expect.objectContaining({ action: "enroll", detail: expect.objectContaining({ sequenceId: "flow-1-quiz" }) }));
    expect(env.NURTURE_DB._enrollments.has("flow-1-quiz:cont_1")).toBe(true);
  });

  it("a funnel-advance tag exits the active enrollment (workflow-2 tag → Flow 1 exit)", async () => {
    contactWith(["quiz submitted"]);
    await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    contactWith(["quiz submitted", "booked discovery call - workflow 2"]);
    const res = await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    const body = await res.json();
    expect(body.actions).toContainEqual(expect.objectContaining({ action: "exit", detail: expect.objectContaining({ sequenceId: "flow-1-quiz" }) }));
    expect(env.NURTURE_DB._enrollments.get("flow-1-quiz:cont_1").status).toBe("exited");
  });

  it("re-fires are idempotent — same tags twice, no duplicate enrollments or events", async () => {
    contactWith(["quiz submitted"]);
    await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    const res = await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    expect(res.status).toBe(200);
    expect(env.NURTURE_DB._events.filter((e) => e.action === "enrolled")).toHaveLength(1);
  });

  it("unwatched tags are a clean no-op", async () => {
    contactWith(["some-random-tag"]);
    const res = await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    expect((await res.json()).actions).toEqual([]);
  });

  it("a contact-lookup failure is logged and answered 200 (no GHL retry storm)", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 500 }));
    const res = await handleTagWebhook(req({ contact_id: "cont_1" }, SECRET), env, Date.now());
    expect(res.status).toBe(200);
    expect(env.NURTURE_DB._events.some((e) => e.action === "tag_bridge_error")).toBe(true);
  });
});
