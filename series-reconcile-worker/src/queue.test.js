import { describe, it, expect } from 'vitest';
import { nextChunk, isQueueStale, remainderAfterProcessing } from './queue.js';

describe('nextChunk', () => {
  it('slices the first N and returns the rest', () => {
    expect(nextChunk([1, 2, 3, 4, 5], 2)).toEqual({ chunk: [1, 2], remaining: [3, 4, 5] });
  });
  it('handles a queue shorter than the chunk', () => {
    expect(nextChunk([1], 5)).toEqual({ chunk: [1], remaining: [] });
  });
  it('handles empty / non-array input', () => {
    expect(nextChunk([], 3)).toEqual({ chunk: [], remaining: [] });
    expect(nextChunk(null, 3)).toEqual({ chunk: [], remaining: [] });
  });
});

describe('isQueueStale', () => {
  const TTL = 22 * 3600 * 1000;
  it('fresh, non-empty, within ttl → not stale', () => {
    expect(isQueueStale([1], 1000, 1000 + TTL - 1, TTL)).toBe(false);
  });
  it('exactly ttl old → stale (time to rebuild)', () => {
    expect(isQueueStale([1], 1000, 1000 + TTL, TTL)).toBe(true);
  });
  it('empty or missing queue → stale', () => {
    expect(isQueueStale([], 1000, 1000, TTL)).toBe(true);
    expect(isQueueStale(null, 1000, 1000, TTL)).toBe(true);
  });
  it('no generation timestamp → stale', () => {
    expect(isQueueStale([1], null, 1000, TTL)).toBe(true);
  });
});

describe('remainderAfterProcessing', () => {
  it('keeps the unprocessed tail of the chunk + the rest', () => {
    // chunk [a,b,c], processed a+b → leftover c, then the rest [d,e]
    expect(remainderAfterProcessing(['a', 'b', 'c'], 2, ['d', 'e'])).toEqual(['c', 'd', 'e']);
  });
  it('all of the chunk processed → just the rest', () => {
    expect(remainderAfterProcessing(['a', 'b'], 2, ['c'])).toEqual(['c']);
  });
  it('nothing processed (immediate abort) → whole chunk re-queued ahead of the rest', () => {
    expect(remainderAfterProcessing(['a', 'b'], 0, ['c'])).toEqual(['a', 'b', 'c']);
  });
});
