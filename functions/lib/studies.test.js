import { describe, it, expect } from 'vitest';
import {
  STUDY_APPOINTMENT_BASE_TITLE,
  STUDY_NAME_FIELD_ID,
  studyAppointmentTitle,
  studyNameFromContact,
} from './studies.js';

describe('studyAppointmentTitle', () => {
  it('appends the study name for calendar view', () => {
    expect(studyAppointmentTitle('Elbow Pain Study')).toBe(
      'Amari Study 15-Minute Session - Elbow Pain Study',
    );
  });

  it('keeps the ledger-safe base title when study name is missing', () => {
    expect(studyAppointmentTitle('')).toBe(STUDY_APPOINTMENT_BASE_TITLE);
    expect(studyAppointmentTitle(null)).toBe(STUDY_APPOINTMENT_BASE_TITLE);
    expect(studyAppointmentTitle(undefined)).toBe(STUDY_APPOINTMENT_BASE_TITLE);
    expect(studyAppointmentTitle('   ')).toBe(STUDY_APPOINTMENT_BASE_TITLE);
  });

  it('always retains 15-Minute so free sessions stay out of the paid ledger', () => {
    expect(studyAppointmentTitle('Jaw Tension Study')).toMatch(/15-Minute/i);
  });
});

describe('studyNameFromContact', () => {
  it('reads Study Name by field id or key', () => {
    expect(
      studyNameFromContact({
        customFields: [{ id: STUDY_NAME_FIELD_ID, value: 'Elbow Pain Study' }],
      }),
    ).toBe('Elbow Pain Study');
    expect(
      studyNameFromContact({
        customFields: [{ key: 'contact.study_name', value: 'Jaw Tension Study' }],
      }),
    ).toBe('Jaw Tension Study');
  });

  it('returns empty string when unset', () => {
    expect(studyNameFromContact({})).toBe('');
    expect(studyNameFromContact(null)).toBe('');
  });
});
