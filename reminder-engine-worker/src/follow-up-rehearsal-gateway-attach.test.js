import { ATTACH_LIMITS, inspectGatewayAttachmentCandidate, gatewayAttachmentApprovalDigest, validateGatewayAttachmentApproval, attachGatewayRehearsal } from '../../scripts/follow-up-rehearsal-gateway-attach.mjs';
import { validateRehearsalAccessReadback } from '../../scripts/lib/follow-up-rehearsal-access-readback.mjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { GATEWAY_TARGET, GATEWAY_LIMITS, inspectGatewayDeploymentCandidate, gatewayDeploymentApprovalDigest, validateGatewayDeploymentApproval, deployGatewayRehearsal } from '../../scripts/follow-up-rehearsal-gateway-deploy.mjs';
import { DEPLOY_LIMITS, DEPLOY_TARGETS as TARGET, SHELL_SOURCE, deploymentApprovalDigest } from '../../scripts/follow-up-rehearsal-deploy.mjs';
import { HOST_RECORD_KEYS, inspectHostCandidate, hostApprovalSigningBytes, runRehearsalHost } from '../../scripts/follow-up-rehearsal-host.mjs';
import { VERSION, ACTION_DIGEST, canonical, encode, manifestSigningBytes } from '../../follow-up-rehearsal-worker/src/protocol.mjs';
import { FOLLOW_UP_REGISTRY_SCHEMA_DIGEST } from '../../scripts/lib/follow-up-evidence-storage-adapters.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)), REV = 'a'.repeat(40), PRIOR = 'b'.repeat(40), ZONE = 'd'.repeat(32);
const hash = x => createHash('sha256').update(x).digest('hex'), id = x => 'id_' + hash(x), uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roles = ['root', 'owner', 'operator', 'reader', 'admission', 'capture', 'floor', 'receipt', 'witness', 'source'];
const keys = Object.fromEntries(roles.map(r => [r, generateKeyPairSync('ed25519')]));
const pub = r => keys[r].publicKey.export({ type: 'spki', format: 'pem' }), fingerprint = r => hash(keys[r].publicKey.export({ type: 'spki', format: 'der' }));
const rsaPair = generateKeyPairSync('rsa', { modulusLength: 2048 }), rsa = rsaPair.publicKey.export({ format: 'jwk' });
let candidate, callerBytes, attachmentCandidate;
function git(args) {
  if (args[0] === 'rev-parse') return REV;
  if (args[0] === 'status') return '';
  if (args[0] === 'remote') return 'https://github.com/Eben283/amarimethod-website.git';
  if (args[0] === 'ls-remote') return `${REV}\trefs/heads/main`;
  if (args[0] === 'show') return readFileSync(ROOT + args[1].slice(41));
  throw Error('unexpected synthetic Git read');
}
beforeAll(async () => {
  candidate = await inspectGatewayDeploymentCandidate({ git }); attachmentCandidate = await inspectGatewayAttachmentCandidate({ git });
  const result = await build({ absWorkingDir: ROOT, entryPoints: ['follow-up-rehearsal-worker/src/caller.mjs'], bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:crypto', 'cloudflare:workers'], logLevel: 'silent', minify: false, sourcemap: false });
  callerBytes = Buffer.from(result.outputFiles[0].contents); expect(hash(callerBytes)).toBe(candidate.artifact.bundles.find(b => b.role === 'caller').sha256);
});
function fixture() {
  const at = Date.now() - 10, day = 86400000, bundle = role => candidate.artifact.bundles.find(b => b.role === role).sha256;
  const scope = { accountId: id('account'), targetId: id('target'), actionScopeDigest: hash('counter'), environment: 'synthetic', sinkId: id('sink'), registryId: id('registry'), schemaDigest: FOLLOW_UP_REGISTRY_SCHEMA_DIGEST, sourceRevision: PRIOR, actionDigest: ACTION_DIGEST, handlerDigest: bundle('control'), epoch: id('epoch'), generation: 1, issuerReleaseDigest: bundle('issuer'), policyVersion: 'follow-up-retention-policy.v1' };
  const body = { version: VERSION, transport: 'private_service_binding_rpc', scope, origin: { sourceId: id('origin'), sequence: 1, originalAt: at - 1000, approvedAt: at, dispatchUntil: at + 240000 }, aliasSetDigest: hash('aliases'), replayHorizonUntil: at + 10 * day, retentionUntil: at + day - 2000, parentDeadline: at + day, deletionDeadline: null, issuedAt: at, expiresAt: at + 3600000, issuerSequence: 1, principals: ['owner', 'operator', 'reader'].map(role => ({ callerId: id(`caller/${role}`), keyId: id(role), publicKeySha256: fingerprint(role), role, notBefore: at, expiresAt: at + 3600000 })), signers: Object.fromEntries(roles.slice(4).map(r => [r, { keyId: id(r), publicKeySha256: fingerprint(r) }])) };
  const callerConfig = { REHEARSAL_MANIFEST: encode({ body, keyId: id('root'), signature: sign(null, manifestSigningBytes(body), keys.root.privateKey).toString('base64') }), REHEARSAL_CALLER_KEYS: encode({ root: { keyId: id('root'), publicKey: pub('root') }, principals: Object.fromEntries(['owner', 'operator', 'reader'].map(r => [r, pub(r)])) }) };
  const publicConfig = { ...callerConfig, OPERATOR_ACCESS_CONFIG: encode({ version: 'follow-up-operator-access.v1', origin: 'https://rehearsal.amarimethod.com', issuer: 'https://synthetic.cloudflareaccess.com', audience: hash('aud'), manifestDigest: hash(manifestSigningBytes(body)), scopeDigest: hash(canonical(scope)), issuedAt: at, expiresAt: at + 3600000, jwks: [{ kid: 'test', kty: 'RSA', alg: 'RS256', use: 'sig', n: rsa.n, e: rsa.e }], principals: [{ commonName: 'f'.repeat(32) + '.access', callerId: id('caller/operator'), keyId: id('operator'), role: 'operator' }] }) };
  const budget = { aggregateCeilingCents: 1000, remainingCents: 900, deploymentEstimateCents: 100, cleanupReserveCents: 100 };
  const prior = { version: 'follow-up-rehearsal-deployment-approval.v1', releaseId: hash('prior release'), issuedAt: at, expiresAt: at + 300000, reviewedRevision: PRIOR, sourceArtifactDigest: hash('prior reviewed deployment artifact'), accountId: TARGET.accountId, creates: { scripts: ['issuer', 'control', 'caller'].map(r => TARGET[r]), sqliteNamespace: { script: TARGET.control, className: 'FollowUpRehearsalRegistryV1', migrationTag: 'rehearsal-v1' } }, bucket: { name: TARGET.bucket, jurisdiction: 'us', creationDate: '2026-08-28T00:00:00Z', mode: 'existing-dedicated-empty' }, secretDigests: { issuer: hash('issuer secrets'), control: hash('control secrets'), caller: hash(canonical(callerConfig)) }, limits: DEPLOY_LIMITS, budget, acknowledgements: { temporaryPublic404Shell: true, createsThreeScriptsAndOneNamespace: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true } };
  const approval = { version: 'follow-up-rehearsal-gateway-approval.v1', releaseId: hash('gateway release'), issuedAt: at, expiresAt: at + 299000, reviewedRevision: REV, sourceArtifactDigest: candidate.artifactDigest, accountId: TARGET.accountId, creates: { scripts: [GATEWAY_TARGET] }, caller: { versionId: uuid(99), deploymentApproval: prior }, publicConfig, limits: GATEWAY_LIMITS, budget, acknowledgements: { temporaryPublic404Shell: true, createsOneScriptOnly: true, publicConfigurationOnly: true, noHostnameAttachment: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true } };
  const callerMeta = { main_module: 'worker.mjs', compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], cache_options: { enabled: false }, limits: { cpu_ms: 1000, subrequests: 1 }, observability: { enabled: false }, logpush: false, tail_consumers: [], bindings: [{ name: 'REHEARSAL_MANIFEST', type: 'secret_text' }, { name: 'REHEARSAL_CALLER_KEYS', type: 'secret_text' }, { name: 'CONTROL', type: 'service', service: TARGET.control, entrypoint: 'FollowUpRehearsalControl' }], annotations: { 'workers/tag': `rehearsal-${prior.releaseId.slice(0, 16)}-final`, 'workers/message': `git_sha=${PRIOR};artifact_sha256=${prior.sourceArtifactDigest};bundle_sha256=${bundle('caller')};approval_sha256=${deploymentApprovalDigest(prior)}` } };
  const state = { calls: [], writes: [], consumed: 0, tokens: 0, workers: { [TARGET.caller]: { meta: callerMeta, content: callerBytes, versionId: uuid(99), private: true } } }, options = {};
  const json = (result, result_info) => Response.json({ success: true, errors: [], result, ...(result_info ? { result_info } : {}) });
  const list = array => json(array, { total_pages: 1, total_count: array.length });
  const fetch = async (url, init) => {
    const u = new URL(url), path = u.pathname.replace('/client/v4', ''), method = init.method; state.calls.push({ path, method });
    expect(u.origin).toBe('https://api.cloudflare.com'); expect(init.redirect).toBe('error'); expect(init.headers.Authorization).toBe('Bearer synthetic-test-only-token-123');
    if (options.throwRead) throw Error('sensitive provider failure');
    if (path === '/zones') return options.incompleteZones ? json([], { total_pages: 2, total_count: 51 }) : options.tooManyZones ? list(Array.from({ length: 9 }, () => ({ id: ZONE, account: { id: TARGET.accountId } }))) : list([{ id: ZONE, account: { id: TARGET.accountId } }]);
    if (path === `/zones/${ZONE}/workers/routes`) return json(options.route ? [{ script: GATEWAY_TARGET }] : [], options.incompleteRoutes ? { total_pages: 2 } : undefined);
    const base = `/accounts/${TARGET.accountId}`;
    if (path === `${base}/workers/domains`) return list(options.domain ? [{ service: TARGET.caller }] : []);
    const match = path.match(/\/workers\/scripts\/([^/]+)(.*)$/); if (!match) throw Error('unexpected synthetic path');
    const [, name, suffix] = match; expect([GATEWAY_TARGET, TARGET.caller]).toContain(name); let worker = state.workers[name]; const target = name === GATEWAY_TARGET;
    if (method === 'PUT') {
      expect(target).toBe(true); expect(suffix).toBe(''); const form = await new Response(init.body, { headers: { 'Content-Type': init.headers['Content-Type'] } }).formData();
      expect([...form.keys()]).toEqual(['metadata', 'worker.mjs']); const meta = JSON.parse(form.get('metadata')), content = Buffer.from(await form.get('worker.mjs').arrayBuffer());
      worker = { meta, content, versionId: uuid(state.writes.length + 1), private: worker?.private ?? false }; state.workers[name] = worker; state.writes.push({ method, meta, content });
      if (options.lostPut || (options.lostFinal && state.writes.length === 3)) throw Error('sensitive upstream failure'); return json({ id: name });
    }
    if (suffix === '/settings' && !worker) return options.existingGateway ? json({ bindings: [] }) : Response.json({ success: false }, { status: 404 });
    if (!worker) throw Error('synthetic absent caller');
    if (suffix === '/subdomain') { if (method === 'POST') { expect(target).toBe(true); expect(JSON.parse(init.body)).toEqual({ enabled: false, previews_enabled: false }); worker.private = !options.stillPublic; state.writes.push({ method }); if (options.lostDisable) throw Error('unknown disable outcome'); } return json({ enabled: !worker.private, previews_enabled: !worker.private }); }
    if (suffix === '/deployments') return json({ deployments: [{ id: uuid(100), versions: [{ version_id: worker.versionId, percentage: options.splitCaller && !target ? 50 : 100 }] }] });
    if (suffix.startsWith('/versions/')) return json({ id: worker.versionId, annotations: options.badCallerProvenance && !target ? {} : options.badGatewayProvenance && target ? {} : { ...worker.meta.annotations, 'workers/triggered_by': 'upload' } });
    if (suffix === '/content/v2') { const form = new FormData(); form.set('worker.mjs', new Blob([(options.corruptCaller && !target) || (options.corruptGateway && target) ? 'corrupt' : worker.content]), 'worker.mjs'); if (options.extraModule && target) form.set('extra.mjs', new Blob(['extra']), 'extra.mjs'); return new Response(form, { headers: { 'cf-entrypoint': options.wrongEntrypoint ? 'wrong.mjs' : 'worker.mjs' } }); }
    if (suffix === '/settings') { const meta = structuredClone(worker.meta); if (options.extraBinding && target) meta.bindings.push({ name: 'UNAPPROVED', type: 'plain_text', text: 'no' }); if (options.badCallerBinding && !target) meta.bindings[2].service = 'production'; if (options.alteredPublicConfig && target && meta.bindings.length) meta.bindings[0].text += ' '; return json(meta); }
    if (suffix === '/schedules') return json({ schedules: options.schedule ? [{ cron: '* * * * *' }] : [] });
    throw Error('unexpected synthetic operation');
  };
  const args = { execute: true, approval, approvedDigest: gatewayDeploymentApprovalDigest(approval), git, fetch, consumeRelease: async q => { state.consumed++; return { status: 'consumed', releaseId: q.releaseId, approvalDigest: q.approvalDigest }; }, withCloudflareToken: async use => { state.tokens++; return use('synthetic-test-only-token-123'); } };
  return { args, approval, state, options, refresh() { args.approvedDigest = gatewayDeploymentApprovalDigest(approval); } };
}

const APP = uuid(201), POLICY = uuid(202), TOKEN = uuid(203), DOMAIN = 'e'.repeat(32), CERT = uuid(204);
// Synthetic X.509 fixture, built entirely in memory. No OpenSSL/tool install,
// live Access certificate or provider signing material is used.
function certificate() {
  const der = (tag, body) => { const bytes = Buffer.concat(Array.isArray(body) ? body : [body]); const n = bytes.length; const length = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]); return Buffer.concat([Buffer.from([tag]), length, bytes]); };
  const sequence = parts => der(0x30, parts), algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex'), name = Buffer.from('300f310d300b06035504030c0474657374', 'hex');
  const tbs = sequence([Buffer.from('a003020102020101', 'hex'), algorithm, name, sequence([der(0x17, Buffer.from('250101000000Z')), der(0x17, Buffer.from('350101000000Z'))]), name, rsaPair.publicKey.export({ type: 'spki', format: 'der' })]);
  return '-----BEGIN CERTIFICATE-----\n' + sequence([tbs, algorithm, der(3, Buffer.concat([Buffer.from([0]), sign('RSA-SHA256', tbs, rsaPair.privateKey)]))]).toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
}
const api = result => ({ success: true, errors: [], result });
const page = result => ({ ...api(result), result_info: { page: 1, per_page: 100, count: result.length, total_count: result.length, total_pages: result.length ? 1 : 0 } });
async function attachmentFixture() {
  const f = fixture(); expect((await deployGatewayRehearsal(f.args)).status).toBe('deployed-private-not-invoked');
  const oldFetch = f.args.fetch, publicConfig = f.approval.publicConfig, accessConfig = JSON.parse(publicConfig.OPERATOR_ACCESS_CONFIG), at = Date.now() - 1;
  const application = { id: APP, type: 'self_hosted', domain: 'rehearsal.amarimethod.com', aud: accessConfig.audience, session_duration: '1h', destinations: [{ type: 'public', uri: 'rehearsal.amarimethod.com' }], policies: [{ id: POLICY, precedence: 1 }], allow_authenticate_via_warp: false, options_preflight_bypass: false, app_launcher_visible: false, service_auth_401_redirect: true };
  const key = certificate();
  const access = { publicConfig, applicationId: APP, policyIds: [POLICY], serviceTokenIds: [TOKEN], observedAt: at,
    organization: api({ auth_domain: 'synthetic.cloudflareaccess.com' }), application: api(application), applications: page([application]), zoneApplications: page([]),
    policies: page([{ id: POLICY, name: 'synthetic service only', decision: 'non_identity', precedence: 1, include: [{ service_token: { token_id: TOKEN } }], exclude: [], require: [] }]),
    serviceTokens: page([{ id: TOKEN, client_id: accessConfig.principals[0].commonName, enabled: true, expires_at: new Date(accessConfig.expiresAt + 60000).toISOString(), duration: '1h', created_at: new Date(at - 1000).toISOString(), updated_at: new Date(at - 1000).toISOString(), name: 'synthetic service only' }]),
    jwks: { keys: accessConfig.jwks, public_cert: { kid: 'test', cert: key }, public_certs: [{ kid: 'test', cert: key }] } };
  const proof = validateRehearsalAccessReadback(access);
  const approval = { version: 'follow-up-rehearsal-attachment-approval.v1', releaseId: hash('attachment release'), issuedAt: at, expiresAt: f.approval.expiresAt - 1, reviewedRevision: REV, sourceArtifactDigest: attachmentCandidate.artifactDigest, accountId: TARGET.accountId, hostname: 'rehearsal.amarimethod.com', zone: { id: ZONE, name: 'amarimethod.com' }, gateway: { versionId: f.state.workers[GATEWAY_TARGET].versionId, deploymentApproval: f.approval }, access: { applicationId: APP, policyIds: [POLICY], serviceTokenIds: [TOKEN], evidenceDigest: proof.digest }, limits: ATTACH_LIMITS,
    budget: { aggregateCeilingCents: 1000, remainingCents: 800, attachmentEstimateCents: 100, cleanupReserveCents: 100 },
    acknowledgements: { oneDomainAttachment: true, automaticDnsAndCertificate: true, existingAccessOnly: true, noWorkerUpload: true, noInvocation: true, noCleanupOrRollback: true, noAtomicProviderTransaction: true, exclusiveReleaseCustody: true, meteredUsage: true } };
  f.state.calls = []; f.state.writes = []; f.state.consumed = 0; f.state.tokens = 0; const options = {}, calls = []; let attached = null;
  const fetch = async (url, init) => {
    const path = new URL(url).pathname.replace('/client/v4', ''), method = init.method; calls.push({ path, method, headers: init.headers });
    const base = '/accounts/' + TARGET.accountId;
    if (url === accessConfig.issuer + '/cdn-cgi/access/certs') { expect(init.headers).toEqual({ Accept: 'application/json' }); return Response.json(options.badJwks ? { keys: [] } : access.jwks); }
    expect(init.headers.Authorization).toBe('Bearer synthetic-test-only-token-123');
    if (path === base + '/access/organizations') return Response.json(access.organization);
    if (path === base + '/access/apps/' + APP) return Response.json(access.application);
    if (path === base + '/access/apps') return Response.json(options.incompleteApps ? { ...access.applications, result_info: { ...access.applications.result_info, total_pages: 2 } } : access.applications);
    if (path === '/zones/' + ZONE + '/access/apps') return Response.json(access.zoneApplications);
    if (path === base + '/access/apps/' + APP + '/policies') return Response.json(options.bypass ? page([{ ...access.policies.result[0], decision: 'bypass' }]) : access.policies);
    if (path === base + '/access/service_tokens') return Response.json(access.serviceTokens);
    if (path === '/zones') return Response.json(page([{ id: ZONE, name: 'amarimethod.com', account: { id: TARGET.accountId } }]));
    if (path === '/zones/' + ZONE) return Response.json(api({ id: ZONE, name: 'amarimethod.com', account: { id: TARGET.accountId }, status: 'active', type: 'full', paused: false }));
    if (path === '/zones/' + ZONE + '/workers/routes') return Response.json(api(options.route ? [{ script: 'unrelated', pattern: '*.amarimethod.com/*' }] : []));
    if (path === '/zones/' + ZONE + '/dns_records') return Response.json(options.incompleteDns ? { ...page([]), result_info: { total_pages: 2, total_count: 1001 } } : page(options.dns ? [{ name: options.dns, type: options.dnsType || 'CNAME' }] : []));
    if (path === base + '/workers/domains') {
      if (method === 'PUT') {
        expect(JSON.parse(init.body)).toEqual({ hostname: approval.hostname, service: GATEWAY_TARGET, zone_id: ZONE, zone_name: 'amarimethod.com' });
        attached = { id: DOMAIN, hostname: approval.hostname, service: GATEWAY_TARGET, zone_id: ZONE, zone_name: 'amarimethod.com', environment: 'production', cert_id: CERT }; f.state.writes.push({ method, path, body: JSON.parse(init.body) });
        if (options.lostWrite) throw Error('unknown provider outcome with sensitive details');
        return Response.json(api(options.wrongAttach ? { ...attached, service: 'other' } : attached));
      }
      return Response.json(page(attached ? [{ ...attached, ...(options.changedCertificate ? { cert_id: uuid(205) } : {}) }] : options.existingDomain ? [{ id: DOMAIN, hostname: approval.hostname, service: 'other' }] : []));
    }
    if (path === base + '/workers/domains/' + DOMAIN) return Response.json(api(options.wrongReadback ? { ...attached, zone_id: 'f'.repeat(32) } : attached));
    return oldFetch(url, init);
  };
  const args = { execute: true, approval, approvedDigest: gatewayAttachmentApprovalDigest(approval), git, fetch, consumeRelease: async q => { f.state.consumed++; return { status: 'consumed', releaseId: q.releaseId, approvalDigest: q.approvalDigest }; }, withCloudflareToken: async use => { f.state.tokens++; return use('synthetic-test-only-token-123'); } };
  return { args, approval, access, options, state: f.state, calls, gatewayOptions: f.options, refresh() { args.approvedDigest = gatewayAttachmentApprovalDigest(approval); } };
}

describe('guarded first gateway hostname attachment with simulated providers', () => {
  it('pins attachment/helper graph and does not authorize inspection', () => { expect(attachmentCandidate.attachmentAuthorized).toBe(false); expect(attachmentCandidate.artifact.files.map(f => f.path)).toEqual(expect.arrayContaining(['scripts/follow-up-rehearsal-gateway-attach.mjs', 'scripts/lib/follow-up-rehearsal-access-readback.mjs'])); });
  it('requires actual private installation, Access readbacks and one domain PUT; never invokes runtime', async () => {
    const f = await attachmentFixture(), r = await attachGatewayRehearsal(f.args); expect(r).toMatchObject({ status: 'attached-not-invoked', attemptedWrites: 1, consumptionState: 'consumed', runtimeInvoked: false, tlsReadinessProven: false, dnsPropagationProven: false });
    expect(f.state.writes).toHaveLength(1); expect(f.calls.filter(c => c.method !== 'GET')).toHaveLength(1); expect(r.identity).toMatchObject({ id: DOMAIN, certificateId: CERT, hostname: f.approval.hostname }); expect(r.requests).toBeLessThanOrEqual(ATTACH_LIMITS.requests); expect(JSON.stringify(r)).not.toMatch(/sensitive|synthetic-test-only-token|PRIVATE KEY/);
    expect(f.calls.filter(c => c.path === '/cdn-cgi/access/certs')).toHaveLength(3);
  });
  it.each(['incompleteApps', 'bypass', 'badJwks', 'route', 'incompleteDns', 'existingDomain'])('refuses %s before write', async failure => { const f = await attachmentFixture(); f.options[failure] = true; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); expect(f.state.writes).toEqual([]); });
  it.each(['rehearsal.amarimethod.com', '*.amarimethod.com', 'REHEARSAL.amarimethod.com', 'rehearsal.amarimethod.com.'])('refuses conflicting/noncanonical DNS %s', async name => { const f = await attachmentFixture(); f.options.dns = name; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it.each(['lostWrite', 'wrongAttach', 'wrongReadback', 'changedCertificate'])('stops on %s after exactly one write', async failure => { const f = await attachmentFixture(); f.options[failure] = true; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 1, retryAllowed: false }); expect(f.state.writes).toHaveLength(1); });
  it.each(['corruptCaller', 'corruptGateway', 'badCallerProvenance', 'badGatewayProvenance', 'badCallerBinding', 'alteredPublicConfig', 'splitCaller', 'schedule'])('refuses %s installed worker before attachment', async failure => { const f = await attachmentFixture(); f.gatewayOptions[failure] = true; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it('rejects Access drift after initial read before PUT', async () => { const f = await attachmentFixture(), fetcher = f.args.fetch; let reads = 0; f.args.fetch = (url, init) => { if (url.endsWith('/access/organizations') && ++reads === 2) f.options.bypass = true; return fetcher(url, init); }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it('reports Access drift after PUT without changing/rolling back anything', async () => { const f = await attachmentFixture(), fetcher = f.args.fetch; f.args.fetch = (url, init) => { if (f.state.writes.length) f.options.bypass = true; return fetcher(url, init); }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 1 }); });
  it('rejects source drift immediately before PUT', async () => { const f = await attachmentFixture(); let checks = 0; f.args.git = a => a[0] === 'ls-remote' && ++checks > 1 ? PRIOR + '\trefs/heads/main' : git(a); expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it('rechecks Access freshness after a slow synchronous source guard', async () => { const f = await attachmentFixture(); let checks = 0, offset = 0; f.args.clock = () => Date.now() + offset; f.args.git = a => { if (a[0] === 'ls-remote' && ++checks > 1) offset = 30001; return git(a); }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it('bounds an oversized read before any write', async () => { const f = await attachmentFixture(); f.args.fetch = async () => new Response('x'.repeat(ATTACH_LIMITS.responseBytes + 1)); expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', requests: 1, attemptedWrites: 0 }); });
  it('closes an uncertain hung PUT without retry or post-timeout readbacks', async () => {
    const f = await attachmentFixture(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); let began, release, calls = 0, postWriteCalls = 0, writeStarted = false;
    const started = new Promise(r => { began = r; }), held = new Promise(r => { release = r; }), fetcher = f.args.fetch;
    try { f.args.fetch = async (url, init) => { if (init.method === 'PUT') { calls++; writeStarted = true; began(); await held; return Response.json(api({ id: DOMAIN })); } if (writeStarted) postWriteCalls++; return fetcher(url, init); }; const running = attachGatewayRehearsal(f.args);
      await Promise.race([started, running.then(r => { throw Error('PUT never started: ' + JSON.stringify(r)); })]); await vi.advanceTimersByTimeAsync(ATTACH_LIMITS.timeoutMs + 1); expect(await running).toMatchObject({ status: 'reconciliation-required', attemptedWrites: 1, retryAllowed: false }); release(); await Promise.resolve(); await Promise.resolve(); expect(calls).toBe(1); expect(postWriteCalls).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });
  it('requires a fresh exact consumed ACK before credential callback', async () => { const f = await attachmentFixture(); f.args.consumeRelease = async () => { throw Error('unknown'); }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'reconciliation-required', consumptionState: 'unknown', requests: 0 }); expect(f.state.tokens).toBe(0); });
  it('refuses without explicit execute', async () => { const f = await attachmentFixture(); f.args.execute = false; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', requests: 0 }); expect(f.state.consumed).toBe(0); });
  it('never permits prior-attachment reuse as a successful fresh operation', async () => { const f = await attachmentFixture(); expect((await attachGatewayRehearsal(f.args)).status).toBe('attached-not-invoked'); f.args.consumeRelease = async () => ({ status: 'already-consumed' }); expect(await attachGatewayRehearsal(f.args)).toMatchObject({ attemptedWrites: 0, requests: 0, retryAllowed: false }); expect(f.state.writes).toHaveLength(1); });
  it('does not permit late unawaited token callback work', async () => { const f = await attachmentFixture(); let late; f.args.withCloudflareToken = use => { late = use; }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); await expect(late('synthetic-test-only-token-123')).rejects.toThrow(); expect(f.calls).toEqual([]); });
  it('observes a started-unawaited credential callback and blocks later writes', async () => { const f = await attachmentFixture(); let done; const settled = new Promise(r => { done = r; }); f.args.withCloudflareToken = use => { void use('synthetic-test-only-token-123').finally(done).catch(() => {}); }; expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); await settled; expect(f.state.writes).toEqual([]); });
  it('detaches approved inputs before async caller mutation', async () => { const f = await attachmentFixture(), consume = f.args.consumeRelease; f.args.consumeRelease = async q => { f.approval.hostname = 'wrong.example.com'; return consume(q); }; const fetcher = f.args.fetch; f.args.fetch = async (url, init) => { if (init.method === 'PUT') f.approval.hostname = 'rehearsal.amarimethod.com'; return fetcher(url, init); }; expect((await attachGatewayRehearsal(f.args)).status).toBe('attached-not-invoked'); });
  for (const [name, mutate] of [['wrong hostname', a => { a.hostname = 'other.amarimethod.com'; }], ['apex hostname', a => { a.hostname = a.zone.name; }], ['production service override', a => { a.service = 'production'; }], ['unbounded writes', a => { a.limits = { ...a.limits, writes: 2 }; }], ['no DNS acknowledgement', a => { a.acknowledgements.automaticDnsAndCertificate = false; }], ['wrong Access digest', a => { a.access.evidenceDigest = hash('wrong'); }], ['expired approval', a => { a.expiresAt = Date.now() - 1; }]]) it('rejects ' + name, async () => { const f = await attachmentFixture(); mutate(f.approval); f.refresh(); expect(await attachGatewayRehearsal(f.args)).toMatchObject({ status: 'refused', attemptedWrites: 0 }); });
  it('uses the genuine default host attachment adapter after governed tag consumption and exact custody', async () => {
    const f = await attachmentFixture(), hostCandidate = await inspectHostCandidate({ git }), trustedRoot = { keyId: 'host-owner', publicKey: pub('root') }, gets = [], ledgerCalls = [], values = { github: 'synthetic-github-token-at-least-20', cloudflare: 'synthetic-test-only-token-123' }; let tag, ref;
    const policy = { version: 'follow-up-rehearsal-host-approval.v1', mode: 'attach-gateway', releaseId: f.approval.releaseId, issuedAt: f.approval.issuedAt, expiresAt: f.approval.expiresAt, reviewedRevision: REV, hostArtifactDigest: hostCandidate.artifactDigest, ownerKeyId: trustedRoot.keyId,
      custody: { executable: '/synthetic/bws', executableSha256: hash('synthetic binary'), records: Object.fromEntries(['github', 'cloudflare'].map((role, i) => [role, { id: uuid(i + 1), key: HOST_RECORD_KEYS[role], projectId: uuid(10), organizationId: uuid(11), revisionDate: '2026-08-28T00:00:00Z', sha256: hash(values[role]) }])) }, ledger: { repository: 'Eben283/amarimethod-website', refPrefix: 'refs/tags/followup-rehearsal-consumed/', rulesetId: 21768018 }, operation: { approvalDigest: f.args.approvedDigest } };
    const fetcher = async (url, init) => {
      if (!url.startsWith('https://api.github.com/')) { expect(gets).toEqual(['github', 'cloudflare']); expect(ledgerCalls.filter(x => x.method === 'POST')).toHaveLength(2); return f.args.fetch(url, init); }
      const path = new URL(url).pathname.split('/amarimethod-website')[1], method = init.method; ledgerCalls.push({ path, method });
      if (path.startsWith('/rulesets/')) return Response.json({ id: 21768018, source_type: 'Repository', source: 'Eben283/amarimethod-website', target: 'tag', enforcement: 'active', bypass_actors: [], conditions: { ref_name: { include: ['refs/tags/followup-rehearsal-consumed/*'], exclude: [] } }, rules: [{ type: 'update' }, { type: 'deletion' }] });
      if (path === '/git/ref/heads/main') return Response.json({ object: { type: 'commit', sha: REV } });
      if (path === '/git/tags' && method === 'POST') { const b = JSON.parse(init.body); tag = { sha: 'c'.repeat(40), tag: b.tag, message: b.message, object: { sha: b.object, type: b.type } }; return Response.json(tag, { status: 201 }); }
      if (path === '/git/refs' && method === 'POST') { const b = JSON.parse(init.body); ref = { ref: b.ref, object: { sha: b.sha, type: 'tag' } }; return Response.json(ref, { status: 201 }); }
      if (path.startsWith('/git/ref/tags/')) return Response.json(ref ?? {}, { status: ref ? 200 : 404 });
      if (path === '/git/tags/' + 'c'.repeat(40)) return Response.json(tag); throw Error('unexpected synthetic GitHub path');
    };
    const result = await runRehearsalHost({ execute: true, hostApproval: { policy, signature: sign(null, hostApprovalSigningBytes(policy), keys.root.privateKey).toString('base64url') }, trustedRoot, attachmentApproval: f.approval, git, fetch: fetcher, runBws: async ({ record }) => { const role = Object.keys(policy.custody.records).find(r => policy.custody.records[r].id === record.id); gets.push(role); return { ...record, value: values[role] }; } });
    expect(result).toMatchObject({ status: 'attached-not-invoked', consumptionState: 'consumed', githubWrites: 2, deployment: { attemptedWrites: 1, runtimeInvoked: false } }); expect(gets).toEqual(['github', 'cloudflare']);
  });
});
