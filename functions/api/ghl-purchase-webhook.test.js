import { describe, it, expect } from 'vitest';
import { PRODUCT_MAP } from './ghl-purchase-webhook.js';

const PID = {
  // package purchases (SET sessions_remaining)
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  // à-la-carte standalone follow-up ($190) — SHOULD credit +1 (ADD)
  singleFollowupSession: '6998ace59dfde469ecb2aab6',
  retiredFollowup: '67f57171b6b1019c7b0233cc',
  // draw-down / booking products — ride on a booking against an existing
  // package; crediting them would inflate the balance. Must NEVER be credited.
  // (Classifications confirmed with Eben 2026-06-05.)
  followupInPerson: '69aee204e80b62d627d8e922',
  followupVirtual: '69aee3ebcf9cf8ed9f6c928d',
  prePurchasedSession: '67b1299f080422451447bdd0',
};

describe('PRODUCT_MAP — purchase crediting', () => {
  it('credits the à-la-carte Single Follow-up Session (+1, no series change)', () => {
    const p = PRODUCT_MAP[PID.singleFollowupSession];
    expect(p).toBeDefined();
    expect(p.sessionsToAdd).toBe(1);
    expect(p.seriesType).toBe(null);
  });

  it('credits package series with the right session counts', () => {
    expect(PRODUCT_MAP[PID.fourSeries].sessionsToAdd).toBe(4);
    expect(PRODUCT_MAP[PID.eightSeries].sessionsToAdd).toBe(8);
  });

  // The trap: a future "add the missing follow-up IDs" change would inflate
  // sessions_remaining on every booking. These three are draw-downs, not
  // purchases — they must stay out of the credit map.
  it('NEVER credits draw-down / booking products', () => {
    expect(PRODUCT_MAP[PID.followupInPerson]).toBeUndefined();
    expect(PRODUCT_MAP[PID.followupVirtual]).toBeUndefined();
    expect(PRODUCT_MAP[PID.prePurchasedSession]).toBeUndefined();
  });
});
