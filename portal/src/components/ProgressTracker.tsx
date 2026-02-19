import { TrendingUp, Calendar, ArrowRight, Clock } from 'lucide-react';
import type { ClientData, Appointment } from '../types/portal';
import { getMonth, getDay, getRelativeDay, formatTime } from '../lib/utils';

interface ProgressTrackerProps {
  client: ClientData;
  upcomingAppointments: Appointment[];
}

export default function ProgressTracker({ client, upcomingAppointments }: ProgressTrackerProps) {
  const isOnSeries = client.seriesType !== 'none';
  const totalSessions = client.seriesType === '8-session' ? 8 : client.seriesType === '4-session' ? 4 : 0;
  const progressPercent = totalSessions > 0
    ? Math.min((client.sessionsCompleted / totalSessions) * 100, 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Progress card */}
      <div className="portal-card">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-amari-accent-warm" />
          <h2 className="font-serif text-lg font-bold text-amari-charcoal">Your Progress</h2>
        </div>

        {isOnSeries ? (
          /* Series progress */
          <div>
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
          <div>
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
      </div>

      {/* Upcoming Sessions card */}
      <div className="portal-card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-amari-charcoal" />
          <h2 className="font-serif text-lg font-bold text-amari-charcoal">Upcoming Sessions</h2>
        </div>

        {upcomingAppointments.length > 0 ? (
          <div className="space-y-3">
            {upcomingAppointments.slice(0, 5).map((appt) => (
              <div
                key={appt.id}
                className="flex items-center gap-4 p-3 bg-amari-light-sand rounded-lg"
              >
                {/* Calendar date block */}
                <div className="flex-shrink-0 w-14 h-14 bg-white rounded-lg shadow-sm flex flex-col items-center justify-center border border-amari-border">
                  <span className="text-[10px] uppercase font-semibold text-amari-accent-warm leading-none">
                    {getMonth(appt.startTime)}
                  </span>
                  <span className="text-xl font-bold text-amari-charcoal leading-tight">
                    {getDay(appt.startTime)}
                  </span>
                </div>
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amari-charcoal truncate">
                    {appt.title || appt.appointmentType || 'Session'}
                  </p>
                  <p className="text-xs text-amari-text-muted mt-0.5">
                    {getRelativeDay(appt.startTime)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3 text-amari-text-muted" />
                    <span className="text-xs text-amari-text-secondary font-medium">
                      {formatTime(appt.startTime)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-amari-light-sand rounded-full flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-amari-text-muted" />
            </div>
            <p className="text-sm text-amari-text-muted mb-3">No upcoming sessions scheduled</p>
            <a
              href="https://amarimethodfollowup.amarimethod.com/booking-single-amari-method-followup-session"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-amari-charcoal hover:underline"
            >
              Book your next session <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
