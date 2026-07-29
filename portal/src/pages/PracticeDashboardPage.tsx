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
  if (seriesType === '6-week') {
    return {
      title: <>The 6-Week <em>Amari Practice</em></>,
      subtitle: '12 in-person visits, with Living Practice included.',
      shapeHeading: <>Six weeks, held with <em>room to notice.</em></>,
      completeHeading: <>Your six-week practice is <em>complete.</em></>,
      showHorizon: true,
      horizon: [
        { span: 'Weeks 1–2', strong: 'Begin', p: 'Make room to notice what is here.' },
        { span: 'Weeks 3–4', strong: 'Deepen', p: 'Give repetition and attention more room.' },
        { span: 'Weeks 5–6', strong: 'Carry forward', p: 'Notice what you want to bring into ordinary life.' },
      ],
    };
  }
  if (seriesType === '12-week') {
    return {
      title: <>The 12-Week <em>Amari Practice</em></>,
      subtitle: '24 in-person visits, with Living Practice included.',
      shapeHeading: <>Twelve weeks, held with <em>room to notice.</em></>,
      completeHeading: <>Your twelve-week practice is <em>complete.</em></>,
      showHorizon: true,
      horizon: [
        { span: 'Weeks 1–4', strong: 'Begin', p: 'Make room to notice what is here.' },
        { span: 'Weeks 5–8', strong: 'Deepen', p: 'Give repetition and attention more room.' },
        { span: 'Weeks 9–12', strong: 'Carry forward', p: 'Notice what you want to bring into ordinary life.' },
      ],
    };
  }
  return {
    title: <>Your <em>Amari</em> visits</>,
    subtitle: 'Book and manage sessions here. Contact Amari when you want to talk about what comes next.',
    shapeHeading: <>A calm place to <em>continue.</em></>,
    completeHeading: <>No prepaid visits <em>remaining.</em></>,
    showHorizon: false,
    horizon: [],
  };
}

/**
 * Portal v2 home: Practice products and any client who is not tagged
 * founders-circle. Intentionally omits 4/8-pack repurchase CTAs (those stay
 * on the Founder's Circle / v1 dashboard only).
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
          <h1 id="practice-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </section>

        <section className="cp-practice-next" aria-labelledby="next-session-heading">
          <div className="cp-practice-next-title">
            <span className="cp-mono">{isComplete ? 'Practice complete' : 'Your next session'}</span>
            {isComplete ? (
              <>
                <h2 id="next-session-heading">{copy.completeHeading}</h2>
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
              <h2 id="practice-shape-heading">{copy.shapeHeading}</h2>
            </div>
            {countIsReady ? (
              <p className="cp-practice-balance">{client.sessionsRemaining} visit{client.sessionsRemaining === 1 ? '' : 's'} remaining</p>
            ) : (
              <p className="cp-practice-balance">Your visit count is being refreshed.</p>
            )}
          </div>
          {copy.showHorizon && (
            <ol className="cp-practice-horizon">
              {copy.horizon.map((item) => (
                <li key={item.span}>
                  <span>{item.span}</span>
                  <strong>{item.strong}</strong>
                  <p>{item.p}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="cp-practice-grid" aria-label="Practice resources">
          {client.hasLivingPractice && (
            <article className="cp-practice-living">
              <span className="cp-mono">Between visits</span>
              <h2>Living <em>Practice</em></h2>
              <p>A quiet library to return to when useful.</p>
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
