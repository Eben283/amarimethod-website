import { TrendingUp, Calendar, ArrowRight } from 'lucide-react';
import type { ClientData, Appointment } from '../types/portal';
import { formatDateTime } from '../lib/utils';

interface ProgressTrackerProps {
  client: ClientData;
  nextAppointment: Appointment | null;
}

export default function ProgressTracker({ client, nextAppointment }: ProgressTrackerProps) {
  const isOnSeries = client.seriesType !== 'none';
  const totalSessions = client.seriesType === '8-session' ? 8 : client.seriesType === '4-session' ? 4 : 0;
  const progressPercent = totalSessions > 0
    ? Math.min((client.sessionsCompleted / totalSessions) * 100, 100)
    : 0;

  return (
    <div className="portal-card">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-amari-accent-warm" />
        <h2 className="font-serif text-lg font-bold text-amari-charcoal">Your Progress</h2>
      </div>

      {isOnSeries ? (
        /* Series progress */
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-amari-text-secondary">
              {client.sessionsCompleted} of {totalSessions} sessions completed
            </span>
            <span className="text-sm font-medium text-amari-accent-warm">
              {Math.round(progressPercent)}%
            </span>
          </div>
          <div className="h-3 bg-amari-light-sand rounded-full overflow-hidden">
            <div
              className="h-full bg-amari-accent-warm rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {client.sessionsRemaining > 0 && (
            <p className="text-xs text-amari-text-muted mt-2">
              {client.sessionsRemaining} session{client.sessionsRemaining !== 1 ? 's' : ''} remaining in your {client.seriesType} series
            </p>
          )}
          {client.sessionsRemaining === 0 && (
            <p className="text-xs text-green-600 font-medium mt-2">
              Series complete! Consider starting a new series to continue your progress.
            </p>
          )}
        </div>
      ) : (
        /* Pay-per-session view */
        <div className="mb-6">
          <p className="text-sm text-amari-text-secondary">
            You've completed <span className="font-semibold">{client.sessionsCompleted}</span> session{client.sessionsCompleted !== 1 ? 's' : ''} so far.
          </p>
          {client.sessionsCompleted > 0 && (
            <div className="mt-3 p-3 bg-amari-light-sand rounded-lg">
              <p className="text-sm text-amari-text-secondary">
                <span className="font-medium">Save with a series:</span> Whatever you've already paid applies toward a series upgrade at any time.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Next appointment */}
      <div className="border-t border-amari-border pt-4">
        {nextAppointment ? (
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-amari-light-sand rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-amari-charcoal" />
            </div>
            <div>
              <p className="text-sm font-medium text-amari-charcoal">Next session</p>
              <p className="text-xs text-amari-text-muted">
                {formatDateTime(nextAppointment.startTime)}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-amari-text-muted">No upcoming sessions scheduled</p>
            <a
              href="https://amarimethodfollowup.amarimethod.com/booking-single-amari-method-followup-session"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-medium text-amari-charcoal hover:underline"
            >
              Book now <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
