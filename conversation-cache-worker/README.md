# conversation-cache-worker

Cloud, incremental cache of GHL conversation history. Cleanup #1 of the outreach
system (target architecture: `ops/drafts/coach-architecture-target-2026-06-14.md`).

**Why:** `outreach-cadence.mjs` re-pulled a full 60 days of conversations from GHL
every single morning. This worker pulls once, then only what changed — so
downstream consumers (the coach's cadence step, learning) read the cache instead.

**Proven (2026-06-14):** first run backfilled 90 days = 264 conversations → 244
contacts cached in 33s. Immediate second run = 0 changed, 0.4s.

## How it works
- `conversations/search?sortBy=last_message_date&sort=desc`, stop as soon as a
  conversation predates the high-water mark (`conv:sync:lastRun`, minus a 30-min
  overlap). First run backfills 90 days.
- For each changed conversation, fetch messages (5-wide), extract touches
  (`{ts, kind, dir}` — same message-type codes as `outreach-cadence.mjs`), merge
  into the per-contact cache, trim to 90 days.

## KV (PORTAL_KV `79cff30d0e45419791b0d25cd81961df`)
- `conv:{contactId}` → `{ contactId, name, lastMessageDate, touches:[{ts,kind,dir}] }`
- `conv:index` → `{ [contactId]: lastMessageDate }` (roster)
- `conv:sync:lastRun` → high-water mark (ms)
- `ops:conversation-cache:lastRun` → run summary

## Routes (Bearer `WORKER_AUTH_SECRET`)
`/sync` (run now, awaited), `/status`, `/conversations?contactId=`, `/index`.
Cron: every 3 hours.

## Deploy
`cd conversation-cache-worker && npx wrangler deploy`
Secrets (from Keychain): `GHL_CLIENT_ID` (am-ghl-client-id), `GHL_CLIENT_SECRET`
(am-ghl-client-secret), `WORKER_AUTH_SECRET` (am-worker-auth-secret).

## Not done yet (next: cleanup #1b)
Nothing reads the cache yet. Next step rewires the coach's cadence so it reads
`conv:*` instead of pulling GHL — that's what actually removes the daily 60-day
pull from the coach pipeline.
