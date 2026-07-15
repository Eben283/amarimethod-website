# Amari site-v6 style guide

Universal reference for marketing HTML on `amarimethod-website`. **Source of truth for tokens/components:** `css/site-v6.css`. **Chrome injection:** `js/site-v6.js`. This doc is how to *use* them when building or restyling pages.

Last distilled: 2026-07-15 (from live site-v6 system).

---

## Stack (public pages)

| Piece | Path |
|--------|------|
| Design tokens + shared components | `/css/site-v6.css` (bump `?v=` when changing) |
| Header / footer / search / mobile nav | `/js/site-v6.js` |
| Fonts | Cormorant Garamond (serif) + General Sans (sans) |
| Photos | `/images/photos/` — see `images/photos/LIBRARY.md` |
| Protocol stills | `/images/v6/real/` |

Pages are static HTML. Per-page `<style>` only for unique sections. Do **not** invent a parallel stylesheet (`style-v5.css` is legacy).

Study signup / field tools still use site-v6 tokens and (except `field-signup`) shared chrome.

---

## Brand tokens

```css
--cream:   #F8F1E8;   /* page background */
--cream-2: #F1E7DA;   /* alt section / pagehead */
--paper:   #FCF7F1;   /* forms, panels, raised surfaces */
--tan:     #D8BB86;   /* color band 1 (gold) */
--peach:   #E1A98B;   /* color band 2 (terracotta) */
--sage:    #AFC1A9;
--ink:     #211D19;   /* near-black: text + primary buttons */
--body:    #5C554D;   /* secondary text */
--line:    rgba(33,29,25,.14);
--serif:   "Cormorant Garamond", Georgia, serif;
--sans:    "General Sans", ui-sans-serif, system-ui, sans-serif;
--ease:    cubic-bezier(0.32, 0.72, 0, 1);
--maxw:    1280px;
```

**Do not** introduce purple gradients, Inter/Roboto/system-only stacks, heavy multi-layer shadows, or decorative glow. Warm cream + ink + peach/tan is the language.

---

## Typography

| Role | Spec |
|------|------|
| Display / H1–H4 | `--serif`, weight 400–500, tight line-height (~1.12–1.14) |
| Emphasis in headlines | `<em>` italic inside the serif (common pattern) |
| Body | `--sans`, ~1.65 line-height, color `--body`, typically `max-width: 60ch` |
| Eyebrow / label | `--sans`, 11px, weight 600, uppercase, letter-spacing ~`.2em` |
| Button / CTA label | `--sans`, 12px, weight 600, uppercase, letter-spacing ~`.16em` |
| Wordmark | Serif, wide tracking (`.34em`); on scroll collapses to logomark |

Hero H1: white, `clamp(2.5rem, 5vw, 4.5rem)`, max ~16ch centered (default hero).

---

## Layout primitives

Use shared classes before inventing new ones:

1. **`.wrap`** — max-width `--maxw`, side padding 40px (22px under 860px).
2. **`.hero` + `.hero-bg` + `.hero-inner`** — full-bleed photo hero, dark scrim, centered copy. Image via inline `background-image` on `.hero-bg`.
3. **`.band.tan` / `.band.peach`** — split color + portrait (`band-copy` / `band-photo`). Use `.reverse` to flip photo side.
4. **`.pullquote`** — large serif quote; optional material crop background with cream scrim.
5. **`.appt`** — closing CTA block with curved cream-2 ellipse.
6. **Util `.pagehead`** — cream-2 headband for pages without a photo hero (gift card, study, legal-ish). Pad top enough for absolute header (~140px+).

Spacing: clamp sections (`clamp(64px, 8vw, 110px)` is a common rhythm). Prefer one purpose per section: one eyebrow, one headline, one short support line, one CTA group.

---

## Components

### Buttons

```html
<a class="btn" href="…">Primary</a>
<a class="btn btn-pale" href="…">On dark / soft</a>
<a class="btn btn-outline" href="…">Outline</a>
```

- Radius **2px** (near-rectangles). Never pill / rounded-full.
- Primary is ink fill + white small-caps type.
- Hover: slight lift (`translateY(-1px)`); respect reduced motion.

### Forms

Match contact / study patterns:

- Labels: eyebrow-style uppercase.
- Inputs: `--paper` fill, `1px solid var(--line)`, radius **2px**, focus border `--ink`.
- Errors: quiet red box, radius 2px — not rounded toaster cards.
- Submit with `.btn` (full-width on narrow forms is fine).

### Cards / tiles

**Default: no cards.** Borders, soft shadows, and 16–18px radii are the old study-sheet look — do not bring them back on public pages.

Use cards only when they contain a real interaction grid (e.g. home “This Just In” link tiles that need a hover media crop). If removing border/shadow/radius doesn’t hurt understanding, don’t use a card.

### Reveal motion

Add `class="reveal"` for scroll-in. Site JS enables `html.js-reveal`. Prefer 2–3 intentional motions per visually led page; honor `prefers-reduced-motion`.

---

## Page shell (copy this shape)

```html
<link rel="stylesheet" href="/css/site-v6.css?v=11">
<!-- page-specific <style> here -->
…
<body>
<!-- Header is injected by site-v6.js -->
<main class="…-page">
  <!-- hero OR pagehead -->
  <!-- sections -->
</main>
<!-- Footer is injected by site-v6.js -->
<script src="/js/site-v6.js?v=11" data-nav="method"></script>
</body>
```

`data-nav` values: `method` | `firstvisit` | `sessions` | `stories` | `about` | `partners` (omit on home).

Over a dark hero, header gets `.on-dark`. Scrolled header is fixed cream. Mobile chrome collapses ≤860px (hamburger + `.mobile-nav`).

Absolute paths for assets (`/css/…`, `/images/…`). Favicons as on other pages.

---

## Heroes & photography

### Hero rules

- Full-bleed / edge-to-edge image plane by default (`.hero-bg`).
- First viewport usually: brand (via header wordmark), one headline, one short sentence, one CTA — not stats strips, schedule chips, or floating badges over the photo.
- No detached promo stickers / labels floating on hero media.
- Brand must survive without the nav: the page should still feel Amari.

### Pose / variety (hard lesson)

Do **not** stack look-over-shoulder / right-third portraits page-wide. Prefer movement (protocols), face-forward, profile, or from-behind/from-activity shots. Reuse firefly/protocol stills from `images/v6/real/` when possible instead of another lifestyle glance.

### Library

- Publish from **KEEP** in `images/photos/LIBRARY.md`.
- Do not publish **SOURCE-ONLY** or **RETIRE**.
- Detail crops / materials: accents and pullquote backgrounds, not fake heroes.

---

## Copy & voice (visual surface)

- Eyebrows are category labels, not the brand.
- Headlines are calm, direct, serif — not loud SaaS slogans.
- CTA text: short verbs (`Book Now`, `Our Method`, `Join the study`).
- Outbound marketing elsewhere still follows vault voice skill; this guide owns the **UI surface**.

---

## Anti-patterns (reject on sight)

| Avoid | Prefer |
|--------|--------|
| Rounded 12–18px white cards + soft shadows | Cream page + hairline `--line` + paper panels |
| Terracotta filled pill buttons | Ink rectangular `.btn` |
| Inter / Roboto / pure system type | Cormorant + General Sans |
| Purple / indigo AI-gradient themes | Cream / ink / peach / tan |
| Inserted hero image in a media card | Full-bleed `.hero-bg` |
| Every section a bordered “feature card” | Open sections + bands + one CTA |
| Duplicate photos across adjacent tiles | Distinct KEEP / protocol assets |

---

## Related apps (lighter touch)

| Surface | Notes |
|---------|--------|
| Portal / staff / COS | React SPAs; when skinning, borrow cream / Cormorant / General Sans / ink buttons — don’t paste full marketing chrome blindly |
| Partner PWA | Own shell; keep Amari color warmth if touching UI |
| Field signup | Phone handoff — same tokens, may omit full site header |

---

## Checklist before shipping a page

- [ ] Links `site-v6.css` + ends with `site-v6.js`
- [ ] Uses token colors / fonts — no one-off palette
- [ ] Hero or pagehead clears absolute header
- [ ] Buttons are `.btn` (radius 2px)
- [ ] No gratuitous card chrome
- [ ] Photos from KEEP / protocol library; pose variety checked
- [ ] Mobile ≤860px: no broken nav; taps ≥ comfortable
- [ ] `?v=` bumped only if CSS/JS actually changed

---

## Where agents should look

1. This file (`DESIGN.md`)
2. Cursor rule `.cursor/rules/site-v6-design.mdc` (always-on hard rules)
3. `css/site-v6.css` / `js/site-v6.js`
4. Reference pages: `index.html`, `contact.html`, `gift-card-redeem.html`, `jaw-study.html`
5. Photo map: `images/photos/LIBRARY.md`
