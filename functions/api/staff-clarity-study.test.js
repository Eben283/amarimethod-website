import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({ verifySessionToken: vi.fn(async () => ({ role: "staff" })) }));

import { onRequestGet, summarizeClarity } from "./staff-clarity-study.js";

const AUTH = { Authorization: "Bearer staff-token" };
afterEach(() => vi.restoreAllMocks());
const traffic = {
  metricName: "Traffic",
  information: [
    { URL: "https://www.amarimethod.com/book/study", Source: "Google", Device: "Mobile", totalSessionCount: "3", distinctUserCount: "2", totalBotSessionCount: "0" },
    { URL: "https://www.amarimethod.com/book/study/", Source: "Direct", Device: "Desktop", totalSessionCount: "1", distantUserCount: "1", totalBotSessionCount: "0" },
    { URL: "https://www.amarimethod.com/book/other", Source: "Google", Device: "Mobile", totalSessionCount: "99" },
  ],
};

function context({ url = "https://www.amarimethod.com/api/staff-clarity-study?days=3", token = "token" } = {}) {
  return { request: new Request(url, { headers: AUTH }), env: { JWT_SECRET: "jwt", CLARITY_API_TOKEN: token } };
}

describe("summarizeClarity", () => {
  it("keeps only study-booking rows and groups traffic", () => {
    const report = summarizeClarity([traffic, { metricName: "Rage Click Count", information: [{ URL: "https://www.amarimethod.com/book/study", count: "2" }] }, { metricName: "Referrer URL", information: [{ URL: "https://www.amarimethod.com/book/study", "Referrer URL": "https://google.com", count: "3" }] }], 3);
    expect(report.visits).toBe(4);
    expect(report.uniqueVisitors).toBe(3);
    expect(report.referrerSource).toEqual(expect.arrayContaining([expect.objectContaining({ source: "Google", device: "Mobile", sessions: 3 })]));
    expect(report.deviceType).toEqual(expect.arrayContaining([expect.objectContaining({ device: "Desktop", sessions: 1 })]));
    expect(report.interactionSignals).toEqual([{ name: "Rage Click Count", count: 2 }]);
    expect(report.referrerUrl).toEqual([{ referrer: "https://google.com", sessions: 3 }]);
  });
});

describe("staff-clarity-study endpoint", () => {
  it("requires staff auth before contacting Clarity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await onRequestGet({ request: new Request("https://www.amarimethod.com/api/staff-clarity-study"), env: { JWT_SECRET: "jwt", CLARITY_API_TOKEN: "token" } });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses server-side bearer auth and returns a safe 403 diagnosis", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));
    const res = await onRequestGet(context());
    expect(res.status).toBe(502);
    expect(fetchSpy.mock.calls[0][0]).toContain("project-live-insights?numOfDays=3&dimension1=URL&dimension2=Source&dimension3=Device");
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
    expect(JSON.stringify(await res.json())).not.toContain("Bearer token");
  });

  it("rejects unsupported date windows without calling Clarity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await onRequestGet(context({ url: "https://www.amarimethod.com/api/staff-clarity-study?days=4" }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
