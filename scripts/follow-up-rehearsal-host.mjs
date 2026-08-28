// SOURCE ONLY. Importing/inspecting does not retrieve credentials or call a provider.
// A separately trusted host supplies its public trust anchor, signed finite policy,
// and explicit execution permission. There is no CLI, default policy or live retry.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { deployRehearsal, inspectDeploymentCandidate, validateDeploymentApproval } from './follow-up-rehearsal-deploy.mjs';
import { authenticate, VERSION } from '../follow-up-rehearsal-worker/src/protocol.mjs';
import { validateOperatorAccessConfig, validateOperatorResponse } from '../follow-up-rehearsal-worker/src/operator-access.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SELF = 'scripts/follow-up-rehearsal-host.mjs', CONFIG = 'scripts/follow-up-rehearsal-bws.toml';
const BOOTSTRAP = '/Users/Eben/.bws-token';
const REPO = 'Eben283/amarimethod-website', PREFIX = 'refs/tags/followup-rehearsal-consumed/';
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const need = x => { if (!x) throw new Error('rehearsal_host_refused'); };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const hash = v => createHash('sha256').update(v).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) => need(v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort()));
const detached = v => { const text = JSON.stringify(v); need(typeof text === 'string' && Buffer.byteLength(text) <= 131072); return JSON.parse(text); };
export const HOST_LIMITS = Object.freeze({ githubRequests: 16, githubWrites: 2, githubBytes: 1048576, responseBytes: 65536, requestMs: 15000, operationMs: 300000, bwsGets: 5, bwsBytes: 65536, operatorBytes: 65536, operatorMs: 21000 });
export const HOST_RECORD_KEYS = Object.freeze({ github: 'AMARI_FOLLOWUP_REHEARSAL_LEDGER_GITHUB_TOKEN', cloudflare: 'AMARI_FOLLOWUP_REHEARSAL_CLOUDFLARE_TOKEN', issuer: 'AMARI_FOLLOWUP_REHEARSAL_ISSUER_SECRETS', control: 'AMARI_FOLLOWUP_REHEARSAL_CONTROL_SECRETS', caller: 'AMARI_FOLLOWUP_REHEARSAL_CALLER_SECRETS', accessId: 'AMARI_FOLLOWUP_REHEARSAL_ACCESS_CLIENT_ID', accessSecret: 'AMARI_FOLLOWUP_REHEARSAL_ACCESS_CLIENT_SECRET' });
const BWS_CONFIG = '# Public configuration only. Never cache session credentials or inherit endpoints.\n[profiles.rehearsal]\nserver_api = "https://api.bitwarden.com"\nserver_identity = "https://identity.bitwarden.com"\nstate_opt_out = "true"\n';
const gitDefault = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', timeout: 15000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1' } });
function hostTools() {
  need(!process.env.ESBUILD_BINARY_PATH && ['darwin', 'linux'].includes(process.platform));
  const paths = ['node_modules/esbuild/lib/main.js', 'node_modules/esbuild/package.json', `node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`, `node_modules/@esbuild/${process.platform}-${process.arch}/package.json`];
  return paths.map(path => { need(realpathSync(resolve(ROOT, path)) === resolve(ROOT, path)); return { path, sha256: hash(readFileSync(resolve(ROOT, path))) }; });
}

export function hostApprovalSigningBytes(policy) { return Buffer.from(`follow-up-rehearsal-host-approval.v1\n${canonical(policy)}`); }
export function hostApprovalDigest(policy) { return hash(canonical(policy)); }

export async function inspectHostCandidate({ git = gitDefault } = {}) {
  const toolFiles = hostTools(), base = await inspectDeploymentCandidate({ git }), files = new Map(base.artifact.files.map(f => [f.path, f]));
  const pin = path => {
    need(!path.startsWith('/') && !path.split('/').includes('..') && realpathSync(resolve(ROOT, path)) === resolve(ROOT, path));
    const bytes = readFileSync(resolve(ROOT, path)), sha256 = hash(bytes);
    if (files.has(path)) need(files.get(path).sha256 === sha256);
    files.set(path, { path, bytes: bytes.length, sha256 }); return bytes;
  };
  for (const path of [CONFIG, 'follow-up-rehearsal-worker/src/operator-ingress.mjs', 'follow-up-rehearsal-worker/wrangler.operator.jsonc']) pin(path);
  need(readFileSync(resolve(ROOT, CONFIG), 'utf8') === BWS_CONFIG);
  const bundle = await build({ absWorkingDir: ROOT, entryPoints: [SELF], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'pin-host-source', setup(api) { api.onLoad({ filter: /./ }, args => {
      const path = relative(ROOT, args.path); need(/^(scripts\/|follow-up-rehearsal-worker\/src\/)/.test(path));
      return { contents: pin(path), loader: 'js', resolveDir: dirname(args.path) };
    }); } }] });
  for (const output of Object.values(bundle.metafile.outputs)) need(output.imports.every(i => i.external && (i.path.startsWith('node:') || i.path === 'esbuild')));
  for (const f of files.values()) need(hash(readFileSync(resolve(ROOT, f.path))) === f.sha256);
  // esbuild is the only nonbuiltin external. Pin both its JS adapter and actual
  // platform executable, not just the package version; no override is accepted.
  need(equal(toolFiles, hostTools()));
  const artifact = { version: 'follow-up-rehearsal-host-source.v1', revision: base.artifact.revision, deploymentArtifactDigest: base.artifactDigest,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), tools: { ...base.artifact.tools, files: toolFiles, node: process.version }, limits: HOST_LIMITS };
  return { artifact, artifactDigest: hash(canonical(artifact)), dirty: base.dirty, executionAuthorized: false };
}

export function validateHostApproval(envelope, trustedRoot, now = Date.now()) {
  exact(envelope, ['policy', 'signature']); exact(trustedRoot, ['keyId', 'publicKey']);
  const p = envelope.policy;
  exact(p, ['version', 'mode', 'releaseId', 'issuedAt', 'expiresAt', 'reviewedRevision', 'hostArtifactDigest', 'ownerKeyId', 'custody', 'ledger', 'operation']);
  need(p.version === 'follow-up-rehearsal-host-approval.v1' && ['deploy', 'invoke'].includes(p.mode) && HEX.test(p.releaseId) && SHA.test(p.reviewedRevision) && HEX.test(p.hostArtifactDigest));
  need(Number.isSafeInteger(p.issuedAt) && Number.isSafeInteger(p.expiresAt) && p.issuedAt <= now && now < p.expiresAt && p.expiresAt - p.issuedAt <= 3600000);
  need(p.ownerKeyId === trustedRoot.keyId && /^[A-Za-z0-9_-]{1,64}$/.test(p.ownerKeyId));
  const key = createPublicKey(trustedRoot.publicKey); need(key.asymmetricKeyType === 'ed25519' && key.type === 'public' && !String(trustedRoot.publicKey).includes('PRIVATE'));
  need(typeof envelope.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(envelope.signature) && verify(null, hostApprovalSigningBytes(p), key, Buffer.from(envelope.signature, 'base64url')));
  exact(p.ledger, ['repository', 'refPrefix', 'rulesetId']); need(p.ledger.repository === REPO && p.ledger.refPrefix === PREFIX && Number.isSafeInteger(p.ledger.rulesetId) && p.ledger.rulesetId > 0);
  exact(p.custody, ['executable', 'executableSha256', 'records']); need(typeof p.custody.executable === 'string' && p.custody.executable.startsWith('/') && HEX.test(p.custody.executableSha256));
  const roles = p.mode === 'deploy' ? ['github', 'cloudflare', 'issuer', 'control', 'caller'] : ['github', 'accessId', 'accessSecret'];
  exact(p.custody.records, roles); const ids = new Set();
  for (const role of roles) { const r = p.custody.records[role]; exact(r, ['id', 'key', 'projectId', 'organizationId', 'revisionDate', 'sha256']);
    need(UUID.test(r.id) && UUID.test(r.projectId) && UUID.test(r.organizationId) && r.key === HOST_RECORD_KEYS[role] && HEX.test(r.sha256) && typeof r.revisionDate === 'string' && Number.isFinite(Date.parse(r.revisionDate)) && !ids.has(r.id)); ids.add(r.id);
  }
  if (p.mode === 'deploy') { exact(p.operation, ['approvalDigest']); need(HEX.test(p.operation.approvalDigest)); }
  else { exact(p.operation, ['origin', 'path', 'envelopeDigest', 'publicConfig', 'principal']); need(HEX.test(p.operation.envelopeDigest));
    const config = validateOperatorAccessConfig(p.operation.publicConfig); need(config.origin === p.operation.origin && config.path === p.operation.path);
    exact(p.operation.principal, ['callerId', 'keyId', 'role']);
    need(config.policy.principals.some(v => ['callerId', 'keyId', 'role'].every(k => v[k] === p.operation.principal[k])));
  }
  return detached(p);
}

function sourceGuard(candidate, p, git) {
  const text = args => Buffer.from(git(args)).toString().trim();
  need(candidate.artifactDigest === p.hostArtifactDigest && candidate.artifact.revision === p.reviewedRevision);
  need(candidate.artifact.tools.node === process.version && equal(candidate.artifact.tools.files, hostTools()));
  need(!text(['status', '--porcelain=v1', '--untracked-files=all']) && text(['remote', 'get-url', 'origin']) === `https://github.com/${REPO}.git`);
  need(text(['rev-parse', 'HEAD']) === p.reviewedRevision && text(['rev-parse', 'origin/main']) === p.reviewedRevision);
  for (const f of candidate.artifact.files) { need(realpathSync(resolve(ROOT, f.path)) === resolve(ROOT, f.path)); need(hash(readFileSync(resolve(ROOT, f.path))) === f.sha256 && hash(Buffer.from(git(['show', `${p.reviewedRevision}:${f.path}`]))) === f.sha256); }
  need(text(['ls-remote', '--exit-code', `https://github.com/${REPO}.git`, 'refs/heads/main']) === `${p.reviewedRevision}\trefs/heads/main`);
}

// The one allowed bootstrap file is opened without following a final symlink;
// check the same descriptor we read. Never read any provider-secret file.
function bootstrapBytes() {
  const fd = openSync(BOOTSTRAP, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); need(s.isFile() && (s.mode & 0o777) === 0o600 && s.uid === process.getuid() && s.nlink === 1 && s.size > 0 && s.size <= 8192); return readFileSync(fd); }
  finally { closeSync(fd); }
}

export async function runExactBwsRecord({ custody, record, signal }, dependencies = {}) {
  // Dependency injection is for synthetic tests, never a claim of real custody.
  const readBootstrap = dependencies.readBootstrap ?? bootstrapBytes, spawnChild = dependencies.spawn ?? spawn;
  const inspectBinary = dependencies.inspectBinary ?? (() => {
    need(realpathSync(custody.executable) === custody.executable); const s = statSync(custody.executable);
    need(s.isFile() && (s.mode & 0o022) === 0 && [0, process.getuid()].includes(s.uid) && s.size <= 104857600 && hash(readFileSync(custody.executable)) === custody.executableSha256);
    need(realpathSync(resolve(ROOT, CONFIG)) === resolve(ROOT, CONFIG) && readFileSync(resolve(ROOT, CONFIG), 'utf8') === BWS_CONFIG);
  });
  inspectBinary(); need(!signal?.aborted); let secretBytes, child, timer;
  try {
    secretBytes = readBootstrap(); need(Buffer.isBuffer(secretBytes) && secretBytes.length > 0 && secretBytes.length <= 8192);
    const bootstrap = secretBytes.toString('utf8').trim(); need(bootstrap && !/[\r\n]/.test(bootstrap));
    const result = await new Promise((resolveResult, reject) => {
      let finished = false, bytes = 0; const chunks = [];
      const stop = () => { try { child?.kill('SIGKILL'); } catch {} };
      const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); for (const c of chunks) c.fill(0); error ? reject(new Error('rehearsal_custody_refused')) : resolveResult(value); };
      const abort = () => { stop(); finish(true); };
      child = spawnChild(custody.executable, ['secret', 'get', record.id, '--output', 'json', '--color', 'no', '--config-file', resolve(ROOT, CONFIG), '--profile', 'rehearsal'], { cwd: ROOT, env: { BWS_ACCESS_TOKEN: bootstrap }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      signal?.addEventListener('abort', abort, { once: true }); timer = setTimeout(abort, HOST_LIMITS.requestMs);
      child.on('error', () => finish(true));
      child.stdout.on('data', data => { if (finished) { data.fill(0); return; } bytes += data.length; if (bytes > HOST_LIMITS.bwsBytes) { data.fill(0); abort(); } else { chunks.push(Buffer.from(data)); data.fill(0); } });
      child.stderr.on('data', data => { bytes += data.length; data.fill(0); if (bytes > HOST_LIMITS.bwsBytes) abort(); });
      child.on('close', code => { if (finished) return; let value; const output = Buffer.concat(chunks);
        try { need(code === 0 && !signal?.aborted); value = JSON.parse(output.toString('utf8')); finish(false, value); } catch { finish(true); } finally { output.fill(0); }
      });
      if (signal?.aborted) abort();
    });
    inspectBinary(); return result;
  } catch { throw new Error('rehearsal_custody_refused'); }
  finally { secretBytes?.fill(0); clearTimeout(timer); }
}

export function createExactCustody({ policy, run = runExactBwsRecord, signal, fresh = () => {} }) {
  let gets = 0;
  return async (role, use) => {
    let r;
    try { fresh(); need(typeof use === 'function' && Object.hasOwn(policy.custody.records, role) && ++gets <= HOST_LIMITS.bwsGets);
      const expected = policy.custody.records[role]; r = await run({ custody: policy.custody, record: expected, signal }); fresh();
      need(r && ['id', 'key', 'projectId', 'organizationId', 'revisionDate'].every(k => r[k] === expected[k]) && typeof r.value === 'string' && Buffer.byteLength(r.value) <= HOST_LIMITS.bwsBytes && hash(r.value) === expected.sha256);
      // The metadata from this exact retrieval is checked before using its value.
      return await use(r.value);
    } catch { throw new Error('rehearsal_custody_refused'); }
    finally { if (r) r.value = undefined; }
  };
}

function boundedHttp({ fetcher, fresh, signal, deadline, clock }) {
  return async (url, options, maxBytes, timeoutMs) => {
    fresh(); const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); let timer;
    try { return await Promise.race([(async () => {
      const response = await fetcher(url, { ...options, signal: controller.signal, redirect: 'error' }); fresh(); need(!response.redirected && response.body);
      const reader = response.body.getReader(), chunks = []; let total = 0;
      try { while (true) { const part = await reader.read(); fresh(); if (part.done) break; total += part.value.byteLength; need(total <= maxBytes); chunks.push(Buffer.from(part.value)); } }
      finally { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
      return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks) };
    })(), new Promise((_, reject) => { timer = setTimeout(() => { abort(); reject(new Error('rehearsal_host_timeout')); }, Math.max(1, Math.min(timeoutMs, deadline - clock()))); })]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };
}

export async function consumeGitHubRelease({ policy: p, approvalDigest, custody, http, fresh, evidence, beforeWrite = fresh }) {
  const ref = `${PREFIX}${p.releaseId}`, tag = ref.slice('refs/tags/'.length), message = canonical({ version: 'follow-up-release-consumed.v1', releaseId: p.releaseId, approvalDigest, sourceRevision: p.reviewedRevision, expiresAt: p.expiresAt });
  return custody('github', async token => {
    need(token.length >= 20 && token.length <= 4096 && !/[\r\n]/.test(token));
    const call = async (path, method = 'GET', body) => {
      fresh(); need(++evidence.githubRequests <= HOST_LIMITS.githubRequests);
      if (method !== 'GET') { beforeWrite(); fresh(); need(++evidence.githubWrites <= HOST_LIMITS.githubWrites); evidence.consumptionState = 'unknown'; }
      const text = body === undefined ? undefined : JSON.stringify(body);
      const r = await http(`https://api.github.com/repos/${REPO}${path}`, { method, body: text, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(text ? { 'Content-Type': 'application/json' } : {}) } }, HOST_LIMITS.responseBytes, HOST_LIMITS.requestMs);
      evidence.githubBytes += r.bytes.length + (text ? Buffer.byteLength(text) : 0); need(evidence.githubBytes <= HOST_LIMITS.githubBytes);
      need(!r.headers.get('link')); return { ...r, value: JSON.parse(r.bytes.toString('utf8')) };
    };
    const rules = async () => { const r = await call(`/rulesets/${p.ledger.rulesetId}?includes_parents=false`); const v = r.value;
      need(r.status === 200 && v.id === p.ledger.rulesetId && v.source_type === 'Repository' && v.source === REPO && v.target === 'tag' && v.enforcement === 'active');
      need(Object.hasOwn(v, 'bypass_actors') && equal(v.bypass_actors, []) && equal(v.conditions, { ref_name: { include: [`${PREFIX}*`], exclude: [] } }));
      need(Array.isArray(v.rules) && v.rules.length === 2 && equal(v.rules.map(x => x.type).sort(), ['deletion', 'update']) && v.rules.every(x => equal(Object.keys(x), ['type'])));
    };
    await rules(); const old = await call(`/git/ref/tags/${tag}`); need(old.status === 404);
    const main = await call('/git/ref/heads/main'); need(main.status === 200 && main.value.object?.type === 'commit' && main.value.object.sha === p.reviewedRevision);
    const object = await call('/git/tags', 'POST', { tag, message, object: p.reviewedRevision, type: 'commit' });
    need(object.status === 201 && SHA.test(object.value.sha) && object.value.tag === tag && object.value.message === message && object.value.object?.sha === p.reviewedRevision && object.value.object.type === 'commit');
    evidence.tagObject = object.value.sha; await rules();
    const created = await call('/git/refs', 'POST', { ref, sha: object.value.sha });
    need(created.status === 201 && created.value.ref === ref && created.value.object?.type === 'tag' && created.value.object.sha === object.value.sha);
    const read = await call(`/git/ref/tags/${tag}`), readObject = await call(`/git/tags/${object.value.sha}`); await rules();
    need(read.status === 200 && read.value.ref === ref && read.value.object?.type === 'tag' && read.value.object.sha === object.value.sha);
    need(readObject.status === 200 && readObject.value.sha === object.value.sha && readObject.value.tag === tag && readObject.value.message === message && readObject.value.object?.type === 'commit' && readObject.value.object.sha === p.reviewedRevision);
    fresh(); evidence.consumptionState = 'consumed'; return { status: 'consumed', releaseId: p.releaseId, approvalDigest };
  });
}

// A public metadata-only status read never retrieves credentials or authorizes
// execution. Even matching consumed evidence is NOT a replacement for a lost ACK.
export async function inspectReleaseStatus({ releaseId, fetch: fetcher = globalThis.fetch } = {}) {
  need(HEX.test(releaseId)); const controller = new AbortController(), deadline = Date.now() + HOST_LIMITS.requestMs;
  const http = boundedHttp({ fetcher, signal: controller.signal, deadline, clock: Date.now, fresh: () => need(Date.now() < deadline) });
  try { const r = await http(`https://api.github.com/repos/${REPO}/git/ref/tags/${PREFIX.slice('refs/tags/'.length)}${releaseId}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }, HOST_LIMITS.responseBytes, HOST_LIMITS.requestMs);
    if (r.status === 200) { const value = JSON.parse(r.bytes.toString('utf8')); need(value.ref === `${PREFIX}${releaseId}` && value.object?.type === 'tag' && SHA.test(value.object.sha)); }
    return { status: r.status === 404 ? 'not-observed' : r.status === 200 ? 'observed-reconcile-only' : 'unknown', executionAuthorized: false, retryAllowed: false };
  } catch { return { status: 'unknown', executionAuthorized: false, retryAllowed: false }; } finally { controller.abort(); }
}

export async function runRehearsalHost({ execute, hostApproval, trustedRoot, deploymentApproval, requestText, git = gitDefault, fetch: fetcher = globalThis.fetch, runBws = runExactBwsRecord, clock = Date.now, inspect = inspectHostCandidate, deploy = deployRehearsal } = {}) {
  const evidence = { consumptionState: 'not-attempted', githubRequests: 0, githubWrites: 0, githubBytes: 0, operatorAttempts: 0, retryAllowed: false, cleanupAllowed: false };
  let stage = 'approval', closed = false, timer; const controller = new AbortController();
  try {
    need(execute === true); const p = validateHostApproval(detached(hostApproval), trustedRoot, clock()), deadline = Math.min(p.expiresAt, clock() + HOST_LIMITS.operationMs);
    const fresh = () => need(!closed && !controller.signal.aborted && clock() < deadline);
    const work = async () => {
      stage = 'source-preflight'; const candidate = await inspect({ git }); fresh(); sourceGuard(candidate, p, git); fresh();
      let auth, operatorConfig;
      if (p.mode === 'deploy') { validateDeploymentApproval(deploymentApproval, p.operation.approvalDigest, clock()); need(deploymentApproval.releaseId === p.releaseId && deploymentApproval.reviewedRevision === p.reviewedRevision && deploymentApproval.expiresAt === p.expiresAt); }
      else { need(typeof requestText === 'string' && Buffer.byteLength(requestText) <= HOST_LIMITS.operatorBytes && hash(requestText) === p.operation.envelopeDigest);
        operatorConfig = validateOperatorAccessConfig(p.operation.publicConfig); auth = authenticate(operatorConfig.callerConfig, requestText); auth.fresh();
    need(auth.r.callerId === p.operation.principal.callerId && auth.r.role === p.operation.principal.role && auth.p.keyId === p.operation.principal.keyId);
      }
      const custody = createExactCustody({ policy: p, run: runBws, signal: controller.signal, fresh });
      const http = boundedHttp({ fetcher, fresh, signal: controller.signal, deadline, clock });
      const approvalDigest = p.mode === 'deploy' ? p.operation.approvalDigest : hostApprovalDigest(p);
      const consume = async input => { need(equal(input, { releaseId: p.releaseId, approvalDigest, expiresAt: p.expiresAt })); stage = 'consume-release'; sourceGuard(candidate, p, git); fresh(); return consumeGitHubRelease({ policy: p, approvalDigest, custody, http, fresh, evidence, beforeWrite: () => sourceGuard(candidate, p, git) }); };
      // The frozen driver's own window starts later. Tie its transport to this
      // host too: closing this host prevents any later request, even when the
      // provider/transport ignores abort for an already-started request.
      const hostFetch = async (url, options = {}) => {
        fresh(); const response = await fetcher(url, { ...options, signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) }); fresh();
        need(response.body && !response.redirected); const reader = response.body.getReader();
        const body = new ReadableStream({ async pull(stream) { try { fresh(); const item = await reader.read(); fresh(); item.done ? stream.close() : stream.enqueue(item.value); } catch { stream.error(new Error('rehearsal_host_closed')); try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {} } }, cancel() { try { return reader.cancel(); } catch {} } });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
      if (p.mode === 'deploy') { stage = 'deployment'; const result = await deploy({ execute: true, approval: deploymentApproval, approvedDigest: approvalDigest, git, fetch: hostFetch, clock, consumeRelease: consume,
        withCloudflareToken: use => custody('cloudflare', use), withWorkerSecrets: (role, use) => custody(role, value => { const v = JSON.parse(value); need(value === canonical(v)); return use(v); }) });
        fresh(); return { status: result.status, stage: 'deployment-result', ...evidence, deployment: result };
      }
      await consume({ releaseId: p.releaseId, approvalDigest, expiresAt: p.expiresAt }); fresh(); auth.fresh();
      stage = 'operator-invocation'; return await custody('accessId', id => custody('accessSecret', async secret => {
        need(id.length >= 8 && id.length <= 512 && secret.length >= 20 && secret.length <= 4096 && !/[\r\n]/.test(id + secret));
        need(operatorConfig.policy.principals.some(v => v.commonName === id && ['callerId', 'keyId', 'role'].every(k => v[k] === p.operation.principal[k])));
        sourceGuard(candidate, p, git); fresh(); auth.fresh(); operatorConfig.fresh(); evidence.operatorAttempts = 1;
        const r = await http(`${p.operation.origin}${p.operation.path}`, { method: 'POST', body: requestText, headers: { 'Content-Type': 'application/json', 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } }, HOST_LIMITS.operatorBytes, Math.min(HOST_LIMITS.operatorMs, auth.r.expiresAt - clock()));
        fresh(); auth.fresh(); need(r.status === 200 && r.headers.get('content-type')?.startsWith('application/json'));
        const body = validateOperatorResponse(r.bytes.toString('utf8')); need(body.contract === VERSION && body.productionAuthority === false);
        return { status: body.requiresReadOnlyReconciliation ? 'reconciliation-required' : 'invocation-response', stage, ...evidence, response: body };
      }));
    };
    const result = await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { closed = true; controller.abort(); reject(new Error('rehearsal_host_timeout')); }, Math.max(1, deadline - clock())); })]); closed = true; return result;
  } catch { closed = true; return { status: evidence.githubWrites || evidence.operatorAttempts || evidence.consumptionState === 'unknown' ? 'reconciliation-required' : 'refused', stage, ...evidence }; }
  finally { clearTimeout(timer); controller.abort(); }
}
