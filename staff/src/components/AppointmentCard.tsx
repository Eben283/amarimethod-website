import { ChevronRight } from 'lucide-react';
import type { TodayAppointment } from '../types/staff';

interface Props {
  appointment: TodayAppointment;
  onTap: () => void;
}

export default function AppointmentCard({ appointment, onTap }: Props) {
  const start = new Date(appointment.startTime);
  const end = new Date(appointment.endTime);
  const timeStr = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  const now = new Date();
  const isNow = start <= now && end >= now;
  const isPast = end < now;

  return (
    <button
      onClick={onTap}
      className={`staff-card-tap w-full text-left flex items-center gap-3 ${isPast ? 'opacity-50' : ''} ${isNow ? 'border-amari-accent-warm border-2' : ''}`}
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
        <div className="flex items-center gap-2 mt-0.5">
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
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            appointment.sessionPrepaid
              ? 'bg-green-50 text-green-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            {appointment.sessionPrepaid ? 'Paid' : '$'}
          </span>
        </div>
      </div>

      <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
    </button>
  );
}
