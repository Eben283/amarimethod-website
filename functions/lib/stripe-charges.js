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
  1295: { sessions: 8, label: '8-Session Series' },
  720:  { sessions: 4, label: '4-Session Series' },
  1070: { sessions: 7, label: 'Upgrade Initial→8' },
  575:  { sessions: 4, label: 'Upgrade 4→8' },
  495:  { sessions: 3, label: 'Upgrade Initial→4' },
  225:  { sessions: 1, label: 'Initial Session' },
  190:  { sessions: 1, label: 'Follow-up Session' },
  90:   { sessions: 0, label: 'Entrainment' },
  347:  { sessions: 0, label: 'Living Practice' },
});

// Classify a Stripe charge into session-equivalents. Prefers an explicit product
// name in the description; falls back to the paid amount. Returns sessions:null /
// kind:'unknown' when neither matches — it NEVER guesses (unknowns are surfaced
// for review, the same discipline the GHL-order classifier should have had).
export function classifyCharge(charge) {
  const amount = (charge.amount || 0) / 100;
  const desc = charge.description || '';
  const byDesc =
    /8-session/i.test(desc) ? { sessions: 8, label: '8-Session Series' } :
    /4-session/i.test(desc) ? { sessions: 4, label: '4-Session Series' } :
    /entrainment/i.test(desc) ? { sessions: 0, label: 'Entrainment' } :
    /living practice/i.test(desc) ? { sessions: 0, label: 'Living Practice' } :
    /initial/i.test(desc) ? { sessions: 1, label: 'Initial Session' } :
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
    totalPaid += (c.amount || 0) / 100;
    const cl = classifyCharge(c);
    if (cl.sessions === null) unknown.push({ id: c.id, amount: cl.amount, description: c.description || null });
    else sessionsPurchased += cl.sessions;
  }
  return { totalPaid, sessionsPurchased, unknownCount: unknown.length, unknown };
}

function keepCharge(c) {
  return c && c.id && c.paid && c.status === 'succeeded' && !c.refunded;
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

  // 2. Everything else under the same Stripe customer(s) — invoice + entrainment
  //    charges that lack contactId metadata but share the customer.
  for (const cust of [...customerIds]) {
    const r = await stripe.listChargesByCustomer(cust);
    if (r && !r.error) add(r.data);
  }

  // 3. Email fallback — only when nothing was found via the contactId path.
  if (email && byId.size === 0) {
    const cu = await stripe.listCustomersByEmail(email);
    for (const c of (cu?.data || [])) {
      const r = await stripe.listChargesByCustomer(c.id);
      if (r && !r.error) add(r.data);
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

// Fetch-based Stripe REST wrapper. Uses Bearer auth (matches cos-lookups.js) so
// there's no base64/Buffer dependency in the Workers runtime.
export function makeStripeClient(secretKey, fetchImpl = fetch) {
  const base = 'https://api.stripe.com/v1';
  const get = async (path) => {
    const res = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${secretKey}` } });
    return res.json();
  };
  return {
    searchCharges: (query) => get(`/charges/search?query=${encodeURIComponent(query)}&limit=100`),
    listChargesByCustomer: (customerId) => get(`/charges?customer=${encodeURIComponent(customerId)}&limit=100`),
    listCustomersByEmail: (email) => get(`/customers?email=${encodeURIComponent(email)}&limit=10`),
  };
}
