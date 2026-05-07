# Results page editorial redesign — status

**Branch:** `results-editorial-redesign`
**Build:** clean (`npx astro build` succeeds, `npx tsc --noEmit` passes)
**Forbidden text:** `grep -ri "Salpeter\|Recovery Stall\|Pattern v\|Confidence: Strong" quiz-astro/src/` returns nothing.

## What changed in each file

### `quiz-astro/src/components/results/ResultsPage.tsx`
Full rewrite. Now:
- Wraps everything in `<div data-results>` and emits a `<style>` block with the editorial design system tokens (`--paper`, `--paper-2`, `--ink`, `--ink-2`, `--mute`, `--line`, `--line-2`, `--accent: #C56B4E`) scoped exclusively under `[data-results]` so it can't bleed outside the React island.
- Renders the new top-to-bottom order: doc-bar → ResultsHero → share strip → ConditionStory (why-3-up + protocol video + chain) → Examiner's Note → Offer card (BookingCTA) → Aside links → Appendix `<details>` (collapsed) wrapping InsightCards + ScoreRadar + ScoreCard grids → doc-foot.
- Computes the recovery-word label (`High` / `Good` / `Moderate` / `Limited`) once and threads it into the hero.
- Builds booking URLs centrally (`buildBookingUrl`) and passes the function down to `BookingCTA` so child knows nothing about pain-location encoding.
- Examiner's Note paragraphs reference the live `patternSignature` value (no roman numerals, no fabricated codes) and sign off `— Dr. Garrett`.
- Uses **Dr. Garrett Hewstan** verbatim in the examiner-id block.
- Lazy-import contract preserved — file still default-exports `ResultsPage` from the same path.

### `quiz-astro/src/components/results/ResultsHero.tsx`
Full rewrite.
- Drops the rounded card / shadow / radar ring presentation.
- Stamp eyebrow renders the actual `patternSignature` value (e.g. `§ Protective Tension`) in a 1px clay border.
- Display headline: "You're not broken. You're *out of balance.*" — italicized + clay accent on "out of balance". `firstName` removed from the headline (universal copy per brief). Prop kept as optional to preserve QuizContainer call-site.
- Italic display sub: "Your readings show a body that *can rebalance* — it just hasn't been given the right input to start."
- Hairline 2-cell meta row: **Pattern** (signature value) and **Recovery potential** (italic word + numeric percent). Confidence cell removed (no real data per brief).

### `quiz-astro/src/components/results/ConditionStory.tsx`
Full rewrite to editorial classes (`section-head`, `eyebrow`, `cred-grid`, `chain-grid`, `video-frame-outer`).
- "Why your X keeps hurting" 3-up: 3 vertical cells separated by hairline rules, mono numeral 01/02/03 in clay, display title, sans body. No card boxes.
- Protocol video block: italic display pull-quote (Garrett's actual framing line) above a 1px-dotted outer wrap with corner ticks containing a paper-2 frame around the `<video>`. Mono caption row + sans note about session-1 hands-on guidance.
- "Where X pain actually comes from" chain grid: top hairline rule across the 3 (or 4) steps, mono numeral + flow eyebrow + display title + sans body.
- Foot link: italic "Want the full breakdown? Read the full {location} page →" wired to `content.conditionPageSlug`.
- Heading italicization handled by a `renderItalicTail` helper that handles all 4 known suffix shapes ("keeps hurting", "keeps coming back", "comes from", "actually comes from") and falls back to italicizing the last two words, so hip's heading ("Why your hip pain keeps coming back") still gets the right emphasis.
- Protocol-name italicization handled by `renderProtocolName` — strips leading "The " and italicises the noun phrase.

### `quiz-astro/src/components/results/BookingCTA.tsx`
Full rewrite as editorial offer card.
- 1px solid `--ink-2` border. Paper-2 head row: "Initial Session · 60 min · In person or virtual" + "Recommended" pill in clay.
- Two-pane body: left = `$225` display numeral + mono "ONE SESSION · NO PACKAGE REQUIRED" + small sans note. Right = "WHAT'S INCLUDED" eyebrow + 4-bullet `<ul>` (✦ glyphs in clay), with the **How the path works** sub-card nested below it (1px hairline border, mono "Today: / After session 1: / Before session 2:" labels, sans body — copy verbatim from brief).
- Single primary CTA: "**Book your session →**" — links to `/book-initial-in-person` with pain query string. Dual In-Person/Virtual split removed; head copy notes "in person or virtual" and the CTA fine print echoes it.
- Guarantee paragraph reproduced **verbatim** below the CTA: "**Satisfaction guaranteed.** If you don't experience noticeable relief, we keep working with you until you do, at no additional charge."
- Below the offer card: editorial blockquote for `matchedTestimonial` (large italic display quote, mono cite line). About-style.
- Drops the Discovery-call CTA (the page-level aside-links row in `ResultsPage` covers it).
- Drops the referral pill / `audience` / virtual-preference logic — neither was load-bearing for the editorial layout.
- Now accepts `buildBookingUrl` as a prop instead of duplicating the logic.

### `quiz-astro/src/components/results/InsightCards.tsx`
Full rewrite.
- Section header uses `.eyebrow` + display h2 + italic lede (matches other sections).
- Insights render as a hairline-divided list: mono `01 / 02 / 03 ...` numeral in clay + display title + sans body. No card boxes, no left accent bars, no rounded corners, no shadows.
- "The Missing Piece" gradient callout removed (didn't fit the editorial system; the same idea is now carried by the examiner's note + offer card upstream).
- All Tailwind chromatic classes replaced with inline `--paper / --ink / --accent / --mute` palette colors.

### `quiz-astro/src/components/results/ScoreRadar.tsx`
Full rewrite.
- Section header uses editorial classes.
- Radar SVG recolored: paper-2 background panel inside a 1px dotted `--line-2` wrap; grid hex strokes in `--line-2`; data polygon stroked in `--accent` with 18% fill; data dots in `--accent` ringed in paper. Score-bar legend on the right uses 2px hairline tracks with clay fills and italic display percentages — no green/orange/red severity ramp.
- Mobile: radar + legend stack at <720px (handled by an injected `@media` rule scoped under `[data-results]`).

### `quiz-astro/src/components/results/ScoreCard.tsx`
Full rewrite.
- Pure inline styles, editorial palette only.
- 2px hairline progress track + clay fill (no severity-based green/red palette).
- Severity word (Minimal / Mild / Moderate / Significant) printed in mono-clay above the description (no chromatic dots or pills).
- `compact` and full variants both retained for the appendix two-column / three-column score grid.

### `quiz-astro/src/components/results/ShareCard.tsx`
**Untouched** per brief.

## Files NOT modified (per brief constraints)
- `quiz-astro/src/contexts/QuizContext.tsx` — DO NOT TOUCH
- `quiz-astro/src/components/QuizContainer.tsx`
- `quiz-astro/src/components/QuizApp.tsx`
- `quiz-astro/src/lib/conditionContent.ts`
- `quiz-astro/tailwind.config.cjs` — no changes needed; all editorial styling is scoped CSS injected by `ResultsPage`. Existing `amari-*` tokens were left alone since the redesign uses the canonical token names directly.
- `quiz-astro/src/layouts/QuizLayout.astro` — already loads Bona Nova + Inter + JetBrains Mono via the Google Fonts URL, no changes needed.

## New components
None. The doc-bar is rendered inline in `ResultsPage.tsx` (~15 lines of JSX) — pulling it into a separate `DocBar.tsx` would have added a file with a single call site and no reuse, which violates the project's high-cohesion preference. If a second editorial page needs the same bar later, extract then.

## Notes / human verification

1. **Examiner's Note copy** is templated against `patternSignature`. Garrett may want to read the three paragraphs and adjust per-pattern wording — the current copy reads as universal "your reading came back as X, here's what I'd do next" framing that should hold across all five signatures, but a pattern-specific tweak per signature is doable in a second pass.
2. **Hero meta row** has only two cells (Pattern / Recovery potential). Confidence was dropped per brief. If a third meta cell becomes desirable later (e.g. "Time to first relief · Most clients · Session 1"), `.hero-meta` is already set up as a CSS grid that auto-redistributes to N columns.
3. **Aside links** point to `/book-discovery-call` (with pain param) and `https://www.amarimethod.com/booking`. Confirm those are the canonical destinations.
4. **`firstName` prop on ResultsHero** is now optional and unused — kept on the type signature so QuizContainer's existing call site stays byte-identical, but the editorial headline is universal. If we later want a personalized greeting, it would belong in the doc-bar `.center` slot, not the headline.
5. **Mobile radar layout** — the appendix wraps ScoreRadar in a `cred-cell`-less `appendix-body` flex column. At 360px wide, the 360px-max radar drops to one column and stacks above the legend. Verified via the mobile media-query rule.
6. **Build output:** `dist/_astro/ResultsPage.C6cC8HeQ.js` is 263 KB un-gzipped (64 KB gzipped) — about the same as before, no new heavyweight imports.
