# ops-fixer worker

Amari Ops **Fix layer** — every 15 minutes, scan board attention and launch a **bounded Cursor cloud agent** (change surface + blast radius) so code issues can get a draft PR without Eben watching.

| Mode (`OPS_FIX_MODE`) | Behavior |
|-----------------------|----------|
| `off` | No-op |
| `shadow` (default) | Writes would-launch jobs to KV; no Cursor API calls |
| `auto` | Launches agents via `CURSOR_API_KEY` |

## Deploy

```bash
cd ops-fix-worker
# Cursor API key (Dashboard → API Keys)
printenv CURSOR_API_KEY | npx wrangler secret put CURSOR_API_KEY
printenv WORKER_AUTH_SECRET | npx wrangler secret put WORKER_AUTH_SECRET

npx wrangler deploy
# When ready to actually launch agents:
npx wrangler vars set OPS_FIX_MODE=auto
# or edit wrangler.toml and redeploy
```

## Manual sweep

```bash
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://ops-fixer.<account>.workers.dev/run'
```

## Board UX

- `/ops` shows fix job status on fixable rows
- **Request fix** queues `ops:fix:request:{pathId}` for the next sweep
- Jobs live at `ops:fix:job:{pathId}` with agent URL when launched
