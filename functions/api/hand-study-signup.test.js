import { describe, it, expect, vi } from 'vitest';

// Capture what the endpoint sends to GHL instead of hitting the network.
// Mirrors the parity note in NOTES.txt: this file exists because the
// helpers are byte-identical to the tested elbow-study-signup.js, plus one
// mocked-POST check that the tag/source/Study-Name are built from the
// STUDIES["hand"] registry entry, not hardcoded.
const ghlFetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ contact: { id: 'contact_123' } }),
}));
vi.mock('../lib/ghl.js', () => ({ ghlFetch: (...args) => ghlFetchMock(...args) }));

import { splitName, isValidPhone, isValidEmail, onRequestPost } from './hand-study-signup.js';

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

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('david@example.com')).toBe(true);
  });

  it('rejects missing @, missing domain dot, and empty input', () => {
    expect(isValidEmail('davidexample.com')).toBe(false);
    expect(isValidEmail('david@example')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('onRequestPost', () => {
  function makeContext(body) {
    return {
      request: {
        headers: { get: () => 'https://www.amarimethod.com' },
        json: async () => body,
      },
      env: {},
    };
  }

  it('builds the hand-study tag, source, and Study Name from the registry', async () => {
    ghlFetchMock.mockClear();
    const res = await onRequestPost(makeContext({
      name: 'Alex Boulder',
      phone: '4155551234',
      email: 'alex@example.com',
      hand: 'right',
    }));

    expect(res.status).toBe(200);
    expect(ghlFetchMock).toHaveBeenCalledTimes(1);
    const [, , options] = ghlFetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);

    expect(payload.tags).toEqual(['hand-study-participant', 'hand-study-hand-right']);
    expect(payload.source).toBe('Hand Pain Study');
    expect(payload.customFields).toEqual([
      { id: '1xhxStKyEN47shwjOKC0', value: 'Hand Pain Study' },
    ]);
  });

  it('omits the hand tag when no hand is given', async () => {
    ghlFetchMock.mockClear();
    await onRequestPost(makeContext({
      name: 'Alex Boulder',
      phone: '4155551234',
      email: 'alex@example.com',
    }));

    const [, , options] = ghlFetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.tags).toEqual(['hand-study-participant']);
  });

  it('rejects a request missing required fields', async () => {
    const res = await onRequestPost(makeContext({ name: 'Alex Boulder' }));
    expect(res.status).toBe(400);
  });
});
