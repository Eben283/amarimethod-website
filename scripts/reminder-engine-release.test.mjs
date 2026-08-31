import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { INITIAL_IN_PERSON_WORKFLOW } from '../reminder-engine-worker/src/initial-in-person-workflow.js';
import { PARTNER_INITIAL_IN_PERSON } from '../reminder-engine-worker/src/config.js';
import {
  PROVENANCE_PATHS,
  assertBindingsPreserved,
  assertRequiredBindings,
  assertVersionProvenance,
  provenanceForRevision,
} from './reminder-engine-release.mjs';

test('records the exact Git revision and complete Worker source closure', () => {
  const provenance = provenanceForRevision({ revision: 'a'.repeat(40), archive: Buffer.from('worker source') });
  assert.equal(provenance.tag, `git-${'a'.repeat(40)}`);
  assert.match(provenance.message, /^git_sha=a{40};artifact_sha256=[a-f0-9]{64}$/);
  assert.deepEqual(PROVENANCE_PATHS, [
    '.node-version', 'package-lock.json', 'package.json', 'reminder-engine-worker',
    'functions', 'crm-mirror-worker/src/gmail.js',
  ]);
});

test('rejects a Worker version whose durable metadata is not the approved source', () => {
  const provenance = provenanceForRevision({ revision: 'b'.repeat(40), archive: Buffer.from('worker source') });
  assert.throws(() => assertVersionProvenance({ annotations: { message: 'stale local artifact' } }, provenance), /missing the approved provenance/);
  assert.doesNotThrow(() => assertVersionProvenance({ annotations: { message: provenance.message, tag: provenance.tag } }, provenance));
});

test('requires every production persistence, service, and authentication binding', () => {
  const names = ['REMINDER_DB', 'ATTEND_DB', 'PORTAL_KV', 'NURTURE', 'NURTURE_ENGINE_URL', 'WORKER_AUTH_SECRET'];
  assert.doesNotThrow(() => assertRequiredBindings({ resources: { bindings: names.map((name) => ({ name })) } }));
  assert.throws(() => assertRequiredBindings({ resources: { bindings: names.slice(1).map((name) => ({ name })) } }), /REMINDER_DB/);
});

test('refuses to drop a retained secret or change a durable resource binding', () => {
  const before = { resources: { bindings: [
    { name: 'WORKER_AUTH_SECRET', type: 'secret_text' },
    { name: 'REMINDER_DB', type: 'd1', id: 'db-1' },
  ] } };
  assert.doesNotThrow(() => assertBindingsPreserved(before, before));
  assert.throws(() => assertBindingsPreserved(before, { resources: { bindings: [
    { name: 'REMINDER_DB', type: 'd1', id: 'db-1' },
  ] } }), /WORKER_AUTH_SECRET/);
  assert.throws(() => assertBindingsPreserved(before, { resources: { bindings: [
    { name: 'WORKER_AUTH_SECRET', type: 'secret_text' },
    { name: 'REMINDER_DB', type: 'd1', id: 'db-2' },
  ] } }), /REMINDER_DB/);
});

test('release source accepts the current D1 reschedule node and keeps Partner Initial shadow-only', () => {
  assert.equal(INITIAL_IN_PERSON_WORKFLOW.nodes.find((node) => node.id === 'reschedule-confirmation')?.at, 'reschedule');
  assert.equal(PARTNER_INITIAL_IN_PERSON.flowKey, 'partner-initial-in-person');
  assert.equal(PARTNER_INITIAL_IN_PERSON.mode, 'shadow');
  assert.deepEqual(PARTNER_INITIAL_IN_PERSON.serviceIds, ['partner-initial']);
});

test('workflow is a manual production-gated exact-main release using the Bitwarden-held credential', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/deploy-reminder-engine.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /bitwarden\/sm-action@v2/);
  assert.match(workflow, /deploy:reminder-engine -- --deploy --approved-revision "\$GITHUB_SHA"/);
});
