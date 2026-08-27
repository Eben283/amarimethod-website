import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_FAMILY } from "../../functions/lib/reliability-contract.js";
import { planFollowUpCoverageSelection } from "../../functions/lib/follow-up-coverage-selection.js";

const cutoff = { receivedStart: 100, receivedEnd: 200, ingestedStart: 100, ingestedEnd: 200, plannedAt: 300, maxPages: 4, maxCandidates: 20 };
const source = { sourceEventId: "src-a", family: FOLLOW_UP_FAMILY, receivedAt: 150 };
const lifecycle = { lifecycleInstanceId: "life-a", sourceEventId: "src-a", state: "active", retentionUntil: 400 };
const obligation = { obligationId: "obl-a", lifecycleInstanceId: "life-a", state: "pending", deadlineAt: 900, retentionUntil: 1000 };
function page(overrides = {}) { return { snapshotId: "snapshot-a", receivedStart: 100, receivedEnd: 200, ingestedStart: 100, ingestedEnd: 200, cursor: null, nextCursor: null, sources: [structuredClone(source)], lifecycles: [structuredClone(lifecycle)], obligations: [structuredClone(obligation)], exceptions: [], evidence: [], anomalies: [], ...overrides }; }
function input(overrides = {}) { return { cutoff: { ...cutoff }, snapshotPages: { pages: [page()], traversalComplete: true }, previousCarryForward: { candidates: [], cursor: null }, ...overrides }; }

describe("Follow-Up coverage selection source-only planner", () => {
  it("selects new and unresolved stable identities with permanent false authority", async () => {
    const result = await planFollowUpCoverageSelection(input());
    expect(result).toMatchObject({ status: "selected", inputPaginationComplete: true, authoritativeCoverage: false, simulation: true, sourceOnly: true, authority: false, dispatchAllowed: false, outcomeProven: false });
    expect(result.candidates.map((item) => item.candidateId)).toEqual(["lifecycle:life-a", "obligation:obl-a", "source:src-a"]);
  });
  it("keeps an old source with future due unresolved obligation across windows", async () => {
    const value = input(); value.snapshotPages.pages[0].sources[0] = { ...source, receivedAt: 99 };
    expect((await planFollowUpCoverageSelection(value)).candidates.map((item) => item.reasonCodes)).toContainEqual(["unresolved_obligation"]);
  });
  it("selects late ingested exact evidence without substituting provider event time", async () => {
    const value = input(); value.snapshotPages.pages[0].evidence = [{ evidenceId: "ev-a", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 150, eventAt: 1 }];
    expect((await planFollowUpCoverageSelection(value)).candidates.find((item) => item.candidateId === "evidence:ev-a").reasonCodes).toEqual(["late_linked_evidence"]);
  });
  it("keeps same appointment-like independent source identities separate", async () => {
    const value = input(); value.snapshotPages.pages[0].sources.push({ sourceEventId: "src-b", family: FOLLOW_UP_FAMILY, receivedAt: 150 });
    expect((await planFollowUpCoverageSelection(value)).candidates.map((item) => item.candidateId)).toContain("source:src-b");
  });
  it("is stable across row and page order", async () => {
    const one = input();
    one.snapshotPages.pages = [page({ nextCursor: "p2", sources: [source, { ...source, sourceEventId: "src-b" }] }),
      page({ cursor: "p2", sources: [{ ...source, sourceEventId: "src-c" }, { ...source, sourceEventId: "src-d" }] })];
    const two = structuredClone(one); two.snapshotPages.pages.reverse();
    for (const p of two.snapshotPages.pages) p.sources.reverse();
    const a = await planFollowUpCoverageSelection(one); const b = await planFollowUpCoverageSelection(two);
    expect(a.status).toBe("selected"); expect(a.candidates.length).toBe(6);
    expect(b).toEqual(a);
  });
  it("round trips 200 carried identities including a 200-character entity ID", async () => {
    const value = input(); value.cutoff.maxCandidates = 200;
    value.snapshotPages.pages = [page({ sources: [], lifecycles: [], obligations: [], anomalies: Array.from({ length: 200 }, (_, i) => ({ family: FOLLOW_UP_FAMILY, entityType: "source", entityId: i === 0 ? "x".repeat(200) : `id-${i}`, reasonCode: "terminal_anomaly" })) })];
    const first = await planFollowUpCoverageSelection(value); expect(first.candidates).toHaveLength(200);
    value.previousCarryForward.candidates = first.retainedCarryForward;
    const second = await planFollowUpCoverageSelection(value);
    expect(second.status).toBe("selected"); expect(second.candidates).toHaveLength(200);
    expect(second.candidates.every((c) => !c.reasonCodes.includes("candidate_missing"))).toBe(true);
    value.cutoff.maxCandidates = 199;
    expect(await planFollowUpCoverageSelection(value)).toMatchObject({ status: "incomplete", replacementAllowed: false, retainPreviousCarryForward: true, continuationCursor: null });
  });
  it.each(["cycle", "disconnected", "duplicate-root", "snapshot", "window"])("rejects invalid %s chains without a usable cursor", async (variant) => {
    const value = input(); value.snapshotPages.pages = [page({ nextCursor: "p2" }), page({ cursor: "p2" })];
    if (variant === "cycle") value.snapshotPages.pages[1].nextCursor = "p2";
    if (variant === "disconnected") value.snapshotPages.pages[1].cursor = "other";
    if (variant === "duplicate-root") value.snapshotPages.pages[1].cursor = null;
    if (variant === "snapshot") value.snapshotPages.pages[1].snapshotId = "different";
    if (variant === "window") value.snapshotPages.pages[1].receivedStart = 0;
    expect(await planFollowUpCoverageSelection(value)).toMatchObject({ status: "incomplete", continuationCursor: null, replacementAllowed: false, retainPreviousCarryForward: true, inputDigestSha256: null });
  });
  it("returns only a snapshot-and-window-bound diagnostic continuation for a rooted partial chain", async () => {
    const value = input(); value.snapshotPages.traversalComplete = false; value.snapshotPages.pages[0].nextCursor = "p2";
    expect(await planFollowUpCoverageSelection(value)).toMatchObject({ status: "incomplete", replacementAllowed: false, retainPreviousCarryForward: true, continuationCursor: { snapshotId: "snapshot-a", receivedStart: 100, receivedEnd: 200, ingestedStart: 100, ingestedEnd: 200, nextCursor: "p2" } });
    value.previousCarryForward.cursor = "unbound";
    expect((await planFollowUpCoverageSelection(value)).continuationCursor).toBeNull();
  });
  it.each([0, 99, 100, 199, 200, 300])("uses exact half-open received/ingested boundaries at %i", async (clock) => {
    const value = input(); value.snapshotPages.pages[0].sources[0].receivedAt = clock;
    value.snapshotPages.pages[0].evidence = [{ evidenceId: "ev", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: clock, eventAt: 0 }];
    const result = await planFollowUpCoverageSelection(value); expect(result.status).toBe("selected");
    expect(result.candidates.some((c) => c.kind === "source")).toBe(clock >= 100 && clock < 200);
    expect(result.candidates.some((c) => c.kind === "evidence")).toBe(clock >= 100 && clock < 200);
  });
  it("accepts a zero lower bound and rejects zero-width windows", async () => {
    const value = input(); value.cutoff.receivedStart = 0; value.cutoff.ingestedStart = 0;
    Object.assign(value.snapshotPages.pages[0], { receivedStart: 0, ingestedStart: 0 }); value.snapshotPages.pages[0].sources[0].receivedAt = 0;
    expect((await planFollowUpCoverageSelection(value)).candidates.some((c) => c.kind === "source")).toBe(true);
    value.cutoff.receivedEnd = 0; expect((await planFollowUpCoverageSelection(value)).inputDigestSha256).toBeNull();
  });
  it("canonicalizes exact duplicate rows and carry reason ordering while rejecting exception/evidence conflicts", async () => {
    const value = input(); const p = value.snapshotPages.pages[0];
    p.exceptions = [{ exceptionId: "exc", family: FOLLOW_UP_FAMILY, state: "open", retentionUntil: 400 }];
    p.evidence = [{ evidenceId: "ev", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 150, eventAt: 1 }];
    const base = await planFollowUpCoverageSelection(value);
    for (const key of ["sources", "lifecycles", "obligations", "exceptions", "evidence"]) p[key].push(structuredClone(p[key][0]));
    expect(await planFollowUpCoverageSelection(value)).toEqual(base);
    p.exceptions[1].state = "resolved"; expect((await planFollowUpCoverageSelection(value)).inputDigestSha256).toBeNull();
    p.exceptions[1].state = "open"; p.evidence[1].eventAt = 2; expect((await planFollowUpCoverageSelection(value)).inputDigestSha256).toBeNull();
    const carried = input(); carried.previousCarryForward.candidates = [{ candidateId: "source:src-a", kind: "source", identity: "src-a", family: FOLLOW_UP_FAMILY, reasonCodes: ["carry_forward", "new_source"], unresolved: true }];
    const before = await planFollowUpCoverageSelection(carried);
    carried.previousCarryForward.candidates[0].reasonCodes = ["new_source", "carry_forward", "new_source"];
    expect(await planFollowUpCoverageSelection(carried)).toEqual(before);
  });
  it("accumulates missing-parent, expired and terminal reasons and uses inventory rather than selected rows", async () => {
    const value = input(); const p = value.snapshotPages.pages[0]; p.sources[0].receivedAt = 1;
    p.lifecycles[0] = { ...lifecycle, sourceEventId: "missing", state: "completed", retentionUntil: 300 };
    value.previousCarryForward.candidates = [{ candidateId: "source:src-a", kind: "source", identity: "src-a", family: FOLLOW_UP_FAMILY, reasonCodes: ["new_source"], unresolved: true }, { candidateId: "source:gone", kind: "source", identity: "gone", family: FOLLOW_UP_FAMILY, reasonCodes: ["new_source"], unresolved: true }];
    const r = await planFollowUpCoverageSelection(value);
    expect(r.candidates.find((c) => c.kind === "lifecycle").reasonCodes).toEqual(["missing_parent", "retention_expired", "unsupported_terminal_state"]);
    expect(r.candidates.find((c) => c.identity === "src-a").reasonCodes).not.toContain("candidate_missing");
    expect(r.candidates.find((c) => c.identity === "gone").reasonCodes).toContain("candidate_missing");
  });
  it("does not lose a pending sibling when another obligation is terminal", async () => {
    const value = input(); value.snapshotPages.pages[0].obligations.push({ ...obligation, obligationId: "done", state: "satisfied" });
    const r = await planFollowUpCoverageSelection(value);
    expect(r.candidates.find((c) => c.identity === "obl-a").reasonCodes).toContain("unresolved_obligation");
    expect(r.candidates.find((c) => c.identity === "done").reasonCodes).toContain("unsupported_terminal_state");
  });
  it("retains all unresolved orphan/expiry reasons without mutation or network", async () => {
    const value = input(); value.snapshotPages.pages[0].obligations[0] = { ...obligation, lifecycleInstanceId: "missing", retentionUntil: 300 };
    const before = structuredClone(value); const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const result = await planFollowUpCoverageSelection(value);
      expect(result.candidates.find((c) => c.identity === "obl-a").reasonCodes).toEqual(["missing_parent", "retention_expired", "unresolved_obligation"]);
      expect(value).toEqual(before); expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it.each(["top", "state", "reasons", "foreign-id", "hidden", "symbol", "array-property"])("rejects %s accessors/unsupported properties without calling getters", async (variant) => {
    const value = input(); const getter = vi.fn(() => "active");
    if (variant === "top") Object.defineProperty(value, "cutoff", { enumerable: true, get: getter });
    if (variant === "state") value.snapshotPages.pages[0].lifecycles[0].state = Object.defineProperty({}, "x", { enumerable: true, get: getter });
    if (variant === "reasons") {
      const reasons = ["new_source"]; Object.defineProperty(reasons, "0", { enumerable: true, get: getter });
      value.previousCarryForward.candidates = [{ candidateId: "source:x", kind: "source", identity: "x", family: FOLLOW_UP_FAMILY, reasonCodes: reasons, unresolved: true }];
    }
    if (variant === "foreign-id") value.snapshotPages.pages[0].evidence = [{ evidenceId: "ev", sourceEventId: Object.defineProperty({}, "x", { enumerable: true, get: getter }), lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 150, eventAt: 0 }];
    if (variant === "hidden") Object.defineProperty(value.cutoff, "hidden", { value: 1 });
    if (variant === "symbol") value.snapshotPages.pages[0][Symbol("hidden")] = 1;
    if (variant === "array-property") Object.defineProperty(value.snapshotPages.pages, "hidden", { get: getter });
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try { expect((await planFollowUpCoverageSelection(value)).inputDigestSha256).toBeNull(); expect(getter).not.toHaveBeenCalled(); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });
  it.each(["traversal", "obligation", "exception", "page"])("rejects malformed %s scalar fields", async (variant) => {
    const value = input();
    if (variant === "traversal") value.snapshotPages.traversalComplete = "true";
    if (variant === "obligation") value.snapshotPages.pages[0].obligations[0].state = {};
    if (variant === "exception") value.snapshotPages.pages[0].exceptions = [{ exceptionId: "exc", family: FOLLOW_UP_FAMILY, state: 1, retentionUntil: 400 }];
    if (variant === "page") value.snapshotPages.pages[0].receivedStart = {};
    expect((await planFollowUpCoverageSelection(value)).inputDigestSha256).toBeNull();
  });
  it("marks partial, missing, and repeated cursor traversal incomplete", async () => {
    const partial = input(); partial.snapshotPages.traversalComplete = false;
    expect((await planFollowUpCoverageSelection(partial)).status).toBe("incomplete");
    const missing = input(); missing.snapshotPages.pages[0].nextCursor = "cursor-2";
    expect((await planFollowUpCoverageSelection(missing)).status).toBe("incomplete");
    const repeated = input(); repeated.snapshotPages.pages = [page({ nextCursor: "cursor-2" }), page({ cursor: "cursor-2", nextCursor: "cursor-2" })];
    expect((await planFollowUpCoverageSelection(repeated)).status).toBe("incomplete");
  });
  it("retains inactive carry-forward and reports retention, missing parent, and terminal gaps", async () => {
    const value = input({ previousCarryForward: { cursor: null, candidates: [{ candidateId: "obligation:old", family: FOLLOW_UP_FAMILY, kind: "obligation", identity: "old", reasonCodes: ["unresolved_obligation"], unresolved: true }] } });
    value.snapshotPages.pages[0].obligations.push({ obligationId: "obl-expired", lifecycleInstanceId: "life-a", state: "pending", deadlineAt: 1, retentionUntil: 300 });
    value.snapshotPages.pages[0].lifecycles.push({ lifecycleInstanceId: "life-missing", sourceEventId: "src-missing", state: "active", retentionUntil: 400 });
    value.snapshotPages.pages[0].exceptions.push({ exceptionId: "exc-terminal", family: FOLLOW_UP_FAMILY, state: "resolved", retentionUntil: 400 });
    const result = await planFollowUpCoverageSelection(value);
    expect(result.retainedCarryForward.map((item) => item.candidateId)).toContain("obligation:old");
    expect(result.candidates.flatMap((item) => item.reasonCodes)).toEqual(expect.arrayContaining(["retention_expired", "missing_parent", "unsupported_terminal_state"]));
  });
  it("fails safely for bounds, malformed cross-family input, cycles, and production imports", async () => {
    const oversized = input(); oversized.cutoff.maxPages = 21; expect((await planFollowUpCoverageSelection(oversized)).status).toBe("incomplete");
    const cross = input(); cross.snapshotPages.pages[0].exceptions = [{ exceptionId: "exc-x", family: "other", state: "open", retentionUntil: 400 }]; expect((await planFollowUpCoverageSelection(cross)).status).toBe("incomplete");
    const cyclic = input(); cyclic.snapshotPages.pages[0].sources[0].cycle = cyclic; expect((await planFollowUpCoverageSelection(cyclic)).status).toBe("incomplete");
    const sourceText = readFileSync(new URL("../../functions/lib/follow-up-coverage-selection.js", import.meta.url), "utf8"); const root = readFileSync(new URL("./index.js", import.meta.url), "utf8");
    expect(sourceText).not.toMatch(/\b(fetch|prepare|batch|INSERT|UPDATE|DELETE)\b/); expect(root).not.toContain("follow-up-coverage-selection");
  });
  it("rejects getters, conflicting duplicate evidence, invalid carry identity, and future evidence without mutation or fetch", async () => {
    const getter = input(); let calls = 0; Object.defineProperty(getter.snapshotPages.pages[0].sources, "0", { enumerable: true, get() { calls += 1; return source; } });
    expect((await planFollowUpCoverageSelection(getter)).status).toBe("incomplete"); expect(calls).toBe(0);
    const conflict = input(); conflict.snapshotPages.pages[0].evidence = [{ evidenceId: "ev-a", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 150, eventAt: 100 }, { evidenceId: "ev-a", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 151, eventAt: 100 }];
    expect((await planFollowUpCoverageSelection(conflict)).status).toBe("incomplete");
    const carry = input({ previousCarryForward: { cursor: null, candidates: [{ candidateId: "obligation:WRONG", family: FOLLOW_UP_FAMILY, kind: "obligation", identity: "old", reasonCodes: ["unresolved_obligation"], unresolved: true }] } }); expect((await planFollowUpCoverageSelection(carry)).status).toBe("incomplete");
    const clocks = input(); clocks.snapshotPages.pages[0].evidence = [{ evidenceId: "ev-future", sourceEventId: "src-a", lifecycleInstanceId: "life-a", obligationId: "obl-a", ingestedAt: 150, eventAt: 999 }]; expect((await planFollowUpCoverageSelection(clocks)).status).toBe("incomplete");
    const clean = input(); const before = JSON.stringify(clean); const prior = globalThis.fetch; let fetches = 0; globalThis.fetch = () => { fetches += 1; }; try { await planFollowUpCoverageSelection(clean); expect(fetches).toBe(0); expect(JSON.stringify(clean)).toBe(before); } finally { globalThis.fetch = prior; }
  });
});
