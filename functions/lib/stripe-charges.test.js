import { describe, it, expect } from 'vitest';
import {
  AMOUNT_TO_SESSIONS,
  classifyCharge,
  summarizeCharges,
  resolveContactCharges,
  pickCustomerId,
  authoritativeCustomerId,
  makeStripeClient,
} from './stripe-charges.js';

const charge = (o = {}) => ({
  id: o.id || 'ch_1',
  amount: o.amount ?? 19000,
  paid: o.paid ?? true,
  status: o.status ?? 'succeeded',
  refunded: o.refunded ?? false,
  amount_refunded: o.amount_refunded ?? 0,
  description: o.description ?? null,
  customer: o.customer ?? null,
  metadata: o.metadata ?? {},
});

describe('classifyCharge', () => {
  it('matches by product name in the description', () => {
    expect(classifyCharge(charge({ amount: 72000, description: '4-Session Series ($720)' }))).toMatchObject({ sessions: 4, kind: 'matched-description' });
    expect(classifyCharge(charge({ amount: 540000, description: 'The 12-Week Amari Practice ($5,400)' }))).toMatchObject({ sessions: 24, kind: 'matched-description' });
    expect(classifyCharge(charge({ amount: 300000, description: 'The 6 Week Amari Practice ($3,000)' }))).toMatchObject({ sessions: 12, kind: 'matched-description' });
    expect(classifyCharge(charge({ amount: 9000, description: 'Entrainment (via calendars) ($90)' }))).toMatchObject({ sessions: 0, kind: 'matched-description' });
  });
  it('falls back to the paid amount when the description is generic', () => {
    expect(classifyCharge(charge({ amount: 129500, description: 'Payment for invoice 000136' }))).toMatchObject({ sessions: 8, kind: 'matched-amount' });
    expect(classifyCharge(charge({ amount: 19000, description: 'Payment for invoice 000200' }))).toMatchObject({ sessions: 1, kind: 'matched-amount' });
    expect(classifyCharge(charge({ amount: 540000, description: 'Payment for invoice 000201' }))).toMatchObject({ sessions: 24, kind: 'matched-amount' });
    expect(classifyCharge(charge({ amount: 550000, description: 'Payment for invoice 000201' }))).toMatchObject({ sessions: 24, kind: 'matched-amount' });
    expect(classifyCharge(charge({ amount: 300000, description: 'Payment for invoice 000202' }))).toMatchObject({ sessions: 12, kind: 'matched-amount' });
  });
  it('returns unknown (never guesses) for an unrecognized amount + description', () => {
    const c = classifyCharge(charge({ amount: 5500, description: 'Payment for invoice 000999' }));
    expect(c.kind).toBe('unknown');
    expect(c.sessions).toBeNull();
  });
  it('exposes the known price→sessions map', () => {
    expect(AMOUNT_TO_SESSIONS[1295].sessions).toBe(8);
    expect(AMOUNT_TO_SESSIONS[720].sessions).toBe(4);
    expect(AMOUNT_TO_SESSIONS[5400].sessions).toBe(24);
    expect(AMOUNT_TO_SESSIONS[5500].sessions).toBe(24);
    expect(AMOUNT_TO_SESSIONS[3000].sessions).toBe(12);
  });
});

describe('summarizeCharges', () => {
  it('sums dollars + session-equivalents and collects unknowns', () => {
    const s = summarizeCharges([
      charge({ id: 'a', amount: 129500, description: '8-Session Series ($1295)' }),
      charge({ id: 'b', amount: 9000, description: 'Entrainment ($90)' }),
      charge({ id: 'c', amount: 12300, description: 'Payment for invoice X' }),
    ]);
    expect(s.totalPaid).toBe(1508); // 1295 + 90 + 123 — unknowns are still real money
    expect(s.sessionsPurchased).toBe(8); // 8 + 0 (entrainment); unknown not counted toward sessions
    expect(s.unknownCount).toBe(1);
    expect(s.unknown[0].id).toBe('c');
  });
});

// Mock Stripe client implementing the three methods resolveContactCharges uses.
function mockStripe({ search = [], byCustomer = {}, byEmail = {} } = {}) {
  return {
    calls: { search: 0, listByCustomer: [], listByEmail: [] },
    async searchCharges() { this.calls.search++; return { data: search }; },
    async listChargesByCustomer(id) { this.calls.listByCustomer.push(id); return { data: byCustomer[id] || [] }; },
    async listCustomersByEmail(email) { this.calls.listByEmail.push(email); return { data: byEmail[email] || [] }; },
  };
}

describe('resolveContactCharges', () => {
  it('finds direct charges by metadata.contactId, then pulls the rest by customer id', async () => {
    const direct = charge({ id: 'link1', amount: 72000, customer: 'cus_A', metadata: { contactId: 'C1' } });
    const invoiceCharge = charge({ id: 'inv1', amount: 9000, customer: 'cus_A', metadata: { invoiceId: 'i9' } });
    const stripe = mockStripe({ search: [direct], byCustomer: { cus_A: [direct, invoiceCharge] } });
    const out = await resolveContactCharges(stripe, { contactId: 'C1' });
    const ids = out.map((c) => c.id).sort();
    expect(ids).toEqual(['inv1', 'link1']); // deduped, customer pass caught the invoice charge
  });

  it('filters out refunded / non-succeeded charges', async () => {
    const ok = charge({ id: 'ok', customer: 'cus_A', metadata: { contactId: 'C1' } });
    const refunded = charge({ id: 'r', customer: 'cus_A', refunded: true, metadata: { contactId: 'C1' } });
    const pending = charge({ id: 'p', customer: 'cus_A', status: 'pending', metadata: { contactId: 'C1' } });
    const stripe = mockStripe({ search: [ok, refunded, pending], byCustomer: { cus_A: [ok, refunded, pending] } });
    const out = await resolveContactCharges(stripe, { contactId: 'C1' });
    expect(out.map((c) => c.id)).toEqual(['ok']);
  });

  it('falls back to email only when no contactId charges are found', async () => {
    const emailCharge = charge({ id: 'e1', customer: 'cus_B' });
    const stripe = mockStripe({ search: [], byEmail: { 'x@y.com': [{ id: 'cus_B' }] }, byCustomer: { cus_B: [emailCharge] } });
    const out = await resolveContactCharges(stripe, { contactId: 'C1', email: 'x@y.com' });
    expect(out.map((c) => c.id)).toEqual(['e1']);
    expect(stripe.calls.listByEmail).toEqual(['x@y.com']);
  });

  it('uses a seeded customerId to find charges even with no contactId match (POS-only case)', async () => {
    const posCharge = charge({ id: 'pos1', amount: 9000, customer: 'cus_X', metadata: { invoiceId: 'i1' } });
    const stripe = mockStripe({ search: [], byCustomer: { cus_X: [posCharge] } });
    const out = await resolveContactCharges(stripe, { contactId: 'C1', customerId: 'cus_X' });
    expect(out.map((c) => c.id)).toEqual(['pos1']);
    expect(stripe.calls.listByCustomer).toContain('cus_X');
  });
});

describe('pickCustomerId', () => {
  it('returns the customer behind the most charges', () => {
    const out = pickCustomerId([
      charge({ id: 'a', customer: 'cus_A' }),
      charge({ id: 'b', customer: 'cus_A' }),
      charge({ id: 'c', customer: 'cus_B' }),
    ]);
    expect(out).toBe('cus_A');
  });
  it('returns null when no charge has a customer', () => {
    expect(pickCustomerId([charge({ customer: null })])).toBeNull();
    expect(pickCustomerId([])).toBeNull();
  });
});

describe('resolveContactCharges (more)', () => {
  it('does NOT use the email fallback when contactId charges exist', async () => {
    const direct = charge({ id: 'link1', customer: 'cus_A', metadata: { contactId: 'C1' } });
    const stripe = mockStripe({ search: [direct], byCustomer: { cus_A: [direct] }, byEmail: { 'x@y.com': [{ id: 'cus_Z' }] } });
    await resolveContactCharges(stripe, { contactId: 'C1', email: 'x@y.com' });
    expect(stripe.calls.listByEmail).toEqual([]);
  });
});

describe('makeStripeClient pagination', () => {
  // Fake fetch returning a queue of Stripe JSON pages, recording requested URLs.
  const fakeFetch = (pages) => {
    let i = 0;
    const urls = [];
    const fn = async (url) => {
      urls.push(url);
      const body = pages[Math.min(i, pages.length - 1)];
      i++;
      return { json: async () => body };
    };
    fn.urls = urls;
    return fn;
  };

  it('follows starting_after across pages for listChargesByCustomer', async () => {
    const fetchImpl = fakeFetch([
      { data: [{ id: 'ch_1' }, { id: 'ch_2' }], has_more: true },
      { data: [{ id: 'ch_3' }], has_more: false },
    ]);
    const stripe = makeStripeClient('sk_test', fetchImpl);
    const r = await stripe.listChargesByCustomer('cus_A');
    expect(r.data.map((c) => c.id)).toEqual(['ch_1', 'ch_2', 'ch_3']);
    expect(fetchImpl.urls[1]).toContain('starting_after=ch_2'); // cursor = last id of page 1
  });

  it('stops after one page when has_more is false', async () => {
    const fetchImpl = fakeFetch([{ data: [{ id: 'ch_1' }], has_more: false }]);
    const stripe = makeStripeClient('sk_test', fetchImpl);
    const r = await stripe.listChargesByCustomer('cus_A');
    expect(r.data.map((c) => c.id)).toEqual(['ch_1']);
    expect(fetchImpl.urls).toHaveLength(1);
  });

  it('follows next_page tokens for searchCharges', async () => {
    const fetchImpl = fakeFetch([
      { data: [{ id: 's_1' }], has_more: true, next_page: 'pg2' },
      { data: [{ id: 's_2' }], has_more: false, next_page: null },
    ]);
    const stripe = makeStripeClient('sk_test', fetchImpl);
    const r = await stripe.searchCharges('metadata["contactId"]:"C1"');
    expect(r.data.map((c) => c.id)).toEqual(['s_1', 's_2']);
    expect(fetchImpl.urls[1]).toContain('page=pg2');
  });

  it('returns the raw error object when the first page errors', async () => {
    const fetchImpl = fakeFetch([{ error: { message: 'bad key' } }]);
    const stripe = makeStripeClient('sk_test', fetchImpl);
    const r = await stripe.listChargesByCustomer('cus_A');
    expect(r.error).toBeTruthy();
  });
});
