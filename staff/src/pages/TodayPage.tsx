import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getDayData, ApiError } from '../lib/api';
import type { TodayAppointment } from '../types/staff';
import AppointmentCard from '../components/AppointmentCard';

type ViewMode = 'day' | 'week';

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function isToday(d: Date): boolean {
  return toDateStr(d) === toDateStr(new Date());
}

const SHORT_DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TodayPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>('day');
  const [dayAppointments, setDayAppointments] = useState<TodayAppointment[]>([]);
  const [weekData, setWeekData] = useState<Record<string, TodayAppointment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDay = useCallback(async (date: Date) => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getDayData(toDateStr(date));
      setDayAppointments(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  const loadWeek = useCallback(async (date: Date) => {
    setIsLoading(true);
    setError('');
    try {
      const dates = getWeekDates(date);
      const results = await Promise.all(
        dates.map(async (d) => {
          try {
            const data = await getDayData(toDateStr(d));
            return [toDateStr(d), data] as const;
          } catch {
            return [toDateStr(d), []] as const;
          }
        })
      );
      const map: Record<string, TodayAppointment[]> = {};
      for (const [key, val] of results) map[key] = val;
      setWeekData(map);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { logout(); return; }
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (view === 'day') loadDay(selectedDate);
    else loadWeek(selectedDate);
  }, [selectedDate, view, loadDay, loadWeek]);

  function navigateDate(delta: number) {
    setSelectedDate((prev) => addDays(prev, view === 'week' ? delta * 7 : delta));
  }

  function goToToday() {
    setSelectedDate(new Date());
  }

  const dateLabel = view === 'day'
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : (() => {
        const week = getWeekDates(selectedDate);
        const first = week[0];
        const last = week[6];
        if (first.getMonth() === last.getMonth()) {
          return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()}–${last.getDate()}`;
        }
        return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      })();

  const showTodayButton = !isToday(selectedDate);

  return (
    <div className="px-4 pt-6 pb-4">
      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-amari-light-sand rounded-lg p-0.5">
          <button
            onClick={() => setView('day')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'day' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}
          >
            Day
          </button>
          <button
            onClick={() => setView('week')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'week' ? 'bg-white text-amari-charcoal shadow-sm' : 'text-amari-text-muted'}`}
          >
            Week
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
            onClick={() => view === 'day' ? loadDay(selectedDate) : loadWeek(selectedDate)}
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
          <button onClick={() => view === 'day' ? loadDay(selectedDate) : loadWeek(selectedDate)} className="staff-btn-secondary text-sm">Try Again</button>
        </div>
      ) : view === 'day' ? (
        <DayView
          appointments={dayAppointments}
          date={selectedDate}
          onTapAppointment={(appt) => navigate(`/client/${appt.contactId}?appointment=${appt.id}`)}
        />
      ) : (
        <WeekView
          weekData={weekData}
          selectedDate={selectedDate}
          onSelectDay={(d) => { setSelectedDate(d); setView('day'); }}
        />
      )}
    </div>
  );
}

// ── Day View ──

function DayView({ appointments, date, onTapAppointment }: {
  appointments: TodayAppointment[];
  date: Date;
  onTapAppointment: (appt: TodayAppointment) => void;
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
  const firstStart = new Date(appointments[0].startTime);
  const lastEnd = new Date(appointments[appointments.length - 1].endTime);
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
          {appointments.map((appt) => {
            const top = getTop(appt.startTime);
            const height = getHeight(appt.startTime, appt.endTime);
            const startTime = new Date(appt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            return (
              <button
                key={appt.id}
                onClick={() => onTapAppointment(appt)}
                className="absolute left-14 right-2 rounded-lg bg-amari-accent-warm/15 border-l-3 border-amari-accent-warm px-2 py-1 text-left hover:bg-amari-accent-warm/25 transition-colors"
                style={{ top: `${top}%`, height: `${Math.max(height, 4)}%`, borderLeftWidth: '3px' }}
              >
                <p className="text-xs font-medium text-amari-charcoal truncate">{appt.contactName}</p>
                <p className="text-[10px] text-amari-text-muted">{startTime}</p>
              </button>
            );
          })}

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
