import { describe, expect, it } from 'vitest';
import { isSystemNote, plainTextNoteBody } from './staff-note-policy.js';

describe('Staff note display policy', () => {
  it('suppresses HTML-wrapped manual-enrollment test notes', () => {
    const body = '<p style="padding-left: 0px!important;">TEST manual-enrollment appointment context</p>';
    expect(plainTextNoteBody(body)).toBe('TEST manual-enrollment appointment context');
    expect(isSystemNote(body)).toBe(true);
  });

  it('keeps ordinary human notes and converts their markup to readable text', () => {
    const body = '<p>Left shoulder felt easier &amp; steadier.</p>';
    expect(isSystemNote(body)).toBe(false);
    expect(plainTextNoteBody(body)).toBe('Left shoulder felt easier & steadier.');
  });
});
