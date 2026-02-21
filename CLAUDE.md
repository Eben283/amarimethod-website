# Amari Method Website

## Stack
- Static HTML site + two React SPAs (quiz, portal) built with Vite
- **Cloudflare Pages** hosting + Pages Functions for serverless API routes
- **GoHighLevel (GHL)** as the CRM — contacts, appointments, custom fields, tags
- Portal auth: email magic link → JWT session token (30-day expiry, stored in localStorage)

## Repository Structure
```
my-new-website/
├── *.html                  # Static marketing pages
├── css/style-v5.css        # Main stylesheet + design tokens
├── js/main.js              # Site JS (GA4, menu toggle)
├── functions/api/          # Cloudflare Pages Functions (serverless)
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
| Sessions Remaining | `sessions_remaining` | Number |
| Portal Access | `portal_access` | Checkbox |
| Living Practice Access | `living_practice_access` | Checkbox |

## Pricing (current)
| Service | Price | Duration |
|---------|-------|----------|
| Initial Session | $225 | 60 min |
| Follow-up Session | $190 | 50 min |
| 4-Session Series | $720 | — |
| 8-Session Series | $1,295 | — (includes Living Practice) |
| Living Practice | $347 | standalone video program |
| Discovery Call | Free | 15 min |

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

## Protocol References
- Amari Method uses an **8-step protocol** (never 7-step — that was the old version)
- Session count for protocol: 8 (not 7, not 12)
