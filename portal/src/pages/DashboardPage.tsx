import { useState } from 'react';
import PortalNav from '../components/PortalNav';
import QuickActions from '../components/QuickActions';
import BillingDocuments from '../components/BillingDocuments';
import SettingsModal from '../components/SettingsModal';
import ReviewCard from '../components/ReviewCard';
import ProgressTracker from '../components/ProgressTracker';
import SessionHistory from '../components/SessionHistory';
import BookingModal from '../components/BookingModal';
import ReferralCard from '../components/ReferralCard';
import { useClientData } from '../hooks/useClientData';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardPage() {
  const { email } = useAuth();
  const { data, isLoading, error, refetch } = useClientData();
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const firstName = data?.client?.firstName || data?.client?.lastName || email?.split('@')[0] || 'there';

  if (isLoading) {
    return (
      <div className="cp-screen">
        <PortalNav firstName={firstName} hasLivingPractice={false} />
        <section className="cp-greet">
          <div className="cp-greet-l">
            <h1 className="cp-hello">Hey, <em>{firstName}.</em></h1>
            <p className="cp-greet-sub">Loading your portal…</p>
          </div>
        </section>
        <section className="cp-journey">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <span className="cp-verify-spinner" aria-hidden="true"></span>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cp-screen">
        <PortalNav firstName={firstName} hasLivingPractice={false} />
        <section className="cp-greet">
          <div className="cp-greet-l">
            <h1 className="cp-hello">Hey, <em>{firstName}.</em></h1>
            <p className="cp-greet-sub">Welcome back.</p>
          </div>
        </section>
        <section className="cp-error">
          <span className="cp-mono cp-accent">Connection lost</span>
          <h2 className="cp-error-h">We <em>can't reach</em> your portal right now.</h2>
          <p className="cp-error-p">{error}</p>
          <div className="cp-error-actions">
            <button type="button" className="cp-btn cp-btn-primary" onClick={refetch}>
              <span>Try again</span><span className="cp-arrow">→</span>
            </button>
            <a href="mailto:hello@amarimethod.com" className="cp-btn cp-btn-ghost">Contact Dr. Garrett</a>
          </div>
        </section>
      </div>
    );
  }

  if (!data) return null;

  const { client, appointments, upcomingAppointments } = data;
  // Trust appointment data over the sessions_completed custom field — Garrett
  // doesn't always mark sessions complete in GHL, and past 'confirmed'
  // appointments effectively ran. The custom field is a fallback.
  // Phone-style appointments (discovery, consultation) don't count toward
  // "had an initial session" — they're pre-session phone chats. Mirrors
  // NON_JOURNEY in portal-data.js + ProgressTracker.tsx.
  const NON_JOURNEY = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
  const isJourneyAppt = (a: { title?: string; appointmentType?: string }) =>
    !NON_JOURNEY.test(`${a.title || ''} ${a.appointmentType || ''}`);
  const completedAppointments = appointments.filter(a =>
    (a.status === 'completed' || a.status === 'showed' || a.status === 'confirmed') &&
    isJourneyAppt(a)
  ).length;
  const hasHadInitial = completedAppointments > 0 || client.sessionsCompleted > 0;
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;

  const sub = !hasHadInitial
    ? "Welcome — let's get your first session on the calendar."
    : hasActiveSeries
      ? `${client.sessionsRemaining} session${client.sessionsRemaining !== 1 ? 's' : ''} left in your series.`
      : upcomingAppointments.length > 0
        ? 'Welcome back.'
        : "Book your next session whenever you're ready.";

  const pastCompleted = appointments.filter(a =>
    (a.status === 'completed' || a.status === 'showed') && isJourneyAppt(a),
  );
  const lastVisit = pastCompleted.length > 0
    ? new Date(pastCompleted[0].startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : undefined;

  return (
    <div className="cp-screen">
      <PortalNav
        firstName={client.firstName || client.lastName}
        hasLivingPractice={client.hasLivingPractice}
        onOpenSettings={() => setShowSettings(true)}
      />

      {showBookingModal && (
        <BookingModal onClose={() => setShowBookingModal(false)} />
      )}

      {showSettings && (
        <SettingsModal
          current={client.reminderPreference || 'all'}
          onClose={() => setShowSettings(false)}
          onSaved={refetch}
        />
      )}

      <section className="cp-greet">
        <div className="cp-greet-l">
          <h1 className="cp-hello">Hey, <em>{client.firstName || client.lastName}.</em></h1>
          <p className="cp-greet-sub">{sub}</p>
        </div>
        {lastVisit && (
          <div className="cp-greet-r">
            <span className="cp-mono">Last visit</span>
            <span className="cp-greet-when">{lastVisit}</span>
          </div>
        )}
      </section>

      <ProgressTracker
        client={client}
        upcomingAppointments={upcomingAppointments}
        allAppointments={appointments}
        onRefetch={refetch}
        // Always pass the booking opener — the new dashboard card decides per
        // state whether to surface a "Book a session" CTA (brand new, pay-as-
        // you-go, mid-package, low-confidence). Zero-left uses direct package
        // purchase links instead.
        onBookSession={() => setShowBookingModal(true)}
      />

      <QuickActions client={client} onBookSession={() => setShowBookingModal(true)} />

      {hasHadInitial && <BillingDocuments />}

      {!client.isPartner && (
        <div style={{ margin: '22px 20px 0' }}>
          <ReferralCard
            contactId={client.contactId}
            referralCount={client.referralCount ?? 0}
            rewardCode={client.rewardCode ?? null}
          />
        </div>
      )}

      <SessionHistory appointments={appointments} />

      {hasHadInitial && (
        <div style={{ margin: '22px 20px 0' }}>
          <ReviewCard />
        </div>
      )}

      <footer className="cp-foot">
        <span>amarimethod.com</span>
        <span className="cp-dot">·</span>
        <a href="mailto:hello@amarimethod.com">Help &amp; policies</a>
        <span className="cp-dot">·</span>
        <a href="mailto:hello@amarimethod.com">Contact Dr. Garrett</a>
        <span className="cp-foot-r">© {new Date().getFullYear()} Amari Method</span>
      </footer>
    </div>
  );
}
