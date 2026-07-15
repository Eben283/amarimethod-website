import { describe, it, expect, vi } from "vitest";
import { onRequestGet } from "./heartbeats.js";
import { beatKey, HEARTBEAT_JOBS } from "../lib/heartbeat.js";

// Minimal in-memory KV: get(key,"json") parses stored strings, put(key,val) stores.
function makeKv(store = {}) {
  const put = vi.fn(async (key, val) => {
    store[key] = val;
  });
  const get = vi.fn(async (key, type) => {
    const v = store[key];
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  });
  return { store, get, put };
}

function ctx({ env = {}, headers = {} } = {}) {
  return {
    request: new Request("https://www.amarimethod.com/api/heartbeats", { headers }),
    env,
  };
}

const AUTH = { OPS_READ_KEY: "secret" };
const KEYED = { "X-Service-Key": "secret" };

describe("GET /api/heartbeats", () => {
  it("returns judged beats and writes a fresh self-beat for the 'heartbeat' job", async () => {
    const kv = makeKv();
    const res = await onRequestGet(ctx({ env: { PORTAL_KV: kv, ...AUTH }, headers: KEYED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toHaveLength(HEARTBEAT_JOBS.length);

    // The self-beat write was attempted, under ops:beat:heartbeat.
    expect(kv.put).toHaveBeenCalledWith(beatKey("heartbeat"), expect.any(String));
    const written = JSON.parse(kv.store[beatKey("heartbeat")]);
    expect(written).toMatchObject({ job: "heartbeat", ok: true });
    // producedN is the real count of jobs judged (not inflated by the write).
    expect(written.producedN).toBe(HEARTBEAT_JOBS.length);
  });

  it("judges BEFORE writing: THIS response reflects the PREVIOUS self-beat", async () => {
    const kv = makeKv();
    // First GET has no prior self-beat, so "heartbeat" judges RED (missing run)...
    const first = await (await onRequestGet(ctx({ env: { PORTAL_KV: kv, ...AUTH }, headers: KEYED }))).json();
    const hbFirst = first.checks.find((c) => c.job === "heartbeat");
    expect(hbFirst.state).toBe("red");
    // ...but it wrote a fresh self-beat, so the NEXT GET sees a green heartbeat.
    const second = await (await onRequestGet(ctx({ env: { PORTAL_KV: kv, ...AUTH }, headers: KEYED }))).json();
    const hbSecond = second.checks.find((c) => c.job === "heartbeat");
    expect(hbSecond.state).toBe("green");
  });

  it("a self-beat write failure does not break the GET response", async () => {
    const kv = makeKv();
    kv.put = vi.fn(async () => {
      throw new Error("KV put blew up");
    });
    const res = await onRequestGet(ctx({ env: { PORTAL_KV: kv, ...AUTH }, headers: KEYED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toHaveLength(HEARTBEAT_JOBS.length);
  });

  it("401s when OPS_READ_KEY is configured but not presented", async () => {
    const res = await onRequestGet(ctx({ env: { PORTAL_KV: makeKv(), ...AUTH } }));
    expect(res.status).toBe(401);
  });

  it("503s when OPS_READ_KEY is not configured (fail closed)", async () => {
    const res = await onRequestGet(ctx({ env: {} }));
    expect(res.status).toBe(503);
  });

  it("500s when authorized but PORTAL_KV is not bound", async () => {
    const res = await onRequestGet(ctx({ env: { ...AUTH }, headers: KEYED }));
    expect(res.status).toBe(500);
  });
});
