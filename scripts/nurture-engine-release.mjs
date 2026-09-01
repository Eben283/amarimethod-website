import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const WORKER_ROOT = new URL('../nurture-engine-worker/', import.meta.url);
export const CHILD_PROCESS_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

// The Worker imports the shared operations health writer. Attest the full Functions tree so
// no stale shared dependency can hide behind a current top-level Worker directory.
export const PROVENANCE_PATHS = Object.freeze([
  '.node-version',
  'package-lock.json',
  'package.json',
  'nurture-engine-worker',
  'functions',
]);

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: fileURLToPath(REPOSITORY_ROOT),
    encoding: options.encoding || 'utf8',
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function provenanceForRevision({ revision, archive }) {
  const artifactDigest = createHash('sha256').update(archive).digest('hex');
  const message = `git_sha=${revision};artifact_sha256=${artifactDigest}`;
  return { artifactDigest, message, revision, tag: `git-${revision}` };
}

export function sourceArchiveForRevision(revision) {
  return runGit(['archive', '--format=tar', revision, ...PROVENANCE_PATHS], { encoding: 'buffer' });
}

export function assertVersionProvenance(version, provenance) {
  const serialized = JSON.stringify(version);
  if (!serialized.includes(provenance.revision) || !serialized.includes(provenance.artifactDigest)) {
    throw new Error(`Nurture Engine version is missing the approved provenance (${provenance.message}).`);
  }
}

function bindingContract(binding) {
  const contract = { name: binding?.name || null, type: binding?.type || null };
  if (binding?.type === 'd1') contract.id = binding.id || binding.database_id || null;
  if (binding?.type === 'kv_namespace') contract.id = binding.id || binding.namespace_id || null;
  if (binding?.type === 'service') {
    contract.service = binding.service || null;
    contract.environment = binding.environment || null;
  }
  if (binding?.type === 'plain_text') contract.text = binding.text ?? null;
  return contract;
}

export function assertBindingsPreserved(beforeVersion, afterVersion) {
  const before = beforeVersion?.resources?.bindings || beforeVersion?.bindings || [];
  const after = afterVersion?.resources?.bindings || afterVersion?.bindings || [];
  const afterByName = new Map(after.map((binding) => [binding?.name, bindingContract(binding)]));
  const changed = before
    .map(bindingContract)
    .filter((contract) => JSON.stringify(afterByName.get(contract.name)) !== JSON.stringify(contract));
  if (changed.length) {
    throw new Error(`Nurture Engine release changed or dropped existing bindings: ${changed.map((binding) => binding.name).join(', ')}.`);
  }
}

export function assertRequiredBindings(version) {
  const bindings = version?.resources?.bindings || version?.bindings || [];
  const present = new Set(bindings.map((binding) => binding?.name).filter(Boolean));
  const missing = ['NURTURE_DB', 'CRM_DB', 'PORTAL_KV', 'WORKER_AUTH_SECRET', 'GHL_WEBHOOK_SECRET']
    .filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Nurture Engine release is missing required bindings: ${missing.join(', ')}.`);
}

export function localProvenance() {
  const dirty = runGit(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  if (dirty) throw new Error('Nurture Engine release refused: the Git worktree is not clean.');
  const revision = runGit(['rev-parse', 'HEAD']).trim();
  const remoteMain = runGit(['rev-parse', 'origin/main']).trim();
  if (revision !== remoteMain) {
    throw new Error(`Nurture Engine release refused: HEAD ${revision} is not exact origin/main ${remoteMain}.`);
  }
  return provenanceForRevision({ revision, archive: sourceArchiveForRevision(revision) });
}

function parseVersionId(output) {
  const match = output.match(/(?:Current )?Version ID:\s*([0-9a-f-]{36})/i);
  if (!match) throw new Error('Nurture Engine uploaded but Wrangler did not return a version ID.');
  return match[1];
}

async function cloudflare(path) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) throw new Error('Nurture Engine release requires the exact Cloudflare account and deploy credential.');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(`Cloudflare Nurture Engine readback failed at ${path} (${response.status}).`);
  return payload.result;
}

async function activeVersion() {
  const result = await cloudflare('/workers/scripts/nurture-engine/deployments');
  const deployments = Array.isArray(result) ? result : result?.deployments || result?.items || [];
  const active = deployments.find((deployment) => deployment?.versions?.some((version) => Number(version.percentage) === 100));
  const versionId = active?.versions?.find((version) => Number(version.percentage) === 100)?.version_id;
  if (!versionId) throw new Error('Nurture Engine release could not resolve the exact active version.');
  return cloudflare(`/workers/scripts/nurture-engine/versions/${versionId}`);
}

async function deploy(provenance) {
  const beforeVersion = await activeVersion();
  const result = spawnSync('npx', [
    '--yes', 'wrangler@4.125.0', 'deploy', '--keep-vars', '--strict',
    '--tag', provenance.tag, '--message', provenance.message,
  ], {
    cwd: fileURLToPath(WORKER_ROOT),
    encoding: 'utf8',
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: 'pipe',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error('Nurture Engine release did not deploy.');

  const versionId = parseVersionId(`${result.stdout || ''}\n${result.stderr || ''}`);
  const detail = await cloudflare(`/workers/scripts/nurture-engine/versions/${versionId}`);
  assertVersionProvenance(detail, provenance);
  assertRequiredBindings(detail);
  assertBindingsPreserved(beforeVersion, detail);
  process.stdout.write(`Nurture Engine release verified: ${versionId} ${provenance.message}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const release = args.includes('--deploy');
  const provenance = localProvenance();
  const approval = args[args.indexOf('--approved-revision') + 1];
  if (!release) {
    process.stdout.write(`Nurture Engine release preflight passed: ${provenance.message}\n`);
    process.stdout.write('No deployment attempted. Use --deploy --approved-revision <full Git SHA> after review.\n');
    return;
  }
  if (approval !== provenance.revision) {
    throw new Error(`Nurture Engine release refused: --approved-revision must equal ${provenance.revision}.`);
  }
  await deploy(provenance);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
