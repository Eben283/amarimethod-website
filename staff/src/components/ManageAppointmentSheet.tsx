import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, Loader2, Search, TriangleAlert, UserRound, X } from 'lucide-react';
import {
  ApiError,
  changeStaffAppointment,
  getStaffAppointmentAvailability,
  getStaffAppointmentTypes,
  scheduleStaffAppointment,
  searchOwnedContacts,
  type OwnedContactSearchItem,
  type StaffAppointmentCommandResult,
  type StaffAppointmentSlot,
  type StaffAppointmentType,
} from '../lib/api';
import { AmariMonthGrid, AmariTimeSlots } from '@amari/calendar';
import '../../../css/amari-calendar.css';
import '../styles/appointment-manage.css';

export interface ManageableAppointment {
  id: string;
  contactId: string;
  contactName: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

export interface AppointmentPerson {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

interface Props {
  appointment?: ManageableAppointment;
  person?: AppointmentPerson;
  initialMode?: 'schedule' | 'manage';
  onClose: () => void;
  onChanged: (result: StaffAppointmentCommandResult) => void;
  onUnauthorized?: () => void;
}

type Step = 'choose' | 'person' | 'service' | 'time' | 'cancel' | 'success';

function pacificDate(value: Date): string {
  return value.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateTime(value?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function formatDay(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
  });
}

function actionKey(subjectId: string, action: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${action}:${subjectId}:${id}`;
}

export default function ManageAppointmentSheet({ appointment, person, initialMode, onClose, onChanged, onUnauthorized }: Props) {
  const scheduling = initialMode === 'schedule' || !appointment;
  const seededPerson = person || (appointment ? { id: appointment.contactId, name: appointment.contactName } : null);
  const [step, setStep] = useState<Step>(() => scheduling ? (seededPerson ? 'service' : 'person') : 'choose');
  const [selectedPerson, setSelectedPerson] = useState<AppointmentPerson | null>(seededPerson);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<OwnedContactSearchItem[]>([]);
  const [types, setTypes] = useState<StaffAppointmentType[]>([]);
  const [selectedType, setSelectedType] = useState<StaffAppointmentType | null>(null);
  const [slots, setSlots] = useState<StaffAppointmentSlot[]>([]);
  const [selected, setSelected] = useState<StaffAppointmentSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StaffAppointmentCommandResult | null>(null);
  const scheduleKey = useRef(actionKey('new', 'schedule'));
  const rescheduleKey = useRef(actionKey(appointment?.id || 'new', 'reschedule'));
  const cancelKey = useRef(actionKey(appointment?.id || 'new', 'cancel'));
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose, saving]);

  useEffect(() => {
    if (!scheduling) return;
    let active = true;
    setLoading(true);
    getStaffAppointmentTypes()
      .then((response) => { if (active) setTypes(response.types); })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) onUnauthorized?.();
        setError(caught instanceof Error ? caught.message : 'Appointment types could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onUnauthorized, scheduling]);

  async function findPeople() {
    const clean = query.trim();
    if (clean.length < 2) { setError('Enter at least two characters.'); return; }
    setLoading(true);
    setError('');
    try {
      setMatches(await searchOwnedContacts(clean));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized?.();
      setError(caught instanceof Error ? caught.message : 'People could not be searched.');
    } finally {
      setLoading(false);
    }
  }

  function resetTime() {
    setSlots([]);
    setSelected(null);
    setSelectedDate(null);
    setCalendarCursor(new Date());
  }

  async function loadAvailability(mode: 'schedule' | 'reschedule') {
    if (mode === 'schedule' && (!selectedPerson || !selectedType)) return;
    if (mode === 'reschedule' && !appointment) return;
    setStep('time');
    setLoading(true);
    setError('');
    resetTime();
    const today = new Date();
    try {
      const response = await getStaffAppointmentAvailability({
        contactId: mode === 'reschedule' ? appointment?.contactId : selectedPerson?.id,
        appointmentId: mode === 'reschedule' ? appointment?.id : undefined,
        sessionType: mode === 'schedule' ? selectedType?.id : undefined,
        startDate: pacificDate(today),
        endDate: pacificDate(addDays(today, 32)),
      });
      setSlots(response.slots);
      if (mode === 'schedule') scheduleKey.current = actionKey(selectedPerson?.id || 'unknown', 'schedule');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized?.();
      setError(caught instanceof Error ? caught.message : 'Garrett’s availability could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function submit(action: 'schedule' | 'cancel' | 'reschedule') {
    if ((action === 'schedule' || action === 'reschedule') && !selected) return;
    if (action === 'schedule' && (!selectedPerson || !selectedType)) return;
    if (action !== 'schedule' && !appointment) return;
    setSaving(true);
    setError('');
    try {
      const completed = action === 'schedule'
        ? await scheduleStaffAppointment({
          contactId: selectedPerson!.id,
          sessionType: selectedType!.id,
          startTime: selected!.datetime,
          idempotencyKey: scheduleKey.current,
        })
        : await changeStaffAppointment({
          action,
          contactId: appointment!.contactId,
          appointmentId: appointment!.id,
          idempotencyKey: action === 'cancel' ? cancelKey.current : rescheduleKey.current,
          startTime: selected?.datetime,
        });
      setResult(completed);
      setStep('success');
      onChanged(completed);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized?.();
      setError(caught instanceof Error ? caught.message : 'The appointment was not changed.');
    } finally {
      setSaving(false);
    }
  }

  const availableDates = useMemo(() => new Set(slots.map((slot) => slot.date)), [slots]);
  const selectedDaySlots = useMemo(() => slots.filter((slot) => slot.date === selectedDate), [slots, selectedDate]);
  const todayYmd = pacificDate(new Date());
  const rangeEndYmd = pacificDate(addDays(new Date(), 32));
  const firstMonth = Number(todayYmd.slice(0, 4)) * 12 + Number(todayYmd.slice(5, 7));
  const lastMonth = Number(rangeEndYmd.slice(0, 4)) * 12 + Number(rangeEndYmd.slice(5, 7));
  const cursorMonth = calendarCursor.getFullYear() * 12 + calendarCursor.getMonth() + 1;
  const timeMode: 'schedule' | 'reschedule' = scheduling ? 'schedule' : 'reschedule';

  function backFromTime() {
    setError('');
    setStep(scheduling ? 'service' : 'choose');
  }

  return (
    <div className="appointment-manage" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !saving) onClose();
    }}>
      <section className="appointment-manage__sheet" role="dialog" aria-modal="true" aria-labelledby="appointment-manage-title" onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])')];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <header className="appointment-manage__head">
          <div>
            <span>Appointment manager</span>
            <h2 id="appointment-manage-title">{step === 'success' ? 'Calendar updated' : scheduling ? 'Schedule an appointment' : appointment?.contactName}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={saving} aria-label="Close appointment manager"><X /></button>
        </header>

        {appointment && step !== 'success' && (
          <div className="appointment-manage__current">
            <CalendarClock aria-hidden="true" />
            <div><b>{appointment.title}</b><span>{formatDateTime(appointment.startTime)}</span></div>
          </div>
        )}
        {scheduling && selectedPerson && step !== 'person' && step !== 'success' && (
          <div className="appointment-manage__current">
            <UserRound aria-hidden="true" />
            <div><b>{selectedPerson.name}</b><span>{selectedPerson.email || selectedPerson.phone || 'Practice member'}</span></div>
          </div>
        )}

        {error && <div className="appointment-manage__error" role="alert"><TriangleAlert />{error}</div>}

        {step === 'choose' && (
          <div className="appointment-manage__choices">
            <button type="button" onClick={() => void loadAvailability('reschedule')}>
              <b>Choose a new time</b>
              <span>Use the same internal calendar as new scheduling.</span>
            </button>
            <button type="button" className="is-danger" onClick={() => { setError(''); setStep('cancel'); }}>
              <b>Cancel appointment</b>
              <span>Keep the client record and mark this visit cancelled.</span>
            </button>
          </div>
        )}

        {step === 'person' && (
          <div className="appointment-manage__body">
            <div className="appointment-manage__scope"><b>Who is coming?</b><span>Search the owned person record before choosing the visit.</span></div>
            <form className="appointment-manage__search" onSubmit={(event) => { event.preventDefault(); void findPeople(); }}>
              <label><Search aria-hidden="true" /><span className="sr-only">Search people</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or phone" autoFocus /></label>
              <button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Find person'}</button>
            </form>
            <div className="appointment-manage__people">
              {matches.map((match) => (
                <button key={match.id} type="button" onClick={() => {
                  setSelectedPerson(match);
                  setError('');
                  setStep('service');
                }}>
                  <b>{match.name}</b><span>{match.email || match.phone || 'No contact details'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'service' && (
          <div className="appointment-manage__body">
            {!person && <button type="button" className="appointment-manage__back" onClick={() => setStep('person')}><ChevronLeft />Change person</button>}
            <div className="appointment-manage__scope"><b>What are they booking?</b><span>The service controls duration and the existing confirmation/reminder lifecycle.</span></div>
            {loading && types.length === 0 ? <div className="appointment-manage__loading"><Loader2 className="appointment-manage__spin" />Loading appointment types…</div> : (
              <div className="appointment-manage__services">
                {types.map((type) => (
                  <button key={type.id} type="button" className={selectedType?.id === type.id ? 'is-selected' : ''} onClick={() => { setSelectedType(type); resetTime(); }}>
                    <b>{type.label}</b><span>{type.durationMinutes} minutes</span>
                  </button>
                ))}
              </div>
            )}
            <footer className="appointment-manage__actions">
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" onClick={() => void loadAvailability('schedule')} disabled={!selectedType || loading}>Choose time</button>
            </footer>
          </div>
        )}

        {step === 'time' && (
          <div className="appointment-manage__body">
            <button type="button" className="appointment-manage__back" onClick={backFromTime} disabled={saving}><ChevronLeft />Back</button>
            <div className="appointment-manage__scope">
              <b>Garrett’s internal availability</b>
              <span>Every collision-free 15-minute start is shown. Public booking filters are not applied.</span>
            </div>
            {loading ? (
              <div className="appointment-manage__loading"><Loader2 className="appointment-manage__spin" />Checking the real calendar…</div>
            ) : slots.length === 0 && !error ? (
              <p className="appointment-manage__empty">No collision-free times in the next 32 days.</p>
            ) : (
              <div className="appointment-manage__calendar">
                <AmariMonthGrid
                  year={calendarCursor.getFullYear()}
                  month={calendarCursor.getMonth()}
                  selectedDate={selectedDate}
                  availableDates={availableDates}
                  minDate={todayYmd}
                  prevDisabled={cursorMonth <= firstMonth}
                  nextDisabled={cursorMonth >= lastMonth}
                  onPrevMonth={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1))}
                  onNextMonth={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1))}
                  onSelectDate={(date) => { setSelectedDate(date); setSelected(null); }}
                />
                {selectedDate && (
                  <AmariTimeSlots
                    dateLabel={formatDay(selectedDate)}
                    slots={selectedDaySlots.map((slot) => ({ id: slot.datetime, label: formatTime(slot.datetime) }))}
                    selectedId={selected?.datetime || null}
                    onSelect={(id) => setSelected(selectedDaySlots.find((slot) => slot.datetime === id) || null)}
                  />
                )}
              </div>
            )}
            <footer className="appointment-manage__actions">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>{scheduling ? 'Cancel' : 'Keep current time'}</button>
              <button type="button" className="primary" onClick={() => void submit(timeMode)} disabled={!selected || saving}>
                {saving ? <><Loader2 className="appointment-manage__spin" />Saving…</> : scheduling ? 'Schedule appointment' : 'Move appointment'}
              </button>
            </footer>
            <p className="appointment-manage__lifecycle">The calendar’s existing confirmation and reminder lifecycle remains responsible for what the person receives. This does not send a separate Staff reply.</p>
          </div>
        )}

        {step === 'cancel' && (
          <div className="appointment-manage__body">
            <button type="button" className="appointment-manage__back" onClick={() => setStep('choose')} disabled={saving}><ChevronLeft />Back</button>
            <div className="appointment-manage__warning">
              <b>Cancel this appointment?</b>
              <p>The existing calendar lifecycle may send or suppress its configured cancellation and reminder notices. This does not send a separate Staff reply.</p>
            </div>
            <footer className="appointment-manage__actions">
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>Keep appointment</button>
              <button type="button" className="danger" onClick={() => void submit('cancel')} disabled={saving}>
                {saving ? <><Loader2 className="appointment-manage__spin" />Cancelling…</> : 'Cancel appointment'}
              </button>
            </footer>
          </div>
        )}

        {step === 'success' && result && (
          <div className="appointment-manage__success">
            <Check aria-hidden="true" />
            <h3>{result.action === 'cancel' ? 'Appointment cancelled' : result.action === 'schedule' ? 'Appointment scheduled' : 'Appointment moved'}</h3>
            <p>{result.action === 'reschedule' && result.newStartTime
              ? `${formatDateTime(result.previousStartTime)} → ${formatDateTime(result.newStartTime)}`
              : formatDateTime(result.newStartTime || result.previousStartTime)}</p>
            <span>The provider state was read back and verified. Existing reminder and cancellation lifecycle owners were left unchanged.</span>
            <button type="button" onClick={onClose}>Done</button>
          </div>
        )}
      </section>
    </div>
  );
}
