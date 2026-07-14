import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Activity, Check, Loader2 } from 'lucide-react';
import { getStudyCapture, saveStudyCapture } from '../lib/api';
import type { ElbowStudyRecord, ElbowStudySession, InstrumentSnapshot } from '../types/staff';
import {
  RESPONSE_NA,
  countAnswered,
  formatInstrumentScore,
  instrumentFor,
  itemCount,
  scoreInstrument,
  type Instrument,
  type StudyConfig,
} from '../data/studies';

interface Props {
  contactId: string;
  study: StudyConfig;
}

// Capture record shape is shared across studies (arm / gameImpact field names
// kept for elbow KV backward compat; UI labels come from the study registry).
type StudyRecord = ElbowStudyRecord;
type StudySession = ElbowStudySession;

function emptySnapshot(): InstrumentSnapshot {
  return { responses: {}, at: null };
}

const BODY_OPTIONS: Array<{ value: 'left' | 'right' | 'both'; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
];

function emptyRecord(): StudyRecord {
  return {
    arm: null,
    painWeeks: null,
    gameImpact: '',
    baseline: emptySnapshot(),
    final: emptySnapshot(),
    sessions: [0, 1, 2].map(() => ({ before: null, after: null, notes: '', at: null })),
    updatedAt: '',
  };
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const scaleBtnStyle = (on: boolean): CSSProperties => ({
  minWidth: 34,
  minHeight: 34,
  borderRadius: 8,
  fontFamily: 'var(--mono)',
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--line)',
  background: on ? 'var(--accent)' : 'var(--surface)',
  color: on ? '#fff' : 'var(--ink2)',
});

/** Numeric Likert for session pain (always 0–10) or instrument items. */
function ItemScale({
  value,
  onChange,
  min = 0,
  max = 10,
  allowNa = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  allowNa?: boolean;
}) {
  const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const isNa = value === RESPONSE_NA;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {nums.map((n) => {
        const on = !isNa && value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(on ? null : n)}
            aria-pressed={on}
            style={scaleBtnStyle(on)}
          >
            {n}
          </button>
        );
      })}
      {allowNa && (
        <button
          type="button"
          onClick={() => onChange(isNa ? null : RESPONSE_NA)}
          aria-pressed={isNa}
          title="Not applicable"
          style={{ ...scaleBtnStyle(isNa), minWidth: 44, fontSize: 12 }}
        >
          N/A
        </button>
      )}
    </div>
  );
}

function SurveySection({
  title,
  hint,
  survey,
  snapshot,
  onChange,
  defaultOpen,
}: {
  title: string;
  hint: string;
  survey: Instrument;
  snapshot: InstrumentSnapshot;
  onChange: (itemId: string, v: number | null) => void;
  defaultOpen: boolean;
}) {
  const responses = snapshot.responses;
  const { answered, na } = countAnswered(survey, responses);
  const total = scoreInstrument(survey, responses);
  const totalItems = itemCount(survey);
  const { minScale, maxScale, allowNa, higherIsBetter } = survey.scoring;
  const direction = higherIsBetter ? 'Higher score = better function.' : 'Higher score = worse.';

  return (
    <details open={defaultOpen} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="lbl">{title}</span>
        <span className="sa-chip" style={{ fontSize: 12 }}>
          {total !== null
            ? `score ${formatInstrumentScore(survey, total)}`
            : `${answered + na}/${totalItems} answered`}
        </span>
      </summary>

      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 4px' }}>
        {hint} Survey asks about the {survey.recall}. {direction}
      </p>

      {survey.subscales.map((sub) => (
        <div key={sub.key} style={{ marginTop: 12 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>
            {sub.title}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '2px 0 2px' }}>
            {sub.instruction}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            {minScale} = {sub.anchorLow} · {maxScale} = {sub.anchorHigh}
            {allowNa ? ' · N/A when limited by something else' : ''}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sub.items.map((it) => (
              <div key={it.id}>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--ink2)' }}>
                  {it.text}
                </span>
                <ItemScale
                  value={responses[it.id] ?? null}
                  onChange={(v) => onChange(it.id, v)}
                  min={minScale}
                  max={maxScale}
                  allowNa={allowNa}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>{survey.attribution}</p>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{survey.scoring.note}</p>
    </details>
  );
}

export default function StudyCapturePanel({ contactId, study }: Props) {
  const survey = instrumentFor(study);
  const [record, setRecord] = useState<StudyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStudyCapture(contactId, study.key)
      .then((r) => {
        if (cancelled) return;
        setRecord(r ?? emptyRecord());
      })
      .catch(() => {
        if (!cancelled) setRecord(emptyRecord());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, study.key]);

  function persist(next: StudyRecord) {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveStudyCapture(contactId, study.key, next)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 700);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function update(patch: Partial<StudyRecord>) {
    setRecord((prev) => {
      const base = prev ?? emptyRecord();
      const next = { ...base, ...patch };
      persist(next);
      return next;
    });
  }

  function updateSession(index: number, patch: Partial<StudySession>) {
    setRecord((prev) => {
      const base = prev ?? emptyRecord();
      const sessions = base.sessions.map((s, i) => (i === index ? { ...s, ...patch } : s));
      const next = { ...base, sessions };
      persist(next);
      return next;
    });
  }

  function updateSurvey(which: 'baseline' | 'final', itemId: string, v: number | null) {
    setRecord((prev) => {
      const base = prev ?? emptyRecord();
      const snap = base[which];
      const responses = { ...snap.responses };
      if (v === null) delete responses[itemId];
      else responses[itemId] = v;
      const next = { ...base, [which]: { ...snap, responses } };
      persist(next);
      return next;
    });
  }

  const r = record ?? emptyRecord();
  const bodyLabel = study.bodyQuestion?.label?.replace(/\?$/, '') || 'Affected side';

  return (
    <section className="sa-card">
      <div className="sa-card-h">
        <span className="t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={17} /> {study.shortName}
        </span>
        <span className="sa-chip" aria-live="polite">
          {saveState === 'saving' && (
            <>
              <Loader2 size={13} className="sa-spin" /> Saving…
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check size={13} /> Saved
            </>
          )}
          {saveState === 'error' && <span style={{ color: 'var(--danger, #c0392b)' }}>Save failed</span>}
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
          <Loader2 className="sa-spin" size={20} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
            {study.bodyQuestion && (
              <div>
                <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>
                  {bodyLabel}
                </span>
                <div className="sa-seg">
                  {BODY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={r.arm === opt.value ? 'is-on' : ''}
                      onClick={() => update({ arm: r.arm === opt.value ? null : opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>
                Weeks of pain
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={520}
                value={r.painWeeks ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  update({ painWeeks: raw === '' ? null : Number(raw) });
                }}
                placeholder="—"
                style={{
                  width: 90,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink2)',
                  fontSize: 14,
                }}
              />
            </div>

            <div>
              <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>
                {study.impactLabel}
              </span>
              <textarea
                value={r.gameImpact}
                onChange={(e) => update({ gameImpact: e.target.value })}
                rows={2}
                maxLength={1000}
                placeholder="2–3 sentences in their words"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink2)',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>
          </div>

          {survey.ready ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
              <SurveySection
                title={`${survey.abbr} — start (before session 1)`}
                hint="Fill this before their first session."
                survey={survey}
                snapshot={r.baseline}
                onChange={(id, v) => updateSurvey('baseline', id, v)}
                defaultOpen={false}
              />
              <SurveySection
                title={`${survey.abbr} — end (after session 3)`}
                hint="Fill this after their last session or at the 1-week follow-up."
                survey={survey}
                snapshot={r.final}
                onChange={(id, v) => updateSurvey('final', id, v)}
                defaultOpen={false}
              />
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              {survey.abbr} questionnaire items pending verification — capture pain scores below for now.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            {r.sessions.map((s, i) => {
              const drop =
                s.before !== null && s.after !== null ? s.before - s.after : null;
              return (
                <div
                  key={i}
                  style={{
                    borderTop: '1px solid var(--line)',
                    paddingTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="lbl">Session {i + 1}</span>
                    {drop !== null && (
                      <span className="sa-chip" style={{ fontSize: 12 }}>
                        {drop > 0 ? `−${drop} pain` : drop === 0 ? 'no change' : `+${-drop} pain`}
                      </span>
                    )}
                  </div>

                  <div>
                    <span
                      style={{ display: 'block', marginBottom: 5, fontSize: 12, color: 'var(--muted)' }}
                    >
                      Before (0–10)
                    </span>
                    <ItemScale value={s.before} onChange={(v) => updateSession(i, { before: v })} />
                  </div>

                  <div>
                    <span
                      style={{ display: 'block', marginBottom: 5, fontSize: 12, color: 'var(--muted)' }}
                    >
                      After (0–10)
                    </span>
                    <ItemScale value={s.after} onChange={(v) => updateSession(i, { after: v })} />
                  </div>

                  <input
                    type="text"
                    value={s.notes}
                    onChange={(e) => updateSession(i, { notes: e.target.value })}
                    maxLength={1000}
                    placeholder="Session note (optional)"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--line)',
                      background: 'var(--surface)',
                      color: 'var(--ink2)',
                      fontSize: 13,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
