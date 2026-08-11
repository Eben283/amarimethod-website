import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GHL I/O wrapper so no network happens and we control responses.
vi.mock('../../lib/ghl.js', () => ({
  ghlFetch: vi.fn(),
  ghlHeaders: vi.fn(() => ({})),
  getGhlToken: vi.fn(async () => 'test-token'),
}));

vi.mock('../../lib/ops-alert.js', () => ({
  recordOpsError: vi.fn(async () => ({ recorded: true })),
}));

import {
  upsertContact,
  buildSlotCustomFields,
  slotDateOnly,
  looksLikeDuplicateContactError,
  findContactIdByEmail,
  validateBody,
  ALLOWED_BOOKINGS,
} from './create-checkout.js';
import { ghlFetch } from '../../lib/ghl.js';
import { FIELD_IDS } from '../../lib/ghl-fields.js';

const resp = (overrides) => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', ...overrides });
const payload = {
  email: 'client@example.com',
  firstName: 'Test',
  lastName: 'Client',
  phone: '5555550100',
  startTime: '2026-08-21T14:30:00-07:00',
  sessionType: 'amari_assessment',
  agreeCommunications: true,
};
const paidBooking = { isFreeBooking: false, calendarId: 'EM6vB2mq7EAdGCbUb3j1' };
const freeBooking = { isFreeBooking: true, calendarId: 'cal-disco' };

beforeEach(() => vi.clearAllMocks());

describe('public paid booking catalog', () => {
  it('offers only the $29, 50-minute Assessment as the public paid first visit', () => {
    expect(ALLOWED_BOOKINGS.amari_assessment).toMatchObject({
      calendarId: 'EM6vB2mq7EAdGCbUb3j1',
      productId: '6a66cf0103821ea09ea13f1b',
      price: 29,
      durationMinutes: 50,
    });
    expect(ALLOWED_BOOKINGS.initial_in_person).toBeUndefined();
    expect(ALLOWED_BOOKINGS.initial_virtual).toBeUndefined();
    expect(ALLOWED_BOOKINGS.amari_assessment_virtual).toMatchObject({
      enabled: false,
      calendarId: 'fFdlRts2KpUf2LYvPf2n',
      productId: '6a66cf0103821ea09ea13f1b',
      price: 29,
      durationMinutes: 50,
    });
  });
});

describe('Assessment participant agreement', () => {
  const assessmentCheckout = {
    ...payload,
    calendarId: 'EM6vB2mq7EAdGCbUb3j1',
    timezone: 'America/Los_Angeles',
    agreePolicies: true,
    participantAgreementVersion: 'participant-agreement-v2026-08-09',
    idempotencyKey: 'assessment-agreement-test-key',
  };

  it('rejects an Assessment checkout that bypasses the required participant agreement', () => {
    expect(validateBody({ ...assessmentCheckout, agreeParticipantAgreement: false }))
      .toMatch(/participant agreement/i);
  });

  it('rejects an Assessment checkout that presents an outdated agreement version', () => {
    expect(validateBody({
      ...assessmentCheckout,
      agreeParticipantAgreement: true,
      participantAgreementVersion: 'participant-agreement-v2026-01-01',
    })).toMatch(/current participant agreement/i);
  });

  it('accepts an Assessment checkout with the required participant agreement', () => {
    expect(validateBody({ ...assessmentCheckout, agreeParticipantAgreement: true }))
      .toBeNull();
  });

  it('rejects the virtual Assessment before its explicit public release', () => {
    expect(validateBody({
      ...assessmentCheckout,
      sessionType: 'amari_assessment_virtual',
      calendarId: 'fFdlRts2KpUf2LYvPf2n',
      agreeParticipantAgreement: true,
    })).toMatch(/not yet available/i);
  });
});

describe('slotDateOnly / duplicate detection', () => {
  it('extracts YYYY-MM-DD from an offset ISO slot', () => {
    expect(slotDateOnly('2026-08-21T14:30:00-07:00')).toBe('2026-08-21');
  });

  it('recognizes GHL duplicate create errors', () => {
    expect(looksLikeDuplicateContactError(400, 'Contact already exists with this email')).toBe(true);
    expect(looksLikeDuplicateContactError(422, 'duplicate contact')).toBe(true);
    expect(looksLikeDuplicateContactError(500, 'duplicate contact')).toBe(false);
    expect(looksLikeDuplicateContactError(400, 'invalid phone')).toBe(false);
  });
});

describe('buildSlotCustomFields', () => {
  it('writes slot fields by id with DATE-only + full ISO', () => {
    const fields = buildSlotCustomFields(payload, paidBooking);
    expect(fields).toEqual(
      expect.arrayContaining([
        {
          id: FIELD_IDS.requested_session_slot,
          field_value: '2026-08-21',
        },
        {
          id: FIELD_IDS.requested_session_slot_iso,
          field_value: '2026-08-21T14:30:00-07:00',
        },
        {
          id: FIELD_IDS.requested_session_calendar,
          field_value: 'EM6vB2mq7EAdGCbUb3j1',
        },
        {
          id: FIELD_IDS.requested_session_type,
          field_value: 'amari_assessment',
        },
      ]),
    );
  });

  it('skips slot fields for free bookings', () => {
    const fields = buildSlotCustomFields(payload, freeBooking);
    expect(fields.some((f) => f.id === FIELD_IDS.requested_session_slot)).toBe(false);
    expect(fields.some((f) => f.id === FIELD_IDS.requested_session_slot_iso)).toBe(false);
  });
});

// H1 (2026-06-11 review): when an existing contact's PUT (which writes the
// requested_session_* slot fields) failed, upsertContact logged and returned
// the id anyway → the customer was sent to checkout and paid, but the slot
// fields were never written, so the purchase webhook silently booked nothing.
// A failed PUT on a PAID booking must abort so the caller returns 422 and the
// customer is never charged for an un-bookable slot.
describe('upsertContact — existing contact PUT failure (H1)', () => {
  it('THROWS when the slot-field PUT fails on a paid booking (so checkout aborts)', async () => {
    ghlFetch
      .mockResolvedValueOnce(resp({ json: async () => ({ contact: { id: 'existing-1' } }) })) // lookup
      .mockResolvedValueOnce(resp({ ok: false, status: 422, text: async () => 'field write rejected' })); // PUT
    await expect(upsertContact({}, 'k', 'loc', payload, paidBooking)).rejects.toThrow(/update failed/i);
  });

  it('returns the id when the PUT succeeds on a paid booking', async () => {
    ghlFetch
      .mockResolvedValueOnce(resp({ json: async () => ({ contact: { id: 'existing-1' } }) })) // lookup
      .mockResolvedValueOnce(resp({ ok: true })); // PUT
    await expect(upsertContact({}, 'k', 'loc', payload, paidBooking)).resolves.toBe('existing-1');
  });

  it('does NOT throw on a free booking PUT failure (slot fields N/A — best effort)', async () => {
    ghlFetch
      .mockResolvedValueOnce(resp({ json: async () => ({ contact: { id: 'existing-1' } }) })) // lookup
      .mockResolvedValueOnce(resp({ ok: false, status: 500, text: async () => 'transient' })); // PUT
    await expect(upsertContact({}, 'k', 'loc', payload, freeBooking)).resolves.toBe('existing-1');
  });
});

describe('upsertContact — duplicate create recovery (Ilana / secure-payment banner)', () => {
  it('falls back to POST /contacts/search when duplicate lookup returns empty', async () => {
    ghlFetch
      .mockResolvedValueOnce(resp({ json: async () => ({}) })) // duplicate empty
      .mockResolvedValueOnce(
        resp({ json: async () => ({ contacts: [{ id: 'from-search' }] }) }),
      ); // search
    await expect(findContactIdByEmail({}, 'loc', 'a@b.com')).resolves.toBe('from-search');
  });

  it('on duplicate create error, re-looks-up and PUTs instead of failing checkout', async () => {
    ghlFetch
      .mockResolvedValueOnce(resp({ json: async () => ({}) })) // duplicate empty
      .mockResolvedValueOnce(resp({ json: async () => ({ contacts: [] }) })) // search empty
      .mockResolvedValueOnce(
        resp({
          ok: false,
          status: 400,
          text: async () => 'This email already exists',
          json: async () => ({}),
        }),
      ) // create duplicate
      .mockResolvedValueOnce(resp({ json: async () => ({ contact: { id: 'recovered-1' } }) })) // re-lookup
      .mockResolvedValueOnce(resp({ ok: true })); // PUT

    await expect(upsertContact({}, 'k', 'loc', payload, paidBooking)).resolves.toBe(
      'recovered-1',
    );
  });
});
