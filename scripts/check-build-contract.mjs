import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const build = String(pkg.scripts?.build || "");

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

console.log("✓ build contract is fail-fast and lockfile-driven");
