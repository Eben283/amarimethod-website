# Amari Method Website

## Stack
- Static HTML site + two React SPAs (quiz, portal) built with Vite
- **Cloudflare Pages** hosting + Pages Functions for serverless API routes
- **GoHighLevel (GHL)** as the CRM — contacts, appointments, custom fields, tags
- Portal auth: email magic link → JWT session token (30-day expiry, stored in localStorage)

## Repository Structure
```
amarimethod-website/
├── *.html                  # Static marketing pages
├── DESIGN.md               # Universal site-v6 style guide (agents: read first)
├── css/site-v6.css         # Design tokens + shared components
├── js/site-v6.js           # Header/footer/search/mobile chrome
├── js/main.js              # Legacy site JS (prefer site-v6 on public pages)
├── functions/api/          # Cloudflare Pages Functions (serverless) (subset — see directory)
│   ├── portal-auth.js      # POST: send magic link email
│   ├── portal-verify.js    # GET: validate magic link → session token
│   ├── portal-data.js      # GET: fetch client data from GHL
│   └── portal-cancel.js    # POST: cancel appointment via GHL
├── portal/                 # React portal SPA (Vite + TypeScript + Tailwind)
│   ├── src/
│   │   ├── pages/          # LoginPage, DashboardPage
│   │   ├── components/     # PortalNav, ProgressTracker, SessionHistory, QuickActions
│   │   ├── lib/api.ts       # Fetch wrapper with auth headers
│   │   ├── hooks/          # useClientData, useAuth
│   │   ├── contexts/       # AuthContext
│   │   └── types/portal.ts # TypeScript interfaces
│   └── vite.config.ts      # base: /portal/, outDir: ../dist/portal
├── quiz/                   # React quiz SPA (same pattern as portal)
├── dist/portal/            # Portal build output (deployed by Cloudflare)
├── dist/quiz/              # Quiz build output
└── _redirects              # SPA fallback routes for Cloudflare Pages
```

## Build Commands
```bash
npm run build               # Builds both quiz and portal
cd portal && npx vite build # Build portal only
cd quiz && npx vite build   # Build quiz only
```

## GHL API
- **Base URL**: `https://services.leadconnectorhq.com`
- **Auth**: `Authorization: Bearer ${GHL_API_KEY}` + `Version: 2021-07-28` header
- **Private Integration**: "Claude AIP for quiz" in GHL → Settings → Private Integrations
- **Scopes**: contacts.read/write, customFields.read/write, tags.read/write, calendars/events.read/write
- **Key endpoints**:
  - `GET /contacts/{id}` — Contact details + custom fields
  - `GET /contacts/{id}/appointments` — All appointments for contact
  - `PUT /calendars/events/appointments/{id}` — Update appointment (cancel = `{ appointmentStatus: "cancelled" }`)
  - `GET /contacts/lookup?email={email}` — Find contact by email

## ⚠️ Cloudflare Pages Function Gotchas
- **NEVER return `status: 502`** from a Pages Function — Cloudflare intercepts it and replaces the response body with its own HTML error page. Use 422 for upstream API errors.
- **NEVER return `status: 503`** for the same reason. Safe error codes: 400, 401, 403, 404, 422, 500.
- Environment variables are accessed via `context.env.VAR_NAME`
- CORS headers must be set manually on every response
- **Pages Functions can't cross-import from sibling `functions/api/*.js` files.** Cloudflare bundles each function as its own route entry, so `import { foo } from "./portal-data.js"` makes the importing function fail to register and every request returns **404** (not 401/422/500) while other functions on the project work fine. Shared helpers go in `functions/lib/` (e.g. `lib/auth.js`, `lib/ghl.js`, `lib/session-ledger.js`, `lib/portal-helpers.js`). Lift the helper to `lib/` first, update both call sites, then import from `../lib/...`. Lost ~30 min on 2026-05-06 during the stream-token rollout to this exact 404.

## Deploy & Editorial-Page Gotchas
> Relocated 2026-07-09 from ops memory (`feedback_rebuild_staff_dist`, `feedback_partner_page_css`) into the repo they describe. Whys/dates preserved.

### Rebuild + force-add `dist/<spa>` after every SPA source change
Editing `staff/src/**` (or `portal/`, `quiz/`, `cos/` src) does NOT deploy unless you rebuild the SPA and force-add the new `dist/` artifacts. Cloudflare Pages serves committed files from `dist/`; `dist/` is gitignored at root, so new/updated files in `dist/staff/` are ignored by `git add` unless you use `-f`:
```bash
cd staff && npx vite build && cd ..
git add -f dist/staff/index.html dist/staff/assets/   # hashed asset names change every build
git add staff/src/*.ts staff/src/**/*.tsx functions/api/*.js
git commit -m "..." && git push
```
Skip this and the backend change deploys (Functions need no build) but the frontend keeps serving the OLD JS bundle. You'll spend hours debugging why a fix isn't landing. Happened 2026-04-10. Same for `dist/portal/`, `dist/quiz/`, `dist/cos/`. Does NOT apply to `functions/**` or static root HTML (both auto-deploy from source).

### `style-v5.css` global selectors hijack new editorial pages
When rebuilding a marketing page with the editorial design system, production `style-v5.css` injects styles via global selectors that override the new design. Lost ~20 commits on the 2026-05-04 partner-page redesign because each round only surfaced one conflict. Before shipping any new editorial page, scope your inline `<style>` under a unique main class (e.g. `main.partner-page`) AND override these:

| Production selector | What it does | Override needed |
|---|---|---|
| `.hero` | `text-align: center`, `background: var(--bg-secondary)`, `border-bottom: 1px solid var(--color-border)` | Force `text-align: left`, explicit `background: var(--paper)` (NOT `transparent` — production bg shows through in some specificity contexts), `border-bottom: 0` |
| `.hero h1` | `font-size: clamp(2.2rem, 10vw, 4rem)` | Your own clamp + `!important` (specificity tie at `0,2,1`) |
| `.hero-label` | Dark rounded pill (`background: var(--color-text)`, `color: white`, `border-radius: 20px`) | Reset to transparent + inherit for a flat eyebrow |
| Global `<header>` | Sticky white bg | Use `<section>` instead of `<header>` for hero blocks |

Background gotcha: `body { background }` from style-v5.css shows in the gutters around a constrained 1360px hero. If the top reads as a different cream tone, force `body { background: var(--paper) !important; }` inside the page's inline `<style>`. Pattern that works: wrap page content in `<main class="partner-page">` and prefix every inline selector with that class; production CSS still cascades to nav/footer (intentional).

## Cloudflare Deployment
- **Project**: `amarimethod-website` on Cloudflare Pages
- **Env vars**: Set in Cloudflare Dashboard → Pages → amarimethod-website → Settings → Environment Variables
- Required vars: `JWT_SECRET`, `GHL_API_KEY`
- Deploys automatically on git push to main (or via Cloudflare dashboard)

## Portal Auth Flow
1. User enters email → `POST /api/portal-auth` → GHL lookup → generate JWT → trigger GHL email workflow
2. User clicks magic link → `GET /api/portal-verify?token=xxx` → validate JWT → return 30-day session token
3. All subsequent API calls: `Authorization: Bearer {sessionToken}` header
4. Session stored in `localStorage` as `portal_token`

## GHL Custom Fields (portal progress tracking)
| Label | Key | Type |
|-------|-----|------|
| Series Type | `series_type` | Dropdown: none / 4-session / 8-session |
| Sessions Completed | `sessions_completed` | Number |
| Sessions Remaining | `sessions_remaining` | Number — raw value is stale; the derived ledger is truth (see memory `feedback-session-count-semantics`) |
| Portal Access | `portal_access` | Checkbox |
| Living Practice Access | `living_practice_access` | Checkbox |

## Pricing (current)
| Service | Price | Duration | Notes |
|---------|-------|----------|-------|
| Initial Session | $225 | 60 min | |
| Follow-up Session | $190 | 50 min | |
| 4-Session Series | $720 | — | Available to anyone at any time |
| 8-Session Series | $1,295 | — (includes Living Practice) | Available to anyone at any time |
| Upgrade: 1 Initial → 4-Session | $495 | — | Credit upgrade only — $225 already paid applied toward $720. ONLY if client has purchased exactly 1 initial session. |
| Upgrade: 1 Initial → 8-Session | $1,070 | — | Credit upgrade only — $225 already paid applied toward $1,295. ONLY if client has purchased exactly 1 initial session. |
| Living Practice | $347 | standalone video program | |
| Discovery Call | Free | 15 min | |

## Key URLs
- Live site: https://www.amarimethod.com
- Live portal: https://www.amarimethod.com/portal/
- Follow-up booking: https://amarimethodfollowup.amarimethod.com/booking-single-amari-method-followup-session

## Design Tokens
- Accent warm (progress bars, highlights): `#EBA584` / `amari-accent-warm`
- Charcoal (headings): `amari-charcoal`
- Light sand (card backgrounds): `amari-light-sand`
- CSS utility classes: `portal-card`, `portal-btn-secondary`
- Font: Serif for headings, sans-serif for body

## Positioning & Brand

> ⚠️ **SUPERSEDED (2026-07-01):** the "locked 2026-04-17" section below predates an ACTIVE California Board Accusation against Garrett (deadline July 16 — see `ops/open-todos.md` ⚖️ LEGAL and memory `legal_garrett_chiro_accusation.md`). It instructed "Dr. Garrett Hewstan," "A doctor who teaches you to heal yourself," and "let it work silently" — all now legally prohibited framing. **Do not use any Dr./doctor/chiropractor language when writing or editing copy for this site.** Current brand voice: somatic/movement/CMT educator, Garrett as founder (see memory `feedback_garrett_founder_framing.md`, `brand_amari_real_age_team_runway.md`). The terminology rules below for protocols/woo-language/Network Spinal are still current; only the Dr./doctor framing is retired.

### Terminology rules
| Use | Don't use |
|-----|-----------|
| Protocols | Exercises |
| 8 core protocols | 8-step protocol |
| Garrett Hewstan | Dr. Garrett Hewstan, Chiropractor, DC, chiropractic |
| Out of balance / rebalancing | Muscle imbalances, compensation patterns |
| Guide / coach | Healer (for Garrett) |
| "Your body can heal you" | "Fix" |
| Gateway positions | (don't source to Network Spinal) |

### Don't mention
- Network Spinal / NSA — Garrett doesn't want the association
- Dr./doctor/chiropractor/DC framing in any form — active legal restriction, see warning above
- Specific client counts (don't say "200+ clients") — let testimonials speak
- Woo language (reorganizational healing, body-mind-spirit, energetic harmony)

### Copy voice
- Write like a person explaining something they care about
- No AI copywriter patterns (dramatic fragments, em dash overuse, forced punchline endings)
- Garrett's actual phrases are better than paraphrases
- Read every line as a skeptical visitor would hear it
- If it's not true, don't write it

### Design direction
- Warm, grounded, confident. Not clinical, not woo.
- Premium but approachable. Think Aesop, not hospital.
- Fonts: Bona Nova (serif headings), DM Sans (body)
- Colors: warm sand (#f5efe8), charcoal (#3A3A3A), accent warm (#EBA584)

### Rewrite brief
Full positioning document with all transcript insights and decisions: `../../amari/content/website-rewrite-brief.md`
