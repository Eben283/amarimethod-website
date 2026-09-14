import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const WRANGLER_VERSION = '4.125.0';
export const CHILD_PROCESS_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

export const WORKERS = Object.freeze({
  'amari-crm-mirror': 'crm-mirror-worker',
  'call-coach': 'call-coach-worker',
  'coach-daily': 'coach-daily-worker',
  'comms-coherence': 'comms-coherence-worker',
  'conversation-cache': 'conversation-cache-worker',
  'daily-audit': 'daily-audit-worker',
  'ecosystem-scanner': 'ecosystem-scanner',
  'funnel-refresh': 'funnel-refresh-worker',
  'ghl-token-refresh': 'ghl-token-worker',
  'morning-sms': 'morning-sms-worker',
  'nurture-engine': 'nurture-engine-worker',
  'ops-fixer': 'ops-fix-worker',
  'partner-activity-refresh': 'partner-activity-refresh-worker',
  'reminder-engine': 'reminder-engine-worker',
  'series-reconcile': 'series-reconcile-worker',
});

export const REQUIRED_BINDINGS = Object.freeze({
  'nurture-engine': Object.freeze(['NURTURE_DB', 'CRM_DB', 'PORTAL_KV', 'WORKER_AUTH_SECRET', 'GHL_WEBHOOK_SECRET']),
  'reminder-engine': Object.freeze(['REMINDER_DB', 'CRM_DB', 'ATTEND_DB', 'PORTAL_KV', 'NURTURE', 'NURTURE_ENGINE_URL', 'WORKER_AUTH_SECRET']),
});

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: options.encoding || 'utf8',
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function provenanceForRevision({ revision, tree, worker }) {
  const message = `git_sha=${revision};tree_sha=${tree};worker=${worker}`;
  return { message, revision, tag: `git-${revision}`, tree, worker };
}

export function localProvenance(worker, git = runGit) {
  if (!WORKERS[worker]) throw new Error(`Worker release refused: unsupported Worker ${worker || '(missing)'}.`);
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  if (dirty) throw new Error('Worker release refused: the Git worktree is not clean.');

  const revision = git(['rev-parse', 'HEAD']).trim();
  const localMain = git(['rev-parse', 'origin/main']).trim();
  const liveMainLine = git(['ls-remote', 'origin', 'refs/heads/main']).trim();
  const liveMain = liveMainLine.split(/\s+/)[0] || '';
  if (revision !== localMain || revision !== liveMain) {
    throw new Error(`Worker release refused: HEAD ${revision} is not the exact current origin/main revision ${liveMain || localMain}.`);
  }
  const tree = git(['rev-parse', `${revision}^{tree}`]).trim();
  return provenanceForRevision({ revision, tree, worker });
}

export function parseVersionId(output) {
  const match = String(output).match(/(?:Current )?Version ID:\s*([0-9a-f-]{36})/i);
  if (!match) throw new Error('Worker release uploaded a candidate but Wrangler did not return its version ID.');
  return match[1];
}

function bindingContract(binding) {
  if (Array.isArray(binding)) return binding.map(bindingContract);
  if (!binding || typeof binding !== 'object') return binding;
  return Object.fromEntries(Object.keys(binding).sort().map((key) => [key, bindingContract(binding[key])]));
}

function bindings(version) {
  return version?.resources?.bindings || version?.bindings || [];
}

export function assertBindingsPreserved(beforeVersion, afterVersion) {
  const afterByName = new Map(bindings(afterVersion).map((binding) => [binding?.name, bindingContract(binding)]));
  const changed = bindings(beforeVersion)
    .map(bindingContract)
    .filter((contract) => JSON.stringify(afterByName.get(contract.name)) !== JSON.stringify(contract));
  if (changed.length) {
    throw new Error(`Worker release refused before activation: candidate changed or dropped existing bindings: ${changed.map((item) => item.name).join(', ')}.`);
  }
}

export function assertRequiredBindings(worker, version) {
  const present = new Set(bindings(version).map((binding) => binding?.name).filter(Boolean));
  const missing = (REQUIRED_BINDINGS[worker] || []).filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`Worker release refused before activation: ${worker} is missing required bindings: ${missing.join(', ')}.`);
  }
}

export function assertVersionProvenance(version, provenance) {
  const serialized = JSON.stringify(version);
  if (!serialized.includes(provenance.revision) || !serialized.includes(provenance.tree) || !serialized.includes(provenance.worker)) {
    throw new Error('Worker release refused before activation: candidate is missing exact source provenance.');
  }
}

export function wranglerUploadArgs(provenance) {
  return [
    '--yes', `wrangler@${WRANGLER_VERSION}`, 'versions', 'upload', '--keep-vars', '--strict',
    '--tag', provenance.tag, '--message', provenance.message,
  ];
}

export function wranglerPromoteArgs(versionId, provenance) {
  return [
    '--yes', `wrangler@${WRANGLER_VERSION}`, 'versions', 'deploy', `${versionId}@100%`, '--yes',
    '--message', provenance.message,
  ];
}

export function createCloudflareClient({ accountId, token, fetchImpl = fetch }) {
  if (!accountId || !token) throw new Error('Worker release requires the approved Cloudflare account and deploy credential.');
  return async (path) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(`Worker release readback failed at ${path} (${response.status}).`);
    return payload.result;
  };
}

function activeDeploymentVersionId(result) {
  const deployments = Array.isArray(result) ? result : result?.deployments || result?.items || [];
  const active = deployments.find((deployment) => deployment?.versions?.some((version) => Number(version.percentage) === 100));
  return active?.versions?.find((version) => Number(version.percentage) === 100)?.version_id || null;
}

export async function activeVersionId(cloudflare, worker) {
  const result = await cloudflare(`/workers/scripts/${encodeURIComponent(worker)}/deployments`);
  const versionId = activeDeploymentVersionId(result);
  if (!versionId) throw new Error(`Worker release could not resolve the exact active version for ${worker}.`);
  return versionId;
}

export async function activeVersion(cloudflare, worker) {
  const versionId = await activeVersionId(cloudflare, worker);
  const detail = await cloudflare(`/workers/scripts/${encodeURIComponent(worker)}/versions/${encodeURIComponent(versionId)}`);
  return { detail, versionId };
}

function runWrangler(args, workerDir) {
  const result = spawnSync('npx', args, {
    cwd: fileURLToPath(new URL(`../${workerDir}/`, import.meta.url)),
    encoding: 'utf8',
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`Worker release command failed with status ${result.status ?? 'unknown'}; command output was suppressed.`);
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function assertProductionLane(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Worker release refused: production activation is allowed only through the serialized GitHub Actions release lane.');
  }
}

export async function releaseWorker({ worker, provenance, cloudflare, execute = runWrangler }) {
  const workerDir = WORKERS[worker];
  if (!workerDir) throw new Error(`Worker release refused: unsupported Worker ${worker}.`);

  const before = await activeVersion(cloudflare, worker);
  const candidateOutput = execute(wranglerUploadArgs(provenance), workerDir);
  const candidateId = parseVersionId(candidateOutput);
  const candidate = await cloudflare(`/workers/scripts/${encodeURIComponent(worker)}/versions/${encodeURIComponent(candidateId)}`);
  assertVersionProvenance(candidate, provenance);
  assertRequiredBindings(worker, candidate);
  assertBindingsPreserved(before.detail, candidate);

  const currentVersionId = await activeVersionId(cloudflare, worker);
  if (currentVersionId !== before.versionId) {
    throw new Error(`Worker release refused before activation: ${worker} changed concurrently.`);
  }

  execute(wranglerPromoteArgs(candidateId, provenance), workerDir);
  const after = await activeVersion(cloudflare, worker);
  if (after.versionId !== candidateId) throw new Error(`Worker release verification failed: ${worker} did not activate the verified candidate.`);
  assertVersionProvenance(after.detail, provenance);
  assertRequiredBindings(worker, after.detail);
  assertBindingsPreserved(before.detail, after.detail);
  return { previousVersionId: before.versionId, versionId: candidateId };
}

export async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const worker = args[args.indexOf('--worker') + 1];
  const deploy = args.includes('--deploy');
  const provenance = (dependencies.localProvenance || localProvenance)(worker);
  const approvedRevision = args[args.indexOf('--approved-revision') + 1];

  if (!deploy) {
    process.stdout.write(`Worker release preflight passed for ${worker}: ${provenance.message}\n`);
    process.stdout.write('No candidate was uploaded or activated.\n');
    return { deployed: false, provenance };
  }
  assertProductionLane(dependencies.env || process.env);
  if (approvedRevision !== provenance.revision) {
    throw new Error(`Worker release refused: --approved-revision must equal ${provenance.revision}.`);
  }
  const cloudflare = dependencies.cloudflare || createCloudflareClient({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
  const result = await releaseWorker({ worker, provenance, cloudflare, execute: dependencies.execute });
  process.stdout.write(`Worker release verified for ${worker}: ${result.versionId} ${provenance.message}\n`);
  return { deployed: true, ...result, provenance };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runCli(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
