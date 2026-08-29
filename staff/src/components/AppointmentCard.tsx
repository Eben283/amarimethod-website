import { ChevronRight, Video } from 'lucide-react';
import type { TodayAppointment } from '../types/staff';

interface Props {
  appointment: TodayAppointment;
  onTap: () => void;
  onDocSession?: () => void;
  onSellLink?: () => void;
  onManage?: () => void;
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

export default function AppointmentCard({ appointment, onTap, onDocSession, onSellLink, onManage }: Props) {
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
            {appointment.seriesType !== 'none' && (() => {
              // Series progress = package size − remaining (ClientDetailPage
              // formula). done + remaining used the LIFETIME counter, which
              // includes entrainments/comps/one-offs — an untouched 8-pack
              // with 2 prior one-off sessions rendered "Session 3 of 10".
              const total = appointment.seriesType === '8-session' ? 8
                : appointment.seriesType === '4-session' ? 4 : 0;
              const remaining = appointment.sessionsRemaining;
              if (total > 0 && remaining >= 0 && remaining <= total) {
                const current = Math.min(total, total - remaining + 1);
                const lowSessions = remaining <= 2 && remaining > 0;
                return (
                  <span className={`text-xs ${lowSessions ? 'text-amber-600 font-medium' : 'text-amari-text-muted'}`}>
                    Session {current} of {total}
                  </span>
                );
              }
              return null;
            })()}
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
                <span className={`text-xs px-1.5 py-0.5 rounded ${appointment.sessionPrepaid ? 'bg-green-50 text-green-700' : 'bg-slate-50 text-slate-600'}`}>
                  {appointment.sessionPrepaid ? 'Package balance' : 'Payment unknown'}
                </span>
              );
            })()}
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
      </button>

      {(onDocSession || onSellLink || onManage || (appointment.meetingLocation && !isPast)) && (
        <div className="mt-3 pt-3 border-t border-amari-border flex items-center gap-2 justify-end">
          {appointment.meetingLocation && !isPast && (
            <a
              href={appointment.meetingLocation}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-lg bg-amari-pine-teal px-2.5 py-1.5 text-xs font-medium text-white min-h-[36px]"
            >
              <Video className="w-3 h-3" /> Join
            </a>
          )}
          {onSellLink && (
            <button
              onClick={onSellLink}
              className="text-xs text-amari-pine-teal font-medium px-2 py-1 rounded hover:bg-amari-light-sand min-h-[36px]"
            >
              Send renewal link
            </button>
          )}
          {onManage && (
            <button
              onClick={onManage}
              className="text-xs text-amari-pine-teal font-semibold px-2 py-1 rounded border border-amari-pine-teal/40 hover:bg-amari-light-sand min-h-[36px]"
            >
              Reschedule or cancel
            </button>
          )}
          {onDocSession && (
            <button
              onClick={onDocSession}
              className="text-xs text-amari-accent-warm font-medium px-2 py-1 rounded hover:bg-amari-light-sand min-h-[36px]"
            >
              Document session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
