import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const WORKER_PATH = 'crm-mirror-worker';
export const CHILD_PROCESS_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: fileURLToPath(REPOSITORY_ROOT),
    encoding: options.encoding || 'utf8',
    maxBuffer: CHILD_PROCESS_MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function sourceArchiveForRevision(revision) {
  return runGit(['archive', '--format=tar', revision, WORKER_PATH], { encoding: 'buffer' });
}

export function provenanceForRevision({ revision, archive }) {
  const artifactDigest = createHash('sha256').update(archive).digest('hex');
  const message = `git_sha=${revision};artifact_sha256=${artifactDigest}`;
  return {
    artifactDigest,
    message,
    revision,
    tag: `git-${revision}`,
  };
}

export function assertVersionProvenance(version, provenance) {
  const serialized = JSON.stringify(version);
  if (!serialized.includes(provenance.revision) || !serialized.includes(provenance.artifactDigest)) {
    throw new Error(`Cloudflare version record is missing the approved provenance (${provenance.message}).`);
  }
}

export function localProvenance() {
  const dirty = runGit(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  if (dirty) throw new Error('CRM Mirror release refused: the Git worktree is not clean.');

  const revision = runGit(['rev-parse', 'HEAD']).trim();
  const remoteMain = runGit(['rev-parse', 'origin/main']).trim();
  if (revision !== remoteMain) {
    throw new Error(`CRM Mirror release refused: HEAD ${revision} is not the exact origin/main revision ${remoteMain}.`);
  }

  return provenanceForRevision({ revision, archive: sourceArchiveForRevision(revision) });
}

function parseVersionId(output) {
  const match = output.match(/(?:Current )?Version ID:\s*([0-9a-f-]{36})/i);
  if (!match) throw new Error('CRM Mirror release uploaded but Wrangler did not return a version ID for provenance verification.');
  return match[1];
}

function deploy(provenance) {
  const result = spawnSync('npx', [
    'wrangler', 'deploy', '--keep-vars', '--strict',
    '--tag', provenance.tag,
    '--message', provenance.message,
  ], {
    cwd: fileURLToPath(new URL('../crm-mirror-worker/', import.meta.url)),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error('CRM Mirror release did not deploy.');

  const versionId = parseVersionId(`${result.stdout || ''}\n${result.stderr || ''}`);
  const detail = JSON.parse(execFileSync('npx', ['wrangler', 'versions', 'view', versionId, '--json'], {
    cwd: fileURLToPath(new URL('../crm-mirror-worker/', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  assertVersionProvenance(detail, provenance);
  process.stdout.write(`CRM Mirror release verified: ${versionId} ${provenance.message}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const release = args.includes('--deploy');
  const provenance = localProvenance();
  const approval = args[args.indexOf('--approved-revision') + 1];

  if (!release) {
    process.stdout.write(`CRM Mirror release preflight passed: ${provenance.message}\n`);
    process.stdout.write('No deployment was attempted. Use --deploy --approved-revision <full Git SHA> only after review.\n');
    return;
  }
  if (approval !== provenance.revision) {
    throw new Error(`CRM Mirror release refused: --approved-revision must equal ${provenance.revision}.`);
  }
  deploy(provenance);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
