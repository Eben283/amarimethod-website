import { ChevronRight } from 'lucide-react';
import type { TodayAppointment } from '../types/staff';

interface Props {
  appointment: TodayAppointment;
  onTap: () => void;
  onDocSession?: () => void;
}

const FREE_SESSION_PATTERN = /discovery call|pain assessment|15-minute|15 minute|consultation|partner/i;

// Per-session payment pill (Today view). Mirrors ClientDetailPage's PAYMENT_PILL.
const PAYMENT_PILL_TW: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-green-50 text-green-700' },
  comped: { label: 'Comped', cls: 'bg-violet-50 text-violet-700' },
  'on-package': { label: 'On package', cls: 'bg-sky-50 text-sky-700' },
  'pay-next-visit': { label: 'Next visit', cls: 'bg-yellow-50 text-yellow-700' },
  owed: { label: 'Owed', cls: 'bg-red-50 text-red-700' },
};

function isFreeSession(appointment: TodayAppointment): boolean {
  return FREE_SESSION_PATTERN.test(appointment.title) || FREE_SESSION_PATTERN.test(appointment.calendarName);
}

function sessionTypeLabel(calendarName: string): string {
  if (!calendarName) return '';
  // Shorten common calendar names for display
  if (/discovery call/i.test(calendarName)) return 'Discovery';
  if (/initial/i.test(calendarName)) return 'Initial';
  if (/follow.?up/i.test(calendarName)) return 'Follow-up';
  if (/partner/i.test(calendarName)) return 'Partner';
  if (/entrainment/i.test(calendarName)) return 'Entrainment';
  if (/virtual/i.test(calendarName)) return 'Virtual';
  if (/balance protocol/i.test(calendarName)) return 'Balance Protocol';
  return calendarName.length > 20 ? calendarName.slice(0, 18) + '...' : calendarName;
}

export default function AppointmentCard({ appointment, onTap, onDocSession }: Props) {
  const start = new Date(appointment.startTime);
  const end = new Date(appointment.endTime);

  const now = new Date();
  const isNow = start <= now && end >= now;
  const isPast = end < now;
  const isFree = isFreeSession(appointment);
  const typeLabel = sessionTypeLabel(appointment.calendarName);

  return (
    <div className={`staff-card ${isPast ? 'opacity-50' : ''} ${isNow ? 'border-amari-accent-warm border-2' : ''}`}>
      <button
        onClick={onTap}
        className="w-full text-left flex items-center gap-3 active:opacity-70 transition-opacity"
      >
        {/* Time column */}
        <div className="flex-shrink-0 w-20 text-right">
          <p className="text-sm font-medium text-amari-charcoal">
            {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="text-xs text-amari-text-muted">
            {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>

        {/* Divider */}
        <div className={`w-0.5 h-12 rounded-full ${isNow ? 'bg-amari-accent-warm' : 'bg-amari-border'}`} />

        {/* Client info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amari-charcoal truncate">
            {appointment.contactName}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {typeLabel && (
              <span className="text-xs text-amari-text-muted">
                {typeLabel}
              </span>
            )}
            {appointment.seriesType !== 'none' && (
              <span className="text-xs text-amari-text-muted">
                {appointment.sessionsRemaining} left
              </span>
            )}
            {appointment.sessionsCompleted <= 1 && (
              <span className="text-xs bg-amari-accent-warm-light text-amari-charcoal px-1.5 py-0.5 rounded">
                {appointment.sessionsCompleted === 0 ? 'New' : '1st visit'}
              </span>
            )}
            {isNow && (
              <span className="text-xs bg-amari-accent-warm text-white px-1.5 py-0.5 rounded">
                Now
              </span>
            )}
            {!isFree && (() => {
              const ps = appointment.paymentStatus;
              const meta = ps && ps !== 'unknown' ? PAYMENT_PILL_TW[ps] : null;
              if (meta) {
                return <span className={`text-xs px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>;
              }
              return (
                <span className={`text-xs px-1.5 py-0.5 rounded ${appointment.sessionPrepaid ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {appointment.sessionPrepaid ? 'Paid' : 'Unpaid'}
                </span>
              );
            })()}
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
      </button>

      {onDocSession && (
        <div className="mt-3 pt-3 border-t border-amari-border flex justify-end">
          <button
            onClick={onDocSession}
            className="text-xs text-amari-accent-warm font-medium px-2 py-1 rounded hover:bg-amari-light-sand min-h-[36px]"
          >
            Document session
          </button>
        </div>
      )}
    </div>
  );
}
