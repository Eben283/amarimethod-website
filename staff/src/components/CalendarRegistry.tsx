import {
  AlertTriangle,
  CalendarCheck2,
  Clock3,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getStaffCalendars, type StaffCalendarDefinition, type StaffCalendarRegistry } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import './CalendarRegistry.css';

type GroupFilter = 'all' | StaffCalendarDefinition['group'];
type StateFilter = 'all' | 'current' | 'attention' | 'legacy';

function minutes(value: number | null, fallback = 'Not recorded') {
  if (value == null) return fallback;
  if (value === 60) return '1 hr';
  return `${value} min`;
}

function readinessLabel(calendar: StaffCalendarDefinition) {
  if (calendar.readiness === 'attention') return 'Needs verification';
  if (calendar.readiness === 'legacy') return 'Legacy';
  if (calendar.readiness === 'specialist') return 'Specialist';
  return 'Ready';
}

function CalendarRow({ calendar, onViewSchedule }: { calendar: StaffCalendarDefinition; onViewSchedule: () => void }) {
  return (
    <article className={`calendar-registry-row is-${calendar.readiness}`}>
      <header>
        <div>
          <span>{calendar.group === 'sessions' ? 'Session calendar' : calendar.group === 'discovery' ? 'Discovery & intake' : 'Study calendar'}</span>
          <h3>{calendar.name}</h3>
          <p><MapPin aria-hidden="true" /> {calendar.location}</p>
        </div>
        <span className={`calendar-registry-status is-${calendar.readiness}`}>{readinessLabel(calendar)}</span>
      </header>

      <div className="calendar-registry-rhythm" aria-label="Calendar timing">
        <span><strong>{minutes(calendar.durationMinutes)}</strong><small>Session</small></span>
        <i aria-hidden="true" />
        <span><strong>{minutes(calendar.intervalMinutes)}</strong><small>Start rhythm</small></span>
        <i aria-hidden="true" />
        <span><strong>{minutes(calendar.bufferMinutes)}</strong><small>Turnover</small></span>
      </div>

      <dl>
        <div><dt>Booking</dt><dd>{calendar.bookingOwner}</dd></div>
        <div><dt>Payment</dt><dd>{calendar.paymentOwner}</dd></div>
        <div><dt>Appointment record</dt><dd>{calendar.appointmentStore}</dd></div>
        <div><dt>After booking</dt><dd>{calendar.remindersOwner}</dd></div>
      </dl>

      <p className="calendar-registry-note">
        {calendar.readiness === 'attention' ? <AlertTriangle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        {calendar.readinessNote}
      </p>

      <footer>
        <button type="button" onClick={onViewSchedule}><CalendarCheck2 aria-hidden="true" /> View schedule</button>
        {calendar.publicPath ? <a href={calendar.publicPath} target="_blank" rel="noreferrer">Open booking page <ExternalLink aria-hidden="true" /></a> : null}
      </footer>
    </article>
  );
}

export default function CalendarRegistry({ onViewSchedule }: { onViewSchedule: () => void }) {
  const { logout } = useAuth();
  const [registry, setRegistry] = useState<StaffCalendarRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [state, setState] = useState<StateFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRegistry(await getStaffCalendars());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { logout(); return; }
      setError(cause instanceof Error ? cause.message : 'Calendar definitions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (registry?.calendars || []).filter((calendar) => {
      if (group !== 'all' && calendar.group !== group) return false;
      if (state === 'current' && calendar.lifecycle !== 'current') return false;
      if (state === 'attention' && calendar.readiness !== 'attention') return false;
      if (state === 'legacy' && calendar.lifecycle !== 'legacy') return false;
      return !needle || `${calendar.name} ${calendar.location} ${calendar.bookingOwner} ${calendar.paymentOwner}`.toLowerCase().includes(needle);
    });
  }, [group, query, registry, state]);

  if (loading) return <div className="calendar-registry-loading" role="status"><Loader2 aria-hidden="true" /> Loading calendar definitions…</div>;
  if (error || !registry) return <div className="calendar-registry-error" role="alert"><p>{error || 'Calendar definitions could not be loaded.'}</p><button type="button" onClick={() => void load()}><RefreshCw /> Try again</button></div>;

  return (
    <section className="calendar-registry" aria-labelledby="calendar-registry-title">
      <div className="calendar-registry-brief">
        <div>
          <span>Owned calendar map</span>
          <h2 id="calendar-registry-title">Services and booking rules</h2>
          <p>See what each calendar is for, how time is blocked, who collects payment, and what runs after a booking.</p>
        </div>
        {registry.workHours ? (
          <div className="calendar-registry-hours">
            <Clock3 aria-hidden="true" />
            <span><small>Garrett’s working window</small><strong>{registry.workHours.openFrom}–{registry.workHours.openTo}</strong><em>Monday–Friday · Pacific</em></span>
          </div>
        ) : null}
      </div>

      <div className="calendar-registry-boundary">
        <ShieldCheck aria-hidden="true" />
        <div><strong>Calendar definitions are view-only during cutover.</strong><p>{registry.editingBoundary} There is no GHL escape link here.</p></div>
      </div>

      <div className="calendar-registry-tools">
        <label><Search aria-hidden="true" /><span className="sr-only">Search calendars</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search calendars" /></label>
        <div className="calendar-registry-filters" aria-label="Calendar groups">
          <button type="button" className={group === 'all' ? 'is-active' : ''} onClick={() => setGroup('all')}>All <span>{registry.calendars.length}</span></button>
          {registry.groups.map((item) => <button key={item.id} type="button" className={group === item.id ? 'is-active' : ''} onClick={() => setGroup(item.id)}>{item.label} <span>{item.count}</span></button>)}
        </div>
        <select value={state} onChange={(event) => setState(event.target.value as StateFilter)} aria-label="Filter calendar readiness">
          <option value="all">All states</option>
          <option value="current">Current</option>
          <option value="attention">Needs verification</option>
          <option value="legacy">Legacy</option>
        </select>
      </div>

      <div className="calendar-registry-count"><TimerReset aria-hidden="true" /> Showing {visible.length} of {registry.calendars.length} governed calendars</div>
      {visible.length ? <div className="calendar-registry-list">{visible.map((calendar) => <CalendarRow key={calendar.id} calendar={calendar} onViewSchedule={onViewSchedule} />)}</div> : <div className="calendar-registry-empty">No calendars match those filters.</div>}
    </section>
  );
}
