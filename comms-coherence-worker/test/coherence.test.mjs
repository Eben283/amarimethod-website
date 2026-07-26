// Unit tests for the pure functions in src/coherence.js — touch-window
// filtering, narrative serialization, and defensive parsing/validation of
// Claude's flag JSON. No network; the Anthropic call itself is exercised by a
// manual /run against a live contact (see plan verification step 2-3), not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowTouches, buildNarrative, formatPacificTimestamp, parseFlags } from "../src/coherence.js";

const DAY_MS = 86_400_000;
const NOW = 10 * DAY_MS; // arbitrary fixed "now" so tests don't depend on wall clock

test("windowTouches keeps only touches within the lookback window", () => {
  const touches = [
    { ts: NOW - 5 * DAY_MS, kind: "sms", dir: "out", text: "too old" },
    { ts: NOW - 2 * DAY_MS, kind: "sms", dir: "out", text: "in window" },
    { ts: NOW, kind: "sms", dir: "out", text: "right now, boundary inclusive" },
    { ts: NOW + DAY_MS, kind: "sms", dir: "out", text: "future, excluded" },
  ];
  const result = windowTouches(touches, NOW, 3);
  assert.deepEqual(result.map((t) => t.text), ["in window", "right now, boundary inclusive"]);
});

test("windowTouches sorts ascending by timestamp regardless of input order", () => {
  const touches = [
    { ts: NOW, kind: "sms", dir: "out", text: "third" },
    { ts: NOW - 2 * DAY_MS, kind: "sms", dir: "out", text: "first" },
    { ts: NOW - DAY_MS, kind: "sms", dir: "out", text: "second" },
  ];
  const result = windowTouches(touches, NOW, 3);
  assert.deepEqual(result.map((t) => t.text), ["first", "second", "third"]);
});

test("windowTouches drops malformed entries instead of throwing", () => {
  const touches = [null, { kind: "sms" }, { ts: "not-a-number", kind: "sms" }, { ts: NOW, kind: "sms", text: "ok" }];
  const result = windowTouches(touches, NOW, 3);
  assert.deepEqual(result.map((t) => t.text), ["ok"]);
});

test("windowTouches handles missing/empty touches array", () => {
  assert.deepEqual(windowTouches(undefined, NOW, 3), []);
  assert.deepEqual(windowTouches([], NOW, 3), []);
});

test("buildNarrative reports no-touches plainly", () => {
  const out = buildNarrative([], "Leanne");
  assert.match(out, /No recent touches on record for Leanne/);
});

test("buildNarrative formats SMS/email touches in Pacific time with an explicit zone", () => {
  const touches = [
    { ts: Date.UTC(2026, 5, 28, 9, 0), kind: "email", dir: "out", text: "Here's your portal link!" },
    { ts: Date.UTC(2026, 5, 28, 9, 5), kind: "sms", dir: "out", text: "Check out these tools" },
  ];
  const out = buildNarrative(touches, "Leanne");
  assert.match(out, /Contact: Leanne/);
  assert.match(out, /\[2026-06-28 02:00 PDT · email · out\] Here's your portal link!/);
  assert.match(out, /\[2026-06-28 02:05 PDT · sms · out\] Check out these tools/);
});

test("formatPacificTimestamp does not present a Pacific appointment as UTC", () => {
  // Eli's July 24 2:00 PM PDT reminder was stored as 21:00Z. The old formatter
  // displayed 21:00 without a zone and caused a false 'seven hours late' flag.
  assert.equal(formatPacificTimestamp(Date.UTC(2026, 6, 24, 21, 0)), "2026-07-24 14:00 PDT");
});

test("buildNarrative formats call touches by duration, not text", () => {
  const touches = [{ ts: Date.UTC(2026, 5, 28, 9, 0), kind: "call", dir: "in", dur: 42 }];
  const out = buildNarrative(touches, "Leanne");
  assert.match(out, /\[2026-06-28 02:00 PDT · call · in\] \(call, 42s\)/);
});

test("buildNarrative falls back to '(no text on record)' for textless sms/email", () => {
  const touches = [{ ts: Date.UTC(2026, 5, 28, 9, 0), kind: "sms", dir: "out" }];
  const out = buildNarrative(touches, "Leanne");
  assert.match(out, /\(no text on record\)/);
});

test("buildNarrative defaults contactName when missing", () => {
  const out = buildNarrative([], undefined);
  assert.match(out, /No recent touches on record for the contact/);
});

test("parseFlags parses strict JSON with valid flags", () => {
  const text = JSON.stringify({
    flags: [
      { type: "redundant", severity: "medium", summary: "Email and text both pushed the portal link same morning", touchRefs: [1, 2] },
    ],
    confidence: "high",
  });
  const result = parseFlags(text);
  assert.deepEqual(result, {
    flags: [{ type: "redundant", severity: "medium", summary: "Email and text both pushed the portal link same morning", touchRefs: [1, 2] }],
    confidence: "high",
  });
});

test("parseFlags strips markdown code fences", () => {
  const text = "```json\n" + JSON.stringify({ flags: [], confidence: "high" }) + "\n```";
  assert.deepEqual(parseFlags(text), { flags: [], confidence: "high" });
});

test("parseFlags strips stray prose around the JSON object", () => {
  const text = `Sure, here's the analysis:\n${JSON.stringify({ flags: [], confidence: "low" })}\nLet me know if you need more.`;
  assert.deepEqual(parseFlags(text), { flags: [], confidence: "low" });
});

test("parseFlags returns null on unparseable input", () => {
  assert.equal(parseFlags("not json at all"), null);
  assert.equal(parseFlags(""), null);
  assert.equal(parseFlags(undefined), null);
});

test("parseFlags drops flags missing a usable summary", () => {
  const text = JSON.stringify({ flags: [{ type: "redundant", severity: "high" }, { type: "timing", severity: "low", summary: "  " }], confidence: "high" });
  assert.deepEqual(parseFlags(text), { flags: [], confidence: "high" });
});

test("parseFlags defaults unknown type/severity instead of dropping the flag", () => {
  const text = JSON.stringify({ flags: [{ type: "made-up", severity: "extreme", summary: "weird value but real finding" }] });
  const result = parseFlags(text);
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0].type, "other");
  assert.equal(result.flags[0].severity, "low");
  assert.equal(result.flags[0].confidence, undefined); // sanity: no stray field leak
});

test("parseFlags defaults touchRefs to [] and filters non-numeric entries", () => {
  const text = JSON.stringify({ flags: [{ type: "confusion", severity: "high", summary: "asked again", touchRefs: [1, "two", null, 3] }] });
  const result = parseFlags(text);
  assert.deepEqual(result.flags[0].touchRefs, [1, 3]);
});

test("parseFlags defaults confidence to high when missing or invalid", () => {
  assert.equal(parseFlags(JSON.stringify({ flags: [] })).confidence, "high");
  assert.equal(parseFlags(JSON.stringify({ flags: [], confidence: "maybe" })).confidence, "high");
  assert.equal(parseFlags(JSON.stringify({ flags: [], confidence: "low" })).confidence, "low");
});

test("parseFlags treats a non-array flags field as empty", () => {
  assert.deepEqual(parseFlags(JSON.stringify({ flags: "oops", confidence: "high" })), { flags: [], confidence: "high" });
});
