#!/usr/bin/env node
// ADVISORY single-source check for GHL money/session custom-field IDs.
//
// Warns (exit 1) if any of the known field-ID literals appear in WEB code
// outside the registry (functions/lib/ghl-fields.js). The single source is
// functions/lib/ghl-fields.js — everything else should import FIELD_IDS from it.
//
// This is ADVISORY. It is intentionally NOT wired into the build, the test
// command, or a git hook. Run it by hand or in CI as a warning:
//     node scripts/check-field-ids.mjs
// A nonzero exit is a signal, not a gate — deploys do not depend on it.
//
// Test files are excluded on purpose: they hardcode the IDs as fixtures, which
// is an independent check that the registry holds the right value (if tests
// imported the registry, a wrong registry value would pass silently).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The known money/session field-ID literals (kept in sync with ghl-fields.js).
const KNOWN_FIELD_IDS = {
  wrQSkx6BhXwDGIn1d0V4: "sessions_remaining",
  TE0udwVH1Km5RsKaN5H0: "sessions_completed",
  "3i93lTkmuAV49s9nh0q8": "series_type",
  oDyLqIeq3yTkyhgXhAmk: "sessions_remaining_locked",
  sgQ5EbJWhvTfGVhStaOO: "session_prepaid",
  O0xmwyRqeNK2EA1GGGye: "portal_access",
  "1EnVtI70jC5MTshZjWvw": "living_practice_access",
};

// Dirs to scan (WEB code that could hold a copy). MCP is a separate repo.
const SCAN_DIRS = [
  "functions",
  "series-reconcile-worker/src",
  "daily-audit-worker/src",
  "coach-daily-worker/src",
  "call-coach-worker/src",
  "comms-coherence-worker/src",
  "conversation-cache-worker/src",
  "funnel-refresh-worker/src",
  "partner-activity-refresh-worker/src",
  "ecosystem-scanner-worker/src",
  "ghl-token-worker/src",
];

// The registry itself — the one place the literals are allowed to live.
const REGISTRY = "functions/lib/ghl-fields.js";

const isSkippable = (rel) =>
  rel === REGISTRY ||
  /\.test\.|\.integration\.test\./.test(rel) ||
  rel.includes("node_modules") ||
  rel.includes("/dist/");

const isSource = (name) => /\.(m?js|ts|tsx)$/.test(name);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir may not exist in this checkout
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      yield* walk(full);
    } else if (isSource(name)) {
      yield full;
    }
  }
}

const idPattern = new RegExp(Object.keys(KNOWN_FIELD_IDS).join("|"), "g");
const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    if (isSkippable(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      idPattern.lastIndex = 0;
      let m;
      while ((m = idPattern.exec(line)) !== null) {
        violations.push({
          rel,
          line: i + 1,
          id: m[0],
          field: KNOWN_FIELD_IDS[m[0]],
        });
      }
    });
  }
}

if (violations.length === 0) {
  console.log(
    `✓ single-source OK — no raw money/session field-ID literals outside ${REGISTRY}`,
  );
  process.exit(0);
}

console.error(
  `⚠ ADVISORY: ${violations.length} raw money/session field-ID literal(s) found outside ${REGISTRY}.`,
);
console.error(`  Import { FIELD_IDS } from ".../functions/lib/ghl-fields.js" instead.\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  ${v.id}  (${v.field})`);
}
process.exit(1);
