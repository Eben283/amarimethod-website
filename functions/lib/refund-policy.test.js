import { describe, it, expect } from 'vitest';
import { decideRefundAction } from './refund-policy.js';

// Stripe amounts are in cents.
const charge = (amount, amountRefunded, description = '') => ({
  amount,
  amount_refunded: amountRefunded,
  description,
});

describe('decideRefundAction', () => {
  it('AUTO-REVOKES a full refund of an un-drawn 8-Session Series', () => {
    const r = decideRefundAction(charge(129500, 129500), { sessionsRemaining: 8 });
    expect(r.action).toBe('revoke');
    expect(r.fields).toEqual({ sessionsRemaining: 0, portalAccess: false, livingPractice: false });
  });

  it('AUTO-REVOKES a full refund of an un-drawn 4-Session Series', () => {
    const r = decideRefundAction(charge(72000, 72000), { sessionsRemaining: 4 });
    expect(r.action).toBe('revoke');
    expect(r.fields.sessionsRemaining).toBe(0);
  });

  it('ALERTS (no mutation) on a partial refund', () => {
    const r = decideRefundAction(charge(129500, 50000), { sessionsRemaining: 8 });
    expect(r.action).toBe('alert');
    expect(r.fields).toBeUndefined();
  });

  it('ALERTS when the series was already drawn down (sessions used)', () => {
    const r = decideRefundAction(charge(129500, 129500), { sessionsRemaining: 5 });
    expect(r.action).toBe('alert');
    expect(r.fields).toBeUndefined();
  });

  it('ALERTS on a full refund of a non-series charge (follow-up $190)', () => {
    const r = decideRefundAction(charge(19000, 19000), { sessionsRemaining: 1 });
    expect(r.action).toBe('alert');
  });

  it('ALERTS on a full refund of an upgrade — upgrades never auto-revoke', () => {
    // Upgrade Initial→8 ($1,070); balance would be 8 (1 initial + 7) — still alert.
    const r = decideRefundAction(charge(107000, 107000), { sessionsRemaining: 8 });
    expect(r.action).toBe('alert');
  });

  it('ALERTS on a full refund of an unrecognized amount', () => {
    const r = decideRefundAction(charge(99900, 99900), { sessionsRemaining: 8 });
    expect(r.action).toBe('alert');
  });
});
