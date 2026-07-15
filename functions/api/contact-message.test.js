import { describe, it, expect } from 'vitest';
import { validateContactMessage } from './contact-message.js';

describe('validateContactMessage', () => {
  const good = {
    name: 'Dana Fields',
    email: 'dana@example.com',
    phone: '415-555-0100',
    message: 'My shoulder locks up when I reach overhead.',
  };

  it('accepts a complete submission and trims fields', () => {
    const v = validateContactMessage({ ...good, name: '  Dana Fields  ' });
    expect(v.error).toBeUndefined();
    expect(v.name).toBe('Dana Fields');
    expect(v.email).toBe('dana@example.com');
  });

  it('allows phone to be omitted', () => {
    const v = validateContactMessage({ ...good, phone: '' });
    expect(v.error).toBeUndefined();
    expect(v.phone).toBe('');
  });

  it('rejects missing name, bad email, or missing message', () => {
    expect(validateContactMessage({ ...good, name: '' }).error).toBeTruthy();
    expect(validateContactMessage({ ...good, email: 'nope' }).error).toBeTruthy();
    expect(validateContactMessage({ ...good, message: '   ' }).error).toBeTruthy();
  });

  it('rejects oversized fields', () => {
    expect(validateContactMessage({ ...good, name: 'x'.repeat(101) }).error).toBeTruthy();
    expect(validateContactMessage({ ...good, message: 'x'.repeat(4001) }).error).toBeTruthy();
    expect(validateContactMessage({ ...good, phone: '1'.repeat(31) }).error).toBeTruthy();
  });

  it('handles a null body without throwing', () => {
    expect(validateContactMessage(null).error).toBeTruthy();
  });
});
