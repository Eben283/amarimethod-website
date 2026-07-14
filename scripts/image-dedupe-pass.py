#!/usr/bin/env python3
"""Pre-launch image dedupe + home CONFIRM cleanup for feat/new-site."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# --- index.html ---
p = ROOT / "index.html"
t = p.read_text()

t = t.replace(
    "background-image:url('/images/photos/chronic-pain-woman-asn61.jpg')",
    "background-image:url('/images/photos/hero-home-cedar-woman.jpg')",
    1,
)
t = t.replace(
    "  .hero-pause{position:absolute;right:34px;bottom:30px;color:#fff;opacity:.7;font-size:13px;letter-spacing:.1em}\n\n",
    "",
)
t = t.replace('  <div class="hero-pause">❚❚</div>\n', "")
t = t.replace(
    '<div class="band-fig"><img src="/images/photos/hero-home-cedar-woman.jpg" alt="An Amari client, reaching to test her range of motion"></div>',
    '<div class="band-fig"><img src="/images/photos/black-woman38-window-seat.jpg" alt="An Amari client, seated by a window after practice"></div>',
)

old_ins = (
    '        <div class="faq-answer">The Amari Method does not bill health insurance directly. '
    "You pay for each session yourself.<!-- CONFIRM: confirm whether Affirm or another payment-plan "
    "option is currently offered at checkout. Add that detail here if so. --> Many HSA and FSA plans "
    "allow reimbursement for care like this, but it depends on your specific plan, so check with "
    "your plan administrator before booking.<!-- CONFIRM: confirm whether Amari currently provides "
    "a receipt for HSA/FSA submission. Add that detail here if so. --></div>"
)
new_ins = (
    '        <div class="faq-answer">We don\'t bill insurance directly, but we provide a superbill '
    "on request that you can submit for possible reimbursement. Affirm is available at checkout for "
    "series. Many HSA and FSA plans allow reimbursement for care like this, but it depends on your "
    "specific plan, so check with your plan administrator before booking.</div>"
)
if old_ins not in t:
    raise SystemExit("insurance FAQ block missing")
t = t.replace(old_ins, new_ins)

old_loc = (
    '        <div class="faq-answer">The practice sees clients in person in San Francisco and works '
    "with people across the Bay Area, plus virtually anywhere in the world.<!-- CONFIRM: confirm the "
    "exact studio address/neighborhood before publishing if it should be named here. No street "
    "address is asserted in this draft. --> You get the exact location and directions when you book. "
    "Virtual sessions cover the same protocols over video, so distance isn't a barrier.</div>"
)
new_loc = (
    '        <div class="faq-answer">Clients are seen in person in San Francisco\'s Richmond District, '
    "and virtually anywhere. Exact address and directions come with your booking confirmation. "
    "Virtual sessions cover the same protocols over video, so distance isn't a barrier.</div>"
)
if old_loc not in t:
    raise SystemExit("location FAQ block missing")
t = t.replace(old_loc, new_loc)

old_ins_schema = (
    '"text": "The Amari Method does not bill health insurance directly. You pay for each session '
    'yourself. Many HSA and FSA plans allow reimbursement for care like this, but it depends on '
    'your specific plan, so check with your plan administrator before booking."'
)
new_ins_schema = (
    '"text": "We don\'t bill insurance directly, but we provide a superbill on request that you can '
    "submit for possible reimbursement. Affirm is available at checkout for series. Many HSA and "
    "FSA plans allow reimbursement for care like this, but it depends on your specific plan, so "
    'check with your plan administrator before booking."'
)
t = t.replace(old_ins_schema, new_ins_schema)

old_loc_schema = (
    "The practice sees clients in person in San Francisco and works with people across the Bay Area, "
    "plus virtually anywhere in the world. You get the exact location and directions when you book. "
    "Virtual sessions cover the same protocols over video, so distance isn't a barrier."
)
new_loc_schema = (
    "Clients are seen in person in San Francisco's Richmond District, and virtually anywhere. "
    "Exact address and directions come with your booking confirmation. Virtual sessions cover "
    "the same protocols over video, so distance isn't a barrier."
)
t = t.replace(old_loc_schema, new_loc_schema)

t = t.replace('"ratingValue": "4.9"', '"ratingValue": "5"')
t = t.replace('"ratingCount": "CONFIRM_REAL_GOOGLE_REVIEW_COUNT"', '"ratingCount": "5"')
t = t.replace(
    "See the CONFIRM comments inline for facts that need Eben's sign-off before this goes live.",
    "Facts below aligned to faq.html + GBP baseline (5.0★ / 5 reviews as of 2026-06). "
    "Re-check review count before merge if GBP has moved.",
)
t = t.replace(
    "JSON-LD: draft schema. See CONFIRM notes above and the\n"
    "     ratingCount placeholder below before shipping to production.",
    "JSON-LD: aggregateRating from Google Business Profile baseline "
    "(2026-06-08: 5.0 / 5 reviews). Update ratingCount if GBP has moved before merge.",
)

p.write_text(t)
print(f"index.html OK, CONFIRM left: {t.count('CONFIRM')}, hero-pause left: {t.count('hero-pause')}")

# --- Hero swaps (first hero-bg url only) ---
swaps = {
    "how-it-works.html": (
        "/images/photos/hero-home-cedar-woman.jpg",
        "/images/photos/black-man42-room-roller.jpg",
    ),
    "hip-pain-san-francisco.html": (
        "/images/v6/real/passive-bridge.jpg",
        "/images/photos/hip-woman-wht60-doorway.jpg",
    ),
    "sciatica-san-francisco.html": (
        "/images/v6/real/hand-balancer.jpg",
        "/images/photos/sciatica-man-wht50.jpg",
    ),
    "plantar-fasciitis-san-francisco.html": (
        "/images/v6/real/active-bridge.jpg",
        "/images/photos/plantar-woman-multi41.jpg",
    ),
    "lower-back-pain-san-francisco.html": (
        "/images/v6/real/back-pain-from-sitting.webp",
        "/images/photos/condition-base/lower-back-refined.jpg",
    ),
    "shoulder-pain-san-francisco.html": (
        "/images/photos/condition-base/shoulder.jpg",
        "/images/photos/condition-base/shoulder-refined.jpg",
    ),
    "contact.html": (
        "/images/v6/real/hand-balancer.jpg",
        "/images/photos/partner-yoga-woman-wht38.jpg",
    ),
    "living-practice.html": (
        "/images/v6/real/elbow-reset.jpg",
        "/images/photos/living-practice-woman-asn35.jpg",
    ),
    "in-person-sessions.html": (
        "/images/photos/living-practice-woman-asn35.jpg",
        "/images/photos/inperson-logistics-woman-wht45.jpg",
    ),
    "ongoing-care.html": (
        "/images/v6/real/putting-it-all-together.jpg",
        "/images/photos/journal-base/jh-spinal-wave-refined.jpg",
    ),
    "knee-pain-san-francisco.html": (
        "/images/photos/knee-man-his44.jpg",
        "/images/photos/knee-man-his44-window.jpg",
    ),
}

for page, (old, new) in swaps.items():
    pt = ROOT / page
    txt = pt.read_text()
    marker = f"background-image:url('{old}')"
    if marker not in txt:
        m = re.search(r"hero-bg[^>]+url\(['\"]?([^'\")]+)", txt)
        print(f"WARN {page}: expected {old}, actual {(m.group(1) if m else None)}")
        continue
    pt.write_text(txt.replace(marker, f"background-image:url('{new}')", 1))
    print(f"{page}: → {new}")

print("done")
