# Amari Method Website

A high-performance, SEO-optimized website for the Amari Method - natural back pain relief and body alignment therapy.

## Features

- **Conversion-Optimized Design** - Purpose-built to convert visitors to bookings
- **Mobile-First Responsive** - Beautiful on all devices
- **SEO Ready** - Structured for ranking on Google for high-intent keywords
- **Fast Performance** - Pure HTML/CSS/JS with no framework overhead
- **Accessible** - WCAG 2.1 compliant for all users

## Pages

- **Homepage** (`index.html`) - Main entry point with all key selling points
- **How It Works** (`how-it-works.html`) - Educational page explaining the Amari Method
- **About** (`about.html`) - Dr. Garrett Hewstan's story and credentials
- **Contact** (`contact.html`) - Contact form and information
- **Sitemap** (`sitemap.xml`) - For search engine crawling
- **Robots** (`robots.txt`) - For search engine directives

## Technical Stack

- **HTML5** - Semantic markup
- **CSS3** - Mobile-first responsive design with custom properties
- **JavaScript (Vanilla)** - No dependencies, no framework overhead
- **Performance** - Optimized for fast load times and Google PageSpeed

## Deployment

### Cloudflare Pages (Recommended)

1. Push this repository to GitHub
2. Log in to [Cloudflare Pages](https://pages.cloudflare.com)
3. Create a new project and select this repository
4. Build command: (leave empty)
5. Build output directory: (leave empty)
6. Point your domain (amarimethod.com) to Cloudflare Pages

### GitHub Pages

1. Push this repository to GitHub
2. Enable GitHub Pages in repository settings
3. Select main branch as source
4. Access your site at `yourusername.github.io/amarimethod-website`

## Local Development

Simply open `index.html` in your browser, or use a local server:

```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (if you have http-server installed)
http-server
```

Then visit `http://localhost:8000`

## SEO

### XML Sitemap
- Auto-generated sitemap at `/sitemap.xml`
- Submit to Google Search Console for indexing

### Meta Tags
- All pages optimized with:
  - Meta descriptions
  - OG tags for social sharing
  - Canonical URLs
  - Schema markup for LocalBusiness

### Performance
- Target: Lighthouse score >90
- All images optimized
- Minified CSS and JS
- No render-blocking resources

## File Structure

```
.
├── index.html              # Homepage
├── how-it-works.html       # How It Works page
├── about.html              # About Dr. Garrett
├── contact.html            # Contact page
├── css/
│   └── style.css           # All styles
├── js/
│   └── main.js             # All JavaScript
├── sitemap.xml             # XML sitemap
├── robots.txt              # Robot directives
└── README.md               # This file
```

## Key Features

### Homepage
- Conversion-optimized hero with guarantee
- Pain point section with statistics
- What makes Amari different (3 cards)
- How it works (3 steps)
- Service options (SF In-Person, Virtual, Program)
- Real testimonials
- FAQ section
- Multiple CTAs

### How It Works
- Problem section (why traditional approaches fail)
- Amari Method solution (5 steps)
- What to expect in first session
- Why it works
- FAQ

### About
- Dr. Garrett's story
- The turning point (asthma)
- The promise (Amari)
- 25 years of practice
- Dr. Hewstan's approach
- Client testimonials
- Core values

### Contact
- Contact information
- Contact form
- Quick access to booking options
- FAQ preview

## Analytics & Tracking

Google Analytics is configured in the page templates. Add your GA4 ID to enable tracking:

In the `<head>` of any HTML file:
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=YOUR_GA4_ID"></script>
```

## External Links

All booking and contact functionality integrates with:
- **Booking**: `https://www.amarimethod.com/booking` (Go High Level)
- **Assessment Quiz**: `https://quiz.amarimethod.com`
- **Discovery Call**: `https://discoverycall.amarimethod.com/discovery-call-booking`

## Future Enhancements

- Blog functionality (content added 2-4 weeks post-launch)
- Video testimonials
- Payment integration
- Client portal
- Email automation

## Support

For questions or issues, email: hello@amarimethod.com

---

Built with ❤️ for Dr. Garrett Hewstan and the Amari Method community.
