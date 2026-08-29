import { beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEPLOY_LIMITS, DEPLOY_TARGETS as TARGET, SHELL_SOURCE, deployRehearsal, deploymentApprovalDigest, inspectDeploymentCandidate, validateDeploymentApproval } from '../../scripts/follow-up-rehearsal-deploy.mjs';
import { VERSION, ACTION_DIGEST, canonical, encode, manifestSigningBytes } from '../../follow-up-rehearsal-worker/src/protocol.mjs';
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from '../../scripts/lib/follow-up-evidence-storage-adapters.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REV = 'a'.repeat(40), REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const hash = v => createHash('sha256').update(v).digest('hex'), id = v => 'id_' + hash(v);
const roles = ['issuer', 'control', 'caller'];
const keyRoles = ['root', 'owner', 'operator', 'reader', 'admission', 'capture', 'floor', 'receipt', 'witness', 'source'];
const keys = Object.fromEntries(keyRoles.map(role => [role, generateKeyPairSync('ed25519')]));
const pub = role => keys[role].publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = role => hash(keys[role].publicKey.export({ type: 'spki', format: 'der' }));
const NS = 'c'.repeat(32), ZONE = 'd'.repeat(32);
let candidate;
function git(args) {
  const key = args.join(' ');
  if (key === 'rev-parse HEAD' || key === 'rev-parse origin/main') return REV;
  if (key === 'status --porcelain=v1 --untracked-files=all') return '';
  if (key === 'remote get-url origin') return REMOTE;
  if (args[0] === 'show') return readFileSync(`${ROOT}/${args[1].slice(41)}`);
  if (args[0] === 'ls-remote') return `${REV}\trefs/heads/main`;
  throw Error('unexpected git read');
}
beforeAll(async () => { candidate = await inspectDeploymentCandidate({ git }); });
function fixture() {
  const now = Date.now() - 50, day = 86400000;
  const scope = { accountId: id('synthetic account'), targetId: id('synthetic target'), actionScopeDigest: hash('counter'), environment: 'synthetic', sinkId: id('sink'), registryId: id('registry'), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: REV, actionDigest: ACTION_DIGEST, handlerDigest: candidate.artifact.bundles.find(b => b.role === 'control').sha256, epoch: id('epoch'), generation: 1, issuerReleaseDigest: candidate.artifact.bundles.find(b => b.role === 'issuer').sha256, policyVersion: 'follow-up-retention-policy.v1' };
  const body = { version: VERSION, transport: 'private_service_binding_rpc', scope, origin: { sourceId: id('origin'), sequence: 10, originalAt: now - 1000, approvedAt: now, dispatchUntil: now + 240000 }, aliasSetDigest: hash('aliases'), replayHorizonUntil: now + 10 * day, retentionUntil: now + day - 2000, parentDeadline: now + day, deletionDeadline: null, issuedAt: now, expiresAt: now + 3600000, issuerSequence: 10, principals: ['owner', 'operator', 'reader'].map(role => ({ callerId: id('caller/' + role), keyId: id(role), publicKeySha256: fingerprint(role), role, notBefore: now, expiresAt: now + 3600000 })), signers: Object.fromEntries(keyRoles.slice(4).map(role => [role, { keyId: id(role), publicKeySha256: fingerprint(role) }])) };
  const manifest = encode({ body, keyId: id('root'), signature: sign(null, manifestSigningBytes(body), keys.root.privateKey).toString('base64') });
  const values = Object.fromEntries(['issuer', 'control'].map(location => [location, { REHEARSAL_MANIFEST: manifest, REHEARSAL_KEYS: encode({ root: { keyId: id('root'), publicKey: pub('root') }, publicKeys: Object.fromEntries(keyRoles.slice(1).map(role => [role, pub(role)])), privateKeys: Object.fromEntries((location === 'control' ? ['receipt', 'witness'] : ['admission', 'capture', 'floor', 'source']).map(role => [role, keys[role].privateKey.export({ type: 'pkcs8', format: 'pem' })])) }) }]));
  values.caller = { REHEARSAL_MANIFEST: manifest, REHEARSAL_CALLER_KEYS: encode({ root: { keyId: id('root'), publicKey: pub('root') }, principals: Object.fromEntries(['owner', 'operator', 'reader'].map(role => [role, pub(role)])) }) };
  const approval = { version: 'follow-up-rehearsal-deployment-approval.v1', releaseId: hash('synthetic-release'), issuedAt: now, expiresAt: now + 300000, reviewedRevision: REV, sourceArtifactDigest: candidate.artifactDigest, accountId: TARGET.accountId, creates: { scripts: roles.map(r => TARGET[r]), sqliteNamespace: { script: TARGET.control, className: 'FollowUpRehearsalRegistryV1', migrationTag: 'rehearsal-v1' } }, bucket: { name: TARGET.bucket, jurisdiction: 'us', creationDate: '2026-08-28T00:00:00.000Z', mode: 'existing-dedicated-empty' }, secretDigests: Object.fromEntries(roles.map(role => [role, hash(canonical(values[role]))])), limits: DEPLOY_LIMITS, budget: { aggregateCeilingCents: 1000, remainingCents: 900, deploymentEstimateCents: 100, cleanupReserveCents: 100 }, acknowledgements: { temporaryPublic404Shell: true, createsThreeScriptsAndOneNamespace: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true } };
  const state = { workers: {}, calls: [], writes: [], secretRoles: [], tokens: 0, consumed: 0, namespace: false };
  const options = {};
  const json = (result, result_info) => Response.json({ success: true, errors: [], result, ...(result_info ? { result_info } : {}) });
  const list = array => json(array, { total_pages: 1, total_count: array.length });
  const fetch = async (url, init) => {
    const u = new URL(url), path = u.pathname.replace('/client/v4', ''), method = init.method;
    state.calls.push({ path, method });
    expect(u.origin).toBe('https://api.cloudflare.com'); expect(init.redirect).toBe('error'); expect(init.headers.Authorization).toBe('Bearer synthetic-test-only-token-123');
    if (options.throwRead && method === 'GET') throw Error('private provider failure do-not-return');
    if (path === '/zones') return options.incompleteZones ? json([], { total_pages: 2, total_count: 51 }) : list([{ id: ZONE, account: { id: TARGET.accountId } }]);
    if (path === `/zones/${ZONE}/workers/routes`) return json(options.route ? [{ script: TARGET.control }] : []);
    const base = `/accounts/${TARGET.accountId}`;
    if (path === `${base}/workers/domains`) return list(options.domain ? [{ service: TARGET.caller }] : []);
    if (path === `${base}/workers/durable_objects/namespaces`) return list(options.existingNamespace || state.namespace ? [{ id: NS, script: TARGET.control, class: 'FollowUpRehearsalRegistryV1', use_sqlite: !options.wrongSqlite }] : []);
    if (path === `${base}/r2/buckets/${TARGET.bucket}`) { expect(init.headers['cf-r2-jurisdiction']).toBe('us'); return json({ name: TARGET.bucket, jurisdiction: options.wrongJurisdiction ? 'eu' : 'us', creation_date: approval.bucket.creationDate }); }
    if (path === `${base}/r2/buckets/${TARGET.bucket}/objects`) {
      const result = options.nonemptyBucket ? [{ key: 'existing' }] : [];
      return options.omitObjectResultInfo ? json(result) : json(result, { is_truncated: !!options.truncatedBucket });
    }
    const match = path.match(/\/workers\/scripts\/([^/]+)(.*)$/); if (!match) throw Error('unimplemented synthetic route');
    const [, name, suffix] = match, role = roles.find(r => TARGET[r] === name); expect(role).toBeTruthy(); let worker = state.workers[name];
    if (method === 'PUT') {
      const form = await new Response(init.body, { headers: { 'Content-Type': init.headers['Content-Type'] } }).formData();
      expect([...form.keys()]).toEqual(['metadata', 'worker.mjs']);
      const meta = JSON.parse(form.get('metadata')), content = Buffer.from(await form.get('worker.mjs').arrayBuffer());
      const versionId = `00000000-0000-0000-0000-${String(state.writes.length + 1).padStart(12, '0')}`;
      worker = { meta, content, versionId, private: worker?.private ?? false };
      state.workers[name] = worker; state.writes.push({ role, method, meta, content });
      if (meta.migrations) state.namespace = true;
      if (options.lostPut) throw Error('secret value from failed upstream');
      return json({ id: name });
    }
    if (suffix === '/settings' && (!worker || options.existingScript)) {
      if (options.existingScript) return json({ bindings: [] });
      return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 });
    }
    if (!worker) throw Error('synthetic worker not found');
    if (suffix === '/subdomain') {
      if (method === 'POST') { expect(JSON.parse(init.body)).toEqual({ enabled: false, previews_enabled: false }); worker.private = !options.stillPublic; state.writes.push({ role, method }); }
      return json({ enabled: !worker.private, previews_enabled: !worker.private });
    }
    if (suffix === '/deployments') return json({ deployments: [{ id: '10000000-0000-0000-0000-000000000001', versions: [{ version_id: worker.versionId, percentage: options.partialDeployment ? 50 : 100 }] }] });
    if (suffix.startsWith('/versions/')) return json({ id: worker.versionId, annotations: options.wrongProvenance ? {} : { ...worker.meta.annotations, 'workers/triggered_by': 'upload' } });
    if (suffix === '/content/v2') { const form = new FormData(); form.set('worker.mjs', new Blob([options.corruptContent ? 'bad' : worker.content], { type: 'application/javascript+module' }), 'worker.mjs'); return new Response(form, { headers: { 'cf-entrypoint': options.wrongEntrypoint ? 'other.mjs' : 'worker.mjs' } }); }
    if (suffix === '/settings') {
      const meta = structuredClone(worker.meta);
      meta.bindings = meta.bindings.map(b => { if (b.type === 'secret_text') delete b.text; if (b.type === 'durable_object_namespace') b.namespace_id = NS; return b; });
      if (options.extraBinding) meta.bindings.push({ name: 'PRODUCTION', type: 'plain_text', text: 'not allowed' });
      return json(meta);
    }
    throw Error('unimplemented synthetic operation');
  };
  const args = { execute: true, approval, approvedDigest: deploymentApprovalDigest(approval), git, fetch,
    consumeRelease: async q => { state.consumed++; return { status: 'consumed', releaseId: q.releaseId, approvalDigest: q.approvalDigest }; },
    withCloudflareToken: async callback => { state.tokens++; return callback('synthetic-test-only-token-123'); },
    withWorkerSecrets: async (role, callback) => { state.secretRoles.push(role); return callback(values[role]); } };
  return { args, approval, values, state, options, refresh() { args.approvedDigest = deploymentApprovalDigest(approval); } };
}

describe('actual release bytes with simulated Git, provider and trusted custody', () => {
  it('builds actual three-worker graph and never calls providers during inspection', () => {
    expect(candidate.artifact.bundles.map(b => b.role)).toEqual(roles);
    expect(candidate.artifact.files.map(f => f.path)).toContain('follow-up-rehearsal-worker/src/caller-authorization.mjs');
    expect(candidate.deploymentAuthorized).toBe(false);
    expect(candidate.artifact.shellSha256).toBe(hash(SHELL_SOURCE));
  });
  it('uploads only fixed shells then source-attested private issuer/control/caller; never invokes runtime', async () => {
    const f = fixture(), result = await deployRehearsal(f.args);
    expect(result).toMatchObject({ status: 'deployed-not-invoked', attemptedWrites: 9, consumptionState: 'consumed', runtimeInvoked: false, retryAllowed: false });
    expect(result.identities.namespaceId).toBe(NS); expect(result.requests).toBeLessThanOrEqual(DEPLOY_LIMITS.requests);
    expect(f.state.secretRoles).toEqual(roles);
    const puts = f.state.writes.filter(w => w.method === 'PUT');
    expect(puts.map(w => w.role)).toEqual([...roles, ...roles]);
    for (const first of puts.slice(0, 3)) { expect(first.content.toString()).toBe(SHELL_SOURCE); expect(first.meta.bindings).toEqual([]); expect(first.meta.migrations).toBeUndefined(); }
    for (const final of puts.slice(3)) expect(hash(final.content)).toBe(candidate.artifact.bundles.find(b => b.role === final.role).sha256);
    expect(puts.filter(p => p.meta.migrations).map(p => p.role)).toEqual(['control']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY'); expect(JSON.stringify(result)).not.toContain('synthetic-test-only-token');
  });
  it('accepts Cloudflare\'s successful empty R2 object-list shape without result_info', async () => {
    const f = fixture(); f.options.omitObjectResultInfo = true;
    const result = await deployRehearsal(f.args);
    expect(result).toMatchObject({ status: 'deployed-not-invoked', attemptedWrites: 9 });
    expect(f.state.secretRoles).toEqual(roles);
  });
  it.each(['existingScript', 'existingNamespace', 'nonemptyBucket', 'truncatedBucket', 'wrongJurisdiction', 'incompleteZones', 'route', 'domain', 'throwRead'])('refuses %s before writes or Worker secrets', async failure => {
    const f = fixture(); f.options[failure] = true; const result = await deployRehearsal(f.args);
    expect(result.status).toBe('refused'); expect(result.attemptedWrites).toBe(0); expect(f.state.secretRoles).toEqual([]);
  });
  it.each(['lostPut', 'corruptContent', 'wrongEntrypoint', 'wrongProvenance', 'partialDeployment', 'extraBinding', 'stillPublic'])('stops after %s without retry or key upload', async failure => {
    const f = fixture(); f.options[failure] = true; const result = await deployRehearsal(f.args);
    expect(result.status).toBe('reconciliation-required'); expect(result.attemptedWrites).toBeGreaterThan(0); expect(result.attemptedWrites).toBeLessThanOrEqual(2); expect(f.state.secretRoles).toEqual([]); expect(result.retryAllowed).toBe(false);
  });
  it('unknown durable-consumption acknowledgement is unknown, no credential or provider call', async () => {
    const f = fixture(); f.args.consumeRelease = async () => { throw Error('lost durable ACK'); };
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', consumed: null, consumptionState: 'unknown', attemptedWrites: 0, requests: 0 });
    expect(f.state.tokens).toBe(0);
  });
  it('requires a durable consumed acknowledgement bound to this exact approval', async () => {
    const f = fixture(); f.args.consumeRelease = async () => ({ status: 'consumed', releaseId: f.approval.releaseId, approvalDigest: 'b'.repeat(64) });
    expect(await deployRehearsal(f.args)).toMatchObject({ consumed: null, requests: 0, attemptedWrites: 0 });
  });
  it('does not reconsume or overwrite any existing targets on a second external invocation', async () => {
    const f = fixture(); expect((await deployRehearsal(f.args)).status).toBe('deployed-not-invoked');
    f.args.consumeRelease = async () => ({ status: 'already-consumed' });
    const result = await deployRehearsal(f.args); expect(result.requests).toBe(0); expect(result.attemptedWrites).toBe(0); expect(result.retryAllowed).toBe(false);
  });
  it('requires explicit execution and approval before all external callbacks', async () => {
    const f = fixture(); f.args.execute = false;
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', consumptionState: 'not-attempted', requests: 0 }); expect(f.state.consumed).toBe(0);
  });
  it.each(['dirty', 'wrong-origin', 'stale-main', 'hidden-change'])('rejects %s source before durable consumption', async reason => {
    const f = fixture(); f.args.git = args => {
      if (reason === 'dirty' && args[0] === 'status') return ' M source';
      if (reason === 'wrong-origin' && args[0] === 'remote') return 'https://example.com';
      if (reason === 'stale-main' && args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/heads/main`;
      if (reason === 'hidden-change' && args[0] === 'show') return 'different';
      return git(args);
    };
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', requests: 0, attemptedWrites: 0 }); expect(f.state.consumed).toBe(0);
  });
  it('changed main between preflight and first upload stops without a write', async () => {
    const f = fixture(); let reads = 0; f.args.git = args => args[0] === 'ls-remote' && ++reads > 1 ? `${'b'.repeat(40)}\trefs/heads/main` : git(args);
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 });
  });
  it('never forwards wrong private key-role bytes to upload', async () => {
    const f = fixture(); f.args.withWorkerSecrets = async (role, callback) => callback({ ...f.values[role], REHEARSAL_KEYS: 'unapproved secret' });
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 6 });
    expect(f.state.writes.filter(w => w.method === 'PUT')).toHaveLength(3);
  });
  it('refuses separately valid but different role manifests before the mismatched upload', async () => {
    const f = fixture(), envelope = JSON.parse(f.values.control.REHEARSAL_MANIFEST);
    envelope.body.scope.epoch = id('different epoch'); envelope.signature = sign(null, manifestSigningBytes(envelope.body), keys.root.privateKey).toString('base64');
    f.values.control.REHEARSAL_MANIFEST = encode(envelope); f.approval.secretDigests.control = hash(canonical(f.values.control)); f.refresh();
    const result = await deployRehearsal(f.args);
    expect(result).toMatchObject({ status: 'reconciliation-required', stage: 'control:final-upload', attemptedWrites: 7 });
    expect(f.state.writes.filter(w => w.method === 'PUT' && w.meta.bindings.length).map(w => w.role)).toEqual(['issuer']);
  });
  it('rejects a concurrent private shell replacement instead of overwriting it', async () => {
    const f = fixture(), original = f.args.fetch; let changed = false;
    f.args.fetch = async (url, init) => {
      if (!changed && f.state.writes.length === 6) { changed = true; f.state.workers[TARGET.issuer].versionId = '90000000-0000-0000-0000-000000000000'; }
      return original(url, init);
    };
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 6 });
    expect(f.state.secretRoles).toEqual(['issuer']);
  });
  it('early-returning Worker secret wrappers cannot report success or upload later', async () => {
    const f = fixture(); let late;
    f.args.withWorkerSecrets = async (role, callback) => { late = () => callback(f.values[role]); };
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 6 });
    await expect(late()).rejects.toThrow(); expect(f.state.writes).toHaveLength(6);
  });
  it('refuses wrappers which return without invoking their callback', async () => {
    const f = fixture(); f.args.withCloudflareToken = async () => undefined;
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', requests: 0, attemptedWrites: 0 });
  });
  it('refuses late unawaited token callbacks and prevents following requests', async () => {
    const f = fixture(); let late;
    f.args.withCloudflareToken = async callback => { late = callback; };
    expect((await deployRehearsal(f.args)).status).toBe('refused');
    await expect(late('synthetic-test-only-token-123')).rejects.toThrow(); expect(f.state.calls).toEqual([]);
  });
  it('observes a started-but-unawaited token callback and blocks its late continuation', async () => {
    const f = fixture(); let release;
    f.args.withCloudflareToken = callback => { callback('synthetic-test-only-token-123'); };
    f.args.fetch = () => new Promise(resolve => { release = resolve; });
    const result = await deployRehearsal(f.args); expect(result).toMatchObject({ status: 'refused', attemptedWrites: 0, requests: 1 });
    release(Response.json({ success: true, result: [], result_info: { total_count: 0, total_pages: 1 } }));
    await new Promise(resolve => setTimeout(resolve, 0)); expect(result.requests).toBe(1); expect(f.state.writes).toEqual([]);
  });
  it('observes a started-but-unawaited Worker-secret callback without a late upload', async () => {
    const f = fixture(), original = f.args.fetch; let release;
    f.args.withWorkerSecrets = (role, callback) => { callback(f.values[role]); };
    f.args.fetch = (url, init) => f.state.writes.length === 6 && url.endsWith('/deployments') ? new Promise(resolve => { release = resolve; }) : original(url, init);
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 6 });
    release(Response.json({ success: true, result: { deployments: [] } }));
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.state.writes).toHaveLength(6);
  });
  it('expires before a late durable response without requesting credentials', async () => {
    const f = fixture(); let time = Date.now(); f.args.clock = () => time;
    f.args.consumeRelease = async q => { time = f.approval.expiresAt; return { status: 'consumed', releaseId: q.releaseId, approvalDigest: q.approvalDigest }; };
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', consumed: null, requests: 0 });
  });
  it('bounds a hung durable callback and classifies its consumption as unknown', async () => {
    const f = fixture(); f.approval.expiresAt = Date.now() + 300; f.refresh(); f.args.consumeRelease = () => new Promise(() => {});
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', consumptionState: 'unknown', attemptedWrites: 0, requests: 0 });
  });
  it('bounds a hung provider response even when fetch ignores the abort signal', async () => {
    const f = fixture(); f.approval.expiresAt = Date.now() + 300; f.refresh(); f.args.fetch = () => new Promise(() => {});
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', consumptionState: 'consumed', attemptedWrites: 0, requests: 1 });
  });
  it('rejects an oversized streamed response and cancels without waiting for cancellation', async () => {
    const f = fixture(); let cancelled = false;
    f.args.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(DEPLOY_LIMITS.responseBytes + 1)); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
    expect(await deployRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); expect(cancelled).toBe(true);
  });
});

describe('finite explicit resource/operation approval', () => {
  it.each([
    ['budget over authorized aggregate', a => { a.budget.aggregateCeilingCents = 1001; }],
    ['no cleanup reserve', a => { a.budget.cleanupReserveCents = 0; }],
    ['unbounded requests', a => { a.limits = { ...a.limits, requests: 10000 }; }],
    ['wrong account', a => { a.accountId = '0'.repeat(32); }],
    ['implicit provisioning', a => { a.bucket.mode = 'create-if-missing'; }],
    ['reusing unrelated bucket', a => { a.bucket.name = 'amari-staff-media'; }],
    ['extra script', a => { a.creates.scripts.push('production'); }],
    ['unapproved namespace migration', a => { a.creates.sqliteNamespace.className = 'Other'; }],
    ['unacknowledged transient shell', a => { a.acknowledgements.temporaryPublic404Shell = false; }],
    ['permission to invoke', a => { a.acknowledgements.noInvocation = false; }],
    ['no exclusion of concurrent writers', a => { a.acknowledgements.exclusiveReleaseCustody = false; }],
    ['expired approval', a => { a.expiresAt = a.issuedAt; }],
    ['excess approval duration', a => { a.expiresAt = a.issuedAt + 3600001; }],
  ])('rejects %s even with a matching supplied hash', (_, mutate) => {
    const f = fixture(); mutate(f.approval); f.refresh();
    expect(() => validateDeploymentApproval(f.approval, f.args.approvedDigest, Date.now())).toThrow();
  });
  it('requires the exact reviewed approval digest', () => { const f = fixture(); expect(() => validateDeploymentApproval(f.approval, '0'.repeat(64), Date.now())).toThrow(); });
});
