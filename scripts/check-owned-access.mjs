#!/usr/bin/env node
// ADVISORY check for the portal/partner IDOR class.
//
// Warns (exit 1) if any Pages Function handler fetches a GHL contact by an id
// that came from the REQUEST (query / body / route params / url / searchParams)
// instead of from the verified JWT via the shared gate (lib/owned-access.js).
// The invariant is: ownership comes from the token's contactId, NEVER from a
// request-supplied id. A `/contacts/${...}` fetch keyed on a request id is the
// exact shape that leaks another user's data.
//
// This is ADVISORY. It is intentionally NOT wired into the build, the test
// command, or a git hook. Run it by hand or in CI as a warning:
//     node scripts/check-owned-access.mjs
// A nonzero exit is a signal, not a gate — deploys do not depend on it.
//
// This targets the USER-authenticated portal/partner surface, where a bearer
// token must scope to its own contactId. Allowlisted, because they are a
// different auth model (not the user-bearer IDOR class):
//   - staff-*.js       staff legitimately read arbitrary contacts after
//                      requireStaffAuth
//   - *-webhook.js     server-to-server, authenticated by GHL_WEBHOOK_SECRET;
//                      the payload-supplied contactId is the event's subject,
//                      not a user reading "their own" data
//   - owned-access.js  the gate itself

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Only the client/partner API surface. Workers and staff endpoints are excluded.
const SCAN_DIRS = ["functions/api"];

// Something that names a request-controlled input.
const REQUEST_SOURCE = /\b(request|req|body|params|searchParams|query|url)\b/;
// A variable/field name that plausibly holds a contact id.
const ID_LIKE = /^(contact_?id|id|cid)$/i;

const isSource = (name) => /\.m?js$/.test(name);
const isTest = (rel) => /\.test\.|\.integration\.test\./.test(rel);
const isAllowlisted = (name) =>
  /^staff-/.test(name) || /-webhook\.m?js$/.test(name) || name === "owned-access.js";

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

// Collect identifiers assigned from a request source (the "tainted" set).
// Handles `const x = body.foo`, `const { contactId } = params`, and
// `const contactId = url.searchParams.get("contactId")`.
function collectTaintedIds(lines) {
  const tainted = new Set();
  for (const line of lines) {
    // Destructuring: const { a, b } = <request source>
    const destructure = line.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(.+)$/);
    if (destructure && REQUEST_SOURCE.test(destructure[2])) {
      for (const raw of destructure[1].split(",")) {
        const namePart = raw.split(":").pop().trim();
        if (ID_LIKE.test(namePart)) tainted.add(namePart);
      }
      continue;
    }
    // Simple assignment: const name = <request source ...>
    const assign = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
    if (assign && ID_LIKE.test(assign[1]) && REQUEST_SOURCE.test(assign[2])) {
      tainted.add(assign[1]);
    }
  }
  return tainted;
}

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    const name = basename(file);
    if (isTest(rel) || isAllowlisted(name)) continue;

    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    const tainted = collectTaintedIds(lines);

    lines.forEach((line, i) => {
      // Find every /contacts/${EXPR} template usage on this line.
      const re = /\/contacts\/\$\{([^}]+)\}/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const expr = m[1].trim();
        const leadingId = (expr.match(/^[A-Za-z_$][\w$]*/) || [])[0];
        const inlineRequest = REQUEST_SOURCE.test(expr); // e.g. ${body.contactId}
        const taintedVar = leadingId && tainted.has(leadingId);
        if (inlineRequest || taintedVar) {
          violations.push({
            rel,
            line: i + 1,
            expr,
            reason: inlineRequest ? "request-supplied id inline" : `request-tainted var '${leadingId}'`,
          });
        }
      }
    });
  }
}

if (violations.length === 0) {
  console.log(
    "✓ owned-access OK — no /contacts/{id} fetch keyed on a request-supplied id in functions/api",
  );
  process.exit(0);
}

console.error(
  `⚠ ADVISORY: ${violations.length} contact fetch(es) keyed on a REQUEST-supplied id (potential IDOR).`,
);
console.error(
  "  Ownership must come from the verified JWT via requireOwner/loadOwnedContact (lib/owned-access.js),",
);
console.error("  never from a query/body/params id.\n");
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  /contacts/\${${v.expr}}  (${v.reason})`);
}
process.exit(1);
