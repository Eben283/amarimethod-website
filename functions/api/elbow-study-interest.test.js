import { describe, it, expect } from 'vitest';
import { isValidEmail } from './elbow-study-interest.js';

describe('isValidEmail', () => {
  it('accepts a plausible email', () => {
    expect(isValidEmail('david@example.com')).toBe(true);
  });

  it('rejects missing @ or domain', () => {
    expect(isValidEmail('david@example')).toBe(false);
    expect(isValidEmail('davidexample.com')).toBe(false);
  });

  it('rejects empty or missing input', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});
