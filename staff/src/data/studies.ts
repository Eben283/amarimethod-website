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

/** Sentinel stored in responses when the respondent marks N/A (FAAM). */
export const RESPONSE_NA = -1;

export type ScoringMethod = 'prtee' | 'mean' | 'percent';

export interface InstrumentScoring {
  method: ScoringMethod;
  /** Display / ceiling for the computed total (e.g. 100, 10). */
  max: number;
  /** Inclusive Likert bounds for each item. */
  minScale: number;
  maxScale: number;
  /** Minimum scored (non-NA) answers required before a total is shown. */
  minAnswered: number;
  /** Allow N/A responses (excluded from scoring). */
  allowNa: boolean;
  higherIsBetter: boolean;
  note: string;
  /** PRTEE only — subscale keys for pain vs function. */
  painKeys?: string[];
  functionKeys?: string[];
  functionHalved?: boolean;
}

export interface Instrument {
  abbr: string;
  name: string;
  attribution: string;
  recall: string; // e.g. "over the past week"
  subscales: InstrumentSubscale[];
  scoring: InstrumentScoring;
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
    method: 'prtee',
    max: 100,
    minScale: 0,
    maxScale: 10,
    minAnswered: 15,
    allowNa: false,
    higherIsBetter: false,
    painKeys: ['pain'],
    functionKeys: ['specific', 'usual'],
    functionHalved: true,
    note: 'Pain = sum of 5 pain items (/50). Function = sum of 10 items ÷ 2 (/50). Total /100, higher = worse.',
  },
  ready: true,
};

// JFLS-8 — Ohrbach R., version 12 May 2013. Official form: "No permission
// required to reproduce, translate, display, or distribute." Available at
// rdc-tmdinternational.org. Score = mean of answered items (≤2 missing).
const JFLS8: Instrument = {
  abbr: 'JFLS-8',
  name: 'Jaw Functional Limitation Scale (8-item)',
  attribution: '© Richard Ohrbach. Available at rdc-tmdinternational.org. No permission required.',
  recall: 'during the last month',
  subscales: [
    {
      key: 'limitation',
      title: 'Jaw function',
      instruction:
        'Indicate the level of limitation during the last month. If the activity has been completely avoided because it is too difficult, circle 10. If you avoid an activity for reasons other than pain or difficulty, leave the item blank.',
      anchorLow: 'No limitation',
      anchorHigh: 'Severe limitation',
      items: [
        { id: 'j1', text: 'Chew tough food' },
        { id: 'j2', text: 'Chew chicken (e.g., prepared in oven)' },
        {
          id: 'j3',
          text: 'Eat soft food requiring no chewing (e.g., mashed potatoes, apple sauce, pudding, pureed food)',
        },
        { id: 'j4', text: 'Open wide enough to drink from a cup' },
        { id: 'j5', text: 'Swallow' },
        { id: 'j6', text: 'Yawn' },
        { id: 'j7', text: 'Talk' },
        { id: 'j8', text: 'Smile' },
      ],
    },
  ],
  scoring: {
    method: 'mean',
    max: 10,
    minScale: 0,
    maxScale: 10,
    minAnswered: 6,
    allowNa: false,
    higherIsBetter: false,
    note: 'Mean of answered items (/10). Up to 2 items may be blank. Higher = greater limitation.',
  },
  ready: true,
};

// FAAM ADL — Martin et al. Free for clinical/research use. Response options
// 4 = no difficulty … 0 = unable; N/A excluded. Score = % of max possible
// among answered items; need ≥19 of 21. Higher = better function.
const FAAM: Instrument = {
  abbr: 'FAAM',
  name: 'Foot & Ankle Ability Measure (ADL)',
  attribution: 'Foot and Ankle Ability Measure (FAAM) — Martin et al. Free for clinical/research use.',
  recall: 'within the past week',
  subscales: [
    {
      key: 'adl',
      title: 'Activities of daily living',
      instruction:
        'Because of your foot and ankle, how much difficulty do you have with each of the items listed below? If limited by something other than your foot or ankle, mark N/A.',
      anchorLow: 'Unable to do',
      anchorHigh: 'No difficulty',
      items: [
        { id: 'f1', text: 'Standing' },
        { id: 'f2', text: 'Walking on even ground' },
        { id: 'f3', text: 'Walking on even ground without shoes' },
        { id: 'f4', text: 'Walking up hills' },
        { id: 'f5', text: 'Walking down hills' },
        { id: 'f6', text: 'Going up stairs' },
        { id: 'f7', text: 'Going down stairs' },
        { id: 'f8', text: 'Walking on uneven ground' },
        { id: 'f9', text: 'Stepping up and down curbs' },
        { id: 'f10', text: 'Squatting' },
        { id: 'f11', text: 'Coming up on your toes' },
        { id: 'f12', text: 'Walking initially' },
        { id: 'f13', text: 'Walking 5 minutes or less' },
        { id: 'f14', text: 'Walking approximately 10 minutes' },
        { id: 'f15', text: 'Walking 15 minutes or greater' },
        { id: 'f16', text: 'Home responsibilities' },
        { id: 'f17', text: 'Activities of daily living' },
        { id: 'f18', text: 'Personal care' },
        { id: 'f19', text: 'Light to moderate work (standing, walking)' },
        { id: 'f20', text: 'Heavy work (pushing/pulling, climbing, carrying)' },
        { id: 'f21', text: 'Recreational activities' },
      ],
    },
  ],
  scoring: {
    method: 'percent',
    max: 100,
    minScale: 0,
    maxScale: 4,
    minAnswered: 19,
    allowNa: true,
    higherIsBetter: true,
    note: 'ADL % = (sum of answered items) / (n × 4) × 100. Need ≥19 of 21 non-N/A. Higher = better function.',
  },
  ready: true,
};

// PRWHE — Patient-Rated Wrist/Hand Evaluation © Joy MacDermid 2009. Same
// family / license posture as PRTEE (free for clinical/research with
// attribution). Replaces QuickDASH after IWH quoted commercial software fees.
// Pain 5×0–10 (/50) + function 10×0–10 ÷ 2 (/50) = total /100; higher = worse.
const PRWHE: Instrument = {
  abbr: 'PRWHE',
  name: 'Patient-Rated Wrist/Hand Evaluation',
  attribution: '© Joy MacDermid 2009. Free for clinical/research use with attribution.',
  recall: 'over the past week',
  subscales: [
    {
      key: 'pain',
      title: 'Pain',
      instruction:
        'Rate the amount of pain in your wrist/hand. 0 = no pain, 10 = worst possible pain. For “how often,” 0 = never and 10 = always.',
      anchorLow: 'No pain / never',
      anchorHigh: 'Worst possible / always',
      items: [
        { id: 'p1', text: 'At rest' },
        { id: 'p2', text: 'Doing a task with a repeated wrist/hand movement' },
        { id: 'p3', text: 'Lifting a heavy object' },
        { id: 'p4', text: 'At its worst' },
        { id: 'p5', text: 'How often do you have pain?' },
      ],
    },
    {
      key: 'specific',
      title: 'Specific activities',
      instruction:
        'Rate how difficult it was doing the things listed below this week. 0 = not difficult, 10 = unable to do.',
      anchorLow: 'Not difficult',
      anchorHigh: 'Unable to do',
      items: [
        { id: 's1', text: 'Fasten buttons on your shirt' },
        { id: 's2', text: 'Cut meat (or vegetables) using a knife' },
        { id: 's3', text: 'Turn a door knob with your affected hand' },
        { id: 's4', text: 'Use your affected hand to push up from a chair' },
        { id: 's5', text: 'Carry a heavy object in your affected hand' },
        { id: 's6', text: 'Use bathroom tissue with your affected hand' },
      ],
    },
    {
      key: 'usual',
      title: 'Usual activities',
      instruction:
        'Rate how difficult it was doing your usual activities this week — what you did before you started having a problem with your wrist/hand.',
      anchorLow: 'Not difficult',
      anchorHigh: 'Unable to do',
      items: [
        { id: 'u1', text: 'Personal activities (like dressing/washing)' },
        { id: 'u2', text: 'Household work (like cleaning or maintenance)' },
        { id: 'u3', text: 'Work (your job or other work)' },
        { id: 'u4', text: 'Recreational activities' },
      ],
    },
  ],
  scoring: {
    method: 'prtee',
    max: 100,
    minScale: 0,
    maxScale: 10,
    minAnswered: 15,
    allowNa: false,
    higherIsBetter: false,
    painKeys: ['pain'],
    functionKeys: ['specific', 'usual'],
    functionHalved: true,
    note: 'Pain = sum of 5 items (/50). Function = sum of 10 items ÷ 2 (/50). Total /100, higher = worse.',
  },
  ready: true,
};

// Placeholder instruments for studies not yet launched. Items get transcribed
// from each official source before that study recruits. Until `ready` is true,
// the panel captures pain + intake and shows the questionnaire as pending.
function pending(abbr: string, name: string, recall: string): Instrument {
  return {
    abbr,
    name,
    attribution: 'verify license before use',
    recall,
    subscales: [],
    scoring: {
      method: 'mean',
      max: 100,
      minScale: 0,
      maxScale: 10,
      minAnswered: 1,
      allowNa: false,
      higherIsBetter: false,
      note: 'items pending verification',
    },
    ready: false,
  };
}

export const INSTRUMENTS: Record<string, Instrument> = {
  PRTEE,
  PRWHE,
  BCTQ: pending('BCTQ', 'Boston Carpal Tunnel Questionnaire', 'over the past 2 weeks'),
  'JFLS-8': JFLS8,
  FAAM,
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
  'hand-study-participant': { key: 'hand', tag: 'hand-study-participant', module: 'hand-balancer', condition: 'hand / finger tendon pain', shortName: 'Hand Pain Study', bodyQuestion: HAND, impactLabel: 'How it affects climbing or gripping', instrumentAbbr: 'PRWHE', status: 'live' },
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

function collectValues(
  inst: Instrument,
  responses: Record<string, number | null>,
): number[] | null {
  const values: number[] = [];
  for (const sub of inst.subscales) {
    for (const it of sub.items) {
      const v = responses[it.id];
      if (v === null || v === undefined) continue;
      if (v === RESPONSE_NA) continue;
      if (v < inst.scoring.minScale || v > inst.scoring.maxScale) return null;
      values.push(v);
    }
  }
  return values;
}

function scorePrtee(inst: Instrument, responses: Record<string, number | null>): number | null {
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
  const pain = sub(inst.scoring.painKeys ?? []);
  const fn = sub(inst.scoring.functionKeys ?? []);
  if (pain === null || fn === null) return null;
  return pain + (inst.scoring.functionHalved ? fn / 2 : fn);
}

/** Computed total, or null until enough items are answered. */
export function scoreInstrument(
  inst: Instrument,
  responses: Record<string, number | null>,
): number | null {
  if (!inst.ready) return null;
  const { method, minAnswered, maxScale } = inst.scoring;

  if (method === 'prtee') return scorePrtee(inst, responses);

  const values = collectValues(inst, responses);
  if (!values || values.length < minAnswered) return null;

  if (method === 'mean') {
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / values.length) * 10) / 10;
  }

  if (method === 'percent') {
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round((sum / (values.length * maxScale)) * 1000) / 10;
  }

  return null;
}

export function formatInstrumentScore(inst: Instrument, total: number): string {
  const rounded =
    Number.isInteger(total) ? String(total) : total.toFixed(1);
  return `${rounded}/${inst.scoring.max}`;
}

export function itemCount(inst: Instrument): number {
  return inst.subscales.reduce((n, s) => n + s.items.length, 0);
}

export function countAnswered(
  inst: Instrument,
  responses: Record<string, number | null>,
): { answered: number; na: number } {
  let answered = 0;
  let na = 0;
  for (const sub of inst.subscales) {
    for (const it of sub.items) {
      const v = responses[it.id];
      if (v === RESPONSE_NA) na += 1;
      else if (v !== null && v !== undefined) answered += 1;
    }
  }
  return { answered, na };
}
