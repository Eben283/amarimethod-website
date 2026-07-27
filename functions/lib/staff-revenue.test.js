import { describe, expect, it } from 'vitest';
import { recentPacificMonthKeys, summarizeRevenueCharges } from './staff-revenue.js';

describe('recentPacificMonthKeys', () => {
  it('returns continuous calendar months across a year boundary', () => {
    expect(recentPacificMonthKeys(new Date('2026-01-20T20:00:00Z'), 4)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01',
    ]);
  });
});

describe('summarizeRevenueCharges', () => {
  it('keeps only successful, non-zero Stripe revenue and reduces partial refunds', () => {
    const months = ['2026-05', '2026-06', '2026-07'];
    const { trend, thisMonth } = summarizeRevenueCharges([
      { created: Date.parse('2026-07-25T22:30:00Z') / 1000, paid: true, status: 'succeeded', amount: 129500, amount_refunded: 0, balance_transaction: { fee: 4055 } },
      { created: Date.parse('2026-07-16T21:30:00Z') / 1000, paid: true, status: 'succeeded', amount: 29000, amount_refunded: 10000, balance_transaction: { fee: 900 } },
      { created: Date.parse('2026-06-10T20:00:00Z') / 1000, paid: false, status: 'failed', amount: 9000, amount_refunded: 0, balance_transaction: { fee: 300 } },
      { created: Date.parse('2026-05-10T20:00:00Z') / 1000, paid: true, status: 'succeeded', amount: 9000, amount_refunded: 9000, balance_transaction: { fee: 300 } },
    ], months);

    expect(trend).toEqual([
      { month: '2026-05', gross: 0, fees: 0, net: 0, chargeCount: 0 },
      { month: '2026-06', gross: 0, fees: 0, net: 0, chargeCount: 0 },
      { month: '2026-07', gross: 1485, fees: 49.55, net: 1435.45, chargeCount: 2 },
    ]);
    expect(thisMonth).toEqual(trend[2]);
  });
});
