import { describe, it, expect } from 'vitest';
import { selectPackageProduct, isReconcileAlreadyApplied, remainingWasWritten } from './reconcile.js';

// Real productIds (kept in sync with PACKAGE_PRODUCTS in reconcile.js).
const PID = {
  fourSeries: '69986faa724ecd2343ebaa6e',
  eightSeries: '69987357c839790426996114',
  twelveWeek: '6a66cde7ef7b07f122ad46fb',
  twelveWeekPrice: '6a66cde7ef7b076d15ad4700',
  sixWeek: '6a683360017263178d05d1a3',
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
  it('resolves the 12-week practice from its nested current price id', () => {
    const r = selectPackageProduct([{ price: { _id: PID.twelveWeekPrice } }]);
    expect(r).not.toBe(null);
    expect(r.productId).toBe(PID.twelveWeek);
    expect(r.pkg).toMatchObject({ sessionsToSet: 24, seriesType: '12-week', livingPractice: true });
  });
  it('resolves the 12-session Practice while retaining the valid GHL 6-week value', () => {
    const r = selectPackageProduct([lineItem(PID.sixWeek, 'The 6-Week Amari Practice')]);
    expect(r.pkg).toMatchObject({ sessionsToSet: 12, seriesType: '6-week', canonicalSeriesType: '12-session', sessionCount: 12, livingPractice: true });
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

describe('remainingWasWritten', () => {
  it('false for never-written field (null/undefined/empty)', () => {
    expect(remainingWasWritten(null)).toBe(false);
    expect(remainingWasWritten(undefined)).toBe(false);
    expect(remainingWasWritten('')).toBe(false);
    expect(remainingWasWritten('   ')).toBe(false);
  });
  it('true for a written value — INCLUDING a drawn-down "0"', () => {
    expect(remainingWasWritten('0')).toBe(true);
    expect(remainingWasWritten(0)).toBe(true);
    expect(remainingWasWritten('3')).toBe(true);
    expect(remainingWasWritten(8)).toBe(true);
  });
});

describe('isReconcileAlreadyApplied (#3 — partial-failure detection, over-credit-safe)', () => {
  const eightPack = { seriesType: '8-session', livingPractice: true };
  const fourPack = { seriesType: '4-session', livingPractice: false };
  const base = { currentSeriesType: '8-session', currentPortal: true, currentLP: true, currentRemaining: '8', pkg: eightPack };

  it('already-applied when series + portal + LP + remaining are all set', () => {
    expect(isReconcileAlreadyApplied(base)).toBe(true);
  });

  // THE #3 BUG: series/portal/LP set but sessions_remaining never written →
  // pre-fix this was skipped forever, stranding a paid client at 0.
  it('NOT already-applied when sessions_remaining was never written (the bug)', () => {
    expect(isReconcileAlreadyApplied({ ...base, currentRemaining: null })).toBe(false);
    expect(isReconcileAlreadyApplied({ ...base, currentRemaining: '' })).toBe(false);
  });

  // THE OVER-CREDIT GUARD: a drawn-down "0" is a written value → still
  // already-applied, so reconcile never resets a mid-package balance to full.
  it('already-applied when remaining is a drawn-down "0" or mid-pack number (no reset)', () => {
    expect(isReconcileAlreadyApplied({ ...base, currentRemaining: '0' })).toBe(true);
    expect(isReconcileAlreadyApplied({ ...base, currentRemaining: '3' })).toBe(true);
  });

  it('NOT already-applied when series_type does not match', () => {
    expect(isReconcileAlreadyApplied({ ...base, currentSeriesType: 'none' })).toBe(false);
  });

  it('NOT already-applied when portal_access is missing', () => {
    expect(isReconcileAlreadyApplied({ ...base, currentPortal: false })).toBe(false);
  });

  it('NOT already-applied when an 8-pack needs LP but LP is unset', () => {
    expect(isReconcileAlreadyApplied({ ...base, currentLP: false })).toBe(false);
  });

  it('LP check is skipped for a 4-pack (livingPractice:false)', () => {
    expect(isReconcileAlreadyApplied({ currentSeriesType: '4-session', currentPortal: true, currentLP: false, currentRemaining: '4', pkg: fourPack })).toBe(true);
  });

  // seriesIsAdvanced escape hatch: a 4-pack order on a contact already upgraded
  // to 8-session is "applied" regardless of remaining (a later upgrade overwrote it).
  it('already-applied via seriesIsAdvanced (4-pack order, contact on 8-session) even with remaining unwritten', () => {
    expect(isReconcileAlreadyApplied({ currentSeriesType: '8-session', currentPortal: false, currentLP: false, currentRemaining: null, pkg: fourPack })).toBe(true);
  });
  it('does not let a delayed 6-week purchase overwrite a later 12-week Practice', () => {
    const sixWeek = { seriesType: '6-week', livingPractice: true };
    expect(isReconcileAlreadyApplied({ currentSeriesType: '12-week', currentPortal: false, currentLP: false, currentRemaining: null, pkg: sixWeek })).toBe(true);
  });
});
