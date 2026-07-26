import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Standalone root so these tests don't load the project-root vite config
// (its lovable-tagger import breaks vitest) — same pattern as series-reconcile-worker.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: { environment: "node" },
});
