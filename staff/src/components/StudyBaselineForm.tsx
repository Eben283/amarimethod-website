import type { FieldStudyBaseline } from '../types/staff';

export type StudyBaselineAnswers = Pick<
  FieldStudyBaseline,
  'discomfortNow' | 'worstPastSevenDays' | 'easierActivity' | 'activityDifficulty' | 'dayLimit' | 'activityAvoidance' | 'bodyLocations'
>;

const SCALE = Array.from({ length: 11 }, (_, index) => index);

export function emptyStudyBaselineAnswers(): StudyBaselineAnswers {
  return {
    discomfortNow: null,
    worstPastSevenDays: null,
    easierActivity: '',
    activityDifficulty: null,
    dayLimit: null,
    activityAvoidance: null,
    bodyLocations: ['', '', ''],
  };
}

function Scale({ value, onChange }: { value: number | null; onChange: (next: number | null) => void }) {
  return (
    <div className="grid grid-cols-11 gap-1">
      {SCALE.map((number) => {
        const active = value === number;
        return (
          <button
            key={number}
            type="button"
            onClick={() => onChange(active ? null : number)}
            className={`min-h-[34px] rounded-md border text-sm font-medium transition-colors ${
              active
                ? 'border-amari-charcoal bg-amari-charcoal text-white'
                : 'border-amari-border bg-white text-amari-text-secondary hover:bg-amari-light-sand'
            }`}
            aria-pressed={active}
          >
            {number}
          </button>
        );
      })}
    </div>
  );
}

function Question({ label, hint, value, onChange }: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-amari-text-secondary">{label}</p>
      <p className="mb-2 text-xs text-amari-text-muted">{hint}</p>
      <Scale value={value} onChange={onChange} />
    </div>
  );
}

interface Props {
  value: StudyBaselineAnswers;
  onChange: (next: StudyBaselineAnswers) => void;
  className?: string;
  bodyMapHeading?: string;
}

// One shared baseline for every study. It is intentionally condition-neutral:
// participants answer for the area they chose, and mark the 1–3 locations that
// bother them most. This same component is used for field-paper transcription
// and existing participant records so a result means the same thing everywhere.
export default function StudyBaselineForm({
  value,
  onChange,
  className = '',
  bodyMapHeading = 'Body map',
}: Props) {
  const update = <K extends keyof StudyBaselineAnswers>(key: K, nextValue: StudyBaselineAnswers[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  const locations = [...value.bodyLocations, '', '', ''].slice(0, 3);

  return (
    <div className={`grid gap-x-6 gap-y-5 xl:grid-cols-[minmax(0,1fr)_310px] ${className}`.trim()}>
      <div className="grid gap-5 md:grid-cols-2">
        <Question
          label="1. Right now, how intense is the discomfort in this area?"
          hint="0 = no discomfort · 10 = worst imaginable"
          value={value.discomfortNow}
          onChange={(next) => update('discomfortNow', next)}
        />
        <Question
          label="2. In the past 7 days, at its worst, how intense was it?"
          hint="0 = no discomfort · 10 = worst imaginable"
          value={value.worstPastSevenDays}
          onChange={(next) => update('worstPastSevenDays', next)}
        />
        <label>
          <span className="staff-label">3. What is one thing they most want to feel easier doing?</span>
          <input
            value={value.easierActivity}
            onChange={(event) => update('easierActivity', event.target.value)}
            className="staff-input"
            placeholder="Typing, sleeping, lifting…"
          />
        </label>
        <Question
          label="4. How difficult is that for them right now?"
          hint="0 = no difficulty · 10 = unable to do it"
          value={value.activityDifficulty}
          onChange={(next) => update('activityDifficulty', next)}
        />
        <Question
          label="5. Over the past 7 days, how much has this area limited their normal day?"
          hint="0 = not at all · 10 = completely"
          value={value.dayLimit}
          onChange={(next) => update('dayLimit', next)}
        />
        <Question
          label="6. Over the past 7 days, how much have they avoided or changed activities because of it?"
          hint="0 = not at all · 10 = completely"
          value={value.activityAvoidance}
          onChange={(next) => update('activityAvoidance', next)}
        />
      </div>

      <aside className="rounded-xl border border-amari-border bg-amari-light-sand/40 p-4">
        <p className="staff-mlabel">{bodyMapHeading}</p>
        <p className="mt-1 text-sm text-amari-text-secondary">Mark or copy the 1–3 places that bother them most.</p>
        <img
          src="/staff/assets/field-study-body-map.png"
          alt="Front and back body outline for marking pain locations"
          className="mx-auto my-3 h-52 w-auto bg-white object-contain"
        />
        <div className="space-y-2">
          {locations.map((location, index) => (
            <input
              key={index}
              value={location}
              onChange={(event) => {
                const next = [...locations];
                next[index] = event.target.value;
                update('bodyLocations', next);
              }}
              className="staff-input py-2"
              placeholder={`${index + 1}. Marked location`}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}
