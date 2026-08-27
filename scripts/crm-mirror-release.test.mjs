import assert from 'node:assert/strict';
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
