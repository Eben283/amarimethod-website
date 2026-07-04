import { describe, it, expect } from 'vitest';
import { partnerOwnsContact } from './partner-stats.js';

// E#1 (2026-07-04): partner-stats used to scope referrals by a client-supplied
// ?ref= name, so any partner could read any other partner's referrals + client
// PII. Authorization now derives identity from the session token and matches on
// the spoof-proof partner-contactId stamp (name is a legacy fallback only).

const PARTNER_CONTACT_ID_FIELD_ID = 'Un0VeGngkiUJrZ0mrgDa';
const REFERRAL_SOURCE_FIELD_ID = 'htX3m1ba8ka7PU0OWISE';

const contact = (fields) => ({ customFields: fields });
const stampedBy = (partnerId) => contact([{ id: PARTNER_CONTACT_ID_FIELD_ID, value: partnerId }]);
const namedOnly = (name) => contact([{ id: REFERRAL_SOURCE_FIELD_ID, value: name }]);

describe('partnerOwnsContact — cross-partner IDOR guard', () => {
  it('matches a referral stamped with the partner’s own contactId', () => {
    expect(partnerOwnsContact(stampedBy('partner-A'), 'partner-A', 'Sarah')).toBe(true);
  });

  it('REJECTS a referral stamped with a DIFFERENT partner’s contactId (the IDOR)', () => {
    // Partner A authenticated; Bob's referral must never match, regardless of name.
    expect(partnerOwnsContact(stampedBy('partner-B'), 'partner-A', 'Sarah')).toBe(false);
  });

  it('does not match on contactId when the field is absent and names differ', () => {
    expect(partnerOwnsContact(namedOnly('Bob'), 'partner-A', 'Sarah')).toBe(false);
  });

  it('legacy fallback: matches a pre-stamp referral by referral_source name (case-insensitive)', () => {
    expect(partnerOwnsContact(namedOnly('sarah'), 'partner-A', 'Sarah')).toBe(true);
  });

  it('contactId match wins even if the legacy name would not match', () => {
    const c = contact([
      { id: PARTNER_CONTACT_ID_FIELD_ID, value: 'partner-A' },
      { id: REFERRAL_SOURCE_FIELD_ID, value: 'MisspelledName' },
    ]);
    expect(partnerOwnsContact(c, 'partner-A', 'Sarah')).toBe(true);
  });

  it('returns false for a contact with no custom fields', () => {
    expect(partnerOwnsContact({}, 'partner-A', 'Sarah')).toBe(false);
    expect(partnerOwnsContact(null, 'partner-A', 'Sarah')).toBe(false);
  });

  it('without a partnerContactId, refuses to fall through to an empty/loose match', () => {
    // Defensive: a missing identity must not authorize everything.
    expect(partnerOwnsContact(stampedBy('partner-B'), null, null)).toBe(false);
  });
});
