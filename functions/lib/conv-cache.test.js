import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendOutboundTouch, listInboxThreads, summarizeConv } from "./conv-cache.js";

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

  it("lists recent threads from the index and hydrates previews", async () => {
    const store = new Map();
    store.set("conv:index", JSON.stringify({ a: 300, b: 100, c: 200 }));
    store.set("conv:a", JSON.stringify({
      contactId: "a", name: "Alpha", lastMessageDate: 300,
      touches: [{ ts: 300, kind: "sms", dir: "in", text: "Can we move to 4?" }],
    }));
    store.set("conv:b", JSON.stringify({
      contactId: "b", name: "Beta", lastMessageDate: 100,
      touches: [{ ts: 100, kind: "sms", dir: "out", text: "See you then" }],
    }));
    store.set("conv:c", JSON.stringify({
      contactId: "c", name: "Charlie", lastMessageDate: 200,
      touches: [{ ts: 200, kind: "sms", dir: "out", text: "Booked" }],
    }));
    const kv = {
      get: async (key, type) => {
        const raw = store.get(key);
        if (raw == null) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key, value) => { store.set(key, value); },
    };

    const threads = await listInboxThreads(kv, { filter: "all", limit: 10 });
    expect(threads.map((t) => t.contactId)).toEqual(["a", "c", "b"]);
    expect(threads[0].lastMessagePreview).toContain("Can we move");
    expect(threads[0].needsReply).toBe(true);
  });

  it("appends outbound touches and updates the index immediately", async () => {
    const store = new Map();
    store.set("conv:index", JSON.stringify({ c1: 50 }));
    store.set("conv:c1", JSON.stringify({
      contactId: "c1", name: "Michaela", lastMessageDate: 50,
      touches: [{ ts: 50, kind: "sms", dir: "in", text: "Hi" }],
    }));
    const kv = {
      get: async (key, type) => {
        const raw = store.get(key);
        if (raw == null) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      put: async (key, value) => { store.set(key, value); },
    };

    await appendOutboundTouch(kv, "c1", { kind: "sms", text: "Thursday at 3:20 works", ts: 99 });
    const entry = JSON.parse(store.get("conv:c1"));
    expect(entry.touches.at(-1)).toMatchObject({ dir: "out", text: "Thursday at 3:20 works", ts: 99 });
    expect(JSON.parse(store.get("conv:index")).c1).toBe(99);
  });
});
