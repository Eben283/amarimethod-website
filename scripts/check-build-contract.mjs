import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const build = String(pkg.scripts?.build || "");
const ownedQuizBridge = await readFile(
  new URL("../functions/lib/owned-quiz-intake-forward.js", import.meta.url),
  "utf8",
);
const publicQuizHandler = await readFile(
  new URL("../functions/api/send-to-ghl.js", import.meta.url),
  "utf8",
);

assert.ok(build, "package.json must define scripts.build");
assert.match(
  build,
  /node scripts\/build-html\.js/,
  "production build must execute the public HTML generator",
);
assert.doesNotMatch(
  build,
  /(?:\|\|\s*(?:true|:)|;\s*(?:exit\s+0|true)(?:\s|$))/,
  "production build must not convert an earlier failure into success",
);
assert.doesNotMatch(
  build,
  /2>\s*\/dev\/null/,
  "production build must not hide required-asset errors",
);
assert.doesNotMatch(
  build,
  /(?:^|\s)blog(?:\s|$)/,
  "production build must not copy the removed root blog directory",
);

for (const app of ["quiz-astro", "portal", "staff", "cos"]) {
  assert.match(
    build,
    new RegExp(`npm --prefix ${app} ci`),
    `production build must install ${app} from its lockfile`,
  );
  assert.match(
    build,
    new RegExp(`npm --prefix ${app} run build`),
    `production build must run the ${app} build`,
  );
}

assert.match(
  build,
  /npm run build:pages-functions/,
  "production build must regenerate the Pages Functions runtime instead of deploying a stale committed bundle",
);
assert.equal(
  pkg.scripts?.["build:pages-functions"],
  "npx --yes wrangler@4.125.0 pages functions build functions --outdir .wrangler/pages-functions-build && cp .wrangler/pages-functions-build/index.js dist/_worker.js",
  "Pages Functions must be compiled from functions/ into the deployed dist/_worker.js",
);

assert.match(
  ownedQuizBridge,
  /export const OWNED_QUIZ_BRIDGE_SOURCE_MODE = ["']active["']/,
  "owned quiz intake activation must be explicit in reviewed source",
);
assert.doesNotMatch(
  ownedQuizBridge,
  /export const OWNED_QUIZ_BRIDGE_SOURCE_MODE = ["']shadow["']/,
  "published activation must not silently fall back to source shadow",
);
assert.match(
  ownedQuizBridge,
  /env\?\.OWNED_QUIZ_BRIDGE_RELEASE !== ["']approved["']/,
  "owned quiz intake must require its independent release flag",
);
assert.match(
  ownedQuizBridge,
  /env\?\.CRM_MIRROR\?\.fetch[^\n]+env\?\.WORKER_AUTH_SECRET/,
  "owned quiz intake must require the private CRM binding and Worker auth",
);
const ownedCaptureIndex = publicQuizHandler.indexOf("forwardOwnedQuizIntake(");
const ghlCompatibilityIndex = publicQuizHandler.indexOf("getGhlToken(context)");
assert.notEqual(ownedCaptureIndex, -1, "the public quiz must call owned intake");
assert.notEqual(ghlCompatibilityIndex, -1, "the temporary GHL compatibility write must remain");
assert.ok(
  ownedCaptureIndex < ghlCompatibilityIndex,
  "owned quiz capture must precede the temporary GHL compatibility write",
);
assert.doesNotMatch(
  publicQuizHandler,
  /emitNurtureEvent\s*\(/,
  "the public quiz must not enroll nurture through a provider contact ID",
);

console.log("✓ build contract is fail-fast and lockfile-driven");
