import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, Loader2, TriangleAlert, X } from 'lucide-react';
import {
  ApiError,
  changeStaffAppointment,
  getStaffAppointmentAvailability,
  type StaffAppointmentCommandResult,
  type StaffAppointmentSlot,
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

interface Props {
  appointment: ManageableAppointment;
  onClose: () => void;
  onChanged: (result: StaffAppointmentCommandResult) => void;
  onUnauthorized?: () => void;
}

type Step = 'choose' | 'reschedule' | 'cancel' | 'success';

function pacificDate(value: Date): string {
  return value.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateTime(value: string): string {
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

function actionKey(appointmentId: string, action: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${action}:${appointmentId}:${id}`;
}

export default function ManageAppointmentSheet({ appointment, onClose, onChanged, onUnauthorized }: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [slots, setSlots] = useState<StaffAppointmentSlot[]>([]);
  const [selected, setSelected] = useState<StaffAppointmentSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StaffAppointmentCommandResult | null>(null);
  const rescheduleKey = useRef(actionKey(appointment.id, 'reschedule'));
  const cancelKey = useRef(actionKey(appointment.id, 'cancel'));
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose, saving]);

  async function loadAvailability() {
    setStep('reschedule');
    setLoading(true);
    setError('');
    setSelected(null);
    setSelectedDate(null);
    const today = new Date();
    try {
      const response = await getStaffAppointmentAvailability({
        contactId: appointment.contactId,
        appointmentId: appointment.id,
        startDate: pacificDate(today),
        endDate: pacificDate(addDays(today, 32)),
      });
      setSlots(response.slots);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized?.();
      setError(caught instanceof Error ? caught.message : 'Garrett’s availability could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function submit(action: 'cancel' | 'reschedule') {
    if (action === 'reschedule' && !selected) return;
    setSaving(true);
    setError('');
    try {
      const completed = await changeStaffAppointment({
        action,
        contactId: appointment.contactId,
        appointmentId: appointment.id,
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

  return (
    <div className="appointment-manage" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !saving) onClose();
    }}>
      <section className="appointment-manage__sheet" role="dialog" aria-modal="true" aria-labelledby="appointment-manage-title" onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])')];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <header className="appointment-manage__head">
          <div>
            <span>Appointment control</span>
            <h2 id="appointment-manage-title">{step === 'success' ? 'Calendar updated' : appointment.contactName}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={saving} aria-label="Close appointment control"><X /></button>
        </header>

        {step !== 'success' && (
          <div className="appointment-manage__current">
            <CalendarClock aria-hidden="true" />
            <div><b>{appointment.title}</b><span>{formatDateTime(appointment.startTime)}</span></div>
          </div>
        )}

        {error && <div className="appointment-manage__error" role="alert"><TriangleAlert />{error}</div>}

        {step === 'choose' && (
          <div className="appointment-manage__choices">
            <button type="button" onClick={loadAvailability}>
              <b>Choose a new time</b>
              <span>See every collision-free time in Garrett’s internal schedule.</span>
            </button>
            <button type="button" className="is-danger" onClick={() => { setError(''); setStep('cancel'); }}>
              <b>Cancel appointment</b>
              <span>Keep the client record and mark this visit cancelled.</span>
            </button>
          </div>
        )}

        {step === 'reschedule' && (
          <div className="appointment-manage__body">
            <button type="button" className="appointment-manage__back" onClick={() => setStep('choose')} disabled={saving}><ChevronLeft />Back</button>
            <div className="appointment-manage__scope">
              <b>Garrett’s internal availability</b>
              <span>All open 15-minute starts are shown. Public booking filters are not applied.</span>
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
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>Keep current time</button>
              <button type="button" className="primary" onClick={() => submit('reschedule')} disabled={!selected || saving}>
                {saving ? <><Loader2 className="appointment-manage__spin" />Moving…</> : 'Move appointment'}
              </button>
            </footer>
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
              <button type="button" className="danger" onClick={() => submit('cancel')} disabled={saving}>
                {saving ? <><Loader2 className="appointment-manage__spin" />Cancelling…</> : 'Cancel appointment'}
              </button>
            </footer>
          </div>
        )}

        {step === 'success' && result && (
          <div className="appointment-manage__success">
            <Check aria-hidden="true" />
            <h3>{result.action === 'cancel' ? 'Appointment cancelled' : 'Appointment moved'}</h3>
            <p>{result.action === 'reschedule' && result.newStartTime
              ? `${formatDateTime(result.previousStartTime)} → ${formatDateTime(result.newStartTime)}`
              : formatDateTime(result.previousStartTime)}</p>
            <span>The provider state was read back and verified. Existing reminder and cancellation lifecycle owners were left unchanged.</span>
            <button type="button" onClick={onClose}>Done</button>
          </div>
        )}
      </section>
    </div>
  );
}
