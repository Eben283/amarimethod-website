#!/usr/bin/env node
// Resize oversized images flagged by PSI mobile audit (2026-05-17)
// Targets ~274 KiB savings on amarimethod.com homepage
// All sizes use 2x retina density max relative to displayed dimensions

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, '..', 'images');

const RESIZE_PLAN = [
  // Big hero images — Garrett portraits
  { file: 'Dr-Garrett-Headshot-2.avif', maxWidth: 640, maxHeight: 960, format: 'avif', quality: 60 },
  { file: 'dr-garrett-hewstan-amari-method-session.avif', maxWidth: 800, format: 'avif', quality: 60 },

  // Logo — displayed at 100x40 max, sometimes 34px tall
  { file: 'AmariLogo.avif', maxWidth: 200, format: 'avif', quality: 70 },

  // Testimonial marquee — displayed at 64-120 px wide
  { file: 'terri-testimonial.avif', maxWidth: 200, format: 'avif', quality: 60 },
  { file: 'nina-testimonial.avif', maxWidth: 200, format: 'avif', quality: 60 },
  { file: 'Maria.webp', maxWidth: 200, format: 'webp', quality: 75 },
  { file: 'gregg-testimonial.webp', maxWidth: 200, format: 'webp', quality: 75 },
  { file: 'amy-testimonial.webp', maxWidth: 200, format: 'webp', quality: 75 },
  { file: 'danielle-testimonial.avif', maxWidth: 200, format: 'avif', quality: 60 },
  { file: 'kate-testimonial.avif', maxWidth: 240, format: 'avif', quality: 60 },
  { file: 'samantha-testimonial.avif', maxWidth: 200, format: 'avif', quality: 60 },
  { file: 'tyler-testimonial.avif', maxWidth: 200, format: 'avif', quality: 60 },
  { file: 'Sarah.webp', maxWidth: 200, format: 'webp', quality: 75 },
  { file: 'Justin.webp', maxWidth: 200, format: 'webp', quality: 75 },
  { file: 'dan-testimonial.webp', maxWidth: 200, format: 'webp', quality: 75 },
];

let totalBefore = 0;
let totalAfter = 0;
const results = [];

for (const item of RESIZE_PLAN) {
  const filePath = path.join(IMAGES_DIR, item.file);
  let beforeBytes;
  try {
    beforeBytes = (await fs.stat(filePath)).size;
  } catch (err) {
    console.error(`SKIP (missing): ${item.file}`);
    continue;
  }

  const meta = await sharp(filePath).metadata();
  const resizeOpts = { withoutEnlargement: true };
  if (item.maxWidth) resizeOpts.width = item.maxWidth;
  if (item.maxHeight) resizeOpts.height = item.maxHeight;
  resizeOpts.fit = 'inside';

  let pipeline = sharp(filePath).resize(resizeOpts);
  if (item.format === 'avif') pipeline = pipeline.avif({ quality: item.quality, effort: 6 });
  else if (item.format === 'webp') pipeline = pipeline.webp({ quality: item.quality, effort: 6 });

  const tmpPath = filePath + '.tmp';
  await pipeline.toFile(tmpPath);
  const afterBytes = (await fs.stat(tmpPath)).size;

  if (afterBytes >= beforeBytes) {
    await fs.unlink(tmpPath);
    results.push({ file: item.file, beforeBytes, afterBytes: beforeBytes, skipped: 'no gain' });
    totalBefore += beforeBytes;
    totalAfter += beforeBytes;
    continue;
  }

  await fs.rename(tmpPath, filePath);
  const newMeta = await sharp(filePath).metadata();
  results.push({
    file: item.file,
    beforeBytes,
    afterBytes,
    beforeDims: `${meta.width}x${meta.height}`,
    afterDims: `${newMeta.width}x${newMeta.height}`,
  });
  totalBefore += beforeBytes;
  totalAfter += afterBytes;
}

console.log('\nResize report:');
console.log('='.repeat(90));
for (const r of results) {
  const pct = r.skipped ? r.skipped : `-${Math.round((1 - r.afterBytes / r.beforeBytes) * 100)}%`;
  const dims = r.skipped ? '' : `(${r.beforeDims} → ${r.afterDims})`;
  console.log(`${r.file.padEnd(45)} ${(r.beforeBytes / 1024).toFixed(1).padStart(7)} → ${(r.afterBytes / 1024).toFixed(1).padStart(7)} KiB  ${pct.padStart(7)}  ${dims}`);
}
console.log('='.repeat(90));
console.log(`TOTAL: ${(totalBefore / 1024).toFixed(1)} → ${(totalAfter / 1024).toFixed(1)} KiB  (saved ${((totalBefore - totalAfter) / 1024).toFixed(1)} KiB / ${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
