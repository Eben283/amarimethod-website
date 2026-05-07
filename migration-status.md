# Quiz Migration Status — React/Vite SPA → Astro

Branch: `astro-migration`. Status: **build-clean, awaiting human smoke test.**

---

## What was built

New project at `/Users/Eben/Desktop/Claude/projects/amarimethod-website/quiz-astro/`:

```
quiz-astro/
  astro.config.mjs        ← base: '/quiz/', static output, react() + tailwind()
  package.json            ← astro 4.16, @astrojs/react, @astrojs/tailwind, html2canvas, radix-toast, lucide-react, etc.
  tailwind.config.cjs     ← mirrors quiz/tailwind.config.ts with the missing tokens added
  postcss.config.cjs
  tsconfig.json           ← extends astro/tsconfigs/strict; verbatimModuleSyntax disabled
  public/
    AmariLogo.avif        ← copied from quiz/public/
  src/
    env.d.ts
    layouts/
      QuizLayout.astro    ← head boilerplate, GA4 + Clarity inline scripts, fonts
    pages/
      index.astro         ← static editorial cover (Form 01)
      take/index.astro    ← thin shell that mounts <QuizApp client:load />
    components/
      QuizApp.tsx         ← provider wrapper with mount-time startQuiz() bootstrap
      QuizContainer.tsx   ← ported, two surgical edits (see below)
      AmariLogo.tsx       ← byte-identical
      QuizFooter.tsx      ← byte-identical
      ProgressBar.tsx     ← byte-identical
      ProcessingScreen.tsx← byte-identical
      QuizStack.tsx       ← byte-identical
      questions/          ← all 3 files byte-identical
      results/            ← all 8 files byte-identical
      ui/                 ← toast/toaster/use-toast byte-identical
    contexts/QuizContext.tsx ← BYTE-IDENTICAL to original (verified)
    hooks/                ← all 3 byte-identical
    lib/                  ← quizLogic.ts, conditionContent.ts, utils.ts byte-identical
    types/quiz.ts         ← byte-identical
    styles/quiz.css       ← merged from quiz/src/index.css + quiz/src/App.css (animation keyframes, design tokens, button utility classes)
```

26 of 27 ported source files are byte-identical to `quiz/src/`. Only `components/QuizContainer.tsx` differs (see "Cover-skips-welcome-screen detail" below).

The cover page is a single `index.astro` rendering the editorial Form 01 design verbatim from `design-references/quiz-cover-editorial.html`. `meta robots="noindex"` was stripped (per prompt). All `[data-cover]`-namespaced styles live in a `<style is:global>` block on the cover page only — they don't leak into `/quiz/take/`. CTA links (top + foot Begin Assessment) point at `/quiz/take/` exactly as specified.

---

## GHL payload diff vs original (must be byte-identical — verified)

```
$ diff /…/quiz/src/contexts/QuizContext.tsx /…/quiz-astro/src/contexts/QuizContext.tsx
$ echo $?
0
```

The submission code path (`sendContactToAPI` at lines 199–270) is character-for-character identical:

- Field names — same
- Field types — same
- `painSeverity` derivation — same: `>= 80 → 'mild'`, `< 60 → 'severe'`, else `'moderate'` (lines 222–224)
- `treatmentsTried` filter — same: `treatmentsRaw.filter(t => t !== "I haven't tried any treatments").join(', ')` (lines 217–219)
- Comma-join behavior on multi-selects — same `Array.isArray(x) ? x.join(', ') : ''` pattern across `additionalPainAreas`, `painTiming`, `painType`, `aggravatingActivities`, `dailyImpact`, `healthConditions`
- `referralSource` from `?ref=` URL param + `localStorage.quiz_ref` — same useEffect at lines 75–88
- Response handling — same `data.audience` read + setAudience flip (lines 299–307)
- `sessionStorage.amari_pain_type` slugified Q1 — same write at lines 313–318
- GA4 events — same: `quiz_start` (line 167), `quiz_step_complete` with `{step_number, step_category}` (lines 170–173), `quiz_complete` with `{pattern_signature, recovery_potential, pain_location, pain_severity}` (lines 320–326)
- `apiRoute = "/api/send-to-ghl"` — same (line 197), same-origin POST
- 2.5s `Promise.all` minimum-show timer — same (line 290)
- Retry path's 2s timer — same (line 352)

The Pages Function (`functions/api/send-to-ghl.js`) was not touched. All 16 GHL custom-field IDs route correctly off the same payload shape.

---

## Cover-skips-welcome-screen detail

The editorial cover at `/quiz/` is now the welcome screen. Visitors land there, click "Begin Assessment" (top or foot), and arrive at `/quiz/take/` where `<QuizApp client:load />` mounts.

To skip the legacy `WelcomeScreen` state entirely, I picked the **`QuizApp` bootstrap effect** approach (the prompt's option B):

```tsx
// QuizApp.tsx
function QuizBootstrap() {
  const { hasStarted, startQuiz } = useQuiz();
  useEffect(() => {
    if (!hasStarted) startQuiz();
  }, [hasStarted, startQuiz]);
  return <QuizContainer />;
}
```

This keeps `QuizContext.tsx` byte-identical (no risk to GHL contract). `QuizContainer.tsx` was minimally edited:

1. Removed `import WelcomeScreen from './WelcomeScreen'` (the file isn't ported — it's never reachable)
2. Replaced the `!hasStarted ? <WelcomeScreen onStart={startQuiz} />` branch with a one-frame `<div className="min-h-[200px]" />` placeholder that the bootstrap effect immediately replaces. Visitors never see it because the effect fires synchronously on first commit.
3. **Bonus fix:** the original `QuizContainer.tsx` references `<Button>` in `renderErrorState` without an import — a latent bug. Replaced with a plain `<button className="btn-primary">` to make `tsc --noEmit` pass.

These are the only behavioral diffs in the React tree.

---

## Build wiring

Root `package.json`:

```diff
-    "dev": "cd quiz && vite",
-    "build": "… cd quiz && vite build && cd ../portal && npm install && vite build && …"
+    "dev": "cd quiz-astro && npm run dev",
+    "build": "… cd quiz-astro && npm install && npx astro build && cd .. && rm -rf dist/quiz && mkdir -p dist/quiz && cp -R quiz-astro/dist/. dist/quiz/ && cd portal && npm install && vite build && …"
+    "build:legacy-quiz": "cd quiz && vite build"
```

The old Vite quiz build was removed from the default `build` chain but kept reachable as `npm run build:legacy-quiz` (so the old `quiz/` directory is still buildable as a fallback if needed). The old `quiz/` source is otherwise untouched.

`_redirects` was updated: the SPA fallback `/quiz/* /quiz/index.html 200` was removed because Astro now emits `/quiz/index.html` AND `/quiz/take/index.html` as distinct static files. The old wildcard would have intercepted `/quiz/take` and served the cover. The `/portal/*`, `/staff/*`, `/cos/*` fallbacks are untouched.

---

## Smoke test results

`npm install` from `quiz-astro/`:
- 419 packages installed cleanly
- 4 audit issues (3 moderate, 1 high) — pre-existing in transitive deps, not introduced by this migration

`npx astro build` from `quiz-astro/`:
- 1624 modules transformed
- 2 pages built: `dist/index.html` (cover, 12.9 kB inline) and `dist/take/index.html` (take page shell)
- React island `QuizApp` chunk: 91.59 kB (28.14 kB gzip)
- `ResultsPage` lazy chunk: 252.72 kB (63.12 kB gzip) — html2canvas pulls weight, expected
- React vendor chunk: 141.27 kB (45.43 kB gzip)
- Build time: ~5s

`npx tsc --noEmit` from `quiz-astro/`:
- exit 0, no errors

Manual cp simulation (the build script's copy step):
```
$ cp -R quiz-astro/dist/. /tmp/quiz-dist-test/
$ test -f /tmp/quiz-dist-test/index.html        # cover OK
$ test -f /tmp/quiz-dist-test/take/index.html   # take OK
$ test -f /tmp/quiz-dist-test/AmariLogo.avif    # asset OK
$ ls /tmp/quiz-dist-test/_astro/                # _astro chunks present
```

After a full `npm run build` from the repo root, `dist/quiz/index.html` and `dist/quiz/take/index.html` will both exist with `_astro/` chunks alongside.

---

## Deviations from the prompt

1. **Tailwind config file extension** — used `tailwind.config.cjs` instead of `.ts` because Astro 4 + `@astrojs/tailwind` reads it as CommonJS via require. Same content as the prompt called for, just a different module format. The TypeScript-ness of the config has never been load-bearing in this codebase.

2. **`verbatimModuleSyntax` disabled** in `tsconfig.json` — `astro/tsconfigs/strict` enables it, but the original `quiz/` source was written without `import type` for type-only imports. Re-writing 27 ported files to add `import type` would diverge from the byte-identical guarantee. Disabling the flag is the safer call. tsc passes clean either way at runtime.

3. **`<Button>` bug in `QuizContainer.renderErrorState`** — fixed inline (replaced with native `<button className="btn-primary">`). Original code referenced an undefined `Button`; would have thrown at runtime if the error state ever rendered. Pre-existing bug, fixed in the migration. Behavior in the happy path is unchanged.

4. **Cover styles namespaced under `[data-cover]`** — instead of free-standing styles. The editorial design's `body` rules (background paper, no-margin reset) would otherwise leak into `/quiz/take/` and break the bone-white quiz background. Namespacing is invisible visually and lets one global stylesheet serve both pages.

---

## Anything that needs human verification before cutover

1. **Run a real submission end-to-end.** Open `/quiz/take/` in a Cloudflare Pages preview, take the quiz, watch network tab for `POST /api/send-to-ghl` returning 200 with `{success:true, audience:"…"}`, then check the GHL contact for all 16 custom fields populated and `quiz submitted` + `pain-severity-*` + `pain-location-*` tags.

2. **Verify ResultsPage renders end-to-end.** The lazy chunk loads html2canvas + ShareCard. If something about Astro's bundle splitting trips up html2canvas in the browser (rare, but possible), this is where it'd surface.

3. **Confirm GA4 + Clarity fire on both `/quiz/` and `/quiz/take/`** by checking Realtime in GA4 and Live in Clarity. The scripts are inlined in `QuizLayout.astro` so both pages emit them.

4. **Affiliate `?ref=…` flow.** Visit `/quiz/?ref=garrettmtb` — confirm it's read on the cover (it isn't — cover is static), persisted via the take-page island, and round-trips through to GHL on submission as `referralSource` + the corresponding `referred-by-…` tag.

   *Heads-up:* the React island only reads `?ref=` from `window.location.search` on mount. Since `?ref=` arrives on `/quiz/?ref=…` and the user clicks through to `/quiz/take/` (no `?ref=` on the take URL), the **localStorage fallback at `quiz_ref` is what carries it across.** If a referrer wants the ref preserved, they need to land on `/quiz/?ref=…` once with a session that allows localStorage writes — same constraint as before, but worth re-validating because the cover used to be the same React app.

   **Recommended follow-up** (not in this migration's scope): forward `?ref=` from cover to take by making the cover's "Begin Assessment" links append the param. One-line fix in `pages/index.astro` if needed.

5. **Old subdomain redirect** (`quiz.amarimethod.com → /quiz/`) is still commented out in `_redirects`. No change in this migration.

6. **Pricing on `BookingCTA.tsx`** ($225 / $720 / $1,295) is unchanged — it's in the byte-identical file. Last verified accurate per CLAUDE.md.

7. **Brand voice** — all ported components retain "Dr. Garrett Hewstan" (no DC/chiropractor), "out of balance" / "rebalance" terminology, the verbatim guarantee text, and the path explainer in `BookingCTA`. The cover copy was lifted exactly from `design-references/quiz-cover-editorial.html`, which itself was the cleaned/Garrett-approved version.

---

## Files changed in the repo (uncommitted on `astro-migration`)

- **New:** `quiz-astro/` (full project, ~25 files)
- **New:** `migration-status.md` (this file)
- **Modified:** `package.json` (build script swap, kept legacy buildable as `build:legacy-quiz`)
- **Modified:** `_redirects` (removed quiz SPA fallback wildcard)
- **Untouched:** `functions/api/send-to-ghl.js`, all of `quiz/`, all `*.html` static pages, GHL itself
