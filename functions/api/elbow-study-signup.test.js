import { describe, it, expect } from 'vitest';
import { splitName, isValidPhone } from './elbow-study-signup.js';

describe('splitName', () => {
  it('splits a two-word name into first and last', () => {
    expect(splitName('David Chen')).toEqual({ firstName: 'David', lastName: 'Chen' });
  });

  it('puts everything but the last word into firstName for multi-word names', () => {
    expect(splitName('Maria De La Cruz')).toEqual({ firstName: 'Maria De La', lastName: 'Cruz' });
  });

  it('handles a single-word name with an empty lastName', () => {
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });

  it('collapses extra whitespace', () => {
    expect(splitName('  David   Chen  ')).toEqual({ firstName: 'David', lastName: 'Chen' });
  });
});

describe('isValidPhone', () => {
  it('accepts a plain 10-digit number', () => {
    expect(isValidPhone('4155551234')).toBe(true);
  });

  it('accepts common real-world formatting', () => {
    expect(isValidPhone('(415) 555-1234')).toBe(true);
    expect(isValidPhone('+1 415-555-1234')).toBe(true);
  });

  it('rejects anything shorter than 10 digits', () => {
    expect(isValidPhone('555-1234')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});
