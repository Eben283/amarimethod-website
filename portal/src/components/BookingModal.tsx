import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { getAvailableSlots, bookAppointment } from '../lib/api';

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
  // dateStr is "YYYY-MM-DD"
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

export default function BookingModal({ onClose }: BookingModalProps) {
  const [sessionType, setSessionType] = useState<SessionType>('in-person');
  const [step, setStep] = useState<ModalStep>('select');

  // Calendar navigation
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth()); // 0-indexed

  // Slots state
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Selection
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // Booking result
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bookedTitle, setBookedTitle] = useState<string>('');

  const timezone = getUserTimezone();

  // Fetch slots whenever session type or calendar month changes
  const fetchSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedDate(null);
    setSelectedSlot(null);

    const calendarId = sessionType === 'in-person'
      ? CALENDARS.followup_inperson
      : CALENDARS.followup_virtual;

    // Fetch the full month (first to last day)
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

  // Build set of dates that have available slots
  const availableDates = new Set(slots.map((s) => s.date));

  // Slots for the selected date
  const slotsForDate = selectedDate
    ? slots.filter((s) => s.date === selectedDate).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    : [];

  // Calendar grid
  const firstOfMonth = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow = firstOfMonth.getDay(); // 0=Sun
  const todayYMD = toYMD(today);

  // Prev/next month
  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else { setCalMonth(m => m - 1); }
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else { setCalMonth(m => m + 1); }
  }

  // Disable going to months before current
  const isPrevDisabled = calYear === today.getFullYear() && calMonth <= today.getMonth();

  async function handleConfirm() {
    if (!selectedSlot) return;
    setStep('loading');

    const calendarId = sessionType === 'in-person'
      ? CALENDARS.followup_inperson
      : CALENDARS.followup_virtual;

    try {
      const result = await bookAppointment({
        calendarId,
        startTime: selectedSlot.datetime,
        timezone,
        sessionType,
      });
      setBookedTitle(result.appointment.title);
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed. Please try again.';
      setErrorMsg(msg);
      setStep('error');
    }
  }

  // ──────────────────────────────────────────────
  // Render helpers
  // ──────────────────────────────────────────────

  function renderCalendar() {
    const cells: React.ReactNode[] = [];

    // Empty cells before the 1st
    for (let i = 0; i < startDow; i++) {
      cells.push(<div key={`empty-${i}`} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isPast = ymd < todayYMD;
      const hasSlots = availableDates.has(ymd);
      const isSelected = ymd === selectedDate;
      const isToday = ymd === todayYMD;

      cells.push(
        <button
          key={ymd}
          disabled={isPast || !hasSlots || slotsLoading}
          onClick={() => { setSelectedDate(ymd); setSelectedSlot(null); }}
          className={[
            'relative w-9 h-9 rounded-full text-sm font-medium transition-all duration-150 mx-auto flex items-center justify-center',
            isSelected
              ? 'bg-amari-charcoal text-white'
              : hasSlots && !isPast
                ? 'text-amari-charcoal hover:bg-amari-light-sand cursor-pointer'
                : 'text-gray-300 cursor-default',
            isToday && !isSelected ? 'ring-1 ring-amari-charcoal' : '',
          ].join(' ')}
        >
          {d}
          {hasSlots && !isPast && !isSelected && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amari-accent-warm" />
          )}
        </button>
      );
    }

    return cells;
  }

  // ──────────────────────────────────────────────
  // Main modal UI
  // ──────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-serif text-xl text-amari-charcoal">Book a Session</h2>
            <p className="text-xs text-amari-text-muted mt-0.5">{timezone.replace(/_/g, ' ')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-amari-light-sand text-amari-charcoal transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* ── Step: Success ── */}
          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <CheckCircle className="w-14 h-14 text-green-500" />
              <div>
                <h3 className="font-serif text-lg text-amari-charcoal">You're booked!</h3>
                <p className="text-sm text-amari-text-muted mt-1">{bookedTitle}</p>
                <p className="text-sm text-amari-text-muted">
                  {selectedSlot && formatDateDisplay(selectedSlot.date)} at{' '}
                  {selectedSlot && formatTime(selectedSlot.hour, selectedSlot.minute)}
                </p>
              </div>
              <p className="text-xs text-amari-text-muted max-w-xs">
                A confirmation email is on its way. See you then!
              </p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 bg-amari-charcoal text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {/* ── Step: Error ── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <AlertCircle className="w-14 h-14 text-red-400" />
              <div>
                <h3 className="font-serif text-lg text-amari-charcoal">Something went wrong</h3>
                <p className="text-sm text-amari-text-muted mt-1">{errorMsg}</p>
              </div>
              <button
                onClick={() => setStep('select')}
                className="px-6 py-2.5 bg-amari-charcoal text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* ── Step: Loading (submitting) ── */}
          {step === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="w-10 h-10 text-amari-charcoal animate-spin" />
              <p className="text-sm text-amari-text-muted">Booking your session…</p>
            </div>
          )}

          {/* ── Step: Confirm ── */}
          {step === 'confirm' && selectedSlot && (
            <div className="space-y-5">
              <div className="portal-card bg-amari-light-sand border-0 space-y-2">
                <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider">Appointment Summary</p>
                <p className="text-amari-charcoal font-medium">
                  {sessionType === 'in-person' ? 'Follow-up Session (In Person)' : 'Follow-up Session (Virtual)'}
                </p>
                <p className="text-sm text-amari-text-muted">
                  {formatDateDisplay(selectedSlot.date)}
                </p>
                <p className="text-sm text-amari-text-muted">
                  {formatTime(selectedSlot.hour, selectedSlot.minute)}
                </p>
                <p className="text-xs text-amari-text-muted">{timezone.replace(/_/g, ' ')}</p>
              </div>
              {sessionType === 'virtual' && (
                <p className="text-xs text-amari-text-muted bg-blue-50 rounded-lg p-3">
                  📧 A Google Meet link will be emailed to you and added to the calendar invite.
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('select')}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-amari-charcoal hover:bg-amari-light-sand transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 py-2.5 bg-amari-charcoal text-white rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
                >
                  Confirm Booking
                </button>
              </div>
            </div>
          )}

          {/* ── Step: Select date/time ── */}
          {step === 'select' && (
            <>
              {/* Session type toggle */}
              <div className="flex gap-2 p-1 bg-amari-light-sand rounded-xl">
                {(['in-person', 'virtual'] as SessionType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSessionType(type)}
                    className={[
                      'flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                      sessionType === type
                        ? 'bg-white shadow-sm text-amari-charcoal'
                        : 'text-amari-text-muted hover:text-amari-charcoal',
                    ].join(' ')}
                  >
                    {type === 'in-person' ? 'In Person' : 'Virtual'}
                  </button>
                ))}
              </div>

              {/* Calendar header */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={prevMonth}
                    disabled={isPrevDisabled}
                    className="p-1.5 rounded-lg hover:bg-amari-light-sand disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-amari-charcoal" />
                  </button>
                  <span className="font-medium text-amari-charcoal text-sm">
                    {MONTHS[calMonth]} {calYear}
                  </span>
                  <button
                    onClick={nextMonth}
                    className="p-1.5 rounded-lg hover:bg-amari-light-sand transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-amari-charcoal" />
                  </button>
                </div>

                {/* Day-of-week headers */}
                <div className="grid grid-cols-7 mb-1">
                  {DAYS.map((d) => (
                    <div key={d} className="text-center text-xs text-amari-text-muted font-medium py-1">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                {slotsLoading ? (
                  <div className="flex justify-center items-center py-10">
                    <Loader2 className="w-6 h-6 text-amari-charcoal animate-spin" />
                  </div>
                ) : slotsError ? (
                  <div className="text-center py-6 space-y-2">
                    <p className="text-sm text-red-500">{slotsError}</p>
                    <button
                      onClick={fetchSlots}
                      className="text-xs text-amari-charcoal underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-y-1">
                    {renderCalendar()}
                  </div>
                )}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div>
                  <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-2">
                    {formatDateDisplay(selectedDate)}
                  </p>
                  {slotsForDate.length === 0 ? (
                    <p className="text-sm text-amari-text-muted">No times available for this date.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slotsForDate.map((slot) => {
                        const isSelected = selectedSlot?.datetime === slot.datetime;
                        return (
                          <button
                            key={slot.datetime}
                            onClick={() => setSelectedSlot(slot)}
                            className={[
                              'py-2 px-2 rounded-lg text-sm font-medium border transition-all duration-150',
                              isSelected
                                ? 'bg-amari-charcoal text-white border-amari-charcoal'
                                : 'border-gray-200 text-amari-charcoal hover:border-amari-charcoal hover:bg-amari-light-sand',
                            ].join(' ')}
                          >
                            {formatTime(slot.hour, slot.minute)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Continue button */}
              {selectedSlot && (
                <button
                  onClick={() => setStep('confirm')}
                  className="w-full py-3 bg-amari-charcoal text-white rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
                >
                  Continue →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
