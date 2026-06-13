# funnel-refresh-worker

Cloudflare Worker that regenerates the Amari staff **funnel snapshot** in the
cloud. This is the cloud replacement for the local
`~/.claude/ghl-mcp/funnel.mjs` script + the `com.amari.funnel-refresh` LaunchAgent
that currently produces the snapshot only on Eben's Mac.

It pulls live GHL event data (contacts, conversations + per-conversation messages,
gifted-session calendar events, payment transactions/invoices/orders), classifies
calls / cohorts / sales (valued in **sessions sold**), computes frozen monthly
targets, and writes the snapshot JSON to `PORTAL_KV`. The staff dashboard's Funnel
tab reads that snapshot via the `staff-funnel.js` Pages Function.

The compute logic in `src/funnel.js` is a faithful port of `funnel.mjs`; the
output JSON shape is byte-compatible (`v, generatedAt, windowDays, goal, calls,
sessions, sales, trailing90, targets, paceLine`).

## STAGED — currently writes the TEST key only

For the safe, staged rollout this worker writes the snapshot to
**`funnel:latest-test`**, NOT the live `funnel:latest` key the dashboard reads.
The cron trigger is commented out. Cutover is gated on review of the verification
diff (see below).

### Verification (2026-06-12)

Worker `funnel:latest-test` vs. local `/tmp/funnel-latest.json` (`node funnel.mjs 180`):

| Field | Result |
|-------|--------|
| top-level keys | identical |
| calls (count + array, order-insensitive) | EXACT MATCH (229) |
| sessions (count + array + showed) | EXACT MATCH (16, 6 showed) |
| sales (count + array + sessionsSold) | EXACT MATCH (44, 87 sold) |
| calls cohort / outcome breakdowns | EXACT MATCH |
| sessions / sales breakdowns | EXACT MATCH |
| trailing90 | EXACT MATCH (`calls 191, equivs 5.88, callsPerEquiv 33`) |
| paceLine | EXACT MATCH |
| calls-today | EXACT MATCH (12) |
| targets | numbers differ ONLY because of freeze timing (see note) |

The `targets` object differed (local `calls:246` vs worker `calls:260`) **only**
because targets are frozen per calendar month: the local run reused the value
frozen 2026-06-12 in `funnel-targets.json`, while the worker computed and froze
its own value for 2026-06 in KV (`funnel:targets`) on first run. Both are
`source:"measured"`, same goal. Once frozen, each side is deterministic for the
month.

## Architecture notes

- **One invocation, no chunking.** The full pull is ~400 GHL subrequests, which
  fits in a paid-tier Worker's 1000-subrequest budget. (The
  partner-activity-refresh worker chunks; this one does not need to.)
- **HTTP `/refresh` runs the pull INLINE (awaited), not in `ctx.waitUntil()`.**
  The pull is ~30-45s of wall time (almost all idle I/O; CPU <300ms).
  `ctx.waitUntil()` tasks are cancelled ~30s after the response returns, which
  killed the pull mid-flight. An awaited fetch handler gets the full request
  duration. The caller waits for the summary.
- Token + auth reuse the standard KV scheme (`ghl_access_token` in `PORTAL_KV`,
  refreshed via `GHL_CLIENT_ID`/`GHL_CLIENT_SECRET` secrets) — identical to
  daily-audit + partner-activity-refresh.

## Routes

- `POST /refresh` — run the pull inline, write `funnel:latest-test`, return summary.
- `GET  /status`  — last-run summary from `ops:funnel-refresh:lastRun`.

Both are gated by `WORKER_AUTH_SECRET` if set (rollout-safe: unset = open).

## Deploy

```bash
cd funnel-refresh-worker
npx wrangler deploy
```

URL: https://funnel-refresh.eben-fa2.workers.dev

### Secrets (set before enabling the cron / cutover)

```bash
echo "<same as ghl-token-refresh>" | npx wrangler secret put GHL_CLIENT_ID
echo "<same as ghl-token-refresh>" | npx wrangler secret put GHL_CLIENT_SECRET
echo "<openssl rand -hex 32>"      | npx wrangler secret put WORKER_AUTH_SECRET   # optional but recommended
```

(Not required for the staged verification run — the KV access token was fresh, so
no refresh was triggered. Required for unattended cron runs that may hit a
near-expiry token.)

## CUTOVER CHECKLIST (gated on Eben's review — DO NOT do automatically)

1. Flip the snapshot key in `src/index.js` from `funnel:latest-test` to
   `funnel:latest`. Redeploy.
2. Decide the cron: the account is at Cloudflare's free-tier cap of 5 cron
   triggers. Either retire one (e.g. stop relying on the local LaunchAgent and
   free a slot) or move to a paid plan, then uncomment `[triggers]` in
   `wrangler.toml` (`45 13 * * *` ≈ 6:45 AM PT to match the LaunchAgent).
3. Set the GHL_CLIENT_ID / GHL_CLIENT_SECRET secrets (above) so unattended runs
   can refresh a near-expiry token.
4. Wire the staff frontend: a "Refresh now" button → `POST /refresh` (with the
   `WORKER_AUTH_SECRET` bearer, proxied through a Pages Function like
   `staff-refresh-activity.js` does for the partner worker), then poll `/status`.
5. Optionally retire the local `com.amari.funnel-refresh` LaunchAgent once the
   cron is proven.

DO NOT delete `funnel.mjs`, the LaunchAgent, or `funnel-targets.json` until the
cloud path is proven over several days.
