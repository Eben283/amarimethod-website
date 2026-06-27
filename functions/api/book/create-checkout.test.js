import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GHL I/O wrapper so no network happens and we control responses.
vi.mock('../../lib/ghl.js', () => ({
  ghlFetch: vi.fn(),
  ghlHeaders: vi.fn(() => ({})),
  getGhlToken: vi.fn(async () => 'test-token'),
}));

import { upsertContact } from './create-checkout.js';
import { ghlFetch } from '../../lib/ghl.js';

const resp = (overrides) => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', ...overrides });
const payload = {
  email: 'client@example.com',
  firstName: 'Test',
  lastName: 'Client',
  phone: '555',
  startTime: '2026-07-01T10:00:00-07:00',
  sessionType: 'in-person',
  agreeCommunications: true,
};
const paidBooking = { isFreeBooking: false, calendarId: 'cal-1' };
const freeBooking = { isFreeBooking: true, calendarId: 'cal-disco' };

beforeEach(() => vi.clearAllMocks());

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
