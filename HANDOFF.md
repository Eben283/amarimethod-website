# Handoff Notes — Feb 22, 2026

All changes pushed to `main` as commit `d65ff56`. Cloudflare is deploying now.

---

## ✅ What Was Done (No Action Needed)

### Portal — Critical Bug Fixed
**Booking modal was showing wrong times.**
`portal-slots.js` was calling `new Date(isoSlot).getHours()` which returns UTC time in Cloudflare Workers.
Fixed by extracting hour/minute directly from the ISO string. If a slot was 11:30 AM Mountain Time,
it was previously showing as 6:30 PM. Now correct.

### Portal — Gift Cards Section Added
QuickActions now has a "Gift Cards" section at the bottom with:
- **"Buy a Gift Card"** — currently shows "Coming soon" (needs a URL, see below)
- **"Redeem a Gift Card"** — tap to see instructions on how to use a code at checkout

### Performance — Major Speed Improvements
**Before:** Mobile PageSpeed 74, LCP 4.7s
**Expected after:** Mobile 85+, desktop stays at 99

What was done:
- Converted all 23 JPG images to WebP (70–84% smaller on average)
  - `foam-roller-v2.jpg` 328KB → 95KB. `yoga-block.jpg` 329KB → 95KB. `vertical-drop.jpg` 179KB → 29KB.
- Updated all HTML img src references to use `.webp`
- Removed Google Fonts `@import` from CSS (was blocking page render for ~1.3s on mobile)
- Added `<link rel="stylesheet">` for fonts directly in HTML head on all pages
- Added Google Fonts `preconnect` to 5 pages that were missing it
- Added `fetchpriority="high"` to hero video cover preload

---

## ⚡ What Needs Eben (Quick Tasks)

### 1. Gift Card checkout URL (5 minutes)
**Location:** `portal/src/components/QuickActions.tsx`, line ~18
**What to do:**
1. Go to GHL → Payments → Gift Cards
2. Create a gift card (suggested denominations: $225, $190, $720, $1,295)
3. Copy the shareable checkout link
4. Replace the empty `GIFT_CARD_URL = ''` with the URL
5. Rebuild portal: `cd portal && npx vite build`
6. Commit + push

```js
// Current (line ~18):
const GIFT_CARD_URL = '';

// Change to:
const GIFT_CARD_URL = 'https://your-ghl-gift-card-checkout-url-here';
```

### 2. Verify GHL_LOCATION_ID in Cloudflare env vars (2 minutes)
**Why:** `portal-book.js` has a hardcoded fallback `7pIO7FHVAyBT1jKGhfQM`.
If this is your correct GHL location ID (it is — it matches what's in GHL URLs),
booking will work fine. But for cleanliness, add it as an env var:
- Cloudflare Dashboard → Pages → amarimethod-website → Settings → Environment Variables
- Add: `GHL_LOCATION_ID` = `7pIO7FHVAyBT1jKGhfQM`

### 3. Test the booking modal (5 minutes)
After deploy finishes (~3 min from push), log into the portal and:
1. Click "Book a Session"
2. Confirm slot times match what's actually in GHL calendar
3. Book a test appointment and cancel it

---

## 🔮 Next Up When Ready

### Gift Card — already built, just needs the URL
See item #1 above.

### Run PageSpeed again after deploy
Current score is based on the old JPG-serving live site.
After Cloudflare deploys the WebP + font changes, re-run:
https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fwww.amarimethod.com%2F
Expected: Mobile jumps from 74 → ~85-88.

### Accessibility: 94 → 100
PageSpeed shows 94 on accessibility. To see specific issues:
https://pagespeed.web.dev → Mobile → Accessibility section

---

## 📌 Current PageSpeed Scores (pre-deploy, old JPGs)
| | Mobile | Desktop |
|--|--|--|
| Performance | 74 | 99 |
| Accessibility | 94 | 94 |
| Best Practices | 100 | 100 |
| SEO | 100 | 100 |

**Expected after this deploy:**
| | Mobile | Desktop |
|--|--|--|
| Performance | ~85+ | 99 |

---

## 🚫 Known Limitations (Nothing Broken, Just Notes)
- **Gift card balance display in portal**: Not possible — GHL has no public API for gift card balances. The portal can only link out to GHL checkout for purchase/redemption.
- **SessionHistory `allAppointments` naming**: Prop is named `allAppointments` but receives only past appointments. This is intentional and correct — completed status only appears on past appointments, so the lifetime counter is accurate. Code comment added.
