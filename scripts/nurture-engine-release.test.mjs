import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOW_3_POST_INITIAL, SEQUENCES } from '../nurture-engine-worker/src/config.js';
import {
  CHILD_PROCESS_MAX_BUFFER_BYTES,
  PROVENANCE_PATHS,
  assertBindingsPreserved,
  assertRequiredBindings,
  assertVersionProvenance,
  provenanceForRevision,
  sourceArchiveForRevision,
} from './nurture-engine-release.mjs';

test('attests a complete source closure with a large child-process buffer', () => {
  assert.equal(CHILD_PROCESS_MAX_BUFFER_BYTES, 256 * 1024 * 1024);
  assert.deepEqual(PROVENANCE_PATHS, [
    '.node-version', 'package-lock.json', 'package.json', 'nurture-engine-worker', 'functions',
  ]);
  assert.ok(sourceArchiveForRevision('HEAD').length > 1024 * 1024);
});

test('records and verifies the exact Git revision and archive digest', () => {
  const provenance = provenanceForRevision({ revision: 'a'.repeat(40), archive: Buffer.from('nurture source') });
  assert.equal(provenance.tag, `git-${'a'.repeat(40)}`);
  assert.match(provenance.message, /^git_sha=a{40};artifact_sha256=[a-f0-9]{64}$/);
  assert.throws(() => assertVersionProvenance({ annotations: { message: 'stale' } }, provenance), /missing the approved provenance/);
  assert.doesNotThrow(() => assertVersionProvenance({ annotations: { message: provenance.message } }, provenance));
});

test('requires owned state, CRM identity, auth, and transition webhook bindings', () => {
  const names = ['NURTURE_DB', 'CRM_DB', 'PORTAL_KV', 'WORKER_AUTH_SECRET', 'GHL_WEBHOOK_SECRET'];
  assert.doesNotThrow(() => assertRequiredBindings({ resources: { bindings: names.map((name) => ({ name })) } }));
  assert.throws(() => assertRequiredBindings({ resources: { bindings: names.slice(1).map((name) => ({ name })) } }), /NURTURE_DB/);
});

test('refuses to drop retained secrets or alter durable resource bindings', () => {
  const before = { resources: { bindings: [
    { name: 'WORKER_AUTH_SECRET', type: 'secret_text' },
    { name: 'NURTURE_DB', type: 'd1', id: 'automation-db' },
    { name: 'CRM_DB', type: 'd1', id: 'crm-db' },
  ] } };
  assert.doesNotThrow(() => assertBindingsPreserved(before, before));
  assert.throws(() => assertBindingsPreserved(before, { resources: { bindings: before.resources.bindings.slice(1) } }), /WORKER_AUTH_SECRET/);
  assert.throws(() => assertBindingsPreserved(before, { resources: { bindings: [
    before.resources.bindings[0], before.resources.bindings[1], { name: 'CRM_DB', type: 'd1', id: 'wrong-db' },
  ] } }), /CRM_DB/);
});

test('release source keeps every nurture flow shadow-only and current Flow 3 at version 2', () => {
  assert.deepEqual(SEQUENCES.map((sequence) => sequence.mode), ['shadow', 'shadow', 'shadow']);
  assert.equal(FLOW_3_POST_INITIAL.mode, 'shadow');
  assert.equal(FLOW_3_POST_INITIAL.definitionVersion, 2);
  assert.equal(FLOW_3_POST_INITIAL.steps.length, 2);
});

test('workflow is a manual production-gated exact-main Bitwarden-backed release', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/deploy-nurture-engine.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /bitwarden\/sm-action@v2/);
  assert.match(workflow, /deploy:nurture-engine -- --deploy --approved-revision "\$GITHUB_SHA"/);
});
