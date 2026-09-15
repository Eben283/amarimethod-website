import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { INITIAL_IN_PERSON_WORKFLOW } from '../reminder-engine-worker/src/initial-in-person-workflow.js';
import { PARTNER_INITIAL_IN_PERSON } from '../reminder-engine-worker/src/config.js';
test('routes Reminder Engine through the universal production gate', () => {
  const source = readFileSync(fileURLToPath(new URL('./reminder-engine-release.mjs', import.meta.url)), 'utf8');
  assert.match(source, /runCli\(\['--worker', 'reminder-engine'/);
  assert.doesNotMatch(source, /spawnSync|wrangler/);
});

test('release source accepts the current D1 reschedule node and keeps Partner Initial shadow-only', () => {
  assert.equal(INITIAL_IN_PERSON_WORKFLOW.nodes.find((node) => node.id === 'reschedule-confirmation')?.at, 'reschedule');
  assert.equal(PARTNER_INITIAL_IN_PERSON.flowKey, 'partner-initial-in-person');
  assert.equal(PARTNER_INITIAL_IN_PERSON.mode, 'shadow');
  assert.deepEqual(PARTNER_INITIAL_IN_PERSON.serviceIds, ['partner-initial']);
});

test('workflow is a serialized production-gated exact-main release using the isolated GitHub environment credential', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/deploy-worker.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /bitwarden\/sm-action|BWS_CRM_MIRROR/);
  assert.match(workflow, /worker-production-\$\{\{ inputs\.worker \}\}/);
  assert.match(workflow, /deploy:worker -- --worker/);
});
