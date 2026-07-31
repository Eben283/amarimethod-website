import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2, Search, X } from 'lucide-react';
import { AmariMonthGrid, AmariTimeSlots } from '@amari/calendar';
import {
  ApiError,
  getStaffBookSlots,
  listStaffBookTypes,
  searchContacts,
  staffBookAppointment,
  type StaffBookSlot,
  type StaffBookType,
} from '../lib/api';
import type { ContactListItem } from '../types/staff';
import '../../../css/amari-calendar.css';
import './BookForSomeoneModal.css';

const TIMEZONE = 'America/Los_Angeles';

function monthStart(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addMonth(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function slotTime(slot: StaffBookSlot) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(slot.datetime));
}

type Props = {
  contactId?: string | null;
  contactName?: string | null;
  defaultSessionType?: string;
  onClose: () => void;
  onBooked?: (info: { appointmentId: string; startTime: string; sessionType: string }) => void;
};

export default function BookForSomeoneModal({
  contactId: initialContactId = null,
  contactName: initialContactName = null,
  defaultSessionType = 'followup_package_in_person',
  onClose,
  onBooked,
}: Props) {
  const [types, setTypes] = useState<StaffBookType[]>([]);
  const [sessionType, setSessionType] = useState(defaultSessionType);
  const [contactId, setContactId] = useState<string | null>(initialContactId);
  const [contactName, setContactName] = useState(initialContactName || '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [month, setMonth] = useState(monthStart);
  const [slots, setSlots] = useState<StaffBookSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<StaffBookSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneAt, setDoneAt] = useState<string | null>(null);

  const startDate = ymd(month);
  const endDate = ymd(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const availableDates = useMemo(() => new Set(slots.map((s) => s.date)), [slots]);
  const times = selectedDate ? slots.filter((s) => s.date === selectedDate) : [];

  useEffect(() => {
    listStaffBookTypes()
      .then((list) => {
        setTypes(list);
        if (!list.some((t) => t.id === sessionType) && list[0]) setSessionType(list[0].id);
      })
      .catch(() => setError('Could not load session types.'));
  }, []);

  useEffect(() => {
    if (!query.trim() || contactId) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchContacts(query.trim()));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, contactId]);

  useEffect(() => {
    if (!contactId || !sessionType) return;
    let cancelled = false;
    setLoadingSlots(true);
    setError('');
    setSelectedDate(null);
    setSelectedSlot(null);
    getStaffBookSlots(sessionType, startDate, endDate, TIMEZONE)
      .then((next) => { if (!cancelled) setSlots(next); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load times.');
      })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [contactId, sessionType, startDate, endDate]);

  async function book() {
    if (!contactId || !selectedSlot || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await staffBookAppointment({
        contactId,
        sessionType,
        startTime: selectedSlot.datetime,
        timezone: TIMEZONE,
        idempotencyKey: crypto.randomUUID(),
        notify: true,
      });
      setDoneAt(result.appointment.startTime);
      onBooked?.({
        appointmentId: result.appointment.id,
        startTime: result.appointment.startTime,
        sessionType: result.appointment.sessionType,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not book that time.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bfs" role="dialog" aria-modal="true" aria-label="Book appointment">
      <button type="button" className="bfs__scrim" aria-label="Close" onClick={() => { if (!submitting) onClose(); }} />
      <section className="bfs__panel">
        <header className="bfs__head">
          <div>
            <p>Staff booking</p>
            <h2>Book appointment</h2>
          </div>
          <button type="button" onClick={() => { if (!submitting) onClose(); }} aria-label="Close"><X size={18} /></button>
        </header>

        {!contactId ? (
          <div className="bfs__block">
            <label className="bfs__label">Who?</label>
            <div className="bfs__search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, or phone"
                autoFocus
              />
            </div>
            {searching && <p className="bfs__hint"><Loader2 className="spin" size={14} /> Searching…</p>}
            <ul className="bfs__results">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setContactId(c.id);
                      setContactName(c.name || c.email || c.id);
                      setQuery('');
                      setResults([]);
                    }}
                  >
                    <strong>{c.name || 'No name'}</strong>
                    <span>{c.email || c.phone || c.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bfs__person">
            <div>
              <span>Booking for</span>
              <strong>{contactName || 'Selected contact'}</strong>
            </div>
            {!initialContactId && (
              <button type="button" onClick={() => { setContactId(null); setContactName(''); setDoneAt(null); }}>
                Change
              </button>
            )}
          </div>
        )}

        {contactId && (
          <>
            <div className="bfs__block">
              <label className="bfs__label" htmlFor="bfs-type">Session type</label>
              <select id="bfs-type" value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            {error && <div className="bfs__error" role="alert">{error}</div>}

            {doneAt ? (
              <div className="bfs__done">
                <Check size={18} />
                <p>
                  Booked {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short', month: 'long', day: 'numeric',
                    hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE,
                  }).format(new Date(doneAt))}
                </p>
                <button type="button" onClick={onClose}>Done <ArrowRight size={16} /></button>
              </div>
            ) : (
              <>
                <div className="bfs__cal">
                  <AmariMonthGrid
                    year={month.getFullYear()}
                    month={month.getMonth()}
                    selectedDate={selectedDate}
                    availableDates={availableDates}
                    onSelectDate={(date) => { setSelectedDate(date); setSelectedSlot(null); }}
                    onPrevMonth={() => setMonth((m) => addMonth(m, -1))}
                    onNextMonth={() => setMonth((m) => addMonth(m, 1))}
                    prevDisabled={month <= monthStart()}
                    loading={loadingSlots}
                  />
                  {selectedDate ? (
                    <AmariTimeSlots
                      dateLabel={new Intl.DateTimeFormat('en-US', {
                        weekday: 'long', month: 'long', day: 'numeric',
                      }).format(new Date(`${selectedDate}T12:00:00`))}
                      slots={times.map((slot) => ({ id: slot.datetime, label: slotTime(slot) }))}
                      selectedId={selectedSlot?.datetime ?? null}
                      onSelect={(id) => setSelectedSlot(times.find((s) => s.datetime === id) || null)}
                      emptyMessage="No open times that day."
                    />
                  ) : (
                    !loadingSlots && <p className="bfs__hint">Choose a date to see times.</p>
                  )}
                </div>
                <footer className="bfs__foot">
                  <span>{selectedSlot ? slotTime(selectedSlot) : 'Pick a time'}</span>
                  <button type="button" disabled={!selectedSlot || submitting} onClick={() => void book()}>
                    {submitting ? 'Booking…' : 'Book'} <ArrowRight size={16} />
                  </button>
                </footer>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
