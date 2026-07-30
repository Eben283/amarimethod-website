# morning-sms worker (Twilio)

GHL-exit smoke test: text **Eben + Garrett** every morning via **Twilio** (not GHL).

| Send | Copy | When (America/Los_Angeles) |
|------|------|----------------------------|
| `prepare` | `Good morning, time to prepare for the day.` | **08:00**, or **2 hours before the first appointment** when that is earlier |
| `meeting` | `Staff meeting` | **90 minutes after** the prepare text (09:30 on a normal day) |

## Status (2026-07-30)

- Twilio Account SID matches Bitwarden `TWILIO_SID` (trial).
- Local From number provisioned: `+18316121965` (`TWILIO_FROM_NUMBER`).
- API accepts sends, but **US carriers currently undeliver** with **error 30034** (A2P 10DLC unregistered). Toll-free also failed (**30032**, toll-free not verified).
- Trial accounts **cannot** complete A2P registration — **upgrade the Twilio account**, then register Sole Proprietor / Low-Volume brand + campaign (or verify a toll-free), then set `MORNING_SMS_MODE=active`.
- Garrett `+14153142790` is **not** on the trial verified-caller list yet (Eben `+14159348341` is). After upgrade, verify Garrett or finish 10DLC so both can receive.

## Deploy

```bash
cd morning-sms-worker
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv TWILIO_SID \
  | npx wrangler secret put TWILIO_SID
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv TWILIO_AUTH_TOKEN \
  | npx wrangler secret put TWILIO_AUTH_TOKEN
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv WORKER_AUTH_SECRET \
  | npx wrangler secret put WORKER_AUTH_SECRET
# Optional — appointment-relative schedule (reads today's first GHL appt):
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv GHL_CLIENT_ID \
  | npx wrangler secret put GHL_CLIENT_ID
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv GHL_CLIENT_SECRET \
  | npx wrangler secret put GHL_CLIENT_SECRET

npx wrangler deploy
```

Default mode is **`shadow`** (logs `would_send`, no Twilio call). After A2P is approved:

```bash
npx wrangler secret put MORNING_SMS_MODE   # or change [vars] in wrangler.toml → active
# Prefer editing wrangler.toml [vars] MORNING_SMS_MODE = "active" and redeploy.
```

## Manual test

```bash
# Dry schedule + copy (no send):
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://morning-sms.eben-fa2.workers.dev/run?kinds=both&dry=1'

# Live send (only after mode=active AND A2P/toll-free ready):
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://morning-sms.eben-fa2.workers.dev/run?kinds=prepare'
```

## Files

- `src/schedule.js` — pure PT schedule + copy
- `src/twilio.js` — Messages API helper
- `src/appointments.js` — optional GHL “first appt today”
- `src/run.js` — idempotent fan-out
- `src/index.js` — cron + `/run` + `/status`
