// Exactly one first Custom Domain attachment. No CLI, Worker uploads, Access
// changes, secret creation, invocation, retry, cleanup or rollback. Import inert.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { GATEWAY_TARGET, inspectGatewayDeploymentCandidate, validateGatewayDeploymentApproval, gatewayDeploymentApprovalDigest } from './follow-up-rehearsal-gateway-deploy.mjs';
import { DEPLOY_TARGETS, deploymentApprovalDigest } from './follow-up-rehearsal-deploy.mjs';
import { validateOperatorAccessConfig } from '../follow-up-rehearsal-worker/src/operator-access.mjs';
import { validateRehearsalAccessReadback } from './lib/follow-up-rehearsal-access-readback.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url))), REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const SELF = 'scripts/follow-up-rehearsal-gateway-attach.mjs', HELPER = 'scripts/lib/follow-up-rehearsal-access-readback.mjs';
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, ID = /^[a-f0-9]{32}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const need = x => { if (!x) throw Error('rehearsal_attachment_refused'); };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const hash = v => createHash('sha256').update(v).digest('hex'), equal = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort()));
const detached = v => { const text = JSON.stringify(v); need(typeof text === 'string' && Buffer.byteLength(text) <= 131072); return JSON.parse(text); };
const gitDefault = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', timeout: 15000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1' } });
export const ATTACH_LIMITS = Object.freeze({ requests: 128, writes: 1, responseBytes: 1048576, totalBytes: 16777216, timeoutMs: 15000, operationMs: 300000, zones: 8, dnsRecords: 1000 });
export async function inspectGatewayAttachmentCandidate({ git = gitDefault } = {}) {
  const base = await inspectGatewayDeploymentCandidate({ git }), files = new Map(base.artifact.files.map(f => [f.path, f]));
  const pin = path => { need(!path.startsWith('/') && !path.split('/').includes('..') && realpathSync(resolve(ROOT, path)) === resolve(ROOT, path)); const bytes = readFileSync(resolve(ROOT, path)), sha256 = hash(bytes); if (files.has(path)) need(files.get(path).sha256 === sha256); files.set(path, { path, bytes: bytes.length, sha256 }); return bytes; };
  pin(HELPER);
  const built = await build({ absWorkingDir: ROOT, entryPoints: [SELF], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent', plugins: [{ name: 'pin-attachment-inputs', setup(api) { api.onLoad({ filter: /./ }, args => { const path = relative(ROOT, args.path); need(/^(scripts\/|follow-up-rehearsal-worker\/src\/)/.test(path)); return { contents: pin(path), loader: 'js', resolveDir: dirname(args.path) }; }); } }] });
  need(built.warnings.length === 0); for (const output of Object.values(built.metafile.outputs)) need(output.imports.every(i => i.external && (i.path.startsWith('node:') || i.path === 'esbuild')));
  for (const f of files.values()) need(hash(readFileSync(resolve(ROOT, f.path))) === f.sha256);
  const artifact = { version: 'follow-up-rehearsal-attachment-source.v1', revision: base.artifact.revision, gatewayArtifactDigest: base.artifactDigest, deploymentArtifactDigest: base.artifact.deploymentArtifactDigest, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), bundles: base.artifact.bundles, tools: base.artifact.tools, limits: ATTACH_LIMITS };
  return { artifact, artifactDigest: hash(canonical(artifact)), dirty: base.dirty, attachmentAuthorized: false };
}
export function gatewayAttachmentApprovalDigest(a) { return hash(canonical(a)); }
export function validateGatewayAttachmentApproval(a, approvedDigest, now = Date.now()) {
  exact(a, ['version', 'releaseId', 'issuedAt', 'expiresAt', 'reviewedRevision', 'sourceArtifactDigest', 'accountId', 'hostname', 'zone', 'gateway', 'access', 'limits', 'budget', 'acknowledgements']);
  need(a.version === 'follow-up-rehearsal-attachment-approval.v1' && HEX.test(a.releaseId) && SHA.test(a.reviewedRevision) && HEX.test(a.sourceArtifactDigest) && a.accountId === DEPLOY_TARGETS.accountId && HEX.test(approvedDigest) && gatewayAttachmentApprovalDigest(a) === approvedDigest);
  need(Number.isSafeInteger(a.issuedAt) && Number.isSafeInteger(a.expiresAt) && a.issuedAt <= now && now < a.expiresAt && a.expiresAt - a.issuedAt <= 3600000);
  exact(a.zone, ['id', 'name']); need(ID.test(a.zone.id) && typeof a.zone.name === 'string' && a.zone.name.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(a.zone.name));
  exact(a.gateway, ['versionId', 'deploymentApproval']); need(UUID.test(a.gateway.versionId)); const prior = a.gateway.deploymentApproval;
  validateGatewayDeploymentApproval(prior, gatewayDeploymentApprovalDigest(prior), now);
  const config = validateOperatorAccessConfig(prior.publicConfig); need(a.hostname === new URL(config.origin).hostname && a.hostname.endsWith('.' + a.zone.name) && a.expiresAt <= prior.expiresAt && ![prior.releaseId, prior.caller.deploymentApproval.releaseId].includes(a.releaseId));
  exact(a.access, ['applicationId', 'policyIds', 'serviceTokenIds', 'evidenceDigest']); need(UUID.test(a.access.applicationId) && HEX.test(a.access.evidenceDigest));
  for (const list of [a.access.policyIds, a.access.serviceTokenIds]) need(Array.isArray(list) && list.length >= 1 && list.length <= 3 && list.every(x => UUID.test(x)) && new Set(list).size === list.length);
  need(equal(a.limits, ATTACH_LIMITS)); exact(a.budget, ['aggregateCeilingCents', 'remainingCents', 'attachmentEstimateCents', 'cleanupReserveCents']);
  need(Object.values(a.budget).every(v => Number.isSafeInteger(v) && v > 0) && a.budget.aggregateCeilingCents <= 1000 && a.budget.remainingCents <= a.budget.aggregateCeilingCents && a.budget.attachmentEstimateCents + a.budget.cleanupReserveCents <= a.budget.remainingCents);
  need(equal(a.acknowledgements, { oneDomainAttachment: true, automaticDnsAndCertificate: true, existingAccessOnly: true, noWorkerUpload: true, noInvocation: true, noCleanupOrRollback: true, noAtomicProviderTransaction: true, exclusiveReleaseCustody: true, meteredUsage: true }));
  return a;
}
function sourceGuard(candidate, a, git) {
  const text = args => Buffer.from(git(args)).toString().trim(); need(!process.env.ESBUILD_BINARY_PATH && candidate.artifact.tools.node === process.version);
  for (const f of candidate.artifact.tools.files) need(realpathSync(resolve(ROOT, f.path)) === resolve(ROOT, f.path) && hash(readFileSync(resolve(ROOT, f.path))) === f.sha256);
  need(!text(['status', '--porcelain=v1', '--untracked-files=all']) && text(['remote', 'get-url', 'origin']) === REMOTE && text(['rev-parse', 'HEAD']) === a.reviewedRevision && text(['rev-parse', 'origin/main']) === a.reviewedRevision);
  for (const f of candidate.artifact.files) need(realpathSync(resolve(ROOT, f.path)) === resolve(ROOT, f.path) && hash(readFileSync(resolve(ROOT, f.path))) === f.sha256 && hash(Buffer.from(git(['show', `${a.reviewedRevision}:${f.path}`]))) === f.sha256);
  need(text(['ls-remote', '--exit-code', REMOTE, 'refs/heads/main']) === `${a.reviewedRevision}\trefs/heads/main` && text(['rev-parse', 'HEAD']) === a.reviewedRevision && !text(['status', '--porcelain=v1', '--untracked-files=all']));
}
const hostMatch = (pattern, hostname) => {
  need(typeof pattern === 'string' && pattern.length <= 1024); const host = pattern.replace(/^https?:\/\//, '').split('/')[0];
  need(/^[a-z0-9.*-]+$/.test(host)); return new RegExp('^' + host.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$').test(hostname);
};

export async function attachGatewayRehearsal({ execute, approval, approvedDigest, consumeRelease, withCloudflareToken, git = gitDefault, fetch: fetcher = globalThis.fetch, clock = Date.now } = {}) {
  let stage = 'approval', consumptionState = 'not-attempted', attemptedWrites = 0, requests = 0, totalBytes = 0, closed = false, identity = null;
  const report = status => ({ status, stage, consumptionState, attemptedWrites, requests, totalBytes, identity, retryAllowed: false, cleanupAllowed: false, runtimeInvoked: false, tlsReadinessProven: false, dnsPropagationProven: false });
  try {
    need(execute === true && typeof consumeRelease === 'function' && typeof withCloudflareToken === 'function'); const a = detached(approval); validateGatewayAttachmentApproval(a, approvedDigest, clock());
    const deadline = Math.min(a.expiresAt, clock() + ATTACH_LIMITS.operationMs), fresh = () => need(!closed && clock() < deadline);
    const bounded = async (fn, ms = deadline - clock(), abort = () => {}) => { fresh(); let timer; try { return await Promise.race([Promise.resolve().then(() => { fresh(); return fn(); }), new Promise((_, reject) => { timer = setTimeout(() => { closed = true; abort(); reject(Error('rehearsal_attachment_timeout')); }, Math.max(1, Math.min(ms, deadline - clock()))); })]); } finally { clearTimeout(timer); } };
    const observed = fn => (...args) => { const p = Promise.resolve().then(() => fn(...args)); void p.catch(() => {}); return p; };
    stage = 'source-preflight'; const candidate = await bounded(() => inspectGatewayAttachmentCandidate({ git })); fresh(); need(candidate.artifactDigest === a.sourceArtifactDigest && candidate.artifact.revision === a.reviewedRevision); sourceGuard(candidate, a, git); fresh();
    const prior = a.gateway.deploymentApproval, callerApproval = prior.caller.deploymentApproval, config = validateOperatorAccessConfig(prior.publicConfig), bundle = role => candidate.artifact.bundles.find(b => b.role === role).sha256;
    need(config.callerConfig.m.scope.handlerDigest === bundle('control') && config.callerConfig.m.scope.issuerReleaseDigest === bundle('issuer'));
    stage = 'consume-release'; consumptionState = 'unknown'; const receipt = await bounded(() => consumeRelease({ releaseId: a.releaseId, approvalDigest: approvedDigest, expiresAt: a.expiresAt })); fresh(); need(equal(receipt, { status: 'consumed', releaseId: a.releaseId, approvalDigest: approvedDigest })); consumptionState = 'consumed';
    let tokenUsed = false, tokenCompleted = false;
    await bounded(() => withCloudflareToken(observed(async token => {
      fresh(); need(!tokenUsed && typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token)); tokenUsed = true;
      const account = `/accounts/${a.accountId}`, path = name => `${account}/workers/scripts/${name}`; let accessFreshnessUntil = 0;
      const call = async (resource, { method = 'GET', body, raw = false, certs = false } = {}) => {
        fresh(); need(++requests <= ATTACH_LIMITS.requests);
        need(certs ? resource === `${config.policy.issuer}/cdn-cgi/access/certs` && method === 'GET' : resource.startsWith(account + '/') || /^\/zones(?:\?|\/[a-f0-9]{32}(?:\/|$))/.test(resource));
        if (method !== 'GET') { need(method === 'PUT' && resource === `${account}/workers/domains` && attemptedWrites === 0); sourceGuard(candidate, a, git); fresh(); config.fresh(); need(clock() < accessFreshnessUntil); attemptedWrites++; }
        totalBytes += body?.byteLength ?? 0; need(totalBytes <= ATTACH_LIMITS.totalBytes); const controller = new AbortController();
        return bounded(async () => {
          const r = await fetcher(certs ? resource : `https://api.cloudflare.com/client/v4${resource}`, { method, body, redirect: 'error', signal: controller.signal, headers: certs ? { Accept: 'application/json' } : { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }); fresh(); need(r.ok && r.body && !r.redirected && !r.headers.get('link'));
          const reader = r.body.getReader(), chunks = []; let bytes = 0;
          try { while (true) { const item = await reader.read(); fresh(); if (item.done) break; bytes += item.value.byteLength; totalBytes += item.value.byteLength; need(bytes <= ATTACH_LIMITS.responseBytes && totalBytes <= ATTACH_LIMITS.totalBytes); chunks.push(Buffer.from(item.value)); } } finally { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
          const content = Buffer.concat(chunks); if (raw) return { content, contentType: r.headers.get('content-type'), entrypoint: r.headers.get('cf-entrypoint') };
          const v = JSON.parse(content.toString('utf8')); need(certs || v.success === true && (!v.errors || v.errors.length === 0)); return v;
        }, ATTACH_LIMITS.timeoutMs, () => controller.abort());
      };
      const list = (v, max) => { need(Array.isArray(v.result) && v.result.length <= max && v.result_info && [0, 1].includes(v.result_info.total_pages) && v.result_info.total_count === v.result.length && !v.result_info.cursor && !v.result_info.cursors?.after); return v.result; };
      const active = async name => { const d = (await call(`${path(name)}/deployments`)).result.deployments; need(Array.isArray(d) && d.length >= 1 && d.length <= 100 && UUID.test(d[0].id) && d[0].versions?.length === 1 && d[0].versions[0].percentage === 100 && UUID.test(d[0].versions[0].version_id)); return d[0].versions[0].version_id; };
      const worker = async (name, versionId, role, release, artifactDigest, approvalDigest, bindings) => {
        need(await active(name) === versionId); const v = (await call(`${path(name)}/versions/${versionId}`)).result;
        need(v.id === versionId && v.annotations?.['workers/tag'] === `rehearsal-${release.releaseId.slice(0, 16)}-final` && v.annotations?.['workers/message'] === `git_sha=${release.reviewedRevision};artifact_sha256=${artifactDigest};bundle_sha256=${bundle(role)};approval_sha256=${approvalDigest}`);
        const raw = await call(`${path(name)}/content/v2`, { raw: true }); need(raw.entrypoint === 'worker.mjs' && raw.contentType?.startsWith('multipart/form-data;')); const form = await new Response(raw.content, { headers: { 'Content-Type': raw.contentType } }).formData();
        need([...form.keys()].length === 1 && form.get('worker.mjs') instanceof Blob && hash(Buffer.from(await form.get('worker.mjs').arrayBuffer())) === bundle(role));
        const s = (await call(`${path(name)}/settings`)).result, sort = xs => [...xs].sort((a, b) => a.name.localeCompare(b.name));
        need(s.compatibility_date === '2026-08-27' && equal(s.compatibility_flags, ['nodejs_compat']) && equal(s.limits, { cpu_ms: 1000, subrequests: 1 }) && s.cache_options?.enabled === false && s.observability?.enabled === false && s.logpush === false && equal(s.tail_consumers, []) && Array.isArray(s.bindings) && equal(sort(s.bindings), sort(bindings)));
        const sub = (await call(`${path(name)}/subdomain`)).result; need(sub.enabled === false && sub.previews_enabled === false);
        const schedules = (await call(`${path(name)}/schedules`)).result; need(Array.isArray(schedules.schedules) && schedules.schedules.length === 0); need(await active(name) === versionId);
      };
      const workers = async () => {
        await worker(TARGET_CALLER, prior.caller.versionId, 'caller', callerApproval, callerApproval.sourceArtifactDigest, deploymentApprovalDigest(callerApproval), [{ name: 'REHEARSAL_MANIFEST', type: 'secret_text' }, { name: 'REHEARSAL_CALLER_KEYS', type: 'secret_text' }, { name: 'CONTROL', type: 'service', service: DEPLOY_TARGETS.control, entrypoint: 'FollowUpRehearsalControl' }]);
        await worker(GATEWAY_TARGET, a.gateway.versionId, 'gateway', prior, prior.sourceArtifactDigest, gatewayDeploymentApprovalDigest(prior), [...Object.entries(prior.publicConfig).map(([name, text]) => ({ name, type: 'plain_text', text })), { name: 'CALLER', type: 'service', service: TARGET_CALLER, entrypoint: 'FollowUpRehearsalCaller' }]);
      };
      const TARGET_CALLER = DEPLOY_TARGETS.caller;
      const domainEqual = d => ID.test(d.id) && d.hostname === a.hostname && d.service === GATEWAY_TARGET && d.zone_id === a.zone.id && d.zone_name === a.zone.name && d.environment === 'production' && UUID.test(d.cert_id);
      const inventory = async attached => {
        const zones = list(await call(`/zones?account.id=${a.accountId}&per_page=50&page=1`), ATTACH_LIMITS.zones); need(zones.some(z => z.id === a.zone.id && z.name === a.zone.name));
        for (const zone of zones) { need(ID.test(zone.id) && zone.account?.id === a.accountId); const routes = await call(`/zones/${zone.id}/workers/routes`); need(Array.isArray(routes.result) && routes.result.length <= 1000 && !routes.result_info?.cursor && !routes.result_info?.cursors?.after && (!routes.result_info?.total_pages || routes.result_info.total_pages <= 1)); need(!routes.result.some(r => [GATEWAY_TARGET, TARGET_CALLER].includes(r.script) || hostMatch(r.pattern, a.hostname))); }
        const z = (await call(`/zones/${a.zone.id}`)).result; need(z.id === a.zone.id && z.name === a.zone.name && z.account?.id === a.accountId && z.status === 'active' && z.type === 'full' && z.paused === false);
        const domains = list(await call(`${account}/workers/domains?per_page=100&page=1`), 100), matching = domains.filter(d => d.hostname === a.hostname || [GATEWAY_TARGET, TARGET_CALLER].includes(d.service));
        need(attached ? matching.length === 1 && domainEqual(matching[0]) && matching[0].id === identity.id && matching[0].cert_id === identity.certificateId : matching.length === 0);
        if (!attached) { const records = list(await call(`/zones/${a.zone.id}/dns_records?per_page=1000&page=1`), ATTACH_LIMITS.dnsRecords); need(!records.some(r => { need(typeof r.name === 'string' && typeof r.type === 'string' && r.name === r.name.toLowerCase() && !r.name.endsWith('.') && r.type === r.type.toUpperCase()); return r.name === a.hostname || r.name.startsWith('*.') && a.hostname.endsWith(r.name.slice(1)) || r.type === 'NS' && r.name !== a.zone.name && a.hostname.endsWith('.' + r.name); })); }
      };
      const access = async () => {
        const observedAt = clock(), organization = await call(`${account}/access/organizations`), application = await call(`${account}/access/apps/${a.access.applicationId}`), applications = await call(`${account}/access/apps?per_page=100&page=1`), zoneApplications = await call(`/zones/${a.zone.id}/access/apps?per_page=100&page=1`), policies = await call(`${account}/access/apps/${a.access.applicationId}/policies?per_page=100&page=1`), serviceTokens = await call(`${account}/access/service_tokens?per_page=100&page=1`), jwks = await call(`${config.policy.issuer}/cdn-cgi/access/certs`, { certs: true });
        const proof = validateRehearsalAccessReadback({ publicConfig: prior.publicConfig, applicationId: a.access.applicationId, policyIds: a.access.policyIds, serviceTokenIds: a.access.serviceTokenIds, organization, application, applications, zoneApplications, policies, serviceTokens, jwks, observedAt }, clock());
        need(proof.digest === a.access.evidenceDigest && a.expiresAt <= proof.expiresAt && clock() < proof.freshnessUntil); accessFreshnessUntil = proof.freshnessUntil; return proof;
      };
      stage = 'resource-preflight'; await inventory(false); await workers(); await access();
      stage = 'attachment-preflight'; await inventory(false); await workers(); await access(); fresh();
      // Provider does not offer an atomic Access+domain transaction/CAS. The
      // signed exclusive-custody prerequisite remains an external trust boundary.
      stage = 'domain-attach'; const response = await call(`${account}/workers/domains`, { method: 'PUT', body: Buffer.from(JSON.stringify({ hostname: a.hostname, service: GATEWAY_TARGET, zone_id: a.zone.id, zone_name: a.zone.name })) });
      need(domainEqual(response.result)); identity = { id: response.result.id, hostname: a.hostname, zoneId: a.zone.id, service: GATEWAY_TARGET, environment: 'production', certificateId: response.result.cert_id };
      stage = 'attachment-readback'; const read = (await call(`${account}/workers/domains/${identity.id}`)).result; need(domainEqual(read) && read.id === identity.id && read.cert_id === identity.certificateId);
      await inventory(true); await workers(); await access(); fresh(); config.fresh(); tokenCompleted = true;
    })));
    need(tokenUsed && tokenCompleted); stage = 'complete'; closed = true; return report('attached-not-invoked');
  } catch { closed = true; return report(attemptedWrites || consumptionState === 'unknown' ? 'reconciliation-required' : 'refused'); }
}
