import { describe, it, expect } from 'vitest';
import { wantsPublishOptIn, STUDY_PUBLISH_OPT_IN_TAG } from './study-consent.js';

describe('wantsPublishOptIn', () => {
  it('accepts only explicit true', () => {
    expect(wantsPublishOptIn(true)).toBe(true);
    expect(wantsPublishOptIn(false)).toBe(false);
    expect(wantsPublishOptIn('true')).toBe(false);
    expect(wantsPublishOptIn(undefined)).toBe(false);
  });
});

describe('STUDY_PUBLISH_OPT_IN_TAG', () => {
  it('is the stable GHL tag', () => {
    expect(STUDY_PUBLISH_OPT_IN_TAG).toBe('study-publish-opt-in');
  });
});
