import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publishDir = path.join(root, 'dist');
const textExtensions = new Set(['.html', '.css', '.js']);
const assetExtension = /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|otf|mp4|webm|pdf|zip|json)$/i;
const references = new Map();

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file);
    return textExtensions.has(path.extname(entry.name)) ? [file] : [];
  });
}

function addReference(rawUrl, sourceFile) {
  const cleanUrl = rawUrl.trim().replace(/^['"]|['"]$/g, '').split(/[?#]/, 1)[0];
  if (!cleanUrl.startsWith('/') || cleanUrl.startsWith('//') || !assetExtension.test(cleanUrl)) return;

  const target = path.resolve(publishDir, `.${cleanUrl}`);
  if (!target.startsWith(`${publishDir}${path.sep}`) || fs.existsSync(target)) return;

  const relativeSource = path.relative(root, sourceFile);
  if (!references.has(cleanUrl)) references.set(cleanUrl, new Set());
  references.get(cleanUrl).add(relativeSource);
}

for (const sourceFile of walk(publishDir)) {
  const content = fs.readFileSync(sourceFile, 'utf8');
  for (const match of content.matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1|\bsrcset\s*=\s*(["'])(.*?)\3|url\(\s*(["']?)(.*?)\5\s*\)/gsi)) {
    const value = match[2] ?? match[4] ?? match[6] ?? '';
    for (const candidate of value.split(',')) addReference(candidate.trim().split(/\s+/, 1)[0], sourceFile);
  }
}

if (references.size) {
  console.error('Published asset integrity check failed. The following files are referenced by dist but absent from dist:');
  for (const [asset, sourceFiles] of [...references.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`- ${asset} (referenced by ${[...sourceFiles].sort().join(', ')})`);
  }
  process.exit(1);
}

console.log('Published asset integrity check passed.');
