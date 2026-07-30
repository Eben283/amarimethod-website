// Resolve a GHL contact's Stripe charges and classify each into session-equivalents.
//
// Stripe is the COMPLETE money record — payment links, POS/invoices, and
// entrainments all settle through GHL's Stripe Connect. GHL stamps a reference
// into each charge's metadata: `contactId` (payment-link orders), `invoiceId`
// (POS/invoices), or `transactionId` (entrainments). We resolve a contact's
// charges via, in order:
//   1. Stripe Search on metadata.contactId → direct charges + their customer id(s)
//   2. list charges by those customer id(s) → catches invoice/entrainment charges
//      that share the Stripe customer but carry no contactId metadata
//   3. fallback: customers-by-email → their charges (contacts who never paid by link)
// Dedupe by charge id; keep only succeeded + not-refunded.
//
// NOTE (known limitation): a contact whose POS charges live under a *different*
// Stripe customer than any payment-link charge, and who has no contactId charge,
// is only reachable via the email fallback. Good enough for the common cases;
// flagged so a later pass can resolve invoiceId/transactionId → GHL → contact
// directly if needed.

// Known product prices (DOLLARS) → package session-equivalents. Mirrors
// reconcile.js PACKAGE_PRODUCTS + the pricing table in CLAUDE.md.
export const AMOUNT_TO_SESSIONS = Object.freeze({
  5400: { sessions: 24, label: 'The 12-Week Amari Practice' },
  5500: { sessions: 24, label: 'The 12-Week Amari Practice' }, // historical pre-$5,400 price
  3000: { sessions: 12, label: 'The 6-Week Amari Practice' },
  1295: { sessions: 8, label: '8-Session Series' },
  720:  { sessions: 4, label: '4-Session Series' },
  1070: { sessions: 7, label: 'Upgrade Initial→8' },
  575:  { sessions: 4, label: 'Upgrade 4→8' },
  495:  { sessions: 3, label: 'Upgrade Initial→4' },
  225:  { sessions: 1, label: 'Initial Session' },
  285:  { sessions: 1, label: 'Single Session' },
  190:  { sessions: 1, label: 'Follow-up Session' }, // Founder's Circle legacy à-la-carte
  90:   { sessions: 0, label: 'Entrainment' },
  347:  { sessions: 0, label: 'Living Practice' },
});

// Classify a Stripe charge into session-equivalents. Prefers an explicit product
// name in the description; falls back to the paid amount. Returns sessions:null /
// kind:'unknown' when neither matches — it NEVER guesses (unknowns are surfaced
// for review, the same discipline the GHL-order classifier should have had).
export function classifyCharge(charge) {
  // Net of refunds — a partially-refunded charge shouldn't count at its full
  // amount (Stripe's `refunded` flag is only true for FULL refunds).
  const amount = ((charge.amount || 0) - (charge.amount_refunded || 0)) / 100;
  const desc = charge.description || '';
  const byDesc =
    /12.?week|24.?session/i.test(desc) ? { sessions: 24, label: 'The 12-Week Amari Practice' } :
    /6.?week/i.test(desc) ? { sessions: 12, label: 'The 6-Week Amari Practice' } :
    /8-session/i.test(desc) ? { sessions: 8, label: '8-Session Series' } :
    /4-session/i.test(desc) ? { sessions: 4, label: '4-Session Series' } :
    /entrainment/i.test(desc) ? { sessions: 0, label: 'Entrainment' } :
    /living practice/i.test(desc) ? { sessions: 0, label: 'Living Practice' } :
    /initial/i.test(desc) ? { sessions: 1, label: 'Initial Session' } :
    /single.?session/i.test(desc) ? { sessions: 1, label: 'Single Session' } :
    /follow.?up/i.test(desc) ? { sessions: 1, label: 'Follow-up Session' } :
    null;
  if (byDesc) return { ...byDesc, amount, kind: 'matched-description' };
  const byAmount = AMOUNT_TO_SESSIONS[amount];
  if (byAmount) return { sessions: byAmount.sessions, label: byAmount.label, amount, kind: 'matched-amount' };
  return { sessions: null, label: null, amount, kind: 'unknown' };
}

// Aggregate a resolved charge list. Pure. sessionsPurchased sums only classified
// charges; unknowns are collected (never silently counted as 0 against the math).
export function summarizeCharges(charges) {
  let totalPaid = 0;
  let sessionsPurchased = 0;
  const unknown = [];
  for (const c of charges) {
    const cl = classifyCharge(c);
    totalPaid += cl.amount; // cl.amount is net-of-refund
    if (cl.sessions === null) unknown.push({ id: c.id, amount: cl.amount, description: c.description || null });
    else sessionsPurchased += cl.sessions;
  }
  const unknownMax = unknown.reduce((m, u) => Math.max(m, u.amount || 0), 0);
  return { totalPaid, sessionsPurchased, unknownCount: unknown.length, unknownMax, unknown };
}

function keepCharge(c) {
  if (!(c && c.id && c.paid && c.status === 'succeeded' && !c.refunded)) return false;
  // Drop charges fully refunded via amount_refunded (refunded flag not always set).
  const net = (c.amount || 0) - (c.amount_refunded || 0);
  return net > 0;
}

// Resolve all Stripe charges attributable to a contact. `stripe` is any object
// implementing searchCharges/listChargesByCustomer/listCustomersByEmail (see
// makeStripeClient) — injectable for testing.
export async function resolveContactCharges(stripe, { contactId, email, customerId } = {}) {
  const byId = new Map();
  const customerIds = new Set();
  // Seed with a known Stripe customer id (stored from a prior resolve) — the
  // cheap, exact path that also catches POS-only clients with no contactId charge.
  if (customerId) customerIds.add(customerId);
  const add = (charges) => {
    for (const c of (charges || [])) {
      if (!keepCharge(c)) continue;
      byId.set(c.id, c);
      if (c.customer) customerIds.add(c.customer);
    }
  };

  // 1. Direct: charges stamped with this contactId.
  if (contactId) {
    const r = await stripe.searchCharges(`metadata["contactId"]:"${contactId}"`);
    if (r && !r.error) add(r.data);
  }

  // A shared Stripe customer (spouse, same card) can carry charges tagged with a
  // DIFFERENT contactId. Never count those against this contact — that would
  // hide their real debt. Charges with no contactId (invoices/entrainments) or a
  // matching contactId are kept. The contactId search above is always authoritative.
  const notForeign = (c) => !(contactId && c.metadata?.contactId && c.metadata.contactId !== contactId);

  // 2. Everything else under the same Stripe customer(s) — invoice + entrainment
  //    charges that lack contactId metadata but share the customer.
  for (const cust of [...customerIds]) {
    const r = await stripe.listChargesByCustomer(cust);
    if (r && !r.error) add((r.data || []).filter(notForeign));
  }

  // 3. Email fallback — only when nothing was found via the contactId path.
  if (email && byId.size === 0) {
    const cu = await stripe.listCustomersByEmail(email);
    for (const c of (cu?.data || [])) {
      const r = await stripe.listChargesByCustomer(c.id);
      if (r && !r.error) add((r.data || []).filter(notForeign));
    }
  }

  return [...byId.values()];
}

// The Stripe customer id worth remembering for this contact: the customer behind
// the most resolved charges (ties → first). Storing it lets a later resolve hit
// listChargesByCustomer directly — exact + cheap, even for POS-only clients.
export function pickCustomerId(charges) {
  const counts = new Map();
  for (const c of (charges || [])) {
    if (!c.customer) continue;
    counts.set(c.customer, (counts.get(c.customer) || 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [id, ct] of counts) {
    if (ct > n) { best = id; n = ct; }
  }
  return best;
}

// The Stripe customer id PROVEN to belong to this contact — the customer behind a
// charge whose metadata.contactId matches exactly. Only this is safe to PERSIST as
// the contact's stored key (an email-matched or shared customer isn't authoritative).
export function authoritativeCustomerId(charges, contactId) {
  if (!contactId) return null;
  for (const c of (charges || [])) {
    if (c.customer && c.metadata && c.metadata.contactId === contactId) return c.customer;
  }
  return null;
}

// Fetch-based Stripe REST wrapper. Uses Bearer auth (matches cos-lookups.js) so
// there's no base64/Buffer dependency in the Workers runtime.
//
// Both charge endpoints follow Stripe pagination so a long-tenured contact with
// >100 charges (sessions + entrainments over years) isn't silently truncated at
// the first page: list endpoints use the `starting_after` cursor, the search
// endpoint uses the `next_page` token. A safety cap bounds the loop and WARNS
// (never silently stops) if a contact somehow exceeds it.
const STRIPE_MAX_PAGES = 20; // 20 × 100 = 2000 charges — far beyond any real contact

export function makeStripeClient(secretKey, fetchImpl = fetch) {
  const base = 'https://api.stripe.com/v1';
  const get = async (path) => {
    const res = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${secretKey}` } });
    return res.json();
  };

  // Cursor-paginate a Stripe list endpoint. `buildPath(cursor)` returns the path
  // for the next page (cursor is the last seen id, or null for the first page).
  // On a first-page error, returns the raw error object so callers skip it (same
  // as before). On a later-page error, returns what was collected so far.
  const getList = async (label, buildPath) => {
    const all = [];
    let cursor = null;
    for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
      const r = await get(buildPath(cursor));
      if (!r || r.error) {
        if (all.length === 0) return r;
        break;
      }
      const data = r.data || [];
      all.push(...data);
      if (!r.has_more || data.length === 0) break;
      cursor = data[data.length - 1].id;
      if (page === STRIPE_MAX_PAGES - 1 && r.has_more) {
        console.warn(`[stripe-charges] ${label}: hit ${STRIPE_MAX_PAGES}-page cap with has_more=true — charge list may be truncated`);
      }
    }
    return { data: all };
  };

  const searchCharges = async (query) => {
    const all = [];
    let pageToken = null;
    for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
      const pageParam = pageToken ? `&page=${encodeURIComponent(pageToken)}` : '';
      const r = await get(`/charges/search?query=${encodeURIComponent(query)}&limit=100${pageParam}`);
      if (!r || r.error) {
        if (all.length === 0) return r;
        break;
      }
      all.push(...(r.data || []));
      if (!r.has_more || !r.next_page) break;
      pageToken = r.next_page;
      if (page === STRIPE_MAX_PAGES - 1 && r.has_more) {
        console.warn(`[stripe-charges] searchCharges: hit ${STRIPE_MAX_PAGES}-page cap with has_more=true — search results may be truncated`);
      }
    }
    return { data: all };
  };

  return {
    searchCharges,
    listChargesByCustomer: (customerId) =>
      getList(
        `listChargesByCustomer(${customerId})`,
        (cursor) =>
          `/charges?customer=${encodeURIComponent(customerId)}&limit=100` +
          (cursor ? `&starting_after=${encodeURIComponent(cursor)}` : '')
      ),
    listCustomersByEmail: (email) => get(`/customers?email=${encodeURIComponent(email)}&limit=10`),
  };
}
