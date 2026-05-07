# Quiz Migration Scope — React/Vite SPA → Astro

Scope of the existing quiz at `/Users/Eben/Desktop/Claude/projects/amarimethod-website/quiz/`. Goal: nothing breaks during migration, especially the GHL webhook integration.

---

## 1. GHL Webhook Integration (CRITICAL — DO NOT TOUCH)

### Architecture
- Frontend POSTs to a **same-origin Cloudflare Pages Function**, NOT directly to GHL.
- Pages Function lives at `/Users/Eben/Desktop/Claude/projects/amarimethod-website/functions/api/send-to-ghl.js` and handles all GHL calls server-side (so the GHL token never touches the browser).
- GHL token is fetched via `getGhlToken(context)` from `functions/lib/ghl.js` — OAuth2 with KV-cached access/refresh tokens, falls back to static `GHL_API_KEY` env var.
- GHL Location ID hardcoded in the function: `7pIO7FHVAyBT1jKGhfQM`.

### Frontend call site
File: `/Users/Eben/Desktop/Claude/projects/amarimethod-website/quiz/src/contexts/QuizContext.tsx`, line 197 onward.

```ts
const apiRoute = "/api/send-to-ghl";

return fetch(apiRoute, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(contactData)
});
```

No auth headers, no API key, no retry logic on the client other than a manual `retrySubmission()` that re-POSTs the same payload after the user clicks "Try Again".

A 2.5-second `setTimeout` is `Promise.all`'d alongside the fetch so the processing animation always shows for at least 2.5s. On retry it's 2s.

Errors are surfaced via toast + a red error card with retry button. Non-2xx response throws `Error("API error (\${status}): \${errorText}")`.

### Frontend payload (`contactData`)
Constructed in `sendContactToAPI` at `QuizContext.tsx:199-260`. Every field, source, and type:

| Field | Type | Source |
|---|---|---|
| `firstName` | string | Step 12 contact form |
| `lastName` | string | Step 12 contact form |
| `email` | string | Step 12 contact form |
| `phone` | string | Step 12 contact form (optional) |
| `patternSignature` | string (one of the 5 pattern names) or `'Unknown'` | `determinePatternSignature(scores)` from `lib/quizLogic.ts` |
| `recoveryPotentialScore` | number 30–100 (or 0 fallback) | `scores.recoveryPotential` |
| `primaryPainLocation` | string or `'Unknown'` | `answers[0].answer` (Q1) |
| `painSeverity` | `'mild'` \| `'moderate'` \| `'severe'` | Derived: recoveryPotential >=80 → mild, <60 → severe, else moderate |
| `painDuration` | string | `answers[3].answer` (Q4) |
| `treatmentsTried` | string (comma-joined) | `answers[9].answer` filtered to drop "I haven't tried any treatments" |
| `painTrigger` | string | `answers[1].answer` (Q2) |
| `additionalPainAreas` | string (comma-joined) | `answers[2].answer` (Q3) |
| `painIntensity` | string | `answers[4].answer` (Q5) |
| `painTiming` | string (comma-joined) | `answers[5].answer` (Q6) |
| `painType` | string (comma-joined) | `answers[6].answer` (Q7) |
| `aggravatingActivities` | string (comma-joined) | `answers[7].answer` (Q8) |
| `dailyImpact` | string (comma-joined) | `answers[8].answer` (Q9) |
| `treatmentResults` | string | `answers[10].answer` (Q11) |
| `healthConditions` | string (comma-joined) | `answers[11].answer` (Q12) |
| `scores` | object | `{ softTissueTension, jointBoneAlignment, patternDuration, dailyActivitiesImpact, bodyAdaptations, recoveryPotential }` — all 0–100 numbers |
| `insights` | array of `{title, description}` | `generateInsights(answers, scores)` — 3-4 entries |
| `referralSource` | string \| undefined | `?ref=` URL param, also persisted to `localStorage.quiz_ref` |

### Backend (`functions/api/send-to-ghl.js`)
What the Pages Function does with the payload — anything that depends on payload shape needs to keep working:

1. **CORS**: Allowed origins are `https://www.amarimethod.com` and `https://amarimethod.com`. Allows `POST, OPTIONS`. Same-origin from /quiz/ works because both are on amarimethod.com.
2. **Rate limit**: 3 submissions per IP per hour via `PORTAL_KV` binding (key `quiz_rate:{ip}`). Returns 429 if exceeded. Skipped silently if KV not bound.
3. **Validation**: Requires `firstName`, `lastName`, `email`. Email regex validates basic format. Returns 400 if missing/invalid.
4. **GHL token** via `getGhlToken(context)`. Returns 500 if missing.
5. **Tags array** built from:
   - `"quiz submitted"` (always)
   - `"pain-severity-mild"` / `"pain-severity-moderate"` / `"pain-severity-severe"` (always one)
   - `"pain-location-{slug}"` if `primaryPainLocation` is set (slug = lowercase, `/` → `-`, spaces → `-`, non-alphanumeric stripped)
   - `"audience-bay-area"` or `"audience-remote"` derived from `cf-iplatitude` / `cf-iplongitude` request headers — Haversine distance from SF (37.7749, -122.4194); ≤75 mi = bay-area
   - `"referred-by-{lowercased-ref}"` if `referralSource` present
6. **Step 1 — Upsert contact** via `POST https://services.leadconnectorhq.com/contacts/upsert` with payload `{ firstName, lastName, email, phone, locationId, tags, source }`. `source` is `"Pain Assessment Quiz"` or `"Pain Assessment Quiz (ref: X)"`. Headers from `ghlHeaders(token)`: `Authorization: Bearer X`, `Content-Type: application/json`, `Version: 2021-07-28`. Custom fields are NOT sent in this step (upsert doesn't reliably save them).
7. **Step 2 — Update custom fields** via `PUT https://services.leadconnectorhq.com/contacts/{contactId}` with `{ customFields: [...] }`. The 16 field IDs (DO NOT CHANGE — these point at existing GHL custom fields):

   | Frontend payload key | GHL field ID |
   |---|---|
   | `patternSignature` | `BvTGZ9O9ayecw5f0Nj76` (painPatternSignature) |
   | `recoveryPotentialScore` | `PhQQjTF1fiLgtnAgKZZP` |
   | `primaryPainLocation` | `vKZTVAG7601lgV8413du` |
   | `painDuration` | `wrYzlW0ta2SGD8cI5iTM` |
   | `treatmentsTried` | `y5HBXMycSnfFPSOcnR2y` |
   | `painTrigger` | `NaNk1OVQLu8CcONUnyNz` |
   | `additionalPainAreas` | `NCDnl1jHDvDATpRKhkeV` |
   | `painIntensity` | `iCMhoomSzLnCUCcludwD` |
   | `painTiming` | `bUuxBmrMuu2Zm9QrNTng` |
   | `painType` | `tIIxUQT8hrkpDYY3WhWn` |
   | `aggravatingActivities` | `IqxEaCTcZpvGuDUC3O9c` |
   | `dailyImpact` | `zin4frkDKBWvVoN7ztZW` |
   | `treatmentResults` | `1MSGnUASa5Zd9lKoNdvO` |
   | `healthConditions` | `Uw1MeObXs3xKJGh1KGNu` |
   | (computed `resultsSummary`) | `fE6XF0OEaq09v6clDhzq` (quizResultsSummary) |
   | `referralSource` | `htX3m1ba8ka7PU0OWISE` (only if present) |

   `quizResultsSummary` is a multi-line plaintext block built by `buildResultsSummary(body)` (used for Garrett's SMS digest). Format: header, pattern, recovery %, scores line, numbered insights, then all answers labeled.

8. **Response**: `{ success: true, audience: "bay-area" | "remote" | null }` with status 200. Frontend reads `audience` from response (line 300-307 of QuizContext) to flip the BookingCTA primary/secondary button order. Status codes used on error: 400 (validation), 422 (upstream GHL failure), 429 (rate limit), 500 (server). Custom-field PUT failure does NOT fail the request — it just logs.

### Required env / bindings
- `GHL_API_KEY` (legacy static) OR OAuth2 stack: `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET` + `PORTAL_KV` containing `ghl_access_token`, `ghl_refresh_token`, `ghl_token_expiry`.
- `PORTAL_KV` for rate limiting (optional — graceful degradation).

### Migration risk
**Zero changes needed to the Pages Function or GHL fields if Astro re-uses `/api/send-to-ghl` as same-origin POST with the identical payload shape.** Keep field names and types byte-identical. The `audience` response field must still be read on success.

---

## 2. Scoring / Insight Logic

**Single source of truth**: `/Users/Eben/Desktop/Claude/projects/amarimethod-website/quiz/src/lib/quizLogic.ts`. Three exported pure functions:

- `calculateScores(answers): ScoreCategories` — produces 6 scores (softTissueTension, jointBoneAlignment, patternDuration, dailyActivitiesImpact, bodyAdaptations, recoveryPotential), each 0–100. Recovery starts at 85 and is bounded [30, 100].
- `determinePatternSignature(scores): PatternSignature` — picks max of 5 categories, mapped: softTissueTension→`'Protective Tension'`, jointBoneAlignment→`'Structural Adaptation'`, patternDuration→`'Established Pattern'`, dailyActivitiesImpact→`'Functional Limitation'`, bodyAdaptations→`'Compensatory Movement'`.
- `generateInsights(answers, scores): QuizInsight[]` — up to 4, picked from 8 conditional branches plus 2 fallback inserts if fewer than 3 fire.

No other files contribute to scoring. `QuizContext.tsx` calls these at submit. Types in `src/types/quiz.ts`.

These three functions can be moved verbatim into the Astro project. Keep them framework-agnostic — they're pure functions over `QuizAnswer[]`.

---

## 3. Question Definitions

**Single source of truth**: `/Users/Eben/Desktop/Claude/projects/amarimethod-website/quiz/src/components/QuizStack.tsx` lines 23–120 (exported `QUIZ_QUESTIONS: QDef[]`).

12 questions total, indices 0–11. Index 12 is the contact form (no `QDef`, handled separately in `QuizContainer.tsx`). Total steps = 13.

`QDef` shape: `{ index, type: 'single' | 'multi', question, description?, options: string[], required?, otherOption?, category, questionNum }`.

Required (`required: true`): Q1, Q2, Q4, Q5, Q11, plus contact form. All others optional / multi-select.

Q11 (treatment results, index 10) is auto-skipped when Q10 (treatments tried, index 9) is empty or contains "I haven't tried any treatments" — see `QuizContainer.tsx:48-60`.

Default answer state initialized in two places (must keep in sync): `QuizContext.tsx:96-110` and `QuizContext.tsx:388-401` (resetQuiz). Contains the verbatim question strings.

Quiz step categories array for GA4: `QuizContext.tsx:113-118` (`STEP_CATEGORIES`).

---

## 4. External URLs

### Booking links (relative — resolve to amarimethod.com static pages)
From `BookingCTA.tsx` and `ResultsPage.tsx`:
- `/book-initial-in-person`
- `/book-initial-virtual`
- `/book-discovery-call`

All 3 are passed through `buildBookingUrl()` which appends `?pain={slugified-Q1}` if the visitor answered Q1. The existing site's `js/main.js` then forwards that param to GHL booking calendars (per `MEMORY.md`'s sessionStorage `amari_pain_type` flow — set at `QuizContext.tsx:313-318`).

### Condition page links
`https://www.amarimethod.com/{conditionPageSlug}` — built in `ConditionStory.tsx:146`. Slugs from `conditionContent.ts`:
- `lower-back-pain-san-francisco`
- `neck-pain-san-francisco`
- `shoulder-pain-san-francisco`
- `hip-pain-san-francisco`
- `knee-pain-san-francisco`

### Footer
- `https://www.amarimethod.com/privacy-policy`
- `https://www.amarimethod.com/terms-of-use`

### Protocol intro videos (filesafe.space CDN — GHL Media Storage)
From `conditionContent.ts:368-405`:
- Spinal Wave: `https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30c3bfe4d0d3ac8d60938.mp4`
- Power Posture: `https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30d0ef5a3893acea59684.mp4`
- Spring Step: `https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c306b5f5a389ab2aa4c3a0.mp4`
- Hand Balancer: `https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c305e33ab4d91e7fc7763d.mp4`
- Elbow Reset: `https://assets.cdn.filesafe.space/7pIO7FHVAyBT1jKGhfQM/media/69c30e9b6bd30ff0fd318d61.mp4`

URL pattern: `https://assets.cdn.filesafe.space/{LOCATION_ID}/media/{MEDIA_ID}.mp4`. Mapping by Q1 location is in `PROTOCOL_BY_LOCATION` (lines 459–472).

### Logo asset
`/quiz/AmariLogo.avif` (served from `quiz/public/AmariLogo.avif` due to Vite `base: "/quiz/"`).

### Web fonts
Bona Nova + Inter from Google Fonts, preconnected in `index.html`. Poppins is referenced in `tailwind.config.ts` and `.btn-primary` CSS but not loaded — likely a leftover.

---

## 5. Tracking

### GA4
- ID: `G-DGQM32BMYZ` (loaded via gtag in `quiz/index.html`).
- Helper `trackEvent()` in `QuizContext.tsx:45-49` — silently no-ops if gtag not present.
- Events fired:
  - `quiz_start` — when user leaves step 0 (first real engagement). `QuizContext.tsx:166-168`
  - `quiz_step_complete` — every step advance, with params `{step_number, step_category}` where category comes from `STEP_CATEGORIES`. `QuizContext.tsx:170-173`
  - `quiz_complete` — on successful API submission, with params `{pattern_signature, recovery_potential, pain_location, pain_severity}`. `QuizContext.tsx:320-326`

### Microsoft Clarity
- Project ID: `vuvx43xu8h` (loaded inline in `quiz/index.html`).
- No explicit Clarity events — passive heatmap/recording only.

No other analytics. No PostHog, Segment, etc.

---

## 6. Routing / State

### Routing
- React Router v6 with `<BrowserRouter basename="/quiz">` (`App.tsx:9`).
- One real route `/` → `<Index>` which renders `<QuizProvider><QuizContainer /></QuizProvider>`.
- Catch-all `*` → `<NotFound>`.
- This is effectively a single-page state machine. There is no per-step URL route — the cover, questions, processing, and results are all rendered conditionally inside `QuizContainer` based on `hasStarted`, `currentStep`, `isProcessing`, `isCompleted`, `submissionError`, `isLoading` flags.

### State (all in-memory React Context — `QuizContext.tsx`)
- `currentStep` (0–12), `hasStarted` boolean, `answers` array, `firstName/lastName/email/phone`, `scores`, `patternSignature`, `insights`, `audience`, `referralSource`, plus assorted submission flags.
- Auto-skip logic for Q11 (treatment results) lives in `QuizContainer.tsx:48-60`.
- Keyboard handlers (Enter to advance, 1–9 to select on single-select questions) at `QuizContainer.tsx:62-87`.

### Persistence
- `localStorage`: `quiz_ref` — affiliate `?ref=` value, written on first visit, cleared after successful submission. Read on mount. `QuizContext.tsx:76-88` and `:311`.
- `sessionStorage`: `amari_pain_type` — slugified Q1 answer, written on completion so the legacy `js/main.js` can append `?pain=` to all GHL booking links elsewhere on the site. `QuizContext.tsx:313-318`.
- No URL query persistence except the inbound `?ref=`.

### Cover → questions → results transition
- Cover (`WelcomeScreen`): rendered while `!hasStarted`. CTA calls `startQuiz()` which sets `hasStarted = true`.
- Questions (steps 0–11) → contact form (step 12): `goToNextStep()` advances `currentStep`. At step 12 the `Next` button calls `submitQuiz()` instead.
- Submit triggers `isProcessing = true` → `<ProcessingScreen>` for ≥2.5s while POST runs → `isCompleted = true` → lazy-loaded `<ResultsPage>`.

A page refresh wipes everything. Going Back to the cover does not restart the API call.

---

## 7. Build Setup

### Vite config
File `quiz/vite.config.ts`:
- `base: "/quiz/"` — all asset URLs prefixed with `/quiz/`.
- `outDir: "../dist/quiz"` — built into the parent project's `dist/quiz/`.
- `emptyOutDir: true`.
- `manualChunks: { "react-vendor": ["react", "react-dom"] }`.
- `chunkSizeWarningLimit: 600`.
- Aliases: `@` → `./src`.
- React plugin: `@vitejs/plugin-react-swc`.

### Build chain
Repo root `package.json` build script (one big shell line):
```
npm run build
```
which runs:
1. `mkdir -p dist`
2. `node scripts/build-html.js` (processes static HTML pages)
3. Copies static assets into `dist/`
4. `cd quiz && vite build` → `dist/quiz/`
5. Then portal, staff, cos sub-builds

### dist/ tracking
- Root `.gitignore` ignores `/dist/` and `quiz/dist/`.
- BUT per `MEMORY.md` the `dist/` for the staff dashboard is force-added (`-f`). Confirm whether `dist/quiz/` needs the same treatment by checking what's actually in the repo on `main` — if Cloudflare Pages builds in CI, `dist/` can stay ignored; if Cloudflare just serves committed files, you must `git add -f dist/quiz/`. The build script suggests Cloudflare runs `npm run build` itself, so dist/ likely is gitignored and rebuilt on deploy.

### Cloudflare Pages
- Project: `amarimethod-website`.
- Required env vars: `JWT_SECRET`, `GHL_API_KEY` (or OAuth2 vars + `PORTAL_KV` binding).
- SPA fallback in `_redirects`: `/quiz/* /quiz/index.html 200`.
- Auto-deploys on push to main.

### Pages Functions in the quiz path
**None directly under `/quiz/`** — the quiz uses only `/api/send-to-ghl` (in `functions/api/`). So the entire `/quiz/*` route is static SPA + the global `/api/*` namespace.

---

## 8. Component Inventory

### Static-display (candidates for Astro pages / components)
| File | One-line purpose |
|---|---|
| `components/AmariLogo.tsx` | Static logo bar (img tag only) |
| `components/QuizFooter.tsx` | Static footer with privacy/terms links + copyright year |
| `components/results/ConditionStory.tsx` | Renders pain-location-specific why/chain copy from `conditionContent.ts`. Has a `<video>` tag for protocol intro but no JS interactivity beyond native controls |
| `components/results/InsightCards.tsx` | Renders insights array as cards + "Missing Piece" callout. Pure presentation, but data is dynamic per visitor |
| `components/results/ScoreCard.tsx` | Pure presentation given a score number |
| `components/results/ScoreRadar.tsx` | SVG radar chart — pure presentation given scores |
| `components/results/ShareCard.tsx` | Off-screen 1200×630 share image (rendered for html2canvas). Pure presentation, but invoked by client interaction |
| `pages/NotFound.tsx` | Static 404 |
| `lib/quizLogic.ts` | Pure functions — frame-agnostic |
| `lib/conditionContent.ts` | Pure data + lookup function |
| `lib/utils.ts` | clsx/tw-merge utility |
| `types/quiz.ts` | Type defs |

### Stateful / interactive (must remain React island, or rewritten)
| File | Why it must stay interactive |
|---|---|
| `App.tsx` | Router shell |
| `pages/Index.tsx` | Provider wrapper |
| `main.tsx` | React mount |
| `contexts/QuizContext.tsx` | All state, validation, submit, GA4 events, audience flip — 449 lines, the heart of the quiz |
| `components/QuizContainer.tsx` | Top-level orchestrator: cover/processing/questions/results switch, keyboard handlers, auto-skip Q11 |
| `components/WelcomeScreen.tsx` | Cover with CTA that fires `startQuiz()`. Has CSS-driven floating-question animations and a static SpiderChart preview |
| `components/QuizStack.tsx` | Renders all 12 questions stacked, scroll-to-active, jump-to past, future-preview rows |
| `components/ProgressBar.tsx` | Progress + step dots, derived from currentStep |
| `components/ProcessingScreen.tsx` | 4-step animated processing message |
| `components/QuizFooter.tsx` | Static, but uses `new Date().getFullYear()` — could be Astro |
| `components/questions/SingleSelectQuestion.tsx` | Click handler + auto-advance |
| `components/questions/MultiSelectQuestion.tsx` | Toggle handler |
| `components/questions/ContactInfoForm.tsx` | Form inputs + submit button wired to context |
| `components/results/ResultsPage.tsx` | Lazy-loaded results orchestrator (calls share hook, builds booking URLs, reads context) |
| `components/results/ResultsHero.tsx` | Animated SVG recovery ring (mount-time transition) |
| `components/results/BookingCTA.tsx` | Reads `audience` from context to flip In-Person/Virtual button emphasis; reads `referralSource` for "Referred by X" pill |
| `hooks/useShareResults.ts` | html2canvas + Web Share API |
| `hooks/use-toast.ts`, `components/ui/toaster.tsx`, `components/ui/toast.tsx`, `components/ui/use-toast.ts` | Radix toaster (used by submission error path) |
| `hooks/use-mobile.tsx` | Viewport hook (unclear if actually used — grep before deleting) |

### Recommended split
- **Astro pages**: cover (`/quiz/`), maybe a separate results page if state can be re-derived from a session token.
- **One big React island**: the question flow + contact form + processing + results, because they share a single state machine with auto-skip, validation, submit, GA4 events, and read-back of `audience` from the API response. Splitting that flow into multiple islands is more pain than it's worth — each island would need its own context.
- Cleanest approach: Astro shell renders the editorial cover (server-side, no JS), and a single `<QuizApp client:load>` React island takes over once the user clicks "Start". Or keep the React app exactly as-is and only swap the cover.

---

## 9. Tailwind Config — Existing Amari Tokens

From `quiz/tailwind.config.ts` (`theme.extend.colors.amari`):
- `amari-bone-white`: `#FFFCF5` (primary background)
- `amari-light-sand`: `#F7F3E9` (card backgrounds)
- `amari-charcoal`: `#252525` (primary text/buttons)
- `amari-pine-teal`: `#252525` (NOTE: aliased to charcoal, not actually teal anymore)
- `amari-forest-green`: `#3a3a3a` (hover state)
- `amari-oat`: `#F0E9DC` (warm neutral / borders)

**Tokens referenced in JSX but NOT defined in tailwind.config.ts**:
- `amari-text-light` — used heavily, falls back to default Tailwind color (probably broken or relying on global CSS — verify by grep). Likely intended ~`#718096` or similar muted gray.
- `amari-border` — used heavily, same situation. Likely the `--border` HSL variable `39 30% 88%` from `index.css`.
- `amari-accent-warm` (`#EBA584`) — referenced in MEMORY.md as the accent but not in this Tailwind config. The orange `#EBA584` is hardcoded inline as a hex throughout (ResultsHero ring, radar fill, InsightCards bar, WelcomeScreen radar, etc.)

**For Astro migration**: extend Tailwind with the same `amari` color block AND explicitly add `amari-text-light` (~`#718096`) and `amari-border` (~ HSL 39 30% 88% = `#E5DDC9`) to avoid silent fallbacks. Also add `amari-accent-warm: #EBA584` and replace the inline hexes.

Fonts: `font-serif` = Bona Nova / Georgia, `font-sans` = Inter / system-ui, `font-ui` = Poppins / system-ui (Poppins not loaded — used only in `.btn-primary`).

CSS custom properties from `index.css :root`:
- `--background: 38 100% 98%` (Bone White)
- `--foreground: 0 0% 15%` (Charcoal)
- `--primary: 180 28% 43%` (legacy Pine Teal HSL — predates the `#252525` aliasing; visible in HSL but charcoal in JS)
- `--border: 39 30% 88%` (Oat)
- `--radius: 0.5rem`

Custom CSS classes to port: `.btn-primary`, `.btn-secondary`, `.quiz-card`, `.quiz-card-nav`, `.quiz-nav-back`, `.quiz-step-enter`, `.progress-bar`, `.progress-fill`, `.radio-container`, `.checkbox-container`, plus 7 `@keyframes float-q-N` animations used by WelcomeScreen.

---

## 10. Anything Weird

### Known bugs / quirks
- **Protocol video URL swap (acknowledged)**: `conditionContent.ts:375-378` documents that the source `course-video-urls.json` has Power Posture and Spring Step URLs swapped. The URLs in `conditionContent.ts` are the corrected mapping — DO NOT "fix" them by reverting to the JSON.
- **GHL email branch divergence**: Elbows uses `Elbow Reset` in the quiz but the GHL email workflow sends `Hand Balancer`. Per the file comment, "GHL workflow needs a matching split" — known divergence, not blocking.
- **Q3 vs Q2 comment drift in quizLogic.ts**: Comments reference "Q2" for additional pain locations, but the actual answer index for additional locations is Q3 (index 2). Comments are stale post-trigger-question addition. Logic is correct.
- **Auto-skip race condition on Q11**: `QuizContainer.tsx:48-60` uses a 300ms timer to auto-advance past Q11 if no treatments selected. If the user clicks Back exactly during that window, behavior may be inconsistent. Not high priority.
- **`amari-text-light` and `amari-border` not in tailwind.config.ts**: heavy usage in JSX silently falls back. See section 9.
- **Pine Teal renamed but not removed**: `amari-pine-teal` is `#252525` (charcoal), but the brand still uses the name everywhere. Old Pine Teal was `#5E8C8A`. Search-replace cautiously.
- **`console.log` statements** in `QuizContext.tsx:262-263, 295, 330, 365` and the API function — violates global "no console.log in production" rule, harmless but noisy.

### Feature flags / A/B tests
None.

### Env vars (frontend)
None used in the React code. All sensitive values live in the Pages Function env.

### Redirects
- `_redirects` line 2: `/quiz/* /quiz/index.html 200` (SPA fallback).
- Comment at bottom mentions an inactive `quiz.amarimethod.com → /quiz/` 301 redirect "after DNS update" — currently disabled.

### Edge cases
- Visitor with no Q1 answer (somehow — Q1 is required so this shouldn't happen): condition story section is skipped, booking links go to base URL without `?pain=`.
- `audience` derivation depends on Cloudflare geo headers `cf-iplatitude` / `cf-iplongitude` — they may be missing for VPN users or localhost. In that case `audience` stays `null` and BookingCTA shows neutral default.
- Recovery score is bounded `[30, 100]` — never returns 0 even if all penalties applied.
- Phone is sliced to 20 chars server-side. Names sliced to 100, email to 200.
- Rate limit (3/hr/IP) silently no-ops if `PORTAL_KV` isn't bound — useful for local dev, but means production must have the binding.

### Integration leftovers
- `quiz/src/integrations/supabase/` directory exists but is empty (just the dir). Quiz has no Supabase dependency anymore — safe to ignore in migration.

---

## Design References

`/Users/Eben/Desktop/Claude/projects/amarimethod-website/design-references/quiz-cover-editorial.html` (415 lines, ~25KB) — yes, the editorial cover HTML exists.

Per its own header comment: created 2026-05-06 by Claude Design canvas, then cleaned. Source-of-truth design + copy for the new editorial cover. NOT for direct deploy.

Highlights:
- Title: "Pain Pattern Assessment · Form 01 | Amari Method"
- Typography: Bona Nova (display, italic accents) + Inter (sans body) + JetBrains Mono (instrument metadata)
- Colors: `--paper #F7F2E8`, `--ink #1F1D1A`, `--accent #C56B4E` (warm clay) — note `#C56B4E` is the same warm accent already used inline in ConditionStory.tsx and BookingCTA.tsx for chain step numbers
- Has GA4 + Clarity already wired (matching IDs)
- Sections to preserve: Form 01 / Issued by / Revision instrument framing on cover, Examiner's Note, Specimen output frame with sample report + radar, Scope of Use (For / Not for / What it returns), two "Begin Assessment" links (top + foot)
- Updated to match the actual 6 radar axes (Soft Tissue / Joint+Bone / Duration / Daily Impact / Adaptations / Recovery)
- Specimen "Primary pattern: Protective Tension" intentionally renamed to "Primary reading: Out of balance" in Garrett's voice
- All "Begin Assessment" links target `/quiz/`
- `meta robots noindex,follow` — design draft, not for indexing
- Removed in the cleanup: "5 distinct pain patterns" framing, the §02 "Five Patterns" section, "Reviewed by Dr. Garrett Hewstan, DC" credit (off-brand), "no email gate" claims (inaccurate)

Use this file as the design + copy spec for the Astro cover page. The migration's main UX upgrade is moving from `WelcomeScreen.tsx` (animated floating questions over a center card) → this editorial Form-01 layout.
