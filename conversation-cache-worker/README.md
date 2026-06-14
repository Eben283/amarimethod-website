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

It also **derives the coach due-list** off the cache each run (`src/cadence.js`,
the cloud port of `outreach-cadence.mjs` + `coach-build.mjs`): collapse touches →
per-contact state + "is a touch due today" + the booked/drip-only excludes →
`coach:due:latest`. Proven 2026-06-14: matches the local pipeline (137 due, same
states) but in 3.3s off the cache vs a 2-3 min GHL pull.

## KV (PORTAL_KV `79cff30d0e45419791b0d25cd81961df`)
- `conv:{contactId}` → `{ contactId, name, lastMessageDate, touches:[{ts,kind,dir}] }`
- `conv:index` → `{ [contactId]: lastMessageDate }` (roster)
- `conv:sync:lastRun` → high-water mark (ms)
- `ops:conversation-cache:lastRun` → sync run summary
- `coach:due:latest` → derived due-list (same shape as local coach-due.json)
- `ops:coach-cadence:lastRun` → derive run summary

## Routes (Bearer `WORKER_AUTH_SECRET`)
`/sync` (sync + derive, awaited), `/cadence` (re-derive off cache, no GHL conv
pull), `/due` (read the derived list), `/status`, `/conversations?contactId=`,
`/index`. Cron every 3 hours runs sync → derive.

## Deploy
`cd conversation-cache-worker && npx wrangler deploy`
Secrets (from Keychain): `GHL_CLIENT_ID` (am-ghl-client-id), `GHL_CLIENT_SECRET`
(am-ghl-client-secret), `WORKER_AUTH_SECRET` (am-worker-auth-secret).

## Not done yet
The cloud now produces `coach:due:latest`, but the LOCAL `coach-daily.sh` still
runs its own `outreach-cadence` + `coach-build` at 7am. The final step — pointing
the local pipeline at `coach:due:latest` (and turning off the local cadence/build)
— is a SHARED-FILE edit (`coach-daily.sh`, `ops/scripts/coach/`) held for
coordination with the Sharpen session. Card generation + learning moving to cloud
are also coupled to that same cutover (they'd otherwise double-write `coach:{id}`
and `coach:learning:summary`).
