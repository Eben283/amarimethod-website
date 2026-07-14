# Parla — Italian voice tutor

Phone-ready PWA inspired by [kenoleeee/italk](https://github.com/kenoleeee/italk): speak Italian, get an AI reply spoken back.

- **STT / TTS:** browser Web Speech API (`it-IT`)
- **LLM:** OpenRouter (key stays on the Cloudflare Worker)
- **Install:** Add to Home Screen on iPhone/Android

## Local development

```bash
cd parla-italiano
npm install
# Terminal A — API worker with secrets
cp .dev.vars.example .dev.vars   # put OPENROUTER_API_KEY
npx wrangler dev
# Terminal B — Vite UI (proxies /api → worker)
npm run dev
```

## Deploy

```bash
npm run build
npx wrangler secret put OPENROUTER_API_KEY
# optional lock screen:
# npx wrangler secret put APP_ACCESS_CODE
npx wrangler deploy
```

Live: **https://parla-italiano.eben-fa2.workers.dev**

Unlock with your Bitwarden `STAFF_PIN_EBEN` (set as Worker secret `APP_ACCESS_CODE`).

## Phone use

1. Open the HTTPS URL in **Chrome (Android)** or **Safari (iPhone)**.
2. Allow microphone.
3. On iPhone: Share → **Add to Home Screen**.
4. Tap the mic, speak Italian, listen to the reply.
