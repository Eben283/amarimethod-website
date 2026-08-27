import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Appointment, PortalDataResponse } from '../types/portal';
import { formatTime } from '../lib/utils';
import PortalNav from '../components/PortalNav';
import BookingModal from '../components/BookingModal';
import SettingsModal from '../components/SettingsModal';
import SessionHistory from '../components/SessionHistory';

interface PracticeDashboardPageProps {
  data: PortalDataResponse;
  onRefetch: () => void;
}

function fullDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function meetingFormat(appointment: Appointment): string {
  const source = `${appointment.title} ${appointment.appointmentType}`.toLowerCase();
  return source.includes('virtual') || source.includes('zoom') || source.includes('online')
    ? 'Virtual'
    : 'In person · San Francisco';
}

function practiceCopy(seriesType: string) {
  if (seriesType === '12-session') {
    return {
      title: <>The 6-Week Amari Practice</>,
      subtitle: '12 in-person visits over 6 weeks. Living Practice is included.',
      shapeHeading: <>12 visits over 6 weeks.</>,
      completeHeading: <>Your 12 visits are complete.</>,
    };
  }
  if (seriesType === '24-session') {
    return {
      title: <>The 12-Week Amari Practice</>,
      subtitle: '24 in-person visits over 12 weeks. Living Practice is included.',
      shapeHeading: <>24 visits over 12 weeks.</>,
      completeHeading: <>Your 24 visits are complete.</>,
    };
  }
  return {
    title: <>Your Amari visits</>,
    subtitle: 'Book and manage sessions here. Contact Amari when you want to talk about what comes next.',
    shapeHeading: <>Your visit balance.</>,
    completeHeading: <>No prepaid visits remaining.</>,
  };
}

/**
 * The single member home. It preserves each member's access and balance while
 * keeping retired founder offers off every client-facing portal surface.
 */
export default function PracticeDashboardPage({ data, onRefetch }: PracticeDashboardPageProps) {
  const { client, appointments, upcomingAppointments } = data;
  const [showBooking, setShowBooking] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<Appointment | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const nextSession = upcomingAppointments[0];
  const isComplete = client.sessionsRemaining === 0;
  const countIsReady = client.ledgerConfidence !== 'low';
  const copy = practiceCopy(client.seriesType);

  const closeBooking = () => {
    setShowBooking(false);
    setRescheduleFor(null);
    onRefetch();
  };

  return (
    <div className="cp-screen cp-practice-screen" data-testid="dashboard">
      <PortalNav
        firstName={client.firstName || client.lastName}
        hasLivingPractice={client.hasLivingPractice}
        onOpenSettings={() => setShowSettings(true)}
        practiceMode
      />

      {(showBooking || rescheduleFor) && (
        <BookingModal
          rescheduleFor={rescheduleFor}
          payPerSession={!(client.sessionsRemaining > 0)}
          onClose={closeBooking}
        />
      )}

      {showSettings && (
        <SettingsModal
          current={client.reminderPreference || 'all'}
          onClose={() => setShowSettings(false)}
          onSaved={onRefetch}
        />
      )}

      <main className="cp-practice-main">
        <section className="cp-practice-masthead" aria-labelledby="practice-title">
          <span className="cp-mono">Your Practice</span>
          <h1 id="practice-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </section>

        <section className="cp-practice-next" aria-labelledby="next-session-heading">
          <div className="cp-practice-next-title">
            <span className="cp-mono">{isComplete ? 'Visits complete' : 'Your next session'}</span>
            {isComplete ? (
              <>
                <h2 id="next-session-heading">{copy.completeHeading}</h2>
                <p>Contact Amari to talk about continuing.</p>
              </>
            ) : nextSession ? (
              <>
                <h2 id="next-session-heading">{fullDate(nextSession.startTime)}</h2>
                <p>{formatTime(nextSession.startTime)} · {meetingFormat(nextSession)}</p>
              </>
            ) : (
              <>
                <h2 id="next-session-heading">Choose your next visit.</h2>
                <p>A consistent rhythm gives you more chances to notice what is changing.</p>
              </>
            )}
          </div>

          <div className="cp-practice-next-actions">
            {isComplete ? (
              <a className="cp-btn cp-btn-primary" href="mailto:hello@amarimethod.com">Contact Amari</a>
            ) : nextSession ? (
              <>
                <button type="button" className="cp-btn cp-btn-primary" onClick={() => setRescheduleFor(nextSession)}>
                  Change this session <span className="cp-arrow">→</span>
                </button>
                <button type="button" className="cp-btn cp-btn-text" onClick={() => setShowBooking(true)}>
                  Choose another time
                </button>
              </>
            ) : (
              <button type="button" className="cp-btn cp-btn-primary" onClick={() => setShowBooking(true)}>
                {appointments.length === 0 ? 'Choose your first session' : 'Book your next session'} <span className="cp-arrow">→</span>
              </button>
            )}
          </div>
        </section>

        <section className="cp-practice-shape" aria-labelledby="practice-shape-heading">
          <div className="cp-practice-shape-head">
            <div>
              <span className="cp-mono">Your visits</span>
              <h2 id="practice-shape-heading">{copy.shapeHeading}</h2>
            </div>
            {countIsReady ? (
              <p className="cp-practice-balance">{client.sessionsRemaining} visit{client.sessionsRemaining === 1 ? '' : 's'} remaining</p>
            ) : (
              <p className="cp-practice-balance">Your visit count is being refreshed.</p>
            )}
          </div>
        </section>

        <section className="cp-practice-grid" aria-label="Practice resources">
          {client.hasLivingPractice && (
            <article className="cp-practice-living">
              <span className="cp-mono">Between visits</span>
              <h2>Living Practice</h2>
              <p>Guided videos and practices to use between visits.</p>
              <Link to="/practice" className="cp-btn cp-btn-ghost">Open Living Practice <span className="cp-arrow">→</span></Link>
            </article>
          )}

          <article className="cp-practice-upcoming">
            <span className="cp-mono">Up next</span>
            {upcomingAppointments.length ? (
              <ul>
                {upcomingAppointments.slice(0, 3).map((appointment) => (
                  <li key={appointment.id}>
                    <div><strong>{fullDate(appointment.startTime)}</strong><span>{formatTime(appointment.startTime)} · {meetingFormat(appointment)}</span></div>
                    <button type="button" onClick={() => setRescheduleFor(appointment)}>Manage</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No upcoming sessions yet.</p>
            )}
          </article>
        </section>

        <SessionHistory appointments={appointments} />
      </main>

      <footer className="cp-foot">
        <span>amarimethod.com</span><span className="cp-dot">·</span>
        <a href="mailto:hello@amarimethod.com">Help &amp; policies</a>
        <span className="cp-foot-r">© {new Date().getFullYear()} Amari Method</span>
      </footer>
    </div>
  );
}
