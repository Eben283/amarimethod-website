import { describe, it, expect, vi } from 'vitest';
import { hydrateOrders } from './ghl-orders.js';

function makeListOrder(id, overrides = {}) {
  return {
    _id: id,
    amount: 1295,
    status: 'completed',
    sourceType: 'point_of_sale',
    createdAt: '2026-05-08T00:00:00Z',
    ...overrides,
  };
}

describe('hydrateOrders', () => {
  it('returns empty array unchanged', async () => {
    const fetcher = vi.fn();
    expect(await hydrateOrders(fetcher, [])).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('skips fetch when order already has items[]', async () => {
    const fetcher = vi.fn();
    const o = makeListOrder('o1', {
      items: [{ product: { _id: 'pid1' } }],
    });
    const result = await hydrateOrders(fetcher, [o]);
    expect(result).toEqual([o]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('skips fetch when order has no _id', async () => {
    const fetcher = vi.fn();
    const o = { amount: 100, status: 'completed' }; // no _id
    const result = await hydrateOrders(fetcher, [o]);
    expect(result).toEqual([o]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('hydrates orders missing items[] by calling fetcher with their _id', async () => {
    const detailItems = [{ product: { _id: 'pid-from-detail' } }];
    const fetcher = vi.fn(async () => ({ items: detailItems }));
    const o = makeListOrder('o1'); // no items[]
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('o1');
    expect(hydrated.items).toEqual(detailItems);
    // LIST fields preserved
    expect(hydrated.amount).toBe(1295);
    expect(hydrated.status).toBe('completed');
  });

  it('only plucks items[] from detail — does not clobber LIST fields', async () => {
    // If detail returns a different status (cached vs live, partial-refund
    // timing window, etc.), it must NOT overwrite the LIST status.
    const fetcher = vi.fn(async () => ({
      items: [{ product: { _id: 'pid1' } }],
      status: 'refunded', // sabotage value
      amount: 0,
      sourceType: 'payment_link',
    }));
    const o = makeListOrder('o1');
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(hydrated.status).toBe('completed');
    expect(hydrated.amount).toBe(1295);
    expect(hydrated.sourceType).toBe('point_of_sale');
    expect(hydrated.items).toEqual([{ product: { _id: 'pid1' } }]);
  });

  it('marks order as __hydration_failed when fetcher throws', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('status 429');
    });
    const o = makeListOrder('o1');
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(hydrated.__hydration_failed).toBe(true);
    expect(hydrated.__hydration_reason).toBe('status 429');
    // Original fields preserved
    expect(hydrated._id).toBe('o1');
    expect(hydrated.amount).toBe(1295);
  });

  it('marks order as __hydration_failed when detail has no items[]', async () => {
    const fetcher = vi.fn(async () => ({ items: [] }));
    const o = makeListOrder('o1');
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(hydrated.__hydration_failed).toBe(true);
    expect(hydrated.__hydration_reason).toBe('detail-empty-items');
  });

  it('preserves order positions across mixed hydrate / skip / fail', async () => {
    // Order 0: has items, skip
    // Order 1: needs hydration, succeeds
    // Order 2: needs hydration, fails
    // Order 3: has items, skip
    const fetcher = vi.fn(async (id) => {
      if (id === 'fail') throw new Error('boom');
      return { items: [{ product: { _id: 'pid-' + id } }] };
    });
    const orders = [
      makeListOrder('a', { items: [{ product: { _id: 'pre-a' } }] }),
      makeListOrder('hydrate-me'),
      makeListOrder('fail'),
      makeListOrder('d', { items: [{ product: { _id: 'pre-d' } }] }),
    ];
    const result = await hydrateOrders(fetcher, orders);
    expect(result).toHaveLength(4);
    expect(result[0].items[0].product._id).toBe('pre-a');
    expect(result[1].items[0].product._id).toBe('pid-hydrate-me');
    expect(result[2].__hydration_failed).toBe(true);
    expect(result[3].items[0].product._id).toBe('pre-d');
    expect(fetcher).toHaveBeenCalledTimes(2); // only the two without items[]
  });

  it('chunks parallel fetches by concurrency option', async () => {
    // 12 orders, concurrency=4 → expect 3 chunks. Track max in-flight.
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { items: [{ product: { _id: 'pid' } }] };
    });
    const orders = Array.from({ length: 12 }, (_, i) => makeListOrder('o' + i));
    await hydrateOrders(fetcher, orders, { concurrency: 4 });
    expect(maxInFlight).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it('defaults concurrency to 5 when not specified', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { items: [{ product: { _id: 'pid' } }] };
    });
    const orders = Array.from({ length: 8 }, (_, i) => makeListOrder('o' + i));
    await hydrateOrders(fetcher, orders);
    expect(maxInFlight).toBe(5);
  });
});
