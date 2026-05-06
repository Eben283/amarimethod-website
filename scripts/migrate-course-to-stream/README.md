# Living Practice course migration → Cloudflare Stream

End-to-end migration of the 53 Living Practice MP4s from local files (with GHL CDN as backup) to Cloudflare Stream + signed URLs.

## What this drop ships

- `migrate.mjs` — uploads all 53 videos from `amari/Course Videos/` to Stream, generates `course-data.new.ts`
- `lockdown.mjs` — final-step script that flips `requireSignedURLs=true` on every uploaded video
- `../../functions/api/stream-token.js` — Pages Function that mints signed Stream playback URLs after validating portal session + Living Practice access
- `../../portal/src/components/course/VideoPlayer.tsx` — rewritten to use HLS via `hls.js` and the signed-URL endpoint
- `../../portal/src/types/course.ts` — `Lesson.videoUrl` → `Lesson.streamUid`
- `../../portal/src/pages/CoursePage.tsx` — passes `streamUid` to VideoPlayer
- `../../portal/package.json` — `hls.js@^1.5.17` added

## Deployment sequence

Top-down. Don't skip steps.

### 1. Get the migration API token

dash.cloudflare.com → My Profile (top-right) → API Tokens → Create Token → Custom Token:
- Permissions: **Account → Stream → Edit**
- Account Resources: include your account
- Save the token somewhere safe — you'll paste it twice (migration + lockdown).

### 2. Run the migration script

```bash
cd /Users/Eben/Desktop/Claude/projects/amarimethod-website
export CF_ACCOUNT_ID=fa2b6f2441129b259dd5dea74045721b
export CF_API_TOKEN=<paste your token>
node scripts/migrate-course-to-stream/migrate.mjs
```

Expected runtime: ~30–90 min depending on your upload bandwidth (~2.6 GB total). The script:

- Parses `portal/src/data/course-data.ts` → 11 modules / 53 lessons
- Walks `amari/Course Videos/` → pairs folders↔modules and files↔lessons by index
- Uploads each MP4 to Stream (concurrency=3)
- Persists progress to `mapping.json` after each upload (Ctrl-C-safe; rerun resumes)
- Polls until every video is `state: ready`
- Generates `course-data.new.ts` with `streamUid: '...'` replacing `videoUrl: \`${CDN}/...\``

### 3. Apply the generated course-data

```bash
# Sanity-check the generated file
diff portal/src/data/course-data.ts scripts/migrate-course-to-stream/course-data.new.ts | head -30

# Replace
cp scripts/migrate-course-to-stream/course-data.new.ts portal/src/data/course-data.ts
```

### 4. Install hls.js + verify portal builds

```bash
cd portal
npm install
npm run build
```

If the build succeeds, the type/data shape is consistent.

### 5. Get the Stream "customer code"

Open dash.cloudflare.com → Stream → Videos → click any uploaded video → look at the playback URL. It looks like:

```
https://customer-abc123def456.cloudflarestream.com/{uid}/manifest/video.m3u8
```

The part after `customer-` and before `.cloudflarestream.com` is your customer code (12 hex chars).

### 6. Mint a runtime API token (separate from migration token)

The migration token has Edit permission and shouldn't be loaded into Pages Functions. Create a runtime-only token:

dash.cloudflare.com → API Tokens → Create Token → Custom Token:
- Permissions: **Account → Stream → Read** (Read is sufficient for the `/stream/{uid}/token` endpoint)
- Account Resources: include your account

### 7. Set Pages Function env vars

dash.cloudflare.com → Pages → amarimethod-website → Settings → Environment Variables → **Production**:

| Variable | Value |
|---|---|
| `CF_STREAM_ACCOUNT_ID` | `fa2b6f2441129b259dd5dea74045721b` |
| `CF_STREAM_TOKEN` | (the runtime token from step 6) |
| `CF_STREAM_CUSTOMER_CODE` | (the 12-char code from step 5) |

(Do the same for **Preview** if you want preview branches to work.)

### 8. Commit + push

```bash
cd /Users/Eben/Desktop/Claude/projects/amarimethod-website
git add functions/api/stream-token.js \
        portal/package.json portal/package-lock.json \
        portal/src/components/course/VideoPlayer.tsx \
        portal/src/pages/CoursePage.tsx \
        portal/src/types/course.ts \
        portal/src/data/course-data.ts \
        scripts/migrate-course-to-stream/

git commit -m "feat(course): migrate Living Practice videos to Cloudflare Stream + signed URLs"
git push origin main
```

Cloudflare auto-deploys.

### 9. Verify in production

- Log into the portal as a Living Practice user
- Open any lesson — video should play
- Check Network tab: see `GET /api/stream-token?uid=…` returning 200 with `hlsUrl`
- See HLS segments loading from `customer-{code}.cloudflarestream.com`

If video doesn't play:
- 401 from `/api/stream-token` → portal session expired, log in again
- 403 → `living_practice_access` field check failed; verify on the contact in GHL
- 422 → Stream API error; check `CF_STREAM_TOKEN` is valid and has Stream:Read
- 500 → env vars missing; double-check step 7

### 10. Lock it down (only after step 9 passes)

This step makes Stream's public manifest URLs stop serving content. Only signed tokens minted by `/api/stream-token` will work — closes the piracy hole.

```bash
cd /Users/Eben/Desktop/Claude/projects/amarimethod-website
export CF_ACCOUNT_ID=fa2b6f2441129b259dd5dea74045721b
export CF_API_TOKEN=<the migration token from step 1>
node scripts/migrate-course-to-stream/lockdown.mjs
```

Re-test playback in the portal after locking — should still work via signed URLs.

### 11. (Optional) Delete GHL Media Storage copies

Only after a few days of stable production use. The GHL copies are a fallback. Deleting them frees up your GHL plan's media quota.

## Cost expectations

- Storage: 53 × ~5 min = ~265 min, well inside the 1,000 min base. **$5/mo flat.**
- Egress: $1 per 1,000 min delivered. **$5–25/mo at current scale.**
- Set a billing alert at $30/mo as an early warning.

## Files generated, all gitignored

- `mapping.json` — `{ filesafeId: { streamUid, title, lessonSlug, moduleSlug, … } }`. Source of truth; required by lockdown.mjs.
- `course-data.new.ts` — drop-in replacement for `portal/src/data/course-data.ts`.

## Rollback

If anything breaks during deploy, the GHL Media Storage copies are still there. Quickest revert:

```bash
git revert HEAD --no-edit
git push
```

This puts `videoUrl: \`${CDN}/...\`` back. Player goes back to the simple native `<video>` tag pointing at GHL's CDN. The Stream-uploaded copies stay (they're cheap; leave them as backup).

After rollback you can investigate, fix, and re-deploy without time pressure.
