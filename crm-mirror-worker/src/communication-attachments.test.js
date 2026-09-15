import { describe, expect, it, vi } from "vitest";
import { serveCommunicationAttachment } from "./communication-attachments.js";

function env(record) {
  return {
    CRM_DB: {
      prepare: () => ({ bind: () => ({ first: async () => record }) }),
    },
  };
}

describe("Client Desk communication attachments", () => {
  it("streams a bounded attachment without exposing its provider locator", async () => {
    const source = "https://files.example.test/private/zach.jpg?signature=secret";
    const fetchImpl = vi.fn(async () => new Response("image-bytes", {
      headers: { "Content-Type": "image/jpeg", "Content-Length": "11" },
    }));
    const response = await serveCommunicationAttachment(env({
      id: "attachment_1", provider: "ghl", provider_locator: source,
      display_name: null, mime_type: null, size_bytes: null,
    }), "attachment_1", { fetchImpl, resolveGhlAttachmentUrl: async () => source });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toBe("image-bytes");
    expect(fetchImpl).toHaveBeenCalledWith(new URL(source), { method: "GET", redirect: "manual" });
  });

  it("fails closed for private hosts, unknown types, and unbounded bodies", async () => {
    const record = { id: "attachment_1", provider: "ghl", provider_locator: "https://files.example.test/a", display_name: null };
    await expect(serveCommunicationAttachment(env(record), "attachment_1", {
      resolveGhlAttachmentUrl: async () => "https://127.0.0.1/private",
      fetchImpl: vi.fn(),
    })).rejects.toMatchObject({ status: 422 });
    await expect(serveCommunicationAttachment(env(record), "attachment_1", {
      resolveGhlAttachmentUrl: async () => "https://files.example.test/private",
      fetchImpl: vi.fn(async () => new Response("x", { headers: { "Content-Type": "text/html", "Content-Length": "1" } })),
    })).rejects.toMatchObject({ status: 415 });
    await expect(serveCommunicationAttachment(env(record), "attachment_1", {
      resolveGhlAttachmentUrl: async () => "https://files.example.test/private",
      fetchImpl: vi.fn(async () => new Response("x", { headers: { "Content-Type": "image/jpeg" } })),
    })).rejects.toMatchObject({ status: 413 });
  });
});
