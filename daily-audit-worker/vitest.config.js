import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Standalone config so these tests don't load the project-root vite.config.ts
// (its lovable-tagger import breaks vitest). Mirrors series-reconcile-worker/
// vitest.config.js + functions/api/vitest.config.js.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: { environment: 'node' },
});
