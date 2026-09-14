import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const violations = [];
const mutation = String.raw`(?:deploy|pages\s+deploy|versions\s+(?:upload|deploy)|secret\s+(?:put|bulk|delete))`;

const packageFiles = [join(root, 'package.json')];
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
    packageFiles.push(join(root, entry.name, 'package.json'));
  }
}
for (const path of packageFiles) {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    for (const [name, command] of Object.entries(pkg.scripts || {})) {
      if (new RegExp(String.raw`\bwrangler(?:@\S+)?\s+${mutation}\b`).test(command)) {
        violations.push(`${relative(root, path)} scripts.${name}`);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const workflows = join(root, '.github', 'workflows');
for (const entry of readdirSync(workflows, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
  const text = readFileSync(join(workflows, entry.name), 'utf8');
  if (new RegExp(String.raw`\b(?:npx\s+)?wrangler(?:@\S+)?\s+${mutation}\b`).test(text)) {
    violations.push(`.github/workflows/${entry.name}`);
  }
}

function executableFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return executableFiles(path);
    return entry.isFile() && /\.(?:mjs|cjs|js|sh|zsh)$/.test(entry.name) ? [path] : [];
  });
}

for (const path of executableFiles(join(root, 'scripts'))) {
  const name = relative(join(root, 'scripts'), path);
  if (name === 'worker-release.mjs' || name.includes('.test.')) continue;
  const text = readFileSync(path, 'utf8');
  const rawShell = new RegExp(String.raw`(?:npx|pnpm|yarn)\s+wrangler(?:@\S+)?\s+${mutation}\b`);
  const rawSpawn = /(?:spawnSync|execFileSync)\([\s\S]{0,160}?['"]wrangler[^'"]*['"][\s\S]{0,240}?['"](?:deploy|versions|pages|secret)['"]/;
  if (rawShell.test(text) || rawSpawn.test(text)) {
    violations.push(`scripts/${name}`);
  }
}

if (violations.length) {
  process.stderr.write(`Unguarded Worker deployment paths are prohibited:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Worker release policy passed: no executable raw deployment path exists.\n');
}
