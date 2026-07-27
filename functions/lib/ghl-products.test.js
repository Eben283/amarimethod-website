import { describe, it, expect } from 'vitest';
import {
  GHL_PRODUCTS,
  LEDGER_PRODUCT_MAP,
  WEBHOOK_PURCHASE_MAP,
  PACKAGE_TYPES,
  productIdForAnyId,
  productForAnyId,
  PURCHASE_CREDIT_MAP,
  PACKAGE_MAP,
  AUDIT_INCREMENT_MAP,
} from './ghl-products.js';

describe('GHL_PRODUCTS catalog', () => {
  it('contains 15 currently-sold products', () => {
    expect(Object.keys(GHL_PRODUCTS).length).toBe(15);
  });

  it('every entry has required shape', () => {
    for (const [id, p] of Object.entries(GHL_PRODUCTS)) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(10);
      expect(typeof p.name).toBe('string');
      expect(typeof p.classification).toBe('string');
      expect(typeof p.sessions).toBe('number');
      expect(typeof p.isPackagePurchase).toBe('boolean');
    }
  });

  it('package-purchase entries have seriesType, sessionsRemaining, livingPractice', () => {
    for (const p of Object.values(GHL_PRODUCTS)) {
      if (!p.isPackagePurchase) continue;
      expect(typeof p.seriesType).toBe('string');
      expect(typeof p.sessionsRemaining).toBe('number');
      expect(typeof p.livingPractice).toBe('boolean');
      expect(PACKAGE_TYPES.has(p.classification)).toBe(true);
    }
  });

  it('has exactly 6 package-purchase entries (3 practices + 3 upgrades)', () => {
    const packages = Object.values(GHL_PRODUCTS).filter((p) => p.isPackagePurchase);
    expect(packages.length).toBe(6);
    const classifications = packages.map((p) => p.classification).sort();
    expect(classifications).toEqual(['12-week', '4-series', '4-to-8-upgrade', '4-upgrade', '8-series', '8-upgrade']);
  });

  it('includes the protocol library with the 8-session and 12-week practices', () => {
    for (const p of Object.values(GHL_PRODUCTS)) {
      if (!p.isPackagePurchase) continue;
      // The real rule is seriesType, not classification name — the 4→8 upgrade
      // lands a client on the 8-session series, so it unlocks Living Practice.
      expect(p.livingPractice).toBe(['8-session', '12-week'].includes(p.seriesType));
    }
  });

  it('upgrades add 3 or 7 (not 4 or 8) — assumes initial already counted as +1', () => {
    const fourUpgrade = Object.values(GHL_PRODUCTS).find((p) => p.classification === '4-upgrade');
    const eightUpgrade = Object.values(GHL_PRODUCTS).find((p) => p.classification === '8-upgrade');
    expect(fourUpgrade.sessionsRemaining).toBe(3);
    expect(eightUpgrade.sessionsRemaining).toBe(7);
  });

  it('entrainment, living practice, and the Assessment contribute 0 sessions', () => {
    const entrainment = Object.values(GHL_PRODUCTS).find((p) => p.classification === 'entrainment');
    const livingPractice = Object.values(GHL_PRODUCTS).find((p) => p.classification === 'living-practice');
    const assessment = Object.values(GHL_PRODUCTS).find((p) => p.classification === 'assessment');
    expect(entrainment.sessions).toBe(0);
    expect(livingPractice.sessions).toBe(0);
    expect(assessment.sessions).toBe(0);
  });
});

describe('LEDGER_PRODUCT_MAP (session-ledger consumer)', () => {
  it('has one entry per GHL_PRODUCTS entry', () => {
    expect(Object.keys(LEDGER_PRODUCT_MAP).length).toBe(Object.keys(GHL_PRODUCTS).length);
  });

  it('exposes only type and sessions', () => {
    for (const entry of Object.values(LEDGER_PRODUCT_MAP)) {
      expect(Object.keys(entry).sort()).toEqual(['sessions', 'type']);
    }
  });
});

describe('WEBHOOK_PURCHASE_MAP (invoice webhook consumer)', () => {
  it('only contains package-purchase entries', () => {
    expect(Object.keys(WEBHOOK_PURCHASE_MAP).length).toBe(6);
  });

  it('exposes name, sessionsRemaining, seriesType, livingPractice', () => {
    for (const entry of Object.values(WEBHOOK_PURCHASE_MAP)) {
      expect(Object.keys(entry).sort()).toEqual(['livingPractice', 'name', 'seriesType', 'sessionsRemaining']);
    }
  });

  it('does NOT include non-package products', () => {
    // Pick a known non-package productId (follow-up in person)
    expect(WEBHOOK_PURCHASE_MAP['69aee204e80b62d627d8e922']).toBeUndefined();
    // And entrainment
    expect(WEBHOOK_PURCHASE_MAP['69c5d29c4019ce8e80e2513b']).toBeUndefined();
  });
});

// Real ids for the derived-map tests.
const ID = {
  eightSeries: '69987357c839790426996114',
  eightSeriesPrice: '69987357c83979a1f0996119',
  eightSeriesPriceOld: '699873074d5b8cc0bc0e3b5a',
  fourSeries: '69986faa724ecd2343ebaa6e',
  fourSeriesPriceOld: '699872e130cc6054f9bba617',
  twelveWeek: '6a66cde7ef7b07f122ad46fb',
  twelveWeekPrice: '6a66cde7ef7b076d15ad4700',
  upInit8: '699873d6990b71ebc1fa26b4',
  upInit4: '6998739230cc6054f9bba62d',
  up4to8: '6a010952e41b442c862d3c01',
  initialIP: '688a1cd770362828afbf08a2',
  initialVirt: '690b6b4d333ffa59d40c1823',
  singleFU: '6998ace59dfde469ecb2aab6',
  fuIP: '69aee204e80b62d627d8e922', // draw-down
  fuVirt: '69aee3ebcf9cf8ed9f6c928d', // draw-down
  prePurchased: '67b1299f080422451447bdd0', // draw-down
  entrainment: '69c5d29c4019ce8e80e2513b',
  livingPractice: '6998d7f2606fa79c54fa3ff5',
  assessment: '6a66cf0103821ea09ea13f1b',
  assessmentPrice: '6a66cf0103821e836fa13f20',
};

describe('any-id resolver (productId + priceId)', () => {
  it('resolves a productId to itself', () => {
    expect(productIdForAnyId(ID.eightSeries)).toBe(ID.eightSeries);
  });
  it('resolves a current priceId to its product', () => {
    expect(productIdForAnyId(ID.eightSeriesPrice)).toBe(ID.eightSeries);
    expect(productForAnyId(ID.eightSeriesPrice).name).toBe('8-Session Series');
  });
  it('resolves the 12-Week Practice product and its current $5,500 price', () => {
    expect(productIdForAnyId(ID.twelveWeek)).toBe(ID.twelveWeek);
    expect(productIdForAnyId(ID.twelveWeekPrice)).toBe(ID.twelveWeek);
    expect(productForAnyId(ID.twelveWeekPrice).name).toBe('The 12-Week Amari Practice');
  });
  it('resolves the $29 Amari Assessment product and its current price', () => {
    expect(productIdForAnyId(ID.assessment)).toBe(ID.assessment);
    expect(productIdForAnyId(ID.assessmentPrice)).toBe(ID.assessment);
    expect(productForAnyId(ID.assessmentPrice).name).toBe('Amari Assessment');
  });
  it('resolves a HISTORICAL priceId too (the stale-id case the audit hit)', () => {
    expect(productIdForAnyId(ID.eightSeriesPriceOld)).toBe(ID.eightSeries);
    expect(productIdForAnyId(ID.fourSeriesPriceOld)).toBe(ID.fourSeries);
  });
  it('returns null for an unknown id', () => {
    expect(productIdForAnyId('nope')).toBe(null);
    expect(productForAnyId('nope')).toBe(null);
  });
});

describe('PURCHASE_CREDIT_MAP (purchase webhook consumer)', () => {
  it('credits packages with the right SET amounts + seriesType', () => {
    expect(PURCHASE_CREDIT_MAP[ID.eightSeries]).toMatchObject({ sessionsToAdd: 8, seriesType: '8-session', livingPractice: true });
    expect(PURCHASE_CREDIT_MAP[ID.fourSeries]).toMatchObject({ sessionsToAdd: 4, seriesType: '4-session', livingPractice: false });
    expect(PURCHASE_CREDIT_MAP[ID.upInit8]).toMatchObject({ sessionsToAdd: 7, seriesType: '8-session' });
    expect(PURCHASE_CREDIT_MAP[ID.upInit4]).toMatchObject({ sessionsToAdd: 3, seriesType: '4-session' });
    expect(PURCHASE_CREDIT_MAP[ID.up4to8]).toMatchObject({ sessionsToAdd: 4, seriesType: '8-session', livingPractice: true });
    expect(PURCHASE_CREDIT_MAP[ID.twelveWeek]).toMatchObject({ sessionsToAdd: 24, seriesType: '12-week', livingPractice: true });
  });
  it('credits à-la-carte singles +1 with no series change', () => {
    expect(PURCHASE_CREDIT_MAP[ID.singleFU]).toMatchObject({ sessionsToAdd: 1, seriesType: null });
    expect(PURCHASE_CREDIT_MAP[ID.initialIP]).toMatchObject({ sessionsToAdd: 1, seriesType: null });
    expect(PURCHASE_CREDIT_MAP[ID.initialVirt]).toMatchObject({ sessionsToAdd: 1, seriesType: null });
  });
  it('NEVER credits draw-downs, entrainment, living practice, or the Assessment', () => {
    expect(PURCHASE_CREDIT_MAP[ID.fuIP]).toBeUndefined();
    expect(PURCHASE_CREDIT_MAP[ID.fuVirt]).toBeUndefined();
    expect(PURCHASE_CREDIT_MAP[ID.prePurchased]).toBeUndefined();
    expect(PURCHASE_CREDIT_MAP[ID.entrainment]).toBeUndefined();
    expect(PURCHASE_CREDIT_MAP[ID.livingPractice]).toBeUndefined();
    expect(PURCHASE_CREDIT_MAP[ID.assessment]).toBeUndefined();
  });
});

describe('PACKAGE_MAP (reconcile worker consumer)', () => {
  it('has the 6 packages with sessionsToSet', () => {
    expect(Object.keys(PACKAGE_MAP).length).toBe(6);
    expect(PACKAGE_MAP[ID.eightSeries]).toMatchObject({ sessionsToSet: 8, seriesType: '8-session', livingPractice: true });
    expect(PACKAGE_MAP[ID.up4to8]).toMatchObject({ sessionsToSet: 4, seriesType: '8-session' });
    expect(PACKAGE_MAP[ID.twelveWeek]).toMatchObject({ sessionsToSet: 24, seriesType: '12-week', livingPractice: true });
  });
  it('excludes singles + draw-downs', () => {
    expect(PACKAGE_MAP[ID.singleFU]).toBeUndefined();
    expect(PACKAGE_MAP[ID.fuIP]).toBeUndefined();
  });
});

describe('Kristina 8-Session Series product identity (regression 2026-07-08)', () => {
  // Kristina Schubert paid a real $1,295 8-Session Series. The qa-audit tool
  // derived her balance wrong because it keyed on a RETIRED priceId. Pin both
  // the productId classification AND that productIdForAnyId resolves the
  // current price and the retired/historical price back to the same product,
  // so any future map edit that drops a priceId trips this test.
  it('productId 69987357c839790426996114 is the 8-Session Series (8 sessions, 8-session)', () => {
    const p = GHL_PRODUCTS[ID.eightSeries];
    expect(p.classification).toBe('8-series');
    expect(p.sessions).toBe(8);
    expect(p.seriesType).toBe('8-session');
    expect(LEDGER_PRODUCT_MAP[ID.eightSeries]).toEqual({ type: '8-series', sessions: 8 });
  });

  it('resolves BOTH the current and the retired priceId back to the productId', () => {
    // current priceId on Kristina's order
    expect(productIdForAnyId(ID.eightSeriesPrice)).toBe(ID.eightSeries);
    // historical priceId that also appeared on her order (the drift the audit hit)
    expect(productIdForAnyId(ID.eightSeriesPriceOld)).toBe(ID.eightSeries);
    // and the product resolved from either id is the 8-Session Series
    expect(productForAnyId(ID.eightSeriesPrice).name).toBe('8-Session Series');
    expect(productForAnyId(ID.eightSeriesPriceOld).name).toBe('8-Session Series');
  });
});

describe('AUDIT_INCREMENT_MAP (daily-audit consumer)', () => {
  it('is keyed by BOTH product and price ids (current + historical)', () => {
    expect(AUDIT_INCREMENT_MAP[ID.eightSeries]).toMatchObject({ increment: 8 });
    expect(AUDIT_INCREMENT_MAP[ID.eightSeriesPrice]).toMatchObject({ increment: 8 });
    expect(AUDIT_INCREMENT_MAP[ID.eightSeriesPriceOld]).toMatchObject({ increment: 8 });
    expect(AUDIT_INCREMENT_MAP[ID.twelveWeek]).toMatchObject({ increment: 24, seriesType: '12-week' });
    expect(AUDIT_INCREMENT_MAP[ID.twelveWeekPrice]).toMatchObject({ increment: 24, seriesType: '12-week' });
  });
  it('now covers the 4→8 upgrade (the prior blind spot)', () => {
    expect(AUDIT_INCREMENT_MAP[ID.up4to8]).toMatchObject({ increment: 4, seriesType: '8-session' });
  });
  it('covers the single follow-up but not draw-downs', () => {
    expect(AUDIT_INCREMENT_MAP[ID.singleFU]).toMatchObject({ increment: 1 });
    expect(AUDIT_INCREMENT_MAP[ID.fuIP]).toBeUndefined();
  });
});
