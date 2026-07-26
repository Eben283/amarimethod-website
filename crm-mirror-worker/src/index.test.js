import { describe, expect, it } from "vitest";
import { parseContactSearch, parseQueueLimit, parseSyncRequest } from "./index.js";

describe("CRM mirror request validation", () => {
  it("uses bounded, read-only defaults", () => {
    expect(parseSyncRequest({})).toEqual({ sources: ["ghl", "stripe"], limit: 25 });
    expect(parseSyncRequest({ sources: ["stripe", "stripe"], limit: 999 })).toEqual({
      sources: ["stripe"], limit: 50,
    });
  });

  it("rejects an empty or unsupported source set", () => {
    expect(() => parseSyncRequest({ sources: ["gmail"] })).toThrow("sources must contain ghl and/or stripe");
  });

  it("does not make reconciliation a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation"] })).toThrow("sources must contain ghl and/or stripe");
  });

  it("bounds the protected reconciliation review queue", () => {
    expect(parseQueueLimit(null)).toBe(25);
    expect(parseQueueLimit("0")).toBe(1);
    expect(parseQueueLimit("99")).toBe(50);
  });

  it("requires a bounded contact search term", () => {
    expect(parseContactSearch(null)).toBeNull();
    expect(() => parseContactSearch("x")).toThrow("search needs at least 2 characters");
    expect(parseContactSearch("  Eben  ")).toBe("Eben");
    expect(parseContactSearch("a".repeat(120))).toHaveLength(100);
  });

  it("does not make approval actions a sync source", () => {
    expect(() => parseSyncRequest({ sources: ["reconciliation-review"] })).toThrow("sources must contain ghl and/or stripe");
  });
});
