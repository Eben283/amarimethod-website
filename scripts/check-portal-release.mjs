import { readFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`Portal release check failed: ${message}\n`);
  process.exit(1);
}

const dashboard = readFileSync('portal/src/pages/PracticeDashboardPage.tsx', 'utf8');
const css = readFileSync('portal/src/styles/portal.css', 'utf8');
const headers = readFileSync('_headers', 'utf8');
const distHeaders = readFileSync('dist/_headers', 'utf8');
const nav = readFileSync('portal/src/components/PortalNav.tsx', 'utf8');
const staffApp = readFileSync('staff/src/App.tsx', 'utf8');
const staffDesk = readFileSync('staff/src/pages/ClientDeskPage.tsx', 'utf8');
const mirrorDesk = readFileSync('crm-mirror-worker/src/client-desk.js', 'utf8');

if (headers !== distHeaders) fail('root and deployed dist CSP headers differ');
if (!nav.includes('/images/identity/amari-method-wordmark.svg') || nav.includes('/images/AmariLogo.avif')) {
  fail('portal header is not using the current public wordmark');
}

// These features were formerly deployed from an unmerged artifact and were
// subsequently overwritten by an ordinary main deployment. Keep their source
// ownership explicit so an auto-deploy can never regress them invisibly again.
for (const [source, marker, label] of [
  [staffApp, 'path="communications"', 'Staff Communications route'],
  [staffDesk, 'amari:staff-send-sms', 'Staff-to-Desk SMS relay'],
  [mirrorDesk, 'Reply by SMS', 'inline Client Desk SMS composer'],
  [mirrorDesk, '.sort((left, right)', 'chronological Client Desk mirror ordering'],
]) {
  if (!source.includes(marker)) fail(`missing ${label}`);
}

for (const className of ['cp-practice-main', 'cp-practice-masthead', 'cp-practice-next', 'cp-practice-shape', 'cp-practice-grid', 'cp-practice-living', 'cp-practice-upcoming']) {
  if (!dashboard.includes(`className="${className}`)) fail(`dashboard no longer renders ${className}`);
  if (!css.includes(`.${className}{`)) fail(`missing stylesheet rule for ${className}`);
}

for (const csp of headers.match(/Content-Security-Policy:.*$/gm) || []) {
  if (!csp.includes("media-src 'self' blob:")) {
    fail('an effective CSP rule does not allow HLS MediaSource blob URLs');
  }
  for (const domain of ['https://*.cloudflarestream.com', 'https://*.videodelivery.net']) {
    if (!csp.includes('media-src') || !csp.includes(domain)) {
      fail(`an effective CSP rule does not allow Stream media from ${domain}`);
    }
    if (!csp.includes('connect-src') || !csp.includes(domain)) {
      fail(`an effective CSP rule does not allow Stream network requests to ${domain}`);
    }
  }
}

process.stdout.write('Portal release checks passed.\n');
