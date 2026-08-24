import { describe, expect, it } from 'vitest';
import { describeMorningWorkflowNode } from './morningWorkflowInspection';

describe('Morning SMS node inspection', () => {
  it('expands the executable agenda token into its exact dynamic message contract', () => {
    const inspection = describeMorningWorkflowNode({
      agendaCopy: {
        unavailable: "Good morning, time to prepare for the day. Today's appointment list could not be loaded.",
        empty: 'Good morning — no appointments today.',
        header: "Today's appointments:",
        appointmentLine: '{{time}} — {{label}}',
        footer: 'Time to prepare for the day.',
      },
    }, {
      messageKind: 'prepare',
      copy: '{{agenda}}',
      logic: [
        'Send the completed agenda separately to Eben and Garrett.',
        'Skip a recipient when date + prepare + recipient was already recorded.',
      ],
    });

    expect(inspection).toEqual({
      heading: 'Exact dynamic SMS sent to Eben and Garrett',
      logic: [
        'Send the completed agenda separately to Eben and Garrett.',
        'Skip a recipient when date + prepare + recipient was already recorded.',
      ],
      exactCopy: "Today's appointments:\n{{time}} — {{label}}\n\nTime to prepare for the day.",
      variants: [
        { label: 'No appointments', copy: 'Good morning — no appointments today.' },
        { label: 'Appointment feed unavailable', copy: "Good morning, time to prepare for the day. Today's appointment list could not be loaded." },
      ],
    });
  });
});
