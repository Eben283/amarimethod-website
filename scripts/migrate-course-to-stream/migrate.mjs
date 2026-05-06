#!/usr/bin/env node
/**
 * Living Practice course-video migration: local files → Cloudflare Stream.
 *
 * Reads course-data.ts to get the module/lesson structure, walks the local
 * "amari/Course Videos/" tree, pairs folders↔modules and files↔lessons by
 * index (file ordering within each folder mirrors lesson ordering in
 * course-data.ts), uploads each MP4 to Stream via multipart POST, and writes
 * the mapping to mapping.json (resumable on rerun).
 *
 * After all uploads complete, polls Stream until each video has finished
 * encoding (state=ready), then emits course-data.new.ts with `streamUid`
 * replacing `videoUrl` per lesson.
 *
 * Env:
 *   CF_ACCOUNT_ID   Cloudflare account ID
 *   CF_API_TOKEN    API token w/ Account → Stream → Edit
 *   COURSE_VIDEOS   Path to "amari/Course Videos/" (default: ../../../amari/Course Videos)
 *
 * Run:
 *   CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/migrate-course-to-stream/migrate.mjs
 *
 * Idempotent: rerun safely. Already-uploaded videos (keyed by filesafeId) are skipped.
 */

import { readFile, writeFile, access, stat, readdir, open } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const COURSE_DATA_PATH = resolve(REPO_ROOT, 'portal/src/data/course-data.ts');
const DEFAULT_VIDEOS_DIR = resolve(REPO_ROOT, '..', '..', 'amari', 'Course Videos');
const VIDEOS_DIR = process.env.COURSE_VIDEOS || DEFAULT_VIDEOS_DIR;
const MAPPING_PATH = resolve(__dirname, 'mapping.json');
const NEW_COURSE_DATA_PATH = resolve(__dirname, 'course-data.new.ts');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const CONCURRENCY = 3;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 60 * 60_000;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Missing CF_ACCOUNT_ID or CF_API_TOKEN env var.');
  process.exit(1);
}

const STREAM_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function loadMapping() {
  if (!(await fileExists(MAPPING_PATH))) return {};
  return JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
}

async function saveMapping(mapping) {
  await writeFile(MAPPING_PATH, JSON.stringify(mapping, null, 2) + '\n');
}

/**
 * Parse course-data.ts and extract modules in declaration order.
 * Returns: [{ slug, lessons: [{ slug, title, filesafeId }] }]
 */
async function parseCourseData() {
  const src = await readFile(COURSE_DATA_PATH, 'utf8');

  const modules = [];
  let currentModule = null;
  const lines = src.split('\n');

  for (const line of lines) {
    // Module slug appears at indent 4: `    slug: 'foo',`
    const moduleSlug = line.match(/^ {4}slug:\s*['"]([^'"]+)['"]/);
    if (moduleSlug) {
      currentModule = { slug: moduleSlug[1], lessons: [] };
      modules.push(currentModule);
      continue;
    }

    // Lesson line: `      { slug: '...', title: '...', videoUrl: \`${CDN}/HEX.mp4\` ... }`
    const lessonMatch = line.match(
      /\{\s*slug:\s*['"]([^'"]+)['"]\s*,\s*title:\s*['"]([^'"]+)['"]\s*,\s*videoUrl:\s*`\$\{CDN\}\/([a-f0-9]+)\.mp4`/
    );
    if (lessonMatch && currentModule) {
      currentModule.lessons.push({
        slug: lessonMatch[1],
        title: lessonMatch[2],
        filesafeId: lessonMatch[3],
      });
    }
  }

  return modules;
}

/**
 * Walk VIDEOS_DIR. Returns folders in alphanumeric order, each with its MP4
 * files in alphanumeric order. Skips non-MP4 files.
 */
async function walkVideosDir() {
  const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  const result = [];
  for (const folder of folders) {
    const folderPath = resolve(VIDEOS_DIR, folder);
    const files = (await readdir(folderPath))
      .filter((f) => f.toLowerCase().endsWith('.mp4'))
      .sort();
    result.push({
      folder,
      folderPath,
      files: files.map((f) => ({ name: f, path: resolve(folderPath, f) })),
    });
  }
  return result;
}

/**
 * Pair modules ↔ folders and lessons ↔ files by index. Validates that
 * folder count matches module count and that each folder's file count
 * matches the corresponding module's lesson count.
 */
function buildPairings(modules, folders) {
  if (modules.length !== folders.length) {
    throw new Error(
      `Module/folder count mismatch: ${modules.length} modules in course-data.ts vs ${folders.length} folders in ${VIDEOS_DIR}`
    );
  }

  const pairings = [];
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const folder = folders[i];
    if (mod.lessons.length !== folder.files.length) {
      throw new Error(
        `Lesson count mismatch in module #${i + 1}: ` +
        `module "${mod.slug}" has ${mod.lessons.length} lessons but folder "${folder.folder}" has ${folder.files.length} files`
      );
    }
    for (let j = 0; j < mod.lessons.length; j++) {
      pairings.push({
        moduleSlug: mod.slug,
        lessonSlug: mod.lessons[j].slug,
        title: mod.lessons[j].title,
        filesafeId: mod.lessons[j].filesafeId,
        localPath: folder.files[j].path,
        localName: folder.files[j].name,
      });
    }
  }
  return pairings;
}

async function streamUpload(localPath, displayName) {
  const fileBuffer = await readFile(localPath);
  const fileName = basename(localPath);
  const fileSize = fileBuffer.length;

  const fd = new FormData();
  fd.append('file', new File([fileBuffer], fileName, { type: 'video/mp4' }));

  // Stream wants metadata as a stringified JSON in the `meta` field
  fd.append('meta', JSON.stringify({ name: displayName }));

  const res = await fetch(STREAM_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: fd,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Stream upload failed for ${localPath}: ${msg}`);
  }
  return { uid: json.result.uid, sizeBytes: fileSize };
}

async function streamGet(uid) {
  const res = await fetch(`${STREAM_API}/${uid}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`Stream GET ${uid} failed: HTTP ${res.status}`);
  }
  return json.result;
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function uploadAll(pairings, mapping) {
  const todo = pairings.filter((p) => !mapping[p.filesafeId]);
  if (todo.length === 0) {
    console.log('All videos already uploaded. Skipping upload phase.');
    return;
  }

  console.log(`Uploading ${todo.length} of ${pairings.length} videos to Stream (concurrency=${CONCURRENCY})...\n`);

  let totalBytes = 0;
  for (const p of todo) {
    const s = await stat(p.localPath);
    totalBytes += s.size;
  }
  console.log(`Total to upload: ${fmtMB(totalBytes)}\n`);

  const uploadedBytes = { current: 0 };

  const results = await runWithConcurrency(todo, CONCURRENCY, async (p, i) => {
    const displayName = `${p.moduleSlug}/${p.lessonSlug} — ${p.title}`;
    const startedAt = Date.now();
    process.stdout.write(`  [${i + 1}/${todo.length}] uploading ${p.localName} ... `);

    const { uid, sizeBytes } = await streamUpload(p.localPath, displayName);

    mapping[p.filesafeId] = {
      streamUid: uid,
      title: p.title,
      lessonSlug: p.lessonSlug,
      moduleSlug: p.moduleSlug,
      localFile: p.localName,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
    };
    await saveMapping(mapping);

    uploadedBytes.current += sizeBytes;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    process.stdout.write(`uid=${uid} (${fmtMB(sizeBytes)}, ${elapsed}s)\n`);
    return uid;
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} uploads failed:`);
    for (const r of failed) console.error(`  ${r.error.message}`);
    throw new Error('Upload phase had failures — fix and rerun.');
  }
}

async function waitForReady(mapping) {
  const uids = Object.values(mapping).map((m) => m.streamUid);
  console.log(`\nWaiting for ${uids.length} videos to finish encoding...`);

  const start = Date.now();
  const pending = new Set(uids);

  while (pending.size > 0) {
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(`Timeout: ${pending.size} videos still encoding after 60 min`);
    }

    const checks = await runWithConcurrency([...pending], CONCURRENCY, async (uid) => {
      const v = await streamGet(uid);
      return { uid, state: v.status?.state, errorReason: v.status?.errorReasonText };
    });

    for (const r of checks) {
      if (!r.ok) continue;
      const { uid, state, errorReason } = r.value;
      if (state === 'ready') {
        pending.delete(uid);
      } else if (state === 'error') {
        console.error(`  ${uid} encoding ERROR: ${errorReason}`);
        pending.delete(uid);
      }
    }

    if (pending.size > 0) {
      console.log(`  ${uids.length - pending.size}/${uids.length} ready, waiting ${POLL_INTERVAL_MS / 1000}s...`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  console.log('All videos ready.');
}

async function generateNewCourseData(mapping) {
  const src = await readFile(COURSE_DATA_PATH, 'utf8');

  let out = src.replace(
    /\/\/ CDN base for all course videos hosted in GHL Media Storage\nconst CDN = '[^']+';\n\n?/,
    ''
  );

  out = out.replace(
    /videoUrl:\s*`\$\{CDN\}\/([a-f0-9]+)\.mp4`/g,
    (match, filesafeId) => {
      const entry = mapping[filesafeId];
      if (!entry) {
        throw new Error(`No mapping for filesafe ID ${filesafeId} — rerun upload phase`);
      }
      return `streamUid: '${entry.streamUid}'`;
    }
  );

  await writeFile(NEW_COURSE_DATA_PATH, out);
  console.log(`\nGenerated ${NEW_COURSE_DATA_PATH}`);
  console.log('Review it, then:');
  console.log(`  cp ${NEW_COURSE_DATA_PATH} ${COURSE_DATA_PATH}`);
  console.log('Also update Lesson type: rename videoUrl → streamUid in portal/src/types/course.ts');
}

async function main() {
  console.log(`Course data: ${COURSE_DATA_PATH}`);
  console.log(`Local videos: ${VIDEOS_DIR}\n`);

  const modules = await parseCourseData();
  console.log(`Parsed ${modules.length} modules / ${modules.reduce((a, m) => a + m.lessons.length, 0)} lessons`);

  const folders = await walkVideosDir();
  console.log(`Found ${folders.length} folders / ${folders.reduce((a, f) => a + f.files.length, 0)} MP4s`);

  const pairings = buildPairings(modules, folders);
  console.log(`Paired ${pairings.length} lessons ↔ files\n`);

  // Print pairings for review on first run
  const mapping = await loadMapping();
  if (Object.keys(mapping).length === 0) {
    console.log('First run — pairings preview (first 5):');
    for (const p of pairings.slice(0, 5)) {
      console.log(`  ${p.moduleSlug}/${p.lessonSlug}  ←  ${p.localName}`);
    }
    console.log('');
  }

  await uploadAll(pairings, mapping);
  await waitForReady(mapping);
  await generateNewCourseData(mapping);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
