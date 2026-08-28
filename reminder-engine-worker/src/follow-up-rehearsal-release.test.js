import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  inspectRehearsalCandidate, parseRehearsalReleaseArgs, prepareRehearsalReview,
  REHEARSAL_RELEASE_TARGETS, validateRehearsalConfig,
} from '../../scripts/follow-up-rehearsal-release.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REVISION = 'a'.repeat(40);
const REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const pretty = value => JSON.stringify(value, null, 2) + '\n';
const configPath = role => `${ROOT}/follow-up-rehearsal-worker/wrangler.${role}.jsonc`;
const config = role => JSON.parse(readFileSync(configPath(role), 'utf8'));

// Only Git read replies are simulated. Configs, transitive inputs, installed tools,
// and esbuild bundle outputs below are the actual candidate files. These tests
// never prove that the candidate exists on GitHub or grant deployment permission.
function fixture(overrides = {}) {
  const calls = [];
  const git = args => {
    calls.push(args);
    const key = args.join(' ');
    if (Object.hasOwn(overrides, key)) {
      const value = overrides[key];
      return typeof value === 'function' ? value(args) : value;
    }
    if (key === 'rev-parse HEAD' || key === 'rev-parse origin/main') return REVISION;
    if (key === 'status --porcelain=v1 --untracked-files=all') return '';
    if (key === 'remote get-url origin') return REMOTE;
    if (args[0] === 'ls-remote') return `${REVISION}\trefs/heads/main\n`;
    if (args[0] === 'show' && args[1].startsWith(`${REVISION}:`)) return readFileSync(`${ROOT}/${args[1].slice(41)}`);
    throw new Error(`Unexpected Git command: ${key}`);
  };
  return { git, calls };
}

describe('exact private rehearsal configuration', () => {
  it.each(['control', 'issuer'])('accepts actual %s config only with complete private defaults', role => {
    expect(validateRehearsalConfig(readFileSync(configPath(role), 'utf8'), role)).toEqual(config(role));
  });
  it.each([
    ['public workers.dev', c => { c.workers_dev = true; }],
    ['public preview URL', c => { c.preview_urls = true; }],
    ['missing private default', c => { delete c.preview_urls; }],
    ['public route', c => { c.routes = ['example.com/*']; }],
    ['alternate route property', c => { c.route = 'example.com/*'; }],
    ['cron', c => { c.triggers = { crons: ['* * * * *'] }; }],
    ['environment override', c => { c.env = { production: {} }; }],
    ['production D1', c => { c.d1_databases = [{ binding: 'DB', database_name: 'amari-automation' }]; }],
    ['KV', c => { c.kv_namespaces = []; }],
    ['queue', c => { c.queues = {}; }],
    ['secret/default activation', c => { c.vars = { REHEARSAL_MANIFEST: 'active' }; }],
    ['account override', c => { c.account_id = '0'.repeat(32); }],
    ['production Worker name', c => { c.name = 'amari-reminder-engine'; }],
    ['stale compatibility date', c => { c.compatibility_date = '2025-01-01'; }],
    ['extra compatibility flag', c => { c.compatibility_flags.push('global_fetch_strictly_public'); }],
    ['unbounded subrequests', c => { c.limits.subrequests = 10000; }],
    ['unbounded CPU', c => { c.limits.cpu_ms = 300000; }],
    ['logs', c => { c.observability.enabled = true; }],
    ['secret persistence override', c => { c.keep_vars = true; }],
    ['custom build', c => { c.build = { command: 'echo unreviewed' }; }],
    ['extra assets', c => { c.assets = { directory: '../dist' }; }],
    ['wrong source', c => { c.main = '../reminder-engine-worker/src/index.js'; }],
    ['R2 production reuse', c => { c.r2_buckets[0].bucket_name = 'amari-staff-media'; }],
    ['R2 automatic provisioning', c => { delete c.r2_buckets[0].bucket_name; }],
    ['R2 remote dev', c => { c.r2_buckets[0].remote = true; }],
    ['wrong issuer', c => { c.services[0].service = 'amari-crm-mirror'; }],
    ['default instead of named issuer', c => { delete c.services[0].entrypoint; }],
    ['foreign DO', c => { c.durable_objects.bindings[0].script_name = 'foreign'; }],
    ['extra migration', c => { c.migrations.push({ tag: 'v2', deleted_classes: ['FollowUpRehearsalRegistryV1'] }); }],
  ])('rejects %s', (_, mutate) => {
    const value = config('control'); mutate(value);
    expect(() => validateRehearsalConfig(pretty(value), 'control')).toThrow(/exact private synthetic topology/);
  });
  it('issuer cannot acquire control storage or an outgoing service', () => {
    for (const [field, value] of Object.entries({ r2_buckets: [], durable_objects: {}, services: [] })) {
      const candidate = config('issuer'); candidate[field] = value;
      expect(() => validateRehearsalConfig(pretty(candidate), 'issuer')).toThrow(/topology/);
    }
  });
  it('rejects duplicate config keys, comments, trailing syntax, and unknown roles', () => {
    const actual = readFileSync(configPath('control'), 'utf8');
    for (const value of [actual.replace('{', '{\n  "workers_dev": true,'), `// comment\n${actual}`, `${actual}{}`, JSON.stringify(config('control'))]) {
      expect(() => validateRehearsalConfig(value, 'control')).toThrow();
    }
    expect(() => validateRehearsalConfig(actual, 'production')).toThrow(/role/);
  });
});

describe('read-only source preparation against actual candidate bundles', () => {
  let candidate;
  beforeAll(async () => { candidate = await inspectRehearsalCandidate({ git: fixture().git }); });
  it('pins both actual bundles, all esbuild input files, config, lockfile and preparation source', () => {
    expect(candidate.providerWrites).toBe(false);
    expect(candidate.deployableApproval).toBe(false);
    expect(candidate.freshMainVerified).toBe(false);
    expect(candidate.artifact.targets).toEqual(REHEARSAL_RELEASE_TARGETS);
    expect(candidate.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.artifact.bundles.map(v => v.role)).toEqual(['control', 'issuer']);
    const files = candidate.artifact.files.map(v => v.path);
    for (const required of ['package.json', 'package-lock.json', 'scripts/follow-up-rehearsal-release.mjs', 'follow-up-rehearsal-worker/README.md', 'follow-up-rehearsal-worker/src/protocol.mjs', 'scripts/lib/follow-up-evidence-admission-gate.mjs', 'scripts/lib/follow-up-evidence-storage-adapters.mjs']) expect(files).toContain(required);
    expect(files).not.toContain('scripts/lib/follow-up-evidence-rehearsal-runtime.mjs');
    for (const bundle of candidate.artifact.bundles) {
      expect(bundle.bytes).toBeGreaterThan(1000);
      expect(bundle.sha256).toMatch(/^[a-f0-9]{64}$/);
      for (const input of bundle.inputs) expect(files).toContain(input);
      expect(bundle.externalImports.every(v => ['cloudflare:workers', 'node:crypto'].includes(v))).toBe(true);
    }
    expect(candidate.artifact.tools.esbuild).toBe('0.21.5');
    expect(candidate.artifact.tools.node).toBe(process.version);
  });
  it('candidate inspection remains local and marks a dirty tree as unapproved', async () => {
    const state = fixture({ 'status --porcelain=v1 --untracked-files=all': '?? synthetic-dirty-file' });
    const dirty = await inspectRehearsalCandidate({ git: state.git });
    expect(dirty.dirty).toBe(true);
    expect(dirty.deployableApproval).toBe(false);
    expect(state.calls.some(v => v[0] === 'ls-remote')).toBe(false);
  });
  it('is reproducible with unchanged source and toolchain', async () => {
    expect((await inspectRehearsalCandidate({ git: fixture().git })).artifactDigest).toBe(candidate.artifactDigest);
  });
  it('accepts synthetic fresh-main Git fixture without pretending to authorize a deployment', async () => {
    const state = fixture();
    const result = await prepareRehearsalReview({ git: state.git, reviewedRevision: REVISION, reviewedArtifact: candidate.artifactDigest });
    expect(result.freshMainVerified).toBe(true); // Synthetic Git fixture, not actual GitHub evidence.
    expect(result.sourceSelection).toBe('exact-reviewed-main');
    expect(result.deployableApproval).toBe(false);
    expect(result.providerWrites).toBe(false);
    expect(result.nextGate).toContain('separately implemented guarded release');
    expect(state.calls.filter(v => v[0] === 'ls-remote')).toEqual([['ls-remote', '--exit-code', REMOTE, 'refs/heads/main']]);
    expect(state.calls.every(v => ['rev-parse', 'status', 'remote', 'show', 'ls-remote'].includes(v[0]))).toBe(true);
  });
  it.each([
    ['dirty tree', { 'status --porcelain=v1 --untracked-files=all': ' M source.mjs' }, /clean/],
    ['wrong origin', { 'remote get-url origin': 'https://example.com/fork.git' }, /canonical/],
    ['stale HEAD', { 'rev-parse HEAD': 'b'.repeat(40) }, /exact reviewed/],
    ['stale cached main', { 'rev-parse origin/main': 'b'.repeat(40) }, /exact reviewed/],
    ['changed remote main', { [`ls-remote --exit-code ${REMOTE} refs/heads/main`]: `${'b'.repeat(40)}\trefs/heads/main` }, /fresh GitHub/],
    ['ambiguous remote result', { [`ls-remote --exit-code ${REMOTE} refs/heads/main`]: `${REVISION}\trefs/heads/main\n${REVISION}\trefs/heads/other` }, /fresh GitHub/],
    ['missing remote ref', { [`ls-remote --exit-code ${REMOTE} refs/heads/main`]: '' }, /fresh GitHub/],
    ['hidden uncommitted input', { [`show ${REVISION}:follow-up-rehearsal-worker/src/protocol.mjs`]: 'unreviewed bytes' }, /reviewed commit/],
  ])('refuses %s', async (_, overrides, error) => {
    await expect(prepareRehearsalReview({ git: fixture(overrides).git, reviewedRevision: REVISION, reviewedArtifact: candidate.artifactDigest })).rejects.toThrow(error);
  });
  it('refuses stale artifact and does not query remote afterward', async () => {
    const state = fixture();
    await expect(prepareRehearsalReview({ git: state.git, reviewedRevision: REVISION, reviewedArtifact: '0'.repeat(64) })).rejects.toThrow(/reviewed digest/);
    expect(state.calls.some(v => v[0] === 'ls-remote')).toBe(false);
  });
  it('refuses changed local HEAD after fresh remote observation', async () => {
    let observed = false;
    const state = fixture({
      'rev-parse HEAD': () => observed ? 'b'.repeat(40) : REVISION,
      [`ls-remote --exit-code ${REMOTE} refs/heads/main`]: () => { observed = true; return `${REVISION}\trefs/heads/main`; },
    });
    await expect(prepareRehearsalReview({ git: state.git, reviewedRevision: REVISION, reviewedArtifact: candidate.artifactDigest })).rejects.toThrow(/exact reviewed/);
  });
  it('fails closed on remote access failure without substituting cached main', async () => {
    const state = fixture({ [`ls-remote --exit-code ${REMOTE} refs/heads/main`]: () => { throw new Error('synthetic network failure'); } });
    await expect(prepareRehearsalReview({ git: state.git, reviewedRevision: REVISION, reviewedArtifact: candidate.artifactDigest })).rejects.toThrow(/network failure/);
  });
  it.each([undefined, '', 'main', 'a'.repeat(8), 'A'.repeat(40)])('requires explicit full reviewed revision %s', async reviewedRevision => {
    const state = fixture();
    await expect(prepareRehearsalReview({ git: state.git, reviewedRevision, reviewedArtifact: candidate.artifactDigest })).rejects.toThrow(/explicit reviewed/);
    expect(state.calls).toHaveLength(0);
  });
});

describe('CLI has no deployment, provisioning, arbitrary checkout or override path', () => {
  it('accepts inspect and exact preparation arguments only', () => {
    expect(parseRehearsalReleaseArgs(['inspect'])).toEqual({ mode: 'inspect' });
    expect(parseRehearsalReleaseArgs(['prepare', '--reviewed-revision', REVISION, '--reviewed-artifact', 'b'.repeat(64)])).toEqual({ mode: 'prepare', reviewedRevision: REVISION, reviewedArtifact: 'b'.repeat(64) });
  });
  it.each([[], ['--deploy'], ['deploy'], ['provision'], ['rollback'], ['inspect', '--deploy'], ['inspect', '--repo-root', '/tmp'], ['prepare', '--reviewed-revision', REVISION], ['prepare', '--reviewed-revision', REVISION, '--reviewed-artifact', 'b'.repeat(64), '--skip-main']].map(args => [args]))('rejects %j', args => {
    expect(() => parseRehearsalReleaseArgs(args)).toThrow(/No deployment command exists/);
  });
});
