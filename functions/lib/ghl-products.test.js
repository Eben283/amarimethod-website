import { describe, it, expect } from 'vitest';
import {
  GHL_PRODUCTS,
  LEDGER_PRODUCT_MAP,
  WEBHOOK_PURCHASE_MAP,
  PACKAGE_TYPES,
} from './ghl-products.js';

describe('GHL_PRODUCTS catalog', () => {
  it('contains 13 currently-sold products', () => {
    expect(Object.keys(GHL_PRODUCTS).length).toBe(13);
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

  it('has exactly 5 package-purchase entries (2 series + 3 upgrades)', () => {
    const packages = Object.values(GHL_PRODUCTS).filter((p) => p.isPackagePurchase);
    expect(packages.length).toBe(5);
    const classifications = packages.map((p) => p.classification).sort();
    expect(classifications).toEqual(['4-series', '4-to-8-upgrade', '4-upgrade', '8-series', '8-upgrade']);
  });

  it('Living Practice access tracks the resulting series: every 8-session package grants it, 4-session ones do not', () => {
    for (const p of Object.values(GHL_PRODUCTS)) {
      if (!p.isPackagePurchase) continue;
      // The real rule is seriesType, not classification name — the 4→8 upgrade
      // lands a client on the 8-session series, so it unlocks Living Practice.
      expect(p.livingPractice).toBe(p.seriesType === '8-session');
    }
  });

  it('upgrades add 3 or 7 (not 4 or 8) — assumes initial already counted as +1', () => {
    const fourUpgrade = Object.values(GHL_PRODUCTS).find((p) => p.classification === '4-upgrade');
    const eightUpgrade = Object.values(GHL_PRODUCTS).find((p) => p.classification === '8-upgrade');
    expect(fourUpgrade.sessionsRemaining).toBe(3);
    expect(eightUpgrade.sessionsRemaining).toBe(7);
  });

  it('entrainment and living practice contribute 0 sessions', () => {
    const entrainment = Object.values(GHL_PRODUCTS).find((p) => p.classification === 'entrainment');
    const livingPractice = Object.values(GHL_PRODUCTS).find((p) => p.classification === 'living-practice');
    expect(entrainment.sessions).toBe(0);
    expect(livingPractice.sessions).toBe(0);
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
    expect(Object.keys(WEBHOOK_PURCHASE_MAP).length).toBe(5);
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
