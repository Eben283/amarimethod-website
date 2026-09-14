import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOW_3_POST_INITIAL, SEQUENCES } from '../nurture-engine-worker/src/config.js';
test('routes Nurture Engine through the universal production gate', () => {
  const source = readFileSync(fileURLToPath(new URL('./nurture-engine-release.mjs', import.meta.url)), 'utf8');
  assert.match(source, /runCli\(\['--worker', 'nurture-engine'/);
  assert.doesNotMatch(source, /spawnSync|wrangler/);
});

test('release source keeps every nurture flow shadow-only and current Flow 3 at version 2', () => {
  assert.deepEqual(SEQUENCES.map((sequence) => sequence.mode), ['shadow', 'shadow', 'shadow']);
  assert.equal(FLOW_3_POST_INITIAL.mode, 'shadow');
  assert.equal(FLOW_3_POST_INITIAL.definitionVersion, 2);
  assert.equal(FLOW_3_POST_INITIAL.steps.length, 2);
});

test('workflow is a serialized production-gated exact-main Bitwarden-backed release', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/deploy-worker.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /bitwarden\/sm-action@v2/);
  assert.match(workflow, /worker-production-\$\{\{ inputs\.worker \}\}/);
  assert.match(workflow, /deploy:worker -- --worker/);
});
