import { describe, expect, it } from "vitest";
import { appendOutboundTouch, listInboxThreads, summarizeConv } from "./conv-cache.js";

function mockKv(store) {
  return {
    get: async (key, type) => {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    put: async (key, value) => { store.set(key, value); },
  };
}

describe("conv-cache", () => {
  it("marks needsReply only for real inbound human messages", () => {
    const needs = summarizeConv({
      contactId: "c1",
      name: "Michaela",
      lastMessageDate: 100,
      touches: [{ ts: 100, kind: "sms", dir: "in", text: "Does Thursday still work?" }],
    });
    expect(needs.needsReply).toBe(true);
    expect(needs.lastMessageDirection).toBe("inbound");

    const closer = summarizeConv({
      contactId: "c1",
      name: "Michaela",
      lastMessageDate: 100,
      touches: [{ ts: 100, kind: "sms", dir: "in", text: "Thanks!" }],
    });
    expect(closer.needsReply).toBe(false);
  });

  it("lists every cached thread newest → oldest (no active-window cutoff)", async () => {
    const now = Date.now();
    const oldTs = now - 120 * 24 * 60 * 60 * 1000; // ~120 days ago — previously hidden by ACTIVE_MS
    const store = new Map();
    store.set("conv:index", JSON.stringify({ a: now, b: oldTs, c: now - 1000 }));
    store.set("conv:a", JSON.stringify({
      contactId: "a", name: "Alpha", lastMessageDate: now,
      touches: [{ ts: now, kind: "sms", dir: "in", text: "Can we move to 4?" }],
    }));
    store.set("conv:b", JSON.stringify({
      contactId: "b", name: "Beta", lastMessageDate: oldTs,
      touches: [{ ts: oldTs, kind: "sms", dir: "out", text: "See you then" }],
    }));
    store.set("conv:c", JSON.stringify({
      contactId: "c", name: "Charlie", lastMessageDate: now - 1000,
      touches: [{ ts: now - 1000, kind: "sms", dir: "out", text: "Booked" }],
    }));

    const threads = await listInboxThreads(mockKv(store), { filter: "all", limit: 10 });
    expect(threads.map((t) => t.contactId)).toEqual(["a", "c", "b"]);
    expect(threads[0].lastMessagePreview).toContain("Can we move");
    expect(threads[0].needsReply).toBe(true);
    expect(threads.at(-1).contactId).toBe("b");
  });

  it("defaults to all threads and treats active as an all alias", async () => {
    const now = Date.now();
    const oldTs = now - 90 * 24 * 60 * 60 * 1000;
    const store = new Map();
    store.set("conv:index", JSON.stringify({ fresh: now, quiet: oldTs }));
    store.set("conv:fresh", JSON.stringify({
      contactId: "fresh", name: "Fresh", lastMessageDate: now,
      touches: [{ ts: now, kind: "sms", dir: "out", text: "Hi" }],
    }));
    store.set("conv:quiet", JSON.stringify({
      contactId: "quiet", name: "Quiet", lastMessageDate: oldTs,
      touches: [{ ts: oldTs, kind: "sms", dir: "in", text: "Old note" }],
    }));
    const kv = mockKv(store);

    const byDefault = await listInboxThreads(kv, { limit: 10 });
    const asActive = await listInboxThreads(kv, { filter: "active", limit: 10 });
    expect(byDefault.map((t) => t.contactId)).toEqual(["fresh", "quiet"]);
    expect(asActive.map((t) => t.contactId)).toEqual(["fresh", "quiet"]);
  });

  it("appends outbound SMS touches and updates the index immediately", async () => {
    const store = new Map();
    store.set("conv:index", JSON.stringify({ c1: 50 }));
    store.set("conv:c1", JSON.stringify({
      contactId: "c1", name: "Michaela", lastMessageDate: 50,
      touches: [{ ts: 50, kind: "sms", dir: "in", text: "Hi" }],
    }));
    const kv = mockKv(store);

    await appendOutboundTouch(kv, "c1", { kind: "sms", text: "Thursday at 3:20 works", ts: 99 });
    const entry = JSON.parse(store.get("conv:c1"));
    expect(entry.touches.at(-1)).toMatchObject({ dir: "out", kind: "sms", text: "Thursday at 3:20 works", ts: 99 });
    expect(JSON.parse(store.get("conv:index")).c1).toBe(99);
  });

  it("appends outbound email touches for the inbox cache", async () => {
    const store = new Map();
    store.set("conv:index", JSON.stringify({ c1: 50 }));
    store.set("conv:c1", JSON.stringify({
      contactId: "c1", name: "Michaela", lastMessageDate: 50,
      touches: [{ ts: 50, kind: "sms", dir: "in", text: "Hi" }],
    }));
    const kv = mockKv(store);

    await appendOutboundTouch(kv, "c1", { kind: "email", text: "Looking forward to Thursday", ts: 120 });
    const entry = JSON.parse(store.get("conv:c1"));
    expect(entry.touches.at(-1)).toMatchObject({ dir: "out", kind: "email", text: "Looking forward to Thursday", ts: 120 });
    expect(JSON.parse(store.get("conv:index")).c1).toBe(120);

    const threads = await listInboxThreads(kv, { filter: "all" });
    expect(threads[0].lastMessageType).toBe("Email");
    expect(threads[0].lastMessagePreview).toContain("Looking forward");
  });
});
