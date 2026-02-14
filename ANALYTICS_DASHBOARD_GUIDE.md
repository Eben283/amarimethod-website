# Amari Method Analytics Dashboard Guide
**Your personal guide to understanding website performance**

---

## 🎯 The 5 Most Important Metrics

### 1. **Visitors (Users)**
**"How many people visit my website?"**

Where to find it:
- GA4 → Reports → Overview → "Users" (top left)

What's good:
- Week 1-2: 10-30 visitors
- Month 1: 50-200 visitors
- Month 3: 200-500 visitors
- Month 6: 500+ visitors (if marketing active)

What it means:
- More visitors = more potential customers
- If growth is flat, you need more marketing (ads, SEO, referrals)

---

### 2. **Conversion Rate (Booking Clicks)**
**"What percentage of visitors click 'Book Session'?"**

Where to find it:
- GA4 → Reports → Events → Filter for "cta_button_click"
- Calculation: (Clicks ÷ Users) × 100

What's good:
- 2% = 100 visitors = 2 book session clicks ✓ GOOD
- 5% = 100 visitors = 5 book session clicks ✓ EXCELLENT
- <1% = needs optimization

Example:
- Week 1: 50 visitors, 1 click = 2% (healthy)
- Week 4: 200 visitors, 15 clicks = 7.5% (excellent!)

**How to improve:**
- Add more "Book Session" buttons to pages
- Make button more prominent/colorful
- Add social proof/testimonials near button
- Test different button text ("Book Now" vs "Schedule Session")

---

### 3. **Scroll Depth (Engagement)**
**"Do people actually read my content?"**

Where to find it:
- GA4 → Reports → Engagement → Scroll Depth
- Shows: % of users who scrolled to 25%, 50%, 75%, 100%

What's good:
| Scroll Depth | % of Users | Meaning |
|--------------|-----------|---------|
| 25% | >85% | People are reading |
| 50% | >70% | Content is engaging |
| 75% | >50% | Very good engagement |
| 100% | >30% | Excellent (bottom CTA working) |

Example dashboard:
```
Homepage:
  25% scrolled: 92% of visitors ✓ GOOD
  50% scrolled: 68% of visitors ✓ GOOD
  75% scrolled: 41% of visitors ✓ AVERAGE
  100% scrolled: 22% of visitors ⚠️  Could add more CTA

Booking Page:
  25% scrolled: 94% of visitors ✓ EXCELLENT
  50% scrolled: 87% of visitors ✓ EXCELLENT
  75% scrolled: 72% of visitors ✓ EXCELLENT
  100% scrolled: 58% of visitors ✓ EXCELLENT
```

**How to improve:**
- Pages with low 25% scroll: Add compelling headline/hero image
- Low 50% scroll: Move important content higher
- Low 75% scroll: Add more testimonials/social proof
- Low 100% scroll: Add CTA at the end (button, email signup)

---

### 4. **Traffic Source**
**"Where do my visitors come from?"**

Where to find it:
- GA4 → Reports → Acquisition → Traffic source
- Shows breakdown of: Organic Search, Direct, Referral, Paid

Typical breakdown:
```
Organic Search: 40% (Google)    ← Best source, free
Direct:         30% (Typed URL)  ← Returning customers
Referral:       20% (Links)      ← Social, partners
Paid:           10% (Ads)        ← If you run ads
```

What each means:
- **Organic Search** = People finding you on Google (FREE! 🎉)
- **Direct** = People typing your URL directly (loyal customers)
- **Referral** = People clicking links from other sites/social
- **Paid** = Traffic from ads you paid for

**Action items:**
- If organic is <30%: Improve SEO (more keywords, better meta descriptions)
- If referral is low: Share more on social media, get link partnerships
- If direct is high: Existing customers love you ✓

---

### 5. **Click-Through Rate (CTR) by Page**
**"Which pages are most popular?"**

Where to find it in Google Search Console:
1. Go to https://search.google.com/search-console
2. Click "Performance"
3. See "Avg. CTR" column
4. Look at "Pages" tab to see which pages get clicked most

Example:
```
Homepage:           3.2% CTR (benchmark: 2-4%)
Booking page:       5.1% CTR (benchmark: 3-6%)
Tools page:         1.8% CTR (benchmark: 1-3%)
About page:         0.9% CTR (benchmark: 0.5-1.5%)
```

What it means:
- Higher CTR = people want to visit that page
- Lower CTR = title/description not compelling
- If CTR for booking page is high but conversions are low = fix booking process

---

## 📊 Daily Dashboard (5 minutes)

Create a routine where you check these EVERY DAY:

**Login to GA4:**
https://analytics.google.com

```
TODAY'S QUICK CHECK:

☐ Real-Time Report (top right)
  → How many people on site RIGHT NOW?
  → What page are they on?

☐ Overview Card
  → Users: ___ (compare to yesterday)
  → Sessions: ___
  → Engagement Rate: ___%
  → Avg Session Duration: __ min

☐ Top Pages (scroll down)
  → Which pages got most traffic today?
  → Any unusual activity?

Time required: 3-5 minutes
Frequency: Once per day (preferably 10 AM)
```

---

## 📈 Weekly Dashboard (15 minutes)

Every Monday morning, check these:

**GA4:**
```
Last 7 days metrics:

Users:                _____ (↑ or ↓ from last week?)
Sessions:             _____
Avg Session Duration: _____ min
Bounce Rate:          _____% (should be <60%)

Top Traffic Sources (write down top 3):
1. _____________ (____%)
2. _____________ (____%)
3. _____________ (____%)

Top Pages (write down top 3):
1. _____________ (_____ users)
2. _____________ (_____ users)
3. _____________ (_____ users)

Events:
- Book Session Clicks: _____
- Discovery Call Clicks: _____
- Scroll Depth 50%+: _____%
```

**Google Search Console:**
```
Last 7 days metrics:

Total Impressions: _____ (times shown in search)
Total Clicks: _____ (times people clicked to website)
Avg CTR: ____% (goal: 3-5%)
Avg Position: ____ (goal: top 10)

New keywords discovered (top 5):
1. _____________
2. _____________
3. _____________
4. _____________
5. _____________

Trend: ⬆️ ⬇️ → (up, down, or flat?)
```

**Action item:**
- If flat: Need more content or marketing
- If ⬆️: Keep doing what you're doing!
- If ⬇️: Check for issues (penalties, competition, seasonal)

---

## 📅 Monthly Dashboard (30 minutes)

First Friday of every month, create a summary:

### Monthly Report Template

```
AMARI METHOD - MONTHLY ANALYTICS REPORT
Month: __________ Year: ______

═══════════════════════════════════════════════════════════

TRAFFIC SUMMARY:

Total Users:          _____
Total Sessions:       _____
New Users:            ____% (goal: 30-50% new)
Returning Users:      ____% (goal: 50-70% returning)
Bounce Rate:          ____% (goal: <60%)

Growth vs Last Month:
  Users:              ↑ ___% or ↓ ___% or →
  Sessions:           ↑ ___% or ↓ ___% or →
  Engagement:         ↑ ___% or ↓ ___% or →

═══════════════════════════════════════════════════════════

CONVERSION SUMMARY:

Book Session Clicks:     _____ (goal: 2-5% of users)
Discovery Call Clicks:   _____ (goal: 0.5-1% of users)
Total CTA Clicks:        _____
Conversion Rate:         ____% (goal: 3-5%)

By Traffic Source:
  Organic (Google):      ____% conversion
  Direct:                ____% conversion
  Referral:              ____% conversion
  Other:                 ____% conversion

Best Performing Page:    _____________ (____% conversion)
Worst Performing Page:   _____________ (____% conversion)

═══════════════════════════════════════════════════════════

ENGAGEMENT SUMMARY:

Avg Session Duration:    _____ min (goal: 2-3 min)
Pages Per Session:       _____ (goal: 1.5-2.5 pages)
Engagement Rate:         ____% (goal: >50%)

Scroll Depth Breakdown:
  25% (basic interest):  ____% of users
  50% (interested):      ____% of users
  75% (highly engaged):  ____% of users
  100% (read entire):    ____% of users

Most Engaged Page:       _____________ (____% 50%+ scrolls)
Least Engaged Page:      _____________ (____% 50%+ scrolls)

═══════════════════════════════════════════════════════════

SEARCH SUMMARY (from Google Search Console):

Total Impressions:       _____ (goal: +10% month over month)
Total Clicks:            _____ (goal: +10% month over month)
Avg CTR:                 ____% (goal: 3-5%)
Avg Position:            _____ (goal: improving)

Pages Indexed:           _____ / 11 (all should be indexed)
Pages with Errors:       _____ (goal: 0)

Top 5 Keywords:
1. _____________ (______ clicks)
2. _____________ (______ clicks)
3. _____________ (______ clicks)
4. _____________ (______ clicks)
5. _____________ (______ clicks)

New Keywords Found:      ______ (goal: 3-5 new per month)

═══════════════════════════════════════════════════════════

DEVICE BREAKDOWN:

Mobile Users:            ____% (goal: 50-70%)
Desktop Users:           ____% (goal: 30-50%)
Tablet Users:            ____% (goal: <5%)

Mobile Conversion Rate:  ____% (compare to desktop)
Mobile Bounce Rate:      ____% (should be similar to desktop)

═══════════════════════════════════════════════════════════

KEY OBSERVATIONS & ACTIONS:

Wins this month:
- _______________________________________________
- _______________________________________________
- _______________________________________________

Challenges:
- _______________________________________________
- _______________________________________________
- _______________________________________________

Changes to make next month:
- _______________________________________________
- _______________________________________________
- _______________________________________________

═══════════════════════════════════════════════════════════
```

---

## 🎯 Setting Up Automatic Reports

You can email yourself reports automatically!

**GA4 Automatic Reports:**
1. GA4 → Reports → Any report
2. Click "Share" → "Schedule email"
3. Choose frequency: Daily, Weekly, Monthly
4. Enter your email
5. Done! Reports come to your inbox

**Recommended setup:**
- Weekly: Overview report (Mondays 9 AM)
- Monthly: Conversion report (1st of month 9 AM)

---

## 🚀 What Success Looks Like

### Month 1: Baseline
- Traffic: 100-200 visitors
- Conversions: 2-5 clicks
- Search: Site getting indexed
- Status: ✓ On track

### Month 3: Growth
- Traffic: 500-1000 visitors
- Conversions: 25-50 clicks
- Search: Ranking for some keywords
- Status: ✓ Healthy growth

### Month 6: Scaling
- Traffic: 1000-3000+ visitors
- Conversions: 50-100+ clicks
- Search: Page 1 for target keywords
- Status: ✓ Sustainable growth

---

## 🆘 Troubleshooting Dashboard Issues

**"GA4 shows 0 visitors"**
- Wait 24-48 hours for data to process
- Check that GA script is on all pages
- Visit your site from different browser/device to trigger tracking

**"Conversion rate is 0%"**
- Events take 24 hours to appear
- Verify "cta_button_click" event is being created in Admin → Events
- Test by clicking Book Session button yourself

**"Google Search Console shows nothing"**
- Domain takes 24-48 hours to verify
- Sitemap takes 24-48 hours to fully index
- Check if any pages are blocked by robots.txt

**"Traffic suddenly dropped"**
- Check if there's a website issue (click a few pages)
- Check Google Search Console for errors/penalties
- Check Cloudflare analytics for traffic issues
- Contact support if issue persists

---

## 📞 Need Help?

Reference guides:
- **Detailed Setup:** GSC_GA4_SETUP_GUIDE.md
- **Quick Checklist:** QUICK_START_CHECKLIST.txt
- **GA4 Help:** https://support.google.com/analytics
- **GSC Help:** https://support.google.com/webmasters

---

**Last Updated:** February 14, 2026
**Status:** Website fully analytics-enabled ✓
