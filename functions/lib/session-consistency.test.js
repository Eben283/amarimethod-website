import { describe, it, expect } from 'vitest';
import { checkPackageBalance } from './session-consistency.js';

describe('checkPackageBalance — package invariant (not lifetime)', () => {
  it('valid: full 8-pack, none attended (8/0/8) is ok', () => {
    expect(checkPackageBalance({ remaining: 8, attended: 0, packageSize: 8 }))
      .toEqual({ ok: true });
  });

  it('valid: mid-pack (3 remaining, 5 attended, size 8) is ok', () => {
    expect(checkPackageBalance({ remaining: 3, attended: 5, packageSize: 8 }))
      .toEqual({ ok: true });
  });

  it('violation: remaining exceeds packageSize (9/0/8)', () => {
    const result = checkPackageBalance({ remaining: 9, attended: 0, packageSize: 8 });
    expect(result.ok).toBe(false);
    expect(result.violation).toMatch(/exceeds packageSize/);
  });

  it('violation: attended + remaining exceeds packageSize (5 attended + 5 remaining, size 8)', () => {
    const result = checkPackageBalance({ remaining: 5, attended: 5, packageSize: 8 });
    expect(result.ok).toBe(false);
    expect(result.violation).toMatch(/attended 5 \+ remaining 5 exceeds packageSize 8/);
  });

  it('violation: negative remaining (-1/0/8)', () => {
    const result = checkPackageBalance({ remaining: -1, attended: 0, packageSize: 8 });
    expect(result.ok).toBe(false);
    expect(result.violation).toMatch(/negative/);
  });

  it('attended null → only bounds checked, in-range value passes', () => {
    expect(checkPackageBalance({ remaining: 8, attended: null, packageSize: 8 }))
      .toEqual({ ok: true });
  });

  it('attended null → bounds still catch remaining over packageSize', () => {
    const result = checkPackageBalance({ remaining: 9, attended: null, packageSize: 8 });
    expect(result.ok).toBe(false);
    expect(result.violation).toMatch(/exceeds packageSize/);
  });

  it('rejects a non-positive packageSize (cannot validate against it)', () => {
    expect(checkPackageBalance({ remaining: 0, packageSize: 0 }).ok).toBe(false);
    expect(checkPackageBalance({ remaining: 4, packageSize: null }).ok).toBe(false);
  });

  it('rejects a non-numeric remaining', () => {
    expect(checkPackageBalance({ remaining: 'x', packageSize: 8 }).ok).toBe(false);
  });
});
