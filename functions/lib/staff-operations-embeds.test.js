import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const headers = readFileSync(new URL('../../_headers', import.meta.url), 'utf8');
const globalPolicy = headers.slice(headers.lastIndexOf('\n/*\n')).split(/\r?\n/).find(line => line.trim().startsWith('Content-Security-Policy:'));
const directive = name => globalPolicy.split(';').map(part => part.trim().replace(/^Content-Security-Policy:\s*/, '')).find(part => part.startsWith(name + ' '))?.split(/\s+/).slice(1) || [];
const operationsSource = readFileSync(new URL('../../staff/src/pages/OperationsPage.tsx', import.meta.url), 'utf8');
const systemsSrc = operationsSource.match(/const SYSTEMS_SRC\s*=\s*(['"])([^'"]+)\1/)?.[2];
describe('Staff Operations embed destinations', () => {
  it('permits the same-origin Systems frame', () => { expect(directive('frame-src')).toContain("'self'"); });
  it('permits the exact Automation Watch worker', () => { expect(directive('frame-src')).toContain('https://reminder-engine.eben-fa2.workers.dev'); });
  it.each(['https://amarimethod.com','https://www.amarimethod.com'])('keeps Systems on the Staff host %s', origin => {
    expect(systemsSrc).toBe('/ops?embed=1');
    const target = new URL(systemsSrc, origin);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe('/ops');
    expect(target.searchParams.get('embed')).toBe('1');
  });
  it('keeps the destination allowlist explicit and preserves existing frames', () => {
    expect(directive('frame-src')).toEqual(expect.arrayContaining(['https://amari-crm-mirror.eben-fa2.workers.dev','https://challenges.cloudflare.com','https://link.amarimethod.com','https://amarimethodfollowup.amarimethod.com']));
    expect(directive('frame-src')).not.toContain('*'); expect(directive('frame-src')).not.toContain('https:'); expect(directive('frame-src').some(value => value.includes('*.workers.dev'))).toBe(false);
  });
  it('retains object, base URL and anti-framing protections', () => {
    expect(directive('object-src')).toEqual(["'none'"]); expect(directive('base-uri')).toEqual(["'self'"]); expect(headers).toContain('X-Frame-Options: SAMEORIGIN');
  });
});
