import { describe, it, expect } from 'vitest';
import { selectPackageProduct } from './reconcile.js';

// Real productIds (kept in sync with PACKAGE_PRODUCTS in reconcile.js).
const PID = {
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  followupInPerson: '69aee204e80b62d627d8e922', // a single session — NOT a package
  initialInPerson: '688a1cd770362828afbf08a2', // NOT a package
};

const lineItem = (productId, name = 'Item') => ({ name, product: { _id: productId } });

describe('selectPackageProduct', () => {
  it('finds the package when it is the first (and only) line item', () => {
    const r = selectPackageProduct([lineItem(PID.eightSeries, '8-Session Series')]);
    expect(r).not.toBe(null);
    expect(r.productId).toBe(PID.eightSeries);
    expect(r.pkg.name).toBe('8-Session Series');
  });

  // REGRESSION: reconcile.js used to read only items[0]. A multi-item order with
  // the package at a later index was silently dropped (status "skip-not-package"),
  // locking a paying client out with no alert. See codebase-audit-scorecard.md risk #2.
  it('finds the package when it is NOT the first line item (items[0] regression)', () => {
    const r = selectPackageProduct([
      lineItem(PID.followupInPerson, 'Add-on follow-up'),
      lineItem(PID.fourSeries, '4-Session Series'),
    ]);
    expect(r).not.toBe(null);
    expect(r.productId).toBe(PID.fourSeries);
    expect(r.pkg.name).toBe('4-Session Series');
  });

  it('returns null when no line item is a package product', () => {
    expect(
      selectPackageProduct([lineItem(PID.followupInPerson), lineItem(PID.initialInPerson)]),
    ).toBe(null);
  });

  it('returns null for empty / missing item lists', () => {
    expect(selectPackageProduct([])).toBe(null);
    expect(selectPackageProduct(null)).toBe(null);
    expect(selectPackageProduct(undefined)).toBe(null);
  });
});
