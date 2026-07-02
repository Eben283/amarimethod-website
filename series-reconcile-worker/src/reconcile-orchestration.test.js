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
  removeContactTags: vi.fn(),
  ghlGet: vi.fn(),
  getOrderDetail: vi.fn(),
  LOCATION_ID: 'loc-1',
}));

import { reconcileOrder, PACKAGE_PRODUCTS, FIELD_IDS, REMOVE_TAGS } from './reconcile.js';
import { getContact, patchContact, addContactNote, removeContactTags, ghlGet, getOrderDetail } from './ghl.js';

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

// Shape classifyOrder() (functions/lib/session-ledger.js) actually needs — a
// DIFFERENT shape from `order()` above (which is what reconcileOrder itself
// reads: paymentStatus, not status/amount). Real GHL orders have both sets of
// fields; the fixtures are split because reconcileOrder and deriveLedger read
// different fields off the same real object.
const listOrder = (productId, overrides = {}) => ({
  status: 'completed',
  amount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  items: [lineItem(productId)],
  sourceType: 'point_of_sale',
  ...overrides,
});

// A follow-up appointment on a series calendar (SERIES_CALENDAR_IDS in
// session-ledger.js) — counts against `attended` in deriveLedger.
const appt = (overrides = {}) => ({
  calendarId: 'SKDVOL8wtUN6Ne0ppbC9', // Follow-up — In Person
  appointmentStatus: 'showed',
  startTime: '2026-02-01T18:00:00',
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
  const portalStore = {};
  return {
    store,
    portalStore,
    PURCHASE_KV: {
      get: vi.fn(async (k) => (k in store ? store[k] : null)),
      put: vi.fn(async (k, v) => { store[k] = v; }),
    },
    PORTAL_KV: {
      get: vi.fn(async (k) => (k in portalStore ? portalStore[k] : null)),
      put: vi.fn(async (k, v) => { portalStore[k] = v; }),
    },
  };
}

// Stubs the 3 GHL reads reconcileOrder's deriveLedger step makes, for the
// contact's FULL order/invoice/appointment history — separate from the single
// `orderDetail` passed directly into reconcileOrder(). Defaults to empty
// history (0 orders/appointments); individual tests pass what they need.
function stubLedgerFetch({ orders = [], invoices = [], appointments = [] } = {}) {
  ghlGet.mockImplementation(async (env, path) => {
    if (path.includes('/payments/orders')) return { data: orders };
    if (path.includes('/invoices/')) return { invoices };
    if (path.includes('/appointments')) return { appointments };
    throw new Error(`unexpected ghlGet path in test: ${path}`);
  });
  getOrderDetail.mockResolvedValue(null); // unused when list orders already carry items[]
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a fresh contact with none of the package fields set.
  getContact.mockResolvedValue(contact());
  stubLedgerFetch(); // most tests never reach the ledger-fetch code (skip-* paths)
});

describe('reconcileOrder — write orchestration', () => {
  it('applies an orphan 8-session purchase: sets series_type, sessions_remaining, portal_access + LIVING PRACTICE, writes the lock', async () => {
    const env = makeEnv();
    const pkg = PACKAGE_PRODUCTS[PID.eightSeries];
    // Ledger history = just this one order, no appointments yet — deriveLedger
    // agrees with the formula (purchased 8, attended 0, remaining 8, high confidence).
    stubLedgerFetch({ orders: [listOrder(PID.eightSeries)] });

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
    expect(res.remainingSource).toBe('ledger'); // came from deriveLedger, not the fallback formula
    expect(addContactNote).toHaveBeenCalledTimes(1);
    // BOTH idempotency keys written: the worker's own (processed:) AND the
    // webhook's (order:). The two systems use different prefixes — the old
    // comment claimed a shared prefix that never existed, so a worker-applied
    // order left the webhook free to double-apply (2026-07-02 audit).
    expect(env.PURCHASE_KV.put).toHaveBeenCalled();
    expect(JSON.parse(env.store['processed:order-1']).action).toBe('applied');
    expect(env.store['order:order-1']).toBeTruthy();
    // No review flag — deriveLedger was confident, nothing to surface.
    expect(env.PORTAL_KV.put).not.toHaveBeenCalled();
  });

  it('REGRESSION (tag-clobber M10): removes only REMOVE_TAGS via removeContactTags and never PUTs a full tag array — unrelated tags survive', async () => {
    const env = makeEnv();
    const removeTag = REMOVE_TAGS[0]; // e.g. "discovery call attended"
    const unrelatedTag = 'vip-do-not-clobber';
    getContact.mockResolvedValue(contact({}, [removeTag, unrelatedTag]));
    stubLedgerFetch({ orders: [listOrder(PID.eightSeries)] });

    const res = await reconcileOrder(env, order());
    expect(res.status).toBe('applied');

    // patchContact must be called WITHOUT a tags array (4th arg undefined) so the
    // contact PUT can't replace the whole tag set and drop `unrelatedTag`.
    expect(patchContact).toHaveBeenCalledTimes(1);
    expect(patchContact.mock.calls[0][3]).toBeUndefined();

    // Only the REMOVE_TAG is deleted, additively; the unrelated tag is never touched.
    expect(removeContactTags).toHaveBeenCalledTimes(1);
    const [, , tagsArg] = removeContactTags.mock.calls[0];
    expect(tagsArg).toEqual([removeTag]);
    expect(tagsArg).not.toContain(unrelatedTag);
  });

  it('skips removeContactTags entirely when the contact carries none of REMOVE_TAGS', async () => {
    const env = makeEnv();
    getContact.mockResolvedValue(contact({}, ['vip-only']));
    stubLedgerFetch({ orders: [listOrder(PID.eightSeries)] });

    await reconcileOrder(env, order());

    expect(patchContact).toHaveBeenCalledTimes(1);
    expect(removeContactTags).not.toHaveBeenCalled();
  });

  it('applies a 4-session purchase WITHOUT living_practice_access (4-pack has no LP)', async () => {
    const env = makeEnv();
    stubLedgerFetch({ orders: [listOrder(PID.fourSeries)] });
    const res = await reconcileOrder(env, order({ items: [lineItem(PID.fourSeries)] }));

    expect(res.status).toBe('applied');
    const [, , customFields] = patchContact.mock.calls[0];
    const ids = customFields.map((f) => f.id);
    expect(ids).toContain(FIELD_IDS.series_type);
    expect(ids).toContain(FIELD_IDS.sessions_remaining);
    expect(ids).not.toContain(FIELD_IDS.living_practice_access);
    expect(customFields.find((f) => f.id === FIELD_IDS.sessions_remaining).value).toBe(4);
  });

  it('skips (no writes) when the order was already processed — idempotency', async () => {
    const env = makeEnv({ 'processed:order-1': JSON.stringify({ action: 'applied' }) });
    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('skip-already-processed');
    expect(patchContact).not.toHaveBeenCalled();
    expect(addContactNote).not.toHaveBeenCalled();
  });

  it("skips when the WEBHOOK already processed the order (order: prefix) and back-fills the worker's own marker", async () => {
    // The purchase webhook records idempotency under `order:<id>`, not
    // `processed:<id>`. Before 2026-07-02 the worker never read that key, so
    // a webhook-processed order was only protected by the field-state check —
    // which the additive 4→8 upgrade can race past.
    const env = makeEnv({ 'order:order-1': JSON.stringify({ processedAt: '2026-07-02T10:00:00Z' }) });
    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('skip-already-processed');
    expect(patchContact).not.toHaveBeenCalled();
    expect(addContactNote).not.toHaveBeenCalled();
    // Own marker back-filled so next hour's scan skips on the first read.
    expect(env.store['processed:order-1']).toBeTruthy();
    expect(JSON.parse(env.store['processed:order-1']).reason).toMatch(/webhook/i);
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

  // CRIT-B (2026-06-11 review): the `sessions_remaining_locked` hard lock was
  // honored only by the sync-sweep path (sync.js), NOT by this order path —
  // so a locked contact (e.g. Albert Yang, Garrett-comped) who made any package
  // POS purchase would have their pinned balance overwritten by the orphan-apply
  // below. The lock must skip this writer entirely, before any patchContact.
  const LOCK_FIELD = 'oDyLqIeq3yTkyhgXhAmk'; // sessions_remaining_locked

  it('skips a LOCKED contact without writing — even when the package fields are unset (would otherwise apply)', async () => {
    const env = makeEnv();
    // Fresh contact (no package fields) BUT locked → must not apply.
    getContact.mockResolvedValue(contact({ [LOCK_FIELD]: ['true'] }));

    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('skip-locked');
    expect(patchContact).not.toHaveBeenCalled();   // critical: never overwrites a pinned balance
    expect(addContactNote).not.toHaveBeenCalled();
    expect(env.PURCHASE_KV.put).not.toHaveBeenCalled(); // no idempotency write either — leave it re-checkable
  });

  it('honors the lock whether the checkbox reads ["true"] or the string "true"', async () => {
    const env = makeEnv();
    getContact.mockResolvedValue(contact({ [LOCK_FIELD]: 'true' }));
    const res = await reconcileOrder(env, order());
    expect(res.status).toBe('skip-locked');
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

  // THE BUG THIS FIX CLOSES: the old "current field + this order's delta" formula
  // only ever saw ONE order. If the ORIGINAL package's workflow also never fired
  // (sessions_remaining still unwritten), the formula treats "unwritten" as 0 and
  // silently forgets any sessions the client already attended against that first
  // package — undercounting. deriveLedger recomputes from the FULL order +
  // appointment history every time, so it can't lose that information.
  it('4→8 upgrade on a double-orphan contact: deriveLedger correctly nets out 2 already-attended sessions; the old formula would have undercounted', async () => {
    const env = makeEnv();
    // Client bought a 4-pack earlier (also an orphan — remaining was never
    // written), attended 2 follow-ups against it, and is now upgrading to 8.
    getContact.mockResolvedValue(contact({})); // series_type/remaining unset
    stubLedgerFetch({
      orders: [
        listOrder(PID.fourSeries, { createdAt: '2026-01-01T00:00:00Z' }), // original pack
        listOrder('6a010952e41b442c862d3c01', { createdAt: '2026-03-01T00:00:00Z' }), // this upgrade order
      ],
      appointments: [
        appt({ startTime: '2026-01-15T18:00:00' }),
        appt({ startTime: '2026-02-01T18:00:00' }),
      ],
    });

    const upgradeOrder = order({
      _id: 'order-upgrade-1',
      items: [lineItem('6a010952e41b442c862d3c01')],
    });
    const res = await reconcileOrder(env, upgradeOrder);

    expect(res.status).toBe('applied');
    expect(res.remainingSource).toBe('ledger');
    // purchased 4 (original) + 4 (upgrade delta) = 8; attended 2 → remaining 6.
    // The old formula (0 unwritten + 4 delta) would have written 4 — wrong.
    expect(res.sessionsRemaining).toBe(6);
    const [, , customFields] = patchContact.mock.calls[0];
    expect(customFields.find((f) => f.id === FIELD_IDS.sessions_remaining).value).toBe(6);
    expect(env.PORTAL_KV.put).not.toHaveBeenCalled(); // high confidence — no review flag needed
  });

  it('falls back to the formula and flags for review when deriveLedger cannot confidently derive a count', async () => {
    const env = makeEnv();
    // session_prepaid="yes" with NO matching orders in the ledger fetch trips
    // deriveLedger's prepaid-override guard (same mechanism sync.test.js's
    // "skips a low-confidence derivation" test relies on) → confidence "low".
    // The client must still get provisioned (portal access etc.) rather than
    // stall on a review queue, but the number used is the fallback formula,
    // flagged for a human to check.
    getContact.mockResolvedValue(contact({ [FIELD_IDS.session_prepaid]: 'yes' }));
    stubLedgerFetch({ orders: [] });

    const res = await reconcileOrder(env, order());

    expect(res.status).toBe('applied'); // client still gets unblocked
    expect(res.remainingSource).toBe('formula (flagged for review)');
    expect(res.sessionsRemaining).toBe(PACKAGE_PRODUCTS[PID.eightSeries].sessionsToSet); // formula value (8)
    expect(patchContact).toHaveBeenCalledTimes(1);

    // Flagged into the SAME needs-review queue sync.js uses.
    expect(env.PORTAL_KV.put).toHaveBeenCalledTimes(1);
    const [key, value] = env.PORTAL_KV.put.mock.calls[0];
    expect(key).toBe('field-sync:needsReview:contact-1');
    const flagged = JSON.parse(value);
    expect(flagged.reason).toMatch(/fallback formula/i);
    expect(flagged.orderId).toBe('order-1');
  });
});
