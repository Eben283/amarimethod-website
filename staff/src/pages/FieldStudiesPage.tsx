import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, ClipboardList, ExternalLink, FilePenLine, Loader2, LockKeyhole, Plus, UserPlus, X } from 'lucide-react';
import { enrollFieldStudyParticipant, getFieldStudyParticipant, listFieldStudyParticipants, saveFieldStudyBaseline } from '../lib/api';
import StudyBaselineForm, { emptyStudyBaselineAnswers } from '../components/StudyBaselineForm';
import type { FieldStudyBaseline, FieldStudyParticipant, FieldStudyQueueItem } from '../types/staff';
import './FieldStudiesPage.css';
import './FieldStudiesFixes.css';
import './FieldStudiesUsability.css';

const BOOKING_URL = 'https://link.amarimethod.com/widget/bookings/amari-study';
const SCALE = Array.from({ length: 11 }, (_, index) => index);
const FIELD_STUDIES = {
  jaw: { label: 'Jaw', note: 'Jaw / TMJ tension & clicking' }, foot: { label: 'Foot', note: 'Arch, heel & plantar pain' },
  elbow: { label: 'Elbow', note: 'Tennis / golfer’s elbow' }, hand: { label: 'Hand', note: 'Wrist, thumb & grip pain' },
  'upper-back': { label: 'Upper Back', note: 'Desk shoulders & upper-back ache' },
} as const;
type FieldStudyKey = keyof typeof FIELD_STUDIES;
type View = 'participant' | 'queue' | 'saved' | 'baseline';
type FormErrors = Partial<Record<'fieldStudyKey' | 'firstName' | 'lastName' | 'phone' | 'email' | 'afterSessionOnePain', string>>;
type ParticipantForm = { fieldStudyKey: FieldStudyKey | ''; firstName: string; lastName: string; phone: string; email: string; paperDate: string; canUseFirstName: boolean; afterSessionOnePain: number | null };

function localDate() { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const v = (t: string) => p.find((x) => x.type === t)?.value || ''; return `${v('year')}-${v('month')}-${v('day')}`; }
function displayDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Date'; }
function formatPhone(value: string) { const d = value.replace(/\D/g, '').slice(0, 10); return d.length < 4 ? d : d.length < 7 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function blankParticipant(): ParticipantForm { return { fieldStudyKey: '', firstName: '', lastName: '', phone: '', email: '', paperDate: localDate(), canUseFirstName: false, afterSessionOnePain: null }; }
function blankBaseline(): Omit<FieldStudyBaseline, 'capturedAt'> { return emptyStudyBaselineAnswers(); }
function completeBaseline(v: Omit<FieldStudyBaseline, 'capturedAt'>) { return v.discomfortNow !== null && v.worstPastSevenDays !== null && Boolean(v.easierActivity.trim()) && v.activityDifficulty !== null && v.dayLimit !== null && v.activityAvoidance !== null && v.bodyLocations.some((x) => x.trim()); }

function Scale({ value, onChange, label }: { value: number | null; onChange: (next: number) => void; label: string }) { return <div className="fs-scale" role="group" aria-label={label}>{SCALE.map((n) => <button key={n} type="button" className={value === n ? 'selected' : ''} onClick={() => onChange(n)} aria-pressed={value === n} aria-label={`${label}: ${n}`}>{n}</button>)}</div>; }
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <label className={error ? 'fs-field has-error' : 'fs-field'}><span>{label}</span>{children}{error && <small role="alert"><AlertCircle size={12} /> {error}</small>}</label>; }

export default function FieldStudiesPage() {
  const [view, setView] = useState<View>('participant');
  const [form, setForm] = useState<ParticipantForm>(blankParticipant);
  const [errors, setErrors] = useState<FormErrors>({});
  const [queue, setQueue] = useState<FieldStudyQueueItem[]>([]);
  const [record, setRecord] = useState<FieldStudyParticipant | null>(null);
  const [baseline, setBaseline] = useState<Omit<FieldStudyBaseline, 'capturedAt'>>(blankBaseline);
  const [baselineSnapshot, setBaselineSnapshot] = useState('');
  const [baselineError, setBaselineError] = useState('');
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarOpened, setCalendarOpened] = useState(false);
  const formStart = useRef(JSON.stringify(blankParticipant()));
  const pending = useMemo(() => queue.filter((item) => !item.baselineCapturedAt), [queue]);
  const selectedStudy = form.fieldStudyKey ? FIELD_STUDIES[form.fieldStudyKey] : null;
  const paperLabel = `${form.firstName.trim() || 'First name'} · ${selectedStudy?.label || 'Study'} · ${displayDate(form.paperDate)}`;
  const formDirty = JSON.stringify(form) !== formStart.current;
  const baselineDirty = JSON.stringify(baseline) !== baselineSnapshot;

  async function refreshQueue() { setLoadingQueue(true); try { setQueue(await listFieldStudyParticipants()); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not load saved participants.'); } finally { setLoadingQueue(false); } }
  useEffect(() => { refreshQueue(); }, []);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (!formDirty && !(view === 'baseline' && baselineDirty)) return; e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [baselineDirty, formDirty, view]);

  function navigate(next: View) { if ((view === 'participant' && formDirty) || (view === 'baseline' && baselineDirty)) { if (!window.confirm('You have unsaved work. Leave without saving?')) return; } setView(next); if (next === 'participant') setRecord(null); }
  function changeForm<K extends keyof ParticipantForm>(key: K, value: ParticipantForm[K]) { setForm((p) => ({ ...p, [key]: value })); setErrors((p) => ({ ...p, [key]: undefined })); }
  function validate(): FormErrors { const e: FormErrors = {}; if (!form.fieldStudyKey) e.fieldStudyKey = 'Choose the study shown on their paper panel.'; if (!form.firstName.trim()) e.firstName = 'First name is required.'; if (!form.lastName.trim()) e.lastName = 'Last name is required.'; if (form.phone.replace(/\D/g, '').length !== 10) e.phone = 'Enter a 10-digit mobile number.'; if (!validEmail(form.email)) e.email = 'Enter a valid email address.'; if (form.afterSessionOnePain === null) e.afterSessionOnePain = 'Choose their after-session pain score.'; return e; }

  async function saveParticipant(event: React.FormEvent) {
    event.preventDefault(); const next = validate(); setErrors(next);
    if (Object.keys(next).length) { window.setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0); return; }
    setSaving(true); setMessage('');
    try { const saved = await enrollFieldStudyParticipant(form as ParticipantForm & { fieldStudyKey: FieldStudyKey }); setRecord(saved); const reset = blankParticipant(); setForm(reset); formStart.current = JSON.stringify(reset); setCalendarOpened(true); await refreshQueue(); setMessage(`${saved.paperId} saved. Now book sessions 2 and 3.`); setCalendarOpen(true); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save the participant. Check the fields and try again.'); }
    finally { setSaving(false); }
  }

  async function openPaper(id: string) {
    setLoadingQueue(true); setMessage('');
    try { const found = await getFieldStudyParticipant(id); if (!found) throw new Error('That saved participant could not be found.'); const next = found.baseline ? { discomfortNow: found.baseline.discomfortNow, worstPastSevenDays: found.baseline.worstPastSevenDays, easierActivity: found.baseline.easierActivity, activityDifficulty: found.baseline.activityDifficulty, dayLimit: found.baseline.dayLimit, activityAvoidance: found.baseline.activityAvoidance, bodyLocations: [...found.baseline.bodyLocations, '', '', ''].slice(0, 3) } : blankBaseline(); setRecord(found); setBaseline(next); setBaselineSnapshot(JSON.stringify(next)); setBaselineError(''); setView('baseline'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not open the paper form.'); } finally { setLoadingQueue(false); }
  }
  async function saveBaseline() { if (!record) return; if (!completeBaseline(baseline)) { setBaselineError('Enter all 6 answers and at least 1 marked body location before saving.'); return; } setSaving(true); setMessage(''); try { const saved = await saveFieldStudyBaseline(record.id, baseline); setRecord(saved); setBaselineSnapshot(JSON.stringify(baseline)); await refreshQueue(); setMessage(`Baseline saved for ${saved.paperId}.`); setView('saved'); } catch (e) { setBaselineError(e instanceof Error ? e.message : 'Could not save the baseline. Try again.'); } finally { setSaving(false); } }

  return <main className="field-study-shell"><section className="field-study-ipad">
    <header className="fs-topbar"><button type="button" onClick={() => navigate('participant')}><i />AMARI METHOD</button><div><span><LockKeyhole size={13} /> Staff view</span><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())}</time></div></header>
    <nav className="fs-workbar" aria-label="Field study sections"><button type="button" className={view === 'participant' ? 'selected' : ''} onClick={() => navigate('participant')}><UserPlus size={16} /> New participant</button><button type="button" className={view === 'queue' || view === 'baseline' ? 'selected' : ''} onClick={() => { navigate('queue'); refreshQueue(); }}><ClipboardList size={16} /> Paper forms to enter {pending.length > 0 && <b>{pending.length}</b>}</button><button type="button" className={view === 'saved' ? 'selected' : ''} onClick={() => { navigate('saved'); refreshQueue(); }}><FilePenLine size={16} /> Saved participants</button></nav>
    {message && <div className="fs-message" role="status" aria-live="polite">{message}<button type="button" onClick={() => setMessage('')}>Dismiss</button></div>}
    {view === 'participant' && <section className="fs-intake"><form onSubmit={saveParticipant} className="fs-form" noValidate><div className="fs-heading"><div><p>AFTER SESSION ONE</p><h1>Finish participant record</h1><span>Fields marked * are required before saving.</span></div></div><div className="fs-study-row"><Field label="Study *" error={errors.fieldStudyKey}><select name="study" value={form.fieldStudyKey} onChange={(e) => changeForm('fieldStudyKey', e.target.value as FieldStudyKey | '')} aria-invalid={Boolean(errors.fieldStudyKey)}><option value="">Choose the paper panel…</option>{(Object.entries(FIELD_STUDIES) as Array<[FieldStudyKey, typeof FIELD_STUDIES[FieldStudyKey]]>).map(([key, study]) => <option key={key} value={key}>{study.label} — {study.note}</option>)}</select>{selectedStudy && <small>{selectedStudy.note}</small>}</Field><div className="fs-paper-id"><b>Paper form label</b><strong>{paperLabel}</strong><small>First name · study · today — matching the sheet in hand.</small></div></div><section className={errors.afterSessionOnePain ? 'fs-score has-error' : 'fs-score'}><p>After session one *</p><div><strong>Where is their pain now?</strong><small>0 = none · 10 = most intense</small>{errors.afterSessionOnePain && <em><AlertCircle size={12} /> {errors.afterSessionOnePain}</em>}</div><Scale label="After-session pain score" value={form.afterSessionOnePain} onChange={(v) => changeForm('afterSessionOnePain', v)} /></section><div className="fs-divider" /><section className="fs-details"><p>Participant details</p><div className="fs-two"><Field label="First name *" error={errors.firstName}><input name="given-name" autoComplete="given-name" value={form.firstName} onChange={(e) => changeForm('firstName', e.target.value)} aria-invalid={Boolean(errors.firstName)} /></Field><Field label="Last name *" error={errors.lastName}><input name="family-name" autoComplete="family-name" value={form.lastName} onChange={(e) => changeForm('lastName', e.target.value)} aria-invalid={Boolean(errors.lastName)} /></Field></div><div className="fs-two"><Field label="Mobile *" error={errors.phone}><input name="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => changeForm('phone', formatPhone(e.target.value))} aria-invalid={Boolean(errors.phone)} placeholder="(415) 555-0123" /></Field><Field label="Email *" error={errors.email}><input name="email" autoComplete="email" type="email" spellCheck={false} value={form.email} onChange={(e) => changeForm('email', e.target.value.trimStart())} aria-invalid={Boolean(errors.email)} placeholder="name@example.com" /></Field></div><label className="fs-consent"><input type="checkbox" checked={form.canUseFirstName} onChange={(e) => changeForm('canUseFirstName', e.target.checked)} /> <span>May we use their first name in study notes? <em>Optional</em></span></label></section><div className="fs-footer"><small>The 6 baseline answers stay on paper. Enter them once the participant has left.</small><button type="submit" disabled={saving}>{saving ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : <>Save participant <ArrowRight size={17} /></>}</button></div>{record && <section className="fs-success" aria-live="polite"><div><Check size={20} /><span><b>{record.paperId} saved</b><small>Participant record, Study Name, field-table tag & session 1 are recorded.</small></span></div><div className="fs-success-action"><span>{calendarOpened ? 'Amari calendar opened — book sessions 2 & 3, then return here.' : 'Next: book sessions 2 & 3.'}</span><button type="button" onClick={() => { setCalendarOpened(true); setCalendarOpen(true); }}>Open Amari calendar <ExternalLink size={14} /></button></div></section>}</form></section>}
    {view === 'queue' && <ParticipantList title="Paper forms to enter" eyebrow="BETWEEN PARTICIPANTS" description="Match the first name · study · date label on the physical sheet, then copy its 6 answers and body-map notes." items={pending} loading={loadingQueue} empty="No paper baselines waiting." action="Enter paper form" onNew={() => navigate('participant')} onOpen={openPaper} />}
    {view === 'saved' && <ParticipantList title="Saved participants" eyebrow="FIELD STUDY RECORDS" description="Every participant saved through the table flow. Open any record to review or complete its paper baseline." items={queue} loading={loadingQueue} empty="No participants saved yet." action="Open record" onNew={() => navigate('participant')} onOpen={openPaper} showStatus />}
    {view === 'baseline' && record && <section className="fs-baseline"><button type="button" className="fs-back" onClick={() => navigate('queue')}><ArrowLeft size={16} /> Back to paper forms</button><header><div><p>COPYING FROM PAPER / {record.paperId}</p><h1>Enter {record.firstName}'s paper form</h1><span>Copy all 6 answers and at least 1 marked body location exactly as they appear on the sheet.</span></div><aside><b>Match the sheet</b><span>{record.studyLabel || record.studyName}</span></aside></header>{baselineError && <div className="fs-inline-error" role="alert"><AlertCircle size={15} /> {baselineError}</div>}<StudyBaselineForm value={baseline} onChange={(next) => { setBaseline((p) => ({ ...p, ...next })); setBaselineError(''); }} bodyMapHeading="Paper body map" /><footer><span>Saving clears this person from the pending queue.</span><button type="button" onClick={saveBaseline} disabled={saving}>{saving ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : <>Save baseline entry <Check size={17} /></>}</button></footer></section>}
  </section>{calendarOpen && <CalendarModal onClose={() => setCalendarOpen(false)} />}</main>;
}

function ParticipantList({ title, eyebrow, description, items, loading, empty, action, onNew, onOpen, showStatus = false }: { title: string; eyebrow: string; description: string; items: FieldStudyQueueItem[]; loading: boolean; empty: string; action: string; onNew: () => void; onOpen: (id: string) => void; showStatus?: boolean }) { return <section className="fs-queue"><header><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div><button type="button" onClick={onNew}><Plus size={17} /> New participant</button></header><div className="fs-key"><span>{items.length} participant{items.length === 1 ? '' : 's'}</span></div>{loading ? <Loader2 className="fs-loader animate-spin" /> : items.length === 0 ? <div className="fs-empty">{empty}</div> : <div className="fs-list">{items.map((item) => <article key={item.id}><code>{item.paperId}</code><div><p>{item.studyLabel || item.studyName}</p><h2>{item.firstName}</h2><span>After session: {item.afterSessionOnePain}/10</span></div>{showStatus ? <em className={item.baselineCapturedAt ? 'complete' : ''}><i /> {item.baselineCapturedAt ? 'Baseline entered' : 'Paper waiting'}</em> : <em><i /> Paper waiting</em>}<button type="button" onClick={() => onOpen(item.id)}>{showStatus && !item.baselineCapturedAt ? 'Enter paper form' : action} <ArrowRight size={16} /></button></article>)}</div>}</section>; }
function CalendarModal({ onClose }: { onClose: () => void }) { return <div className="fs-calendar" role="dialog" aria-modal="true" aria-label="Book study sessions"><div className="fs-calendar-scrim" onClick={onClose} /><section><header><div><p>AMARI CALENDAR</p><h2>Book sessions 2 & 3</h2></div><button type="button" onClick={onClose} aria-label="Close calendar"><X size={18} /></button></header><iframe src={BOOKING_URL} title="Amari study booking calendar" /></section></div>; }
