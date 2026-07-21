import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ClipboardList, ExternalLink, FilePenLine, Loader2, LockKeyhole, Plus, UserPlus } from 'lucide-react';
import {
  enrollFieldStudyParticipant,
  getFieldStudyParticipant,
  listFieldStudyParticipants,
  saveFieldStudyBaseline,
} from '../lib/api';
import StudyBaselineForm, { emptyStudyBaselineAnswers } from '../components/StudyBaselineForm';
import type { FieldStudyBaseline, FieldStudyParticipant, FieldStudyQueueItem } from '../types/staff';
import './FieldStudiesPage.css';
import './FieldStudiesFixes.css';

const BOOKING_URL = 'https://link.amarimethod.com/widget/bookings/amari-study';
const SCALE = Array.from({ length: 11 }, (_, index) => index);

type View = 'participant' | 'queue' | 'saved' | 'baseline';

type ParticipantForm = {
  fieldStudyKey: FieldStudyKey;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  canUseFirstName: boolean;
  afterSessionOnePain: number | null;
};

const FIELD_STUDIES = {
  jaw: { label: 'Jaw', code: 'JW', note: 'Jaw / TMJ tension & clicking' },
  foot: { label: 'Foot', code: 'FT', note: 'Arch, heel & plantar pain' },
  elbow: { label: 'Elbow', code: 'EL', note: 'Tennis / golfer’s elbow' },
  hand: { label: 'Hand', code: 'HW', note: 'Wrist, thumb & grip pain' },
  'upper-back': { label: 'Upper Back', code: 'UB', note: 'Desk shoulders & upper-back ache' },
} as const;
type FieldStudyKey = keyof typeof FIELD_STUDIES;

function blankParticipant(): ParticipantForm {
  return {
    fieldStudyKey: 'upper-back', firstName: '', lastName: '', phone: '', email: '',
    canUseFirstName: false, afterSessionOnePain: null,
  };
}

function blankBaseline(): Omit<FieldStudyBaseline, 'capturedAt'> {
  return emptyStudyBaselineAnswers();
}

function Scale({ value, onChange, compact = false }: {
  value: number | null; onChange: (next: number | null) => void; compact?: boolean;
}) {
  return (
    <div className={`grid grid-cols-11 gap-1 ${compact ? 'max-w-[430px]' : ''}`}>
      {SCALE.map((number) => {
        const active = value === number;
        return (
          <button
            key={number}
            type="button"
            onClick={() => onChange(active ? null : number)}
            className={`min-h-[36px] rounded-md border text-sm font-medium transition-colors ${
              active ? 'border-amari-charcoal bg-amari-charcoal text-white' : 'border-amari-border bg-white text-amari-text-secondary hover:bg-amari-light-sand'
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="staff-label">{label}</span>{children}</label>;
}

export default function FieldStudiesPage() {
  const [view, setView] = useState<View>('participant');
  const [form, setForm] = useState<ParticipantForm>(blankParticipant);
  const [queue, setQueue] = useState<FieldStudyQueueItem[]>([]);
  const [record, setRecord] = useState<FieldStudyParticipant | null>(null);
  const [baseline, setBaseline] = useState<Omit<FieldStudyBaseline, 'capturedAt'>>(blankBaseline);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const pending = useMemo(() => queue.filter((item) => !item.baselineCapturedAt), [queue]);
  const savedParticipants = useMemo(() => queue, [queue]);
  const selectedStudy = FIELD_STUDIES[form.fieldStudyKey];
  const paperLabel = `${form.firstName || 'First name'} · ${selectedStudy.label} · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date())}`;

  async function refreshQueue() {
    setLoadingQueue(true);
    try {
      setQueue(await listFieldStudyParticipants());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load paper forms.');
    } finally {
      setLoadingQueue(false);
    }
  }

  useEffect(() => { refreshQueue(); }, []);

  function changeForm<K extends keyof ParticipantForm>(key: K, value: ParticipantForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function chooseStudy(key: FieldStudyKey) {
    setForm((previous) => ({ ...previous, fieldStudyKey: key }));
  }

  async function saveParticipant(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const saved = await enrollFieldStudyParticipant(form);
      setRecord(saved);
      setForm(blankParticipant());
      await refreshQueue();
      setMessage(`${saved.firstName} is saved. Now book sessions 2 and 3 in the existing calendar.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save participant.');
    } finally {
      setSaving(false);
    }
  }

  async function openPaper(recordId: string) {
    setLoadingQueue(true);
    setMessage('');
    try {
      const found = await getFieldStudyParticipant(recordId);
      if (!found) throw new Error('That paper form could not be found.');
      setRecord(found);
      setBaseline(found.baseline ? {
        discomfortNow: found.baseline.discomfortNow,
        worstPastSevenDays: found.baseline.worstPastSevenDays,
        easierActivity: found.baseline.easierActivity,
        activityDifficulty: found.baseline.activityDifficulty,
        dayLimit: found.baseline.dayLimit,
        activityAvoidance: found.baseline.activityAvoidance,
        bodyLocations: [...found.baseline.bodyLocations, '', '', ''].slice(0, 3),
      } : blankBaseline());
      setView('baseline');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open paper form.');
    } finally {
      setLoadingQueue(false);
    }
  }

  async function saveBaseline() {
    if (!record) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveFieldStudyBaseline(record.id, baseline);
      setRecord(saved);
      await refreshQueue();
      setMessage(`Baseline saved from ${saved.paperId}.`);
      setView('queue');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the baseline.');
    } finally {
      setSaving(false);
    }
  }

  return <main className="field-study-shell"><section className="field-study-ipad">
    <header className="fs-topbar"><button onClick={() => { setView('participant'); setRecord(null); }}><i />AMARI METHOD</button><div><span><LockKeyhole size={13} /> Staff view</span><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())}</time></div></header>
    <nav className="fs-workbar"><button className={view === 'participant' ? 'selected' : ''} onClick={() => { setView('participant'); setRecord(null); }}><UserPlus size={16} /> New participant</button><button className={view === 'queue' || view === 'baseline' ? 'selected' : ''} onClick={() => { setView('queue'); refreshQueue(); }}><ClipboardList size={16} /> Paper forms to enter {pending.length > 0 && <b>{pending.length}</b>}</button><button className={view === 'saved' ? 'selected' : ''} onClick={() => { setView('saved'); refreshQueue(); }}><FilePenLine size={16} /> Saved participants</button></nav>
    {message && <div className="fs-message" role="status">{message}<button onClick={() => setMessage('')}>Dismiss</button></div>}
    {view === 'participant' && <section className="fs-intake"><form onSubmit={saveParticipant} className="fs-form">
      <div className="fs-heading"><div><p>AFTER SESSION ONE</p><h1>Finish participant record</h1></div></div>
      <div className="fs-study-row"><label className="fs-study"><b>Study</b><select value={form.fieldStudyKey} onChange={(event) => chooseStudy(event.target.value as FieldStudyKey)}>{(Object.entries(FIELD_STUDIES) as Array<[FieldStudyKey, typeof FIELD_STUDIES[FieldStudyKey]]>).map(([key, study]) => <option key={key} value={key}>{study.label} — {study.note}</option>)}</select><small>{selectedStudy.note}</small></label><div className="fs-paper-id"><b>Paper form</b><strong>{paperLabel}</strong><small>First name · study · date — matching the sheet in hand.</small></div></div>
      <section className="fs-score"><p>After session one</p><div><strong>Where is your pain now, after this session?</strong><small>0 = none · 10 = most intense</small></div><Scale value={form.afterSessionOnePain} onChange={(value) => changeForm('afterSessionOnePain', value)} compact /></section>
      <div className="fs-divider" /><section className="fs-details"><p>Participant details</p><div className="fs-two"><Field label="First name"><input value={form.firstName} onChange={(event) => changeForm('firstName', event.target.value)} required /></Field><Field label="Last name"><input value={form.lastName} onChange={(event) => changeForm('lastName', event.target.value)} required /></Field></div><div className="fs-two"><Field label="Mobile"><input value={form.phone} onChange={(event) => changeForm('phone', event.target.value)} type="tel" required /></Field><Field label="Email"><input value={form.email} onChange={(event) => changeForm('email', event.target.value)} type="email" required /></Field></div><label className="fs-consent"><input type="checkbox" checked={form.canUseFirstName} onChange={(event) => changeForm('canUseFirstName', event.target.checked)} /> May we use their first name in study notes?</label></section>
      <div className="fs-footer"><small>The six baseline answers stay on paper. Add them once they have left.</small><button type="submit" disabled={saving}>{saving ? <Loader2 size={17} className="animate-spin" /> : 'Save participant'} <ArrowRight size={17} /></button></div>
      {record && <div className="fs-book"><strong>{record.firstName} is saved.</strong><span>Now reserve sessions 2 and 3 in the existing Amari calendar.</span><a href={BOOKING_URL} target="_blank" rel="noreferrer">Open booking calendar <ExternalLink size={14} /></a></div>}
    </form></section>}
    {view === 'queue' && <section className="fs-queue"><header><div><p>BETWEEN PARTICIPANTS</p><h1>Paper forms to enter</h1><span>Find the paper ID on the physical sheet, then copy the six answers and body-map notes.</span></div><button onClick={() => { setView('participant'); setRecord(null); }}><Plus size={17} /> New participant</button></header><div className="fs-key"><span><i /> Paper form waiting to be entered</span></div>{loadingQueue ? <Loader2 className="fs-loader animate-spin" /> : pending.length === 0 ? <div className="fs-empty">No paper baselines waiting.</div> : <div className="fs-list">{pending.map((item) => <article key={item.id}><code>{item.paperId}</code><div><p>{item.studyLabel || item.studyName}</p><h2>{item.firstName}</h2><span>Session one complete</span></div><em><i /> Paper waiting</em><button onClick={() => openPaper(item.id)}>Enter this paper form <ArrowRight size={16} /></button></article>)}</div>}</section>}
    {view === 'saved' && <section className="fs-queue"><header><div><p>FIELD STUDY RECORDS</p><h1>Saved participants</h1><span>Every participant saved through the table flow. Open any record to review or finish its paper baseline.</span></div><button onClick={() => { setView('participant'); setRecord(null); }}><Plus size={17} /> New participant</button></header><div className="fs-key"><span>{savedParticipants.length} participant{savedParticipants.length === 1 ? '' : 's'} saved</span></div>{loadingQueue ? <Loader2 className="fs-loader animate-spin" /> : savedParticipants.length === 0 ? <div className="fs-empty">No participants saved yet.</div> : <div className="fs-list">{savedParticipants.map((item) => <article key={item.id}><code>{item.paperId}</code><div><p>{item.studyLabel || item.studyName}</p><h2>{item.firstName}</h2><span>After session: {item.afterSessionOnePain}/10</span></div><em className={item.baselineCapturedAt ? 'complete' : ''}><i /> {item.baselineCapturedAt ? 'Baseline entered' : 'Paper waiting'}</em><button onClick={() => openPaper(item.id)}>{item.baselineCapturedAt ? 'Open record' : 'Enter paper form'} <ArrowRight size={16} /></button></article>)}</div>}</section>}
    {view === 'baseline' && record && <section className="fs-baseline"><button className="fs-back" onClick={() => setView('queue')}><ArrowLeft size={16} /> Back to paper forms</button><header><div><p>COPYING FROM PAPER / {record.paperId}</p><h1>Enter {record.firstName}'s paper form</h1><span>Copy the six answers and body-map notes exactly as they appear on the sheet.</span></div><aside><b>Match the sheet</b><span>{record.studyLabel || record.studyName}</span></aside></header><StudyBaselineForm value={baseline} onChange={(next) => setBaseline((previous) => ({ ...previous, ...next }))} bodyMapHeading="Paper body map" /><footer><span>Saving clears this person from the pending queue.</span><button onClick={saveBaseline} disabled={saving}>{saving ? <Loader2 size={17} className="animate-spin" /> : 'Save baseline entry'} <Check size={17} /></button></footer></section>}
  </section></main>;
}
