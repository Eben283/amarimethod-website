import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  WORKERS, assertBindingsPreserved, assertProductionLane, assertRequiredBindings, parseVersionId, provenanceForRevision,
  releaseWorker, wranglerPromoteArgs, wranglerUploadArgs,
} from './worker-release.mjs';

const revision = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const provenance = provenanceForRevision({ revision, tree, worker: 'reminder-engine' });
const oldId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const oldVersion = { resources: { bindings: [
  { name: 'REMINDER_DB', type: 'd1', id: 'reminder-db' },
  { name: 'CRM_DB', type: 'd1', id: 'crm-db' },
  { name: 'ATTEND_DB', type: 'd1', id: 'attend-db' },
  { name: 'PORTAL_KV', type: 'kv_namespace', id: 'portal-kv' },
  { name: 'NURTURE', type: 'service', service: 'nurture-engine' },
  { name: 'NURTURE_ENGINE_URL', type: 'plain_text', text: 'https://example.invalid' },
  { name: 'WORKER_AUTH_SECRET', type: 'secret_text' },
  { name: 'DB', type: 'd1', id: 'db-1' },
  { name: 'FLAG', type: 'plain_text', text: 'enabled' },
  { name: 'SECRET', type: 'secret_text' },
] } };
const candidate = { ...oldVersion, metadata: { tag: provenance.tag, message: provenance.message } };

test('covers every configured production Worker', () => {
  const root = new URL('../', import.meta.url).pathname;
  const configured = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const config of ['wrangler.toml', 'wrangler.jsonc']) {
      try {
        const text = readFileSync(join(root, entry.name, config), 'utf8');
        const name = text.match(/(?:^|\n)\s*["']?name["']?\s*[:=]\s*["']([^"']+)["']/)?.[1];
        if (name) configured.push([name, entry.name]);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  assert.deepEqual(Object.entries(WORKERS).sort(), configured.sort());
});

test('production activation is refused outside the serialized GitHub lane', () => {
  assert.throws(() => assertProductionLane({}), /only through the serialized GitHub Actions release lane/);
  assert.doesNotThrow(() => assertProductionLane({ GITHUB_ACTIONS: 'true' }));
});

test('candidate upload is strict, preserves vars, and does not receive traffic', () => {
  const args = wranglerUploadArgs(provenance);
  assert.deepEqual(args.slice(2, 4), ['versions', 'upload']);
  assert(args.includes('--keep-vars'));
  assert(args.includes('--strict'));
  assert(!args.includes('deploy'));
});

test('promotion targets only the verified candidate at 100 percent', () => {
  const args = wranglerPromoteArgs(candidateId, provenance);
  assert.deepEqual(args.slice(2, 4), ['versions', 'deploy']);
  assert(args.includes(`${candidateId}@100%`));
  assert(args.includes('--yes'));
});

test('binding loss or mutation is rejected', () => {
  assert.throws(() => assertBindingsPreserved(oldVersion, { resources: { bindings: [
    { name: 'DB', type: 'd1', id: 'different' },
    { name: 'SECRET', type: 'secret_text' },
  ] } }), /DB, FLAG/);
});

test('known critical bindings remain mandatory even if an earlier release lost them', () => {
  assert.doesNotThrow(() => assertRequiredBindings('reminder-engine', oldVersion));
  assert.throws(
    () => assertRequiredBindings('reminder-engine', { resources: { bindings: [{ name: 'REMINDER_DB', type: 'd1' }] } }),
    /CRM_DB.*ATTEND_DB.*PORTAL_KV.*NURTURE.*NURTURE_ENGINE_URL.*WORKER_AUTH_SECRET/,
  );
});

test('Wrangler version id parsing is exact', () => {
  assert.equal(parseVersionId(`Version ID: ${candidateId}`), candidateId);
  assert.throws(() => parseVersionId('uploaded'), /did not return/);
});

function cloudflareFixture({ concurrent = false, candidateBindings = candidate } = {}) {
  let deploymentReads = 0;
  return async (path) => {
    if (path.endsWith('/deployments')) {
      deploymentReads += 1;
      const id = concurrent && deploymentReads === 2 ? '33333333-3333-4333-8333-333333333333'
        : deploymentReads >= 3 ? candidateId : oldId;
      return [{ versions: [{ percentage: 100, version_id: id }] }];
    }
    if (path.endsWith(`/versions/${oldId}`)) return oldVersion;
    if (path.endsWith(`/versions/${candidateId}`)) return candidateBindings;
    throw new Error(`unexpected path ${path}`);
  };
}

test('verifies an inert candidate before activating it and rechecks afterward', async () => {
  const calls = [];
  const result = await releaseWorker({
    worker: 'reminder-engine', provenance,
    cloudflare: cloudflareFixture(),
    execute(args, cwd) {
      calls.push({ args, cwd });
      return args.includes('upload') ? `Version ID: ${candidateId}` : 'deployed';
    },
  });
  assert.deepEqual(result, { previousVersionId: oldId, versionId: candidateId });
  assert.equal(calls.length, 2);
  assert(calls[0].args.includes('upload'));
  assert(calls[1].args.includes('deploy'));
});

test('never promotes a candidate that drops configuration', async () => {
  const calls = [];
  const damaged = { resources: { bindings: oldVersion.resources.bindings.filter((binding) => binding.name !== 'FLAG') }, metadata: candidate.metadata };
  await assert.rejects(() => releaseWorker({
    worker: 'reminder-engine', provenance,
    cloudflare: cloudflareFixture({ candidateBindings: damaged }),
    execute(args) { calls.push(args); return `Version ID: ${candidateId}`; },
  }), /changed or dropped/);
  assert.equal(calls.length, 1);
});

test('never promotes across a concurrent same-Worker deployment', async () => {
  const calls = [];
  await assert.rejects(() => releaseWorker({
    worker: 'reminder-engine', provenance,
    cloudflare: cloudflareFixture({ concurrent: true }),
    execute(args) { calls.push(args); return `Version ID: ${candidateId}`; },
  }), /changed concurrently/);
  assert.equal(calls.length, 1);
});
