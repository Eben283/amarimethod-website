import { useEffect, useRef, useState } from 'react';
import { Activity, Check, Loader2 } from 'lucide-react';
import { getElbowStudy, saveElbowStudy } from '../lib/api';
import type { ElbowStudyRecord, ElbowStudySession, InstrumentSnapshot } from '../types/staff';
import { INSTRUMENTS, scoreInstrument, type Instrument } from '../data/studies';

interface Props {
  contactId: string;
}

// The elbow study's validated survey. This panel is the elbow panel, so PRTEE
// is fixed; a generalized panel would look this up from the participant's tag.
const SURVEY: Instrument = INSTRUMENTS.PRTEE;
const SURVEY_ITEM_COUNT = SURVEY.subscales.reduce((n, s) => n + s.items.length, 0);

function emptySnapshot(): InstrumentSnapshot {
  return { responses: {}, at: null };
}

const ARM_OPTIONS: Array<{ value: 'left' | 'right' | 'both'; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
];

const PAIN_SCALE = Array.from({ length: 11 }, (_, i) => i); // 0..10

function emptyRecord(): ElbowStudyRecord {
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

// A 0-10 tap row. Wraps on narrow screens; the selected value is filled.
function PainScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {PAIN_SCALE.map((n) => {
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(on ? null : n)}
            aria-pressed={on}
            style={{
              minWidth: 34,
              minHeight: 34,
              borderRadius: 8,
              fontFamily: 'var(--mono)',
              fontSize: 13,
              cursor: 'pointer',
              border: '1px solid var(--line)',
              background: on ? 'var(--accent)' : 'var(--surface)',
              color: on ? '#fff' : 'var(--ink2)',
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// Count how many of the survey's items have a 0-10 answer.
function countAnswered(survey: Instrument, responses: Record<string, number | null>): number {
  let n = 0;
  for (const sub of survey.subscales) {
    for (const it of sub.items) {
      const v = responses[it.id];
      if (v !== null && v !== undefined) n += 1;
    }
  }
  return n;
}

// One collapsible filling of the validated survey (baseline or final). Renders
// each subscale's items as 0-10 rows and shows a live score once complete.
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
  const answered = countAnswered(survey, responses);
  const total = scoreInstrument(survey, responses); // number | null (null until all answered)

  return (
    <details open={defaultOpen} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="lbl">{title}</span>
        <span className="sa-chip" style={{ fontSize: 12 }}>
          {total !== null
            ? `score ${total}/${survey.scoring.max}`
            : `${answered}/${SURVEY_ITEM_COUNT} answered`}
        </span>
      </summary>

      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 4px' }}>
        {hint} Survey asks about the {survey.recall}. Higher score = worse.
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
            0 = {sub.anchorLow} · 10 = {sub.anchorHigh}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sub.items.map((it) => (
              <div key={it.id}>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--ink2)' }}>
                  {it.text}
                </span>
                <PainScale
                  value={responses[it.id] ?? null}
                  onChange={(v) => onChange(it.id, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>{survey.attribution}</p>
    </details>
  );
}

export default function ElbowStudyPanel({ contactId }: Props) {
  const [record, setRecord] = useState<ElbowStudyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load once per contact.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getElbowStudy(contactId)
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
  }, [contactId]);

  // Debounced persist. Always sends the freshly-built next record (never a
  // stale closure), so rapid taps collapse into one write of the latest state.
  function persist(next: ElbowStudyRecord) {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveElbowStudy(contactId, next)
        // Deliberately do NOT adopt the server-normalized copy here: Garrett may
        // still be typing the note, and replacing state mid-edit jumps his
        // cursor to the end. Local state is already valid — every input is
        // constrained (pain via 0–10 buttons, arm via enum, text via maxLength)
        // — so the stored copy and the on-screen copy can't meaningfully drift.
        // The clamped/trimmed server copy is picked up on the next load.
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 700);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Immutable update helpers — never mutate the existing record.
  function update(patch: Partial<ElbowStudyRecord>) {
    setRecord((prev) => {
      const base = prev ?? emptyRecord();
      const next = { ...base, ...patch };
      persist(next);
      return next;
    });
  }

  function updateSession(index: number, patch: Partial<ElbowStudySession>) {
    setRecord((prev) => {
      const base = prev ?? emptyRecord();
      const sessions = base.sessions.map((s, i) => (i === index ? { ...s, ...patch } : s));
      const next = { ...base, sessions };
      persist(next);
      return next;
    });
  }

  // Set (or clear) one survey item on the baseline or final snapshot. An
  // unanswered item is absent from the map — clearing deletes the key, matching
  // the server's shape.
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

  return (
    <section className="sa-card">
      <div className="sa-card-h">
        <span className="t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={17} /> Elbow Reset Study
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
          {/* ---- Intake (session 1) ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
            <div>
              <span className="lbl" style={{ display: 'block', marginBottom: 6 }}>
                Affected arm
              </span>
              <div className="sa-seg">
                {ARM_OPTIONS.map((opt) => (
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
                How it affects their game
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

          {/* ---- Validated survey: baseline + final (the published outcome) ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
            <SurveySection
              title={`${SURVEY.abbr} — start (before session 1)`}
              hint="Fill this before their first session."
              survey={SURVEY}
              snapshot={r.baseline}
              onChange={(id, v) => updateSurvey('baseline', id, v)}
              defaultOpen={false}
            />
            <SurveySection
              title={`${SURVEY.abbr} — end (after session 3)`}
              hint="Fill this after their last session or at the 1-week follow-up."
              survey={SURVEY}
              snapshot={r.final}
              onChange={(id, v) => updateSurvey('final', id, v)}
              defaultOpen={false}
            />
          </div>

          {/* ---- Before/after pain per session ---- */}
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
                    <PainScale value={s.before} onChange={(v) => updateSession(i, { before: v })} />
                  </div>

                  <div>
                    <span
                      style={{ display: 'block', marginBottom: 5, fontSize: 12, color: 'var(--muted)' }}
                    >
                      After (0–10)
                    </span>
                    <PainScale value={s.after} onChange={(v) => updateSession(i, { after: v })} />
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
