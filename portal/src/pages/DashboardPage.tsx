import { useState } from 'react';
import PortalNav from '../components/PortalNav';
import QuickActions from '../components/QuickActions';
import ProgressTracker from '../components/ProgressTracker';
import SessionHistory from '../components/SessionHistory';
import BookingModal from '../components/BookingModal';
import ReferralCard from '../components/ReferralCard';
import { useClientData } from '../hooks/useClientData';
import { useAuth } from '../contexts/AuthContext';
import { getGreeting } from '../lib/utils';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  const { email } = useAuth();
  const { data, isLoading, error, refetch } = useClientData();
  const [showBookingModal, setShowBookingModal] = useState(false);

  if (isLoading) {
    return (
      <>
        <PortalNav />
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-amari-charcoal mx-auto mb-3 animate-spin" />
            <p className="text-sm text-amari-text-muted">Loading your dashboard...</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PortalNav />
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <h2 className="font-serif text-xl font-bold text-amari-charcoal mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-amari-text-secondary mb-4">{error}</p>
            <button onClick={refetch} className="portal-btn-secondary">
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!data) return null;

  const { client, appointments, upcomingAppointments } = data;
  const hasHadInitial = client.sessionsCompleted > 0 || client.seriesType !== 'none';

  return (
    <>
      <PortalNav firstName={client.firstName} />
      {showBookingModal && <BookingModal onClose={() => setShowBookingModal(false)} />}

      <main className="max-w-5xl mx-auto px-4 sm:px-8 lg:px-10 py-8 space-y-10">

        {/* ── Greeting ── */}
        <div className="animate-fade-in">
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-amari-charcoal">
            {getGreeting()}, {client.firstName}
          </h1>
          <p className="text-amari-text-muted mt-1 text-sm">
            {client.seriesType !== 'none'
              ? `${client.sessionsRemaining} session${client.sessionsRemaining !== 1 ? 's' : ''} remaining`
              : hasHadInitial
                ? 'Welcome back — ready to book your next session?'
                : 'Welcome — your portal is ready.'}
          </p>
        </div>

        {/* ── Zone 1: Progress + Upcoming (full width) ── */}
        <section className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <ProgressTracker
            client={client}
            upcomingAppointments={upcomingAppointments}
            // `appointments` from the API = past appointments only (not upcoming).
            // Prop is named allAppointments but only past ones are passed — correct
            // because completed status only ever appears on past appointments.
            allAppointments={appointments}
            onRefetch={refetch}
            onBookSession={hasHadInitial ? () => setShowBookingModal(true) : undefined}
          />
        </section>

        {/* ── Divider ── */}
        <div className="border-t border-amari-border" />

        {/* ── Zone 2: Book & Manage ── */}
        <section className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-amari-text-muted mb-4">
            Book &amp; Manage
          </h2>
          <QuickActions client={client} onBookSession={() => setShowBookingModal(true)} />
        </section>

        {/* ── Divider ── */}
        <div className="border-t border-amari-border" />

        {/* ── Zone 3: History + Refer (bottom row) ── */}
        <section className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className={`grid grid-cols-1 gap-6 ${!client.isPartner ? 'lg:grid-cols-2' : ''}`}>
            <SessionHistory appointments={appointments} />
            {!client.isPartner && (
              <ReferralCard
                contactId={client.contactId}
                referralCount={client.referralCount ?? 0}
                rewardCode={client.rewardCode ?? null}
              />
            )}
          </div>
        </section>

      </main>
    </>
  );
}
