import { describe, expect, it } from 'vitest';
import { FIELD_STUDIES, FIELD_STUDY_TABLE_TAG, flattenSlots, isCompleteBaseline, isValidEmail, isValidPaperDate, isValidPhone, studyAppointments } from './staff-field-study.js';

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

  it('only returns active appointments from the dedicated study calendar', () => {
    expect(studyAppointments([
      { id: 'follow-up-2', calendarId: 'J1N09B6bRYPOGNyVAfmX', startTime: '2026-07-30T18:00:00Z', appointmentStatus: 'confirmed' },
      { id: 'cancelled', calendarId: 'J1N09B6bRYPOGNyVAfmX', startTime: '2026-07-22T18:00:00Z', appointmentStatus: 'cancelled' },
      { id: 'other-calendar', calendarId: 'other', startTime: '2026-07-21T18:00:00Z', appointmentStatus: 'confirmed' },
      { id: 'follow-up-1', calendarId: 'J1N09B6bRYPOGNyVAfmX', startTime: '2026-07-24T18:00:00Z', appointmentStatus: 'confirmed' },
    ])).toEqual([
      { id: 'follow-up-1', startTime: '2026-07-24T18:00:00Z', status: 'confirmed' },
      { id: 'follow-up-2', startTime: '2026-07-30T18:00:00Z', status: 'confirmed' },
    ]);
  });

  it('flattens a month of GHL free slots for the native calendar', () => {
    expect(flattenSlots({
      '2026-08-12': { slots: ['2026-08-12T14:30:00-07:00', '2026-08-12T09:00:00-07:00'] },
    })).toEqual([
      { date: '2026-08-12', hour: 9, minute: 0, datetime: '2026-08-12T09:00:00-07:00' },
      { date: '2026-08-12', hour: 14, minute: 30, datetime: '2026-08-12T14:30:00-07:00' },
    ]);
  });
});
