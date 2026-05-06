#!/usr/bin/env node
/**
 * Step 3 of the migration. Run AFTER the player + token endpoint are deployed
 * and you've verified signed-URL playback works in the live portal.
 *
 * Flips `requireSignedURLs: true` on every uploaded Stream video. Once this
 * runs, the public Stream manifest URLs stop serving content — only signed
 * tokens minted by the /api/stream-token endpoint work. This closes the
 * piracy hole.
 *
 * Idempotent. Safe to re-run.
 *
 * Run:
 *   CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/migrate-course-to-stream/lockdown.mjs
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPPING_PATH = resolve(__dirname, 'mapping.json');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Missing CF_ACCOUNT_ID or CF_API_TOKEN env var.');
  process.exit(1);
}

const STREAM_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream`;

async function lockdown(uid, name) {
  const res = await fetch(`${STREAM_API}/${uid}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requireSignedURLs: true }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Lockdown failed for ${uid} (${name}): ${msg}`);
  }
}

async function main() {
  const mapping = JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
  const entries = Object.values(mapping);
  console.log(`Locking down ${entries.length} videos (setting requireSignedURLs=true)...\n`);

  let done = 0;
  for (const entry of entries) {
    process.stdout.write(`  [${++done}/${entries.length}] ${entry.streamUid}  ${entry.title} ... `);
    await lockdown(entry.streamUid, entry.title);
    process.stdout.write('locked\n');
  }

  console.log('\nDone. Public manifest URLs no longer serve content. Only signed tokens work.');
  console.log('If portal playback breaks, the most likely cause is the Pages Function env vars');
  console.log('(CF_STREAM_ACCOUNT_ID, CF_STREAM_TOKEN, CF_STREAM_CUSTOMER_CODE) not being set.');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
