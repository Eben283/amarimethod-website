// Private first-install only. No CLI, hostname attachment, Access setup, secret
// discovery, invocation, automatic retry, cleanup or rollback. Import is inert.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DEPLOY_TARGETS, SHELL_SOURCE, inspectDeploymentCandidate, validateDeploymentApproval, deploymentApprovalDigest } from './follow-up-rehearsal-deploy.mjs';
import { validateOperatorAccessConfig } from '../follow-up-rehearsal-worker/src/operator-access.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const SELF = 'scripts/follow-up-rehearsal-gateway-deploy.mjs', PREFIX = 'follow-up-rehearsal-worker';
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const need = x => { if (!x) throw new Error('rehearsal_gateway_refused'); };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const hash = x => createHash('sha256').update(x).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort()));
const detached = v => { const text = JSON.stringify(v); need(typeof text === 'string' && Buffer.byteLength(text) <= 131072); return JSON.parse(text); };
export const GATEWAY_TARGET = 'amari-followup-operator-rehearsal';
export const GATEWAY_LIMITS = Object.freeze({ requests: 96, writes: 3, responseBytes: 1048576, totalBytes: 12582912, uploadBytes: 1048576, timeoutMs: 15000, operationMs: 300000, zones: 8 });
const gitDefault = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', timeout: 15000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1' } });
function tools() {
  need(!process.env.ESBUILD_BINARY_PATH && ['darwin', 'linux'].includes(process.platform));
  return ['node_modules/esbuild/lib/main.js', 'node_modules/esbuild/package.json', `node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`, `node_modules/@esbuild/${process.platform}-${process.arch}/package.json`].map(path => {
    need(realpathSync(resolve(ROOT, path)) === resolve(ROOT, path)); return { path, sha256: hash(readFileSync(resolve(ROOT, path))) };
  });
}
async function snapshot(git = gitDefault) {
  const toolFiles = tools(), base = await inspectDeploymentCandidate({ git }), files = new Map(base.artifact.files.map(f => [f.path, f]));
  const pin = path => {
    need(!path.startsWith('/') && !path.split('/').includes('..') && realpathSync(resolve(ROOT, path)) === resolve(ROOT, path));
    const bytes = readFileSync(resolve(ROOT, path)), sha256 = hash(bytes); if (files.has(path)) need(files.get(path).sha256 === sha256);
    files.set(path, { path, bytes: bytes.length, sha256 }); return bytes;
  };
  pin(SELF);
  const text = pin(`${PREFIX}/wrangler.operator.jsonc`).toString('utf8'), config = JSON.parse(text);
  need(text === JSON.stringify(config, null, 2) + '\n' && equal(config, {
    name: GATEWAY_TARGET, main: 'src/operator-ingress.mjs', account_id: DEPLOY_TARGETS.accountId, compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], workers_dev: false, preview_urls: false,
    routes: [], observability: { enabled: false }, send_metrics: false, keep_vars: false, limits: { cpu_ms: 1000, subrequests: 1 }, services: [{ binding: 'CALLER', service: DEPLOY_TARGETS.caller, entrypoint: 'FollowUpRehearsalCaller' }],
  }));
  const built = await build({ absWorkingDir: ROOT, entryPoints: [`${PREFIX}/src/operator-ingress.mjs`], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:crypto', 'cloudflare:workers'], logLevel: 'silent', minify: false, sourcemap: false,
    plugins: [{ name: 'pin-gateway-inputs', setup(api) { api.onLoad({ filter: /./ }, args => { const path = relative(ROOT, args.path); need(path.startsWith(`${PREFIX}/src/`) || /^scripts\/lib\/[a-z0-9-]+\.mjs$/.test(path)); return { contents: pin(path), loader: 'js', resolveDir: dirname(args.path) }; }); } }] });
  need(built.outputFiles.length === 1 && built.warnings.length === 0);
  for (const output of Object.values(built.metafile.outputs)) need(output.imports.every(i => i.external && ['node:crypto', 'cloudflare:workers'].includes(i.path)));
  const bytes = Buffer.from(built.outputFiles[0].contents); need(bytes.length <= GATEWAY_LIMITS.uploadBytes);
  for (const f of files.values()) need(hash(readFileSync(resolve(ROOT, f.path))) === f.sha256); need(equal(toolFiles, tools()));
  const artifact = { version: 'follow-up-rehearsal-gateway-source.v1', revision: base.artifact.revision, deploymentArtifactDigest: base.artifactDigest,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), tools: { ...base.artifact.tools, node: process.version, files: toolFiles },
    bundles: [...base.artifact.bundles, { role: 'gateway', sha256: hash(bytes), bytes: bytes.length, inputs: Object.keys(built.metafile.inputs).sort() }], shellSha256: hash(SHELL_SOURCE), limits: GATEWAY_LIMITS };
  return { artifact, artifactDigest: hash(canonical(artifact)), dirty: base.dirty, bytes };
}
export async function inspectGatewayDeploymentCandidate({ git } = {}) { const { bytes, ...candidate } = await snapshot(git); return { ...candidate, deploymentAuthorized: false }; }
export function gatewayDeploymentApprovalDigest(a) { return hash(canonical(a)); }
export function validateGatewayDeploymentApproval(a, approvedDigest, now = Date.now()) {
  exact(a, ['version', 'releaseId', 'issuedAt', 'expiresAt', 'reviewedRevision', 'sourceArtifactDigest', 'accountId', 'creates', 'caller', 'publicConfig', 'limits', 'budget', 'acknowledgements']);
  need(a.version === 'follow-up-rehearsal-gateway-approval.v1' && HEX.test(a.releaseId) && SHA.test(a.reviewedRevision) && HEX.test(a.sourceArtifactDigest) && HEX.test(approvedDigest) && gatewayDeploymentApprovalDigest(a) === approvedDigest && a.accountId === DEPLOY_TARGETS.accountId);
  need(Number.isSafeInteger(a.issuedAt) && Number.isSafeInteger(a.expiresAt) && a.issuedAt <= now && now < a.expiresAt && a.expiresAt - a.issuedAt <= 3600000);
  need(equal(a.creates, { scripts: [GATEWAY_TARGET] }) && equal(a.limits, GATEWAY_LIMITS));
  exact(a.caller, ['versionId', 'deploymentApproval']); need(UUID.test(a.caller.versionId));
  const prior = a.caller.deploymentApproval; validateDeploymentApproval(prior, deploymentApprovalDigest(prior), now); need(prior.releaseId !== a.releaseId && a.expiresAt <= prior.expiresAt);
  exact(a.publicConfig, ['REHEARSAL_MANIFEST', 'REHEARSAL_CALLER_KEYS', 'OPERATOR_ACCESS_CONFIG']);
  for (const value of Object.values(a.publicConfig)) need(typeof value === 'string' && Buffer.byteLength(value) <= 16384 && value === canonical(JSON.parse(value)) && !value.includes('PRIVATE KEY'));
  const config = validateOperatorAccessConfig(a.publicConfig); need(a.expiresAt <= config.policy.expiresAt && config.callerConfig.m.scope.sourceRevision === prior.reviewedRevision);
  need(hash(canonical({ REHEARSAL_MANIFEST: a.publicConfig.REHEARSAL_MANIFEST, REHEARSAL_CALLER_KEYS: a.publicConfig.REHEARSAL_CALLER_KEYS })) === prior.secretDigests.caller);
  exact(a.budget, ['aggregateCeilingCents', 'remainingCents', 'deploymentEstimateCents', 'cleanupReserveCents']);
  need(Object.values(a.budget).every(v => Number.isSafeInteger(v) && v > 0) && a.budget.aggregateCeilingCents <= 1000 && a.budget.remainingCents <= a.budget.aggregateCeilingCents && a.budget.deploymentEstimateCents + a.budget.cleanupReserveCents <= a.budget.remainingCents);
  need(equal(a.acknowledgements, { temporaryPublic404Shell: true, createsOneScriptOnly: true, publicConfigurationOnly: true, noHostnameAttachment: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true }));
  return a;
}
function sourceGuard(candidate, a, git) {
  const text = args => Buffer.from(git(args)).toString().trim();
  need(equal(candidate.artifact.tools.files, tools()) && candidate.artifact.tools.node === process.version);
  need(!text(['status', '--porcelain=v1', '--untracked-files=all']) && text(['remote', 'get-url', 'origin']) === REMOTE);
  need(text(['rev-parse', 'HEAD']) === a.reviewedRevision && text(['rev-parse', 'origin/main']) === a.reviewedRevision);
  for (const f of candidate.artifact.files) need(realpathSync(resolve(ROOT, f.path)) === resolve(ROOT, f.path) && hash(readFileSync(resolve(ROOT, f.path))) === f.sha256 && hash(Buffer.from(git(['show', `${a.reviewedRevision}:${f.path}`]))) === f.sha256);
  need(text(['ls-remote', '--exit-code', REMOTE, 'refs/heads/main']) === `${a.reviewedRevision}\trefs/heads/main`);
  need(text(['rev-parse', 'HEAD']) === a.reviewedRevision && !text(['status', '--porcelain=v1', '--untracked-files=all']));
}
function metadata(a, candidate, shell) {
  const bytes = shell ? Buffer.from(SHELL_SOURCE) : candidate.bytes;
  return { main_module: 'worker.mjs', compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], cache_options: { enabled: false }, limits: { cpu_ms: 1000, subrequests: 1 }, observability: { enabled: false }, logpush: false, tail_consumers: [],
    bindings: shell ? [] : [...Object.entries(a.publicConfig).map(([name, text]) => ({ name, type: 'plain_text', text })), { name: 'CALLER', type: 'service', service: DEPLOY_TARGETS.caller, entrypoint: 'FollowUpRehearsalCaller' }],
    annotations: { 'workers/tag': `rehearsal-${a.releaseId.slice(0, 16)}-${shell ? 'shell' : 'final'}`, 'workers/message': `git_sha=${a.reviewedRevision};artifact_sha256=${candidate.artifactDigest};bundle_sha256=${hash(bytes)};approval_sha256=${gatewayDeploymentApprovalDigest(a)}` } };
}
function multipart(meta, bytes) {
  const boundary = `amari-${hash(bytes).slice(0, 32)}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  need(body.length <= GATEWAY_LIMITS.uploadBytes); return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// consumeRelease must be durable external authority (the genuine host uses its
// governed GitHub tag). No injected test receipt establishes live authorization.
export async function deployGatewayRehearsal({ execute, approval, approvedDigest, consumeRelease, withCloudflareToken, git = gitDefault, fetch: fetcher = globalThis.fetch, clock = Date.now } = {}) {
  let stage = 'approval', consumptionState = 'not-attempted', attemptedWrites = 0, requests = 0, totalBytes = 0, closed = false, candidate, identity = null;
  const report = status => ({ status, stage, consumptionState, attemptedWrites, requests, totalBytes, identity, retryAllowed: false, cleanupAllowed: false, runtimeInvoked: false, hostnameAttached: false });
  try {
    need(execute === true && typeof consumeRelease === 'function' && typeof withCloudflareToken === 'function');
    const a = detached(approval); validateGatewayDeploymentApproval(a, approvedDigest, clock()); const deadline = Math.min(a.expiresAt, clock() + GATEWAY_LIMITS.operationMs);
    const fresh = () => need(!closed && clock() < deadline);
    const bounded = async (fn, ms = deadline - clock(), abort = () => {}) => { fresh(); let timer; try { return await Promise.race([Promise.resolve().then(() => { fresh(); return fn(); }), new Promise((_, reject) => { timer = setTimeout(() => { closed = true; abort(); reject(new Error('rehearsal_gateway_timeout')); }, Math.max(1, Math.min(ms, deadline - clock()))); })]); } finally { clearTimeout(timer); } };
    const observed = fn => (...args) => { const promise = Promise.resolve().then(() => fn(...args)); void promise.catch(() => {}); return promise; };
    stage = 'source-preflight'; candidate = await bounded(() => snapshot(git)); fresh(); need(candidate.artifactDigest === a.sourceArtifactDigest && candidate.artifact.revision === a.reviewedRevision); sourceGuard(candidate, a, git); fresh();
    const bundle = role => candidate.artifact.bundles.find(v => v.role === role).sha256, publicConfig = validateOperatorAccessConfig(a.publicConfig);
    need(publicConfig.callerConfig.m.scope.handlerDigest === bundle('control') && publicConfig.callerConfig.m.scope.issuerReleaseDigest === bundle('issuer'));
    stage = 'consume-release'; consumptionState = 'unknown'; const receipt = await bounded(() => consumeRelease({ releaseId: a.releaseId, approvalDigest: approvedDigest, expiresAt: a.expiresAt })); fresh();
    need(equal(receipt, { status: 'consumed', releaseId: a.releaseId, approvalDigest: approvedDigest })); consumptionState = 'consumed';
    let tokenUsed = false, tokenCompleted = false;
    await bounded(() => withCloudflareToken(observed(async token => {
      fresh(); need(!tokenUsed && typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token)); tokenUsed = true;
      const account = `/accounts/${a.accountId}`, path = name => `${account}/workers/scripts/${name}`;
      const call = async (url, { method = 'GET', body, contentType, missing = false, raw = false } = {}) => {
        fresh(); need(++requests <= GATEWAY_LIMITS.requests && (url.startsWith(account + '/') || /^\/zones(?:\?|\/[a-f0-9]{32}\/workers\/routes$)/.test(url)));
        if (method !== 'GET') { sourceGuard(candidate, a, git); fresh(); publicConfig.fresh(); need(++attemptedWrites <= GATEWAY_LIMITS.writes); }
        totalBytes += body?.byteLength ?? 0; need(totalBytes <= GATEWAY_LIMITS.totalBytes); const controller = new AbortController();
        return bounded(async () => {
          const r = await fetcher(`https://api.cloudflare.com/client/v4${url}`, { method, body, redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) } }); fresh(); need(r.body && !r.redirected && !r.headers.get('link'));
          const reader = r.body.getReader(), parts = []; let bytes = 0;
          try { while (true) { const part = await reader.read(); fresh(); if (part.done) break; bytes += part.value.byteLength; totalBytes += part.value.byteLength; need(bytes <= GATEWAY_LIMITS.responseBytes && totalBytes <= GATEWAY_LIMITS.totalBytes); parts.push(Buffer.from(part.value)); } }
          finally { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
          if (missing && r.status === 404) return null; need(r.ok); const content = Buffer.concat(parts);
          if (raw) return { content, contentType: r.headers.get('content-type'), entrypoint: r.headers.get('cf-entrypoint') };
          const value = JSON.parse(content.toString('utf8')); need(value.success === true && (!value.errors || value.errors.length === 0)); return value;
        }, GATEWAY_LIMITS.timeoutMs, () => controller.abort());
      };
      const list = (v, max) => { need(Array.isArray(v.result) && v.result.length <= max && v.result_info && [0, 1].includes(v.result_info.total_pages) && v.result_info.total_count === v.result.length && !v.result_info.cursor && !v.result_info.cursors?.after); return v.result; };
      const routing = async () => {
        for (const zone of list(await call(`/zones?account.id=${a.accountId}&per_page=50&page=1`), GATEWAY_LIMITS.zones)) {
          need(/^[a-f0-9]{32}$/.test(zone.id) && zone.account?.id === a.accountId); const r = await call(`/zones/${zone.id}/workers/routes`);
          need(Array.isArray(r.result) && r.result.length <= 1000 && !r.result_info?.cursor && !r.result_info?.cursors?.after && (!r.result_info?.total_pages || r.result_info.total_pages <= 1) && !r.result.some(x => [GATEWAY_TARGET, DEPLOY_TARGETS.caller].includes(x.script)));
        }
        need(!list(await call(`${account}/workers/domains?per_page=100&page=1`), 100).some(d => [GATEWAY_TARGET, DEPLOY_TARGETS.caller].includes(d.service)));
      };
      const privateSettings = async name => { const v = (await call(`${path(name)}/subdomain`)).result; need(v.enabled === false && v.previews_enabled === false); };
      const active = async name => { const d = (await call(`${path(name)}/deployments`)).result.deployments; need(Array.isArray(d) && d.length >= 1 && d.length <= 100 && UUID.test(d[0].id) && d[0].versions?.length === 1 && d[0].versions[0].percentage === 100 && UUID.test(d[0].versions[0].version_id)); return d[0].versions[0].version_id; };
      const verify = async (name, expectedId, expectedHash, meta) => {
        const versionId = await active(name); if (expectedId) need(versionId === expectedId);
        const v = (await call(`${path(name)}/versions/${versionId}`)).result;
        need(v.id === versionId && Object.entries(meta.annotations).every(([k, value]) => v.annotations?.[k] === value));
        const raw = await call(`${path(name)}/content/v2`, { raw: true }); need(raw.entrypoint === 'worker.mjs' && raw.contentType?.startsWith('multipart/form-data;'));
        const form = await new Response(raw.content, { headers: { 'Content-Type': raw.contentType } }).formData();
        need([...form.keys()].length === 1 && form.get('worker.mjs') instanceof Blob && hash(Buffer.from(await form.get('worker.mjs').arrayBuffer())) === expectedHash);
        const s = (await call(`${path(name)}/settings`)).result;
        need(s.compatibility_date === meta.compatibility_date && equal(s.compatibility_flags, meta.compatibility_flags) && equal(s.limits, meta.limits) && s.cache_options?.enabled === false && s.observability?.enabled === false && s.logpush === false && equal(s.tail_consumers, []));
        const sorted = bindings => [...bindings].sort((a, b) => a.name.localeCompare(b.name)); need(Array.isArray(s.bindings) && equal(sorted(s.bindings), sorted(meta.bindings)));
        const schedules = (await call(`${path(name)}/schedules`)).result; need(Array.isArray(schedules.schedules) && schedules.schedules.length === 0);
        need(await active(name) === versionId); return versionId;
      };
      const prior = a.caller.deploymentApproval, callerMeta = { compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], limits: { cpu_ms: 1000, subrequests: 1 }, bindings: [{ name: 'REHEARSAL_MANIFEST', type: 'secret_text' }, { name: 'REHEARSAL_CALLER_KEYS', type: 'secret_text' }, { name: 'CONTROL', type: 'service', service: DEPLOY_TARGETS.control, entrypoint: 'FollowUpRehearsalControl' }], annotations: { 'workers/tag': `rehearsal-${prior.releaseId.slice(0, 16)}-final`, 'workers/message': `git_sha=${prior.reviewedRevision};artifact_sha256=${prior.sourceArtifactDigest};bundle_sha256=${bundle('caller')};approval_sha256=${deploymentApprovalDigest(prior)}` } };
      const caller = async () => { await privateSettings(DEPLOY_TARGETS.caller); await verify(DEPLOY_TARGETS.caller, a.caller.versionId, bundle('caller'), callerMeta); };
      stage = 'resource-preflight'; await routing(); await caller(); need(await call(`${path(GATEWAY_TARGET)}/settings`, { missing: true }) === null);
      stage = 'gateway:shell-upload'; const shellMeta = metadata(a, candidate, true), shellBytes = Buffer.from(SHELL_SOURCE);
      // This remains a read-before-write check, not provider CAS. Exclusive
      // release custody is an explicit signed prerequisite, not proven here.
      need(await call(`${path(GATEWAY_TARGET)}/settings`, { missing: true }) === null);
      await call(path(GATEWAY_TARGET), { method: 'PUT', ...multipart(shellMeta, shellBytes) });
      const shellId = await verify(GATEWAY_TARGET, null, hash(shellBytes), shellMeta); identity = { name: GATEWAY_TARGET, versionId: shellId, phase: 'shell', bundleSha256: hash(shellBytes) };
      stage = 'gateway:disable-public-routing'; await call(`${path(GATEWAY_TARGET)}/subdomain`, { method: 'POST', body: Buffer.from(JSON.stringify({ enabled: false, previews_enabled: false })), contentType: 'application/json' }); await privateSettings(GATEWAY_TARGET);
      stage = 'gateway:final-preflight'; await routing(); await caller(); await verify(GATEWAY_TARGET, shellId, hash(shellBytes), shellMeta); await privateSettings(GATEWAY_TARGET);
      stage = 'gateway:final-upload'; const finalMeta = metadata(a, candidate, false); await call(path(GATEWAY_TARGET), { method: 'PUT', ...multipart(finalMeta, candidate.bytes) });
      stage = 'gateway:final-readback'; const versionId = await verify(GATEWAY_TARGET, null, bundle('gateway'), finalMeta); need(versionId !== shellId); identity = { name: GATEWAY_TARGET, versionId, phase: 'final', bundleSha256: bundle('gateway') };
      await privateSettings(GATEWAY_TARGET); await routing(); await caller(); need(await active(GATEWAY_TARGET) === versionId); fresh(); publicConfig.fresh(); tokenCompleted = true;
    })));
    need(tokenUsed && tokenCompleted); stage = 'complete'; closed = true; return report('deployed-private-not-invoked');
  } catch { closed = true; return report(attemptedWrites || consumptionState === 'unknown' ? 'reconciliation-required' : 'refused'); }
}
