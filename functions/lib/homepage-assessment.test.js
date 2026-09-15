import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync('index.html', 'utf8');
const siteCss = readFileSync('css/site-v6.css', 'utf8');
const booking = readFileSync('assessment-booking.html', 'utf8');
const calendarCss = readFileSync('css/amari-calendar.css', 'utf8');

describe('homepage Assessment booking', () => {
  it('hands the $29 Assessment off to its dedicated booking page', () => {
    expect(home).toContain('id="book-assessment"');
    expect(home).toContain('Start with a $29 Assessment.');
    expect(home).toContain('<a href="/assessment-booking" class="btn">Choose a time</a>');
    expect(home.match(/href="#book-assessment"/g)).toHaveLength(3);
    expect(home).not.toContain('<iframe');
  });

  it('does not carry embedded-booking messaging on the homepage', () => {
    expect(home).not.toContain('assessmentBookingFrame');
    expect(home).not.toContain('amari-assessment-checkout');
  });

  it('keeps the deployed static files exact with their sources', () => {
    expect(readFileSync('dist/index.html', 'utf8')).toBe(home);
    expect(readFileSync('dist/assessment-booking.html', 'utf8')).toBe(booking);
    expect(readFileSync('dist/css/site-v6.css', 'utf8')).toBe(siteCss);
    expect(readFileSync('dist/css/amari-calendar.css', 'utf8')).toBe(calendarCss);
  });

  it('cache-busts the changed public stylesheets', () => {
    expect(home).toContain('/css/site-v6.css?v=site-20260915-assessment');
    expect(booking).toContain('/css/site-v6.css?v=site-20260915-assessment');
    expect(booking).toContain('/css/amari-calendar.css?v=calendar-20260915-assessment');
  });
});

describe('locked public type floors', () => {
  it('encodes the shared 16px reading, 14px action, and 12px utility floors', () => {
    expect(siteCss).toContain('--type-reading-min:16px');
    expect(siteCss).toContain('--type-action-min:14px');
    expect(siteCss).toContain('--type-utility-min:12px');
    expect(siteCss).toContain('font-size:var(--type-action-min)');
  });

  it('keeps the dedicated booking flow at those same floors', () => {
    expect(booking).toContain('.book-headline { font-family: var(--serif); font-weight: 400; font-size: clamp(42px, 5vw, 56px)');
    expect(booking).toContain('.checkbox-row > span { flex: 1; font-family: var(--sans); font-size: 16px');
    expect(booking).toContain('.btn-primary-pill { display: inline-flex;');
    expect(booking).toContain('font-size: 14px; font-weight: 600; letter-spacing: 0.08em');
    expect(calendarCss).toContain('font-size: 12px;');
  });
});
