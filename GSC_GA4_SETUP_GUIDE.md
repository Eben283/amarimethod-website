# Google Search Console & GA4 Conversion Goals Setup Guide
**For Amari Method Website**
Last Updated: February 14, 2026

---

## 📋 Table of Contents
1. [Google Search Console Setup](#google-search-console-setup)
2. [GA4 Conversion Goals](#ga4-conversion-goals)
3. [Monitoring & Reporting](#monitoring--reporting)
4. [Troubleshooting](#troubleshooting)

---

## 🔍 Google Search Console Setup

### Step 1: Verify Domain Ownership

**Method 1: HTML File Upload (Recommended)**
1. Go to [Google Search Console](https://search.google.com/search-console)
2. Click "Start Now" → "URL prefix"
3. Enter: `https://www.amarimethod.com`
4. Google will provide an HTML file to download
5. Upload the file to your Cloudflare Pages root directory
6. Click "Verify" in GSC
7. Once verified, you can delete the HTML file

**Method 2: Meta Tag (Easiest if you have access to HTML)**
1. In GSC verification screen, select "HTML tag"
2. Copy the meta tag
3. Add to the `<head>` section of index.html:
   ```html
   <meta name="google-site-verification" content="YOUR_CODE_HERE">
   ```
4. Click "Verify"

**Method 3: Google Analytics (Works because GA4 is installed)**
1. In GSC, select "Google Analytics"
2. Select your GA4 property from the dropdown
3. Click "Verify"
4. This will instantly verify if GA4 is already tracking your site

### Step 2: Submit Your Sitemap

1. In GSC left menu, click "Sitemaps"
2. Enter the URL: `https://www.amarimethod.com/sitemap.xml`
3. Click "Submit"
4. GSC will crawl and index all pages listed in your sitemap

**Why this matters:**
- Tells Google about all 11 pages on your site
- Tells Google when each page was last updated
- Helps new pages get indexed faster (24-48 hours vs. weeks)
- Shows Google the priority of each page

**What to monitor:**
- Click on the submitted sitemap to see:
  - ✅ Pages successfully indexed
  - ⚠️ Pages found but not indexed
  - ❌ Pages with errors

### Step 3: Monitor Search Performance

Navigate to "Performance" in GSC left menu to see:

**4 Key Metrics:**
| Metric | What it means | Target |
|--------|---------------|--------|
| **Impressions** | Times your site appeared in search results | 100+ per month |
| **Clicks** | People who clicked through from search | 10-20% of impressions |
| **CTR** | Click-Through Rate (clicks ÷ impressions) | 3-5% is good for services |
| **Avg Position** | Where you rank (1 is top spot) | Top 10 (position <10) |

**How to use this data:**
1. Look at the "Queries" tab to see which keywords bring traffic
2. Identify which pages get the most clicks
3. See opportunities: Keywords showing high impressions but low CTR = improve title/description
4. Track ranking changes over time

**Example analysis:**
- "Pain relief San Francisco" gets 50 impressions, 2 clicks
- Your CTR is 4% (good)
- You rank #7 (page 1)
- **Action:** Try to get to #3 by improving page title to mention "San Francisco pain relief"

### Step 4: Fix Indexing Issues

If pages aren't being indexed:

1. Go to "Coverage" report
2. Look at "Errors" section
3. Common issues:
   - **404 Not Found** → Page doesn't exist or URL is wrong
   - **Excluded by robots.txt** → Check your robots.txt file
   - **Excluded by noindex tag** → Check for noindex meta tags
   - **Crawl anomaly** → Server issues; contact Cloudflare support

**How to fix for Amari Method:**
- All your pages should be "Indexed without issues" ✅
- If you see errors, check:
  1. Is the page actually live?
  2. Is there a noindex tag in the HTML?
  3. Is robots.txt blocking it? (Your file allows all pages)

### Step 5: Monitor Core Web Vitals

Go to "Experience" → "Core Web Vitals" to see:

**3 Critical Metrics:**
| Metric | What it measures | Good Score | Amari Method Target |
|--------|------------------|------------|-------------------|
| **LCP** | How fast main content loads | <2.5 seconds | <2 seconds |
| **FID** | How responsive page is to clicks | <100ms | <50ms |
| **CLS** | Layout shifts while loading | <0.1 | <0.05 |

**Your current status:**
- Images are optimized (96% reduction) ✅
- JavaScript is deferred ✅
- CSS is async-loaded ✅
- **Expected:** All three metrics should be in "Good" range

**If scores are poor:**
1. Check which pages have issues
2. Common fixes:
   - Lazy load more images
   - Compress additional assets
   - Defer more JavaScript
   - Use Cloudflare's image optimization

---

## 📊 GA4 Conversion Goals

### Understanding Conversions in GA4

A **conversion** (or "goal") is any important user action:
- Clicking "Book Session" button
- Submitting contact form
- Visiting booking page
- Spending 2+ minutes on site

**Why conversion goals matter:**
- Track which traffic sources actually convert
- See which pages lead to bookings
- Measure marketing ROI
- Identify drop-off points

### Step 1: Create "Book Session Click" Conversion

1. Open [Google Analytics](https://analytics.google.com)
2. Select your Amari Method property
3. Go to **Admin** (gear icon bottom left)
4. Under "Data collection and modification", click **Events**
5. Click **Create Event**

**Create Event for Book Session Clicks:**
- **Event Name:** `cta_button_click`
- **Matching Conditions:**
  - Parameter name: `button_text`
  - Operator: `contains`
  - Value: `Book`

This will automatically mark any click containing "Book" as a conversion.

**Alternative (More detailed):**
- **Event Name:** `cta_button_click`
- **Matching Conditions:**
  - Parameter: `button_text` contains `Book`
  - AND Parameter: `page_location` matches any of these:
    - `/` (homepage)
    - `/booking` (pricing page)
    - `/how-it-works` (engagement)

### Step 2: Create "Discovery Call Booking" Conversion

1. Go back to **Admin** → **Events**
2. Click **Create Event**
3. **Event Name:** `discovery_call_click`
4. **Matching Conditions:**
  - Parameter name: `link_text`
  - Operator: `contains`
  - Value: `Discovery`

This tracks clicks to external discovery call booking link.

### Step 3: Set Up Conversion Funnel

1. Go to **Reports** (left menu)
2. Click **Engagement** → **Funnel Exploration**
3. Create new exploration:
   - **Step 1:** Event = "page_view" where page_title = "Amari Method | Freedom From Pain"
   - **Step 2:** Event = "page_view" where page_location contains "/booking"
   - **Step 3:** Event = "cta_button_click" where button_text = "Book Session"
   - **Step 4:** Event = "external_link_click" where link_text = "Calendly" or "Book"

This shows: Homepage Visitors → Booking Page Views → Book Button Clicks → Actual Bookings

### Step 4: View Conversion Reports

1. Go to **Reports** → **Monetization** (or create custom report)
2. Select **Events** report
3. Add these columns:
   - Event name
   - Event count
   - Users
   - Conversion rate
   - Traffic source

**What to look for:**
- Which traffic source has highest `cta_button_click` events?
- Which pages have highest conversion rate?
- Are mobile visitors converting? (Filter by device)

### Step 5: Conversion Rate by Traffic Source

1. Create **Custom Report**
2. Dimensions: `Default Channel Group`, `Page Title`
3. Metrics: `Users`, `Sessions`, `Events` (cta_button_click), `Engagement Rate`

**Example interpretation:**
```
Organic Search:     500 users, 150 clicks = 30% conversion
Direct:             200 users, 40 clicks  = 20% conversion
Referral:           50 users, 5 clicks   = 10% conversion
```
→ Organic search is your most valuable source, invest in SEO!

---

## 📈 Monitoring & Reporting

### Weekly Checklist

Every Monday morning, spend 5 minutes on:

```
☐ Check GSC Performance:
  - Any new keywords discovered?
  - Ranking changes?
  - New indexing errors?

☐ Check GA4 Events:
  - Number of site visitors
  - Book Session clicks
  - Discovery call clicks
  - Scroll depth (engagement)

☐ Check conversion funnel:
  - Where are people dropping off?
  - Mobile vs desktop conversion rates
```

### Monthly Reporting

**First Friday of month - Create monthly summary:**

1. **Traffic Summary**
   - Total users
   - Total sessions
   - Traffic sources (%)
   - New vs returning (%)

2. **Conversion Summary**
   - Book Session clicks
   - Discovery call clicks
   - Conversion rate trend
   - Top converting pages

3. **Engagement Summary**
   - Average session duration
   - Bounce rate
   - Scroll depth distribution
   - Device breakdown

4. **Search Summary (GSC)**
   - Top keywords
   - Search visibility trend
   - Pages needing optimization

**Store in:** `AMARI_METHOD_MONTHLY_REPORTS` folder for tracking progress

---

## 🔧 Troubleshooting

### GA4 Not Tracking Events

**Problem:** You see page views but not clicks/conversions

**Solutions:**
1. Check if gtag is loading: Open browser DevTools (F12) → Console
   - Type: `typeof gtag`
   - Should return: `"function"`
   - If returns `"undefined"`, GA4 script isn't loading

2. Check event parameters:
   - Open DevTools → Network tab
   - Filter by "collect" (GA4 requests)
   - Look for events being sent to Google

3. Wait 24 hours: GA4 can take up to 24 hours to process events

### Pages Not Appearing in Google Search

**Problem:** Sitemap submitted but pages not indexed

**Solutions:**
1. Check GSC Coverage report for errors
2. Request indexing:
   - In GSC, search box at top: "https://www.amarimethod.com/page-name"
   - Click "Request indexing"
   - Google will crawl within 24-48 hours

3. Check robots.txt: Visit https://www.amarimethod.com/robots.txt
   - Should NOT have `Disallow:` (unless specific paths)
   - Should have `Sitemap:` pointing to sitemap.xml

### Low Conversion Rate

**Typical conversion rate** for service-based businesses: 2-5%
(100 visitors → 2-5 book sessions)

**If your rate is lower:**
1. "Book Session" button too hard to find?
   - Add button to more pages
   - Make button more prominent

2. People leaving at booking page?
   - Simplify the booking flow
   - Check if Calendly is loading slowly

3. Mobile visitors not converting?
   - Test website on phone
   - Check button is easy to click on mobile

**To improve:**
- A/B test button text ("Book Now" vs "Schedule Session")
- Add testimonials on booking page
- Show price upfront to filter price-sensitive visitors
- Add FAQ about booking process

---

## 📚 Quick Reference

### Important URLs

| Tool | URL |
|------|-----|
| Google Search Console | https://search.google.com/search-console |
| Google Analytics 4 | https://analytics.google.com |
| Google Business Profile | https://business.google.com |
| GA4 Event Builder | https://analytics.google.com → Events → Create |
| Your Sitemap | https://www.amarimethod.com/sitemap.xml |
| Your robots.txt | https://www.amarimethod.com/robots.txt |

### Key GA4 Events You Implemented

| Event | Triggers When |
|-------|---------------|
| `cta_button_click` | User clicks "Book Session" or similar button |
| `scroll_depth` | User scrolls to 25%, 50%, 75%, 100% of page |
| `page_engagement` | User stays on page for 30s, 60s, 120s, 300s |
| `form_interaction` | User clicks on form field |
| `external_link_click` | User clicks Amazon affiliate link |

### Interpretation Guide

| Metric | Good | Okay | Needs Work |
|--------|------|------|-----------|
| Conversion Rate | 5%+ | 2-5% | <2% |
| Avg Session Duration | 3+ min | 1-3 min | <1 min |
| Bounce Rate | <40% | 40-60% | >60% |
| Scroll Depth (50%+) | >70% users | 50-70% | <50% |
| Pages/Session | 2+ | 1.5-2 | <1.5 |

---

## 🎯 Next Steps

**This Week:**
1. Verify domain in Google Search Console (15 min)
2. Submit sitemap (2 min)
3. Create conversion goals in GA4 (10 min)

**This Month:**
1. Monitor GSC for keyword opportunities
2. Check conversion funnel for drop-offs
3. Identify top-performing pages and traffic sources

**This Quarter:**
1. Optimize pages with low scroll depth
2. Improve Core Web Vitals if needed
3. Test A/B variations of button text/CTAs

---

## ✅ Completion Checklist

Use this to track your setup:

```
GOOGLE SEARCH CONSOLE:
☐ Domain verified in GSC
☐ Sitemap submitted and indexed
☐ No errors in Coverage report
☐ Core Web Vitals checked (all "Good")
☐ Set up performance monitoring

GA4 CONVERSION GOALS:
☐ "cta_button_click" event created
☐ "discovery_call_click" event created
☐ Conversion funnel built
☐ Custom report created
☐ Monthly reporting template created

ONGOING:
☐ Weekly checklist scheduled (Monday 9 AM)
☐ Monthly report template ready
☐ Slack/email reminders set up
```

---

**Questions?** Refer back to this guide or visit:
- [GA4 Help Center](https://support.google.com/analytics)
- [Search Console Help](https://support.google.com/webmasters)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
