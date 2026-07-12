#!/usr/bin/env node
/**
 * Port the new-site mockups (vault ops/docs/) into this repo.
 *
 * What it does, per page:
 *  - rewrites mockup-filename links to real site URLs (extensionless)
 *  - rewrites asset paths (mockup-assets/ -> /images/v6/, amari-photos/ -> /images/photos/)
 *  - swaps shared css/js references to the ported css/site-v6.css + js/site-v6.js
 *  - makes absolute amarimethod.com links relative
 *  - points the two #appt CTA links at the real booking calendars
 *  - lifts <title>, meta description, and canonical from the page it replaces
 *    (SEO continuity), or uses the fallback for brand-new pages
 *  - injects favicon links, GA4, and Clarity (same IDs as the live site)
 *  - homepage only: carries the 3 REAL-WINNER photos over from the 7/8 home
 *    (per ops/docs/2026-07-12-site-image-slot-inventory.md)
 *
 * Run from the repo root:  node scripts/port-new-site.mjs [path-to-ops-docs]
 * Re-runnable: overwrites the target pages from the mockups each time.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SRC = process.argv[2] || join(homedir(), 'code/amari-method-docs/ops/docs');
const REPO = process.cwd();

if (!existsSync(join(SRC, 'amari-mockup.css'))) {
  console.error(`Source not found: ${SRC} does not look like ops/docs`);
  process.exit(1);
}

// mockup basename -> { url, file } ; url is what links become, file is what we write.
const PAGES = {
  '2026-07-10-amari-home-enriched.html':                      { url: '/',                                    file: 'index.html' },
  '2026-07-08-amari-how-it-works-mockup.html':                { url: '/how-it-works',                        file: 'how-it-works.html' },
  '2026-07-09-amari-first-visit-mockup.html':                 { url: '/first-visit',                         file: 'first-visit.html' },
  '2026-07-08-amari-about-mockup.html':                       { url: '/about',                               file: 'about.html' },
  '2026-07-09-amari-conditions-mockup.html':                  { url: '/conditions',                          file: 'conditions.html' },
  '2026-07-09-amari-condition-lower-back.html':               { url: '/lower-back-pain-san-francisco',       file: 'lower-back-pain-san-francisco.html' },
  '2026-07-09-amari-condition-neck.html':                     { url: '/neck-pain-san-francisco',             file: 'neck-pain-san-francisco.html' },
  '2026-07-09-amari-condition-shoulder.html':                 { url: '/shoulder-pain-san-francisco',         file: 'shoulder-pain-san-francisco.html' },
  '2026-07-09-amari-condition-hip.html':                      { url: '/hip-pain-san-francisco',              file: 'hip-pain-san-francisco.html' },
  '2026-07-09-amari-condition-knee.html':                     { url: '/knee-pain-san-francisco',             file: 'knee-pain-san-francisco.html' },
  '2026-07-09-amari-condition-sciatica.html':                 { url: '/sciatica-san-francisco',              file: 'sciatica-san-francisco.html' },
  '2026-07-09-amari-condition-tmj.html':                      { url: '/tmj-san-francisco',                   file: 'tmj-san-francisco.html' },
  '2026-07-09-amari-condition-plantar-fasciitis.html':        { url: '/plantar-fasciitis-san-francisco',     file: 'plantar-fasciitis-san-francisco.html' },
  '2026-07-09-amari-condition-chronic-pain.html':             { url: '/chronic-pain-san-francisco',          file: 'chronic-pain-san-francisco.html' },
  '2026-07-09-amari-journal-mockup.html':                     { url: '/blog',                                file: 'blog.html' },
  '2026-07-09-amari-journal-active-bridge-strength.html':     { url: '/blog-active-bridge-strength',         file: 'blog-active-bridge-strength.html' },
  '2026-07-09-amari-journal-back-pain-from-sitting.html':     { url: '/blog-back-pain-from-sitting',         file: 'blog-back-pain-from-sitting.html' },
  '2026-07-09-amari-journal-elbow-reset-tennis-elbow.html':   { url: '/blog-elbow-reset-tennis-elbow',       file: 'blog-elbow-reset-tennis-elbow.html' },
  '2026-07-09-amari-journal-hand-balancer-carpal-tunnel.html':{ url: '/blog-hand-balancer-carpal-tunnel',    file: 'blog-hand-balancer-carpal-tunnel.html' },
  '2026-07-09-amari-journal-jaw-align-tmj-relief.html':       { url: '/blog-jaw-align-tmj-relief',           file: 'blog-jaw-align-tmj-relief.html' },
  '2026-07-09-amari-journal-passive-bridge-mobility.html':    { url: '/blog-passive-bridge-mobility',        file: 'blog-passive-bridge-mobility.html' },
  '2026-07-09-amari-journal-power-posture-shoulder-blades.html': { url: '/blog-power-posture-shoulder-blades', file: 'blog-power-posture-shoulder-blades.html' },
  '2026-07-09-amari-journal-putting-it-all-together.html':    { url: '/blog-putting-it-all-together',        file: 'blog-putting-it-all-together.html' },
  '2026-07-09-amari-journal-sciatica-relief.html':            { url: '/blog-sciatica-relief',                file: 'blog-sciatica-relief.html' },
  '2026-07-09-amari-journal-spinal-wave-gentle-decompression.html': { url: '/blog-spinal-wave-gentle-decompression', file: 'blog-spinal-wave-gentle-decompression.html' },
  '2026-07-09-amari-journal-spring-step-calf-ankle.html':     { url: '/blog-spring-step-calf-ankle',         file: 'blog-spring-step-calf-ankle.html' },
  '2026-07-09-amari-journal-stretching-not-helping.html':     { url: '/blog-stretching-not-helping',         file: 'blog-stretching-not-helping.html' },
  '2026-07-09-amari-journal-suspension-squat-hanging-exercises.html': { url: '/blog-suspension-squat-hanging-exercises', file: 'blog-suspension-squat-hanging-exercises.html' },
  '2026-07-09-amari-journal-vertical-drop-spine-decompression.html': { url: '/blog-vertical-drop-spine-decompression', file: 'blog-vertical-drop-spine-decompression.html' },
  '2026-07-09-amari-journal-vs-physical-therapy.html':        { url: '/amari-method-vs-physical-therapy',    file: 'amari-method-vs-physical-therapy.html' },
  '2026-07-09-amari-journal-why-myofascial-release-doesnt-work.html': { url: '/blog-why-myofascial-release-doesnt-work', file: 'blog-why-myofascial-release-doesnt-work.html' },
  '2026-07-09-amari-journal-why-psoas-tightens-back.html':    { url: '/blog-why-psoas-tightens-back',        file: 'blog-why-psoas-tightens-back.html' },
  '2026-07-09-amari-pricing-mockup.html':                     { url: '/booking',                             file: 'booking.html' },
  '2026-07-09-amari-stories-mockup.html':                     { url: '/stories',                             file: 'stories.html' },
  '2026-07-11-amari-contact-mockup.html':                     { url: '/contact',                             file: 'contact.html' },
  '2026-07-09-amari-in-person-sessions.html':                 { url: '/in-person-sessions',                  file: 'in-person-sessions.html' },
  '2026-07-09-amari-virtual-sessions.html':                   { url: '/virtual-sessions',                    file: 'virtual-sessions.html' },
  '2026-07-11-amari-ongoing-care-mockup.html':                { url: '/ongoing-care',                        file: 'ongoing-care.html' },
  '2026-07-11-amari-living-practice-mockup.html':             { url: '/living-practice',                     file: 'living-practice.html' },
  '2026-07-11-amari-partner-mockup.html':                     { url: '/partner',                             file: 'partner.html' },
};

// Superseded mockups that other pages may still link to.
const LINK_ONLY = {
  '2026-07-08-amari-home-mockup.html': '/',
  '2026-07-09-amari-journal-article-mockup.html': '/blog',
  '2026-07-09-amari-partner.html': '/partner',
};

// Metadata for pages that do not replace an existing live page.
const NEW_PAGE_META = {
  'first-visit.html': {
    title: 'Your First Visit | Amari Method',
    description: 'What happens in your first Amari session: a full assessment, table work, and the start of a practice you keep. In San Francisco, 60 minutes.',
  },
  'stories.html': {
    title: 'Client Stories | Amari Method',
    description: 'What clients say after working with Garrett, in their own words. Backs, necks, jaws, hips, and the sessions that changed them.',
  },
  'living-practice.html': {
    title: 'The Living Practice | Amari Method',
    description: 'Ongoing membership for clients who finished a series and want to keep the work going with guided practice and periodic sessions.',
  },
};

const GA_CLARITY = `
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-DGQM32BMYZ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-DGQM32BMYZ');
</script>
<!-- Microsoft Clarity -->
<script>
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "vuvx43xu8h");
</script>`;

const FAVICONS = `
<link rel="icon" type="image/png" sizes="64x64" href="/favicon-light.png" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/png" sizes="64x64" href="/favicon-dark.png" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

function extractMeta(html) {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1];
  return { title, description, canonical };
}

function transform(html, target) {
  let out = html;
  const counts = {};

  // 1. mockup page links -> real URLs (preserve #fragments)
  for (const [basename, dest] of [
    ...Object.entries(PAGES).map(([k, v]) => [k, v.url]),
    ...Object.entries(LINK_ONLY),
  ]) {
    const re = new RegExp(`href="${basename.replace(/[.]/g, '\\.')}(#[^"]*)?"`, 'g');
    out = out.replace(re, (_, frag) => `href="${dest}${frag || ''}"`);
  }

  // 2. asset paths
  out = out.replaceAll('mockup-assets/', '/images/v6/');
  out = out.replaceAll('amari-photos/', '/images/photos/');
  out = out.replace(/href="amari-mockup\.css"/g, 'href="/css/site-v6.css"');
  out = out.replace(/src="amari-mockup\.js"/g, 'src="/js/site-v6.js"');

  // 3. absolute -> relative
  out = out.replaceAll('https://www.amarimethod.com/quiz/', '/quiz/');
  out = out.replaceAll('https://www.amarimethod.com/portal/', '/portal/');
  out = out.replaceAll('https://www.amarimethod.com/partner-app.html', '/partner-app');

  // 4. the two #appt CTA placeholders -> real booking calendars
  out = out.replace(/<a href="#" class="txt">Book a free 15-minute call\.<\/a>/g,
    '<a href="/book/discovery-call" class="txt">Book a free 15-minute call.</a>');
  out = out.replace(/<a href="#" class="btn">Book a Session<\/a>/g,
    '<a href="/book/initial-in-person" class="btn">Book a Session</a>');

  // 5. homepage: carry the REAL-WINNER photos over from the 7/8 home
  if (target.file === 'index.html') {
    out = out.replace('/images/v6/amari-cutout-journal.png', '/images/photos/hero-home-cedar-woman.jpg');
    out = out.replace('/images/v6/real/pull-up-bar.jpg', '/images/photos/living-practice-woman-asn35.jpg');
    out = out.replace('/images/v6/real/putting-it-all-together.jpg', '/images/photos/firstvisit-doorway-woman-wht48.jpg');
  }

  // 6. head: title / description / canonical from the replaced live page
  const oldPath = join(REPO, target.file);
  const old = existsSync(oldPath) ? extractMeta(readFileSync(oldPath, 'utf8')) : {};
  const fallback = NEW_PAGE_META[target.file] || {};
  const title = old.title || fallback.title;
  const description = old.description || fallback.description;
  const canonical = old.canonical ||
    `https://www.amarimethod.com${target.url === '/' ? '' : target.url}`;

  if (title) out = out.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  const headExtra = [
    description ? `<meta name="description" content="${description}">` : '',
    `<link rel="canonical" href="${canonical}">`,
    FAVICONS,
  ].filter(Boolean).join('\n');
  out = out.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n${headExtra}`);
  out = out.replace('</head>', `${GA_CLARITY}\n</head>`);

  // report leftover placeholders for the manual pass
  counts.placeholders = (out.match(/href="#"/g) || []).length;
  return { out, counts };
}

let totalPlaceholders = 0;
for (const [basename, target] of Object.entries(PAGES)) {
  const srcPath = join(SRC, basename);
  if (!existsSync(srcPath)) {
    console.error(`MISSING SOURCE: ${basename}`);
    process.exitCode = 1;
    continue;
  }
  const { out, counts } = transform(readFileSync(srcPath, 'utf8'), target);
  writeFileSync(join(REPO, target.file), out);
  totalPlaceholders += counts.placeholders;
  const flag = counts.placeholders ? `  <-- ${counts.placeholders} href="#" left` : '';
  console.log(`${target.file}${flag}`);
}
console.log(`\n${Object.keys(PAGES).length} pages written; ${totalPlaceholders} placeholder links remain for the manual pass.`);
