import { describe, it, expect } from 'vitest';
import { isForeignLocationToken } from './ghl-oauth-callback.js';

// F#1 (2026-07-04): the callback overwrote the production GHL token store with
// whatever an OAuth code exchanged to, unauthenticated. The write is now refused
// when the exchanged token is explicitly scoped to a DIFFERENT location, so an
// OAuth completed for someone else's location cannot clobber our tokens.
//
// Deliberately lenient on agency-class tokens (no locationId): the documented
// reinstall → /oauth/locationToken recovery flow produces those, and must keep
// working. See memory reference-ghl-authclass-location-token.

const OUR = '7pIO7FHVAyBT1jKGhfQM';

describe('isForeignLocationToken', () => {
  it('is FALSE for a token scoped to our location (stored as normal)', () => {
    expect(isForeignLocationToken({ access_token: 'a', locationId: OUR })).toBe(false);
  });

  it('is TRUE for a token scoped to a different location (the F#1 attack → refused)', () => {
    expect(isForeignLocationToken({ access_token: 'a', locationId: 'someone-elses-loc' })).toBe(true);
  });

  it('is FALSE for an agency/company token with no locationId (recovery flow preserved)', () => {
    expect(isForeignLocationToken({ access_token: 'a', userType: 'Company', companyId: 'c1' })).toBe(false);
  });

  it('is FALSE for empty / malformed exchange results (no location claim to reject)', () => {
    expect(isForeignLocationToken(null)).toBe(false);
    expect(isForeignLocationToken({})).toBe(false);
    expect(isForeignLocationToken({ locationId: '' })).toBe(false);
  });

  it('honors an explicit expected-location override', () => {
    expect(isForeignLocationToken({ locationId: 'loc-X' }, 'loc-X')).toBe(false);
    expect(isForeignLocationToken({ locationId: OUR }, 'loc-X')).toBe(true);
  });
});
