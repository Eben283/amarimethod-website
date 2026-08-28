// Read-only source preparation. There is deliberately no deployment or provisioning path.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REMOTE = 'https://github.com/Eben283/amarimethod-website.git';
const PREFIX = 'follow-up-rehearsal-worker';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const EXTERNALS = ['cloudflare:workers', 'node:crypto'];
const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, null, 2) + '\n';
const fail = reason => { throw new Error(`Rehearsal preparation refused: ${reason}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const REHEARSAL_RELEASE_TARGETS = Object.freeze({
  accountId: 'fa2b6f2441129b259dd5dea74045721b',
  control: 'amari-followup-capture-control-rehearsal',
  issuer: 'amari-followup-admission-issuer-rehearsal',
  bucket: 'amari-followup-evidence-rehearsal',
});

function expectedConfig(role) {
  const common = {
    name: REHEARSAL_RELEASE_TARGETS[role],
    main: `src/${role}.mjs`,
    account_id: REHEARSAL_RELEASE_TARGETS.accountId,
    compatibility_date: '2026-08-27',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    routes: [],
    observability: { enabled: false },
    limits: { cpu_ms: 1000, subrequests: 64 },
    send_metrics: false,
    keep_vars: false,
  };
  if (role === 'control') Object.assign(common, {
    durable_objects: { bindings: [{ name: 'REGISTRY', class_name: 'FollowUpRehearsalRegistryV1' }] },
    migrations: [{ tag: 'rehearsal-v1', new_sqlite_classes: ['FollowUpRehearsalRegistryV1'] }],
    r2_buckets: [{ binding: 'CAPTURE_BUCKET', bucket_name: REHEARSAL_RELEASE_TARGETS.bucket, jurisdiction: 'us' }],
    services: [{ binding: 'ISSUER', service: REHEARSAL_RELEASE_TARGETS.issuer, entrypoint: 'FollowUpRehearsalIssuer' }],
  });
  return common;
}

function sameShape(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => sameShape(v, expected[i]));
  if (plain(expected)) return plain(actual) && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([k, v]) => Object.hasOwn(actual, k) && sameShape(actual[k], v));
  return actual === expected;
}

export function validateRehearsalConfig(text, role) {
  if (!['control', 'issuer'].includes(role)) fail('unknown Worker role.');
  let config;
  try { config = JSON.parse(text); } catch { fail(`${role} configuration must be plain JSON.`); }
  // A single serialization rejects duplicate keys, comments, and ambiguous overrides.
  if (text !== canonical(config)) fail(`${role} configuration must use canonical two-space JSON with a final newline.`);
  if (!sameShape(config, expectedConfig(role))) fail(`${role} configuration differs from the exact private synthetic topology.`);
  return config;
}

function runGit(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'buffer', timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

function gitReader(repoRoot, supplied) {
  const invoke = supplied ?? (args => runGit(repoRoot, args));
  return { bytes: args => Buffer.from(invoke(args)), text: args => Buffer.from(invoke(args)).toString('utf8').trim() };
}

async function safeRead(repoRoot, file) {
  if (isAbsolute(file) || file.split('/').some(v => v === '..' || v === '' || v === '.')) fail('unsafe source path.');
  const absolute = resolve(repoRoot, file);
  if (await realpath(absolute) !== absolute) fail(`symlinked source is not permitted: ${file}`);
  if (!(await lstat(absolute)).isFile()) fail(`source is not a regular file: ${file}`);
  return readFile(absolute);
}

function inputPath(repoRoot, input) {
  const path = relative(repoRoot, resolve(repoRoot, input)).split(sep).join('/');
  if (!path.startsWith(`${PREFIX}/src/`) && !/^scripts\/lib\/[a-z0-9-]+\.mjs$/.test(path)) fail(`unreviewed transitive input: ${path}`);
  return path;
}

async function toolchain(repoRoot, lock) {
  const result = { node: process.version, platform: process.platform, architecture: process.arch };
  for (const name of ['esbuild', 'miniflare', 'workerd']) {
    const info = require(`${name}/package.json`);
    if (lock.packages?.[`node_modules/${name}`]?.version !== info.version) fail(`installed ${name} does not match package-lock.json.`);
    result[name] = info.version;
  }
  if (result.esbuild !== esbuildVersion) fail('loaded esbuild version differs from its package.');
  // Tool versions are recorded, not a claim that an installed binary is independently attested.
  return result;
}

export async function inspectRehearsalCandidate({ repoRoot = ROOT, git } = {}) {
  repoRoot = await realpath(repoRoot);
  const source = gitReader(repoRoot, git);
  const revision = source.text(['rev-parse', 'HEAD']);
  if (!SHA.test(revision)) fail('HEAD is not a full Git revision.');
  const dirty = source.text(['status', '--porcelain=v1', '--untracked-files=all']) !== '';
  const files = new Map();
  const pin = async path => {
    const bytes = await safeRead(repoRoot, path);
    const entry = { path, bytes: bytes.length, sha256: hash(bytes) };
    if (files.has(path) && files.get(path).sha256 !== entry.sha256) fail(`source changed during preparation: ${path}`);
    files.set(path, entry);
    return bytes;
  };
  for (const path of ['package.json', 'package-lock.json', 'scripts/follow-up-rehearsal-release.mjs', `${PREFIX}/README.md`]) await pin(path);
  const lock = JSON.parse((await pin('package-lock.json')).toString('utf8'));
  const tools = await toolchain(repoRoot, lock);
  const bundles = [];
  for (const role of ['control', 'issuer']) {
    const configPath = `${PREFIX}/wrangler.${role}.jsonc`;
    const config = validateRehearsalConfig((await pin(configPath)).toString('utf8'), role);
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [`${PREFIX}/${config.main}`],
      bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', target: 'es2022',
      external: EXTERNALS, logLevel: 'silent', sourcemap: false, minify: false,
      plugins: [{ name: 'pin-exact-source', setup(api) {
        api.onLoad({ filter: /./ }, async args => ({ contents: await pin(inputPath(repoRoot, args.path)), loader: 'js', resolveDir: dirname(args.path) }));
      } }],
    });
    if (result.warnings.length || result.outputFiles.length !== 1) fail(`${role} bundle has warnings or unexpected outputs.`);
    const inputs = Object.keys(result.metafile.inputs).map(path => inputPath(repoRoot, path)).sort();
    const outputs = Object.values(result.metafile.outputs);
    if (outputs.length !== 1 || outputs[0].imports.some(item => !item.external || !EXTERNALS.includes(item.path))) fail(`${role} bundle has unreviewed runtime imports.`);
    bundles.push({ role, entrypoint: `${PREFIX}/${config.main}`, bytes: result.outputFiles[0].contents.length, sha256: hash(result.outputFiles[0].contents), inputs, externalImports: outputs[0].imports.map(i => i.path).sort() });
  }
  const inventory = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const item of inventory) if (hash(await safeRead(repoRoot, item.path)) !== item.sha256) fail(`source changed during preparation: ${item.path}`);
  if (source.text(['rev-parse', 'HEAD']) !== revision || (source.text(['status', '--porcelain=v1', '--untracked-files=all']) !== '') !== dirty) fail('Git state changed during preparation.');
  const artifact = {
    version: 'follow-up-private-rehearsal-source.v1',
    revision,
    targets: REHEARSAL_RELEASE_TARGETS,
    tools,
    build: { bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', minify: false, sourcemap: false },
    files: inventory,
    bundles,
  };
  return { artifactDigest: hash(canonical(artifact)), artifact, dirty, sourceSelection: 'local-working-tree', freshMainVerified: false, deployableApproval: false, providerWrites: false };
}

export async function prepareRehearsalReview({ reviewedRevision, reviewedArtifact, repoRoot = ROOT, git } = {}) {
  if (!SHA.test(reviewedRevision ?? '') || !DIGEST.test(reviewedArtifact ?? '')) fail('explicit reviewed 40-hex revision and 64-hex artifact digest are required.');
  repoRoot = await realpath(repoRoot);
  const source = gitReader(repoRoot, git);
  const assertLocal = () => {
    if (source.text(['status', '--porcelain=v1', '--untracked-files=all'])) fail('worktree must be clean, including untracked files.');
    if (source.text(['remote', 'get-url', 'origin']) !== REMOTE) fail('origin is not the canonical repository.');
    if (source.text(['rev-parse', 'HEAD']) !== reviewedRevision || source.text(['rev-parse', 'origin/main']) !== reviewedRevision) fail('HEAD and origin/main must equal the exact reviewed revision.');
  };
  assertLocal();
  const candidate = await inspectRehearsalCandidate({ repoRoot, git });
  if (candidate.artifactDigest !== reviewedArtifact) fail('candidate artifact differs from the recorded reviewed digest.');
  for (const entry of candidate.artifact.files) {
    // Content must exist at the reviewed commit, not merely be hidden by skip-worktree.
    if (hash(source.bytes(['show', `${reviewedRevision}:${entry.path}`])) !== entry.sha256) fail(`working bytes differ from the reviewed commit: ${entry.path}`);
  }
  const remote = source.text(['ls-remote', '--exit-code', REMOTE, 'refs/heads/main']);
  if (remote !== `${reviewedRevision}\trefs/heads/main`) fail('fresh GitHub main is not the reviewed revision.');
  assertLocal();
  for (const entry of candidate.artifact.files) if (hash(await safeRead(repoRoot, entry.path)) !== entry.sha256) fail(`source changed after remote verification: ${entry.path}`);
  return { ...candidate, sourceSelection: 'exact-reviewed-main', freshMainVerified: true, checkedAt: new Date().toISOString(), nextGate: 'Independent source review, named-resource and secret-custody approval, bounded test/cleanup plan, then a separately implemented guarded release. This output grants no release authority.' };
}

export function parseRehearsalReleaseArgs(args) {
  if (!Array.isArray(args)) fail('arguments must be an array. No deployment command exists.');
  if (args.length === 1 && args[0] === 'inspect') return { mode: 'inspect' };
  if (args.length === 5 && args[0] === 'prepare' && args[1] === '--reviewed-revision' && SHA.test(args[2]) && args[3] === '--reviewed-artifact' && DIGEST.test(args[4])) return { mode: 'prepare', reviewedRevision: args[2], reviewedArtifact: args[4] };
  fail('usage: inspect | prepare --reviewed-revision <40hex> --reviewed-artifact <64hex>. No deployment command exists.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseRehearsalReleaseArgs(process.argv.slice(2));
    const result = options.mode === 'inspect' ? await inspectRehearsalCandidate() : await prepareRehearsalReview(options);
    process.stdout.write(canonical(result));
  } catch (error) {
    // Do not forward build/Git stderr: only sanitized errors from this module are printable.
    process.stderr.write(error.message?.startsWith('Rehearsal preparation refused:') ? `${error.message}\n` : 'Rehearsal preparation failed; no deployment or provisioning was attempted.\n');
    process.exitCode = 1;
  }
}
