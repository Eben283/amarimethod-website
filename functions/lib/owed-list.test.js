import { describe, it, expect } from 'vitest';
import { clientNameFromTitle, sortOwedRows } from './owed-list.js';

describe('clientNameFromTitle', () => {
  it('pulls the name after a trailing dash', () => {
    expect(clientNameFromTitle(' Amari Method Follow-up Session — In Person- Danny Blumrich')).toBe('Danny Blumrich');
    expect(clientNameFromTitle('Amari Method Partner Initial Session- Shannon Morse')).toBe('Shannon Morse');
  });
  it('pulls the name after "with"', () => {
    expect(clientNameFromTitle('Amari Method follow up session with Danny Blumrich')).toBe('Danny Blumrich');
  });
  it('returns a bare name unchanged', () => {
    expect(clientNameFromTitle('Danny Blumrich')).toBe('Danny Blumrich');
  });
  it('handles entrainment-style titles by stripping boilerplate', () => {
    expect(clientNameFromTitle(' Amari Method - Entrainment session Justin Grinius')).toBe('Justin Grinius');
  });
  it('returns null for empty/boilerplate-only', () => {
    expect(clientNameFromTitle('')).toBeNull();
    expect(clientNameFromTitle(null)).toBeNull();
  });
});

describe('sortOwedRows', () => {
  it('orders owed-high → owed-medium → unavailable → paid-legacy → square', () => {
    const rows = [
      { name: 'Sq', status: 'square' },
      { name: 'Legacy', status: 'paid-legacy' },
      { name: 'OwedMed', status: 'owed', confidence: 'medium', shortBy: 1 },
      { name: 'OwedHigh2', status: 'owed', confidence: 'high', shortBy: 1 },
      { name: 'OwedHigh1', status: 'owed', confidence: 'high', shortBy: 3 },
      { name: 'Err', status: 'unavailable' },
    ];
    const out = sortOwedRows(rows).map((r) => r.name);
    expect(out).toEqual(['OwedHigh1', 'OwedHigh2', 'OwedMed', 'Err', 'Legacy', 'Sq']);
  });
  it('does not mutate the input', () => {
    const rows = [{ name: 'B', status: 'square' }, { name: 'A', status: 'owed', confidence: 'high', shortBy: 1 }];
    const copy = [...rows];
    sortOwedRows(rows);
    expect(rows).toEqual(copy);
  });
});
