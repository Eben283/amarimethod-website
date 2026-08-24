type AgendaCopy = {
  unavailable: string;
  empty: string;
  header: string;
  appointmentLine: string;
  footer: string;
};

type MorningDefinition = {
  agendaCopy?: AgendaCopy;
};

type MorningStep = {
  messageKind?: 'prepare' | 'meeting';
  copy?: string;
  logic?: string[];
};

export type MorningNodeInspection = {
  heading: string;
  logic: string[];
  exactCopy?: string;
  variants: Array<{ label: string; copy: string }>;
};

export function describeMorningWorkflowNode(
  definition: MorningDefinition,
  step: MorningStep,
): MorningNodeInspection {
  const logic = step.logic || [];
  if (step.messageKind === 'prepare' && definition.agendaCopy) {
    const copy = definition.agendaCopy;
    return {
      heading: 'Exact dynamic SMS sent to Eben and Garrett',
      logic,
      exactCopy: `${copy.header}\n${copy.appointmentLine}\n\n${copy.footer}`,
      variants: [
        { label: 'No appointments', copy: copy.empty },
        { label: 'Appointment feed unavailable', copy: copy.unavailable },
      ],
    };
  }
  return {
    heading: step.copy ? 'Exact executable copy' : 'Exact executable logic',
    logic,
    exactCopy: step.copy,
    variants: [],
  };
}
