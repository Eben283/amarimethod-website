import { describe, it, expect, beforeEach } from "vitest";
import {
  appendTrailEvent,
  listTrailEvents,
  upsertTrailIncident,
  listTrailIncidents,
  countTrailIncidentsByPath,
  resolveTrailIncidents,
} from "./ops-trail-kv.js";

function memoryKv() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v == null) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    async put(key, value) {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
  };
}

describe("ops-trail-kv", () => {
  let env;
  beforeEach(() => {
    env = { PORTAL_KV: memoryKv() };
  });

  it("appends and lists events newest first", async () => {
    await appendTrailEvent(env, {
      id: "e1",
      pathId: "assessment_paid_book",
      hopId: "payment",
      outcome: "ok",
      summary: "paid",
      at: "2026-07-29T10:00:00.000Z",
      atMs: 1,
    });
    await appendTrailEvent(env, {
      id: "e2",
      pathId: "assessment_paid_book",
      hopId: "create_appointment",
      outcome: "fail",
      summary: "no slot",
      at: "2026-07-29T10:01:00.000Z",
      atMs: 2,
    });
    const rows = await listTrailEvents(env, { pathId: "assessment_paid_book" });
    expect(rows.map((r) => r.id)).toEqual(["e2", "e1"]);
  });

  it("upserts incidents and counts by path", async () => {
    await upsertTrailIncident(env, {
      id: "i1",
      pathId: "assessment_paid_book",
      status: "open",
      title: "Paid, no book",
      openedAtMs: 10,
    });
    expect(await countTrailIncidentsByPath(env)).toEqual({ assessment_paid_book: 1 });
    const open = await listTrailIncidents(env, { status: "open" });
    expect(open[0].title).toBe("Paid, no book");
  });

  it("resolves by correlation", async () => {
    await upsertTrailIncident(env, {
      id: "i1",
      pathId: "assessment_paid_book",
      status: "open",
      correlationId: "order:1",
      openedAtMs: 1,
    });
    const r = await resolveTrailIncidents(env, {
      pathId: "assessment_paid_book",
      correlationId: "order:1",
    });
    expect(r.resolved).toBe(1);
    expect(await listTrailIncidents(env, { status: "open" })).toHaveLength(0);
  });
});
