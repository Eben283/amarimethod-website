import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Appointment, PortalDataResponse } from '../types/portal';
import { formatTime, getGreeting } from '../lib/utils';
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

/**
 * The client home for the paid 12-Week Amari Practice. This deliberately
 * prioritizes the next useful action over a package countdown. It uses the
 * same booking and session-management controls as the legacy portal, while
 * keeping the Founder’s Circle dashboard untouched.
 */
export default function PracticeDashboardPage({ data, onRefetch }: PracticeDashboardPageProps) {
  const { client, appointments, upcomingAppointments } = data;
  const [showBooking, setShowBooking] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<Appointment | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const nextSession = upcomingAppointments[0];
  const isComplete = client.sessionsRemaining === 0;
  const countIsReady = client.ledgerConfidence !== 'low';

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
        <BookingModal rescheduleFor={rescheduleFor} onClose={closeBooking} />
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
          <h1 id="practice-title">The 12-Week <em>Amari Practice</em></h1>
          <p>24 in-person visits, with Living Practice included.</p>
        </section>

        <section className="cp-practice-next" aria-labelledby="next-session-heading">
          <div className="cp-practice-next-title">
            <span className="cp-mono">{isComplete ? 'Practice complete' : 'Your next session'}</span>
            {isComplete ? (
              <>
                <h2 id="next-session-heading">Your twelve-week practice is <em>complete.</em></h2>
                <p>Contact Amari when you would like to talk about what comes next.</p>
              </>
            ) : nextSession ? (
              <>
                <h2 id="next-session-heading">{fullDate(nextSession.startTime)}</h2>
                <p>{formatTime(nextSession.startTime)} · {meetingFormat(nextSession)}</p>
              </>
            ) : (
              <>
                <h2 id="next-session-heading">Choose your next <em>visit.</em></h2>
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
              <span className="cp-mono">The shape of your practice</span>
              <h2 id="practice-shape-heading">Twelve weeks, held with <em>room to notice.</em></h2>
            </div>
            {countIsReady ? (
              <p className="cp-practice-balance">{client.sessionsRemaining} visit{client.sessionsRemaining === 1 ? '' : 's'} remaining</p>
            ) : (
              <p className="cp-practice-balance">Your visit count is being refreshed.</p>
            )}
          </div>
          <ol className="cp-practice-horizon">
            <li><span>Weeks 1–4</span><strong>Begin</strong><p>Make room to notice what is here.</p></li>
            <li><span>Weeks 5–8</span><strong>Deepen</strong><p>Give repetition and attention more room.</p></li>
            <li><span>Weeks 9–12</span><strong>Carry forward</strong><p>Notice what you want to bring into ordinary life.</p></li>
          </ol>
        </section>

        <section className="cp-practice-grid" aria-label="Practice resources">
          <article className="cp-practice-living">
            <span className="cp-mono">Between visits</span>
            <h2>Living <em>Practice</em></h2>
            <p>A quiet library to return to when useful.</p>
            <Link to="/practice" className="cp-btn cp-btn-ghost">Open Living Practice <span className="cp-arrow">→</span></Link>
          </article>

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
