import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertVersionProvenance, provenanceForRevision } from './crm-mirror-release.mjs';

test('records the exact Git revision and source artifact digest', () => {
  const provenance = provenanceForRevision({ revision: 'a'.repeat(40), archive: Buffer.from('worker source') });
  assert.equal(provenance.tag, `git-${'a'.repeat(40)}`);
  assert.match(provenance.message, /^git_sha=a{40};artifact_sha256=[a-f0-9]{64}$/);
});

test('rejects a Worker version whose durable metadata is not the approved source', () => {
  const provenance = provenanceForRevision({ revision: 'b'.repeat(40), archive: Buffer.from('worker source') });
  assert.throws(() => assertVersionProvenance({ annotations: { message: 'stale local artifact' } }, provenance), /missing the approved provenance/);
  assert.doesNotThrow(() => assertVersionProvenance({ annotations: { message: provenance.message, tag: provenance.tag } }, provenance));
});

test('release source retains both owned lifecycle service bindings', () => {
  const config = JSON.parse(readFileSync(new URL('../crm-mirror-worker/wrangler.jsonc', import.meta.url), 'utf8'));
  const services = Object.fromEntries((config.services || []).map((entry) => [entry.binding, entry.service]));
  assert.deepEqual(services, {
    REMINDER: 'reminder-engine',
    NURTURE: 'nurture-engine',
  });
});

test('owned Staff email dispatcher remains source-level shadow and cannot be environment-activated', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-email-dispatch.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_EMAIL_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_EMAIL_SOURCE_MODE = ["']active["']/);
  assert.match(source, /fallbackProvider:\s*null/);
});

test('owned quiz retention remains aggregate read-only with no destructive execution seam', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-quiz-retention.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
  assert.match(source, /deletionEnabled:\s*false/);
  assert.match(source, /executionContract:\s*["']not_exposed["']/);
  assert.match(router, /request\.method === ["']GET["'] && url\.pathname === ["']\/quiz-intake\/retention-readiness["']/);
  assert.doesNotMatch(router, /request\.method === ["'](?:POST|PUT|PATCH|DELETE)["'] && url\.pathname === ["']\/quiz-intake\/retention-readiness["']/);
});
