import { useState } from 'react';
import { TrendingUp, Calendar, ArrowRight, Clock, X, RefreshCw, Loader2 } from 'lucide-react';
import type { ClientData, Appointment } from '../types/portal';
import { getMonth, getDay, getRelativeDay, formatTime } from '../lib/utils';
import { cancelAppointment } from '../lib/api';

interface ProgressTrackerProps {
  client: ClientData;
  upcomingAppointments: Appointment[];
  allAppointments: Appointment[];
  onRefetch: () => void;
  onBookSession?: () => void;
}

function isWithin24Hours(startTime: string): boolean {
  const apptDate = new Date(startTime);
  const now = new Date();
  const diff = apptDate.getTime() - now.getTime();
  return diff < 24 * 60 * 60 * 1000;
}

export default function ProgressTracker({ client, upcomingAppointments, allAppointments, onRefetch, onBookSession }: ProgressTrackerProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<'cancel' | 'reschedule'>('cancel');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const isOnSeries = client.seriesType !== 'none';
  // Derive total from series_type, not from completed + remaining.
  // sessions_completed is cumulative (lifetime total, never resets), so adding
  // it to remaining inflates the denominator after re-purchases.
  const totalSessions = client.seriesType === '8-session' ? 8
    : client.seriesType === '4-session' ? 4
    : 0;

  // Current series progress = how many of THIS series they've used.
  // Clamped to 0 for the rare case remaining > total (mid-series re-buy).
  const currentSeriesCompleted = isOnSeries
    ? Math.max(0, totalSessions - client.sessionsRemaining)
    : 0;
  const progressPercent = totalSessions > 0
    ? Math.min((currentSeriesCompleted / totalSessions) * 100, 100)
    : 0;

  // Lifetime count from actual appointment data — always accurate, never clamped
  const lifetimeCompleted = allAppointments.filter(a => a.status === 'completed' || a.status === 'showed').length;

  // True when client is on their second or later series (lifetime > current series)
  const isReturningClient = isOnSeries && lifetimeCompleted > currentSeriesCompleted;

  // Four UI states
  const seriesInProgress = isOnSeries && client.sessionsRemaining > 0;
  const seriesFinished = isOnSeries && client.sessionsRemaining === 0;
  const payAsYouGo = !isOnSeries && lifetimeCompleted > 0;
  // brandNew = !isOnSeries && lifetimeCompleted === 0 (default / else branch)

  async function handleCancel(appointmentId: string, title: string) {
    setCancellingId(appointmentId);
    setCancelError(null);
    try {
      await cancelAppointment(appointmentId, title);
      setConfirmingId(null);
      onRefetch();
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'Unable to cancel. Please try again.'
      );
    } finally {
      setCancellingId(null);
    }
  }

  function getRescheduleUrl(title: string): string | null {
    const t = title.toLowerCase();
    if (t.includes('discovery')) return '/book-discovery-call';
    if (t.includes('initial') && t.includes('virtual')) return '/book/initial-virtual';
    if (t.includes('initial')) return '/book/initial-in-person';
    return null; // follow-up — use modal
  }

  async function handleReschedule(appointmentId: string, title: string) {
    setReschedulingId(appointmentId);
    setCancelError(null);
    try {
      await cancelAppointment(appointmentId, title);
      setConfirmingId(null);
      onRefetch();
      const externalUrl = getRescheduleUrl(title);
      if (externalUrl) {
        window.open(externalUrl, '_blank', 'noopener,noreferrer');
      } else if (onBookSession) {
        onBookSession();
      }
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'Unable to reschedule. Please try again.'
      );
    } finally {
      setReschedulingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Progress card ── */}
      <div className="portal-card">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-amari-accent-warm" />
          <h2 className="font-serif text-lg font-bold text-amari-charcoal">Your Progress</h2>
        </div>

        {/* State 1: Active series, in progress */}
        {seriesInProgress && (
          <div data-testid="state-series-in-progress">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amari-text-secondary">
                {currentSeriesCompleted} of {totalSessions} sessions
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
            <p className="text-xs text-amari-text-muted mt-2">
              {`${client.sessionsRemaining} session${client.sessionsRemaining !== 1 ? 's' : ''} remaining`}
            </p>
            {isReturningClient && (
              <p className="text-xs text-amari-text-muted mt-1">
                ✦ {lifetimeCompleted} sessions with the Amari Method
              </p>
            )}
          </div>
        )}

        {/* State 2: Series just finished — celebration (Peak-End) */}
        {seriesFinished && (
          <div data-testid="state-series-finished">
            <div className="h-3 bg-amari-light-sand rounded-full overflow-hidden mb-3">
              <div className="h-full bg-amari-accent-warm rounded-full w-full transition-all duration-700 ease-out" />
            </div>
            <p className="text-sm font-medium text-amari-charcoal">
              Series complete — {lifetimeCompleted} session{lifetimeCompleted !== 1 ? 's' : ''} with the Amari Method
            </p>
            <p className="text-xs text-amari-text-muted mt-1">
              You've done meaningful work. Ready to keep the momentum going?
            </p>
          </div>
        )}

        {/* State 3: Pay-as-you-go, has sessions */}
        {payAsYouGo && (
          <div data-testid="state-pay-as-you-go">
            <p className="text-sm font-medium text-amari-charcoal">
              ✦ {lifetimeCompleted} session{lifetimeCompleted !== 1 ? 's' : ''} with the Amari Method
            </p>
          </div>
        )}

        {/* State 4: Brand new client — ghost progress bar (Zeigarnik) */}
        {!seriesInProgress && !seriesFinished && !payAsYouGo && (
          <div data-testid="state-brand-new">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amari-text-muted">
                Your 8-step journey
              </span>
              <span className="text-sm font-medium text-amari-text-muted">
                0%
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-2.5 flex-1 bg-amari-light-sand rounded-full"
                />
              ))}
            </div>
            <p className="text-xs text-amari-text-muted mt-2">
              Book your first session to begin.
            </p>
          </div>
        )}
      </div>

      {/* ── Upcoming Sessions card ── */}
      <div className="portal-card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-amari-charcoal" />
          <h2 className="font-serif text-lg font-bold text-amari-charcoal">Upcoming Sessions</h2>
        </div>

        {cancelError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{cancelError}</p>
          </div>
        )}

        {upcomingAppointments.length > 0 ? (
          <div className="space-y-3">
            {upcomingAppointments.slice(0, 5).map((appt) => {
              const tooSoon = isWithin24Hours(appt.startTime);
              const isConfirming = confirmingId === appt.id;
              const isCancelling = cancellingId === appt.id;
              const isRescheduling = reschedulingId === appt.id;
              const apptTitle = appt.title || appt.appointmentType || 'Session';

              return (
                <div
                  key={appt.id}
                  className="p-3 bg-amari-light-sand rounded-lg"
                >
                  <div className="flex items-center gap-4">
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
                        {apptTitle}
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

                  {/* Action buttons */}
                  {isConfirming ? (
                    <div className="mt-3 p-3 bg-white rounded-lg border border-red-200">
                      <p className="text-sm text-amari-charcoal mb-3">
                        {confirmMode === 'reschedule'
                          ? 'Your current time slot will be released and you can pick a new one. Your session won\'t be lost.'
                          : 'You\'ll lose this time slot and may need to wait for the next available opening.'}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => confirmMode === 'reschedule'
                            ? handleReschedule(appt.id, apptTitle)
                            : handleCancel(appt.id, apptTitle)
                          }
                          disabled={isCancelling || isRescheduling}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50"
                        >
                          {(isCancelling || isRescheduling) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : confirmMode === 'reschedule' ? (
                            <RefreshCw className="w-3 h-3" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          {isCancelling ? 'Cancelling...' : isRescheduling ? 'Cancelling...' : confirmMode === 'reschedule' ? 'Yes, reschedule' : 'Yes, cancel'}
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          disabled={isCancelling || isRescheduling}
                          className="px-3 py-1.5 text-xs font-medium text-amari-text-secondary bg-amari-light-sand hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      {tooSoon ? (
                        <span className="flex items-center px-3 py-1.5 text-xs text-amari-text-muted" title="Changes require 24 hours notice">
                          Changes unavailable within 24hrs
                        </span>
                      ) : (
                        <>
                        <button
                          onClick={() => {
                            setCancelError(null);
                            setConfirmMode('reschedule');
                            setConfirmingId(appt.id);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amari-charcoal bg-white hover:bg-gray-50 border border-amari-border rounded-md transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Reschedule
                        </button>
                        <button
                          onClick={() => {
                            setCancelError(null);
                            setConfirmMode('cancel');
                            setConfirmingId(appt.id);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 bg-white hover:bg-red-50 border border-amari-border rounded-md transition-colors"
                        >
                          <X className="w-3 h-3" />
                          Cancel
                        </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-amari-light-sand rounded-full flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-amari-text-muted" />
            </div>
            <p className="text-sm text-amari-text-muted mb-3">No upcoming sessions scheduled</p>
            {onBookSession && (
              <button
                data-testid="book-next-from-progress"
                onClick={onBookSession}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-amari-charcoal hover:underline"
              >
                Book your next session <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
