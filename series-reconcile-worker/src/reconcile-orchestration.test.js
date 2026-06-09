// Orchestration tests for reconcileOrder — the BACKUP money-writer that applies
// a package when the GHL purchase workflow didn't fire. The pure decision
// functions are covered in reconcile.test.js; this file exercises the actual
// WRITE path: given an order, does reconcileOrder call patchContact with the
// right custom fields, write the right idempotency lock, and skip correctly?
// A regression here passes every pure-function test while silently mutating
// GHL state wrong, so this is the coverage that actually protects money.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GHL I/O so no network happens and we can assert the writes.
vi.mock('./ghl.js', () => ({
  getContact: vi.fn(),
  patchContact: vi.fn(),
  addContactNote: vi.fn(),
}));

import { reconcileOrder, PACKAGE_PRODUCTS, FIELD_IDS } from './reconcile.js';
import { getContact, patchContact, addContactNote } from './ghl.js';

// Real productIds (mirror reconcile.test.js / PACKAGE_PRODUCTS).
const PID = {
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  initialInPerson: '688a1cd770362828afbf08a2', // NOT a package
};

const lineItem = (productId) => ({ name: 'Item', product: { _id: productId } });

const order = (overrides = {}) => ({
  _id: 'order-1',
  contactId: 'contact-1',
  paymentStatus: 'paid',
  items: [lineItem(PID.eightSeries)],
  source: { type: 'point_of_sale', id: 'pos-1' },
  ...overrides,
});

// Build a GHL contact whose custom fields are keyed the way readField expects.
const contact = (fields = {}, tags = []) => ({
  id: 'contact-1',
  firstName: 'Test',
  lastName: 'Client',
  customFields: Object.entries(fields).map(([id, value]) => ({ id, value })),
  tags,
});

function makeEnv(seed = {}) {
  const store = { ...seed };
  return {
    store,
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in store ? store[k] : null)),
      put: vi.fn(async (k, v) => { store[k] = v; }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a fresh contact with none of the package fields set.
  getContact.mockResolvedValue(contact());
});

describe('reconcileOrder — write orchestration', () => {
  it('applies an orphan 8-session purchase: sets series_type, sessions_remaining, portal_access + LIVING PRACTICE, writes the lock', async () => {
    const env = makeEnv();
    const pkg = PACKAGE_PRODUCTS[PID.eightSeries];

    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('applied');
    expect(patchContact).toHaveBeenCalledTimes(1);
    const [, contactId, customFields] = patchContact.mock.calls[0];
    expect(contactId).toBe('contact-1');
    // The exact fields the C-series workflow would have set.
    expect(customFields).toEqual(expect.arrayContaining([
      { id: FIELD_IDS.series_type, value: pkg.seriesType },
      { id: FIELD_IDS.sessions_remaining, value: pkg.sessionsToSet },
      { id: FIELD_IDS.portal_access, value: ['true'] },
      { id: FIELD_IDS.living_practice_access, value: ['true'] }, // 8-pack includes LP
    ]));
    expect(addContactNote).toHaveBeenCalledTimes(1);
    // Idempotency lock written under the shared prefix so the webhook can't double-apply.
    expect(env.PURCHASE_KV.put).toHaveBeenCalled();
    expect(env.PURCHASE_KV.put.mock.calls[0][0]).toBe('processed:order-1');
    expect(JSON.parse(env.store['processed:order-1']).action).toBe('applied');
  });

  it('applies a 4-session purchase WITHOUT living_practice_access (4-pack has no LP)', async () => {
    const env = makeEnv();
    const res = await reconcileOrder(env, order({ items: [lineItem(PID.fourSeries)] }));

    expect(res.status).toBe('applied');
    const [, , customFields] = patchContact.mock.calls[0];
    const ids = customFields.map((f) => f.id);
    expect(ids).toContain(FIELD_IDS.series_type);
    expect(ids).toContain(FIELD_IDS.sessions_remaining);
    expect(ids).not.toContain(FIELD_IDS.living_practice_access);
  });

  it('skips (no writes) when the order was already processed — idempotency', async () => {
    const env = makeEnv({ 'processed:order-1': JSON.stringify({ action: 'applied' }) });
    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('skip-already-processed');
    expect(patchContact).not.toHaveBeenCalled();
    expect(addContactNote).not.toHaveBeenCalled();
  });

  it('skips a non-package order (e.g. a single initial) without touching the contact or KV', async () => {
    const env = makeEnv();
    const res = await reconcileOrder(env, order({ items: [lineItem(PID.initialInPerson)] }));

    expect(res.status).toBe('skip-not-package');
    expect(getContact).not.toHaveBeenCalled();
    expect(patchContact).not.toHaveBeenCalled();
    expect(env.PURCHASE_KV.put).not.toHaveBeenCalled();
  });

  it('skips an unpaid package order (no premature credit)', async () => {
    const env = makeEnv();
    const res = await reconcileOrder(env, order({ paymentStatus: 'pending' }));

    expect(res.status).toBe('skip-not-paid');
    expect(patchContact).not.toHaveBeenCalled();
  });

  it('does NOT re-apply when the fields are already set (workflow fired) — marks idempotent instead of resetting a drawn-down balance', async () => {
    const env = makeEnv();
    // Contact already on the 8-session pack, drawn down to 5, portal + LP set.
    getContact.mockResolvedValue(contact({
      [FIELD_IDS.series_type]: '8-session',
      [FIELD_IDS.portal_access]: ['true'],
      [FIELD_IDS.living_practice_access]: ['true'],
      [FIELD_IDS.sessions_remaining]: '5',
    }));

    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('skip-already-applied');
    expect(patchContact).not.toHaveBeenCalled(); // critical: never resets 5 → 8
    expect(env.PURCHASE_KV.put).toHaveBeenCalled(); // records idempotency so it stops re-checking hourly
  });
});
