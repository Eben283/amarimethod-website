// Frontend copy of the study registry + the validated questionnaires.
//
// Canonical backend registry: functions/lib/studies.js. Keep the study list here
// in sync by hand (the staff app is a separate Vite build root and can't import
// from functions/lib — same hand-synced-duplicate pattern the codebase already
// uses for journey-classification). Instrument item wording is transcribed
// verbatim from each instrument's official source; see the rigor-spine doc.

export interface BodyQuestion {
  key: string;
  label: string;
  options: string[];
}

export interface InstrumentItem {
  id: string;
  text: string;
}

export interface InstrumentSubscale {
  key: string;
  title: string;
  instruction: string;
  anchorLow: string;
  anchorHigh: string;
  items: InstrumentItem[];
}

export interface Instrument {
  abbr: string;
  name: string;
  attribution: string;
  recall: string; // e.g. "over the past week"
  subscales: InstrumentSubscale[];
  // Total-score spec. `functionHalved` follows the PRTEE convention where the
  // function items are summed then divided by 2 so pain and function weigh
  // equally out of 100. Higher = worse; 0 = no disability.
  scoring: { max: number; painKeys: string[]; functionKeys: string[]; functionHalved: boolean; note: string };
  ready: boolean; // false until the items below are verified & transcribed
}

export interface StudyConfig {
  key: string;
  tag: string;
  module: string;
  condition: string;
  shortName: string;
  bodyQuestion: BodyQuestion | null;
  /** Intake free-text label for how the condition affects their activity. */
  impactLabel: string;
  instrumentAbbr: string;
  status: 'live' | 'draft';
}

// ── Instruments ─────────────────────────────────────────────────────────────

// PRTEE — verbatim from the official User Manual (© Joy C. MacDermid, McMaster
// University, June 2010). Free for clinical/research use with attribution.
const PRTEE: Instrument = {
  abbr: 'PRTEE',
  name: 'Patient-Rated Tennis Elbow Evaluation',
  attribution: '© Joy C. MacDermid, McMaster University',
  recall: 'over the past week',
  subscales: [
    {
      key: 'pain',
      title: 'Pain',
      instruction: 'Rate the average amount of pain in your arm over the past week.',
      anchorLow: 'No pain',
      anchorHigh: 'Worst imaginable',
      items: [
        { id: 'p1', text: 'When you are at rest' },
        { id: 'p2', text: 'When doing a task with repeated arm movement' },
        { id: 'p3', text: 'When carrying a plastic bag of groceries' },
        { id: 'p4', text: 'When your pain was at its least' },
        { id: 'p5', text: 'When your pain was at its worst' },
      ],
    },
    {
      key: 'specific',
      title: 'Specific activities',
      instruction: 'Rate the amount of difficulty you experienced performing each task over the past week.',
      anchorLow: 'No difficulty',
      anchorHigh: 'Unable to do',
      items: [
        { id: 's1', text: 'Turn a doorknob or key' },
        { id: 's2', text: 'Carry a grocery bag or briefcase by the handle' },
        { id: 's3', text: 'Lift a full coffee cup or glass of milk to your mouth' },
        { id: 's4', text: 'Open a jar' },
        { id: 's5', text: 'Pull up pants' },
        { id: 's6', text: 'Wring out a washcloth or wet towel' },
      ],
    },
    {
      key: 'usual',
      title: 'Usual activities',
      instruction: 'Rate the difficulty performing your usual activities over the past week.',
      anchorLow: 'No difficulty',
      anchorHigh: 'Unable to do',
      items: [
        { id: 'u1', text: 'Personal activities (dressing, washing)' },
        { id: 'u2', text: 'Household work (cleaning, maintenance)' },
        { id: 'u3', text: 'Work (your job or everyday work)' },
        { id: 'u4', text: 'Recreational or sporting activities' },
      ],
    },
  ],
  scoring: {
    max: 100,
    painKeys: ['pain'],
    functionKeys: ['specific', 'usual'],
    functionHalved: true,
    note: 'Pain = sum of 5 pain items (/50). Function = sum of 10 items ÷ 2 (/50). Total /100, higher = worse.',
  },
  ready: true,
};

// Placeholder instruments for studies not yet launched. Items get transcribed
// from each official source before that study recruits. Until `ready` is true,
// the panel captures pain + intake and shows the questionnaire as pending.
function pending(abbr: string, name: string, recall: string): Instrument {
  return {
    abbr, name, attribution: 'verify license before use', recall,
    subscales: [],
    scoring: { max: 100, painKeys: [], functionKeys: [], functionHalved: false, note: 'items pending verification' },
    ready: false,
  };
}

export const INSTRUMENTS: Record<string, Instrument> = {
  PRTEE,
  BCTQ: pending('BCTQ', 'Boston Carpal Tunnel Questionnaire', 'over the past 2 weeks'),
  'JFLS-8': pending('JFLS-8', 'Jaw Functional Limitation Scale (8-item)', 'over the past month'),
  FAAM: pending('FAAM', 'Foot & Ankle Ability Measure (ADL)', 'over the past week'),
  QuickDASH: pending('QuickDASH', 'QuickDASH', 'over the past week'),
  NDI: pending('NDI', 'Neck Disability Index', 'today'),
  SPADI: pending('SPADI', 'Shoulder Pain & Disability Index', 'over the past week'),
  ODI: pending('ODI', 'Oswestry Disability Index', 'today'),
  SBI: pending('SBI', 'Sciatica Bothersomeness Index', 'over the past week'),
};

// ── Studies (mirror of functions/lib/studies.js) ────────────────────────────

const ARM = { key: 'arm', label: 'Which arm?', options: ['Left', 'Right', 'Both'] };
const HAND = { key: 'hand', label: 'Which hand?', options: ['Left', 'Right', 'Both'] };
const SIDE = { key: 'side', label: 'Which side?', options: ['Left', 'Right', 'Both'] };
const LEG = { key: 'leg', label: 'Which leg?', options: ['Left', 'Right', 'Both'] };
const SHOULDER = { key: 'shoulder', label: 'Which shoulder?', options: ['Left', 'Right', 'Both'] };

export const STUDIES: Record<string, StudyConfig> = {
  'elbow-study-participant': { key: 'tennis-elbow', tag: 'elbow-study-participant', module: 'elbow-reset', condition: 'tennis elbow', shortName: 'Elbow Pain Study', bodyQuestion: ARM, impactLabel: 'How it affects their game', instrumentAbbr: 'PRTEE', status: 'live' },
  'carpal-study-participant': { key: 'carpal-tunnel', tag: 'carpal-study-participant', module: 'hand-balancer', condition: 'carpal tunnel', shortName: 'Carpal Tunnel Study', bodyQuestion: HAND, impactLabel: 'How it affects typing or gripping', instrumentAbbr: 'BCTQ', status: 'draft' },
  'tmj-study-participant': { key: 'tmj', tag: 'tmj-study-participant', module: 'jaw-align', condition: 'TMJ / jaw pain', shortName: 'Jaw Tension Study', bodyQuestion: SIDE, impactLabel: 'How it affects eating, talking, or sleep', instrumentAbbr: 'JFLS-8', status: 'live' },
  'hand-study-participant': { key: 'hand', tag: 'hand-study-participant', module: 'hand-balancer', condition: 'hand / finger tendon pain', shortName: 'Hand Pain Study', bodyQuestion: HAND, impactLabel: 'How it affects climbing or gripping', instrumentAbbr: 'QuickDASH', status: 'live' },
  'lowerleg-study-participant': { key: 'runners-lower-leg', tag: 'lowerleg-study-participant', module: 'spring-step', condition: 'plantar fasciitis / heel & foot pain', shortName: 'Foot Pain Study', bodyQuestion: LEG, impactLabel: 'How it affects running or being on their feet', instrumentAbbr: 'FAAM', status: 'live' },
  'neck-study-participant': { key: 'tech-neck', tag: 'neck-study-participant', module: 'spinal-wave', condition: 'neck & upper-back pain', shortName: 'Tech Neck Study', bodyQuestion: null, impactLabel: 'How it affects desk work or looking down', instrumentAbbr: 'NDI', status: 'draft' },
  'shoulder-study-participant': { key: 'desk-shoulders', tag: 'shoulder-study-participant', module: 'power-posture', condition: 'shoulder pain', shortName: 'Desk Shoulders Study', bodyQuestion: SHOULDER, impactLabel: 'How it affects reaching or desk work', instrumentAbbr: 'SPADI', status: 'draft' },
  'lowback-study-participant': { key: 'lower-back', tag: 'lowback-study-participant', module: 'vertical-drop', condition: 'lower-back pain', shortName: 'Lower Back Study', bodyQuestion: null, impactLabel: 'How it affects sitting or standing', instrumentAbbr: 'ODI', status: 'draft' },
  'sciatica-study-participant': { key: 'sciatica', tag: 'sciatica-study-participant', module: 'suspension-squat', condition: 'sciatica', shortName: 'Sciatica Study', bodyQuestion: LEG, impactLabel: 'How it affects walking or sitting', instrumentAbbr: 'SBI', status: 'draft' },
};

// Find which study (if any) a contact's tags put them in.
export function studyFromTags(tags: string[]): StudyConfig | null {
  for (const t of tags) {
    if (STUDIES[t]) return STUDIES[t];
  }
  return null;
}

export function instrumentFor(study: StudyConfig): Instrument {
  return INSTRUMENTS[study.instrumentAbbr];
}

// Total score from a responses map {itemId: 0-10|null}. Returns null unless
// every item is answered (missing-data handling is a reporting concern, not a
// live-capture one). Higher = worse.
export function scoreInstrument(inst: Instrument, responses: Record<string, number | null>): number | null {
  if (!inst.ready) return null;
  const sub = (keys: string[]) => {
    let sum = 0;
    for (const s of inst.subscales.filter((x) => keys.includes(x.key))) {
      for (const it of s.items) {
        const v = responses[it.id];
        if (v === null || v === undefined) return null;
        sum += v;
      }
    }
    return sum;
  };
  const pain = sub(inst.scoring.painKeys);
  const fn = sub(inst.scoring.functionKeys);
  if (pain === null || fn === null) return null;
  return pain + (inst.scoring.functionHalved ? fn / 2 : fn);
}
