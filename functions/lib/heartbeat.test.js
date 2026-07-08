import { describe, it, expect } from "vitest";
import {
  makeBeat,
  writeBeat,
  judgeBeat,
  readAndJudgeBeats,
  beatKey,
  isRegisteredJob,
  HEARTBEAT_JOBS,
} from "./heartbeat.js";

const CFG = { job: "funnel-refresh", label: "Funnel refresh", maxAgeH: 3, producedNoun: "rows" };
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("makeBeat", () => {
  it("stamps the given ranAt and coerces producedN / ok", () => {
    const at = "2026-07-08T00:00:00.000Z";
    expect(makeBeat("j", { producedN: 5, ok: true }, at)).toEqual({ job: "j", ranAt: at, producedN: 5, ok: true });
  });
  it("defaults a non-finite producedN to 0 and ok to true", () => {
    const b = makeBeat("j", { producedN: undefined }, "x");
    expect(b.producedN).toBe(0);
    expect(b.ok).toBe(true);
  });
});

describe("judgeBeat", () => {
  it("green when recent, ok, and produced > 0", () => {
    const r = judgeBeat(CFG, makeBeat(CFG.job, { producedN: 42 }, isoAgo(30 * MIN)));
    expect(r.state).toBe("green");
    expect(r.note).toContain("42 rows");
  });

  it("RED when the beat is missing (null) — the missing-run case", () => {
    const r = judgeBeat(CFG, null);
    expect(r.state).toBe("red");
    expect(r.note).toMatch(/no beat/i);
  });

  it("RED when the job ran but produced nothing (producedN 0) — the empty-output case", () => {
    const r = judgeBeat(CFG, makeBeat(CFG.job, { producedN: 0 }, isoAgo(30 * MIN)));
    expect(r.state).toBe("red");
    expect(r.note).toMatch(/produced nothing/i);
  });

  it("RED when the last run reported failure (ok:false)", () => {
    const r = judgeBeat(CFG, makeBeat(CFG.job, { producedN: 5, ok: false }, isoAgo(30 * MIN)));
    expect(r.state).toBe("red");
    expect(r.note).toMatch(/failure/i);
  });

  it("RED when stale (older than maxAgeH) even if it produced output", () => {
    const r = judgeBeat(CFG, makeBeat(CFG.job, { producedN: 5 }, isoAgo(5 * HOUR)));
    expect(r.state).toBe("red");
    expect(r.note).toMatch(/stale/i);
  });

  it("unknown (not red) when the record is unreadable (undefined)", () => {
    const r = judgeBeat(CFG, undefined);
    expect(r.state).toBe("unknown");
  });
});

// The two jobs added for the advisory system-health checkpoint. Both are judged
// by the same judgeBeat, so these confirm they're wired into the registry with
// the states /day relies on: fresh+ok+produced>0 green, ok:false red (stray
// literal), missing red (checker/self-beat never ran).
describe("field-id-check + heartbeat jobs", () => {
  const FIELD = HEARTBEAT_JOBS.find((j) => j.job === "field-id-check");
  const HB = HEARTBEAT_JOBS.find((j) => j.job === "heartbeat");

  it("both jobs are registered", () => {
    expect(isRegisteredJob("field-id-check")).toBe(true);
    expect(isRegisteredJob("heartbeat")).toBe(true);
  });

  it("field-id-check: green when fresh, ok, and files were scanned", () => {
    const r = judgeBeat(FIELD, makeBeat(FIELD.job, { producedN: 214, ok: true }, isoAgo(2 * HOUR)));
    expect(r.state).toBe("green");
    expect(r.note).toContain("214 files scanned");
  });

  it("field-id-check: RED when ok:false (a stray literal exists)", () => {
    const r = judgeBeat(FIELD, makeBeat(FIELD.job, { producedN: 214, ok: false }, isoAgo(2 * HOUR)));
    expect(r.state).toBe("red");
    expect(r.note).toMatch(/failure/i);
  });

  it("field-id-check: RED when the beat is missing (checker never ran)", () => {
    expect(judgeBeat(FIELD, null).state).toBe("red");
  });

  it("heartbeat: green when fresh, ok, and jobs were judged", () => {
    const r = judgeBeat(HB, makeBeat(HB.job, { producedN: 5, ok: true }, isoAgo(2 * HOUR)));
    expect(r.state).toBe("green");
    expect(r.note).toContain("5 jobs judged");
  });

  it("heartbeat: RED when ok:false", () => {
    expect(judgeBeat(HB, makeBeat(HB.job, { producedN: 5, ok: false }, isoAgo(2 * HOUR))).state).toBe("red");
  });

  it("heartbeat: RED when the self-beat is missing (judge path never ran)", () => {
    expect(judgeBeat(HB, null).state).toBe("red");
  });
});

describe("writeBeat + readAndJudgeBeats over a mock KV", () => {
  // Minimal in-memory KV: get(key,"json") parses, put(key,val) stores string.
  const makeKv = () => {
    const store = new Map();
    return {
      store,
      async get(key, type) {
        const v = store.get(key);
        if (v === undefined) return null; // KV returns null for missing keys
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(key, val) {
        store.set(key, val);
      },
    };
  };

  it("writeBeat persists under ops:beat:<job> and reads back", async () => {
    const kv = makeKv();
    await writeBeat(kv, "funnel-refresh", { producedN: 10 });
    const raw = kv.store.get(beatKey("funnel-refresh"));
    expect(JSON.parse(raw)).toMatchObject({ job: "funnel-refresh", producedN: 10, ok: true });
  });

  it("overall is RED when any registered job has no beat", async () => {
    const kv = makeKv();
    // Only write a healthy beat for the first job; the rest are missing.
    await writeBeat(kv, HEARTBEAT_JOBS[0].job, { producedN: 7 });
    const { overall, checks } = await readAndJudgeBeats(kv);
    expect(checks).toHaveLength(HEARTBEAT_JOBS.length);
    expect(overall).toBe("red");
    expect(checks.filter((c) => c.state === "red").length).toBeGreaterThan(0);
  });

  it("overall is GREEN when every registered job has a fresh, non-empty beat", async () => {
    const kv = makeKv();
    for (const j of HEARTBEAT_JOBS) await writeBeat(kv, j.job, { producedN: 3 });
    const { overall } = await readAndJudgeBeats(kv);
    expect(overall).toBe("green");
  });
});

describe("isRegisteredJob", () => {
  it("accepts registered jobs and rejects unknown ones", () => {
    expect(isRegisteredJob("funnel-refresh")).toBe(true);
    expect(isRegisteredJob("not-a-job")).toBe(false);
  });
});
