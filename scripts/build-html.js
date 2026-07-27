import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const INCLUDES = join(ROOT, '_includes');

// Read partial files
const partials = {};
for (const file of readdirSync(INCLUDES)) {
  const name = file.replace('.html', '');
  partials[name] = readFileSync(join(INCLUDES, file), 'utf-8');
}

// Get all HTML files in root (skip directories and special files)
const SKIP = ['google7e0df265968cd640.html'];
const htmlFiles = readdirSync(ROOT)
  .filter(f => f.endsWith('.html') && !SKIP.includes(f));

mkdirSync(DIST, { recursive: true });

let processed = 0;
for (const file of htmlFiles) {
  let content = readFileSync(join(ROOT, file), 'utf-8');
  let changed = false;

  for (const [name, partial] of Object.entries(partials)) {
    const marker = `<!-- include:${name} -->`;
    if (content.includes(marker)) {
      content = content.replace(marker, partial);
      changed = true;
    }
  }

  writeFileSync(join(DIST, file), content);
  if (changed) processed++;
}

// The homepage Assessment modal needs the native booking UI in an iframe.
// Keep this dedicated output outside the legacy /book/* redirect family while
// deriving it from the canonical booking-page source.
writeFileSync(
  join(DIST, 'assessment-booking.html'),
  readFileSync(join(ROOT, 'book', 'initial-in-person.html'), 'utf-8'),
);

console.log(`Processed ${processed} HTML files with includes (${htmlFiles.length} total copied to dist)`);
