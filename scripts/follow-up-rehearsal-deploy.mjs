// SOURCE ONLY until separately approved and run by a trusted host. No CLI deploy,
// credential discovery, provisioning fallback, retry, rollback or invocation.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inspectRehearsalCandidate, REHEARSAL_RELEASE_TARGETS as BASE } from './follow-up-rehearsal-release.mjs';
import { configuration } from '../follow-up-rehearsal-worker/src/protocol.mjs';
import { validateCallerConfiguration } from '../follow-up-rehearsal-worker/src/caller-authorization.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const PREFIX = 'follow-up-rehearsal-worker';
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, UUID = /^[a-f0-9-]{36}$/;
const ROLES = ['issuer', 'control', 'caller'];
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const need = v => { if (!v) throw new Error('rehearsal_deployment_refused'); };
const exact = (v, fields) => need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k)));
const equal = (a, b) => canonical(a) === canonical(b);
export const DEPLOY_TARGETS = Object.freeze({ ...BASE, caller: 'amari-followup-capture-caller-rehearsal' });
export const SHELL_SOURCE = 'export default { fetch() { return new Response("Not found", { status: 404 }); } };\n';
export const DEPLOY_LIMITS = Object.freeze({ requests: 112, writes: 9, responseBytes: 1048576, totalBytes: 16777216, uploadBytes: 1048576, timeoutMs: 15000, operationMs: 300000, zones: 8 });
const EXTRA = ['scripts/follow-up-rehearsal-deploy.mjs', `${PREFIX}/src/caller.mjs`, `${PREFIX}/wrangler.caller.jsonc`];
const gitDefault = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', timeout: 15000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' } });

function callerConfig(text) {
  const value = JSON.parse(text);
  need(text === JSON.stringify(value, null, 2) + '\n');
  need(equal(value, { name: DEPLOY_TARGETS.caller, main: 'src/caller.mjs', account_id: BASE.accountId,
    compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], workers_dev: false, preview_urls: false,
    routes: [], observability: { enabled: false }, send_metrics: false, keep_vars: false,
    limits: { cpu_ms: 1000, subrequests: 1 }, services: [{ binding: 'CONTROL', service: BASE.control, entrypoint: 'FollowUpRehearsalControl' }] }));
  return value;
}

async function snapshot(git = gitDefault) {
  const original = await inspectRehearsalCandidate({ git });
  const files = new Map(original.artifact.files.map(v => [v.path, v]));
  const pin = async path => {
    need(!path.startsWith('/') && !path.split('/').includes('..'));
    need(await realpath(`${ROOT}/${path}`) === `${ROOT}/${path}`);
    const bytes = await readFile(`${ROOT}/${path}`), sha256 = digest(bytes);
    if (files.has(path)) need(files.get(path).sha256 === sha256);
    files.set(path, { path, bytes: bytes.length, sha256 }); return bytes;
  };
  for (const path of EXTRA) await pin(path);
  const configs = {}, modules = {}, bundles = [];
  for (const role of ROLES) {
    configs[role] = role === 'caller' ? callerConfig((await pin(`${PREFIX}/wrangler.caller.jsonc`)).toString()) : JSON.parse((await pin(`${PREFIX}/wrangler.${role}.jsonc`)).toString());
    const result = await build({ absWorkingDir: ROOT, entryPoints: [`${PREFIX}/src/${role}.mjs`], bundle: true, write: false, metafile: true,
      format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:crypto', 'cloudflare:workers'], logLevel: 'silent', minify: false, sourcemap: false,
      plugins: [{ name: 'pin-deployment-inputs', setup(api) { api.onLoad({ filter: /./ }, async args => {
        const path = relative(ROOT, args.path); need(path.startsWith(`${PREFIX}/src/`) || /^scripts\/lib\/[a-z0-9-]+\.mjs$/.test(path));
        return { contents: await pin(path), loader: 'js', resolveDir: dirname(args.path) };
      }); } }] });
    need(result.outputFiles.length === 1 && result.warnings.length === 0);
    const inputs = Object.keys(result.metafile.inputs).sort();
    for (const path of inputs) { need(path.startsWith(`${PREFIX}/src/`) || /^scripts\/lib\/[a-z0-9-]+\.mjs$/.test(path)); await pin(path); }
    for (const output of Object.values(result.metafile.outputs)) need(output.imports.every(i => i.external && ['node:crypto', 'cloudflare:workers'].includes(i.path)));
    const bytes = Buffer.from(result.outputFiles[0].contents), sha256 = digest(bytes);
    if (role !== 'caller') need(original.artifact.bundles.find(v => v.role === role).sha256 === sha256);
    need(bytes.length <= DEPLOY_LIMITS.uploadBytes); modules[role] = bytes;
    bundles.push({ role, sha256, bytes: bytes.length, inputs });
  }
  const inventory = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of inventory) need(digest(await readFile(`${ROOT}/${entry.path}`)) === entry.sha256);
  const artifact = { version: 'follow-up-rehearsal-deployment-source.v1', revision: original.artifact.revision,
    foundationArtifact: original.artifactDigest, files: inventory, bundles, tools: original.artifact.tools, shellSha256: digest(SHELL_SOURCE), limits: DEPLOY_LIMITS };
  return { artifact, artifactDigest: digest(canonical(artifact)), dirty: original.dirty, configs, modules };
}

export async function inspectDeploymentCandidate({ git } = {}) {
  const { artifact, artifactDigest, dirty } = await snapshot(git);
  return { artifact, artifactDigest, dirty, sourceSelection: 'local-working-tree', deploymentAuthorized: false };
}

export function deploymentApprovalDigest(approval) { return digest(canonical(approval)); }
export function validateDeploymentApproval(a, approvedDigest, now) {
  exact(a, ['version', 'releaseId', 'issuedAt', 'expiresAt', 'reviewedRevision', 'sourceArtifactDigest', 'accountId', 'creates', 'bucket', 'secretDigests', 'limits', 'budget', 'acknowledgements']);
  need(a.version === 'follow-up-rehearsal-deployment-approval.v1' && HEX.test(a.releaseId) && SHA.test(a.reviewedRevision) && HEX.test(a.sourceArtifactDigest));
  need(HEX.test(approvedDigest) && deploymentApprovalDigest(a) === approvedDigest && a.accountId === BASE.accountId);
  need(Number.isSafeInteger(a.issuedAt) && Number.isSafeInteger(a.expiresAt) && a.issuedAt <= now && now < a.expiresAt && a.expiresAt - a.issuedAt <= 3600000);
  need(equal(a.creates, { scripts: ROLES.map(role => DEPLOY_TARGETS[role]), sqliteNamespace: { script: BASE.control, className: 'FollowUpRehearsalRegistryV1', migrationTag: 'rehearsal-v1' } }));
  exact(a.bucket, ['name', 'jurisdiction', 'creationDate', 'mode']);
  need(a.bucket.name === BASE.bucket && a.bucket.jurisdiction === 'us' && a.bucket.mode === 'existing-dedicated-empty' && typeof a.bucket.creationDate === 'string' && Number.isFinite(Date.parse(a.bucket.creationDate)));
  exact(a.secretDigests, ROLES); for (const role of ROLES) need(HEX.test(a.secretDigests[role]));
  need(equal(a.limits, DEPLOY_LIMITS)); exact(a.budget, ['aggregateCeilingCents', 'remainingCents', 'deploymentEstimateCents', 'cleanupReserveCents']);
  need(Object.values(a.budget).every(v => Number.isSafeInteger(v) && v > 0));
  need(a.budget.aggregateCeilingCents <= 1000 && a.budget.remainingCents <= a.budget.aggregateCeilingCents && a.budget.deploymentEstimateCents + a.budget.cleanupReserveCents <= a.budget.remainingCents);
  need(equal(a.acknowledgements, { temporaryPublic404Shell: true, createsThreeScriptsAndOneNamespace: true, noInvocation: true, noCleanupOrRollback: true, meteredUsage: true, exclusiveReleaseCustody: true }));
  return a;
}

function sourceGuard(candidate, approval, git) {
  const text = args => Buffer.from(git(args)).toString().trim();
  need(!text(['status', '--porcelain=v1', '--untracked-files=all']));
  need(text(['remote', 'get-url', 'origin']) === REMOTE);
  need(text(['rev-parse', 'HEAD']) === approval.reviewedRevision && text(['rev-parse', 'origin/main']) === approval.reviewedRevision);
  for (const file of candidate.artifact.files) {
    need(realpathSync(`${ROOT}/${file.path}`) === `${ROOT}/${file.path}` && digest(readFileSync(`${ROOT}/${file.path}`)) === file.sha256);
    need(digest(Buffer.from(git(['show', `${approval.reviewedRevision}:${file.path}`]))) === file.sha256);
  }
  need(text(['ls-remote', '--exit-code', REMOTE, 'refs/heads/main']) === `${approval.reviewedRevision}\trefs/heads/main`);
  need(text(['rev-parse', 'HEAD']) === approval.reviewedRevision && !text(['status', '--porcelain=v1', '--untracked-files=all']));
}

function validateSecrets(values, role, approval, candidate, now) {
  exact(values, ['REHEARSAL_MANIFEST', role === 'caller' ? 'REHEARSAL_CALLER_KEYS' : 'REHEARSAL_KEYS']);
  need(Object.values(values).every(v => typeof v === 'string' && Buffer.byteLength(v) <= 16384));
  need(digest(canonical(values)) === approval.secretDigests[role]);
  const manifest = (role === 'caller' ? validateCallerConfiguration(values) : configuration(values, role)).m;
  need(manifest.issuedAt <= now && now < manifest.expiresAt && manifest.scope.sourceRevision === approval.reviewedRevision);
  need(manifest.scope.handlerDigest === candidate.artifact.bundles.find(b => b.role === 'control').sha256);
  need(manifest.scope.issuerReleaseDigest === candidate.artifact.bundles.find(b => b.role === 'issuer').sha256);
  return values;
}

function metadata(role, stage, approval, candidate, values = {}) {
  const shell = stage === 'shell', bundleDigest = shell ? digest(SHELL_SOURCE) : candidate.artifact.bundles.find(b => b.role === role).sha256;
  const bindings = Object.entries(values).map(([name, text]) => ({ name, type: 'secret_text', text }));
  if (!shell && role === 'control') bindings.push({ name: 'REGISTRY', type: 'durable_object_namespace', class_name: 'FollowUpRehearsalRegistryV1' }, { name: 'CAPTURE_BUCKET', type: 'r2_bucket', bucket_name: BASE.bucket, jurisdiction: 'us' }, { name: 'ISSUER', type: 'service', service: BASE.issuer, entrypoint: 'FollowUpRehearsalIssuer' });
  if (!shell && role === 'caller') bindings.push({ name: 'CONTROL', type: 'service', service: BASE.control, entrypoint: 'FollowUpRehearsalControl' });
  const result = { main_module: 'worker.mjs', compatibility_date: '2026-08-27', compatibility_flags: ['nodejs_compat'], bindings, cache_options: { enabled: false },
    limits: { cpu_ms: 1000, subrequests: role === 'caller' ? 1 : 64 }, observability: { enabled: false }, logpush: false, tail_consumers: [],
    annotations: { 'workers/tag': `rehearsal-${approval.releaseId.slice(0, 16)}-${stage}`, 'workers/message': `git_sha=${approval.reviewedRevision};artifact_sha256=${candidate.artifactDigest};bundle_sha256=${bundleDigest};approval_sha256=${deploymentApprovalDigest(approval)}` } };
  if (!shell && role === 'control') result.migrations = { new_tag: 'rehearsal-v1', new_sqlite_classes: ['FollowUpRehearsalRegistryV1'] };
  return result;
}

function multipart(meta, bytes) {
  const boundary = `amari-${digest(bytes).slice(0, 32)}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="worker.mjs"; filename="worker.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  need(body.length <= DEPLOY_LIMITS.uploadBytes); return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// consumeRelease is a trusted external DURABLE one-shot authority. No in-memory
// fallback is supplied. A lost/rejected acknowledgement cannot authorize writes.
// Secret callbacks must use approved custody, not argv, files or logging. Test
// injected Git/fetch/custody prove logic only, never real host/provider authority.
export async function deployRehearsal({ execute, approval, approvedDigest, withCloudflareToken, withWorkerSecrets, consumeRelease, git = gitDefault, fetch: fetcher = globalThis.fetch, clock = Date.now } = {}) {
  let stage = 'source-preflight', writes = 0, requests = 0, totalBytes = 0, consumptionState = 'not-attempted', closed = false;
  const completed = [], started = clock(), identities = {};
  let candidate, deadline, runtimeManifestDigest;
  const report = status => ({ status, stage, consumptionState, consumed: consumptionState === 'unknown' ? null : consumptionState === 'consumed', attemptedWrites: writes, requests, totalBytes, completed, identities, retryAllowed: false, cleanupAllowed: false, runtimeInvoked: false });
  try {
    need(execute === true && typeof withCloudflareToken === 'function' && typeof withWorkerSecrets === 'function' && typeof consumeRelease === 'function');
    approval = JSON.parse(JSON.stringify(approval)); // Detach caller-owned mutable configuration.
    validateDeploymentApproval(approval, approvedDigest, clock()); deadline = Math.min(approval.expiresAt, started + DEPLOY_LIMITS.operationMs);
    const fresh = () => need(!closed && clock() < deadline);
    const bounded = async (fn, ms = deadline - clock(), abort = () => {}) => {
      fresh(); let timer;
      try { return await Promise.race([Promise.resolve().then(() => { fresh(); return fn(); }), new Promise((_, reject) => {
        timer = setTimeout(() => { closed = true; abort(); reject(new Error('rehearsal_deployment_timeout')); }, Math.max(1, Math.min(ms, deadline - clock())));
      })]); } finally { clearTimeout(timer); }
    };
    // A misbehaving host may start a callback without awaiting it. Observe its
    // rejection internally while preserving the returned promise for good hosts.
    const observed = fn => (...args) => { const promise = Promise.resolve().then(() => fn(...args)); void promise.catch(() => {}); return promise; };
    candidate = await bounded(() => snapshot(git)); fresh(); need(candidate.artifactDigest === approval.sourceArtifactDigest && candidate.artifact.revision === approval.reviewedRevision);
    sourceGuard(candidate, approval, git); fresh();
    stage = 'consume-release'; consumptionState = 'unknown'; const receipt = await bounded(() => consumeRelease({ releaseId: approval.releaseId, approvalDigest: approvedDigest, expiresAt: approval.expiresAt })); fresh();
    need(equal(receipt, { status: 'consumed', releaseId: approval.releaseId, approvalDigest: approvedDigest })); consumptionState = 'consumed';
    let tokenUsed = false, tokenCompleted = false;
    await bounded(() => withCloudflareToken(observed(async token => {
      fresh();
      need(!tokenUsed && typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token)); tokenUsed = true;
      const base = `/accounts/${BASE.accountId}`;
      const call = async (path, { method = 'GET', body, contentType, missing = false, raw = false, r2 = false } = {}) => {
        fresh(); need(++requests <= DEPLOY_LIMITS.requests && (path.startsWith(base + '/') || /^\/zones(?:\?|\/[a-f0-9]{32}\/workers\/routes$)/.test(path)));
        if (method !== 'GET') { sourceGuard(candidate, approval, git); fresh(); need(++writes <= DEPLOY_LIMITS.writes); }
        const size = body?.byteLength ?? 0; totalBytes += size; need(totalBytes <= DEPLOY_LIMITS.totalBytes);
        const controller = new AbortController();
        return bounded(async () => {
          const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, { method, body, redirect: 'error', signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}), ...(r2 ? { 'cf-r2-jurisdiction': 'us' } : {}) } });
          fresh(); need(response.body && !response.redirected); const reader = response.body.getReader(), parts = []; let bytes = 0;
          try { while (true) { const part = await reader.read(); fresh(); if (part.done) break; bytes += part.value.byteLength; totalBytes += part.value.byteLength; need(bytes <= DEPLOY_LIMITS.responseBytes && totalBytes <= DEPLOY_LIMITS.totalBytes); parts.push(Buffer.from(part.value)); } }
          finally { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
          if (missing && response.status === 404) return null;
          need(response.ok); const content = Buffer.concat(parts);
          if (raw) return { content, contentType: response.headers.get('content-type'), entrypoint: response.headers.get('cf-entrypoint') };
          const value = JSON.parse(content.toString('utf8')); need(value.success === true && (!value.errors || value.errors.length === 0)); return value;
        }, DEPLOY_LIMITS.timeoutMs, () => controller.abort());
      };
      const completeList = (value, limit) => {
        need(Array.isArray(value.result) && value.result.length <= limit);
        const info = value.result_info; need(info && (info.total_pages === 1 || info.total_pages === 0) && info.total_count === value.result.length && !info.cursor && !info.cursors?.after);
        return value.result;
      };
      const routing = async () => {
        const zones = completeList(await call(`/zones?account.id=${BASE.accountId}&per_page=50&page=1`), DEPLOY_LIMITS.zones);
        for (const zone of zones) { need(/^[a-f0-9]{32}$/.test(zone.id) && zone.account?.id === BASE.accountId); const routes = await call(`/zones/${zone.id}/workers/routes`); need(Array.isArray(routes.result) && routes.result.length <= 1000 && !routes.result.some(r => ROLES.some(role => r.script === DEPLOY_TARGETS[role]))); }
        const domains = completeList(await call(`${base}/workers/domains?per_page=100&page=1`), 100);
        need(!domains.some(d => ROLES.some(role => d.service === DEPLOY_TARGETS[role])));
      };
      const namespaces = async () => completeList(await call(`${base}/workers/durable_objects/namespaces?per_page=100&page=1`), 100);
      const emptyBucket = async () => {
        const b = (await call(`${base}/r2/buckets/${BASE.bucket}`, { r2: true })).result;
        need(b.name === approval.bucket.name && b.jurisdiction === 'us' && b.creation_date === approval.bucket.creationDate);
        const objects = await call(`${base}/r2/buckets/${BASE.bucket}/objects?per_page=1`, { r2: true });
        need(Array.isArray(objects.result) && objects.result.length === 0);
        // Cloudflare currently omits result_info for a successful empty R2
        // object listing. When pagination metadata is present, it must still
        // positively establish that there is no continuation.
        if (objects.result_info !== undefined) need(objects.result_info && objects.result_info.is_truncated === false && !objects.result_info.cursor);
      };
      stage = 'resource-preflight'; await routing(); await emptyBucket();
      need(!(await namespaces()).some(n => ROLES.some(role => n.script === DEPLOY_TARGETS[role]) || n.class === 'FollowUpRehearsalRegistryV1'));
      for (const role of ROLES) need(await call(`${base}/workers/scripts/${DEPLOY_TARGETS[role]}/settings`, { missing: true }) === null);
      const privateSettings = async name => { const s = (await call(`${base}/workers/scripts/${name}/subdomain`)).result; need(s.enabled === false && s.previews_enabled === false); };
      const activeVersion = async name => {
        const d = (await call(`${base}/workers/scripts/${name}/deployments`)).result.deployments;
        need(Array.isArray(d) && d.length >= 1 && d.length <= 100 && UUID.test(d[0].id) && d[0].versions?.length === 1 && d[0].versions[0].percentage === 100 && UUID.test(d[0].versions[0].version_id));
        return d[0].versions[0].version_id;
      };
      const verifyUpload = async (role, kind, meta, bytes) => {
        const name = DEPLOY_TARGETS[role], path = `${base}/workers/scripts/${name}`, versionId = await activeVersion(name);
        const version = (await call(`${path}/versions/${versionId}`)).result;
        // Wrangler's legacy ApiVersion type exposes these top-level annotations;
        // the provider may additionally attach workers/triggered_by.
        need(version.id === versionId && version.annotations?.['workers/tag'] === meta.annotations['workers/tag'] && version.annotations?.['workers/message'] === meta.annotations['workers/message']);
        const raw = await call(`${path}/content/v2`, { raw: true });
        need(typeof raw.contentType === 'string' && raw.contentType.startsWith('multipart/form-data;') && raw.entrypoint === 'worker.mjs');
        const form = await new Response(raw.content, { headers: { 'Content-Type': raw.contentType } }).formData();
        need([...form.keys()].length === 1 && form.get('worker.mjs') instanceof Blob && digest(Buffer.from(await form.get('worker.mjs').arrayBuffer())) === digest(bytes));
        const settings = (await call(`${path}/settings`)).result;
        need(settings.compatibility_date === meta.compatibility_date && equal(settings.compatibility_flags, meta.compatibility_flags) && equal(settings.limits, meta.limits) && settings.cache_options?.enabled === false && settings.observability?.enabled === false && settings.logpush === false && equal(settings.tail_consumers, []));
        const redact = bindings => bindings.map(b => { const copy = { ...b }; if (copy.type === 'secret_text') delete copy.text; if (copy.type === 'durable_object_namespace') delete copy.namespace_id; return copy; }).sort((a, b) => a.name.localeCompare(b.name));
        need(Array.isArray(settings.bindings) && equal(redact(settings.bindings), redact(meta.bindings)));
        if (kind === 'final' && role === 'control') {
          const ns = (await namespaces()).filter(n => n.script === name && n.class === 'FollowUpRehearsalRegistryV1');
          need(ns.length === 1 && /^[a-f0-9]{32}$/.test(ns[0].id) && ns[0].use_sqlite === true);
          need(settings.bindings.find(b => b.name === 'REGISTRY').namespace_id === ns[0].id); identities.namespaceId = ns[0].id;
        }
        need(await activeVersion(name) === versionId); identities[role] = { name, versionId, bundleSha256: digest(bytes), phase: kind };
      };
      for (const role of ROLES) {
        const path = `${base}/workers/scripts/${DEPLOY_TARGETS[role]}`;
        stage = `${role}:shell-upload`; const meta = metadata(role, 'shell', approval, candidate), bytes = Buffer.from(SHELL_SOURCE), upload = multipart(meta, bytes);
        await call(path, { method: 'PUT', ...upload }); await verifyUpload(role, 'shell', meta, bytes);
        stage = `${role}:disable-public-routing`; await call(`${path}/subdomain`, { method: 'POST', body: Buffer.from(JSON.stringify({ enabled: false, previews_enabled: false })), contentType: 'application/json' }); await privateSettings(DEPLOY_TARGETS[role]); completed.push(`${role}:private-shell`);
      }
      await routing(); await emptyBucket();
      for (const role of ROLES) {
        stage = `${role}:final-upload`; await privateSettings(DEPLOY_TARGETS[role]);
        // Only replace the exact shell created by this consumed release. This is
        // read-before-write evidence, not provider CAS against external writers.
        const shellVersion = identities[role].versionId;
        let used = false, secretCompleted = false;
        await bounded(() => withWorkerSecrets(role, observed(async values => {
          values = JSON.parse(JSON.stringify(values));
          fresh(); need(!used); used = true; validateSecrets(values, role, approval, candidate, clock());
          const manifestDigest = digest(values.REHEARSAL_MANIFEST);
          need(runtimeManifestDigest === undefined || runtimeManifestDigest === manifestDigest); runtimeManifestDigest = manifestDigest;
          const meta = metadata(role, 'final', approval, candidate, values), bytes = candidate.modules[role], upload = multipart(meta, bytes);
          await verifyUpload(role, 'shell', metadata(role, 'shell', approval, candidate), Buffer.from(SHELL_SOURCE));
          need(identities[role].versionId === shellVersion); await privateSettings(DEPLOY_TARGETS[role]);
          await call(`${base}/workers/scripts/${DEPLOY_TARGETS[role]}`, { method: 'PUT', ...upload });
          stage = `${role}:final-readback`; await verifyUpload(role, 'final', meta, bytes); await privateSettings(DEPLOY_TARGETS[role]); secretCompleted = true;
        })));
        need(used && secretCompleted); completed.push(`${role}:verified`);
      }
      stage = 'final-readback'; await routing(); for (const role of ROLES) { await privateSettings(DEPLOY_TARGETS[role]); need(await activeVersion(DEPLOY_TARGETS[role]) === identities[role].versionId); }
      fresh(); tokenCompleted = true;
    })));
    need(tokenUsed && tokenCompleted && completed.length === 6); stage = 'complete'; closed = true; return report('deployed-not-invoked');
  } catch { closed = true; return report(writes > 0 || consumptionState === 'unknown' ? 'reconciliation-required' : 'refused'); }
}
