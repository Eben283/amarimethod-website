import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chunkFollowUpEvidenceCapture as chunk, reassembleFollowUpEvidenceCapture as join, classifyOneShotCaptureState as classify } from "../../scripts/lib/follow-up-evidence-capture.mjs";
const clone = x => JSON.parse(JSON.stringify(x));
const opts = { operationId: "op-1", chunkBytes: 512 }, intent = { operationId: "op-1", intentId: "intent-1" };
const envelope = () => chunk({ synthetic: "x".repeat(1300) }, opts);
const digest = x => createHash("sha256").update(x).digest("hex");
function customPayload(text) { const e = clone(chunk(null, { operationId: "op-1" })), b = Buffer.from(text); e.manifest.byteLength = b.length; e.manifest.sha256 = digest(b); Object.assign(e.chunks[0], { data: b.toString("base64"), byteLength: b.length, sha256: e.manifest.sha256 }); return e; }
function frozen(x) { if (x && typeof x === "object") { expect(Object.isFrozen(x)).toBe(true); Object.values(x).forEach(frozen); } }
describe("pure bounded capture and one-shot state", () => {
  it.each([null, "", {}, [], false, 0, { unicode: "日本語🙂\ud800", newline: "a\nb" }])("roundtrips empty/scalar/Unicode %j", value => { const e = chunk(value, opts); expect(join(e).record).toEqual(value); frozen(e); frozen(join(e)); });
  it("canonicalizes recursively without mutation", () => { const a = { z: [{ b: 2, a: 1 }], a: "first" }, before = clone(a); expect(chunk(a, opts)).toEqual(chunk({ a: "first", z: [{ a: 1, b: 2 }] }, opts)); expect(a).toEqual(before); });
  it("bounds complete serialized ASCII envelopes through count digit growth", () => { const e = chunk("x".repeat(30000), opts); expect(e.chunks.length).toBeGreaterThan(99); for (const c of e.chunks) { expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThanOrEqual(512); expect(/^[\x00-\x7f]*$/.test(JSON.stringify(c))).toBe(true); } expect(join(e).record).toHaveLength(30000); });
  it("roundtrips exact maximum payload bytes", () => { const value = "x".repeat(1_499_998), e = chunk(value, { operationId: "x" }); expect(e.manifest.byteLength).toBe(1_500_000); expect(join(e).record).toBe(value); expect(() => chunk(value + "x", { operationId: "x" })).toThrow(); });
  it.each([511, 24001, 512.5, null, "512", NaN])("refuses invalid chunk budget %s", chunkBytes => expect(() => chunk(null, { ...opts, chunkBytes })).toThrow());
  it("refuses chunk overflow without partial output", () => expect(() => chunk("x".repeat(100000), opts)).toThrow());
  it.each([
    e => { e.version = "v2"; }, e => { e.authority = true; }, e => { delete e.retryAllowed; }, e => { e.extra = true; },
    e => { e.manifest.extra = true; }, e => { e.manifest.sha256 = "a"; }, e => { e.manifest.byteLength++; }, e => { e.manifest.count++; },
    e => { e.chunks.pop(); }, e => { e.chunks.push(clone(e.chunks[0])); }, e => { e.chunks.reverse(); }, e => { e.chunks[1] = clone(e.chunks[0]); },
    e => { e.chunks[0].operationId = "other"; }, e => { e.chunks[0].version = "v2"; }, e => { e.chunks[0].sha256 = "0".repeat(64); },
    e => { e.chunks[0].ordinal = "0"; }, e => { e.chunks[0].count--; }, e => { e.chunks[0].byteLength++; }, e => { e.chunks[0].extra = true; },
    e => { e.chunks[0].data += "\n"; }, e => { e.chunks[0].data = "!!!!"; }, e => { e.chunks[0].data = "A".repeat(24004); },
    e => { e.chunkBytes = 511; }, e => { e.chunks[0].data = e.chunks[0].data.replace(/./, "Z"); },
  ])("refuses corrupt/mixed/missing metadata %#", mutate => { const e = clone(envelope()); mutate(e); expect(() => join(e)).toThrow(); });
  it.each(['{ "a":1}', '{"z":1,"a":2}', '{"a":1,"a":2}', '1.0', '-0', ''])("refuses digest-valid noncanonical payload %s", value => expect(() => join(customPayload(value))).toThrow());
  it("refuses noncanonical base64 pad bits and invalid UTF8", () => { const e = customPayload("0"); e.chunks[0].data = "MB=="; expect(() => join(e)).toThrow(); const x = customPayload("x"); x.chunks[0].data = "/w=="; x.manifest.sha256 = x.chunks[0].sha256 = digest(Buffer.from([255])); expect(() => join(x)).toThrow(); });
  it.each(["getter", "hidden", "symbol", "toJSON", "prototype", "sparse", "arrayExtra", "arrayGetter", "arrayPrototype"])("rejects hostile %s without invoking code", kind => {
    const spy = vi.fn(() => { throw Error("must not run"); }); let x = {};
    if (kind === "getter") Object.defineProperty(x, "value", { enumerable: true, get: spy });
    if (kind === "hidden") Object.defineProperty(x, "value", { value: 1 });
    if (kind === "symbol") x[Symbol("x")] = 1;
    if (kind === "toJSON") x.toJSON = spy;
    if (kind === "prototype") x = Object.create({ x: 1 });
    if (kind === "sparse") x = new Array(2);
    if (kind === "arrayExtra") { x = [1]; x.extra = 1; }
    if (kind === "arrayGetter") { x = [1]; Object.defineProperty(x, "0", { get: spy }); }
    if (kind === "arrayPrototype") { x = []; Object.setPrototypeOf(x, {}); }
    expect(() => chunk({ nested: x }, opts)).toThrow(); expect(() => chunk(null, x)).toThrow(); expect(spy).not.toHaveBeenCalled();
  });
  it("rejects chunk and top-level getters before reads", () => { const spy = vi.fn(); const e = clone(envelope()); Object.defineProperty(e.chunks[0], "ordinal", { get: spy }); expect(() => join(e)).toThrow(); const input = {}; Object.defineProperty(input, "intent", { enumerable: true, get: spy }); expect(() => classify(input)).toThrow(); expect(spy).not.toHaveBeenCalled(); });
  it("accepts 4096-character keys and refuses 4097 before serialization", () => { const key = "k".repeat(4096), value = { [key]: null }; expect(join(chunk(value, opts)).record).toEqual(value); expect(() => chunk({ [key + "k"]: null }, opts)).toThrow(); });
  it("bounds recursion/nodes/cycles/numbers", () => { let deep = null; for (let i = 0; i < 18; i++) deep = [deep]; const cycle = {}; cycle.self = cycle; for (const x of [deep, cycle, Array(12001).fill(null), Infinity, NaN, -0, undefined, 1n]) expect(() => chunk(x, opts)).toThrow(); });
  it("validates matching capture instead of trusting caller", () => { const result = classify({ intent, dispatchConsumed: true, capture: envelope() }); expect(result).toMatchObject({ status: "captured", dispatchConsumed: true, authority: false, retryAllowed: false, sinkDurabilityProven: false }); frozen(result); });
  it.each([null, {}, { validatedComplete: true }, { response: "complete" }])("consumed lost/fake-complete requires reconciliation %j", capture => expect(classify({ intent, dispatchConsumed: true, capture })).toMatchObject({ status: "requires_read_only_reconciliation", dispatchConsumed: true, retryAllowed: false }));
  it("consumed mixed/truncated never means not-dispatched", () => { const other = chunk(null, { operationId: "other" }), short = clone(envelope()); short.chunks.pop(); for (const capture of [other, short]) expect(classify({ intent, dispatchConsumed: true, capture }).status).toBe("requires_read_only_reconciliation"); });
  it("requires explicit intent/consumption and never grants dispatch", () => { expect(classify({ intent, dispatchConsumed: false, capture: null })).toMatchObject({ status: "not_dispatched", executionAllowed: false }); for (const input of [{ intentRecorded: true, dispatchConsumed: true, validatedComplete: true }, { intent, dispatchConsumed: "true", capture: null }, { intent: null, dispatchConsumed: true, capture: null }, { intent, dispatchConsumed: false, capture: envelope() }]) expect(() => classify(input)).toThrow(); });
  it("has no IO/network side effects", () => { const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw Error("network forbidden"); }); try { join(envelope()); classify({ intent, dispatchConsumed: true, capture: envelope() }); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); } const source = readFileSync(new URL("../../scripts/lib/follow-up-evidence-capture.mjs", import.meta.url), "utf8"); expect(source).not.toMatch(/node:(?:fs|http|https|net)|\bfetch\s*\(|process\.|writeFile|execSync/); });
});
