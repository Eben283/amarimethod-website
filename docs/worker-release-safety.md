# Worker release safety

Every production Worker release uses `.github/workflows/deploy-worker.yml`. The workflow accepts one of the 15 configured Workers and runs through `scripts/worker-release.mjs`.

The release gate enforces these conditions:

1. The source is a clean checkout of the exact current `origin/main` commit.
2. The candidate records the Git commit, Git tree, and Worker name.
3. Wrangler uploads an inactive candidate with `--keep-vars` and `--strict`.
4. The candidate must retain every binding from the active version, including its type and resource identity.
5. The active version is read again before promotion. A concurrent change to the same Worker stops the release.
6. Only the verified candidate receives 100 percent of traffic.
7. The active version and bindings are read back after promotion.

GitHub Actions serializes releases for the same Worker. Separate Workers can release at the same time because their source and runtime configuration are verified independently.

Repository checks reject executable raw Worker deploys, version uploads, version promotions, Pages deploys, and secret mutations outside the gate. Production activation is also refused outside GitHub Actions. Scheduled triggers and routes are not changed by this release path.

This gate preserves the bindings that exist when a release begins. It does not reconstruct configuration that was already lost. Restoring any previously missing binding requires a separate inventory, review, and controlled recovery.

Cloudflare Pages continues to deploy from its Git integration. Direct Pages deployments from repository scripts or workflows are prohibited.
