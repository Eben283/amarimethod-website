import { useState } from 'react';
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

// Cap on dot rendering — when packageSize > MAX_DOTS we still show MAX_DOTS
// with a label "X of Y used". Keeps the visual proportional in re-up cases.
const MAX_DOTS = 12;
const PACK_LABEL: Record<string, string> = {
  '4-session': '4-pack',
  '8-session': '8-pack',
  Single: 'sessions',
  none: '',
};

type DashboardState =
  | 'brand-new'        // never purchased anything, no past sessions
  | 'pay-as-you-go'    // has past sessions, no package
  | 'mid-package'      // has remaining > 1 on a package
  | 'last-left'        // exactly 1 remaining on a package
  | 'zero-left'        // package exhausted, time to re-up
  | 'low-confidence';  // ledger flagged ambiguity — surface gentle prompt

function getDashboardState(client: ClientData, lifetimeCount: number): DashboardState {
  if (client.ledgerConfidence === 'low' && client.packageSize > 0) return 'low-confidence';
  const hasPackage = client.packageSize > 0;
  if (!hasPackage && lifetimeCount === 0) return 'brand-new';
  if (!hasPackage) return 'pay-as-you-go';
  if (client.sessionsRemaining === 0) return 'zero-left';
  if (client.sessionsRemaining === 1) return 'last-left';
  return 'mid-package';
}

function isWithin24Hours(startTime: string): boolean {
  const apptDate = new Date(startTime);
  const now = new Date();
  return apptDate.getTime() - now.getTime() < 24 * 60 * 60 * 1000;
}

function detectFormat(apt: Appointment): 'Virtual' | 'In-person' {
  const t = (apt.appointmentType || apt.title || '').toLowerCase();
  if (t.includes('virtual') || t.includes('zoom') || t.includes('online')) return 'Virtual';
  return 'In-person';
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function toGcalDate(iso: string): string {
  // Google Calendar format: YYYYMMDDTHHMMSSZ (UTC)
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00Z`;
}

function buildGoogleCalendarUrl(apt: Appointment): string {
  const format = detectFormat(apt);
  const meet = apt.meetingUrl || '';
  const details = format === 'Virtual'
    ? (meet
        ? `Virtual session with Dr. Garrett. Join: ${meet}`
        : 'Virtual session with Dr. Garrett. The Google Meet link is in your confirmation email from Amari Method.')
    : 'In-person session with Dr. Garrett at Amari Method.';
  const location = meet || (format === 'In-person' ? 'Amari Method' : '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: apt.title || 'Amari Method session',
    dates: `${toGcalDate(apt.startTime)}/${toGcalDate(apt.endTime)}`,
    details,
    ...(location ? { location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// .ics file for Apple Calendar / Outlook / Yahoo / any non-Google calendar.
// On iOS/macOS, tapping a text/calendar link opens Apple Calendar directly.
function buildIcsUrl(apt: Appointment): string {
  const format = detectFormat(apt);
  const meet = apt.meetingUrl || '';
  const description = format === 'Virtual'
    ? (meet
        ? `Virtual session with Dr. Garrett. Join here: ${meet}`
        : 'Virtual session with Dr. Garrett. The Google Meet link is in your confirmation email from Amari Method.')
    : 'In-person session with Dr. Garrett at Amari Method.';
  const locationLine = meet
    ? `LOCATION:${meet}`
    : (format === 'In-person' ? 'LOCATION:Amari Method' : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Amari Method//Portal//EN',
    'BEGIN:VEVENT',
    `UID:${apt.id}@amarimethod.com`,
    `DTSTAMP:${toGcalDate(new Date().toISOString())}`,
    `DTSTART:${toGcalDate(apt.startTime)}`,
    `DTEND:${toGcalDate(apt.endTime)}`,
    `SUMMARY:${apt.title || 'Amari Method session'}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    ...(locationLine ? [locationLine] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

export default function ProgressTracker({ client, upcomingAppointments, allAppointments, onRefetch, onBookSession }: ProgressTrackerProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<'cancel' | 'reschedule'>('cancel');
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Lifetime journey counter — total past appointments that effectively ran.
  // Past 'confirmed' counts because Garrett doesn't always flip them to
  // 'completed' or 'showed'.
  const lifetimeCompleted = allAppointments.filter(a =>
    a.status === 'completed' || a.status === 'showed' || a.status === 'confirmed'
  ).length;
  // Fall back to the server-derived sessionsCompleted if the past-appointments
  // count is somehow lower (e.g. the API filtered some out for the client).
  const lifetimeCount = Math.max(lifetimeCompleted, client.sessionsCompleted);

  // Earliest past appointment — used for the "since X" lifetime tagline.
  const earliestPast = allAppointments
    .filter(a => a.status === 'completed' || a.status === 'showed' || a.status === 'confirmed')
    .slice() // copy before sort
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const sinceLabel = earliestPast
    ? new Date(earliestPast.startTime).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    : null;

  const dashboardState = getDashboardState(client, lifetimeCount);
  const packLabel = PACK_LABEL[client.seriesType] || 'pack';
  // Dot rendering: show packageSize dots up to MAX_DOTS. Filled = used,
  // empty = remaining. If packageSize > MAX_DOTS we proportionally scale.
  const totalDots = Math.min(client.packageSize, MAX_DOTS);
  const usedRatio = client.packageSize > 0
    ? client.attendedAgainstPackage / client.packageSize
    : 0;
  const filledDots = Math.round(usedRatio * totalDots);

  async function handleCancel(appointmentId: string, title: string) {
    setCancellingId(appointmentId);
    setCancelError(null);
    try {
      await cancelAppointment(appointmentId, title);
      setConfirmingId(null);
      onRefetch();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Unable to cancel. Please try again.');
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
      setCancelError(err instanceof Error ? err.message : 'Unable to reschedule. Please try again.');
    } finally {
      setReschedulingId(null);
    }
  }

  const nextApt = upcomingAppointments[0];
  const moreUpcoming = upcomingAppointments.slice(1, 5);

  return (
    <>
      {/* ── Dashboard card — two-counter layout ──
          Hero: prepaid balance (when do I need to act?)
          Footer: lifetime journey (how far have I come?)
          See projects/amarimethod-website/portal/PORTAL-REDESIGN-RESEARCH.md
      */}
      <section className="cp-journey">
        {dashboardState === 'brand-new' && (
          <div className="cp-dash-hero cp-dash-hero-new">
            <span className="cp-mono">Welcome</span>
            <h2 className="cp-journey-title">
              {upcomingAppointments.length > 0
                ? <>Your first session is on <em>the books.</em></>
                : <>Book your <em>first session</em> to begin.</>}
            </h2>
            {!upcomingAppointments.length && onBookSession && (
              <div className="cp-dash-cta">
                <button type="button" onClick={onBookSession} className="cp-btn cp-btn-primary">
                  <span>Book a session</span><span className="cp-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        )}

        {dashboardState === 'pay-as-you-go' && (
          <div className="cp-dash-hero">
            <span className="cp-mono">Your journey</span>
            <h2 className="cp-journey-title">
              <em>{lifetimeCount}</em> session{lifetimeCount === 1 ? '' : 's'} with the Amari Method
              {sinceLabel && <span className="cp-journey-since"> · since {sinceLabel}</span>}
            </h2>
            {onBookSession && (
              <div className="cp-dash-cta">
                <button type="button" onClick={onBookSession} className="cp-btn cp-btn-primary">
                  <span>Book your next session</span><span className="cp-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        )}

        {(dashboardState === 'mid-package' || dashboardState === 'last-left') && (
          <>
            <div className="cp-journey-head">
              <div>
                <span className="cp-mono">Your {packLabel}</span>
                <h2 className="cp-journey-title">
                  <em>{client.sessionsRemaining}</em> session{client.sessionsRemaining === 1 ? '' : 's'} left
                </h2>
              </div>
              <div className="cp-journey-pct">
                <span className="cp-journey-pct-n">{client.attendedAgainstPackage}<small>/{client.packageSize}</small></span>
                <span className="cp-mono">Used</span>
              </div>
            </div>

            {totalDots > 0 && (
              <ol className="cp-rail cp-rail-numbers-only" style={{ gridTemplateColumns: `repeat(${totalDots}, 1fr)` }}>
                {Array.from({ length: totalDots }).map((_, i) => {
                  const isUsed = i < filledDots;
                  const isCurrent = i === filledDots - 1; // most-recently-used
                  return (
                    <li key={i} className={'cp-rail-step' + (isUsed ? ' is-done' : '') + (isCurrent ? ' is-current' : '')}>
                      <span className="cp-rail-mark">
                        <span className="cp-rail-dot"></span>
                        {i < totalDots - 1 && <span className="cp-rail-line"></span>}
                      </span>
                      <span className="cp-rail-label">
                        <span className="cp-rail-n">{pad2(i + 1)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {dashboardState === 'last-left' && (
              <p className="cp-journey-next cp-journey-soft-reup">
                Last session in your {packLabel}. <em>Ready for what's next?</em> Re-up anytime.
              </p>
            )}
            {dashboardState === 'mid-package' && lifetimeCount > 0 && (
              <p className="cp-journey-next">
                <em>{lifetimeCount}</em> session{lifetimeCount === 1 ? '' : 's'} with the Amari Method
                {sinceLabel && <> · since {sinceLabel}</>}
              </p>
            )}
          </>
        )}

        {dashboardState === 'zero-left' && (
          <div className="cp-dash-hero cp-dash-hero-reup">
            <span className="cp-mono">Your {packLabel} is complete</span>
            <h2 className="cp-journey-title">
              <em>{lifetimeCount}</em> session{lifetimeCount === 1 ? '' : 's'} with the Amari Method.
            </h2>
            <p className="cp-journey-next">Keep the momentum going — pick a package to continue.</p>
            <div className="cp-dash-cta cp-dash-cta-stack">
              <a href="/book/8-session-series" className="cp-btn cp-btn-primary">
                <span>Continue with 8 more sessions</span><span className="cp-arrow">→</span>
              </a>
              <a href="/book/4-session-series" className="cp-btn cp-btn-ghost">
                <span>Or try a 4-session pack</span>
              </a>
            </div>
          </div>
        )}

        {dashboardState === 'low-confidence' && (
          <div className="cp-dash-hero cp-dash-hero-warn">
            <span className="cp-mono">Your sessions</span>
            <h2 className="cp-journey-title">
              <em>{lifetimeCount}</em> session{lifetimeCount === 1 ? '' : 's'} with the Amari Method.
            </h2>
            <p className="cp-journey-next">
              Your remaining session count is being reviewed. Drop us a note and we'll confirm.{' '}
              <a href="mailto:hello@amarimethod.com?subject=Session%20balance%20question">hello@amarimethod.com</a>
            </p>
            {onBookSession && (
              <div className="cp-dash-cta">
                <button type="button" onClick={onBookSession} className="cp-btn cp-btn-primary">
                  <span>Book your next session</span><span className="cp-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Next session card ── */}
      {nextApt ? (
        (() => {
          const tooSoon = isWithin24Hours(nextApt.startTime);
          const isConfirming = confirmingId === nextApt.id;
          const isCancelling = cancellingId === nextApt.id;
          const isRescheduling = reschedulingId === nextApt.id;
          const apptTitle = nextApt.title || nextApt.appointmentType || 'Session';
          const format = detectFormat(nextApt);
          return (
            <section className="cp-next">
              <div className="cp-next-head">
                <span className="cp-mono cp-accent">Up next</span>
                <span className="cp-next-when">{getRelativeDay(nextApt.startTime)}</span>
              </div>
              <div className="cp-next-body">
                <div className="cp-date">
                  <span className="cp-date-m">{getMonth(nextApt.startTime)}</span>
                  <span className="cp-date-d">{getDay(nextApt.startTime)}</span>
                </div>
                <div className="cp-next-info">
                  <h3 className="cp-next-title">{apptTitle}</h3>
                  <p className="cp-next-meta">
                    <span>{formatTime(nextApt.startTime)}</span>
                    <span className="cp-dot">·</span>
                    <span>{format}</span>
                    <span className="cp-dot">·</span>
                    <span>with <b>Dr. Garrett</b></span>
                  </p>
                  {format === 'Virtual' && !nextApt.meetingUrl && (
                    <p className="cp-next-note">Google Meet link is in your confirmation email.</p>
                  )}
                </div>

                {/* Action stack */}
                {isConfirming ? (
                  <div className="cp-next-actions" style={{ minWidth: 240 }}>
                    <p style={{ fontFamily: 'var(--cp-display)', fontStyle: 'italic', fontSize: 14, color: 'var(--cp-ink-2)', lineHeight: 1.45, marginBottom: 4 }}>
                      {confirmMode === 'reschedule'
                        ? 'Your slot will be released so you can pick a new one.'
                        : "You'll lose this slot. Cancellations within 24 hours count as used."}
                    </p>
                    <button
                      type="button"
                      onClick={() => confirmMode === 'reschedule'
                        ? handleReschedule(nextApt.id, apptTitle)
                        : handleCancel(nextApt.id, apptTitle)
                      }
                      disabled={isCancelling || isRescheduling}
                      className="cp-btn cp-btn-danger"
                    >
                      <span>{
                        (isCancelling || isRescheduling)
                          ? 'Working…'
                          : confirmMode === 'reschedule' ? 'Yes, reschedule' : 'Yes, cancel'
                      }</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={isCancelling || isRescheduling}
                      className="cp-btn cp-btn-ghost"
                    >
                      Keep it
                    </button>
                  </div>
                ) : (
                  <div className="cp-next-actions">
                    {format === 'Virtual' && nextApt.meetingUrl && (
                      <a href={nextApt.meetingUrl} target="_blank" rel="noopener noreferrer" className="cp-btn cp-btn-primary">
                        <span>Join Google Meet</span><span className="cp-arrow">→</span>
                      </a>
                    )}
                    <a
                      href={buildGoogleCalendarUrl(nextApt)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={'cp-btn ' + (format === 'Virtual' && nextApt.meetingUrl ? 'cp-btn-ghost' : 'cp-btn-primary')}
                    >
                      <span>Add to Google Calendar</span>
                      {(!nextApt.meetingUrl || format !== 'Virtual') && <span className="cp-arrow">→</span>}
                    </a>
                    <a
                      href={buildIcsUrl(nextApt)}
                      download={`amari-session-${nextApt.id}.ics`}
                      className="cp-btn cp-btn-ghost"
                    >
                      Add to Apple Calendar
                    </a>
                    {!tooSoon && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setCancelError(null); setConfirmMode('reschedule'); setConfirmingId(nextApt.id); }}
                          className="cp-btn cp-btn-ghost"
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCancelError(null); setConfirmMode('cancel'); setConfirmingId(nextApt.id); }}
                          className="cp-btn cp-btn-text"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {tooSoon && !isConfirming && (
                <p className="cp-locked">
                  <span className="cp-lock-dot"></span>
                  Less than 24 hours away — rescheduling needs 24 hours' notice. If something urgent came up, <a href="mailto:hello@amarimethod.com?subject=Emergency%20reschedule%20request">email Dr. Garrett</a> and we'll review it.
                </p>
              )}

              {cancelError && (
                <p className="cp-locked" style={{ background: '#fbe6e1', borderLeftColor: 'var(--cp-err)' }}>
                  <span className="cp-lock-dot" style={{ background: 'var(--cp-err)' }}></span>
                  {cancelError}
                </p>
              )}
            </section>
          );
        })()
      ) : (
        // Empty next-session state: prompt to book
        <section className="cp-next">
          <div className="cp-next-head">
            <span className="cp-mono cp-accent">Up next</span>
          </div>
          <div className="cp-next-body" style={{ gridTemplateColumns: '1fr auto' }}>
            <div>
              <h3 className="cp-next-title">No session on the books.</h3>
              <p className="cp-next-meta"><span>When you're ready, book your next one.</span></p>
            </div>
            {onBookSession && (
              <div className="cp-next-actions">
                <button type="button" onClick={onBookSession} className="cp-btn cp-btn-primary">
                  <span>Book a session</span><span className="cp-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Coming up (additional upcoming) ── */}
      {moreUpcoming.length > 0 && (
        <section className="cp-coming">
          <div className="cp-section-head">
            <h3 className="cp-section-h">Coming up</h3>
            <span className="cp-mono">{moreUpcoming.length} scheduled</span>
          </div>
          <ul className="cp-coming-rows">
            {moreUpcoming.map(s => {
              const tooSoon = isWithin24Hours(s.startTime);
              const isConfirming = confirmingId === s.id;
              const isCancelling = cancellingId === s.id;
              const isRescheduling = reschedulingId === s.id;
              const apptTitle = s.title || s.appointmentType || 'Session';
              return (
                <li key={s.id} className="cp-coming-row">
                  <div className="cp-date">
                    <span className="cp-date-m">{getMonth(s.startTime)}</span>
                    <span className="cp-date-d">{getDay(s.startTime)}</span>
                  </div>
                  <div className="cp-coming-body">
                    <span className="cp-coming-title">{apptTitle}</span>
                    <span className="cp-coming-meta">{getRelativeDay(s.startTime)} · {formatTime(s.startTime)} · {detectFormat(s)}</span>
                  </div>
                  <div className="cp-coming-actions">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="cp-btn cp-btn-row cp-btn-danger"
                          onClick={() => confirmMode === 'reschedule'
                            ? handleReschedule(s.id, apptTitle)
                            : handleCancel(s.id, apptTitle)
                          }
                          disabled={isCancelling || isRescheduling}
                        >
                          {(isCancelling || isRescheduling) ? 'Working…' : `Yes, ${confirmMode}`}
                        </button>
                        <button
                          type="button"
                          className="cp-btn cp-btn-row cp-btn-text"
                          onClick={() => setConfirmingId(null)}
                          disabled={isCancelling || isRescheduling}
                        >
                          Keep it
                        </button>
                      </>
                    ) : tooSoon ? (
                      <span className="cp-mono" style={{ fontSize: 11 }}>Locked</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="cp-btn cp-btn-row"
                          onClick={() => { setCancelError(null); setConfirmMode('reschedule'); setConfirmingId(s.id); }}
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          className="cp-btn cp-btn-row cp-btn-text"
                          onClick={() => { setCancelError(null); setConfirmMode('cancel'); setConfirmingId(s.id); }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
