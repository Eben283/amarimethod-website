import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHILD_PROCESS_MAX_BUFFER_BYTES,
  assertVersionProvenance,
  provenanceForRevision,
  sourceArchiveForRevision,
} from './crm-mirror-release.mjs';

test('attests the complete Worker tree with a bounded large child-process buffer', () => {
  assert.equal(CHILD_PROCESS_MAX_BUFFER_BYTES, 256 * 1024 * 1024);
  assert.ok(sourceArchiveForRevision('HEAD').length > 1024 * 1024);
});

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

test('owned attendance mutation remains source-level shadow and provider-free', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-appointment-attendance.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_ATTENDANCE_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_ATTENDANCE_SOURCE_MODE = ["']active["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /sessionLedgerWrite:\s*false/);
  assert.match(source, /paymentWrite:\s*false/);
  assert.match(router, /captureOwnedAppointmentAttendance\(\s*env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_ATTENDANCE_SOURCE_MODE\s*:\s*env\./);
});

test('owned note authority remains source-level shadow, provider-free, and non-destructive', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-notes.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_NOTE_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_NOTE_SOURCE_MODE = ["']active["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveDeleteExposed:\s*false/);
  assert.match(router, /captureOwnedNoteVersion\(env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_NOTE_SOURCE_MODE\s*:\s*env\./);
});

test('owned task authority remains source-level shadow, provider-free, and non-destructive', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-tasks.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_TASK_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_TASK_SOURCE_MODE = ["']active["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveDeleteExposed:\s*false/);
  assert.match(router, /captureOwnedTaskVersion\(env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_TASK_SOURCE_MODE\s*:\s*env\./);
});

test('owned contact classifications remain source-level shadow and provider-free', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-contact-classifications.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_CLASSIFICATION_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_CLASSIFICATION_SOURCE_MODE = ["']active["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveEvidenceDelete:\s*false/);
  assert.match(router, /captureOwnedContactClassification\(\s*env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_CLASSIFICATION_SOURCE_MODE\s*:\s*env\./);
});

test('owned contact profile authority remains source-level shadow and provider-free', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-contact-profiles.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_CONTACT_PROFILE_SOURCE_MODE = ["']shadow["']/);
  assert.doesNotMatch(source, /export const OWNED_CONTACT_PROFILE_SOURCE_MODE = ["']active["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /messageWrite:\s*false/);
  assert.match(source, /contactCreation:\s*false/);
  assert.match(source, /destructiveEvidenceDelete:\s*false/);
  assert.match(router, /captureOwnedContactProfile\(\s*env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_CONTACT_PROFILE_SOURCE_MODE\s*:\s*env\./);
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
