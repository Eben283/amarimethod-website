import { describe, expect, it } from 'vitest';
import { FIELD_STUDIES, FIELD_STUDY_TABLE_TAG, isCompleteBaseline, isValidEmail, isValidPaperDate, isValidPhone } from './staff-field-study.js';

describe('field-study contact validation', () => {
  it('accepts normal field-table contact details', () => {
    expect(isValidPhone('(415) 555-0134')).toBe(true);
    expect(isValidEmail('zya@example.com')).toBe(true);
  });

  it('rejects incomplete details', () => {
    expect(isValidPhone('415-55')).toBe(false);
    expect(isValidEmail('zya@')).toBe(false);
  });

  it('requires a real paper date and a complete transcribed baseline', () => {
    expect(isValidPaperDate('2026-07-21')).toBe(true);
    expect(isValidPaperDate('July 21')).toBe(false);
    expect(isCompleteBaseline({ discomfortNow: 2, worstPastSevenDays: 6, easierActivity: 'Typing', activityDifficulty: 4, dayLimit: 3, activityAvoidance: 1, bodyLocations: ['Shoulder'] })).toBe(true);
    expect(isCompleteBaseline({ discomfortNow: null, worstPastSevenDays: null, easierActivity: '', activityDifficulty: null, dayLimit: null, activityAvoidance: null, bodyLocations: [] })).toBe(false);
  });

  it('uses exactly the five public field-signup study choices', () => {
    expect(Object.keys(FIELD_STUDIES)).toEqual(['jaw', 'foot', 'elbow', 'hand', 'upper-back']);
  });

  it('uses one non-flyer tag for every table participant', () => {
    expect(FIELD_STUDY_TABLE_TAG).toBe('field-study-table-participant');
    expect(Object.values(FIELD_STUDIES).every((study) => !('tableTag' in study))).toBe(true);
  });
});
