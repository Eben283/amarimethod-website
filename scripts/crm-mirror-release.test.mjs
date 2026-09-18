import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('routes CRM Mirror through the universal production gate', () => {
  const source = readFileSync(new URL('./crm-mirror-release.mjs', import.meta.url), 'utf8');
  assert.match(source, /runCli\(\['--worker', 'amari-crm-mirror'/);
  assert.doesNotMatch(source, /spawnSync|wrangler/);
});

test('keeps privileged D1 migration access out of the Worker-only release credential', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /d1 (?:execute|migrations apply)/);
  assert.match(workflow, /Upload, verify, and activate one Worker/);
});

test('installs attachment schema through a separate exact migration gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/install-crm-attachment-schema.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /secrets\.CLOUDFLARE_D1_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /0033_client_desk_conversation_dispositions\.sql/);
  assert.match(workflow, /0034_communication_attachments\.sql/);
  assert.match(workflow, /action=apply/);
  assert.match(workflow, /action=verify/);
  assert.match(workflow, /if: steps\.boundary\.outputs\.action == 'apply'/);
  assert.match(workflow, /d1 migrations apply amari-crm-mirror --config wrangler\.jsonc --remote/);
  assert.match(workflow, /PRAGMA integrity_check/);
  assert.match(workflow, /PRAGMA foreign_key_check\('communication_event_attachments'\)/);
  assert.doesNotMatch(workflow, /deploy:worker|owned-email|gmail/i);
});

test('installs the GHL source archive through its own exact migration gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/install-crm-ghl-source-archive-schema.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /secrets\.CLOUDFLARE_D1_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /0034_communication_attachments\.sql/);
  assert.match(workflow, /0035_ghl_communication_source_archive\.sql/);
  assert.match(workflow, /action=apply/);
  assert.match(workflow, /action=verify/);
  assert.match(workflow, /if: steps\.boundary\.outputs\.action == 'apply'/);
  assert.doesNotMatch(workflow, /PRAGMA integrity_check/);
  assert.doesNotMatch(workflow, /PRAGMA foreign_key_check\('ghl_communication_source_records'\)/);
  assert.match(workflow, /source_archive_table_shape_failed/);
  assert.match(workflow, /source_archive_index_shape_failed/);
  assert.match(workflow, /source_archive_unexpected_foreign_key/);
  assert.doesNotMatch(workflow, /deploy:worker|owned-email|gmail/i);
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

test('owned note authority is source-level active, provider-free, and non-destructive', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-notes.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_NOTE_SOURCE_MODE = ["']active["']/);
  assert.doesNotMatch(source, /export const OWNED_NOTE_SOURCE_MODE = ["']shadow["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveDeleteExposed:\s*false/);
  assert.match(router, /captureOwnedNoteVersion\(env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_NOTE_SOURCE_MODE\s*:\s*env\./);
});

test('owned task authority is source-level active, provider-free, and non-destructive', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-tasks.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../crm-mirror-worker/migrations/0032_owned_task_assignment.sql', import.meta.url), 'utf8');
  const schemaPlan = readFileSync(new URL('./crm-task-assignment-schema-install-plan.mjs', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_TASK_SOURCE_MODE = ["']active["']/);
  assert.match(source, /OWNED_TASK_CONTRACT_VERSION = ["']owned-task-authority\.v2["']/);
  assert.doesNotMatch(source, /export const OWNED_TASK_SOURCE_MODE = ["']shadow["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveDeleteExposed:\s*false/);
  assert.match(router, /captureOwnedTaskVersion\(env\.CRM_DB/);
  assert.match(router, /create: new Set\(\[[^\]]*["']assignedTo["']/);
  assert.match(router, /revise: new Set\(\[[^\]]*["']assignedTo["']/);
  assert.match(migration, /ADD COLUMN assigned_to TEXT/);
  assert.match(migration, /owned_task_version_state_change_preserves_assignment/);
  assert.match(schemaPlan, /executionAuthorized:\s*false/);
  assert.doesNotMatch(schemaPlan, /wrangler|fetch\s*\(|CLOUDFLARE|bws\s/);
  assert.doesNotMatch(router, /OWNED_TASK_SOURCE_MODE\s*:\s*env\./);
});

test('owned contact classifications are source-level active and provider-free', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-contact-classifications.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_CLASSIFICATION_SOURCE_MODE = ["']active["']/);
  assert.doesNotMatch(source, /export const OWNED_CLASSIFICATION_SOURCE_MODE = ["']shadow["']/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /destructiveEvidenceDelete:\s*false/);
  assert.match(router, /captureOwnedContactClassification\(\s*env\.CRM_DB/);
  assert.doesNotMatch(router, /OWNED_CLASSIFICATION_SOURCE_MODE\s*:\s*env\./);
});

test('owned contact profile authority activates only name revision and stays provider-free', () => {
  const source = readFileSync(new URL('../crm-mirror-worker/src/owned-contact-profiles.js', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../crm-mirror-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(source, /export const OWNED_CONTACT_PROFILE_SOURCE_MODE = ["']active["']/);
  assert.match(source, /const ACTIVE_ACTIONS = Object\.freeze\(\[["']revise_name["']\]\)/);
  assert.match(source, /destinationActionsEnabled:\s*false/);
  assert.match(source, /owned_contact_profile_action_unavailable/);
  assert.match(source, /providerFallback:\s*null/);
  assert.match(source, /providerWrite:\s*false/);
  assert.match(source, /messageWrite:\s*false/);
  assert.match(source, /contactCreation:\s*false/);
  assert.match(source, /destructiveEvidenceDelete:\s*false/);
  assert.match(router, /captureOwnedContactProfile\(\s*env\.CRM_DB/);
  assert.match(router, /payload\.action !== ["']revise_name["']/);
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
