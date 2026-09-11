import { describe, expect, it, vi } from 'vitest';
import { listPaymentRecordsForContact } from './session-payment.js';
describe('strict financial payment-record reads', () => {
  it('reads all KV pages before claiming payment evidence complete', async () => {
    const kv = { list: vi.fn().mockResolvedValueOnce({ keys: [{ name: 'payment:fixture:a1' }], list_complete: false, cursor: 'next' }).mockResolvedValueOnce({ keys: [{ name: 'payment:fixture:a2' }], list_complete: true }), get: async (key) => ({ appointmentId: key.split(':').at(-1), contactId: 'fixture', status: 'paid', method: 'cash' }) };
    const records = await listPaymentRecordsForContact(kv, 'fixture', { strict: true });
    expect(Object.keys(records).sort()).toEqual(['a1', 'a2']);
    expect(kv.list.mock.calls[1][0].cursor).toBe('next');
  });
  it('does not silently omit an enumerated record that disappeared', async () => {
    const kv = { list: async () => ({ keys: [{ name: 'payment:fixture:a1' }], list_complete: true }), get: async () => null };
    await expect(listPaymentRecordsForContact(kv, 'fixture', { strict: true })).rejects.toThrow();
  });
  it('does not loop forever or claim completeness on a repeated cursor', async () => {
    const kv = { list: async () => ({ keys: [], list_complete: false, cursor: 'same' }), get: async () => null };
    await expect(listPaymentRecordsForContact(kv, 'fixture', { strict: true })).rejects.toThrow();
  });
  it('preserves fail-soft behavior for nonfinancial existing callers', async () => {
    const kv = { list: async () => { throw new Error('Fixture failure'); } };
    await expect(listPaymentRecordsForContact(kv, 'fixture')).resolves.toEqual({});
  });
});
