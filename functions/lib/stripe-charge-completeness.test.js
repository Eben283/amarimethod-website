import { describe, expect, it, vi } from 'vitest';
import { makeStripeClient, resolveContactCharges } from './stripe-charges.js';
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
describe('Stripe financial read completeness', () => {
  it('rejects provider error payloads instead of returning no payments', async () => {
    const stripe = makeStripeClient('fixture-only', async () => response({ error: { message: 'Fixture outage' } }, 429));
    await expect(resolveContactCharges(stripe, { contactId: 'fixture', email: 'fixture@example.invalid' })).rejects.toThrow();
  });
  it('rejects malformed successful payloads', async () => {
    const stripe = makeStripeClient('fixture-only', async () => response({}));
    await expect(resolveContactCharges(stripe, { contactId: 'fixture' })).rejects.toThrow();
  });
  it('does not return a partial charge list as complete after a later-page error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: [{ id: 'ch_one' }], has_more: true })).mockResolvedValueOnce(response({ error: { message: 'Fixture failure' } }, 500));
    const result = await makeStripeClient('fixture-only', fetcher).listChargesByCustomer('cus_fixture');
    expect(result.incomplete || result.error).toBeTruthy();
  });
  it('does not return a page-capped charge list as complete', async () => {
    let n = 0;
    const stripe = makeStripeClient('fixture-only', async () => response({ data: [{ id: 'ch_' + (++n) }], has_more: true }));
    const result = await stripe.listChargesByCustomer('cus_fixture');
    expect(result.incomplete || result.error).toBeTruthy();
  });
  it('accepts a fully read empty charge history', async () => {
    const stripe = makeStripeClient('fixture-only', async () => response({ data: [], has_more: false }));
    await expect(resolveContactCharges(stripe, { contactId: 'fixture', email: 'fixture@example.invalid' })).resolves.toEqual([]);
  });
});
