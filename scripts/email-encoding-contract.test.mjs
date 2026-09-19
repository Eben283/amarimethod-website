import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Only authored production code and email copy. Fixtures deliberately contain
// corrupt text; deployed artifacts are rebuilt from their corresponding sources.
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0")
  .filter((path) => path && existsSync(path))
  .filter((path) => /^(functions\/|[^/]+-worker\/src\/|emails\/|email-copy\/|staff\/src\/lib\/.*(?:follow-?up|email))/.test(path)
    && /\.(?:[cm]?[jt]sx?|json|html|md)$/.test(path)
    && !/\.(?:test|spec)\./.test(path));
const sender = "crm-mirror-worker/src/gmail.js";
// Known UTF-8 bytes interpreted as Windows-1252 (including the reported double
// conversion). This is a source-review gate, never a rewrite of client data.
const mojibake = /\uFFFD|\u00e2\u20ac|\u00f0\u0178|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]/u;

test("authored email source and copy remain valid UTF-8 without known corruption", () => {
  assert.ok(paths.length > 400, "production source inventory unexpectedly shrank");
  assert.ok(paths.includes("staff/src/lib/followupCopy.ts"), "Staff suggested email copy is missing from the source inventory");
  for (const path of paths) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    assert.equal(mojibake.test(text), false, path + " contains likely character-encoding corruption");
  }
});

test("raw MIME construction remains centralized in the Unicode-tested Gmail sender", () => {
  const mimeOwners = paths.filter((path) => /MIME-Version:\s*1\.0/.test(readFileSync(path, "utf8")));
  assert.deepEqual(mimeOwners, [sender]);
  const apiOwners = paths.filter((path) => /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/.test(readFileSync(path, "utf8")));
  assert.deepEqual(apiOwners, [sender]);
});
