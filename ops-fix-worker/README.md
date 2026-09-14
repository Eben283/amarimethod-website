# ops-fixer worker

Amari Ops **Fix layer** — every 15 minutes, scan board attention and launch a **bounded Cursor cloud agent** (change surface + blast radius) so code issues can get a draft PR without Eben watching.

| Mode (`OPS_FIX_MODE`) | Behavior |
|-----------------------|----------|
| `off` | No-op |
| `shadow` (default) | Writes would-launch jobs to KV; no Cursor API calls |
| `auto` | Launches agents via `CURSOR_API_KEY` |

## Deploy

Use the protected GitHub **deploy protected Worker** workflow and select
`ops-fixer`. It releases only current `main`, preserves the existing secret and
binding contract, and serializes with every other `ops-fixer` release. Runtime
mode or secret changes are separate reviewed operations.

## Manual sweep

```bash
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://ops-fixer.<account>.workers.dev/run'
```

## Board UX

- `/ops` shows fix job status on fixable rows
- **Request fix** queues `ops:fix:request:{pathId}` for the next sweep
- Jobs live at `ops:fix:job:{pathId}` with agent URL when launched
