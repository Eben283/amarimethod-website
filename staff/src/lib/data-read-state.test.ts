import { describe, expect, it } from 'vitest';
import { resolveDataReadState } from './data-read-state';

describe('Staff data read state', () => {
  it('never turns a failed read into a verified empty result', () => {
    expect(resolveDataReadState({ loading: true, error: null, hasData: false })).toBe('loading');
    expect(resolveDataReadState({ loading: false, error: 'timed out', hasData: false })).toBe('unavailable');
    expect(resolveDataReadState({ loading: false, error: 'timed out', hasData: true })).toBe('partial');
    expect(resolveDataReadState({ loading: false, error: null, hasData: false })).toBe('ready');
  });
});
