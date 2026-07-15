#!/usr/bin/env node
/**
 * Static link + asset checker for the site.
 * For every root *.html page (plus book/ and the injected header/footer in
 * js/site-v6.js): verify each internal href resolves to a file, directory
 * app, or _redirects rule, and every referenced image exists on disk.
 * Anchors (#id) are checked against the target page's ids.
 * Run from repo root: node scripts/check-site-links.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const problems = [];

const redirects = existsSync(join(ROOT, '_redirects'))
  ? readFileSync(join(ROOT, '_redirects'), 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split(/\s+/)[0])
  : [];

// SPA / directory apps that resolve on Pages but not as flat files
const DIR_APPS = ['/portal/', '/quiz/', '/staff/', '/cos/', '/book/'];

function fileForUrl(url) {
  const clean = url.replace(/[?#].*$/, '');
  if (clean === '/' || clean === '') return 'index.html';
  const rel = clean.replace(/^\//, '');
  const candidates = [rel, `${rel}.html`, `${rel}/index.html`];
  return candidates.find(c => existsSync(join(ROOT, c)));
}

function idsIn(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
}

const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'))
  .concat(readdirSync(join(ROOT, 'book')).filter(f => f.endsWith('.html')).map(f => `book/${f}`));

const pageCache = {};
function pageHtml(file) {
  if (!(file in pageCache)) pageCache[file] = readFileSync(join(ROOT, file), 'utf8');
  return pageCache[file];
}

// header/footer/search markup is injected by site-v6.js — check its links too
const sharedJs = readFileSync(join(ROOT, 'js/site-v6.js'), 'utf8');
const sharedLinks = [...sharedJs.matchAll(/href="([^"]+)"|u: '([^']+)'/g)]
  .map(m => m[1] || m[2]).filter(Boolean);

function checkLink(source, url) {
  if (/^(https?:|mailto:|tel:|sms:|javascript:)/.test(url)) return;
  if (url.startsWith('#')) {
    const html = source === 'js/site-v6.js' ? '' : pageHtml(source);
    if (url !== '#' && html && !idsIn(html).has(url.slice(1))) {
      problems.push(`${source}: dead in-page anchor ${url}`);
    }
    if (url === '#') problems.push(`${source}: placeholder href="#"`);
    return;
  }
  const [path, frag] = url.split('#');
  if (DIR_APPS.some(d => path === d || (path.startsWith(d) && fileForUrl(path)))) {
    if (path.match(/^\/(portal|quiz|staff|cos)\//)) return; // SPA routes
  }
  const resolved = fileForUrl(path.startsWith('/') ? path : `/${path}`);
  if (!resolved) {
    if (redirects.includes(path)) return;
    problems.push(`${source}: broken link ${url}`);
    return;
  }
  if (frag) {
    const ids = idsIn(pageHtml(resolved));
    if (!ids.has(frag)) problems.push(`${source}: link ${url} -> ${resolved} has no id="${frag}"`);
  }
}

function checkAsset(source, path) {
  if (/^(https?:|data:)/.test(path)) return;
  const rel = path.replace(/^\//, '').replace(/[?#].*$/, '');
  const base = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  if (!existsSync(join(ROOT, rel)) && !existsSync(join(ROOT, base, rel))) {
    problems.push(`${source}: missing asset ${path}`);
  }
}

for (const page of pages) {
  // Skip <script> bodies: hrefs inside JS strings are runtime-populated.
  const html = pageHtml(page).replace(/<script[\s\S]*?<\/script>/g, m =>
    /src="/.test(m.slice(0, 200)) ? m.match(/src="[^"]+"/)?.[0] || '' : '');
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    const url = tag.match(/href="([^"]+)"/)?.[1];
    if (!url) continue;
    // href="#" on an id'd anchor is a JS-wired control, not a placeholder
    if (url === '#' && /\bid="/.test(tag)) continue;
    if (/\.(css|png|jpg|jpeg|webp|avif|svg|ico|woff2?)(\?|$)/.test(url)) checkAsset(page, url);
    else checkLink(page, url);
  }
  for (const m of html.matchAll(/<link\b[^>]*href="([^"]+)"/g)) {
    if (/\.(css|png|jpg|jpeg|webp|avif|svg|ico|woff2?)(\?|$)/.test(m[1])) checkAsset(page, m[1]);
  }
  for (const m of html.matchAll(/src="([^"]+)"/g)) checkAsset(page, m[1]);
  for (const m of html.matchAll(/url\('([^']+)'\)/g)) checkAsset(page, m[1]);
}
for (const url of sharedLinks) {
  if (url.includes("' +")) continue; // template concatenation, not a URL
  checkLink('js/site-v6.js', url);
}

if (problems.length) {
  const unique = [...new Set(problems)];
  console.error(`${unique.length} problem(s):`);
  for (const p of unique) console.error('  ' + p);
  process.exit(1);
}
console.log(`${pages.length} pages checked, all internal links and assets resolve.`);
