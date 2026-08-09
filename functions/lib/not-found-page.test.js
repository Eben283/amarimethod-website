import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const page = await readFile(new URL('../../404.html', import.meta.url), 'utf8');

describe('public not-found page', () => {
  it('uses the current Amari shell and gives visitors useful recovery paths', () => {
    expect(page).toContain('/css/site-v6.css');
    expect(page).toContain('/js/site-v6.js');
    expect(page).toContain('That path ends here.');
    expect(page).toContain('href="/"');
    expect(page).toContain('href="/assessment-booking"');
    expect(page).toContain('href="/contact"');
  });

  it('does not retain the retired logo navigation and footer', () => {
    expect(page).not.toContain('AmariLogo.avif');
    expect(page).not.toContain('Freedom From Pain. Results For Life.');
    expect(page).not.toContain('portal-btn-secondary');
  });
});
