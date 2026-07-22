import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, ClipboardList, ExternalLink, FilePenLine, Loader2, LockKeyhole, Plus, UserPlus, X } from 'lucide-react';
import { bookFieldStudyFollowup, enrollFieldStudyParticipant, getFieldStudyParticipant, getFieldStudySlots, listFieldStudyParticipants, saveFieldStudyBaseline, type FieldStudySlot } from '../lib/api';
import StudyBaselineForm, { emptyStudyBaselineAnswers } from '../components/StudyBaselineForm';
import type { FieldStudyBaseline, FieldStudyParticipant, FieldStudyQueueItem } from '../types/staff';
import './FieldStudiesPage.css';
import './FieldStudiesFixes.css';
import './FieldStudiesUsability.css';

const SCALE = Array.from({ length: 11 }, (_, index) => index);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
function bookedDates(sessions?: { startTime: string }[]) { return sessions?.map((session) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(session.startTime))).join(' · ') || ''; }
function monthStart(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonth(date: Date, amount: number) { return new Date(date.getFullYear(), date.getMonth() + amount, 1); }
function ymd(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function calendarDate(year: number, month: number, day: number) { return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function monthHeading(date: Date) { return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date); }
function slotTime(slot: FieldStudySlot) { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(slot.datetime)); }

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

  async function refreshQueue(includeBookings = false) { setLoadingQueue(true); try { setQueue(await listFieldStudyParticipants(includeBookings)); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not load saved participants.'); } finally { setLoadingQueue(false); } }
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
  async function refreshBookedSessions() { if (!record) return; try { const refreshed = await getFieldStudyParticipant(record.id); if (refreshed) { setRecord(refreshed); await refreshQueue(true); } } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not refresh the booked sessions.'); } }
  async function saveBaseline() { if (!record) return; if (!completeBaseline(baseline)) { setBaselineError('Enter all 6 answers and at least 1 marked body location before saving.'); return; } setSaving(true); setMessage(''); try { const saved = await saveFieldStudyBaseline(record.id, baseline); setRecord(saved); setBaselineSnapshot(JSON.stringify(baseline)); await refreshQueue(); setMessage(`Baseline saved for ${saved.paperId}.`); setView('saved'); } catch (e) { setBaselineError(e instanceof Error ? e.message : 'Could not save the baseline. Try again.'); } finally { setSaving(false); } }

  return <main className="field-study-shell"><section className="field-study-ipad">
    <header className="fs-topbar"><button type="button" onClick={() => navigate('participant')}><i />AMARI METHOD</button><div><span><LockKeyhole size={13} /> Staff view</span><time>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())}</time></div></header>
    <nav className="fs-workbar" aria-label="Field study sections"><button type="button" className={view === 'participant' ? 'selected' : ''} onClick={() => navigate('participant')}><UserPlus size={16} /> New participant</button><button type="button" className={view === 'queue' || view === 'baseline' ? 'selected' : ''} onClick={() => { navigate('queue'); refreshQueue(); }}><ClipboardList size={16} /> Paper forms to enter {pending.length > 0 && <b>{pending.length}</b>}</button><button type="button" className={view === 'saved' ? 'selected' : ''} onClick={() => { navigate('saved'); refreshQueue(true); }}><FilePenLine size={16} /> Saved participants</button></nav>
    {message && <div className="fs-message" role="status" aria-live="polite">{message}<button type="button" onClick={() => setMessage('')}>Dismiss</button></div>}
    {view === 'participant' && <section className="fs-intake"><form onSubmit={saveParticipant} className="fs-form" noValidate><div className="fs-heading"><div><p>AFTER SESSION ONE</p><h1>Finish participant record</h1><span>Fields marked * are required before saving.</span></div></div><div className="fs-study-row"><Field label="Study *" error={errors.fieldStudyKey}><select name="study" value={form.fieldStudyKey} onChange={(e) => changeForm('fieldStudyKey', e.target.value as FieldStudyKey | '')} aria-invalid={Boolean(errors.fieldStudyKey)}><option value="">Choose the paper panel…</option>{(Object.entries(FIELD_STUDIES) as Array<[FieldStudyKey, typeof FIELD_STUDIES[FieldStudyKey]]>).map(([key, study]) => <option key={key} value={key}>{study.label} — {study.note}</option>)}</select>{selectedStudy && <small>{selectedStudy.note}</small>}</Field><div className="fs-paper-id"><b>Paper form label</b><strong>{paperLabel}</strong><small>First name · study · today — matching the sheet in hand.</small></div></div><section className={errors.afterSessionOnePain ? 'fs-score has-error' : 'fs-score'}><p>After session one *</p><div><strong>Where is their pain now?</strong><small>0 = none · 10 = most intense</small>{errors.afterSessionOnePain && <em><AlertCircle size={12} /> {errors.afterSessionOnePain}</em>}</div><Scale label="After-session pain score" value={form.afterSessionOnePain} onChange={(v) => changeForm('afterSessionOnePain', v)} /></section><div className="fs-divider" /><section className="fs-details"><p>Participant details</p><div className="fs-two"><Field label="First name *" error={errors.firstName}><input name="given-name" autoComplete="given-name" value={form.firstName} onChange={(e) => changeForm('firstName', e.target.value)} aria-invalid={Boolean(errors.firstName)} /></Field><Field label="Last name *" error={errors.lastName}><input name="family-name" autoComplete="family-name" value={form.lastName} onChange={(e) => changeForm('lastName', e.target.value)} aria-invalid={Boolean(errors.lastName)} /></Field></div><div className="fs-two"><Field label="Mobile *" error={errors.phone}><input name="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => changeForm('phone', formatPhone(e.target.value))} aria-invalid={Boolean(errors.phone)} placeholder="(415) 555-0123" /></Field><Field label="Email *" error={errors.email}><input name="email" autoComplete="email" type="email" spellCheck={false} value={form.email} onChange={(e) => changeForm('email', e.target.value.trimStart())} aria-invalid={Boolean(errors.email)} placeholder="name@example.com" /></Field></div><label className="fs-consent"><input type="checkbox" checked={form.canUseFirstName} onChange={(e) => changeForm('canUseFirstName', e.target.checked)} /> <span>May we use their first name in study notes? <em>Optional</em></span></label></section><div className="fs-footer"><small>The 6 baseline answers stay on paper. Enter them once the participant has left.</small><button type="submit" disabled={saving}>{saving ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : <>Save participant <ArrowRight size={17} /></>}</button></div>{record && <section className="fs-success" aria-live="polite"><div><Check size={20} /><span><b>{record.paperId} saved</b><small>Participant record, Study Name, field-table tag & session 1 are recorded.</small>{record.bookingStatus === 'loaded' && <small className="fs-booked-summary">{record.bookedSessions?.length ? `Sessions 2 & 3: ${bookedDates(record.bookedSessions)}` : 'No follow-up sessions booked yet.'}</small>}</span></div><div className="fs-success-action"><span>{calendarOpened ? 'Amari calendar opened — book sessions 2 & 3, then close it to refresh these dates.' : 'Next: book sessions 2 & 3.'}</span><button type="button" onClick={() => { setCalendarOpened(true); setCalendarOpen(true); }}>Open Amari calendar <ExternalLink size={14} /></button></div></section>}</form></section>}
    {view === 'queue' && <ParticipantList title="Paper forms to enter" eyebrow="BETWEEN PARTICIPANTS" description="Match the first name · study · date label on the physical sheet, then copy its 6 answers and body-map notes." items={pending} loading={loadingQueue} empty="No paper baselines waiting." action="Enter paper form" onNew={() => navigate('participant')} onOpen={openPaper} />}
    {view === 'saved' && <ParticipantList title="Saved participants" eyebrow="FIELD STUDY RECORDS" description="Every participant saved through the table flow. Open any record to review or complete its paper baseline." items={queue} loading={loadingQueue} empty="No participants saved yet." action="Open record" onNew={() => navigate('participant')} onOpen={openPaper} showStatus />}
    {view === 'baseline' && record && <section className="fs-baseline"><button type="button" className="fs-back" onClick={() => navigate('queue')}><ArrowLeft size={16} /> Back to paper forms</button><header><div><p>COPYING FROM PAPER / {record.paperId}</p><h1>Enter {record.firstName}'s paper form</h1><span>Copy all 6 answers and at least 1 marked body location exactly as they appear on the sheet.</span></div><aside><b>Match the sheet</b><span>{record.studyLabel || record.studyName}</span></aside></header>{baselineError && <div className="fs-inline-error" role="alert"><AlertCircle size={15} /> {baselineError}</div>}<StudyBaselineForm value={baseline} onChange={(next) => { setBaseline((p) => ({ ...p, ...next })); setBaselineError(''); }} bodyMapHeading="Paper body map" /><footer><span>Saving clears this person from the pending queue.</span><button type="button" onClick={saveBaseline} disabled={saving}>{saving ? <><Loader2 size={17} className="animate-spin" /> Saving…</> : <>Save baseline entry <Check size={17} /></>}</button></footer></section>}
  </section>{calendarOpen && record && <CalendarModal record={record} onClose={async () => { setCalendarOpen(false); await refreshBookedSessions(); }} />}</main>;
}

function ParticipantList({ title, eyebrow, description, items, loading, empty, action, onNew, onOpen, showStatus = false }: { title: string; eyebrow: string; description: string; items: FieldStudyQueueItem[]; loading: boolean; empty: string; action: string; onNew: () => void; onOpen: (id: string) => void; showStatus?: boolean }) { return <section className="fs-queue"><header><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div><button type="button" onClick={onNew}><Plus size={17} /> New participant</button></header><div className="fs-key"><span>{items.length} participant{items.length === 1 ? '' : 's'}</span>{showStatus && <small>Booking dates are live from the Amari Study calendar.</small>}</div>{loading ? <Loader2 className="fs-loader animate-spin" /> : items.length === 0 ? <div className="fs-empty">{empty}</div> : <div className="fs-list">{items.map((item) => <article key={item.id}><code>{item.paperId}</code><div><p>{item.studyLabel || item.studyName}</p><h2>{item.firstName}</h2><span>After session: {item.afterSessionOnePain}/10</span>{showStatus && <span className="fs-booked-date">{item.bookingStatus === 'unavailable' ? 'Could not check booked sessions' : item.bookedSessions?.length ? `Sessions 2 & 3: ${bookedDates(item.bookedSessions)}` : 'No follow-up sessions booked yet'}</span>}</div>{showStatus ? <em className={item.baselineCapturedAt ? 'complete' : ''}><i /> {item.baselineCapturedAt ? 'Baseline entered' : 'Paper waiting'}</em> : <em><i /> Paper waiting</em>}<button type="button" onClick={() => onOpen(item.id)}>{showStatus && !item.baselineCapturedAt ? 'Enter paper form' : action} <ArrowRight size={16} /></button></article>)}</div>}</section>; }
function CalendarModal({ record, onClose }: { record: FieldStudyParticipant; onClose: () => void | Promise<void> }) {
  const timezone = 'America/Los_Angeles';
  const [month, setMonth] = useState(monthStart);
  const [slots, setSlots] = useState<FieldStudySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<FieldStudySlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [booked, setBooked] = useState<string[]>([]);
  const startDate = ymd(month);
  const endDate = ymd(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const today = ymd(new Date());
  const availableDates = useMemo(() => new Set(slots.map((slot) => slot.date)), [slots]);
  const times = selectedDate ? slots.filter((slot) => slot.date === selectedDate) : [];
  const sessionLabel = booked.length === 0 ? 'session 2' : 'session 3';

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setSelectedDate(null); setSelectedSlot(null);
    getFieldStudySlots(record.id, startDate, endDate, timezone)
      .then((next) => { if (!cancelled) setSlots(next); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load available study times.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [record.id, startDate, endDate]);

  async function bookSelectedSlot() {
    if (!selectedSlot || submitting) return;
    setSubmitting(true); setError('');
    try {
      const result = await bookFieldStudyFollowup(record.id, selectedSlot.datetime, timezone, crypto.randomUUID());
      setBooked((current) => [...current, result.appointment.startTime]);
      setSlots((current) => current.filter((slot) => slot.datetime !== selectedSlot.datetime));
      setSelectedDate(null); setSelectedSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book that time. Choose another one.');
    } finally { setSubmitting(false); }
  }

  const firstDay = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return <div className="fs-calendar" role="dialog" aria-modal="true" aria-label="Book study sessions">
    <div className="fs-calendar-scrim" onClick={() => { if (!submitting) void onClose(); }} />
    <section className="fs-native-calendar">
      <header className="fs-native-close"><span>AMARI METHOD</span><button type="button" onClick={() => { if (!submitting) void onClose(); }} aria-label="Close calendar"><X size={18} /></button></header>
      <div className="fs-cal-intro"><p>STUDY SESSIONS · SAN FRANCISCO</p><h2>Book the <em>next session.</em></h2><span>Choose a 15-minute follow-up with Garrett for {record.firstName}.</span></div>
      <div className="fs-cal-progress" aria-label="Booking progress"><span className="active"><i>01</i> Pick a time</span><b /><span className={booked.length >= 1 ? 'active' : ''}><i>02</i> Session 2</span><b /><span className={booked.length >= 2 ? 'active' : ''}><i>03</i> Session 3</span></div>
      {booked.length > 0 && <div className="fs-calendar-booked" role="status"><Check size={15} /> {booked.map((date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(date))).join(' · ') } booked</div>}
      {error && <div className="fs-calendar-error" role="alert">{error}</div>}
      {booked.length >= 2 ? <div className="fs-calendar-complete"><p>Both follow-up sessions are booked.</p><button type="button" onClick={() => { void onClose(); }}>Done <ArrowRight size={16} /></button></div> : <>
        <div className="fs-single-month"><header><button type="button" aria-label="Previous month" disabled={month <= monthStart()} onClick={() => setMonth((current) => addMonth(current, -1))}>‹</button><h3>{monthHeading(month)}</h3><button type="button" aria-label="Next month" onClick={() => setMonth((current) => addMonth(current, 1))}>›</button></header><div className="fs-cal-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className="fs-cal-days">{Array.from({ length: firstDay }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const day = index + 1; const date = calendarDate(month.getFullYear(), month.getMonth(), day); const disabled = loading || date < today || !availableDates.has(date); return <button key={date} type="button" disabled={disabled} className={`${date === selectedDate ? 'selected ' : ''}${date === today ? 'today ' : ''}${disabled ? 'unavailable' : ''}`} onClick={() => { setSelectedDate(date); setSelectedSlot(null); }}>{day}{!disabled && date !== selectedDate && <i />}</button>; })}</div></div>
        <div className="fs-calendar-times">{loading ? <p>Loading available times…</p> : selectedDate ? <><p>Times for <strong>{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${selectedDate}T12:00:00`))}</strong></p><div>{times.map((slot) => <button type="button" key={slot.datetime} className={selectedSlot?.datetime === slot.datetime ? 'selected' : ''} onClick={() => setSelectedSlot(slot)}>{slotTime(slot)}</button>)}</div></> : <p>Choose a date to see available times.</p>}</div>
        <footer className="fs-calendar-action"><span>{selectedSlot ? `${sessionLabel[0].toUpperCase()}${sessionLabel.slice(1)}: ${slotTime(selectedSlot)}` : 'Pick a time to continue'}</span><button type="button" disabled={!selectedSlot || submitting} onClick={bookSelectedSlot}>{submitting ? 'Booking…' : `Book ${sessionLabel}`} <ArrowRight size={16} /></button></footer>
      </>}
    </section>
  </div>;
}
