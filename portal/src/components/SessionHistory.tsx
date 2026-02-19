import { Clock, CheckCircle2, XCircle, AlertTriangle, History } from 'lucide-react';
import type { Appointment } from '../types/portal';
import { getMonth, getDay, formatTime, formatDate } from '../lib/utils';

interface SessionHistoryProps {
  appointments: Appointment[];
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  completed: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  confirmed: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Confirmed' },
  cancelled: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: 'Cancelled' },
  no_show: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50', label: 'No show' },
};

export default function SessionHistory({ appointments }: SessionHistoryProps) {
  if (appointments.length === 0) {
    return (
      <div className="portal-card">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-amari-charcoal" />
          <h2 className="font-serif text-lg font-bold text-amari-charcoal">
            Session History
          </h2>
        </div>
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-amari-light-sand rounded-full flex items-center justify-center mx-auto mb-3">
            <History className="w-6 h-6 text-amari-text-muted" />
          </div>
          <p className="text-sm text-amari-text-muted">
            Your past sessions will appear here after your first visit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-card">
      <div className="flex items-center gap-2 mb-4">
        <History className="w-5 h-5 text-amari-charcoal" />
        <h2 className="font-serif text-lg font-bold text-amari-charcoal">
          Session History
        </h2>
      </div>
      <div className="space-y-3">
        {appointments.slice(0, 10).map((appt) => {
          const statusConfig = STATUS_CONFIG[appt.status] || STATUS_CONFIG.completed;
          const StatusIcon = statusConfig.icon;

          return (
            <div
              key={appt.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-amari-border"
            >
              {/* Calendar date block */}
              <div className="flex-shrink-0 w-12 h-12 bg-amari-light-sand rounded-lg flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase font-semibold text-amari-text-muted leading-none">
                  {getMonth(appt.startTime)}
                </span>
                <span className="text-lg font-bold text-amari-charcoal leading-tight">
                  {getDay(appt.startTime)}
                </span>
              </div>
              {/* Details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amari-charcoal truncate">
                  {appt.title || appt.appointmentType || 'Session'}
                </p>
                <p className="text-xs text-amari-text-muted mt-0.5">
                  {formatDate(appt.startTime)} at {formatTime(appt.startTime)}
                </p>
              </div>
              {/* Status badge */}
              <div className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full ${statusConfig.bg}`}>
                <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
                <span className={`text-xs font-medium ${statusConfig.color}`}>
                  {statusConfig.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
