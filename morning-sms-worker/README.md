# morning-sms worker (GHL)

Morning texts to **Eben + Garrett** via **GoHighLevel** SMS (not Twilio).

| Send | Copy | When (America/Los_Angeles) |
|------|------|----------------------------|
| `prepare` | Today’s active appointments, with Pacific time, client name, and calendar/session type | **08:00**, or **2 hours before the first appointment** when that is earlier |
| `meeting` | `Staff meeting` | **90 minutes after** the prepare text (09:30 on a normal day) |

## Recipients

| Who | GHL contact id | Notes |
|-----|----------------|-------|
| Eben | `3jsTC9Cb7hkDpC3FLuFd` | `eben@ebenforrest.com` |
| Garrett | `lYgxJtvpRzWO2UvDh9ju` | Contact with mobile (not the email-only `garrett@amarimethod.com` row) |

Configured as `MORNING_SMS_CONTACT_IDS` in `wrangler.toml`.

## Deploy

```bash
cd morning-sms-worker
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv GHL_CLIENT_ID \
  | npx wrangler secret put GHL_CLIENT_ID
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv GHL_CLIENT_SECRET \
  | npx wrangler secret put GHL_CLIENT_SECRET
bws run --project-id f259cb76-481e-4f7c-b6d4-b47901086c3a -- printenv WORKER_AUTH_SECRET \
  | npx wrangler secret put WORKER_AUTH_SECRET

npx wrangler deploy
```

## Manual test

```bash
# Dry schedule + copy (no send):
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://morning-sms.eben-fa2.workers.dev/run?kinds=both&dry=1'

# Live send now (uses real copy; idempotent per day+kind+contact):
curl -sS -H "Authorization: Bearer $WORKER_AUTH_SECRET" \
  'https://morning-sms.eben-fa2.workers.dev/run?kinds=prepare'
```

Cron: `*/5 11-19 * * *` (UTC morning window). Mode: `MORNING_SMS_MODE=active`.

Cancelled, invalid, and no-show appointments are excluded. If GHL cannot be
read, the message says the agenda could not be loaded rather than incorrectly
reporting an empty day.

## Note on Twilio

An earlier Twilio path was parked (US A2P registration incomplete). `src/twilio.js` may still exist as unused leftover — production path is GHL only.
