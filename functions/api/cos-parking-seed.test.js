import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestOptions, onRequestPost } from "./cos-parking-seed.js";

afterEach(() => vi.restoreAllMocks());

describe("COS parking seed", () => {
  it("retains the City's recurrence and holiday fields", async () => {
    let storedIndex = null;
    const env = {
      COS_SERVICE_KEY: "test-service-key",
      PORTAL_KV: {
        get: async () => storedIndex,
        put: async (_key, value) => { storedIndex = value; },
      },
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        cnn: "468000",
        corridor: "10th Ave",
        limits: "Cabrillo St  -  Fulton St",
        cnnrightleft: "R",
        blockside: "West",
        fullname: "Wed 1st & 3rd",
        fromhour: "8",
        tohour: "10",
        week1: "1",
        week2: "0",
        week3: "1",
        week4: "0",
        week5: "0",
        holidays: "0",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));

    const response = await onRequestPost({
      request: new Request("https://example.test/api/cos-parking-seed", {
        method: "POST",
        headers: { "X-Service-Key": "test-service-key" },
      }),
      env,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(storedIndex).rows[0]).toMatchObject({
      c: "468000",
      r: "R",
      s: "10th Ave",
      w: [1, 3],
      h: 0,
    });
  });

  it("returns the expected CORS preflight response", () => {
    const response = onRequestOptions();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.amarimethod.com");
  });
});
