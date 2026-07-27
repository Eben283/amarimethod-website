// Small, read-only Stripe revenue summary for the authenticated staff Home page.
// Amounts are kept in cents until the response boundary so monthly totals remain exact.

const TIME_ZONE = 'America/Los_Angeles';
const MONTH_COUNT = 6;
const STRIPE_PAGE_LIMIT = 20;

function dateParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return { year: Number(value('year')), month: Number(value('month')) };
}

export function pacificMonthKey(date) {
  const { year, month } = dateParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function recentPacificMonthKeys(now = new Date(), count = MONTH_COUNT) {
  const { year, month } = dateParts(now);
  return Array.from({ length: count }, (_, index) => {
    const monthIndex = year * 12 + (month - 1) - count + 1 + index;
    const monthYear = Math.floor(monthIndex / 12);
    const monthNumber = (monthIndex % 12) + 1;
    return `${monthYear}-${String(monthNumber).padStart(2, '0')}`;
  });
}

export function summarizeRevenueCharges(charges, monthKeys) {
  const byMonth = new Map(monthKeys.map((month) => [month, { grossCents: 0, feesCents: 0, chargeCount: 0 }]));

  for (const charge of charges) {
    if (!charge?.paid || charge.status !== 'succeeded') continue;
    const month = pacificMonthKey(new Date(charge.created * 1000));
    const totals = byMonth.get(month);
    if (!totals) continue;

    // Fully refunded charges contribute nothing. Partial refunds reduce gross;
    // Stripe's balance transaction fee is the settled fee supplied by Stripe.
    const grossCents = Math.max(0, (charge.amount || 0) - (charge.amount_refunded || 0));
    if (!grossCents) continue;
    totals.grossCents += grossCents;
    totals.feesCents += Math.max(0, charge.balance_transaction?.fee || 0);
    totals.chargeCount += 1;
  }

  const trend = monthKeys.map((month) => {
    const totals = byMonth.get(month);
    const gross = totals.grossCents / 100;
    const fees = totals.feesCents / 100;
    return { month, gross, fees, net: gross - fees, chargeCount: totals.chargeCount };
  });
  return { trend, thisMonth: trend.at(-1) };
}

async function stripeJson(secretKey, path, fetchImpl) {
  const response = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || 'Stripe revenue request failed');
  }
  return data;
}

export async function getStaffRevenue(secretKey, { now = new Date(), fetchImpl = fetch } = {}) {
  const monthKeys = recentPacificMonthKeys(now);
  const cutoff = Math.floor(Date.UTC(Number(monthKeys[0].slice(0, 4)), Number(monthKeys[0].slice(5, 7)) - 1, 1) / 1000);
  const charges = [];
  let cursor = null;

  for (let page = 0; page < STRIPE_PAGE_LIMIT; page += 1) {
    const params = new URLSearchParams({ limit: '100', 'created[gte]': String(cutoff), 'expand[]': 'data.balance_transaction' });
    if (cursor) params.set('starting_after', cursor);
    const result = await stripeJson(secretKey, `/charges?${params}`, fetchImpl);
    const data = result.data || [];
    charges.push(...data);
    if (!result.has_more || !data.length) break;
    cursor = data.at(-1).id;
    if (page === STRIPE_PAGE_LIMIT - 1) console.warn('[staff-revenue] hit Stripe page safety cap');
  }

  return {
    generatedAt: now.toISOString(),
    timezone: TIME_ZONE,
    ...summarizeRevenueCharges(charges, monthKeys),
  };
}
