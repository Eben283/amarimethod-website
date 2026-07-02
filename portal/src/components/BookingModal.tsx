import { useState, useEffect, useCallback, useRef } from 'react';
import { getAvailableSlots, bookAppointment, cancelAppointment } from '../lib/api';
import type { Appointment } from '../types/portal';

// Calendar IDs
const CALENDARS = {
  followup_inperson: 'ZO1jlGfy01rsxVqicoSB',
  followup_virtual:  'bJFkhVP35Ecwh4tLnSmy',
};

type SessionType = 'in-person' | 'virtual';
type ModalStep = 'select' | 'loading' | 'confirm' | 'success' | 'error';

interface Slot {
  date: string;       // "YYYY-MM-DD"
  time: string;       // "HH:MM"
  hour: number;
  minute: number;
  datetime: string;   // "YYYY-MM-DDThh:mm:ss"
}

interface BookingModalProps {
  onClose: () => void;
  /** If set, this is a reschedule — old appointment is cancelled after the new one books. */
  rescheduleFor?: Appointment | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute === 0 ? '00' : String(minute).padStart(2, '0');
  return `${h}:${m} ${period}`;
}

function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function BookingModal({ onClose, rescheduleFor }: BookingModalProps) {
  const [sessionType, setSessionType] = useState<SessionType>('in-person');
  const [step, setStep] = useState<ModalStep>('select');

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  // One key per confirm attempt — resets when the selected slot changes so
  // picking a different slot can never replay a cached booking.
  const idempotencyKeyRef = useRef<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bookedTitle, setBookedTitle] = useState<string>('');
  const [rescheduleCancelFailed, setRescheduleCancelFailed] = useState(false);

  const timezone = getUserTimezone();

  const fetchSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedDate(null);
    setSelectedSlot(null);

    const calendarId = sessionType === 'in-person'
      ? CALENDARS.followup_inperson
      : CALENDARS.followup_virtual;

    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay  = new Date(calYear, calMonth + 1, 0);
    const startDate = toYMD(firstDay);
    const endDate   = toYMD(lastDay);

    try {
      const data = await getAvailableSlots(calendarId, startDate, endDate, timezone);
      setSlots(data.slots ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load available times';
      setSlotsError(msg);
    } finally {
      setSlotsLoading(false);
    }
  }, [sessionType, calYear, calMonth, timezone]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  // Don't let the user dismiss the modal while a booking is in flight — the
  // request continues server-side, so an abandoned modal can leave them
  // re-booking a slot that actually succeeded (duplicate sessions).
  const requestClose = useCallback(() => {
    if (step === 'loading') return;
    onClose();
  }, [step, onClose]);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const availableDates = new Set(slots.map((s) => s.date));
  const slotsForDate = selectedDate
    ? slots.filter((s) => s.date === selectedDate).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    : [];

  const firstOfMonth = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = firstOfMonth.getDay();
  const todayYMD = toYMD(today);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else { setCalMonth(m => m - 1); }
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else { setCalMonth(m => m + 1); }
  }

  const isPrevDisabled = calYear === today.getFullYear() && calMonth <= today.getMonth();

  async function handleConfirm() {
    if (!selectedSlot) return;
    setStep('loading');

    // Generate a key on the first attempt; reuse it on retries so duplicate
    // submits return the already-created appointment instead of double-booking.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    const calendarId = sessionType === 'in-person'
      ? CALENDARS.followup_inperson
      : CALENDARS.followup_virtual;

    try {
      const result = await bookAppointment({
        calendarId,
        startTime: selectedSlot.datetime,
        timezone,
        sessionType,
        idempotencyKey: idempotencyKeyRef.current,
      });
      // If this is a reschedule, cancel the original after the new one books.
      // Doing it in this order means a failed cancel still leaves the user
      // with the new session booked, never with zero sessions.
      if (rescheduleFor) {
        try {
          await cancelAppointment(rescheduleFor.id, rescheduleFor.title || 'Session');
        } catch {
          // One retry — the 15s client timeout makes transient failures real.
          try {
            await cancelAppointment(rescheduleFor.id, rescheduleFor.title || 'Session');
          } catch (cancelErr) {
            // Don't block — the new booking succeeded — but SAY so: the old
            // console.warn-only path showed a full success screen while the
            // client was double-booked and the old slot kept firing reminders.
            console.warn('Failed to cancel original session during reschedule', cancelErr);
            setRescheduleCancelFailed(true);
          }
        }
      }
      setBookedTitle(result.appointment.title);
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed. Please try again.';
      setErrorMsg(msg);
      setStep('error');
    }
  }

  function renderCalendarCells() {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < startDow; i++) {
      cells.push(<div key={`empty-${i}`} className="cp-cal-empty" />);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = ymd < todayYMD;
      const hasSlots = availableDates.has(ymd);
      const isSelected = ymd === selectedDate;
      const isToday = ymd === todayYMD;
      const disabled = isPast || !hasSlots || slotsLoading;
      const cls = ['cp-cal-day'];
      if (isSelected) cls.push('is-selected');
      if (isToday && !isSelected) cls.push('is-today');
      if (hasSlots && !isPast) cls.push('has-slots');
      if (disabled) cls.push('is-disabled');
      cells.push(
        <button
          key={ymd}
          data-testid={`calendar-day-${ymd}`}
          disabled={disabled}
          onClick={() => { setSelectedDate(ymd); setSelectedSlot(null); }}
          className={cls.join(' ')}
        >
          <span>{d}</span>
          {hasSlots && !isPast && !isSelected && <span className="cp-cal-dot" aria-hidden="true" />}
        </button>
      );
    }
    return cells;
  }

  return (
    <div className="cp-screen cp-with-modal" style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div className="cp-modal-scrim" onClick={requestClose} aria-hidden="true" />
      <div className="cp-modal cp-modal-sm" role="dialog" aria-label="Book a session">
        <header className="cp-modal-head">
          <div>
            <span className="cp-mono">{rescheduleFor ? 'Reschedule' : 'Book a session'}</span>
            <h2 className="cp-modal-title">
              {rescheduleFor
                ? <>Pick a <em>new time.</em></>
                : <>Find a time <em>that works.</em></>}
            </h2>
          </div>
          <button type="button" className="cp-modal-close" aria-label="Close" onClick={requestClose} disabled={step === 'loading'}>✕</button>
        </header>

        <div className="cp-modal-body">

          {/* Success */}
          {step === 'success' && (
            <div data-testid="booking-success-screen" className="cp-bm-success">
              <div className="cp-bm-glyph">✦</div>
              <h3 className="cp-bm-success-h">You're <em>booked.</em></h3>
              <p className="cp-bm-success-p">{bookedTitle}</p>
              <p className="cp-bm-success-meta">
                {selectedSlot && formatDateDisplay(selectedSlot.date)} at {selectedSlot && formatTime(selectedSlot.hour, selectedSlot.minute)}
              </p>
              <p className="cp-bm-success-fine">A confirmation email is on its way.</p>
              {rescheduleCancelFailed && (
                <p className="cp-bm-success-fine" data-testid="reschedule-cancel-warning" style={{ color: 'var(--cp-accent, #b3541e)', marginTop: 8 }}>
                  One thing: we couldn't release your original session, so it may
                  still appear on your schedule. You can cancel it from the
                  dashboard, or we'll take care of it.
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div data-testid="booking-error-screen" className="cp-bm-error">
              <span className="cp-mono cp-accent">Something went wrong</span>
              <h3 className="cp-bm-error-h">We couldn't <em>book that time.</em></h3>
              <p className="cp-bm-error-p">{errorMsg}</p>
            </div>
          )}

          {/* Loading (submitting) */}
          {step === 'loading' && (
            <div className="cp-bm-loading">
              <span className="cp-verify-spinner" aria-hidden="true"></span>
              <p>Booking your session…</p>
            </div>
          )}

          {/* Confirm */}
          {step === 'confirm' && selectedSlot && (
            <div className="cp-bm-confirm">
              <span className="cp-mono cp-accent">Confirm</span>
              <h3 className="cp-bm-confirm-h">
                {sessionType === 'in-person' ? 'Follow-up · In person' : 'Follow-up · Virtual'}
              </h3>
              <div className="cp-bm-confirm-meta">
                <div><span className="cp-mono">Date</span><b>{formatDateDisplay(selectedSlot.date)}</b></div>
                <div><span className="cp-mono">Time</span><b><em>{formatTime(selectedSlot.hour, selectedSlot.minute)}</em></b></div>
                <div><span className="cp-mono">Timezone</span><b>{timezone.replace(/_/g, ' ')}</b></div>
              </div>
              {sessionType === 'virtual' && (
                <p className="cp-bm-note">A Google Meet link will be emailed and added to your calendar invite.</p>
              )}
            </div>
          )}

          {/* Select date/time */}
          {step === 'select' && (
            <>
              {/* Session type segmented toggle */}
              <div className="cp-segmented" role="tablist">
                {(['in-person', 'virtual'] as SessionType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={sessionType === type}
                    onClick={() => setSessionType(type)}
                    className={'cp-segmented-btn' + (sessionType === type ? ' is-on' : '')}
                  >
                    {type === 'in-person' ? 'In person' : 'Virtual'}
                  </button>
                ))}
              </div>

              {/* Calendar */}
              <div className="cp-cal">
                <div className="cp-cal-head">
                  <button
                    type="button"
                    data-testid="prev-month-btn"
                    onClick={prevMonth}
                    disabled={isPrevDisabled}
                    className="cp-cal-nav"
                    aria-label="Previous month"
                  >
                    <span className="cp-arrow cp-arrow-l">←</span>
                  </button>
                  <span data-testid="calendar-month-label" className="cp-cal-month">
                    {MONTHS[calMonth]} {calYear}
                  </span>
                  <button
                    type="button"
                    data-testid="next-month-btn"
                    onClick={nextMonth}
                    className="cp-cal-nav"
                    aria-label="Next month"
                  >
                    <span className="cp-arrow">→</span>
                  </button>
                </div>

                <div className="cp-cal-dows">
                  {DAYS.map((d) => <span key={d}>{d}</span>)}
                </div>

                {slotsLoading ? (
                  <div className="cp-cal-loading">
                    <span className="cp-verify-spinner" aria-hidden="true"></span>
                  </div>
                ) : slotsError ? (
                  <div className="cp-cal-err">
                    <p>{slotsError}</p>
                    <button type="button" onClick={fetchSlots} className="cp-btn cp-btn-ghost cp-btn-row">Try again</button>
                  </div>
                ) : (
                  <div data-testid="calendar-grid" className="cp-cal-grid">
                    {renderCalendarCells()}
                  </div>
                )}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div className="cp-bm-times">
                  <span className="cp-mono cp-accent">{formatDateDisplay(selectedDate)}</span>
                  {slotsForDate.length === 0 ? (
                    <p className="cp-bm-empty">No times available for this date.</p>
                  ) : (
                    <div className="cp-bm-times-grid">
                      {slotsForDate.map((slot) => {
                        const isSelected = selectedSlot?.datetime === slot.datetime;
                        return (
                          <button
                            key={slot.datetime}
                            type="button"
                            onClick={() => { setSelectedSlot(slot); idempotencyKeyRef.current = null; }}
                            className={'cp-slot' + (isSelected ? ' is-picked' : '')}
                          >
                            {formatTime(slot.hour, slot.minute)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="cp-modal-foot">
          {step === 'select' && (
            <>
              <button type="button" className="cp-btn cp-btn-ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="cp-btn cp-btn-primary"
                disabled={!selectedSlot}
                onClick={() => setStep('confirm')}
              >
                <span>Continue</span><span className="cp-arrow">→</span>
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button type="button" className="cp-btn cp-btn-ghost" onClick={() => setStep('select')}>Back</button>
              <button
                type="button"
                data-testid="confirm-booking-btn"
                className="cp-btn cp-btn-primary"
                onClick={handleConfirm}
              >
                <span>Confirm booking</span><span className="cp-arrow">→</span>
              </button>
            </>
          )}
          {(step === 'success' || step === 'error') && (
            <>
              {step === 'error' && (
                <button type="button" className="cp-btn cp-btn-ghost" onClick={() => setStep('select')}>Try a different time</button>
              )}
              <button type="button" className="cp-btn cp-btn-primary" onClick={onClose}>
                <span>{step === 'success' ? 'Done' : 'Close'}</span><span className="cp-arrow">→</span>
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
