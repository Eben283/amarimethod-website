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

  it('marks as __hydration_failed when order has no id of any shape', async () => {
    // Without _id, id, or orderId there's nothing to hydrate with — but
    // we must NOT pass it through as a confident "other" classification
    // (would let the worker write a destructive zero). Mark failed so
    // deriveLedger drops confidence.
    const fetcher = vi.fn();
    const o = { amount: 100, status: 'completed' }; // no id of any kind
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(hydrated.__hydration_failed).toBe(true);
    expect(hydrated.__hydration_reason).toBe('no-order-id');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to o.id when o._id is missing (GHL endpoint variance)', async () => {
    // ghl-purchase-webhook.js:332 already uses the `_id || id || orderId`
    // fallback chain — proves GHL ships orders with `id` from at least one
    // endpoint. Hydration must accept the same shapes or it skips orders
    // that should be classifiable.
    const fetcher = vi.fn(async (id) => ({
      items: [{ product: { _id: 'pid-via-id' } }],
    }));
    const o = { id: 'order-id-only', amount: 1295, status: 'completed' };
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(fetcher).toHaveBeenCalledWith('order-id-only');
    expect(hydrated.items[0].product._id).toBe('pid-via-id');
  });

  it('skips hydration for calendar-source orders (placeholder pattern)', async () => {
    // GHL auto-creates a calendar-source order per appointment booking.
    // classifyOrder returns type="placeholder" for these immediately based
    // on sourceType — never reads items[]. Hydrating them is pure waste
    // and caused the 2026-06-03 subrequest-cap incident.
    const fetcher = vi.fn();
    const orders = [
      { _id: 'cal-1', sourceType: 'calendar', amount: 190, status: 'completed' },
      { _id: 'cal-2', sourceType: 'calendar', amount: 190, status: 'completed' },
      { _id: 'pos-1', sourceType: 'point_of_sale', amount: 1295, status: 'completed' },
    ];
    const result = await hydrateOrders(async () => ({
      items: [{ product: { _id: 'pid' } }],
    }), orders);
    // fetcher should only have been called for the non-calendar order
    // (we use the wrapping fn signature here, can't easily count — but
    // assert calendar orders came through unchanged and POS was hydrated)
    expect(result[0]).toEqual(orders[0]); // calendar unchanged
    expect(result[1]).toEqual(orders[1]); // calendar unchanged
    expect(result[2].items).toBeDefined(); // POS hydrated
  });

  it('calendar-source order without items is NOT marked as failed', async () => {
    // Regression: previously, calendar orders without items[] would
    // either get hydrated (waste) or marked __hydration_failed (wrong).
    // They should pass through silently — classifyOrder handles them.
    const fetcher = vi.fn();
    const o = { _id: 'cal-x', sourceType: 'calendar', amount: 190, status: 'completed' };
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(hydrated.__hydration_failed).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to o.orderId when both _id and id are missing', async () => {
    const fetcher = vi.fn(async () => ({
      items: [{ product: { _id: 'pid' } }],
    }));
    const o = { orderId: 'fallback-order-id', amount: 720, status: 'completed' };
    const [hydrated] = await hydrateOrders(fetcher, [o]);
    expect(fetcher).toHaveBeenCalledWith('fallback-order-id');
    expect(hydrated.items[0].product._id).toBe('pid');
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

  it('defaults concurrency to 3 (per 2026-06-03 subrequest-cap incident)', async () => {
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
    expect(maxInFlight).toBe(3);
  });
});
