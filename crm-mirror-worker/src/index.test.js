import { describe, expect, it } from "vitest";
import { parseSyncRequest } from "./index.js";

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
});
