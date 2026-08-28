export type TrainingSection = 'amari' | 'sharpen' | 'playbooks' | 'reference';
export type TrainingPlaybook = 'discovery' | 'partner' | 'therapist' | 'positioning';

const TRAINING_SECTIONS = new Set<TrainingSection>(['amari', 'sharpen', 'playbooks', 'reference']);
const TRAINING_PLAYBOOKS = new Set<TrainingPlaybook>(['discovery', 'partner', 'therapist', 'positioning']);

export function trainingSectionFromSearch(search: string): TrainingSection {
  const section = new URLSearchParams(search).get('section');
  return TRAINING_SECTIONS.has(section as TrainingSection) ? section as TrainingSection : 'sharpen';
}

export function trainingPlaybookFromSearch(search: string): TrainingPlaybook {
  const playbook = new URLSearchParams(search).get('playbook');
  return TRAINING_PLAYBOOKS.has(playbook as TrainingPlaybook) ? playbook as TrainingPlaybook : 'discovery';
}

export function trainingPath(section: TrainingSection, playbook?: TrainingPlaybook) {
  const query = new URLSearchParams({ section });
  if (section === 'playbooks' && playbook) query.set('playbook', playbook);
  return `/training?${query.toString()}`;
}
