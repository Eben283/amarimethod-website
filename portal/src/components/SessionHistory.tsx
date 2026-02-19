import { Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { Appointment } from '../types/portal';
import { formatDate, formatTime } from '../lib/utils';

interface SessionHistoryProps {
  appointments: Appointment[];
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: 'text-green-600', label: 'Completed' },
  confirmed: { icon: Clock, color: 'text-blue-600', label: 'Confirmed' },
  cancelled: { icon: XCircle, color: 'text-red-500', label: 'Cancelled' },
  no_show: { icon: AlertTriangle, color: 'text-amber-500', label: 'No show' },
};

export default function SessionHistory({ appointments }: SessionHistoryProps) {
  if (appointments.length === 0) {
    return (
      <div className="portal-card">
        <h2 className="font-serif text-lg font-bold text-amari-charcoal mb-3">
          Session History
        </h2>
        <p className="text-sm text-amari-text-muted">
          Your past sessions will appear here after your first visit.
        </p>
      </div>
    );
  }

  return (
    <div className="portal-card">
      <h2 className="font-serif text-lg font-bold text-amari-charcoal mb-4">
        Session History
      </h2>
      <div className="space-y-3">
        {appointments.slice(0, 10).map((appt) => {
          const statusConfig = STATUS_CONFIG[appt.status] || STATUS_CONFIG.completed;
          const StatusIcon = statusConfig.icon;

          return (
            <div
              key={appt.id}
              className="flex items-center gap-3 py-2 border-b border-amari-border last:border-0"
            >
              <StatusIcon className={`w-4 h-4 flex-shrink-0 ${statusConfig.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amari-charcoal truncate">
                  {appt.title || appt.appointmentType || 'Session'}
                </p>
                <p className="text-xs text-amari-text-muted">
                  {formatDate(appt.startTime)} at {formatTime(appt.startTime)}
                </p>
              </div>
              <span className={`text-xs font-medium ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
