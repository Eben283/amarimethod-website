// Cron-schedule regression harness. Pins the fix for ih32 (2026-07-11): the
// full-reconcile guard compared event.cron against a hardcoded "0 */3 * * *" that
// matched NEITHER real cron, so every 3-hourly run did a full reconcile for weeks.
// The second suite is the cron-decl check that WOULD HAVE CAUGHT it — it asserts
// the code's declared cron strings match wrangler.toml.
// Run: `cd conversation-cache-worker && node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INCREMENTAL_CRON, WEEKLY_FULL_CRON, isFullReconcile } from '../src/schedule.js';

const here = dirname(fileURLToPath(import.meta.url));

// ───────────────────────── cron → reconcile mode ─────────────────────────

test('the 5-minute incremental cron does NOT trigger a full reconcile', () => {
  assert.equal(isFullReconcile(INCREMENTAL_CRON), false);
});

test('the Monday weekly cron DOES trigger a full reconcile', () => {
  assert.equal(isFullReconcile(WEEKLY_FULL_CRON), true);
});

test('the pre-fix guard string ("0 */3 * * *") is no longer the incremental cron', () => {
  // Before ih32 the guard compared against "0 */3 * * *", which matched neither
  // real cron, so isFullReconcile was always true. Guard against that regression.
  assert.notEqual(INCREMENTAL_CRON, '0 */3 * * *');
  assert.equal(isFullReconcile('0 */3 * * *'), true); // stray/unknown cron ⇒ safe (full)
});

// ─────────── cron-decl: code cron strings must match wrangler.toml ───────────

const toml = readFileSync(join(here, '..', 'wrangler.toml'), 'utf8');
const listMatch = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
const tomlCrons = (listMatch ? listMatch[1] : '')
  .match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, '')) ?? [];

test('cron-decl: wrangler.toml declares exactly the two crons the code expects', () => {
  assert.equal(tomlCrons.length, 2);
  assert.ok(tomlCrons.includes(INCREMENTAL_CRON), `toml missing incremental cron; has ${JSON.stringify(tomlCrons)}`);
  assert.ok(tomlCrons.includes(WEEKLY_FULL_CRON), `toml missing weekly cron; has ${JSON.stringify(tomlCrons)}`);
});

test('cron-decl: every wrangler.toml cron is one the code understands (no orphan schedule)', () => {
  for (const c of tomlCrons) {
    assert.ok(
      [INCREMENTAL_CRON, WEEKLY_FULL_CRON].includes(c),
      `wrangler.toml cron "${c}" is not handled by schedule.js — would silently mis-run`,
    );
  }
});
