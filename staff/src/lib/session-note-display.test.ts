import { describe, expect, it } from 'vitest';
import { buildSessionBrief } from '../components/SessionBrief';
import { generateChecklist } from '../data/generateChecklist';
import type { ContactDetail } from '../types/staff';

function clientWithNotes(notes: Array<{ body: string }>): ContactDetail {
  return {
    id: 'contact_test',
    firstName: 'Test',
    lastName: 'Member',
    tags: [],
    appointments: [{
      id: 'appointment_1',
      title: 'Amari Method Session',
      startTime: '2026-09-01T17:00:00.000Z',
      status: 'completed',
    }],
    notes: notes.map((note, index) => ({
      id: `note_${index + 1}`,
      body: note.body,
      dateAdded: `2026-09-0${index + 1}T17:00:00.000Z`,
    })),
    quizResults: null,
    seriesType: 'none',
    sessionsRemaining: 0,
  } as ContactDetail;
}

describe('session note display', () => {
  const systemNote = '<p style="padding-left: 0px!important;">TEST manual-enrollment appointment context</p>';
  const usefulNote = '<p>Left shoulder felt easier &amp; steadier.</p>';

  it('uses the latest meaningful note in the session brief', () => {
    const brief = buildSessionBrief(clientWithNotes([{ body: systemNote }, { body: usefulNote }]));
    expect(brief).toContain('Last note: "Left shoulder felt easier & steadier."');
    expect(brief).not.toContain('manual-enrollment');
    expect(brief).not.toContain('<p');
  });

  it('keeps system test notes out of generated checklist prompts', () => {
    const checklist = generateChecklist(clientWithNotes([{ body: systemNote }, { body: usefulNote }]));
    const rendered = JSON.stringify(checklist);
    expect(rendered).toContain('Left shoulder felt easier & steadier.');
    expect(rendered).not.toContain('manual-enrollment');
    expect(rendered).not.toContain('<p');
  });
});
