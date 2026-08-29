import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_LIMITS, HOST_RECORD_KEYS, HOST_ACCESS_RECORD_KEYS, hostApprovalDigest, hostApprovalSigningBytes,
  validateHostApproval, validateHostApprovalPolicy, runExactBwsRecord, createExactCustody,
  consumeGitHubRelease, inspectReleaseStatus, inspectHostCandidate, runRehearsalHost,
} from '../../scripts/follow-up-rehearsal-host.mjs';
import { DEPLOY_TARGETS, DEPLOY_LIMITS, deploymentApprovalDigest } from '../../scripts/follow-up-rehearsal-deploy.mjs';
import { VERSION, ACTION_DIGEST, canonical, encode, manifestSigningBytes, requestSigningBytes } from '../../follow-up-rehearsal-worker/src/protocol.mjs';
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from '../../scripts/lib/follow-up-evidence-storage-adapters.mjs';

const H = x => createHash('sha256').update(x).digest('hex');
const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const NOW = Date.now(), REV = 'a'.repeat(40), RELEASE = 'b'.repeat(64), DIGEST = 'c'.repeat(64);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const root = { keyId: 'offline-owner-v1', publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
function policy() {
  const names = ['github', 'cloudflare', 'issuer', 'control', 'caller'];
  const records = Object.fromEntries(names.map((role, i) => [role, { id: UUIDS[i], key: HOST_RECORD_KEYS[role], projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revisionDate: '2026-08-28T20:00:00Z', sha256: H(`value-${role}`) }]));
  return { version: 'follow-up-rehearsal-host-approval.v1', mode: 'deploy', releaseId: RELEASE, issuedAt: NOW - 1000, expiresAt: NOW + 300000, reviewedRevision: REV, hostArtifactDigest: DIGEST, ownerKeyId: root.keyId,
    custody: { executable: '/reviewed/bws', executableSha256: H('binary'), records }, ledger: { repository: 'Eben283/amarimethod-website', refPrefix: 'refs/tags/followup-rehearsal-consumed/', rulesetId: 123 }, operation: { approvalDigest: H('deployment') } };
}
function envelope(value = policy()) { return { policy: value, signature: sign(null, hostApprovalSigningBytes(value), privateKey).toString('base64url') }; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

describe('follow-up rehearsal trusted host policy', () => {
  it('validates the complete unsigned policy without claiming signature authority', () => { const p = policy(), got = validateHostApprovalPolicy(p, root, NOW); expect(got).toEqual(p); expect(got).not.toBe(p); expect(() => validateHostApproval({ policy: got, signature: 'A'.repeat(86) }, root, NOW)).toThrow(); });
  it.each(['deploy-gateway', 'attach-gateway'])('accepts only github/cloudflare custody in %s mode', mode => { const p = policy(); p.mode = mode; p.custody.records = { github: p.custody.records.github, cloudflare: p.custody.records.cloudflare }; expect(validateHostApprovalPolicy(p, root, NOW)).toEqual(p); expect(validateHostApproval(envelope(p), root, NOW)).toEqual(p); p.custody.records.caller = policy().custody.records.caller; expect(() => validateHostApprovalPolicy(p, root, NOW)).toThrow(); });
  it('unsigned validation rejects invalid late-schema fields before signing custody', () => { const p = policy(); p.operation = { approvalDigest: 'not-a-digest' }; expect(() => validateHostApprovalPolicy(p, root, NOW)).toThrow(); });
  it('accepts an externally anchored exact signed deployment policy', () => expect(validateHostApproval(envelope(), root, NOW)).toEqual(policy()));
  it('has a stable digest distinct from its signature', () => expect(hostApprovalDigest(policy())).toMatch(/^[a-f0-9]{64}$/));
  for (const [name, edit] of [
    ['untrusted root', p => { p.ownerKeyId = 'other'; }],
    ['bad signature', (_p, e) => { e.signature = 'A'.repeat(86); }],
    ['expired policy', p => { p.expiresAt = NOW; }],
    ['overlong authorization', p => { p.expiresAt = p.issuedAt + 3600001; }],
    ['wrong repository', p => { p.ledger.repository = 'other/repo'; }],
    ['wrong ref namespace', p => { p.ledger.refPrefix = 'refs/heads/x/'; }],
    ['unmapped secret key', p => { p.custody.records.github.key = 'OTHER'; }],
    ['duplicate record ID', p => { p.custody.records.control.id = p.custody.records.issuer.id; }],
    ['unknown field', p => { p.extra = true; }],
  ]) it(`refuses ${name}`, () => { const p = policy(), e = envelope(p); edit(p, e); if (name !== 'bad signature') { e.signature = sign(null, hostApprovalSigningBytes(p), privateKey).toString('base64url'); expect(() => validateHostApprovalPolicy(p, root, NOW)).toThrow('rehearsal_host_refused'); } expect(() => validateHostApproval(e, root, NOW)).toThrow('rehearsal_host_refused'); });
});

describe('exact Bitwarden subprocess custody', () => {
  function childReturning(value, { code = 0, stderr = '' } = {}) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 137);
    queueMicrotask(() => { if (value !== undefined) child.stdout.end(typeof value === 'string' ? value : JSON.stringify(value)); if (stderr) child.stderr.end(stderr); child.emit('close', code); }); return child;
  }
  it('uses only exact get, pinned config/profile and bootstrap-only environment', async () => {
    const p = policy(), expected = p.custody.records.github; let call;
    const value = { ...expected, value: 'value-github' };
    const got = await runExactBwsRecord({ custody: p.custody, record: expected }, { inspectBinary() {}, readBootstrap: () => Buffer.from('bootstrap-token'), spawn: (file, args, options) => { call = { file, args, options }; return childReturning(value); } });
    expect(got).toEqual(value); expect(call.file).toBe('/reviewed/bws');
    expect(call.args).toEqual(['secret', 'get', expected.id, '--output', 'json', '--color', 'no', '--config-file', expect.stringMatching(/follow-up-rehearsal-bws\.toml$/), '--profile', 'rehearsal']);
    expect(call.options.env).toEqual({ BWS_ACCESS_TOKEN: 'bootstrap-token' }); expect(call.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });
  it('refuses subprocess failure without exposing stderr', async () => { const p = policy(); await expect(runExactBwsRecord({ custody: p.custody, record: p.custody.records.github }, { inspectBinary() {}, readBootstrap: () => Buffer.from('bootstrap'), spawn: () => childReturning(undefined, { code: 1, stderr: 'SECRET' }) })).rejects.toThrow('rehearsal_custody_refused'); });
  it('refuses malformed and oversize stdout', async () => { const p = policy(), args = { custody: p.custody, record: p.custody.records.github };
    await expect(runExactBwsRecord(args, { inspectBinary() {}, readBootstrap: () => Buffer.from('bootstrap'), spawn: () => childReturning('{') })).rejects.toThrow();
    await expect(runExactBwsRecord(args, { inspectBinary() {}, readBootstrap: () => Buffer.from('bootstrap'), spawn: () => childReturning('x'.repeat(HOST_LIMITS.bwsBytes + 1)) })).rejects.toThrow();
  });
  it('zeroes late stdout after an abort instead of retaining new chunks', async () => {
    const p = policy(), controller = new AbortController(), late = Buffer.from('late-secret'); let child;
    const pending = runExactBwsRecord({ custody: p.custody, record: p.custody.records.github, signal: controller.signal }, { inspectBinary() {}, readBootstrap: () => Buffer.from('bootstrap'), spawn: () => { child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; queueMicrotask(() => controller.abort()); return child; } });
    await expect(pending).rejects.toThrow('rehearsal_custody_refused'); child.stdout.emit('data', late); child.emit('close', 137); expect(late.equals(Buffer.alloc(late.length))).toBe(true);
  });
  it('validates exact metadata and value digest before callback', async () => { const p = policy(); let used = false; const custody = createExactCustody({ policy: p, run: async ({ record }) => ({ ...record, value: 'value-github' }) });
    expect(await custody('github', v => { used = true; return H(v); })).toBe(H('value-github')); expect(used).toBe(true);
    const bad = createExactCustody({ policy: p, run: async ({ record }) => ({ ...record, revisionDate: 'wrong', value: 'value-github' }) }); await expect(bad('github', () => {})).rejects.toThrow('rehearsal_custody_refused');
  });
  it('refuses unknown roles and excessive retrievals', async () => { const p = policy(), custody = createExactCustody({ policy: p, run: async ({ record }) => ({ ...record, value: 'value-github' }) });
    await expect(custody('unknown', () => {})).rejects.toThrow();
    for (let i = 0; i < HOST_LIMITS.bwsGets; i++) await custody('github', () => {});
    await expect(custody('github', () => {})).rejects.toThrow();
  });
});

function rules() { return { id: 123, source_type: 'Repository', source: 'Eben283/amarimethod-website', target: 'tag', enforcement: 'active', bypass_actors: [], conditions: { ref_name: { include: ['refs/tags/followup-rehearsal-consumed/*'], exclude: [] } }, rules: [{ type: 'deletion' }, { type: 'update' }] }; }
function mockLedger({ oldStatus = 404, failRef = false, mutateRules } = {}) {
  const calls = [], tagSha = 'd'.repeat(40), ref = `refs/tags/followup-rehearsal-consumed/${RELEASE}`;
  const http = async (url, options) => { const path = new URL(url).pathname.replace('/repos/Eben283/amarimethod-website', ''), method = options.method, body = options.body && JSON.parse(options.body); calls.push({ path, method, body });
    let status = 200, value;
    if (path === '/rulesets/123') value = mutateRules ? mutateRules(clone(rules())) : rules();
    else if (path === `/git/ref/tags/followup-rehearsal-consumed/${RELEASE}` && calls.filter(x => x.path === path).length === 1) { status = oldStatus; value = status === 404 ? { message: 'Not Found' } : { ref, object: { type: 'tag', sha: tagSha } }; }
    else if (path === '/git/ref/heads/main') value = { object: { type: 'commit', sha: REV } };
    else if (path === '/git/tags' && method === 'POST') value = { sha: tagSha, tag: body.tag, message: body.message, object: { type: 'commit', sha: REV } }, status = 201;
    else if (path === '/git/refs' && method === 'POST') { if (failRef) throw new Error('lost'); value = { ref, object: { type: 'tag', sha: tagSha } }; status = 201; }
    else if (path === `/git/ref/tags/followup-rehearsal-consumed/${RELEASE}`) value = { ref, object: { type: 'tag', sha: tagSha } };
    else if (path === `/git/tags/${tagSha}`) { const posted = calls.find(x => x.path === '/git/tags').body; value = { sha: tagSha, tag: posted.tag, message: posted.message, object: { type: 'commit', sha: REV } }; }
    else throw new Error(`unexpected ${method} ${path}`);
    return { status, headers: new Headers(), bytes: Buffer.from(JSON.stringify(value)) };
  }; return { http, calls };
}
describe('durable GitHub one-shot consume adapter', () => {
  function setup(options) { const p = policy(), evidence = { githubRequests: 0, githubWrites: 0, githubBytes: 0, consumptionState: 'not-attempted' }, ledger = mockLedger(options); const custody = async (role, use) => { expect(role).toBe('github'); return use('github-token-at-least-twenty-characters'); }; return { p, evidence, ledger, custody }; }
  it('creates and verifies one annotated tag reference only after strict rules', async () => { const x = setup(); const digest = x.p.operation.approvalDigest; expect(await consumeGitHubRelease({ policy: x.p, approvalDigest: digest, custody: x.custody, http: x.ledger.http, fresh() {}, evidence: x.evidence })).toEqual({ status: 'consumed', releaseId: RELEASE, approvalDigest: digest });
    expect(x.evidence).toMatchObject({ githubWrites: 2, consumptionState: 'consumed', tagObject: 'd'.repeat(40) }); expect(x.ledger.calls.filter(c => c.method !== 'GET')).toHaveLength(2);
  });
  it('refuses an existing ref without writes even if it might match', async () => { const x = setup({ oldStatus: 200 }); await expect(consumeGitHubRelease({ policy: x.p, approvalDigest: x.p.operation.approvalDigest, custody: x.custody, http: x.ledger.http, fresh() {}, evidence: x.evidence })).rejects.toThrow(); expect(x.evidence.githubWrites).toBe(0); });
  for (const [name, mutate] of [['missing bypass visibility', r => { delete r.bypass_actors; return r; }], ['bypass actor', r => { r.bypass_actors = [{ actor_type: 'OrganizationAdmin' }]; return r; }], ['no deletion rule', r => { r.rules.pop(); return r; }], ['evaluate only', r => { r.enforcement = 'evaluate'; return r; }]])
    it(`refuses ${name} before writes`, async () => { const x = setup({ mutateRules: mutate }); await expect(consumeGitHubRelease({ policy: x.p, approvalDigest: x.p.operation.approvalDigest, custody: x.custody, http: x.ledger.http, fresh() {}, evidence: x.evidence })).rejects.toThrow(); expect(x.evidence.githubWrites).toBe(0); });
  it('marks a lost create-ref ACK unknown and never returns consumed', async () => { const x = setup({ failRef: true }); await expect(consumeGitHubRelease({ policy: x.p, approvalDigest: x.p.operation.approvalDigest, custody: x.custody, http: x.ledger.http, fresh() {}, evidence: x.evidence })).rejects.toThrow('lost'); expect(x.evidence).toMatchObject({ githubWrites: 2, consumptionState: 'unknown' }); });
});

describe('public status inspection', () => {
  it('is explicitly read-only reconciliation evidence', async () => { const fetcher = async () => new Response(JSON.stringify({ ref: 'refs/tags/followup-rehearsal-consumed/' + RELEASE, object: { type: 'tag', sha: 'd'.repeat(40) } }), { status: 200 }); expect(await inspectReleaseStatus({ releaseId: RELEASE, fetch: fetcher })).toEqual({ status: 'observed-reconcile-only', executionAuthorized: false, retryAllowed: false }); });
  it('does not call malformed successful status readback observed', async () => { expect((await inspectReleaseStatus({ releaseId: RELEASE, fetch: async () => new Response('{}') })).status).toBe('unknown'); });
  it('never authorizes absence or failure', async () => { expect(await inspectReleaseStatus({ releaseId: RELEASE, fetch: async () => new Response('{}', { status: 404 }) })).toEqual({ status: 'not-observed', executionAuthorized: false, retryAllowed: false }); expect((await inspectReleaseStatus({ releaseId: RELEASE, fetch: async () => { throw new Error('offline'); } })).status).toBe('unknown'); });
});

const CHECKOUT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function fakeGit(args) {
  if (args[0] === 'status') return '';
  if (args[0] === 'rev-parse') return REV;
  if (args[0] === 'remote') return 'https://github.com/Eben283/amarimethod-website.git';
  if (args[0] === 'ls-remote') return `${REV}\trefs/heads/main`;
  if (args[0] === 'show') return readFileSync(resolve(CHECKOUT, args[1].slice(41)));
  throw new Error(`unexpected synthetic git ${args[0]}`);
}
const syntheticCandidate = () => ({ artifactDigest: DIGEST, artifact: { revision: REV, files: [], tools: { node: process.version, files: ['node_modules/esbuild/lib/main.js', 'node_modules/esbuild/package.json', `node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`, `node_modules/@esbuild/${process.platform}-${process.arch}/package.json`].map(path => ({ path, sha256: H(readFileSync(resolve(CHECKOUT, path))) })) } } });
function deploymentPolicy(p) {
  return { version: 'follow-up-rehearsal-deployment-approval.v1', releaseId: RELEASE, issuedAt: p.issuedAt, expiresAt: p.expiresAt, reviewedRevision: REV, sourceArtifactDigest: H('deploy-source'), accountId: DEPLOY_TARGETS.accountId, creates: { scripts: ['issuer', 'control', 'caller'].map(r => DEPLOY_TARGETS[r]), sqliteNamespace: { script: DEPLOY_TARGETS.control, className: 'FollowUpRehearsalRegistryV1', migrationTag: 'rehearsal-v1' } }, bucket: { name: DEPLOY_TARGETS.bucket, jurisdiction: 'us', creationDate: '2026-08-28T20:00:00Z', mode: 'existing-dedicated-empty' }, secretDigests: { issuer: H('i'), control: H('c'), caller: H('r') }, limits: DEPLOY_LIMITS, budget: { aggregateCeilingCents: 1000, remainingCents: 1000, deploymentEstimateCents: 100, cleanupReserveCents: 100 }, acknowledgements: { temporaryPublic404Shell: true, createsThreeScriptsAndOneNamespace: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true } };
}
function publicOperatorFixture() {
  const roles = ['root', 'owner', 'operator', 'reader', 'admission', 'capture', 'floor', 'receipt', 'witness', 'source'];
  const pairs = Object.fromEntries(roles.map(r => [r, generateKeyPairSync('ed25519')])), at = Date.now() - 100, day = 86400000;
  const id = x => `id_${H(x)}`, pem = r => pairs[r].publicKey.export({ type: 'spki', format: 'pem' }), fp = r => H(pairs[r].publicKey.export({ type: 'spki', format: 'der' }));
  const scope = { accountId: id('account'), targetId: id('target'), actionScopeDigest: H('action'), environment: 'synthetic', sinkId: id('sink'), registryId: id('registry'), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: REV, actionDigest: ACTION_DIGEST, handlerDigest: H('control'), epoch: id('epoch'), generation: 1, issuerReleaseDigest: H('issuer'), policyVersion: 'follow-up-retention-policy.v1' };
  const body = { version: VERSION, transport: 'private_service_binding_rpc', scope, origin: { sourceId: id('source'), sequence: 1, originalAt: at - 1000, approvedAt: at, dispatchUntil: at + 240000 }, aliasSetDigest: H('aliases'), replayHorizonUntil: at + 10 * day, retentionUntil: at + day - 2000, parentDeadline: at + day, deletionDeadline: null, issuedAt: at, expiresAt: at + 3600000, issuerSequence: 1, principals: ['owner', 'operator', 'reader'].map(role => ({ callerId: id(`caller/${role}`), keyId: id(role), publicKeySha256: fp(role), role, notBefore: at, expiresAt: at + 3600000 })), signers: Object.fromEntries(roles.slice(4).map(r => [r, { keyId: id(r), publicKeySha256: fp(r) }])) };
  const signedManifest = { body, keyId: id('root'), signature: sign(null, manifestSigningBytes(body), pairs.root.privateKey).toString('base64') };
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
  const accessId = 'f'.repeat(32) + '.access', principal = { callerId: id('caller/operator'), keyId: id('operator'), role: 'operator' };
  const access = { version: 'follow-up-operator-access.v1', origin: 'https://rehearsal.amarimethod.com', issuer: 'https://synthetic.cloudflareaccess.com', audience: H('aud'), manifestDigest: H(manifestSigningBytes(body)), scopeDigest: H(canonical(scope)), issuedAt: at, expiresAt: at + 3600000, jwks: [{ kid: 'synthetic-key', kty: 'RSA', alg: 'RS256', use: 'sig', n: rsa.n, e: rsa.e }], principals: [{ commonName: accessId, ...principal }] };
  const publicConfig = { REHEARSAL_MANIFEST: encode(signedManifest), REHEARSAL_CALLER_KEYS: encode({ root: { keyId: id('root'), publicKey: pem('root') }, principals: Object.fromEntries(['owner', 'operator', 'reader'].map(r => [r, pem(r)])) }), OPERATOR_ACCESS_CONFIG: encode(access) };
  const request = { version: VERSION, manifestDigest: access.manifestDigest, scopeDigest: access.scopeDigest, callerId: principal.callerId, role: 'operator', action: 'execute', body: {}, nonce: H('once'), issuedAt: at, expiresAt: at + 29999 };
  const requestText = encode({ body: request, keyId: principal.keyId, signature: sign(null, requestSigningBytes(request), pairs.operator.privateKey).toString('base64') });
  return { accessId, principal, publicConfig, requestText, origin: access.origin };
}

describe('host integration with explicitly synthetic Git/provider identities', () => {
  it('inspect pins actual current source/config/import graph without authorizing it', async () => { const result = await inspectHostCandidate({ git: fakeGit }); expect(result.executionAuthorized).toBe(false); expect(result.artifact.files.map(f => f.path)).toEqual(expect.arrayContaining(['scripts/follow-up-rehearsal-host.mjs', 'scripts/follow-up-rehearsal-bws.toml', 'follow-up-rehearsal-worker/src/operator-access.mjs', 'follow-up-rehearsal-worker/wrangler.operator.jsonc'])); });
  function invocation(options = {}) {
    const f = publicOperatorFixture(), p = policy(); p.mode = 'invoke'; p.operation = { origin: f.origin, path: '/v1/rehearsal', envelopeDigest: H(f.requestText), publicConfig: f.publicConfig, principal: f.principal };
    const values = { github: 'github-token-at-least-twenty-characters', accessId: f.accessId, accessSecret: 'cfast_synthetic-never-a-real-secret' };
    p.custody.records = Object.fromEntries(['github', 'accessId', 'accessSecret'].map((role, i) => [role, { ...policy().custody.records.github, id: UUIDS[i], key: HOST_RECORD_KEYS[role] ?? HOST_ACCESS_RECORD_KEYS[f.principal.role][role], sha256: H(values[role]) }]));
    const ledger = mockLedger(options), gets = [], posts = [];
    const runBws = async ({ record }) => { const role = Object.keys(p.custody.records).find(k => p.custody.records[k].id === record.id); gets.push(role); return { ...record, value: values[role] }; };
    const fetcher = async (url, opts) => { if (url.startsWith('https://api.github.com/')) { const r = await ledger.http(url, opts); return new Response(r.bytes, { status: r.status, headers: r.headers }); } posts.push({ url, opts }); if (options.lostOperator) throw Error('unknown post');
      const text = options.reply === 'oversize' ? 'x'.repeat(HOST_LIMITS.operatorBytes + 1) : options.reply === 'invalid' ? '{}' : options.reply === 'authority' ? encode({ contract: VERSION, status: 'refused', requiresReadOnlyReconciliation: false, productionAuthority: true }) : encode({ contract: VERSION, status: 'refused', requiresReadOnlyReconciliation: false, productionAuthority: false });
      const response = new Response(text, { status: options.reply === 'redirect' ? 302 : 200, headers: { 'Content-Type': 'application/json' } }); if (options.reply === 'redirected') Object.defineProperty(response, 'redirected', { value: true }); return response;
    };
    return { f, p, gets, posts, ledger, run: extra => runRehearsalHost({ execute: true, hostApproval: envelope(p), trustedRoot: root, requestText: f.requestText, git: fakeGit, fetch: fetcher, runBws, inspect: async () => syntheticCandidate(), ...extra }) };
  }
  it('consumes durably before Access custody and forwards exact signed bytes once', async () => { const x = invocation(), r = await x.run(); expect(r).toMatchObject({ status: 'invocation-response', consumptionState: 'consumed', githubWrites: 2, operatorAttempts: 1 }); expect(x.gets).toEqual(['github', 'accessId', 'accessSecret']); expect(x.posts).toHaveLength(1); expect(x.posts[0]).toMatchObject({ url: x.f.origin + '/v1/rehearsal', opts: { method: 'POST', body: x.f.requestText, redirect: 'error', headers: { 'CF-Access-Client-Id': x.f.accessId } } }); });
  it('refuses another principal role\'s Access record names before custody', async () => { const x = invocation(); x.p.custody.records.accessId.key = HOST_ACCESS_RECORD_KEYS.owner.accessId; x.p.custody.records.accessSecret.key = HOST_ACCESS_RECORD_KEYS.owner.accessSecret; expect((await x.run()).status).toBe('refused'); expect(x.gets).toEqual([]); expect(x.posts).toEqual([]); });
  it('refuses without execute before all custody and HTTP', async () => { const x = invocation(); expect((await x.run({ execute: false })).status).toBe('refused'); expect(x.gets).toEqual([]); expect(x.posts).toEqual([]); });
  it('refuses oversized host input before custody', async () => { const x = invocation(); expect((await x.run({ hostApproval: { oversized: 'x'.repeat(131073) } })).status).toBe('refused'); expect(x.gets).toEqual([]); });
  it('refuses altered signed bytes before custody', async () => { const x = invocation(); expect((await x.run({ requestText: x.f.requestText + ' ' })).status).toBe('refused'); expect(x.gets).toEqual([]); });
  it('lost ledger ACK never retrieves Access credentials or sends an invocation', async () => { const x = invocation({ failRef: true }), r = await x.run(); expect(r).toMatchObject({ status: 'reconciliation-required', consumptionState: 'unknown', operatorAttempts: 0 }); expect(x.gets).toEqual(['github']); expect(x.posts).toEqual([]); });
  it('lost operator response is indeterminate without a retry', async () => { const x = invocation({ lostOperator: true }), r = await x.run(); expect(r).toMatchObject({ status: 'reconciliation-required', consumptionState: 'consumed', operatorAttempts: 1, retryAllowed: false }); expect(x.posts).toHaveLength(1); });
  for (const reply of ['oversize', 'invalid', 'authority', 'redirect', 'redirected']) it(`refuses ${reply} operator reply without retry`, async () => { const x = invocation({ reply }); expect(await x.run()).toMatchObject({ status: 'reconciliation-required', operatorAttempts: 1, retryAllowed: false }); expect(x.posts).toHaveLength(1); });
  for (const kind of ['fetch', 'body']) it(`host closure blocks later deployment calls when ${kind} ignores abort`, async () => {
    // Keep setup time outside the simulated clock. Advance the actual host timer
    // only once a first provider request/body read is demonstrably in flight.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
    let releaseHeld, notifyStarted, finished, hasStarted = false, readBlocked = false, nextBlocked = false;
    const held = new Promise(r => { releaseHeld = r; }), started = new Promise(r => { notifyStarted = r; }), settled = new Promise(r => { finished = r; });
    let providerCalls = 0;
    try {
      const p = policy(); p.expiresAt = NOW + 400; const a = deploymentPolicy(p); p.operation.approvalDigest = deploymentApprovalDigest(a);
      const values = { github: 'github-token-at-least-twenty-characters', cloudflare: 'cloudflare-token-at-least-twenty' }; for (const role of Object.keys(values)) p.custody.records[role].sha256 = H(values[role]);
      const ledger = mockLedger();
      const running = runRehearsalHost({ execute: true, hostApproval: envelope(p), trustedRoot: root, deploymentApproval: a, git: fakeGit, inspect: async () => syntheticCandidate(), runBws: async ({ record }) => { const role = Object.keys(p.custody.records).find(k => p.custody.records[k].id === record.id); return { ...record, value: values[role] }; },
        fetch: async (url, opts) => { if (url.startsWith('https://api.github.com/')) { const r = await ledger.http(url, opts); return new Response(r.bytes, { status: r.status, headers: r.headers }); } providerCalls++;
          const begun = () => { hasStarted = true; notifyStarted(); };
          if (kind === 'fetch') { begun(); await held; return new Response('{}'); }
          return new Response(new ReadableStream({ async pull(controller) { begun(); await held; controller.enqueue(new TextEncoder().encode('{}')); controller.close(); } }));
        }, deploy: async c => { try {
          await c.consumeRelease({ releaseId: RELEASE, approvalDigest: p.operation.approvalDigest, expiresAt: p.expiresAt });
          await c.withCloudflareToken(async () => {
            try { const response = await c.fetch('https://api.cloudflare.com/synthetic-first', { method: 'GET' }); await response.text(); } catch { readBlocked = true; }
            // Even a misbehaving continuation that explicitly tries again after
            // the held response settles must not reach the underlying fetch.
            try { await c.fetch('https://api.cloudflare.com/forbidden-next', { method: 'GET' }); } catch { nextBlocked = true; }
          }); return { status: 'impossible' };
        } finally { finished(); } } });
      await Promise.race([started, running.then(result => { throw new Error(`provider never started: ${JSON.stringify(result)}`); })]);
      expect(providerCalls).toBe(1); await vi.advanceTimersByTimeAsync(401);
      expect(await running).toMatchObject({ status: 'reconciliation-required', consumptionState: 'consumed', retryAllowed: false });
      releaseHeld(); await settled;
      expect(readBlocked).toBe(true); expect(nextBlocked).toBe(true); expect(providerCalls).toBe(1);
    } finally { releaseHeld(); if (hasStarted) await settled; vi.useRealTimers(); }
  });
  it('wires deployment custody to the existing transport after durable consume', async () => {
    const p = policy(), a = { version: 'follow-up-rehearsal-deployment-approval.v1', releaseId: RELEASE, issuedAt: p.issuedAt, expiresAt: p.expiresAt, reviewedRevision: REV, sourceArtifactDigest: H('deploy-source'), accountId: DEPLOY_TARGETS.accountId, creates: { scripts: ['issuer', 'control', 'caller'].map(r => DEPLOY_TARGETS[r]), sqliteNamespace: { script: DEPLOY_TARGETS.control, className: 'FollowUpRehearsalRegistryV1', migrationTag: 'rehearsal-v1' } }, bucket: { name: DEPLOY_TARGETS.bucket, jurisdiction: 'us', creationDate: '2026-08-28T20:00:00Z', mode: 'existing-dedicated-empty' }, secretDigests: { issuer: H('i'), control: H('c'), caller: H('r') }, limits: DEPLOY_LIMITS, budget: { aggregateCeilingCents: 1000, remainingCents: 1000, deploymentEstimateCents: 100, cleanupReserveCents: 100 }, acknowledgements: { temporaryPublic404Shell: true, createsThreeScriptsAndOneNamespace: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true } };
    p.operation.approvalDigest = deploymentApprovalDigest(a); const values = { github: 'github-token-at-least-twenty-characters', cloudflare: 'cloudflare-token-at-least-twenty', issuer: '{}', control: '{}', caller: '{}' }; for (const role of Object.keys(values)) p.custody.records[role].sha256 = H(values[role]);
    const ledger = mockLedger(), order = [];
    const result = await runRehearsalHost({ execute: true, hostApproval: envelope(p), trustedRoot: root, deploymentApproval: a, git: fakeGit, inspect: async () => syntheticCandidate(), runBws: async ({ record }) => { const role = Object.keys(p.custody.records).find(k => p.custody.records[k].id === record.id); order.push(role); return { ...record, value: values[role] }; }, fetch: async (url, opts) => { const r = await ledger.http(url, opts); return new Response(r.bytes, { status: r.status, headers: r.headers }); }, deploy: async callbacks => { await callbacks.consumeRelease({ releaseId: RELEASE, approvalDigest: p.operation.approvalDigest, expiresAt: p.expiresAt }); await callbacks.withCloudflareToken(async () => { for (const role of ['issuer', 'control', 'caller']) await callbacks.withWorkerSecrets(role, async v => expect(v).toEqual({})); }); return { status: 'deployed-not-invoked', runtimeInvoked: false }; } });
    expect(result.status).toBe('deployed-not-invoked'); expect(order).toEqual(['github', 'cloudflare', 'issuer', 'control', 'caller']);
  });
});
