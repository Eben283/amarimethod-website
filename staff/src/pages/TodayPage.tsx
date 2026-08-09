import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getCalendarSummary, getDayData, ApiError } from '../lib/api';
import { memberWorkspacePath } from '../lib/member-workspace';
import type { TodayAppointment } from '../types/staff';
import AppointmentCard from '../components/AppointmentCard';
import SessionDocSheet from '../components/SessionDocSheet';
import PayLinkSheet from '../components/PayLinkSheet';
import MoneyMoments from '../components/MoneyMoments';
import CalendarRegistry from '../components/CalendarRegistry';

type ViewMode = 'day' | 'week' | 'month';

function toDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getWeekDates(d: Date): Date[] {
  const day = d.getDay(); // 0=Sun
  const mon = addDays(d, -((day + 6) % 7)); // Monday
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

function getMonthDates(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function isToday(d: Date): boolean {
  return toDateStr(d) === toDateStr(new Date());
}

const SHORT_DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TodayPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [section, setSection] = useState<'schedule' | 'services'>('schedule');
  const [view, setView] = useState<ViewMode>('week');
  const [dayAppointments, setDayAppointments] = useState<TodayAppointment[]>([]);
  const [weekData, setWeekData] = useState<Record<string, TodayAppointment[]>>({});
  const [monthData, setMonthData] = useState<Record<string, TodayAppointment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [docContactId, setDocContactId] = useState<string | null>(null);
  const [docClientName, setDocClientName] = useState('');
  const [sellContactId, setSellContactId] = useState<string | null>(null);

  // Monotonic request id shared by loadDay/loadWeek. Rapid date paging or day↔week
  // toggling fires overlapping requests; only the latest one is allowed to commit
  // state, so an older response landing late can't overwrite the current view.
  const reqIdRef = useRef(0);

  const loadDay = useCallback(async (date: Date) => {
    const reqId = ++reqIdRef.current;
    setIsLoading(true);
    setError('');
    try {
      const data = await getDayData(toDateStr(date));
      if (reqId !== reqIdRef.current) return; // superseded by a newer request
      setDayAppointments(data);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (reqId === reqIdRef.current) setIsLoading(false);
    }
  }, [logout]);

  const loadWeek = useCallback(async (date: Date) => {
    const reqId = ++reqIdRef.current;
    setIsLoading(true);
    setError('');
    try {
      const dates = getWeekDates(date);
      const startStr = toDateStr(dates[0]);
      const endStr = toDateStr(dates[6]);
      // Single API call for the full week range
      const allAppts = await getCalendarSummary(startStr, endStr);
      if (reqId !== reqIdRef.current) return; // superseded by a newer request
      // Group by date
      const map: Record<string, TodayAppointment[]> = {};
      for (const d of dates) map[toDateStr(d)] = [];
      for (const appt of allAppts) {
        const apptDate = new Date(appt.startTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        if (map[apptDate]) {
          map[apptDate].push(appt);
        } else {
          map[apptDate] = [appt];
        }
      }
      setWeekData(map);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (reqId === reqIdRef.current) setIsLoading(false);
    }
  }, [logout]);

  const loadMonth = useCallback(async (date: Date) => {
    const reqId = ++reqIdRef.current;
    setIsLoading(true);
    setError('');
    try {
      const dates = getMonthDates(date);
      const allAppts = await getCalendarSummary(toDateStr(dates[0]), toDateStr(dates[41]));
      if (reqId !== reqIdRef.current) return;
      const map: Record<string, TodayAppointment[]> = {};
      for (const day of dates) map[toDateStr(day)] = [];
      for (const appt of allAppts) {
        const apptDate = new Date(appt.startTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        if (map[apptDate]) map[apptDate].push(appt);
      }
      setMonthData(map);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (reqId === reqIdRef.current) setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (section !== 'schedule') return;
    if (view === 'day') loadDay(selectedDate);
    else if (view === 'week') loadWeek(selectedDate);
    else loadMonth(selectedDate);
  }, [section, selectedDate, view, loadDay, loadWeek, loadMonth]);

  function navigateDate(delta: number) {
    setSelectedDate((prev) => view === 'month'
      ? addMonths(prev, delta)
      : addDays(prev, view === 'week' ? delta * 7 : delta));
  }

  function goToToday() {
    setSelectedDate(new Date());
  }

  const dateLabel = view === 'day'
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : view === 'month'
      ? selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : (() => {
        const week = getWeekDates(selectedDate);
        const first = week[0];
        const last = week[6];
        if (first.getMonth() === last.getMonth()) {
          return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()}–${last.getDate()}`;
        }
        return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      })();

  function reloadSelectedDate() {
    if (view === 'day') loadDay(selectedDate);
    else if (view === 'week') loadWeek(selectedDate);
    else loadMonth(selectedDate);
  }

  const showTodayButton = !isToday(selectedDate);

  return (
    <main className="staff-calendar-page px-4 pt-6 pb-4">
      <header className="staff-calendar-page__head">
        <div><span>Practice time</span><h1>Calendar</h1><p>Appointments, session work, and the booking rules behind each service.</p></div>
      </header>

      <nav className="staff-calendar-page__sections" aria-label="Calendar sections">
        <button type="button" className={section === 'schedule' ? 'is-active' : ''} onClick={() => setSection('schedule')} aria-current={section === 'schedule' ? 'page' : undefined}>Schedule</button>
        <button type="button" className={section === 'services' ? 'is-active' : ''} onClick={() => setSection('services')} aria-current={section === 'services' ? 'page' : undefined}>Services &amp; booking</button>
      </nav>

      {section === 'services' ? <CalendarRegistry onViewSchedule={() => setSection('schedule')} /> : <>
      {/* Today's sell moments — 8-pack opportunities hiding in today's schedule
          (renewals at last session + first-timers to pitch). */}
      <MoneyMoments />

      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-amari-light-sand rounded-lg p-0.5">
          <button
            onClick={() => setView('day')}
            aria-pressed={view === 'day'}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'day' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}
          >
            Day
          </button>
          <button
            onClick={() => setView('week')}
            aria-pressed={view === 'week'}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'week' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}
          >
            Week
          </button>
          <button
            onClick={() => setView('month')}
            aria-pressed={view === 'month'}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'month' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}
          >
            Month
          </button>
        </div>
        <div className="flex items-center gap-1">
          {showTodayButton && (
            <button
              onClick={goToToday}
              className="px-2 py-1 text-xs text-amari-accent-warm font-medium rounded-md hover:bg-amari-light-sand min-h-[36px]"
            >
              Today
            </button>
          )}
          <button
            onClick={reloadSelectedDate}
            disabled={isLoading}
            className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[36px] min-h-[36px] flex items-center justify-center"
          >
            <RefreshCw className={`w-4 h-4 text-amari-text-muted ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => navigateDate(-1)} className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[44px] min-h-[44px] flex items-center justify-center">
          <ChevronLeft className="w-5 h-5 text-amari-text-muted" />
        </button>
        <div className="text-center">
          <h1 className="text-lg font-serif text-amari-charcoal">{dateLabel}</h1>
        </div>
        <button onClick={() => navigateDate(1)} className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[44px] min-h-[44px] flex items-center justify-center">
          <ChevronRight className="w-5 h-5 text-amari-text-muted" />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
        </div>
      ) : error ? (
        <div className="staff-card text-center py-8">
          <p className="text-red-500 text-sm mb-3">{error}</p>
          <button onClick={reloadSelectedDate} className="staff-btn-secondary text-sm">Try Again</button>
        </div>
      ) : view === 'day' ? (
        <DayView
          appointments={dayAppointments}
          date={selectedDate}
          onTapAppointment={(appt) => navigate(memberWorkspacePath(appt.contactId, 'session', appt.id))}
          onDocSession={(appt) => { setDocContactId(appt.contactId); setDocClientName(appt.contactName); }}
          onSellLink={(appt) => setSellContactId(appt.contactId)}
        />
      ) : view === 'week' ? (
        <WeekView
          weekData={weekData}
          selectedDate={selectedDate}
          onSelectDay={(d) => { setSelectedDate(d); setView('day'); }}
        />
      ) : (
        <MonthView
          monthData={monthData}
          selectedDate={selectedDate}
          onSelectDay={(d) => { setSelectedDate(d); setView('day'); }}
        />
      )}
      {docContactId && (
        <SessionDocSheet
          contactId={docContactId}
          clientName={docClientName}
          onClose={() => setDocContactId(null)}
        />
      )}
      {sellContactId && (
        <PayLinkSheet
          contactId={sellContactId}
          onClose={() => setSellContactId(null)}
        />
      )}
      </>}
    </main>
  );
}

// ── Day View ──

// Assign each appointment a column within its overlap group so simultaneous
// appointments render side-by-side instead of stacking on top of each other.
// Returns id → { col, totalCols } where totalCols is the column count of the
// overlap group the appointment belongs to (singletons get totalCols=1).
function assignColumns(
  appts: TodayAppointment[],
): Map<string, { col: number; totalCols: number }> {
  const sorted = [...appts].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const result = new Map<string, { col: number; totalCols: number }>();
  let i = 0;
  while (i < sorted.length) {
    // Find the extent of this overlap group: keep extending while the next
    // appointment starts before the group's running end time.
    let groupEnd = new Date(sorted[i].endTime).getTime();
    let j = i + 1;
    while (j < sorted.length && new Date(sorted[j].startTime).getTime() < groupEnd) {
      const endJ = new Date(sorted[j].endTime).getTime();
      if (endJ > groupEnd) groupEnd = endJ;
      j++;
    }
    // Greedy column assignment within the group: each appt takes the lowest
    // column whose previous appointment has already ended.
    const columnEnds: number[] = [];
    const assigned: Array<{ id: string; col: number }> = [];
    for (let k = i; k < j; k++) {
      const aStart = new Date(sorted[k].startTime).getTime();
      const aEnd = new Date(sorted[k].endTime).getTime();
      let col = columnEnds.findIndex((e) => e <= aStart);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(aEnd);
      } else {
        columnEnds[col] = aEnd;
      }
      assigned.push({ id: sorted[k].id, col });
    }
    const totalCols = columnEnds.length;
    for (const { id, col } of assigned) {
      result.set(id, { col, totalCols });
    }
    i = j;
  }
  return result;
}

function isSellMoment(appt: TodayAppointment): boolean {
  return new Date(appt.endTime) < new Date()
    && appt.sessionsRemaining > 0
    && appt.sessionsRemaining <= 2
    && appt.seriesType !== 'none';
}

function DayView({ appointments, date, onTapAppointment, onDocSession, onSellLink }: {
  appointments: TodayAppointment[];
  date: Date;
  onTapAppointment: (appt: TodayAppointment) => void;
  onDocSession: (appt: TodayAppointment) => void;
  onSellLink: (appt: TodayAppointment) => void;
}) {
  if (appointments.length === 0) {
    return (
      <div className="staff-card text-center py-12">
        <p className="text-amari-text-muted">
          {isToday(date) ? 'No appointments today' : 'No appointments'}
        </p>
      </div>
    );
  }

  // Build timeline — show the day's shape
  const sorted = [...appointments].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const firstStart = new Date(sorted[0].startTime);
  const lastEnd = new Date(sorted[sorted.length - 1].endTime);
  const dayStartHour = Math.max(7, firstStart.getHours() - 1);
  const dayEndHour = Math.min(21, lastEnd.getHours() + 2);

  const hours = [];
  for (let h = dayStartHour; h <= dayEndHour; h++) {
    hours.push(h);
  }

  const totalMinutes = (dayEndHour - dayStartHour) * 60;

  function getTop(timeStr: string): number {
    const t = new Date(timeStr);
    const mins = (t.getHours() - dayStartHour) * 60 + t.getMinutes();
    return (mins / totalMinutes) * 100;
  }

  function getHeight(startStr: string, endStr: string): number {
    const s = new Date(startStr);
    const e = new Date(endStr);
    const mins = (e.getTime() - s.getTime()) / 60000;
    return (mins / totalMinutes) * 100;
  }

  return (
    <div>
      {/* Timeline */}
      <div className="staff-card mb-4 p-0 overflow-hidden">
        <div className="relative" style={{ height: `${hours.length * 48}px` }}>
          {/* Hour lines */}
          {hours.map((h) => {
            const top = ((h - dayStartHour) / (dayEndHour - dayStartHour)) * 100;
            return (
              <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: `${top}%` }}>
                <span className="text-[10px] text-amari-text-muted w-12 text-right pr-2 -mt-1.5">
                  {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                </span>
                <div className="flex-1 border-t border-amari-border" />
              </div>
            );
          })}

          {/* Appointment blocks */}
          {(() => {
            const layouts = assignColumns(appointments);
            return appointments.map((appt) => {
              const top = getTop(appt.startTime);
              const height = getHeight(appt.startTime, appt.endTime);
              const startTime = new Date(appt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const layout = layouts.get(appt.id) || { col: 0, totalCols: 1 };
              const gapPx = layout.totalCols > 1 ? 2 : 0;
              // Available horizontal space is calc(100% - 64px): 56px left
              // for the time-label column + 8px right padding.
              return (
                <button
                  key={appt.id}
                  onClick={() => onTapAppointment(appt)}
                  className="absolute rounded-lg bg-amari-accent-warm/15 border-l-3 border-amari-accent-warm px-2 py-1 text-left hover:bg-amari-accent-warm/25 transition-colors"
                  style={{
                    top: `${top}%`,
                    height: `${Math.max(height, 4)}%`,
                    left: `calc(56px + (100% - 64px) * ${layout.col / layout.totalCols})`,
                    width: `calc((100% - 64px) / ${layout.totalCols} - ${gapPx}px)`,
                    borderLeftWidth: '3px',
                  }}
                >
                  <p className="text-xs font-medium text-amari-charcoal truncate">{appt.contactName}</p>
                  <p className="text-[10px] text-amari-text-muted">{startTime}</p>
                </button>
              );
            });
          })()}

          {/* Now line */}
          {isToday(new Date(appointments[0].startTime)) && (() => {
            const now = new Date();
            const nowHour = now.getHours();
            if (nowHour >= dayStartHour && nowHour <= dayEndHour) {
              const nowMins = (nowHour - dayStartHour) * 60 + now.getMinutes();
              const nowTop = (nowMins / totalMinutes) * 100;
              return (
                <div className="absolute left-12 right-0 flex items-center z-10" style={{ top: `${nowTop}%` }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 border-t-2 border-red-500" />
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* Appointment cards for detail */}
      <div className="space-y-3">
        {appointments.map((appt) => (
          <AppointmentCard
            key={appt.id}
            appointment={appt}
            onTap={() => onTapAppointment(appt)}
            onDocSession={() => onDocSession(appt)}
            onSellLink={isSellMoment(appt) ? () => onSellLink(appt) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ── Week View ──

function WeekView({ weekData, selectedDate, onSelectDay }: {
  weekData: Record<string, TodayAppointment[]>;
  selectedDate: Date;
  onSelectDay: (d: Date) => void;
}) {
  const weekDates = getWeekDates(selectedDate);

  return (
    <div className="grid grid-cols-7 gap-1">
      {weekDates.map((d, i) => {
        const key = toDateStr(d);
        const appts = weekData[key] || [];
        const today = isToday(d);
        const isPast = d < new Date() && !today;

        return (
          <button
            key={key}
            onClick={() => onSelectDay(d)}
            className={`rounded-lg p-2 text-center min-h-[100px] flex flex-col transition-colors ${
              today
                ? 'bg-amari-accent-warm/10 border-2 border-amari-accent-warm'
                : isPast
                ? 'bg-amari-light-sand/50 opacity-60'
                : 'bg-amari-light-sand/50 hover:bg-amari-light-sand'
            }`}
          >
            <span className="text-[10px] text-amari-text-muted">{SHORT_DAY[i]}</span>
            <span className={`text-sm font-medium ${today ? 'text-amari-accent-warm' : 'text-amari-charcoal'}`}>
              {d.getDate()}
            </span>

            {/* Appointment dots/blocks */}
            <div className="flex-1 flex flex-col gap-0.5 mt-1">
              {appts.slice(0, 4).map((appt) => {
                const time = new Date(appt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <div
                    key={appt.id}
                    className="bg-amari-accent-warm/20 rounded px-0.5 py-px"
                  >
                    <p className="text-[8px] text-amari-charcoal truncate">{time}</p>
                  </div>
                );
              })}
              {appts.length > 4 && (
                <p className="text-[8px] text-amari-text-muted">+{appts.length - 4}</p>
              )}
            </div>

            {appts.length > 0 && (
              <span className="text-[10px] text-amari-text-muted mt-1">{appts.length} appt{appts.length !== 1 ? 's' : ''}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Month View ──

function MonthView({ monthData, selectedDate, onSelectDay }: {
  monthData: Record<string, TodayAppointment[]>;
  selectedDate: Date;
  onSelectDay: (d: Date) => void;
}) {
  const monthDates = getMonthDates(selectedDate);
  const selectedMonth = selectedDate.getMonth();

  return (
    <div className="overflow-hidden rounded-xl border border-amari-light-sand bg-amari-light-sand">
      <div className="grid grid-cols-7 gap-px" aria-hidden="true">
        {SHORT_DAY.map((day) => (
          <div key={day} className="bg-white px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-amari-text-muted sm:text-xs">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px" role="grid" aria-label={selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}>
        {monthDates.map((day) => {
          const key = toDateStr(day);
          const appts = monthData[key] || [];
          const today = isToday(day);
          const inMonth = day.getMonth() === selectedMonth;

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              onClick={() => onSelectDay(day)}
              aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${appts.length} appointment${appts.length === 1 ? '' : 's'}`}
              className={`group min-h-[74px] bg-white p-1 text-left align-top transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amari-accent-warm sm:min-h-[118px] sm:p-2 ${
                inMonth ? 'hover:bg-amari-light-sand/40' : 'bg-white/60 text-amari-text-muted opacity-55 hover:opacity-80'
              }`}
            >
              <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold sm:text-sm ${
                today ? 'bg-amari-accent-warm text-white' : inMonth ? 'text-amari-charcoal' : 'text-amari-text-muted'
              }`}>
                {day.getDate()}
              </span>

              <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                {appts.slice(0, 4).map((appt) => (
                  <span key={appt.id} className="h-1.5 w-1.5 rounded-full bg-amari-accent-warm" />
                ))}
                {appts.length > 4 && <span className="text-[8px] font-semibold text-amari-text-muted">+{appts.length - 4}</span>}
              </div>

              <div className="mt-1 hidden space-y-1 sm:block">
                {appts.slice(0, 3).map((appt) => (
                  <div key={appt.id} className="rounded border-l-2 border-amari-accent-warm bg-amari-accent-warm/10 px-1.5 py-1">
                    <p className="truncate text-[10px] font-semibold text-amari-charcoal">
                      {new Date(appt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}
                    </p>
                    <p className="truncate text-[9px] text-amari-text-muted">{appt.contactName || appt.title}</p>
                  </div>
                ))}
                {appts.length > 3 && (
                  <p className="px-1 text-[9px] font-semibold text-amari-text-muted">+{appts.length - 3} more</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
