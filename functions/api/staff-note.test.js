import { describe, expect, it } from 'vitest';
import { buildNoteUpdatePath, editableExistingNote, validateNoteUpdate } from './staff-note.js';

describe('staff note editing', () => {
  it('targets the exact note on the exact contact', () => {
    expect(buildNoteUpdatePath('contact_1', 'note_2'))
      .toBe('https://services.leadconnectorhq.com/contacts/contact_1/notes/note_2');
  });

  it('requires an existing note ID and a non-empty replacement body', () => {
    expect(validateNoteUpdate({ contactId: 'contact_1', noteId: '', body: 'Updated' }))
      .toEqual({ error: 'Note ID required' });
    expect(validateNoteUpdate({ contactId: 'contact_1', noteId: 'note_2', body: '   ' }))
      .toEqual({ error: 'Note body required' });
  });

  it('keeps the existing 5,000-character limit', () => {
    expect(validateNoteUpdate({ contactId: 'contact_1', noteId: 'note_2', body: 'x'.repeat(5001) }))
      .toEqual({ error: 'Note too long (max 5000 chars)' });
  });

  it('allows only ordinary Staff notes through the edit boundary', () => {
    expect(editableExistingNote({ note: { body: 'Adjust session two plan.' } })).toBe(true);
    expect(editableExistingNote({ note: { body: 'Outcome: referral sent' } })).toBe(false);
    expect(editableExistingNote({ note: { body: 'Signature:<img src="data:image/png;base64,AA==">' } })).toBe(false);
  });
});
