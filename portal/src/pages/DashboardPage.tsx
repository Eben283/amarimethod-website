import PortalNav from '../components/PortalNav';
import QuickActions from '../components/QuickActions';
import ProgressTracker from '../components/ProgressTracker';
import SessionHistory from '../components/SessionHistory';
import { useClientData } from '../hooks/useClientData';
import { useAuth } from '../contexts/AuthContext';
import { getGreeting } from '../lib/utils';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  const { email } = useAuth();
  const { data, isLoading, error, refetch } = useClientData();

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

  return (
    <>
      <PortalNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Welcome */}
        <div className="mb-8 animate-fade-in">
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-amari-charcoal">
            {getGreeting()}, {client.firstName}
          </h1>
          <p className="text-amari-text-muted mt-1">
            Here's where you stand with your care.
          </p>
        </div>

        {/* Quick Actions */}
        <section className="mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <QuickActions client={client} />
        </section>

        {/* Progress + Upcoming | Session History grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <ProgressTracker client={client} upcomingAppointments={upcomingAppointments} />
          </div>
          <div className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <SessionHistory appointments={appointments} />
          </div>
        </div>
      </main>
    </>
  );
}
